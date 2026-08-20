# Model Grading (DeepSeek-V4-Flash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement model grading — a canonical-only background sweep that sends self-graded written responses to DeepSeek-V4-Flash and supersedes the self-grade with a model grade — per `docs/superpowers/specs/2026-08-20-model-grading-design.md`.

**Architecture:** A new domain module (`server/src/domain/modelGrading.ts`) does the DeepSeek call (plain `fetch`, no new dependency) and the grade-write (mirroring `attempts.ts`'s existing supersede transaction). A canonical-only background timer (`server/src/grading/scheduler.ts`, mirroring `sync/client.ts`'s existing local-only timer pattern) drives it periodically, gated by a hard, user-adjustable daily call cap. Config/env additions are minimal: one new config key (the cap, not a secret) and one new env var (the API key, never touches the DB). Settings gets a mode toggle, an editable cap, and a live usage indicator.

**Tech Stack:** Node's built-in `fetch`, existing Fastify/`node:sqlite`/Vitest stack, React 19 (frontend task only). No new npm dependencies.

## Global Constraints

- No new npm dependencies — the DeepSeek API is called with plain `fetch`, matching `server/src/sync/client.ts`'s existing convention.
- `DEEPSEEK_API_KEY` lives only in the process environment (`server/src/env.ts`), never in the SQLite `config` table, never settable via MCP or `/api/config`.
- Only two `written_grader` modes exist: `self_only` (default) and `model_when_online` — no `model_required`, per the scoping decision in the spec.
- The daily cap (`model_grader_daily_limit` config key, default `20`) is enforced inside `sweepModelGrading` itself — a rolling 24-hour window (`grade.graded_at >= datetime('now', '-1 day')`), not a calendar-day boundary, and not merely documented.
- The sweep must no-op with zero API calls when `written_grader` is `self_only`, and the scheduler must never even attempt a sweep when `DEEPSEEK_API_KEY` is unset.
- A per-response grading failure must not abort the rest of the sweep — catch, count, continue.
- `server` test suite (`npx vitest run` from `server/`) and `web` build/lint (`npm run build && npm run lint` from `web/`) must both pass clean at the end of every task (one pre-existing, unrelated warning at `web/src/hooks/usePanelWidth.ts:30` is allowed to remain).

---

### Task 1: Config key, migration, and env var

**Files:**
- Create: `server/migrations/008_model_grader_daily_limit.sql`
- Modify: `server/src/domain/config.ts`
- Modify: `server/src/env.ts`
- Test: `server/tests/config.test.ts` (create if it doesn't already exist — check first; if it exists, extend it matching its existing style)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3-5): `config.model_grader_daily_limit` (a normal, gettable/settable config key, default `20`), `EnvConfig.deepseekApiKey: string | null`.

- [ ] **Step 1: Write the migration**

**Important — a pre-existing default needs correcting, not just a new key seeded.** `server/migrations/001_init.sql` already seeded `written_grader` with value `'"model_when_online"'` (verify this yourself: `grep written_grader server/migrations/001_init.sql`). That default was inert since model grading never existed until this plan — but it directly contradicts the spec's "off by default, opt-in" requirement (confirmed with the user: they want self-grading by default, model grading only when explicitly turned on). Left as-is, the moment `DEEPSEEK_API_KEY` is set on an existing install, grading would silently activate rather than requiring an explicit opt-in. This migration must flip the EXISTING row's value, not just seed a new key.

`server/migrations/008_model_grader_daily_limit.sql`:
```sql
-- Model grading (spec 2026-08-20) needs a hard, user-adjustable cap on
-- how many DeepSeek calls the sweep makes per rolling 24h. Not a secret —
-- safe to read/write over /api/config, unlike DEEPSEEK_API_KEY (env-only).
INSERT INTO config (key, value)
SELECT 'model_grader_daily_limit', '20'
WHERE NOT EXISTS (SELECT 1 FROM config WHERE key = 'model_grader_daily_limit');

-- 001_init.sql seeded written_grader to "model_when_online", inert until
-- this plan built actual model grading. The user explicitly wants this
-- opt-in, not on-by-default the moment DEEPSEEK_API_KEY is set — correct
-- the existing row rather than leaving a silent behavior change waiting.
-- Only touches installs that never explicitly changed it themselves.
UPDATE config SET value = '"self_only"' WHERE key = 'written_grader' AND value = '"model_when_online"';
```

- [ ] **Step 2: Add the key to `ALLOWED_KEYS`**

In `server/src/domain/config.ts`, add `"model_grader_daily_limit"` to the `ALLOWED_KEYS` set (alongside the existing `"written_grader"` entry — `written_grader` is already present, do not re-add it).

- [ ] **Step 3: Write the failing test**

Check whether `server/tests/config.test.ts` already exists and read it if so, to match its style. Add (creating the file if needed, following the existing `openTestDb()` pattern from `server/tests/helpers.ts`):

```ts
import { describe, it, expect } from "vitest";
import { getConfig, setConfig } from "../src/domain/config.js";
import { openTestDb } from "./helpers.js";

describe("model_grader_daily_limit config key", () => {
  it("is seeded to 20 by the migration and is settable over the normal config API", () => {
    const db = openTestDb();
    expect(getConfig(db).model_grader_daily_limit).toBe(20);

    setConfig(db, "model_grader_daily_limit", 5);
    expect(getConfig(db).model_grader_daily_limit).toBe(5);
  });
});

describe("written_grader default correction", () => {
  it("defaults to self_only, not the old inert model_when_online seed", () => {
    const db = openTestDb();
    expect(getConfig(db).written_grader).toBe("self_only");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: FAIL — `model_grader_daily_limit` is `undefined` (migration not yet written/applied, or key not yet in `ALLOWED_KEYS`).

- [ ] **Step 5: Add `deepseekApiKey` to `EnvConfig`**

In `server/src/env.ts`, add to the `EnvConfig` interface:
```ts
deepseekApiKey: string | null;
```
And in `loadEnvConfig`'s return value, add:
```ts
deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? null,
```
This is optional — do NOT call `required()` for it. Both canonical and local nodes can run with it unset; the scheduler (Task 4) simply never has anything to do without it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green (existing tests unaffected — `deepseekApiKey` is a new, optional `EnvConfig` field; any test file that constructs an env object by hand will still compile since TypeScript allows omitting `deepseekApiKey` only if... **note:** since `EnvConfig` is an interface with this as a required, non-optional field of type `string | null`, every existing test/fixture that builds an `EnvConfig` object literal needs `deepseekApiKey: null` added. Grep for `role: "canonical"` and `role: "local"` object literals across `server/tests/*.ts` and add `deepseekApiKey: null` to each one you find — there are several across `syncClient.test.ts`, `syncRoutes.test.ts`, `dailyDrawRoutes.test.ts`, `dailyDrawDurability.test.ts`, and possibly others; find all of them via grep, don't assume this list is exhaustive).

- [ ] **Step 8: Commit**

```bash
cd server && git add migrations/008_model_grader_daily_limit.sql src/domain/config.ts src/env.ts tests/config.test.ts
git commit -m "feat: model_grader_daily_limit config key and DEEPSEEK_API_KEY env var"
```

---

### Task 2: DeepSeek grading call and grade-write

**Files:**
- Create: `server/src/domain/modelGrading.ts`
- Test: `server/tests/modelGrading.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task's functions take `apiKey`/`db` as plain parameters — no dependency on `EnvConfig` or `config.ts`, keeping this module decoupled and easily testable).
- Produces (used by Task 3):
  ```ts
  export const RUBRIC_VERSION = "v1";

  export interface GradeCallParams {
    prompt: string;
    modelAnswer: string;
    rubric: unknown | null;
    responseText: string;
  }
  export interface GradeCallResult {
    score: number;
    feedback: string;
  }
  export async function gradeWithDeepSeek(
    apiKey: string,
    params: GradeCallParams,
    fetchImpl?: typeof fetch
  ): Promise<GradeCallResult>;

  export function writeModelGrade(
    db: DatabaseSync,
    responseId: string,
    result: GradeCallResult
  ): void;
  ```

- [ ] **Step 1: Write the failing tests**

`server/tests/modelGrading.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { gradeWithDeepSeek, writeModelGrade, RUBRIC_VERSION } from "../src/domain/modelGrading.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";
import { v4 as uuidv4 } from "uuid";

function mockFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("gradeWithDeepSeek", () => {
  it("calls the DeepSeek chat completions endpoint and parses a valid score/feedback response", async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: 0.8, feedback: "Mostly correct, missed one point." }) } }],
    });

    const result = await gradeWithDeepSeek(
      "test-key",
      { prompt: "Why is the sky blue?", modelAnswer: "Rayleigh scattering.", rubric: null, responseText: "Because of scattering." },
      fetchImpl
    );

    expect(result).toEqual({ score: 0.8, feedback: "Mostly correct, missed one point." });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    );
    const callBody = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(callBody.model).toBe("deepseek-v4-flash");
    expect(callBody.response_format).toEqual({ type: "json_object" });
  });

  it("clamps an out-of-range score into [0, 1]", async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: 1.4, feedback: "great" }) } }],
    });
    const result = await gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl);
    expect(result.score).toBe(1);

    const fetchImpl2 = mockFetch({
      choices: [{ message: { content: JSON.stringify({ score: -0.3, feedback: "bad" }) } }],
    });
    const result2 = await gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl2);
    expect(result2.score).toBe(0);
  });

  it("throws a clear error when the response body isn't valid JSON with a numeric score", async () => {
    const fetchImpl = mockFetch({ choices: [{ message: { content: "not json at all" } }] });
    await expect(
      gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl)
    ).rejects.toThrow();
  });

  it("throws when the HTTP call itself fails", async () => {
    const fetchImpl = mockFetch({}, false, 500);
    await expect(
      gradeWithDeepSeek("k", { prompt: "p", modelAnswer: "m", rubric: null, responseText: "r" }, fetchImpl)
    ).rejects.toThrow();
  });
});

describe("writeModelGrade", () => {
  it("supersedes a live self-grade and writes the model grade live", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))").run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text) VALUES (?, ?, ?, 0, 'my answer')").run(
      responseId, attemptId, q.id
    );
    const selfGradeId = uuidv4();
    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, datetime('now'))"
    ).run(selfGradeId, responseId);

    writeModelGrade(db, responseId, { score: 0.9, feedback: "Well explained." });

    const oldGrade = db.prepare("SELECT superseded_at FROM grade WHERE id = ?").get(selfGradeId) as { superseded_at: string | null };
    expect(oldGrade.superseded_at).not.toBeNull();

    const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(responseId) as any;
    expect(live.grader).toBe("model");
    expect(live.score).toBe(0.9);
    expect(live.feedback).toBe("Well explained.");
    expect(live.model_name).toBe("deepseek-v4-flash");
    expect(live.rubric_version).toBe(RUBRIC_VERSION);
  });

  it("writes a model grade even when there is no prior live grade", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))").run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text) VALUES (?, ?, ?, 0, 'my answer')").run(
      responseId, attemptId, q.id
    );

    writeModelGrade(db, responseId, { score: 0.7, feedback: "OK." });

    const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(responseId) as any;
    expect(live.grader).toBe("model");
    expect(live.score).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/modelGrading.test.ts`
Expected: FAIL — `../src/domain/modelGrading.js` does not exist.

- [ ] **Step 3: Implement `gradeWithDeepSeek`**

```ts
import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";

export const RUBRIC_VERSION = "v1";

export interface GradeCallParams {
  prompt: string;
  modelAnswer: string;
  rubric: unknown | null;
  responseText: string;
}

export interface GradeCallResult {
  score: number;
  feedback: string;
}

function buildGradingPrompt(params: GradeCallParams): string {
  const rubricText = params.rubric ? `\n\nRubric (JSON): ${JSON.stringify(params.rubric)}` : "";
  return (
    `You are grading a written answer to a quiz question. Respond ONLY with JSON of the exact shape ` +
    `{"score": <number between 0 and 1>, "feedback": "<1-3 sentence explanation>"}.\n\n` +
    `Question: ${params.prompt}\n\n` +
    `Model answer: ${params.modelAnswer}${rubricText}\n\n` +
    `Student's answer: ${params.responseText}\n\n` +
    `Score the student's answer for correctness and completeness against the model answer` +
    `${params.rubric ? " and rubric" : ""}. A score of 1.0 means fully correct, 0.0 means entirely wrong.`
  );
}

export async function gradeWithDeepSeek(
  apiKey: string,
  params: GradeCallParams,
  fetchImpl: typeof fetch = fetch
): Promise<GradeCallResult> {
  const res = await fetchImpl("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: buildGradingPrompt(params) }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API request failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek API response missing choices[0].message.content");
  }

  let parsed: { score?: unknown; feedback?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`DeepSeek API response content is not valid JSON: ${content}`);
  }

  if (typeof parsed.score !== "number" || Number.isNaN(parsed.score)) {
    throw new Error(`DeepSeek API response missing a numeric "score" field: ${content}`);
  }

  const score = Math.max(0, Math.min(1, parsed.score));
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "";

  return { score, feedback };
}
```

- [ ] **Step 4: Implement `writeModelGrade`**

Mirror `server/src/domain/attempts.ts`'s `gradeResponse` supersede transaction exactly (same `BEGIN`/`UPDATE ... SET superseded_at`/`INSERT`/`COMMIT`/`ROLLBACK` shape — read that function first, shown in full during planning):

```ts
export function writeModelGrade(db: DatabaseSync, responseId: string, result: GradeCallResult): void {
  const live = db
    .prepare("SELECT id FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { id: string } | undefined;

  const id = uuidv4();
  db.exec("BEGIN");
  try {
    if (live) {
      db.prepare("UPDATE grade SET superseded_at = datetime('now') WHERE id = ?").run(live.id);
    }
    db.prepare(
      `INSERT INTO grade (id, response_id, grader, score, feedback, model_name, rubric_version, graded_at)
       VALUES (?, ?, 'model', ?, ?, 'deepseek-v4-flash', ?, datetime('now'))`
    ).run(id, responseId, result.score, result.feedback, RUBRIC_VERSION);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
```

This function does not check whether the existing live grade's `grader` is `'self'` — it's only ever called from `sweepModelGrading` (Task 3), which already selected exactly those responses. It's safe to call even with no prior live grade (second test case).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/modelGrading.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/domain/modelGrading.ts tests/modelGrading.test.ts
git commit -m "feat: DeepSeek grading call and model-grade write"
```

---

### Task 3: The sweep

**Files:**
- Modify: `server/src/domain/modelGrading.ts`
- Modify: `server/tests/modelGrading.test.ts`

**Interfaces:**
- Consumes: `gradeWithDeepSeek`, `writeModelGrade` (Task 2, same file).
- Produces (used by Task 4):
  ```ts
  export interface SweepResult {
    graded: number;
    skipped: number;
    errors: number;
  }
  export async function sweepModelGrading(
    db: DatabaseSync,
    apiKey: string,
    dailyLimit: number,
    fetchImpl?: typeof fetch
  ): Promise<SweepResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/modelGrading.test.ts`:
```ts
import { sweepModelGrading } from "../src/domain/modelGrading.js";

function seedWrittenResponse(db: ReturnType<typeof openTestDb>, tagSlug: string, answeredAt: string): string {
  const q = insertQuestion(db, { type: "written", tags: [tagSlug] });
  const attemptId = uuidv4();
  const responseId = uuidv4();
  db.prepare(
    "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n1', 'adhoc', ?, ?)"
  ).run(attemptId, answeredAt, answeredAt);
  db.prepare(
    "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'my answer', ?)"
  ).run(responseId, attemptId, q.id, answeredAt);
  db.prepare(
    "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, ?)"
  ).run(uuidv4(), responseId, answeredAt);
  return responseId;
}

describe("sweepModelGrading", () => {
  it("makes zero calls when written_grader is self_only", async () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = '\"self_only\"' WHERE key = 'written_grader'").run();
    insertTag(db, "a");
    seedWrittenResponse(db, "a", "2026-08-20 10:00:00");

    const fetchImpl = mockFetch({ choices: [{ message: { content: JSON.stringify({ score: 1, feedback: "x" }) } }] });
    const result = await sweepModelGrading(db, "key", 20, fetchImpl);

    expect(result).toEqual({ graded: 0, skipped: 0, errors: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("grades eligible written responses when written_grader is model_when_online", async () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = '\"model_when_online\"' WHERE key = 'written_grader'").run();
    insertTag(db, "a");
    const r1 = seedWrittenResponse(db, "a", "2026-08-20 10:00:00");
    const r2 = seedWrittenResponse(db, "a", "2026-08-20 11:00:00");

    const fetchImpl = mockFetch({ choices: [{ message: { content: JSON.stringify({ score: 0.8, feedback: "good" }) } }] });
    const result = await sweepModelGrading(db, "key", 20, fetchImpl);

    expect(result).toEqual({ graded: 2, skipped: 0, errors: 0 });
    for (const rid of [r1, r2]) {
      const live = db.prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(rid) as any;
      expect(live.grader).toBe("model");
    }
  });

  it("respects the daily limit — already-graded-in-window count reduces remaining budget", async () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = '\"model_when_online\"' WHERE key = 'written_grader'").run();
    insertTag(db, "a");
    // Seed one already-model-graded response (counts against the rolling window)
    const already = seedWrittenResponse(db, "a", "2026-08-20 09:00:00");
    db.prepare("UPDATE grade SET superseded_at = datetime('now') WHERE response_id = ?").run(already);
    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, model_name, graded_at) VALUES (?, ?, 'model', 0.9, 'deepseek-v4-flash', datetime('now'))"
    ).run(uuidv4(), already);
    // Two more eligible responses
    const r1 = seedWrittenResponse(db, "a", "2026-08-20 10:00:00");
    const r2 = seedWrittenResponse(db, "a", "2026-08-20 11:00:00");

    const fetchImpl = mockFetch({ choices: [{ message: { content: JSON.stringify({ score: 0.5, feedback: "ok" }) } }] });
    // dailyLimit=1, but 1 already used this window -> 0 remaining budget -> both skipped
    const result = await sweepModelGrading(db, "key", 1, fetchImpl);

    expect(result.graded).toBe(0);
    expect(result.skipped).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    // untouched — still self-graded
    for (const rid of [r1, r2]) {
      const live = db.prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(rid) as any;
      expect(live.grader).toBe("self");
    }
  });

  it("a per-response grading failure is caught, counted, and does not stop the rest of the sweep", async () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = '\"model_when_online\"' WHERE key = 'written_grader'").run();
    insertTag(db, "a");
    const r1 = seedWrittenResponse(db, "a", "2026-08-20 10:00:00");
    const r2 = seedWrittenResponse(db, "a", "2026-08-20 11:00:00");

    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ score: 1, feedback: "x" }) } }] }) } as any;
    }) as unknown as typeof fetch;

    const result = await sweepModelGrading(db, "key", 20, fetchImpl);

    expect(result.errors).toBe(1);
    expect(result.graded).toBe(1);
    // one of r1/r2 stayed self-graded (the failed one), the other became model-graded
    const grades = [r1, r2].map(
      (rid) => (db.prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(rid) as any).grader
    );
    expect(grades.sort()).toEqual(["model", "self"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/modelGrading.test.ts`
Expected: FAIL — `sweepModelGrading` not exported.

- [ ] **Step 3: Implement `sweepModelGrading`**

```ts
export interface SweepResult {
  graded: number;
  skipped: number;
  errors: number;
}

export async function sweepModelGrading(
  db: DatabaseSync,
  apiKey: string,
  dailyLimit: number,
  fetchImpl: typeof fetch = fetch
): Promise<SweepResult> {
  const writtenGraderRow = db.prepare("SELECT value FROM config WHERE key = 'written_grader'").get() as
    | { value: string }
    | undefined;
  const writtenGrader = writtenGraderRow ? (JSON.parse(writtenGraderRow.value) as string) : "self_only";
  if (writtenGrader !== "model_when_online") {
    return { graded: 0, skipped: 0, errors: 0 };
  }

  const gradedInWindow = (
    db
      .prepare("SELECT COUNT(*) AS n FROM grade WHERE grader = 'model' AND graded_at >= datetime('now', '-1 day')")
      .get() as { n: number }
  ).n;
  const remainingBudget = Math.max(0, dailyLimit - gradedInWindow);

  // Eligible: written question, live grade is 'self'. The grade_one_live_per_response
  // unique index guarantees at most one live grade per response, so "live grade is
  // self" already implies "no live model grade" — no extra NOT EXISTS needed.
  const eligible = db
    .prepare(
      `SELECT r.id AS response_id, q.prompt, q.model_answer, q.rubric, r.response_text
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN grade g ON g.response_id = r.id AND g.superseded_at IS NULL
       WHERE q.type = 'written' AND g.grader = 'self'
       ORDER BY r.answered_at ASC`
    )
    .all() as { response_id: string; prompt: string; model_answer: string; rubric: string | null; response_text: string | null }[];

  let graded = 0;
  let errors = 0;
  const toProcess = eligible.slice(0, remainingBudget);
  const skipped = eligible.length - toProcess.length;

  for (const row of toProcess) {
    try {
      const result = await gradeWithDeepSeek(
        apiKey,
        {
          prompt: row.prompt,
          modelAnswer: row.model_answer,
          rubric: row.rubric ? JSON.parse(row.rubric) : null,
          responseText: row.response_text ?? "",
        },
        fetchImpl
      );
      writeModelGrade(db, row.response_id, result);
      graded += 1;
    } catch (err) {
      errors += 1;
      console.error(`model grading failed for response ${row.response_id}:`, err);
    }
  }

  return { graded, skipped, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/modelGrading.test.ts`
Expected: PASS, all 10 tests green (6 from Task 2 + 4 from this task).

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 6: Commit**

```bash
cd server && git add src/domain/modelGrading.ts tests/modelGrading.test.ts
git commit -m "feat: sweepModelGrading — daily-capped batch grading pass"
```

---

### Task 4: Scheduler, index.ts wiring, and `/api/status` field

**Files:**
- Create: `server/src/grading/scheduler.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/http/apiRoutes.ts`
- Test: `server/tests/apiRoutes.test.ts` (extend the existing file — check its current content/style first, per the pattern already established in the sync-protocol plan's Task 4)

**Interfaces:**
- Consumes: `sweepModelGrading` from `server/src/domain/modelGrading.js` (Task 3); `AppContext` from `server/src/http/app.js` (already exists).
- Produces:
  ```ts
  export function startModelGradingBackground(ctx: AppContext): { stop: () => void };
  ```
  `/api/status` gains `model_grades_today: number` and `model_grading_configured: boolean` fields.

- [ ] **Step 1: Write the failing test for `/api/status`'s new fields**

Read `server/tests/apiRoutes.test.ts`'s current content first (created during the sync-protocol plan) to match its exact style. Add:
```ts
describe("/api/status model grading fields", () => {
  it("reports model_grades_today and model_grading_configured", async () => {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: "real-key" };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime() });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    const body = res.json();

    expect(body.model_grading_configured).toBe(true);
    expect(body.model_grades_today).toBe(0);

    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, model_name, graded_at) VALUES ('g1', 'r1', 'model', 0.9, 'deepseek-v4-flash', datetime('now'))"
    ).run();
    const res2 = await app.inject({ method: "GET", url: "/api/status" });
    expect(res2.json().model_grades_today).toBe(1);
  });

  it("reports model_grading_configured false when DEEPSEEK_API_KEY is unset", async () => {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c2", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime() });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().model_grading_configured).toBe(false);
  });
});
```
(Note: the `INSERT INTO grade` above uses a bare literal `response_id: 'r1'` that doesn't reference a real `response` row — check whether `grade.response_id` has an enforced FK to `response(id)` in `server/migrations/001_init.sql`; if it does, adjust the test to first insert a minimal `attempt`/`response`/`question`/`tag` chain using the `insertTag`/`insertQuestion` helpers from `tests/helpers.ts`, matching the pattern already used in Task 2/3's tests, rather than a bare insert that would violate the FK.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/apiRoutes.test.ts`
Expected: FAIL — `model_grading_configured`/`model_grades_today` are `undefined`, and/or a TypeScript error on the `env` object literal missing `deepseekApiKey` (from Task 1's interface change — this test file already needs it per Task 1 Step 7's instruction; if you're the one adding it fresh here, add it now).

- [ ] **Step 3: Add the fields to `/api/status`**

In `server/src/http/apiRoutes.ts`'s `/api/status` handler (shown in full during planning — the `return { online: ..., canonical: ..., ... }` object), add two more fields computed alongside the existing `outboxDepth`/`deadOutbox` queries:
```ts
const modelGradesToday = (
  db.prepare("SELECT COUNT(*) AS n FROM grade WHERE grader = 'model' AND graded_at >= datetime('now', '-1 day')").get() as {
    n: number;
  }
).n;
```
And add to the returned object:
```ts
model_grades_today: modelGradesToday,
model_grading_configured: ctx.env.deepseekApiKey !== null,
```

- [ ] **Step 4: Implement the scheduler**

`server/src/grading/scheduler.ts`:
```ts
import { sweepModelGrading } from "../domain/modelGrading.js";
import type { AppContext } from "../http/app.js";

export function startModelGradingBackground(ctx: AppContext): { stop: () => void } {
  if (ctx.env.role !== "canonical" || !ctx.env.deepseekApiKey) {
    return { stop: () => {} };
  }

  const apiKey = ctx.env.deepseekApiKey;
  const timer = setInterval(async () => {
    const limitRow = ctx.db.prepare("SELECT value FROM config WHERE key = 'model_grader_daily_limit'").get() as
      | { value: string }
      | undefined;
    const dailyLimit = limitRow ? (JSON.parse(limitRow.value) as number) : 20;
    try {
      await sweepModelGrading(ctx.db, apiKey, dailyLimit);
    } catch (err) {
      console.error("model grading sweep failed:", err);
    }
  }, 5 * 60_000);

  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 5: Wire into `index.ts`**

In `server/src/index.ts`, after the existing `startSyncBackground` call inside the `.then()` block (import `startModelGradingBackground` from `./grading/scheduler.js`), add:
```ts
startModelGradingBackground({ db, env, node, runtime }); // no-op on local, or if DEEPSEEK_API_KEY unset
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/apiRoutes.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 8: Commit**

```bash
cd server && git add src/grading/scheduler.ts src/index.ts src/http/apiRoutes.ts tests/apiRoutes.test.ts
git commit -m "feat: canonical-only model grading scheduler and /api/status fields"
```

---

### Task 5: Frontend — Settings controls

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/Settings.tsx`
- Modify: `web/src/components/Settings.css` (only if a genuinely new small element needs a rule)

**Interfaces:**
- Consumes: `GET /api/status`'s new `model_grades_today`/`model_grading_configured` fields (Task 4), `GET/PATCH /api/config`'s existing `written_grader`/`model_grader_daily_limit` keys (Task 1).

No automated frontend test framework exists in this repo — verification is manual (dev server + Browser pane) plus `npm run build`/`npm run lint`.

- [ ] **Step 1: Extend `NodeStatus` and add nothing new to the API client for config**

In `web/src/lib/api.ts`, add the two new fields to the existing `NodeStatus` interface:
```ts
model_grades_today: number
model_grading_configured: boolean
```
`getConfig`/`setConfig` already exist and are generic (`key: string, value: unknown`) — no new client functions needed for `written_grader`/`model_grader_daily_limit`, they're read/written through the existing generic config functions exactly like `synced_attempt_retention_days` already is in `Settings.tsx`.

- [ ] **Step 2: Read the current file**

Read `web/src/components/Settings.tsx` in full (its existing `NumberSetting` component, the `.theme-toggle`/`.theme-toggle-btn` pattern around the "Mode" row, and its `config`/`setConfigState` state management) before editing, so additions match the current file exactly.

- [ ] **Step 3: Add a `written_grader` toggle**

Add a new `settings-row` (in a sensible existing section — e.g. near the other grading/attempt-related settings, or its own small "Grading" section if the file is organized into sections already; match whatever grouping convention the file already uses) with a two-button toggle mirroring the "Mode" row's `.theme-toggle`/`.theme-toggle-btn` structure:
```tsx
<div className="settings-row">
  <div className="settings-row-main">
    <div>
      <div className="settings-row-title">Written grading</div>
      <div className="settings-row-sub">
        {config
          ? config.written_grader === 'model_when_online'
            ? 'model grades written answers when online'
            : 'self-graded only'
          : 'loading…'}
      </div>
    </div>
  </div>
  <div className="theme-toggle">
    {(['self_only', 'model_when_online'] as const).map((mode) => (
      <button
        key={mode}
        className={`theme-toggle-btn${config?.written_grader === mode ? ' active' : ''}`}
        onClick={async () => {
          await setConfig('written_grader', mode)
          setConfigState((c) => (c ? { ...c, written_grader: mode } : c))
        }}
      >
        {mode === 'self_only' ? 'Self only' : 'Model when online'}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Add the daily-limit `NumberSetting` and usage indicator**

Immediately after the toggle row, add:
```tsx
<NumberSetting
  configKey="model_grader_daily_limit"
  label="Daily grading cap"
  sub="max DeepSeek calls per rolling 24h"
  suffix="grades/day"
  min={0}
  max={1000}
  value={config ? (config.model_grader_daily_limit as number) : null}
  onSaved={(key, value) => setConfigState((c) => (c ? { ...c, [key]: value } : c))}
/>

<div className="settings-row">
  <div className="settings-row-main">
    <div>
      <div className="settings-row-title">Grading usage</div>
      <div className="settings-row-sub">
        {status
          ? status.model_grading_configured
            ? `${status.model_grades_today} of ${config ? (config.model_grader_daily_limit as number) : '—'} used today`
            : 'not configured (no DEEPSEEK_API_KEY set)'
          : 'loading…'}
      </div>
    </div>
  </div>
</div>
```
This reads from the existing `status`/`config` state already fetched in this component's `useEffect` (per the earlier sync-protocol/daily-draws plans' Settings additions) — no new fetch needed.

- [ ] **Step 5: Verify build and lint**

```bash
cd web && npm run build && npm run lint
```
Expected: both pass clean (aside from the pre-existing, unrelated `usePanelWidth.ts:30` warning).

- [ ] **Step 6: Manual verification**

Start the dev server against a real running canonical instance (seed script pattern from prior plans). In the Browser pane, confirm: the "Written grading" toggle switches between the two modes and persists (reload confirms), the daily-limit field saves via the existing `NumberSetting` interaction pattern, and the usage indicator shows "not configured" when no `DEEPSEEK_API_KEY` is set in the server's environment (the realistic case for manual testing, since a real API key costs real money to test against — do not spend the user's DeepSeek budget verifying this UI; confirming the "not configured" state and the toggle/number-field mechanics is sufficient).

- [ ] **Step 7: Commit**

```bash
cd web && git add src/lib/api.ts src/components/Settings.tsx src/components/Settings.css
git commit -m "feat: Settings controls for written-grader mode and daily grading cap"
```

---

## Self-Review Notes

- **Spec coverage:** DeepSeek call + response parsing/clamping (spec's "Grading call") → Task 2. Supersede write (spec's "Writing the grade") → Task 2. Sweep with rolling-24h cap and self_only short-circuit (spec's "The sweep") → Task 3. Canonical-only timer (spec's "Trigger") → Task 4. Config/env additions (spec's "Config & env") → Task 1. `/api/status` field (spec's "HTTP surface") → Task 4. Settings toggle/cap/indicator (spec's "Frontend") → Task 5. Error handling (per-response catch-and-continue, missing-key no-op) → Tasks 3 and 4 respectively. All spec sections are covered.
- **Placeholder scan:** No TBD/TODO markers. Every task has concrete file paths, real test code, and precise implementation code.
- **Caught during self-review:** `001_init.sql` already seeded `written_grader` to `"model_when_online"`, contradicting the spec's "off by default" requirement. Task 1's migration now corrects the existing row, not just seeds the new key — this was found by actually re-checking the live migration file rather than trusting the earlier design-phase assumption that `self_only` was already the default.
- **Type consistency:** `GradeCallParams`/`GradeCallResult` (Task 2) are used identically in Task 3's `sweepModelGrading`. `SweepResult`'s three fields (`graded`/`skipped`/`errors`) are used consistently in Task 3's tests and Task 4's scheduler (which doesn't inspect the result but calls the same function signature). `EnvConfig.deepseekApiKey` (Task 1) is consumed identically in Task 4's scheduler and Task 4's `/api/status` test. Flagged explicitly in Task 1 Step 7: every existing test file's hand-built `EnvConfig` object literals need `deepseekApiKey` added, since it's a required (non-optional) field on the interface — this is the one place a later task's tests (Task 4's) would silently fail to typecheck if Task 1 missed a file, so Task 1's step calls it out as needing a thorough grep, not an assumed-complete list.
