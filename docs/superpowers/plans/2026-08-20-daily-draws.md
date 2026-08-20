# Daily Draws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement daily draws — a lazily-generated, date-cached, lineage-excluding daily question and daily quiz, generated on the canonical node and reachable from local nodes over `/sync` when online — per the behavioral rules already encoded in the schema (`daily_draw`, `daily_draw_question`, `daily_recent_lineage`) and config (`daily_*` keys), agreed during brainstorming (no separate spec doc — this plan is the record).

**Architecture:** A new domain module (`server/src/domain/dailyDraw.ts`) does canonical-side lazy generation with lineage-exclusion and fallback relaxation, reusing the existing draw-resolution machinery (`draw.ts`) extended with a lineage-exclusion filter. A new canonical-only `POST /sync/daily-draw` route (alongside the existing `/sync/pull`/`/sync/push`) lets local nodes fetch today's resolved draw over the network — the response reuses the bank-content shape from the sync protocol (tags + full question rows) so a local node can pull in daily questions that may be outside any slice it currently holds. A local node mirrors the returned `daily_draw`/`daily_draw_question` rows and creates its attempt normally. Frontend: two new cards on Home, greyed out with the offline reason when unavailable, reusing the existing Take/Review flow unchanged.

**Tech Stack:** Node's built-in `Intl.DateTimeFormat` for timezone-aware date computation (no new dependency), the existing Fastify/`node:sqlite`/Vitest stack.

## Global Constraints

- No new npm dependencies.
- `draw_date` is computed from `config.daily_timezone` (default `America/Los_Angeles`), never UTC or the client's timezone.
- Exclusion is by **lineage**, not question ID — a re-versioned question must not sneak back into today's draw just because it got a fresh UUID (this is exactly what `daily_recent_lineage` already joins on).
- Generation is lazy (first request for a date generates it) and race-safe (`UNIQUE (draw_date, kind)` — a losing concurrent insert re-reads the winner's row, never errors).
- The daily question is drawn first; its lineage is excluded from the same day's daily quiz.
- Fallback relaxation order: `daily_exclusion_days` → `1` → `0`, first level with enough eligible questions wins; if still short after full relaxation, return a short draw and set `exclusion_relaxed` to the level actually used.
- A local node only ever fetches; it never generates a daily draw locally, and never re-resolves once fetched.
- Canonical nodes and local nodes share the same `/api/attempts` request shape (`daily_kind: 'question' | 'quiz'`) — only the internal handling differs by role.
- `server` test suite (`npx vitest run` from `server/`) and `web` build/lint (`npm run build && npm run lint` from `web/`) must both pass clean at the end of every task (one pre-existing, unrelated warning at `web/src/hooks/usePanelWidth.ts:30` is allowed to remain).

---

### Task 1: Lineage exclusion in the draw resolver

**Files:**
- Modify: `server/src/domain/draw.ts`
- Test: `server/tests/draw.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 2):
  ```ts
  export interface EligibilityParams {
    tag_query?: TagQuery;
    difficulty_min?: number | null;
    difficulty_max?: number | null;
    calculator_policy?: CalculatorFilter;
    exclude_lineage_ids?: string[]; // NEW
  }
  ```
  `getEligibleQuestions`/`countEligible` (unchanged signatures) now honor this field when present and non-empty.

- [ ] **Step 1: Write the failing test**

Read `server/tests/draw.test.ts`'s existing structure first (it already has `insertTag`/`insertQuestion` helper usage patterns from `tests/helpers.ts`) to match its style. Add:

```ts
describe("exclude_lineage_ids", () => {
  it("excludes questions by lineage, not by version id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });

    const withoutExclusion = getEligibleQuestions(db, { tag_query: { all: ["a"] } });
    expect(withoutExclusion.map((q) => q.id).sort()).toEqual([q1.id, q2.id].sort());

    const withExclusion = getEligibleQuestions(db, {
      tag_query: { all: ["a"] },
      exclude_lineage_ids: [q1.lineage_id],
    });
    expect(withExclusion.map((q) => q.id)).toEqual([q2.id]);

    expect(countEligible(db, { tag_query: { all: ["a"] }, exclude_lineage_ids: [q1.lineage_id] })).toBe(1);
  });

  it("an empty exclude_lineage_ids array excludes nothing", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });
    expect(countEligible(db, { tag_query: { all: ["a"] }, exclude_lineage_ids: [] })).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/draw.test.ts`
Expected: FAIL — `q2` is still excluded incorrectly, or a TypeScript error on the unrecognized field, since `exclude_lineage_ids` isn't wired into the WHERE clause yet.

- [ ] **Step 3: Implement**

In `buildEligibilityClause` (`server/src/domain/draw.ts`), after the existing `calculator_policy` clause and before the `tag_query` clause, add:

```ts
if (params.exclude_lineage_ids && params.exclude_lineage_ids.length > 0) {
  clauses.push(`q.lineage_id NOT IN (${params.exclude_lineage_ids.map(() => "?").join(",")})`);
  args.push(...params.exclude_lineage_ids);
}
```

Add `exclude_lineage_ids?: string[];` to the `EligibilityParams` interface.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/draw.test.ts`
Expected: PASS, all tests in the file green (existing tests untouched since the field is optional).

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 6: Commit**

```bash
cd server && git add src/domain/draw.ts tests/draw.test.ts
git commit -m "feat: add lineage exclusion to the draw eligibility resolver"
```

---

### Task 2: Canonical-side daily draw generation (`resolveDailyDraw`)

**Files:**
- Create: `server/src/domain/dailyDraw.ts`
- Test: `server/tests/dailyDraw.test.ts`

**Interfaces:**
- Consumes: `getEligibleQuestions`, `EligibilityParams`, `weightedSampleWithoutReplacement`, `computeWeakWeights` from `draw.ts` (all already exported); `getConfig` from `config.ts` is NOT used directly — read individual config keys via the same `db.prepare("SELECT value FROM config WHERE key = ?")` pattern already used in `attempts.ts`'s `abandonAfterHours` and `draw.ts`'s `getDefaultWeighting`.
- Produces (used by Task 4):
  ```ts
  export interface ResolvedDailyQuestion {
    id: string;
    lineage_id: string;
    type: "mc" | "written";
  }

  export interface ResolvedDailyDraw {
    daily_draw_id: string;
    draw_date: string;
    kind: "question" | "quiz";
    questions: ResolvedDailyQuestion[];
    exclusion_relaxed: number | null; // days actually used, or null if a cached (already-generated) draw was read, not freshly generated
    short_draw: boolean;
    requested: number;
    returned: number;
  }

  export function computeDrawDate(db: DatabaseSync, now?: Date): string;
  export function resolveDailyDraw(db: DatabaseSync, kind: "question" | "quiz", now?: Date, rng?: () => number): ResolvedDailyDraw;
  ```

- [ ] **Step 1: Write the failing tests**

`server/tests/dailyDraw.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeDrawDate, resolveDailyDraw } from "../src/domain/dailyDraw.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("computeDrawDate", () => {
  it("computes YYYY-MM-DD in config.daily_timezone, not UTC", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_timezone'").run(JSON.stringify("America/Los_Angeles"));
    // 2026-01-01 06:00 UTC is still 2025-12-31 22:00 in America/Los_Angeles (PST, UTC-8)
    const date = computeDrawDate(db, new Date("2026-01-01T06:00:00Z"));
    expect(date).toBe("2025-12-31");
  });
});

describe("resolveDailyDraw", () => {
  it("generates a daily question lazily and caches it for the same date", () => {
    const db = openTestDb();
    insertTag(db, "math");
    for (let i = 0; i < 5; i++) insertQuestion(db, { tags: ["math"] });

    const first = resolveDailyDraw(db, "question", new Date("2026-08-20T12:00:00Z"));
    expect(first.questions.length).toBe(1);
    expect(first.kind).toBe("question");
    expect(first.exclusion_relaxed).not.toBeNull(); // freshly generated

    const second = resolveDailyDraw(db, "question", new Date("2026-08-20T18:00:00Z")); // same date, different hour
    expect(second.daily_draw_id).toBe(first.daily_draw_id);
    expect(second.questions).toEqual(first.questions); // cached, not re-drawn
  });

  it("excludes lineages drawn within daily_exclusion_days, relaxing when the pool is too small", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_exclusion_days'").run(JSON.stringify(2));
    insertTag(db, "math");
    const only = insertQuestion(db, { tags: ["math"] }); // exactly one question in the whole bank

    const day1 = resolveDailyDraw(db, "question", new Date("2026-08-18T12:00:00Z"));
    expect(day1.questions[0].id).toBe(only.id);

    // Next day: the only question was drawn yesterday (within the 2-day window), so
    // strict exclusion leaves zero eligible — relaxation must kick in and still return it.
    const day2 = resolveDailyDraw(db, "question", new Date("2026-08-19T12:00:00Z"));
    expect(day2.questions[0].id).toBe(only.id);
    expect(day2.exclusion_relaxed).toBe(0); // fully relaxed to reuse it
    expect(day2.short_draw).toBe(false); // exactly enough once relaxed
  });

  it("a re-versioned question's new id is still excluded by its shared lineage", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_exclusion_days'").run(JSON.stringify(2));
    insertTag(db, "math");
    const q1 = insertQuestion(db, { tags: ["math"] });
    const q2 = insertQuestion(db, { tags: ["math"] }); // second, distinct lineage

    const day1 = resolveDailyDraw(db, "question", new Date("2026-08-18T12:00:00Z"));
    expect(day1.questions[0].id).toBe(q1.id);

    // Simulate q1 being edited (re-versioned): new id, SAME lineage_id, old row retired.
    db.exec("BEGIN");
    db.prepare("UPDATE question SET retired_at = datetime('now') WHERE id = ?").run(q1.id);
    const newVersionId = "q1-v2";
    db.prepare(
      `INSERT INTO question (id, lineage_id, version, type, prompt, difficulty, calculator_policy)
       VALUES (?, ?, 2, 'mc', 'edited prompt', 3, 'n_a')`
    ).run(newVersionId, q1.lineage_id);
    db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, 'math')").run(newVersionId);
    db.prepare("INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES ('c1', ?, 'a', 1, 0)").run(newVersionId);
    db.exec("COMMIT");

    const day2 = resolveDailyDraw(db, "question", new Date("2026-08-19T12:00:00Z"));
    // Only q2 is truly unexcluded (q1's lineage was drawn yesterday, and its new
    // version shares that lineage) — day2 must draw q2, not newVersionId.
    expect(day2.questions[0].id).toBe(q2.id);
  });

  it("drawing the daily quiz excludes the same day's already-drawn daily question's lineage", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const q1 = insertQuestion(db, { tags: ["math"] });
    const q2 = insertQuestion(db, { tags: ["math"] });
    const now = new Date("2026-08-20T12:00:00Z");

    const dailyQuestion = resolveDailyDraw(db, "question", now);
    const dailyQuiz = resolveDailyDraw(db, "quiz", now);

    expect(dailyQuiz.questions.map((q) => q.id)).not.toContain(dailyQuestion.questions[0].id);
    expect(dailyQuiz.questions.map((q) => q.id)).toContain(
      dailyQuestion.questions[0].id === q1.id ? q2.id : q1.id
    );
  });

  it("returns a short draw with exclusion_relaxed 0 when the bank genuinely can't fill the quiz", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_quiz_size'").run(JSON.stringify(10));
    insertTag(db, "math");
    insertQuestion(db, { tags: ["math"] }); // only 1 question, quiz wants 10

    const quiz = resolveDailyDraw(db, "quiz", new Date("2026-08-20T12:00:00Z"));
    expect(quiz.short_draw).toBe(true);
    expect(quiz.exclusion_relaxed).toBe(0);
    expect(quiz.requested).toBe(10);
    expect(quiz.returned).toBeLessThanOrEqual(1); // minus whatever the daily question already took
  });

  it("daily_tag_filter restricts both kinds to a subtree when set", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "history");
    const mathQ = insertQuestion(db, { tags: ["math"] });
    insertQuestion(db, { tags: ["history"] });
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_tag_filter'").run(JSON.stringify({ all: ["math"] }));

    const daily = resolveDailyDraw(db, "question", new Date("2026-08-20T12:00:00Z"));
    expect(daily.questions[0].id).toBe(mathQ.id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/dailyDraw.test.ts`
Expected: FAIL — `../src/domain/dailyDraw.js` does not exist.

- [ ] **Step 3: Implement `computeDrawDate`**

```ts
function configString(db: DatabaseSync, key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string) : fallback;
}

function configNumber(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as number) : fallback;
}

export function computeDrawDate(db: DatabaseSync, now: Date = new Date()): string {
  const timezone = configString(db, "daily_timezone", "America/Los_Angeles");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD directly, no manual reassembly needed.
  return formatter.format(now);
}
```

- [ ] **Step 4: Implement `resolveDailyDraw`**

```ts
import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { TagQuery } from "./tagQuery.js";
import { getEligibleQuestions, weightedSampleWithoutReplacement, computeWeakWeights, type EligibilityParams } from "./draw.js";

function recentExcludedLineages(db: DatabaseSync, drawDate: string, days: number): string[] {
  if (days <= 0) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT lineage_id FROM daily_recent_lineage
       WHERE draw_date < ? AND draw_date >= date(?, '-' || ? || ' days')`
    )
    .all(drawDate, drawDate, days) as { lineage_id: string }[];
  return rows.map((r) => r.lineage_id);
}

function drawWithRelaxation(
  db: DatabaseSync,
  drawDate: string,
  count: number,
  weighting: "random" | "weak_weighted",
  tagFilter: TagQuery | null,
  maxExclusionDays: number,
  extraExcludeLineageIds: string[],
  rng: () => number
): { questions: ReturnType<typeof getEligibleQuestions>; relaxedTo: number; short: boolean } {
  // Only ever relax DOWNWARD from the configured max — [maxExclusionDays, 1, 0]
  // deduped and sorted descending, but never including a level above the
  // configured value (e.g. if daily_exclusion_days is itself 0, the level list
  // must be just [0], not [1, 0], which would relax "up" past the config).
  const levels = [...new Set([maxExclusionDays, 1, 0].filter((d) => d <= maxExclusionDays))]
    .filter((d) => d >= 0)
    .sort((a, b) => b - a);

  for (const days of levels) {
    const excluded = [...recentExcludedLineages(db, drawDate, days), ...extraExcludeLineageIds];
    const params: EligibilityParams = {
      tag_query: tagFilter ?? undefined,
      calculator_policy: "any",
      exclude_lineage_ids: excluded,
    };
    const pool = getEligibleQuestions(db, params);
    if (pool.length >= count || days === 0) {
      const weights = weighting === "weak_weighted" ? computeWeakWeights(db, pool) : pool.map(() => 1);
      const questions = weightedSampleWithoutReplacement(pool, weights, count, rng);
      return { questions, relaxedTo: days, short: questions.length < count };
    }
  }
  // Unreachable — days=0 is always in `levels` and always returns above.
  throw new Error("drawWithRelaxation: no relaxation level satisfied");
}

export interface ResolvedDailyQuestion {
  id: string;
  lineage_id: string;
  type: "mc" | "written";
}

export interface ResolvedDailyDraw {
  daily_draw_id: string;
  draw_date: string;
  kind: "question" | "quiz";
  questions: ResolvedDailyQuestion[];
  exclusion_relaxed: number | null;
  short_draw: boolean;
  requested: number;
  returned: number;
}

export function resolveDailyDraw(
  db: DatabaseSync,
  kind: "question" | "quiz",
  now: Date = new Date(),
  rng: () => number = Math.random
): ResolvedDailyDraw {
  const drawDate = computeDrawDate(db, now);

  const existing = db
    .prepare("SELECT id FROM daily_draw WHERE draw_date = ? AND kind = ?")
    .get(drawDate, kind) as { id: string } | undefined;

  if (existing) {
    const rows = db
      .prepare(
        `SELECT q.id, q.lineage_id, q.type FROM daily_draw_question dq
         JOIN question q ON q.id = dq.question_id
         WHERE dq.daily_draw_id = ? ORDER BY dq.ordinal`
      )
      .all(existing.id) as ResolvedDailyQuestion[];
    return {
      daily_draw_id: existing.id,
      draw_date: drawDate,
      kind,
      questions: rows,
      exclusion_relaxed: null, // not known for a cached read — only meaningful at generation time
      short_draw: false,
      requested: rows.length,
      returned: rows.length,
    };
  }

  const tagFilterRaw = db.prepare("SELECT value FROM config WHERE key = 'daily_tag_filter'").get() as
    | { value: string }
    | undefined;
  const tagFilter = tagFilterRaw ? (JSON.parse(tagFilterRaw.value) as TagQuery | null) : null;
  const maxExclusionDays = configNumber(db, "daily_exclusion_days", 2);

  let extraExclude: string[] = [];
  if (kind === "quiz") {
    // The daily question is drawn first; its lineage is excluded from the quiz.
    // resolveDailyDraw is idempotent/cached, so calling it here either generates
    // today's question draw (first call of the day) or reads the cached one.
    const questionDraw = resolveDailyDraw(db, "question", now, rng);
    extraExclude = questionDraw.questions.map((q) => q.lineage_id);
  }

  const count = kind === "question" ? 1 : configNumber(db, "daily_quiz_size", 10);
  const weighting =
    kind === "question"
      ? (configString(db, "daily_question_weighting", "weak_weighted") as "random" | "weak_weighted")
      : (configString(db, "daily_quiz_weighting", "random") as "random" | "weak_weighted");

  const { questions, relaxedTo, short } = drawWithRelaxation(
    db,
    drawDate,
    count,
    weighting,
    tagFilter,
    maxExclusionDays,
    extraExclude,
    rng
  );

  const id = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, ?) ON CONFLICT (draw_date, kind) DO NOTHING").run(
      id,
      drawDate,
      kind
    );
    const winner = db.prepare("SELECT id FROM daily_draw WHERE draw_date = ? AND kind = ?").get(drawDate, kind) as {
      id: string;
    };
    if (winner.id === id) {
      // We won the race — insert the question set. A concurrent loser (winner.id !== id)
      // skips this and falls through to re-read the winner's already-inserted rows below.
      const insertQ = db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, ?)");
      questions.forEach((q, i) => insertQ.run(winner.id, q.id, i));
    }
    db.exec("COMMIT");

    const finalRows = db
      .prepare(
        `SELECT q.id, q.lineage_id, q.type FROM daily_draw_question dq
         JOIN question q ON q.id = dq.question_id
         WHERE dq.daily_draw_id = ? ORDER BY dq.ordinal`
      )
      .all(winner.id) as ResolvedDailyQuestion[];

    return {
      daily_draw_id: winner.id,
      draw_date: drawDate,
      kind,
      questions: finalRows,
      exclusion_relaxed: winner.id === id ? relaxedTo : null,
      short_draw: winner.id === id ? short : false,
      requested: count,
      returned: finalRows.length,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/dailyDraw.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/domain/dailyDraw.ts tests/dailyDraw.test.ts
git commit -m "feat: canonical-side daily draw generation with lineage exclusion and relaxation"
```

---

### Task 3: `createDailyAttempt` domain function

**Files:**
- Modify: `server/src/domain/attempts.ts`
- Test: `server/tests/attempts.test.ts`

**Interfaces:**
- Consumes: `ResolvedDailyQuestion` shape from `dailyDraw.ts` (Task 2) — this task does NOT import `dailyDraw.ts` (avoids a dependency the domain layer doesn't need); it accepts a plain question list matching that shape structurally.
- Produces (used by Task 4):
  ```ts
  export interface CreateDailyAttemptInput {
    node_id: string;
    kind: "daily_question" | "daily_quiz";
    daily_draw_id: string;
    questions: { id: string; lineage_id: string; type: "mc" | "written" }[];
  }

  export function createDailyAttempt(
    db: DatabaseSync,
    input: CreateDailyAttemptInput,
    role?: "canonical" | "local"
  ): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] };
  ```

- [ ] **Step 1: Write the failing test**

Read the existing `createAttempt` tests in `server/tests/attempts.test.ts` first to match style. Add:

```ts
import { createDailyAttempt } from "../src/domain/attempts.js";

describe("createDailyAttempt", () => {
  it("creates an attempt with the exact given question set, in order, referencing daily_draw_id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"], type: "written" });
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES ('dd1', '2026-08-20', 'quiz')").run();

    const result = createDailyAttempt(db, {
      node_id: "n1",
      kind: "daily_quiz",
      daily_draw_id: "dd1",
      questions: [
        { id: q1.id, lineage_id: q1.lineage_id, type: "mc" },
        { id: q2.id, lineage_id: q2.lineage_id, type: "written" },
      ],
    });

    const attempt = db.prepare("SELECT source, daily_draw_id, template_id FROM attempt WHERE id = ?").get(result.attempt_id) as any;
    expect(attempt.source).toBe("daily_quiz");
    expect(attempt.daily_draw_id).toBe("dd1");
    expect(attempt.template_id).toBeNull();

    const responses = db.prepare("SELECT question_id, ordinal FROM response WHERE attempt_id = ? ORDER BY ordinal").all(result.attempt_id) as any[];
    expect(responses.map((r) => r.question_id)).toEqual([q1.id, q2.id]);
  });

  it("does not enqueue an outbox row itself (only submit does, per the existing attempt lifecycle)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES ('dd2', '2026-08-20', 'question')").run();

    createDailyAttempt(db, {
      node_id: "n1", kind: "daily_question", daily_draw_id: "dd2",
      questions: [{ id: q1.id, lineage_id: q1.lineage_id, type: "mc" }],
    }, "local");

    const outboxCount = (db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(outboxCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/attempts.test.ts`
Expected: FAIL — `createDailyAttempt` is not exported.

- [ ] **Step 3: Implement**

In `server/src/domain/attempts.ts`, near `createAttempt` (reuse the same transaction pattern, and the same `insertResponse` prepared-statement idiom already in `createAttempt`):

```ts
export interface CreateDailyAttemptInput {
  node_id: string;
  kind: "daily_question" | "daily_quiz";
  daily_draw_id: string;
  questions: { id: string; lineage_id: string; type: "mc" | "written" }[];
}

export function createDailyAttempt(
  db: DatabaseSync,
  input: CreateDailyAttemptInput,
  role: "canonical" | "local" = "canonical"
): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] } {
  sweepAbandonedAttempts(db);

  const attemptId = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO attempt (id, node_id, source, daily_draw_id, started_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(attemptId, input.node_id, input.kind, input.daily_draw_id);

    const insertResponse = db.prepare(
      "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
    );
    input.questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { attempt_id: attemptId, questions: input.questions };
}
```

`role` is accepted (matching `createAttempt`'s existing signature convention, so Task 4's call sites stay consistent) but unused here — same as `createAttempt`'s own `role` parameter, which exists only for call-site consistency (outbox population happens on submit, not create; see the existing comment pattern in this file if present, or add one: `// role kept for call-site consistency with createAttempt; outbox population happens on submit, not create.`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/attempts.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 6: Commit**

```bash
cd server && git add src/domain/attempts.ts tests/attempts.test.ts
git commit -m "feat: createDailyAttempt — materialize a local attempt from a resolved daily draw"
```

---

### Task 4: HTTP wiring — `/sync/daily-draw`, local-node proxy, `POST /api/attempts` daily path

**Files:**
- Modify: `server/src/domain/sync.ts` (export two small new helpers, reusing existing internals)
- Modify: `server/src/http/app.ts`
- Modify: `server/src/sync/client.ts`
- Modify: `server/src/http/apiRoutes.ts`
- Test: `server/tests/dailyDrawRoutes.test.ts` (new)

**Interfaces:**
- Consumes: `resolveDailyDraw`, `ResolvedDailyDraw` from `dailyDraw.ts` (Task 2); `createDailyAttempt` from `attempts.ts` (Task 3); `QUESTION_COLUMNS`, the existing tag/question upsert logic in `sync.ts` (Task's own refactor, see Step 1).
- Produces:
  ```ts
  // sync.ts additions
  export function buildQuestionPayloads(db: DatabaseSync, questionIds: string[]): Record<string, unknown>[];
  export function upsertBankContent(
    db: DatabaseSync,
    tags: PullResponse["tags"],
    questions: Record<string, unknown>[]
  ): { tagsApplied: number; questionsApplied: number };

  // app.ts: new canonical-only route POST /sync/daily-draw, body { kind: "question" | "quiz" }
  //   -> DailyDrawSyncResponse (see client.ts below)

  // client.ts additions
  export interface DailyDrawSyncResponse {
    protocol_version: number;
    daily_draw_id: string;
    draw_date: string;
    kind: "question" | "quiz";
    tags: PullResponse["tags"];
    questions: Record<string, unknown>[];
    question_order: string[]; // question ids, in draw order
    exclusion_relaxed: number | null;
    short_draw: boolean;
    requested: number;
    returned: number;
  }
  export async function fetchAndApplyDailyDraw(
    ctx: AppContext,
    kind: "question" | "quiz"
  ): Promise<{ daily_draw_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] }>;
  ```

- [ ] **Step 1: Refactor `sync.ts` — extract `buildQuestionPayloads` and `upsertBankContent`**

First, read the current `buildPullResponse` and `applyPullResponse` in `server/src/domain/sync.ts` in full (they were shown in detail during planning — the per-question tag/choice attachment loop inside `buildPullResponse`, and the tag/question upsert loop inside `applyPullResponse`). This step extracts two pieces of that existing logic into standalone exported functions WITHOUT changing `buildPullResponse`'s or `applyPullResponse`'s external behavior — it's a pure refactor, verified by re-running the full existing `sync.test.ts` suite unchanged at the end.

Add `export` to the existing `QUESTION_COLUMNS` constant (currently module-private).

Add a new function `buildQuestionPayloads(db, questionIds)`: given a list of question IDs (not tag slices — this is the piece `buildPullResponse`'s tag-scoped query doesn't offer), select those exact rows (`WHERE id IN (...)`) with the same `QUESTION_COLUMNS` shape, and attach `tags`/`choices` the same way `buildPullResponse`'s existing per-question loop already does (reuse the same `tagsByQuestion`/`choicesByQuestion` prepared-statement pattern — you may need to move those two prepared statements to also be usable from this new function, e.g. by preparing them inline in `buildQuestionPayloads` rather than only inside `buildPullResponse`'s body).

Add a new function `upsertBankContent(db, tags, questions)`: extract the existing tag-upsert loop and question-upsert loop (including the `question_tag`/`choice` delete-then-reinsert, and the document-asset-nulling logic already in `applyPullResponse`) out of `applyPullResponse`'s body into this standalone function, returning `{ tagsApplied, questionsApplied }`. Then change `applyPullResponse` to call `upsertBankContent(db, response.tags, response.questions)` in place of its old inline loops, using the returned counts for `tagsApplied`/`questionsApplied` in its own return value. **Do not wrap `upsertBankContent` in its own transaction** — `applyPullResponse` already wraps its whole body in one `BEGIN`/`COMMIT`, and this function needs to run inside that same transaction (and, in Task 4's later steps, inside a different caller's own transaction) — transaction ownership stays with the caller.

After this refactor, run the existing suite to confirm zero behavior change:

Run: `cd server && npx vitest run tests/sync.test.ts tests/syncRoutes.test.ts tests/syncClient.test.ts tests/syncDurability.test.ts`
Expected: PASS, same pass count as before this step (this refactor must not change any existing test's outcome).

Commit this refactor step separately before continuing, so it's independently reviewable:
```bash
cd server && git add src/domain/sync.ts
git commit -m "refactor: extract buildQuestionPayloads/upsertBankContent from sync.ts for reuse by daily draws"
```

- [ ] **Step 2: Write the failing route test**

`server/tests/dailyDrawRoutes.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("/sync/daily-draw and POST /api/attempts (daily)", () => {
  let canonicalApp: FastifyInstance;
  let canonicalUrl: string;
  let canonicalDb: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    canonicalDb = openTestDb();
    insertTag(canonicalDb, "phys");
    for (let i = 0; i < 3; i++) insertQuestion(canonicalDb, { tags: ["phys"] });
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t" };
    const node = bootstrapNode(canonicalDb, env);
    canonicalApp = buildApp({ db: canonicalDb, env, node, runtime: createSyncRuntime() });
    canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => { await canonicalApp.close(); });

  it("canonical: POST /api/attempts with daily_kind generates and creates directly", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt_id).toBeTruthy();
    expect(body.questions.length).toBe(1);
  });

  it("canonical: /sync/daily-draw returns bank content for the resolved questions", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/sync/daily-draw", payload: { kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.daily_draw_id).toBeTruthy();
    expect(body.questions.length).toBe(1);
    expect(body.tags.some((t: any) => t.slug === "phys")).toBe(true);
  });

  it("local, online: POST /api/attempts with daily_kind proxies to canonical and materializes a local attempt", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true; // simulate an already-established online state
    const localApp = buildApp({ db: localDb, env, node, runtime });

    const res = await localApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt_id).toBeTruthy();

    // The question that came down must actually exist locally now (mirrored via
    // upsertBankContent), and the local daily_draw/daily_draw_question rows must
    // exist too (the response's question_id FK depends on it).
    const localQuestion = localDb.prepare("SELECT id FROM question WHERE id = ?").get(body.questions[0].id);
    expect(localQuestion).toBeTruthy();
    const localDraw = localDb.prepare("SELECT id FROM daily_draw WHERE id = ?").get(
      (localDb.prepare("SELECT daily_draw_id FROM attempt WHERE id = ?").get(body.attempt_id) as any).daily_draw_id
    );
    expect(localDraw).toBeTruthy();

    await localApp.close();
  });

  it("local, offline: POST /api/attempts with daily_kind 503s with daily_requires_connection", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l2", port: 0, dbPath: ":memory:",
                  remoteUrl: "http://127.0.0.1:1", uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = false;
    const localApp = buildApp({ db: localDb, env, node, runtime });

    const res = await localApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("daily_requires_connection");

    await localApp.close();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && npx vitest run tests/dailyDrawRoutes.test.ts`
Expected: FAIL — none of the new routes/wiring exist yet.

- [ ] **Step 4: Implement the canonical `/sync/daily-draw` route**

In `server/src/http/app.ts`, inside the existing `if (ctx.env.role === "canonical")` block (alongside `/sync/health`, `/sync/pull`, `/sync/push`), add:

```ts
app.post("/sync/daily-draw", async (request) => {
  const { kind } = request.body as { kind: "question" | "quiz" };
  const resolved = resolveDailyDraw(ctx.db, kind);
  const questions = buildQuestionPayloads(ctx.db, resolved.questions.map((q) => q.id));
  const usedTagSlugs = [...new Set(questions.flatMap((q) => (q as { tags: string[] }).tags))];
  const tagMatch = usedTagSlugs.length > 0
    ? ctx.db.prepare(`SELECT slug, label, parent_slug, description, retired_at FROM tag WHERE slug IN (${usedTagSlugs.map(() => "?").join(",")})`).all(...usedTagSlugs)
    : [];
  return {
    protocol_version: PROTOCOL_VERSION,
    daily_draw_id: resolved.daily_draw_id,
    draw_date: resolved.draw_date,
    kind: resolved.kind,
    tags: tagMatch,
    questions,
    question_order: resolved.questions.map((q) => q.id),
    exclusion_relaxed: resolved.exclusion_relaxed,
    short_draw: resolved.short_draw,
    requested: resolved.requested,
    returned: resolved.returned,
  };
});
```

Import `resolveDailyDraw` from `../domain/dailyDraw.js` and `buildQuestionPayloads` from `../domain/sync.js` at the top of `app.ts`.

- [ ] **Step 5: Implement `fetchAndApplyDailyDraw` in `sync/client.ts`**

```ts
export interface DailyDrawSyncResponse {
  protocol_version: number;
  daily_draw_id: string;
  draw_date: string;
  kind: "question" | "quiz";
  tags: PullResponse["tags"];
  questions: Record<string, unknown>[];
  question_order: string[];
  exclusion_relaxed: number | null;
  short_draw: boolean;
  requested: number;
  returned: number;
}

export async function fetchAndApplyDailyDraw(
  ctx: AppContext,
  kind: "question" | "quiz"
): Promise<{ daily_draw_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] }> {
  if (!ctx.env.remoteUrl) throw new Error("no remote_url configured");
  const res = await fetch(`${ctx.env.remoteUrl}/sync/daily-draw`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`daily-draw fetch failed: HTTP ${res.status}`);
  const payload = (await res.json()) as DailyDrawSyncResponse;

  const db = ctx.db;
  db.exec("BEGIN");
  try {
    upsertBankContent(db, payload.tags, payload.questions);
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING").run(
      payload.daily_draw_id, payload.draw_date, payload.kind
    );
    db.prepare("DELETE FROM daily_draw_question WHERE daily_draw_id = ?").run(payload.daily_draw_id);
    const insertQ = db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, ?)");
    payload.question_order.forEach((qid, i) => insertQ.run(payload.daily_draw_id, qid, i));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const questionById = new Map((payload.questions as { id: string; lineage_id: string; type: "mc" | "written" }[]).map((q) => [q.id, q]));
  const questions = payload.question_order.map((qid) => {
    const q = questionById.get(qid);
    if (!q) throw new Error(`daily-draw response missing question ${qid} in its own questions array`);
    return { id: q.id, lineage_id: q.lineage_id, type: q.type };
  });

  return { daily_draw_id: payload.daily_draw_id, questions };
}
```

Import `upsertBankContent`, `PullResponse` (type-only) from `../domain/sync.js` at the top of `client.ts`.

- [ ] **Step 6: Wire `POST /api/attempts`'s daily path in `apiRoutes.ts`**

Replace the existing block:
```ts
if (body.daily_kind) {
  reply.code(503).send({ reason: "daily_requires_connection" });
  return;
}
```
with:
```ts
if (body.daily_kind) {
  const kind = body.daily_kind as "question" | "quiz";
  try {
    if (ctx.env.role === "canonical") {
      const resolved = resolveDailyDraw(db, kind);
      const result = createDailyAttempt(
        db,
        { node_id: ctx.node.id, kind: kind === "question" ? "daily_question" : "daily_quiz",
          daily_draw_id: resolved.daily_draw_id, questions: resolved.questions },
        ctx.env.role
      );
      return { attempt_id: result.attempt_id, questions: result.questions,
                short_draw: resolved.short_draw, requested: resolved.requested, returned: resolved.returned };
    }
    if (!ctx.runtime.online) {
      reply.code(503).send({ reason: "daily_requires_connection" });
      return;
    }
    const fetched = await fetchAndApplyDailyDraw(ctx, kind);
    const result = createDailyAttempt(
      db,
      { node_id: ctx.node.id, kind: kind === "question" ? "daily_question" : "daily_quiz",
        daily_draw_id: fetched.daily_draw_id, questions: fetched.questions },
      ctx.env.role
    );
    return { attempt_id: result.attempt_id, questions: result.questions };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("daily-draw fetch failed")) {
      reply.code(503).send({ reason: "daily_requires_connection" });
      return;
    }
    sendDomainError(reply, err);
    return;
  }
}
```

Import `resolveDailyDraw` from `../domain/dailyDraw.js`, `createDailyAttempt` from `../domain/attempts.js` (add to the existing import list), and `fetchAndApplyDailyDraw` from `../sync/client.js` (add to the existing import list) at the top of `apiRoutes.ts`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && npx vitest run tests/dailyDrawRoutes.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 8: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS, everything green.

- [ ] **Step 9: Commit**

```bash
cd server && git add src/http/app.ts src/sync/client.ts src/http/apiRoutes.ts tests/dailyDrawRoutes.test.ts
git commit -m "feat: wire /sync/daily-draw and the local-node daily-draw proxy path"
```

---

### Task 5: Frontend — Home daily cards

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/Home.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Home.css` (only if a genuinely new small element needs a rule — reuse existing card/button classes wherever possible)

**Interfaces:**
- Consumes: `POST /api/attempts { daily_kind }` (Task 4), `GET /api/status` (`NodeStatus.online`, already exists).

No automated frontend test framework exists in this repo — verification is manual (dev server + Browser pane) plus `npm run build`/`npm run lint`.

- [ ] **Step 1: Add the API client function**

In `web/src/lib/api.ts`, near `createAttempt`:
```ts
export async function createDailyAttempt(kind: 'question' | 'quiz'): Promise<CreateAttemptResult> {
  const res = await fetch('/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_kind: kind }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || body.error || `POST /api/attempts ${res.status}`)
  }
  return res.json()
}
```

- [ ] **Step 2: Wire `App.tsx`**

Read `web/src/App.tsx` in full (it's short — shown during planning) before editing. Add a `startDaily` function mirroring `startQuiz`'s exact shape:
```ts
async function startDaily(kind: 'question' | 'quiz') {
  setStarting(true)
  setStartError(null)
  try {
    const created = await createDailyAttempt(kind)
    const detail = await getAttempt(created.attempt_id)
    setAttempt(detail)
    setPage('take')
  } catch (err) {
    setStartError(err instanceof Error ? err.message : String(err))
  } finally {
    setStarting(false)
  }
}
```
Import `createDailyAttempt` from `./lib/api` (add to the existing import line). Pass `onStartDaily={startDaily}` as a new prop to every `<Home ... />` usage (there are two — the `page === 'home'` branch and the take/review-with-no-attempt fallback branch — update both).

- [ ] **Step 3: Add daily cards to `Home.tsx`**

Read `web/src/components/Home.tsx` in full first (its existing template-list rendering, `onStart`/`starting`/`startError` prop usage, and CSS class conventions in `Home.css`) to match style exactly — this task adds two new small cards, it does not restructure the page.

Add a new prop `onStartDaily: (kind: 'question' | 'quiz') => void` to `Home`'s props type (alongside the existing `onStart`).

Fetch `/api/status` once on mount (the same `getStatus` function already imported and used elsewhere in this file for template download state, or import it fresh if not already imported here) to read `status.online`. Render two cards near the top of the page (above or alongside the existing template list — your call on exact placement, but they should be visually grouped together as "today's" items, not interleaved with the template list):

- **Daily Question** card: clicking calls `onStartDaily('question')` when `status?.online` (or the node is canonical, which is always "online" to itself — check `status?.canonical || status?.online`) is true; when false, the card renders visually greyed/disabled (reuse whatever disabled-card pattern already exists in this file or `Home.css` — check for one before inventing a new visual state) with the text "Unavailable offline" or similar, and is not clickable.
- **Daily Quiz** card: same pattern, calling `onStartDaily('quiz')`.

Both cards should reflect the existing `starting`/`startError` props the same way template cards already do (e.g. showing a loading state while `starting` is true, surfacing `startError` if the click fails).

- [ ] **Step 4: Verify build and lint**

```bash
cd web && npm run build && npm run lint
```
Expected: both pass clean (aside from the pre-existing, unrelated `usePanelWidth.ts:30` warning).

- [ ] **Step 5: Manual verification**

Start the dev server (reuse the seed-script approach from the frontend-polish and sync-protocol plans if needed — a running canonical server with at least one tag/question seeded) and confirm in the Browser pane: the daily cards render, clicking Daily Question starts a normal Take flow, submitting and reviewing works exactly like a template attempt, and — if you can spin up a second local-role instance pointed at the canonical one — confirm the offline-greyed state by using a local instance with an unreachable `remote_url`.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/lib/api.ts src/components/Home.tsx src/App.tsx
git commit -m "feat: daily question/quiz cards on Home"
```

---

### Task 6: End-to-end verification — same-date consistency across two nodes

**Files:**
- Create: `server/tests/dailyDrawDurability.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4. No new production code — this proves the combination holds, matching the sync plan's Task 9 precedent (file-backed DBs, real `app.listen(0)` instances, real process-restart-style close/reopen).

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion } from "./helpers.js";

function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("daily draws: same-date consistency across two nodes", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osmosis-daily-")); });

  it("two local nodes requesting the same day's daily question get the identical question", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    insertTag(canonicalDb, "geo");
    for (let i = 0; i < 5; i++) insertQuestion(canonicalDb, { tags: ["geo"] });
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"),
                   remoteUrl: null, uploadsDir: dir, mcpAuthToken: "t" };
    const cNode = bootstrapNode(canonicalDb, cEnv);
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: cNode, runtime: createSyncRuntime() });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    async function localRequestsDaily(dbName: string): Promise<any> {
      const localDb = openFileDb(dir, dbName);
      const env = { role: "local" as const, label: dbName, port: 0, dbPath: join(dir, dbName),
                    remoteUrl: canonicalUrl, uploadsDir: dir, mcpAuthToken: null };
      const node = bootstrapNode(localDb, env);
      const runtime = createSyncRuntime();
      runtime.online = true;
      const app: FastifyInstance = buildApp({ db: localDb, env, node, runtime });
      const res = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
      const body = res.json();
      await app.close();
      return body;
    }

    const first = await localRequestsDaily("l1.db");
    const second = await localRequestsDaily("l2.db");

    expect(second.questions[0].id).toBe(first.questions[0].id);

    await canonicalApp.close();
  });

  it("a local node offline gets 503; the same node online afterward gets the draw", async () => {
    const canonicalDb = openFileDb(dir, "c2.db");
    insertTag(canonicalDb, "art");
    insertQuestion(canonicalDb, { tags: ["art"] });
    const cEnv = { role: "canonical" as const, label: "c2", port: 0, dbPath: join(dir, "c2.db"),
                   remoteUrl: null, uploadsDir: dir, mcpAuthToken: "t" };
    const cNode = bootstrapNode(canonicalDb, cEnv);
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: cNode, runtime: createSyncRuntime() });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l3.db");
    const env = { role: "local" as const, label: "l3", port: 0, dbPath: join(dir, "l3.db"),
                  remoteUrl: canonicalUrl, uploadsDir: dir, mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = false;
    const app = buildApp({ db: localDb, env, node, runtime });

    const offlineRes = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
    expect(offlineRes.statusCode).toBe(503);

    runtime.online = true;
    const onlineRes = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
    expect(onlineRes.statusCode).toBe(200);

    await app.close();
    await canonicalApp.close();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npx vitest run tests/dailyDrawDurability.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 3: Run the full server suite one final time**

Run: `cd server && npx vitest run`
Expected: PASS, everything green — daily draws is done.

- [ ] **Step 4: Commit**

```bash
cd server && git add tests/dailyDrawDurability.test.ts
git commit -m "test: daily draw same-date consistency and offline/online behavior across two nodes"
```

---

## Self-Review Notes

- **Coverage:** Lazy generation + caching, lineage exclusion (including the re-versioned-question case), fallback relaxation with `exclusion_relaxed` reporting, quiz-excludes-question's-lineage ordering, `daily_tag_filter`, timezone-correct date computation → Task 2. Canonical-direct and local-proxy HTTP paths, offline 503 → Task 4. Frontend cards → Task 5. Cross-node consistency → Task 6. All behavioral rules discussed during brainstorming are covered by a task.
- **Placeholder scan:** No TBD/TODO markers. Every task has concrete file paths, real test code, and precise implementation code or instructions.
- **Type consistency:** `ResolvedDailyDraw`/`ResolvedDailyQuestion` (Task 2) are consumed structurally (not by import) in Task 3's `CreateDailyAttemptInput`, deliberately avoiding a domain-layer dependency from `attempts.ts` on `dailyDraw.ts` — verified the field names (`id`, `lineage_id`, `type`) match exactly. `DailyDrawSyncResponse` (Task 4) carries `question_order` separately from `questions` because `PullResponse`-shaped question payloads don't have a defined order on their own (they're built from a `WHERE id IN (...)` query) — this was a deliberate design decision made while writing the plan, not an oversight, and Task 4's implementation code reflects it consistently in both the route (Step 4) and the client (Step 5).
