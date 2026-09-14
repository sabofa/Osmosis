# Rich Outcomes, Null-Score Aggregates, Sync Pill, Cloud Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every response field the tutor writes readable on every outcome path, stop counting ungraded responses as zero, show a real time on the canonical node's sync pill, and let a local node run a non-downloaded template as a "cloud test" while online (downloaded ones work offline), then deploy the result to the hosted server.

**Architecture:** All server work is additive on the existing domain modules (`attempts.ts`, `results.ts`, `retention.ts`, `sync.ts`, `sync/client.ts`) and one migration that rebuilds the `tag_performance` view. Cloud tests reuse the daily-draw pattern exactly: a canonical `/sync/template-draw` route returns bank payloads, the local node mirrors them with `upsertBankContent`, then creates a normal `template` attempt from an explicit question list. Web changes are confined to `Take.tsx` (latency), `Review.tsx` (mean), `Home.tsx`/`Settings.tsx` (pill), and `Library.tsx`/`Home.tsx`/`TemplateDetail.tsx` (cloud/downloaded gating).

**Tech Stack:** TypeScript, Fastify 5, `node:sqlite` `DatabaseSync`, Zod (MCP schemas), Vitest, React 19 + Vite.

**Spec:** `docs/superpowers/specs/2026-09-14-rich-outcomes-cloud-tests-design.md`

## Global Constraints

- Every task: `cd server && npm run typecheck && npx vitest run` must be green before commit. Web tasks: `cd web && npx tsc -b && npx oxlint` clean.
- Tests use `openTestDb()` / `insertTag()` / `insertQuestion()` / `seedScoredResponse()` / `isoAgo()` from `server/tests/helpers.ts`. Two-node HTTP tests follow `server/tests/dailyDrawDurability.test.ts` (file-backed DBs via `migrate`, real `app.listen`).
- `EnvConfig` object literals in tests need all fields: `{ role, label, port, dbPath, remoteUrl, uploadsDir, mcpAuthToken, deepseekApiKey, webDistDir }`.
- Migrations are additive SQL files under `server/migrations/`; the next number is `015`. Migration files and deploy files are LF (enforced by `.gitattributes`).
- Zod schemas in `server/src/mcp/tools.ts` mirror DB CHECK constraints.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never touch `/etc/cloudflared` on the server; deployment is `git pull && bash deploy/install.sh` only.

---

## File Structure

| File | Responsibility in this plan |
|---|---|
| `server/src/domain/attempts.ts` | `getItemOutcome` full record + `outcome` derivation; `submitQuickCheck` returns it; `createAttempt` accepts explicit `questions` and rejects empty draws; `listAttempts` ungraded count |
| `server/src/domain/results.ts` | question scope `recent_responses` for all types; `graded`/`ungraded`; `AVG(score)` everywhere |
| `server/src/domain/sessions.ts`, `templates.ts` | `AVG(score)` + `ungraded`; `isTemplateDownloaded` helper |
| `server/src/domain/retention.ts` | `reason` on due items |
| `server/src/domain/sync.ts` | `buildTemplateDrawResponse` (canonical side of cloud tests) |
| `server/src/sync/client.ts` | `fetchAndApplyTemplateDraw` (local side) |
| `server/src/http/app.ts` | `POST /sync/template-draw` |
| `server/src/http/apiRoutes.ts` | `last_write_at` on status; template branch of `POST /api/attempts` |
| `server/src/mcp/tools.ts` | `get_attempt` tool; updated descriptions |
| `server/migrations/015_null_score_not_zero.sql` | rebuild `tag_performance` |
| `web/src/lib/api.ts` | new fields/types |
| `web/src/components/Take.tsx` | per-response latency |
| `web/src/components/Review.tsx` | mean over graded |
| `web/src/components/Home.tsx`, `Settings.tsx` | pill text |
| `web/src/components/Library.tsx`, `Home.tsx`, `TemplateDetail.tsx`, `web/src/data/templates.ts`, `web/src/lib/templateView.ts` | cloud/downloaded gating |

---

### Task 1: Full outcome record from `getItemOutcome` and `submitQuickCheck`

**Files:**
- Modify: `server/src/domain/attempts.ts` (`ItemOutcome` type at ~line 366, `getItemOutcome` ~line 380, `submitQuickCheck` ~line 329)
- Modify: `server/src/mcp/tools.ts` (`await_item_outcome` and `submit_quick_check` descriptions)
- Test: `server/tests/outcomeRecord.test.ts`

**Interfaces:**
- Produces: `export type OutcomeLabel = "correct" | "partial" | "incorrect" | "dont_know" | "ungraded"` and `export function deriveOutcome(idk: boolean, score: number | null): OutcomeLabel`. `ItemOutcome` answered variant gains `outcome, score, selected_choice_id, chosen_misconception, response_text, elapsed_ms, answered_at`. `submitQuickCheck` returns `ItemOutcome` (the answered variant).

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/outcomeRecord.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import {
  presentItem, answerResponse, submitAttempt, getItemOutcome, gradeResponse,
  quickCheck, submitQuickCheck, deriveOutcome,
} from "../src/domain/attempts.js";

function mcQuestion(db: ReturnType<typeof openTestDb>) {
  insertTag(db, "a");
  return createQuestions(db, [
    {
      type: "mc", prompt: "2+2?", tags: ["a"],
      choices: [
        { body: "4", is_correct: true },
        { body: "5", is_correct: false, misconception: "off by one" },
      ],
    },
  ]).created[0];
}

function choiceId(db: ReturnType<typeof openTestDb>, questionId: string, correct: boolean): string {
  return (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = ?").get(questionId, correct ? 1 : 0) as { id: string }).id;
}

describe("deriveOutcome", () => {
  it("maps idk/score to the five labels", () => {
    expect(deriveOutcome(true, 0)).toBe("dont_know");
    expect(deriveOutcome(false, null)).toBe("ungraded");
    expect(deriveOutcome(false, 1)).toBe("correct");
    expect(deriveOutcome(false, 0)).toBe("incorrect");
    expect(deriveOutcome(false, 0.5)).toBe("partial");
  });
});

describe("getItemOutcome full record", () => {
  it("mc wrong choice: incorrect, carries the chosen option and its misconception", () => {
    const db = openTestDb();
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const wrong = choiceId(db, q.id, false);
    answerResponse(db, p.attempt_id, p.response_id, { selected_choice_id: wrong, confidence: "confident", elapsed_ms: 4200 });
    submitAttempt(db, p.attempt_id);

    const o = getItemOutcome(db, p.response_id);
    expect(o.status).toBe("answered");
    if (o.status !== "answered") return;
    expect(o.outcome).toBe("incorrect");
    expect(o.score).toBe(0);
    expect(o.selected_choice_id).toBe(wrong);
    expect(o.chosen_misconception).toBe("off by one");
    expect(o.correct_choice_id).toBe(choiceId(db, q.id, true));
    expect(o.elapsed_ms).toBe(4200);
    expect(o.confidence).toBe("confident");
    expect(typeof o.answered_at).toBe("string");
  });

  it("mc I-don't-know: dont_know, no chosen option", () => {
    const db = openTestDb();
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { idk: true, skipped: true });
    submitAttempt(db, p.attempt_id);
    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("dont_know");
    expect(o.selected_choice_id).toBeNull();
    expect(o.chosen_misconception).toBeNull();
  });

  it("written: ungraded with response_text, then partial after a self-grade", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { type: "written", tags: ["w"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);

    let o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("ungraded");
    expect(o.score).toBeNull();
    expect(o.response_text).toBe("nine");
    expect(o.correct).toBeNull();

    gradeResponse(db, p.response_id, { grader: "self", score: 0.5 });
    o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("partial");
    expect(o.score).toBe(0.5);
  });
});

describe("submitQuickCheck returns the full record", () => {
  it("includes response_text and outcome, and still the model answer", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { type: "written", tags: ["w"] });
    const qc = quickCheck(db, { node_id: "n", question_id: q.id });
    const r = submitQuickCheck(db, { response_id: qc.response_id, response_text: "nine", confidence: "unsure" });
    expect(r.status).toBe("answered");
    if (r.status !== "answered") return;
    expect(r.response_text).toBe("nine");
    expect(r.outcome).toBe("ungraded");
    expect(r.model_answer).toBe("model answer");
    expect(r.confidence).toBe("unsure");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/outcomeRecord.test.ts`
Expected: FAIL — `deriveOutcome` is not exported; `outcome`/`response_text` undefined.

- [ ] **Step 3: Implement**

In `server/src/domain/attempts.ts`, replace the `ItemOutcome` type and `getItemOutcome`:

```typescript
export type OutcomeLabel = "correct" | "partial" | "incorrect" | "dont_know" | "ungraded";

// The tutor's outcome ∈ {correct, incorrect, dont_know} plus the two states a
// written item passes through before a grade exists / when a self-grade is
// 0.5. "I don't know" wins over any score, since idk is a deliberate third
// answer, not a wrong one.
export function deriveOutcome(idk: boolean, score: number | null): OutcomeLabel {
  if (idk) return "dont_know";
  if (score === null) return "ungraded";
  if (score >= 1) return "correct";
  if (score <= 0) return "incorrect";
  return "partial";
}

export type AnsweredOutcome = {
  status: "answered";
  outcome: OutcomeLabel;
  score: number | null;
  correct: boolean | null;
  selected_choice_id: string | null;
  chosen_misconception: string | null;
  correct_choice_id: string | null;
  response_text: string | null;
  confidence: "unsure" | "somewhat" | "confident" | null;
  idk: boolean;
  misapplied_method: string | null;
  elapsed_ms: number | null;
  answered_at: string | null;
  explanation: string | null;
  model_answer: string | null;
};

export type ItemOutcome = { status: "pending" } | { status: "abandoned" } | AnsweredOutcome;

export function getItemOutcome(db: DatabaseSync, responseId: string): ItemOutcome {
  sweepAbandonedAttempts(db);

  const row = db
    .prepare(
      `SELECT r.attempt_id, r.question_id, a.submitted_at, a.abandoned_at,
              r.selected_choice_id, r.response_text, r.elapsed_ms, r.answered_at,
              r.confidence, r.idk, r.misapplied_method
       FROM response r JOIN attempt a ON a.id = r.attempt_id
       WHERE r.id = ?`
    )
    .get(responseId) as
    | {
        attempt_id: string; question_id: string; submitted_at: string | null; abandoned_at: string | null;
        selected_choice_id: string | null; response_text: string | null; elapsed_ms: number | null;
        answered_at: string | null; confidence: "unsure" | "somewhat" | "confident" | null; idk: number;
        misapplied_method: string | null;
      }
    | undefined;
  if (!row) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);

  if (row.abandoned_at && !row.submitted_at) return { status: "abandoned" };
  if (!row.submitted_at) return { status: "pending" };

  const question = db.prepare("SELECT type, explanation, model_answer FROM question WHERE id = ?").get(
    row.question_id
  ) as { type: "mc" | "written"; explanation: string | null; model_answer: string | null };

  const liveGrade = db
    .prepare("SELECT score FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { score: number } | undefined;
  const score = liveGrade ? liveGrade.score : null;

  const correctChoice =
    question.type === "mc"
      ? (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(row.question_id) as
          | { id: string }
          | undefined)
      : undefined;
  const chosen = row.selected_choice_id
    ? (db.prepare("SELECT misconception FROM choice WHERE id = ?").get(row.selected_choice_id) as
        | { misconception: string | null }
        | undefined)
    : undefined;

  return {
    status: "answered",
    outcome: deriveOutcome(row.idk === 1, score),
    score,
    correct: question.type === "mc" ? score === 1 : null,
    selected_choice_id: row.selected_choice_id,
    chosen_misconception: chosen?.misconception ?? null,
    correct_choice_id: correctChoice?.id ?? null,
    response_text: row.response_text,
    confidence: row.confidence,
    idk: row.idk === 1,
    misapplied_method: row.misapplied_method,
    elapsed_ms: row.elapsed_ms,
    answered_at: row.answered_at,
    explanation: question.explanation,
    model_answer: question.model_answer,
  };
}
```

Change `submitQuickCheck`'s return type to `AnsweredOutcome` and its tail to:

```typescript
  submitAttempt(db, row.attempt_id);

  const outcome = getItemOutcome(db, input.response_id);
  if (outcome.status !== "answered") {
    throw new DomainError("internal_error", "quick check did not resolve to an answered outcome");
  }
  return outcome;
```

(Delete the old `question` lookup and `{ explanation, model_answer }` return.) Note `getItemOutcome` is defined after `submitQuickCheck` in the file; function declarations hoist, so no reordering is needed.

In `server/src/mcp/tools.ts` update the two descriptions:

- `await_item_outcome`: append `" The answered record carries outcome (correct|partial|incorrect|dont_know|ungraded), score, selected_choice_id with its chosen_misconception, response_text, confidence, idk, misapplied_method, elapsed_ms and answered_at."`
- `submit_quick_check`: replace with `"Record the learner's free-response answer to a quick_check. Returns the full outcome record (response_text, outcome, model_answer, explanation, confidence, idk, misapplied_method)."`

- [ ] **Step 4: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: all green. `tests/quickCheck.test.ts` may assert on `explanation`/`model_answer` of the submit result — those keys still exist, so it should pass unchanged; if it asserts exact object equality, update it to check those two keys only.

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/attempts.ts server/src/mcp/tools.ts server/tests/outcomeRecord.test.ts server/tests/quickCheck.test.ts
git commit -m "feat: full outcome record (outcome label, chosen option + misconception, response_text, latency) from await_item_outcome and submit_quick_check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `get_attempt` MCP tool

**Files:**
- Modify: `server/src/mcp/tools.ts` (add after `get_session` registration)
- Test: `server/tests/getAttemptTool.test.ts`

**Interfaces:**
- Consumes: `getAttemptDetail(db, attemptId)` from `attempts.ts` (existing; already imported? No — add `getAttemptDetail` to the `attempts.js` import list in tools.ts).
- Produces: MCP tool `get_attempt` with input `{ attempt_id: string }`, returns `getAttemptDetail`'s object.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/getAttemptTool.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, answerResponse, submitAttempt } from "../src/domain/attempts.js";

async function connectedClient(db: ReturnType<typeof openTestDb>): Promise<Client> {
  const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
  registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  return { body: JSON.parse(content[0].text), isError: (result as { isError?: boolean }).isError === true };
}

describe("get_attempt MCP tool", () => {
  it("returns the attempt with every per-response input field and the live grade", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine", confidence: "somewhat", misapplied_method: "guessed", elapsed_ms: 900 });
    submitAttempt(db, p.attempt_id);

    const client = await connectedClient(db);
    const { body, isError } = await callTool(client, "get_attempt", { attempt_id: p.attempt_id });
    expect(isError).toBe(false);
    expect(body.id).toBe(p.attempt_id);
    const r = body.responses[0];
    expect(r.response_text).toBe("nine");
    expect(r.confidence).toBe("somewhat");
    expect(r.misapplied_method).toBe("guessed");
    expect(r.elapsed_ms).toBe(900);
    expect(r.idk).toBe(false);
    expect(r.grade).toBeNull();
    expect(r.question.model_answer).toBe("model answer");
  });

  it("errors with not_found for an unknown id", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    const { body, isError } = await callTool(client, "get_attempt", { attempt_id: uuidv4() });
    expect(isError).toBe(true);
    expect(body.error).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/getAttemptTool.test.ts`
Expected: FAIL — tool `get_attempt` not found.

- [ ] **Step 3: Implement**

In `server/src/mcp/tools.ts`, extend the attempts import:

```typescript
import { presentItem, getItemOutcome, quickCheck, submitQuickCheck, getAttemptDetail } from "../domain/attempts.js";
```

Register after `get_session`:

```typescript
  server.registerTool(
    "get_attempt",
    {
      description:
        "Read one attempt in full: every response with its question snapshot (answer key included once submitted), " +
        "selected_choice_id, response_text, confidence, idk, misapplied_method, elapsed_ms, answered_at and the live " +
        "grade. This is the attempt-scope read; get_results stays aggregate. attempt_id comes from present_item, " +
        "quick_check, get_session, or get_results(scope: 'attempt').",
      inputSchema: { attempt_id: z.string() },
    },
    async ({ attempt_id }) => {
      try {
        return ok(getAttemptDetail(db, attempt_id));
      } catch (err) {
        return fail(err);
      }
    }
  );
```

Update `MCP-SPEC.md` §3's tool table: add a `get_attempt` row ("Full attempt read: per-response inputs + live grade") and change "21 tools" text if it still says 21 (the live count is now 32).

- [ ] **Step 4: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/tools.ts server/tests/getAttemptTool.test.ts MCP-SPEC.md
git commit -m "feat: get_attempt MCP tool — attempt-scope read with every response input field

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `get_results` question scope: responses for every type, graded/ungraded counts

**Files:**
- Modify: `server/src/domain/results.ts` (`questionScope`, lines ~93-170)
- Test: `server/tests/resultsResponses.test.ts`

**Interfaces:**
- Produces: each question-scope row has `graded: number`, `ungraded: number`, and `recent_responses: { response_text, selected_choice_id, idk, confidence, misapplied_method, elapsed_ms, score, answered_at }[]` for mc and written alike.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/resultsResponses.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion, isoAgo } from "./helpers.js";
import { getResults } from "../src/domain/results.js";

function seedResponse(
  db: ReturnType<typeof openTestDb>,
  questionId: string,
  fields: { selected_choice_id?: string | null; response_text?: string | null; idk?: number; confidence?: string | null; misapplied_method?: string | null; elapsed_ms?: number | null },
  score: number | null,
  answeredAt: string
): void {
  const attemptId = uuidv4();
  const responseId = uuidv4();
  db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, ?)").run(attemptId, answeredAt, answeredAt);
  db.prepare(
    `INSERT INTO response (id, attempt_id, question_id, ordinal, selected_choice_id, response_text, idk, confidence, misapplied_method, elapsed_ms, answered_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(responseId, attemptId, questionId, fields.selected_choice_id ?? null, fields.response_text ?? null, fields.idk ?? 0,
        fields.confidence ?? null, fields.misapplied_method ?? null, fields.elapsed_ms ?? null, answeredAt);
  if (score !== null) {
    db.prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', ?, ?)").run(uuidv4(), responseId, score, answeredAt);
  }
}

describe("get_results question scope: recent_responses for every type", () => {
  it("mc rows carry selected_choice_id/idk/confidence/elapsed_ms", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "mc" });
    const wrong = (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 0").get(q.id) as { id: string }).id;
    seedResponse(db, q.id, { selected_choice_id: wrong, confidence: "confident", elapsed_ms: 1500 }, 0, isoAgo(1));

    const result = getResults(db, { scope: "question" }) as { questions: any[] };
    const row = result.questions[0];
    expect(row.recent_responses).toHaveLength(1);
    expect(row.recent_responses[0].selected_choice_id).toBe(wrong);
    expect(row.recent_responses[0].confidence).toBe("confident");
    expect(row.recent_responses[0].elapsed_ms).toBe(1500);
    expect(row.recent_responses[0].idk).toBe(false);
    expect(row.recent_responses[0].score).toBe(0);
  });

  it("counts graded and ungraded separately and does not fold null into the mean", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { tags: ["w"], type: "written" });
    seedResponse(db, q.id, { response_text: "right" }, 1, isoAgo(2));
    seedResponse(db, q.id, { response_text: "pending", misapplied_method: "chain rule" }, null, isoAgo(1));

    const result = getResults(db, { scope: "question" }) as { questions: any[] };
    const row = result.questions[0];
    expect(row.responses).toBe(2);
    expect(row.graded).toBe(1);
    expect(row.ungraded).toBe(1);
    expect(row.mean_score).toBe(1);
    expect(row.recent_responses[0].misapplied_method).toBe("chain rule");
    expect(row.recent_responses[0].score).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/resultsResponses.test.ts`
Expected: FAIL — `recent_responses` undefined for mc; `mean_score` 0.5; `graded` undefined.

- [ ] **Step 3: Implement**

In `server/src/domain/results.ts`, rewrite `questionScope`:

```typescript
function questionScope(db: DatabaseSync, params: GetResultsParams) {
  const tagClause = params.tag_query ? buildTagQueryClause(params.tag_query) : { sql: "", params: [] };
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  // AVG ignores NULL: an ungraded written response contributes to `responses`
  // and `ungraded` but never to the mean — a null score is "not yet graded",
  // not zero.
  const lineages = db
    .prepare(
      `SELECT q.lineage_id,
              COUNT(*) AS responses,
              COUNT(rs.score) AS graded,
              AVG(rs.score) AS mean_score,
              MAX(a.submitted_at) AS last_seen
       FROM response_score rs
       JOIN response r ON r.id = rs.response_id
       JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
       JOIN question q ON q.id = rs.question_id
       WHERE 1=1 ${tagClause.sql}
       GROUP BY q.lineage_id
       ORDER BY mean_score IS NULL, mean_score ASC
       LIMIT ? OFFSET ?`
    )
    .all(...(tagClause.params as any[]), limit, offset) as {
    lineage_id: string;
    responses: number;
    graded: number;
    mean_score: number | null;
    last_seen: string;
  }[];

  return lineages.map((l) => {
    const current = db
      .prepare(
        `SELECT id, prompt, type FROM question
         WHERE lineage_id = ? AND NOT EXISTS (
           SELECT 1 FROM question q2 WHERE q2.lineage_id = question.lineage_id AND q2.version > question.version
         )`
      )
      .get(l.lineage_id) as { id: string; prompt: string; type: "mc" | "written" };

    const tags = (
      db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(current.id) as { tag_slug: string }[]
    ).map((t) => t.tag_slug);

    const recent = db
      .prepare(
        `SELECT rs.score, r.response_text, r.selected_choice_id, r.idk, r.confidence, r.misapplied_method,
                r.elapsed_ms, r.answered_at
         FROM response_score rs
         JOIN response r ON r.id = rs.response_id
         JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         JOIN question q ON q.id = rs.question_id
         WHERE q.lineage_id = ?
         ORDER BY r.answered_at DESC
         LIMIT 3`
      )
      .all(l.lineage_id) as {
      score: number | null; response_text: string | null; selected_choice_id: string | null; idk: number;
      confidence: string | null; misapplied_method: string | null; elapsed_ms: number | null; answered_at: string;
    }[];

    return {
      lineage_id: l.lineage_id,
      current_id: current.id,
      prompt_preview: current.prompt.slice(0, 120),
      tags,
      responses: l.responses,
      graded: l.graded,
      ungraded: l.responses - l.graded,
      mean_score: l.mean_score,
      last_seen: l.last_seen,
      last_score: recent[0]?.score ?? null,
      // Every input field the response accepted comes back out, for mc and
      // written alike: the chosen option is the diagnosis for mc, the text is
      // for written (spec 9.12), and confidence/idk/misapplied_method are the
      // tutor's own annotations.
      recent_responses: recent.map((r) => ({
        response_text: truncateResponseText(r.response_text),
        selected_choice_id: r.selected_choice_id,
        idk: r.idk === 1,
        confidence: r.confidence,
        misapplied_method: r.misapplied_method,
        elapsed_ms: r.elapsed_ms,
        score: r.score,
        answered_at: r.answered_at,
      })),
    };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: green. `tests/results.test.ts` "worst first" and `resultsPagination.test.ts` should still pass; if one asserts `recent_responses` is `undefined` for mc, update it to expect an array.

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/results.ts server/tests/resultsResponses.test.ts server/tests/results.test.ts
git commit -m "feat: get_results question scope returns every response input for mc too, with graded/ungraded counts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Null score is not zero — view migration and every aggregate

**Files:**
- Create: `server/migrations/015_null_score_not_zero.sql`
- Modify: `server/src/domain/results.ts` (tagScope lines ~47-83, attemptScope ~182-203, dailyScope ~211-243)
- Modify: `server/src/domain/attempts.ts` (`listAttempts` ~578-613)
- Modify: `server/src/domain/sessions.ts` (`getSessionDetail` attempts query ~89-112, mapping ~138-150)
- Modify: `server/src/domain/templates.ts` (`toSummary` stats ~152-163)
- Modify: `server/src/domain/bootstrap.ts` (`weakest_tags` ~129-133)
- Test: `server/tests/nullScore.test.ts`
- Update: `server/tests/results.test.ts` (tag scope expectations unchanged in value; keep)

**Interfaces:**
- Produces: `tag_performance` columns `tag_slug, responses, graded, mean_score (nullable), misses, last_seen`. Attempt summaries (`listAttempts`, `getSessionDetail.attempts`, results attempt scope) gain `ungraded: number`. Daily scope rows gain `ungraded`. Tag scope rows gain `graded`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/nullScore.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion, isoAgo } from "./helpers.js";
import { getResults } from "../src/domain/results.js";
import { listAttempts } from "../src/domain/attempts.js";
import { getSessionDetail, createSession } from "../src/domain/sessions.js";
import { createTemplate, getTemplateDetail } from "../src/domain/templates.js";
import { bootstrap } from "../src/domain/bootstrap.js";

// One attempt, two written responses: one graded 1, one never graded.
function seedAttempt(db: ReturnType<typeof openTestDb>, q1: string, q2: string, opts: { template_id?: string; session_id?: string } = {}): string {
  const attemptId = uuidv4();
  const at = isoAgo(1);
  db.prepare(
    "INSERT INTO attempt (id, node_id, source, template_id, session_id, started_at, submitted_at) VALUES (?, 'n', ?, ?, ?, ?, ?)"
  ).run(attemptId, opts.template_id ? "template" : "adhoc", opts.template_id ?? null, opts.session_id ?? null, at, at);
  const r1 = uuidv4();
  const r2 = uuidv4();
  db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'a', ?)").run(r1, attemptId, q1, at);
  db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 1, 'b', ?)").run(r2, attemptId, q2, at);
  db.prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 1, ?)").run(uuidv4(), r1, at);
  return attemptId;
}

describe("a null score is ungraded, never zero", () => {
  it("attempt scope, listAttempts, and sessions report mean 1 with ungraded 1", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    const session = createSession(db, { name: "s" });
    seedAttempt(db, q1.id, q2.id, { session_id: session.id });

    const attemptScope = getResults(db, { scope: "attempt" }) as { attempts: any[] };
    expect(attemptScope.attempts[0].mean_score).toBe(1);
    expect(attemptScope.attempts[0].ungraded).toBe(1);

    const listed = listAttempts(db);
    expect(listed.attempts[0].mean_score).toBe(1);
    expect(listed.attempts[0].ungraded).toBe(1);

    const detail = getSessionDetail(db, session.id) as { attempts: any[] };
    expect(detail.attempts[0].mean_score).toBe(1);
    expect(detail.attempts[0].ungraded).toBe(1);
  });

  it("tag scope (the view) and bootstrap's weakest_tags ignore the ungraded response", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    seedAttempt(db, q1.id, q2.id);

    const tagScope = getResults(db, { scope: "tag" }) as { tags: any[] };
    const row = tagScope.tags.find((t) => t.tag_slug === "w");
    expect(row.responses).toBe(2);
    expect(row.graded).toBe(1);
    expect(row.mean_score).toBe(1);
    expect(row.misses).toBe(0);

    const b = bootstrap(db, null);
    expect(b.results_pointer.weakest_tags[0].mean_score).toBe(1);
  });

  it("template summary mean is over graded responses only", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["w"] }, question_count: 2 });
    seedAttempt(db, q1.id, q2.id, { template_id: t.id });
    expect(getTemplateDetail(db, t.id).mean_score).toBe(1);
  });

  it("an attempt with nothing graded has mean_score null, not 0", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { tags: ["w"], type: "written" });
    const attemptId = uuidv4();
    const at = isoAgo(1);
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, ?)").run(attemptId, at, at);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'x', ?)").run(uuidv4(), attemptId, q.id, at);
    const listed = listAttempts(db);
    expect(listed.attempts[0].mean_score).toBeNull();
    expect(listed.attempts[0].ungraded).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/nullScore.test.ts`
Expected: FAIL — means come back 0.5 / 0, `ungraded`/`graded` undefined.

- [ ] **Step 3: Write the migration**

```sql
-- server/migrations/015_null_score_not_zero.sql
-- A response with no live grade is *ungraded*, not wrong. 001's view folded
-- NULL scores into the mean as 0 (AVG(COALESCE(score, 0))), which pulls every
-- tag with an un-self-graded written answer toward zero and would poison any
-- later difficulty statistics. AVG() already ignores NULL; `graded` says how
-- many responses the mean actually covers. Views can't be altered in place.
DROP VIEW tag_performance;

CREATE VIEW tag_performance AS
SELECT qt.tag_slug,
       COUNT(*)                                    AS responses,
       COUNT(rs.score)                             AS graded,
       AVG(rs.score)                               AS mean_score,
       SUM(CASE WHEN rs.score < 0.5 THEN 1 ELSE 0 END) AS misses,
       MAX(a.submitted_at)                         AS last_seen
FROM response_score rs
JOIN attempt a      ON a.id = rs.attempt_id AND a.submitted_at IS NOT NULL
JOIN question_tag qt ON qt.question_id = rs.question_id
GROUP BY qt.tag_slug;
```

- [ ] **Step 4: Update every aggregate**

`server/src/domain/results.ts` — tagScope: select `tp.graded` too, replace both `AVG(COALESCE(rs.score, 0))` subqueries with `AVG(rs.score)`, change `ORDER BY tp.mean_score ASC` to `ORDER BY tp.mean_score IS NULL, tp.mean_score ASC`, type `mean_score: number | null`, add `graded: number` to the row type and to the mapped output (`graded: r.graded`).

attemptScope: subquery becomes

```sql
(SELECT AVG(rs.score) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score,
(SELECT COUNT(*) FROM response_score rs WHERE rs.attempt_id = a.id AND rs.score IS NULL) AS ungraded
```

add `ungraded: number` to the row type; the `rows.map` spread already passes it through.

dailyScope: the `score` subquery becomes `AVG(rs.score)`; add an `ungraded` subquery with the same first-attempt subselect and `AND rs.score IS NULL`, type it, and return `ungraded: r.ungraded`.

`server/src/domain/attempts.ts` listAttempts: same two subqueries as attemptScope; add `ungraded: number` to the row type and `ungraded: r.ungraded` to the mapped object.

`server/src/domain/sessions.ts` getSessionDetail: same two subqueries; add `ungraded` to the row type and to the mapped attempt.

`server/src/domain/templates.ts` toSummary stats query:

```sql
SELECT COUNT(*) AS attempt_count, AVG(m.attempt_mean) AS mean_score
FROM (
  SELECT a.id, AVG(rs.score) AS attempt_mean
  FROM attempt a
  LEFT JOIN response_score rs ON rs.attempt_id = a.id
  WHERE a.template_id = ? AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
  GROUP BY a.id
) m
```

`server/src/domain/bootstrap.ts` weakest_tags: `ORDER BY mean_score IS NULL, mean_score ASC LIMIT 4` and type `mean_score: number | null` (also in `BootstrapResult`).

`web/src/lib/api.ts`: `TagResultStat.mean_score: number | null`, add `graded: number`; `AttemptSummary` and `SessionAttemptSummary` add `ungraded: number`; `DailyResultStat` add `ungraded: number`.

`web/src/components/Results.tsx`: where `subject.mean_score.toFixed(2)` / `t.mean_score.toFixed(2)` / `barX(subject.mean_score)` / `t.mean_score < 0.5` are used, guard null: display `'—'` and treat null as `0` for the bar position and `weak` class only when non-null and `< 0.5`.

- [ ] **Step 5: Run tests**

Run: `cd server && npm run typecheck && npx vitest run && cd ../web && npx tsc -b && npx oxlint`
Expected: green. `tests/results.test.ts` tag test seeds a scored 0 → still `mean_score 0`, `misses 1`.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/015_null_score_not_zero.sql server/src/domain server/tests/nullScore.test.ts web/src/lib/api.ts web/src/components/Results.tsx
git commit -m "fix: ungraded responses no longer count as zero in any mean; report graded/ungraded counts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Due-item reason

**Files:**
- Modify: `server/src/domain/retention.ts` (`getDueItems` ~87-114)
- Modify: `server/src/mcp/tools.ts` (`get_due_items` description)
- Test: `server/tests/dueReason.test.ts`

**Interfaces:**
- Produces: each item has `reason: "never_demonstrated" | "decayed" | "lapsed"`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/dueReason.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { setRetentionTarget, recordRetentionResult, getDueItems } from "../src/domain/retention.js";

describe("get_due_items reason", () => {
  it("derives never_demonstrated / decayed / lapsed from last_result", () => {
    const db = openTestDb();
    for (const key of ["k-never", "k-pass", "k-fail"]) {
      setRetentionTarget(db, { identity_key: key, retention_target: "t", target_source: "tutor_direct", needs_last_until: "2020-01-01" });
    }
    recordRetentionResult(db, "k-pass", "t", true);
    recordRetentionResult(db, "k-fail", "t", false);

    const { items } = getDueItems(db, { before: "2100-01-01" }) as { items: { identity_key: string; reason: string }[] };
    const byKey = Object.fromEntries(items.map((i) => [i.identity_key, i.reason]));
    expect(byKey["k-never"]).toBe("never_demonstrated");
    expect(byKey["k-pass"]).toBe("decayed");
    expect(byKey["k-fail"]).toBe("lapsed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/dueReason.test.ts`
Expected: FAIL — `reason` undefined.

- [ ] **Step 3: Implement**

In `retention.ts`, above `getDueItems`:

```typescript
export type DueReason = "never_demonstrated" | "decayed" | "lapsed";

// Why an identity is due, at the grain the tutor needs to choose between a
// fresh probe (never shown), a retrieval check (once known, decaying), and
// re-teaching (last probe failed).
function dueReasonFor(lastResult: string): DueReason {
  if (lastResult === "pass") return "decayed";
  if (lastResult === "fail") return "lapsed";
  return "never_demonstrated";
}
```

Change `getDueItems`'s return type to `{ total: number; items: DueItem[]; has_more: boolean }` with

```typescript
export interface DueItem {
  id: string; identity_key: string; retention_target: string; due_at: string;
  last_result: "pass" | "fail" | "never_attempted"; target_source: "engine" | "tutor_direct"; reason: DueReason;
}
```

and map the rows: `const items = rows.map((r) => ({ ...r, reason: dueReasonFor(r.last_result) }));` where `rows` is the existing `.all(...)` cast to `Omit<DueItem, "reason">[]`.

`tools.ts` `get_due_items` description: append `" Each item carries reason: never_demonstrated (no probe recorded yet), decayed (last probe passed, interval elapsed), or lapsed (last probe failed)."`

- [ ] **Step 4: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: green (`retention.test.ts` reads `items` loosely).

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/retention.ts server/src/mcp/tools.ts server/tests/dueReason.test.ts
git commit -m "feat: get_due_items rows carry a reason (never_demonstrated | decayed | lapsed)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `last_write_at` on `/api/status` and the canonical sync pill

**Files:**
- Modify: `server/src/http/apiRoutes.ts` (`/api/status` handler ~63-97)
- Modify: `web/src/lib/api.ts` (`NodeStatus`)
- Modify: `web/src/components/Home.tsx` (~lines 46, 88, 588) and `web/src/components/Settings.tsx` (~393, 712)
- Test: `server/tests/statusLastWrite.test.ts`

**Interfaces:**
- Produces: `NodeStatus.last_write_at: string | null`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/statusLastWrite.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("GET /api/status last_write_at", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime() });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("is null on an empty bank, then the latest write across tags, questions, attempts and assets", async () => {
    let res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().last_write_at).toBeNull();

    insertTag(db, "a");
    db.prepare("UPDATE tag SET created_at = '2026-01-01 00:00:00'").run();
    const q = insertQuestion(db, { tags: ["a"] });
    db.prepare("UPDATE question SET created_at = '2026-02-01 00:00:00' WHERE id = ?").run(q.id);
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', '2026-03-01 00:00:00', '2026-03-01 00:00:00')").run(uuidv4());

    res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().last_write_at).toBe("2026-03-01 00:00:00");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/statusLastWrite.test.ts`
Expected: FAIL — `last_write_at` undefined.

- [ ] **Step 3: Implement**

In the `/api/status` handler, before the `return`:

```typescript
    // The canonical node never pulls, so last_pull_at is meaningless there;
    // the app's "synced" pill shows the last time anything changed instead.
    const lastWrite = (
      db
        .prepare(
          `SELECT MAX(t) AS t FROM (
             SELECT MAX(created_at) AS t FROM question
             UNION ALL SELECT MAX(created_at) FROM tag
             UNION ALL SELECT MAX(submitted_at) FROM attempt
             UNION ALL SELECT MAX(created_at) FROM asset
           )`
        )
        .get() as { t: string | null }
    ).t;
```

and add `last_write_at: lastWrite,` to the returned object. `web/src/lib/api.ts`: add `last_write_at: string | null` to `NodeStatus`.

`Home.tsx`: keep `status` state; replace the pill markup with

```tsx
          <div className="sync-pill">
            <span className="sync-dot" />
            {status?.canonical
              ? `up to date${status.last_write_at ? ` · ${timeAgo(status.last_write_at)}` : ''}`
              : `synced ${timeAgo(lastSync)}`}
          </div>
```

`Settings.tsx` line ~712: same expression using `status` (`status?.canonical ? ... : \`synced ${timeAgo(lastSync)}\``).

- [ ] **Step 4: Run tests**

Run: `cd server && npm run typecheck && npx vitest run && cd ../web && npx tsc -b && npx oxlint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/src/http/apiRoutes.ts server/tests/statusLastWrite.test.ts web/src/lib/api.ts web/src/components/Home.tsx web/src/components/Settings.tsx
git commit -m "feat: last_write_at on /api/status; canonical pill reads 'up to date · <time>' instead of 'synced never'

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Latency from the Take screen; Review mean over graded

**Files:**
- Modify: `web/src/components/Take.tsx`
- Modify: `web/src/components/Review.tsx` (lines ~49-54, ~202-205)

**Interfaces:**
- Consumes: `answerResponse(attemptId, responseId, { elapsed_ms })` (existing API client).

- [ ] **Step 1: Take.tsx — per-response elapsed counter**

Add refs after `inFlightSaves`:

```tsx
  // Time-on-question, per response id, in ms. Accumulates while a response
  // is the visible one and pauses when you navigate away, so revisiting a
  // question keeps adding to its total. Seeded from the server's stored
  // elapsed_ms so a resumed attempt doesn't restart at zero.
  const elapsed = useRef<Record<string, number>>(
    Object.fromEntries(questions.map((r) => [r.id, r.elapsed_ms ?? 0]))
  )
  const shownAt = useRef<number>(Date.now())
  const lastSent = useRef<Record<string, number>>({ ...elapsed.current })

  function currentElapsed(responseId: string): number {
    const base = elapsed.current[responseId] ?? 0
    return responseId === response.id ? base + (Date.now() - shownAt.current) : base
  }

  // Fold the visible question's running time into its total and restart the clock.
  function bankElapsed() {
    elapsed.current[response.id] = currentElapsed(response.id)
    shownAt.current = Date.now()
  }

  // Sends elapsed_ms for a response if it moved since the last send.
  function flushElapsed(responseId: string) {
    const ms = Math.round(elapsed.current[responseId] ?? 0)
    if (ms === lastSent.current[responseId]) return
    lastSent.current[responseId] = ms
    trackSave(answerResponse(attempt.id, responseId, { elapsed_ms: ms })).catch((err) => console.error('Failed to save elapsed time:', err))
  }
```

Change `goTo`:

```tsx
  function goTo(i: number) {
    bankElapsed()
    flushElapsed(response.id)
    setIndex(i)
    setMaxReached((m) => Math.max(m, i))
  }
```

Add a `useEffect` that resets `shownAt` when `index` changes: `useEffect(() => { shownAt.current = Date.now() }, [index])`.

In `selectChoice`, `setConfidence`, `setIdk`, and the debounced written save, call `bankElapsed()` first and include `elapsed_ms: Math.round(elapsed.current[response.id] ?? 0)` in the PATCH body (for the written debounce, capture `const ms = ...` inside the timeout callback using `currentElapsed(responseId)`), and after each send set `lastSent.current[response.id]` to the value sent.

In `next()`'s Finish branch, before flushing debounced saves: `bankElapsed(); flushElapsed(response.id)`.

- [ ] **Step 2: Review.tsx — mean over graded**

Replace the `meanScore` line:

```tsx
  const meanScore = graded.length > 0 ? scoreSum / graded.length : null
  const ungradedCount = questions.length - graded.length
```

and the score display:

```tsx
            <div className="review-score">{meanScore === null ? '—' : meanScore.toFixed(2)}</div>
            <div className="review-score-sub">
              {correctCount} correct &middot; {incorrectCount} incorrect{partialCount > 0 ? ` · ${partialCount} partial` : ''}{ungradedCount > 0 ? ` · ${ungradedCount} ungraded` : ''}
            </div>
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc -b && npx oxlint`
Expected: clean. Then start the web dev server against a running local server (launch config `web` + a server; `server/.env.mathstress` is a seeded canonical), take a template attempt, and confirm with the browser network panel that the PATCH bodies carry a growing `elapsed_ms` and that Finish sends one for the last question. Confirm the Review header shows "n ungraded" for a quiz with written items.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Take.tsx web/src/components/Review.tsx
git commit -m "feat(web): record time-on-question as elapsed_ms; Review mean ignores ungraded responses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Canonical `POST /sync/template-draw` and `createAttempt` with an explicit draw

**Files:**
- Modify: `server/src/domain/sync.ts` (add `buildTemplateDrawResponse` after `buildQuestionPayloads`)
- Modify: `server/src/http/app.ts` (route next to `/sync/daily-draw`)
- Modify: `server/src/domain/attempts.ts` (`CreateAttemptInput`, template branch of `createAttempt` ~139-162)
- Test: `server/tests/templateDraw.test.ts`

**Interfaces:**
- Produces: `buildTemplateDrawResponse(db, templateId): TemplateDrawResponse` where

```typescript
export interface TemplateDrawResponse {
  protocol_version: number; template_id: string;
  tags: PullResponse["tags"]; questions: Record<string, unknown>[]; question_order: string[];
  short_draw: boolean; requested: number; returned: number; mix_adjusted: boolean;
}
```

- `CreateAttemptInput` template variant: `{ node_id; source: "template"; template_id; questions?: EligibleQuestion[] }`. `createAttempt` throws `DomainError("empty_draw")` when the draw (local or explicit) has zero questions.
- Route `POST /sync/template-draw` body `{ template_id }` → `TemplateDrawResponse`; 404 `{ error: "not_found" }`, 400 `{ error: "template_retired" }`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/templateDraw.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { buildTemplateDrawResponse } from "../src/domain/sync.js";
import { createTemplate, retireTemplate } from "../src/domain/templates.js";
import { createAttempt } from "../src/domain/attempts.js";
import { DomainError } from "../src/domain/errors.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

function canonicalApp(db: ReturnType<typeof openTestDb>) {
  const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
                uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
  return buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime() });
}

describe("buildTemplateDrawResponse", () => {
  it("returns the drawn questions with tags (ancestor closure) and a matching question_order", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:alg", "math");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["math:alg"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["math:alg"] }, question_count: 2 });

    const r = buildTemplateDrawResponse(db, t.id);
    expect(r.template_id).toBe(t.id);
    expect(r.questions).toHaveLength(2);
    expect(r.question_order).toEqual(r.questions.map((q) => q.id));
    expect(r.tags.map((x) => x.slug)).toEqual(["math", "math:alg"]);
    expect(r.requested).toBe(2);
    expect(r.returned).toBe(2);
    expect(r.short_draw).toBe(false);
  });

  it("a frozen template returns its frozen set in order", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "f", tag_query: { all: ["a"] }, question_count: 2, frozen: true });
    const frozen = (db.prepare("SELECT question_id FROM template_frozen_question WHERE template_id = ? ORDER BY ordinal").all(t.id) as { question_id: string }[]).map((r) => r.question_id);
    expect(buildTemplateDrawResponse(db, t.id).question_order).toEqual(frozen);
  });
});

describe("POST /sync/template-draw", () => {
  it("serves the draw on canonical; 404 unknown; 400 retired", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });
    const app = canonicalApp(db);
    await app.ready();

    const ok = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: t.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().questions).toHaveLength(1);

    const missing = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: uuidv4() } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("not_found");

    retireTemplate(db, t.id);
    const retired = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: t.id } });
    expect(retired.statusCode).toBe(400);
    expect(retired.json().error).toBe("template_retired");
    await app.close();
  });
});

describe("createAttempt with an explicit draw", () => {
  it("uses the given questions in the given order and skips the local draw", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });

    const r = createAttempt(db, {
      node_id: "n", source: "template", template_id: t.id,
      questions: [{ id: q2.id, lineage_id: q2.lineage_id, type: "mc" }, { id: q1.id, lineage_id: q1.lineage_id, type: "mc" }],
    });
    const rows = db.prepare("SELECT question_id FROM response WHERE attempt_id = ? ORDER BY ordinal").all(r.attempt_id) as { question_id: string }[];
    expect(rows.map((x) => x.question_id)).toEqual([q2.id, q1.id]);
  });

  it("rejects an empty draw instead of creating an attempt with no responses", () => {
    const db = openTestDb();
    insertTag(db, "empty");
    const t = createTemplate(db, { name: "t", tag_query: { all: ["empty"] }, question_count: 3 });
    expect(() => createAttempt(db, { node_id: "n", source: "template", template_id: t.id })).toThrow(DomainError);
    expect(() => createAttempt(db, { node_id: "n", source: "template", template_id: t.id, questions: [] })).toThrow(/empty_draw|no eligible/i);
    expect((db.prepare("SELECT COUNT(*) AS n FROM attempt").get() as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/templateDraw.test.ts`
Expected: FAIL — `buildTemplateDrawResponse` not exported; route 404 with Fastify's default body; `questions` option ignored.

- [ ] **Step 3: Implement `buildTemplateDrawResponse`**

In `server/src/domain/sync.ts`, add an import at the top:

```typescript
import { resolveTemplateDraw } from "./draw.js";
import { PROTOCOL_VERSION } from "../protocol.js";
```

and after `buildQuestionPayloads`:

```typescript
// ----------------------------------------------------------------------------
// buildTemplateDrawResponse (canonical side of a "cloud test"): resolve a
// template's draw here, on the full bank, and ship the drawn questions plus
// the tag closure they need, so a local node that never downloaded the
// template's slices can still run it while online. Same shape and mirroring
// contract as /sync/daily-draw.
// ----------------------------------------------------------------------------

export interface TemplateDrawResponse {
  protocol_version: number;
  template_id: string;
  tags: PullResponse["tags"];
  questions: Record<string, unknown>[];
  question_order: string[];
  short_draw: boolean;
  requested: number;
  returned: number;
  mix_adjusted: boolean;
}

export function buildTemplateDrawResponse(db: DatabaseSync, templateId: string): TemplateDrawResponse {
  const draw = resolveTemplateDraw(db, templateId); // throws not_found / template_retired
  const order = draw.questions.map((q) => q.id);
  const questions = buildQuestionPayloads(db, order);
  const usedTagSlugs = [...new Set(questions.flatMap((q) => (q as { tags: string[] }).tags))];
  return {
    protocol_version: PROTOCOL_VERSION,
    template_id: templateId,
    tags: fetchTagAncestorClosure(db, usedTagSlugs),
    questions,
    question_order: order,
    short_draw: draw.short_draw,
    requested: draw.requested,
    returned: draw.returned,
    mix_adjusted: draw.mix_adjusted ?? false,
  };
}
```

(`buildQuestionPayloads` orders by id; `question_order` carries the draw order, which the local side uses.)

- [ ] **Step 4: Route**

In `server/src/http/app.ts`, add `buildTemplateDrawResponse` to the `../domain/sync.js` import and `DomainError` from `../domain/errors.js`, then inside the canonical block after `/sync/daily-draw`:

```typescript
    app.post("/sync/template-draw", async (request, reply) => {
      const { template_id } = (request.body ?? {}) as { template_id?: unknown };
      if (typeof template_id !== "string" || template_id.length === 0) {
        reply.code(400).send({ error: "invalid_template_id", message: "template_id (string) is required" });
        return;
      }
      try {
        return buildTemplateDrawResponse(ctx.db, template_id);
      } catch (err) {
        if (err instanceof DomainError) {
          reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }
    });
```

- [ ] **Step 5: `createAttempt` explicit questions + empty-draw guard**

In `attempts.ts`, change the template variant of `CreateAttemptInput`:

```typescript
  | {
      node_id: string;
      source: "template";
      template_id: string;
      // A draw already resolved elsewhere (the canonical node, for a cloud
      // test). When present the local pool is not consulted at all.
      questions?: EligibleQuestion[];
    }
```

(import `type EligibleQuestion` from `./draw.js`). In the template branch replace `const draw = resolveTemplateDraw(db, input.template_id);` with:

```typescript
    let questions: EligibleQuestion[];
    if (input.questions) {
      const exists = db.prepare("SELECT retired_at FROM template WHERE id = ?").get(input.template_id) as { retired_at: string | null } | undefined;
      if (!exists) throw new DomainError("not_found", `Template "${input.template_id}" does not exist.`);
      if (exists.retired_at) throw new DomainError("template_retired", `Template "${input.template_id}" is retired.`);
      questions = input.questions;
    } else {
      questions = resolveTemplateDraw(db, input.template_id).questions;
    }
    // An attempt with no responses can't be taken (the Take screen has nothing
    // to show) and would sit in history as a phantom zero — refuse it.
    if (questions.length === 0) {
      throw new DomainError("empty_draw", "No eligible questions for this template on this node.");
    }
```

and use `questions` in place of `draw.questions` for the inserts and the return value.

- [ ] **Step 6: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: green. If an existing test created a template attempt over an empty pool and expected success, it was relying on the phantom behaviour — update it to expect `empty_draw`.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/sync.ts server/src/http/app.ts server/src/domain/attempts.ts server/tests/templateDraw.test.ts
git commit -m "feat: POST /sync/template-draw on canonical; createAttempt accepts a pre-resolved draw and rejects empty ones

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Local side — `fetchAndApplyTemplateDraw`, `isTemplateDownloaded`, and the `POST /api/attempts` branch

**Files:**
- Modify: `server/src/sync/client.ts` (after `fetchAndApplyDailyDraw`)
- Modify: `server/src/domain/templates.ts` (add `isTemplateDownloaded`; use it in `toSummary`)
- Modify: `server/src/http/apiRoutes.ts` (template branch of `POST /api/attempts`, ~262-269)
- Test: `server/tests/cloudTemplateRoutes.test.ts`

**Interfaces:**
- Consumes: `buildTemplateDrawResponse` route (Task 8), `createAttempt` with `questions` (Task 8), `upsertBankContent` (existing).
- Produces: `fetchAndApplyTemplateDraw(ctx, templateId): Promise<{ questions: EligibleQuestion[]; short_draw; requested; returned; mix_adjusted }>`; `isTemplateDownloaded(db, templateId): boolean`; local `POST /api/attempts` returns 503 `{ reason: "template_requires_connection" }` when offline and not downloaded.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/cloudTemplateRoutes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime, runSync } from "../src/sync/client.js";
import { createTemplate, isTemplateDownloaded } from "../src/domain/templates.js";
import { addSlice } from "../src/domain/sync.js";
import { insertTag, insertQuestion } from "./helpers.js";

function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("cloud tests: a local node runs a non-downloaded template via canonical", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osmosis-cloud-")); });

  it("online → draws from canonical and mirrors the questions; offline → 503; downloaded → local draw", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    insertTag(canonicalDb, "geo");
    for (let i = 0; i < 4; i++) insertQuestion(canonicalDb, { tags: ["geo"] });
    const template = createTemplate(canonicalDb, { name: "geo test", tag_query: { all: ["geo"] }, question_count: 2 });
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime() });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l.db");
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };
    const app = buildApp(ctx);

    // The template row itself arrives with an ordinary pull (templates always sync);
    // no slice for "geo" is held, so it is a cloud test.
    runtime.online = true;
    await runSync(ctx, runtime);
    expect(localDb.prepare("SELECT id FROM template WHERE id = ?").get(template.id)).toBeTruthy();
    expect(isTemplateDownloaded(localDb, template.id)).toBe(false);
    expect((localDb.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(0);

    // Offline: refused with a reason the app can render.
    runtime.online = false;
    const offline = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(offline.statusCode).toBe(503);
    expect(offline.json().reason).toBe("template_requires_connection");

    // Online: canonical draws, the local node mirrors exactly those questions and takes the attempt.
    runtime.online = true;
    const online = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(online.statusCode).toBe(200);
    const body = online.json();
    expect(body.questions).toHaveLength(2);
    expect(body.requested).toBe(2);
    const mirrored = (localDb.prepare("SELECT id FROM question").all() as { id: string }[]).map((r) => r.id).sort();
    expect(mirrored).toEqual(body.questions.map((q: { id: string }) => q.id).sort());
    const detail = await app.inject({ method: "GET", url: `/api/attempts/${body.attempt_id}` });
    expect(detail.json().responses).toHaveLength(2);
    expect(detail.json().source).toBe("template");

    // Downloaded: after adding the slice and pulling, the draw is local and works offline.
    addSlice(localDb, "geo");
    await runSync(ctx, runtime);
    expect(isTemplateDownloaded(localDb, template.id)).toBe(true);
    runtime.online = false;
    const local = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(local.statusCode).toBe(200);
    expect(local.json().questions).toHaveLength(2);

    await app.close();
    await canonicalApp.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/cloudTemplateRoutes.test.ts`
Expected: FAIL — `isTemplateDownloaded` not exported; the offline request creates an attempt or errors with `empty_draw`.

- [ ] **Step 3: `isTemplateDownloaded`**

In `templates.ts`, above `toSummary`:

```typescript
// A template is "downloaded" on this node when every tag literal its
// tag_query references is a held slice. Local draws are only meaningful then;
// otherwise the template is a cloud test (see sync/client.ts
// fetchAndApplyTemplateDraw). Canonical holds the whole bank and never asks.
export function isTemplateDownloaded(db: DatabaseSync, templateId: string): boolean {
  const row = db.prepare("SELECT tag_query FROM template WHERE id = ?").get(templateId) as { tag_query: string } | undefined;
  if (!row) throw new DomainError("not_found", `Template "${templateId}" does not exist.`);
  const literals = referencedTagLiterals(JSON.parse(row.tag_query) as TagQuery);
  if (literals.length === 0) return false;
  const held = (
    db.prepare(`SELECT COUNT(*) AS n FROM local_slice WHERE tag_slug IN (${literals.map(() => "?").join(",")})`).get(...literals) as { n: number }
  ).n;
  return held === literals.length;
}
```

Leave `toSummary`'s own slice query as is (it also needs `pulled_at`).

- [ ] **Step 4: `fetchAndApplyTemplateDraw`**

In `sync/client.ts`, import `type TemplateDrawResponse` from `../domain/sync.js` and add after `fetchAndApplyDailyDraw`:

```typescript
// Cloud test: the local node holds the template row (templates always sync)
// but not the slices behind it. Ask canonical to resolve the draw on the full
// bank and mirror exactly the drawn questions (+ their tag closure) locally so
// the attempt's responses have real question rows to reference and the
// attempt pushes up like any other.
export async function fetchAndApplyTemplateDraw(
  ctx: AppContext,
  templateId: string
): Promise<{ questions: { id: string; lineage_id: string; type: "mc" | "written" }[]; short_draw: boolean; requested: number; returned: number; mix_adjusted: boolean }> {
  if (!ctx.env.remoteUrl) throw new Error("no remote_url configured");
  const res = await fetch(`${ctx.env.remoteUrl}/sync/template-draw`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: templateId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`template-draw fetch failed: HTTP ${res.status}`);
  const payload = (await res.json()) as TemplateDrawResponse;

  const db = ctx.db;
  db.exec("BEGIN");
  try {
    upsertBankContent(db, payload.tags, payload.questions);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const byId = new Map((payload.questions as { id: string; lineage_id: string; type: "mc" | "written" }[]).map((q) => [q.id, q]));
  const questions = payload.question_order.map((qid) => {
    const q = byId.get(qid);
    if (!q) throw new Error(`template-draw response missing question ${qid} in its own questions array`);
    return { id: q.id, lineage_id: q.lineage_id, type: q.type };
  });
  return { questions, short_draw: payload.short_draw, requested: payload.requested, returned: payload.returned, mix_adjusted: payload.mix_adjusted };
}
```

- [ ] **Step 5: Route branch**

In `apiRoutes.ts`, import `isTemplateDownloaded` from `../domain/templates.js` and `fetchAndApplyTemplateDraw` from `../sync/client.js`. Replace the `source === "template"` branch body (after the `template_id` check) with:

```typescript
        // Canonical is the bank; a downloaded template has its slices here.
        // Anything else is a cloud test: canonical resolves the draw while
        // we're online, and offline it simply isn't available on this device.
        if (ctx.env.role === "canonical" || isTemplateDownloaded(db, body.template_id)) {
          return createAttempt(db, { node_id: ctx.node.id, source: "template", template_id: body.template_id }, ctx.env.role);
        }
        if (!ctx.runtime.online) {
          reply.code(503).send({ reason: "template_requires_connection" });
          return;
        }
        let drawn;
        try {
          drawn = await fetchAndApplyTemplateDraw(ctx, body.template_id);
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("template-draw fetch failed")) {
            reply.code(503).send({ reason: "template_requires_connection" });
            return;
          }
          throw err;
        }
        const result = createAttempt(
          db,
          { node_id: ctx.node.id, source: "template", template_id: body.template_id, questions: drawn.questions },
          ctx.env.role
        );
        return { attempt_id: result.attempt_id, questions: result.questions, short_draw: drawn.short_draw,
                 requested: drawn.requested, returned: drawn.returned, mix_adjusted: drawn.mix_adjusted };
```

(`isTemplateDownloaded` throws `not_found` for an unknown template; the surrounding `try` already routes `DomainError` to `sendDomainError`.)

- [ ] **Step 6: Run tests**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/src/sync/client.ts server/src/domain/templates.ts server/src/http/apiRoutes.ts server/tests/cloudTemplateRoutes.test.ts
git commit -m "feat: cloud tests — a local node runs a non-downloaded template through canonical while online, 503 offline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: App — cloud/downloaded badges, offline gating, error copy

**Files:**
- Modify: `web/src/lib/api.ts` (`CreateDailyAttemptResult`/`createAttempt` error text)
- Modify: `web/src/data/templates.ts` (view model gains `downloaded: boolean`)
- Modify: `web/src/lib/templateView.ts` (`toViewTemplate` passes `downloaded: t.downloaded`)
- Modify: `web/src/components/Library.tsx`, `web/src/components/Home.tsx`, `web/src/components/TemplateDetail.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `TemplateSummary.downloaded` (API, existing), `NodeStatus.online` / `.canonical` (existing), 503 `reason: "template_requires_connection"` (Task 9).

- [ ] **Step 1: Types and copy**

`web/src/data/templates.ts`: add `downloaded: boolean` to the view `TemplateSummary`. `templateView.ts` `toViewTemplate`: add `downloaded: t.downloaded`. In `api.ts` `createAttempt`, map the reason to readable copy before throwing:

```typescript
    const reason = body.reason || body.error
    const message =
      reason === 'template_requires_connection'
        ? 'This test needs a connection, or download it first to use it offline.'
        : reason === 'empty_draw'
          ? 'No questions match this test on this device yet.'
          : reason || `POST /api/attempts ${res.status}`
    throw new Error(message)
```

- [ ] **Step 2: Availability helper**

Add to `web/src/lib/templateView.ts`:

```typescript
// Whether Start should be enabled for a template on this device right now.
// Canonical holds the whole bank; a downloaded template draws locally; a
// cloud template needs the node to be online. `status` null = unknown, so be
// permissive and let the server say no.
export function templateAvailable(
  t: { downloaded: boolean },
  status: { online: boolean; canonical: boolean } | null
): boolean {
  if (!status) return true
  return status.canonical || t.downloaded || status.online
}

export const OFFLINE_CLOUD_HINT = 'Offline — download this test to use it offline'
```

- [ ] **Step 3: Library**

In `Library.tsx`: import `templateAvailable, OFFLINE_CLOUD_HINT`. On each card, always render the state badge (replace the `t.downloaded &&` block):

```tsx
              <span
                className={`library-card-downloaded${t.downloaded ? '' : ' cloud'}${t.update_available ? ' update-available' : ''}`}
                title={t.downloaded ? (t.update_available ? 'Update available' : 'Downloaded — works offline') : 'Cloud — needs a connection'}
              >
                {t.downloaded ? (t.update_available ? <RefreshIcon size={11} /> : <DownloadIcon size={11} />) : <GlobeIcon size={11} />}
              </span>
```

(import `GlobeIcon` from `./icons`.) In the detail panel, the `On this device` column gets a line `{isCanonical ? 'whole bank held on this node' : selected.downloaded ? 'downloaded · works offline' : 'cloud · needs a connection'}` in place of the existing canonical-only text, and the Start button becomes:

```tsx
            <button
              className="library-detail-start"
              onClick={() => onStart(selected.id)}
              disabled={!templateAvailable(selected, status)}
              title={templateAvailable(selected, status) ? undefined : OFFLINE_CLOUD_HINT}
            >
              Start &rarr;
            </button>
```

Add to `Library.css`: `.library-card-downloaded.cloud { opacity: 0.55; }`.

- [ ] **Step 4: Home and TemplateDetail**

`Home.tsx` already has `status`. Import `templateAvailable, OFFLINE_CLOUD_HINT` and change the selected-template Start button:

```tsx
              <button
                className="start-btn"
                onClick={() => onStart(selected.id)}
                disabled={!!starting || !templateAvailable(selected, status)}
                title={templateAvailable(selected, status) ? undefined : OFFLINE_CLOUD_HINT}
              >
                {starting ? 'Starting…' : 'Start →'}
              </button>
```

Append to the row meta: in `toViewTemplate`, add `t.downloaded ? 'downloaded' : 'cloud'` as the last `metaParts` entry.

`TemplateDetail.tsx`: add props `canStart?: boolean` and `startHint?: string`, and on its Start button `disabled={canStart === false}` `title={canStart === false ? startHint : undefined}`. In `Home.tsx` where `TemplateDetail` is rendered pass `canStart={templateAvailable(opened, status)}` and `startHint={OFFLINE_CLOUD_HINT}`.

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc -b && npx oxlint`
Expected: clean. Browser pass against `server/.env.mathstress` (canonical): every template shows no offline gating and no download controls. For the local-node behaviour, rely on Task 9's HTTP test; a manual local-node run needs a second server with `NODE_ROLE=local` and is optional.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): cloud vs downloaded badges; Start disabled offline for cloud tests; readable start errors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Documentation and deploy to the hosted server

**Files:**
- Modify: `MCP-SPEC.md` (§3 tool table: `get_attempt`; outcome record fields under `await_item_outcome`/`submit_quick_check`; `get_due_items` reason; note null-score semantics under `get_results`)
- Modify: `DEPLOY.md` (add a "Local nodes" sentence: non-downloaded templates run as cloud tests while online)

- [ ] **Step 1: Docs**

Make the edits above; keep each to the sentence that states the new behaviour.

- [ ] **Step 2: Full verification**

Run: `cd server && npm run typecheck && npx vitest run && cd ../web && npx tsc -b && npx oxlint && npm run build`
Expected: all green.

- [ ] **Step 3: Commit and push**

```bash
git add MCP-SPEC.md DEPLOY.md
git commit -m "docs: get_attempt, outcome record, due reasons, null-score semantics, cloud tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Deploy**

Run from the dev machine (key auth, passwordless sudo on the host):

```bash
ssh benif@192.168.5.66 'cd ~/Osmosis && git pull -q && bash deploy/install.sh 2>&1 | tail -15'
```

Expected: `==> osmosis is up on port 8081` and, in `sudo journalctl -u osmosis -n 5`, `Applied migrations: 015_null_score_not_zero.sql`.

- [ ] **Step 5: Verify the live outcome record through the public URL**

With `T=$(ssh benif@192.168.5.66 "sudo grep '^MCP_AUTH_TOKEN=' /etc/osmosis/canonical.env | cut -d= -f2")`, call `tools/list` and confirm `get_attempt` is present:

```bash
curl -sS -X POST "https://osmosis.bennuuunnni.org/mcp/$T" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"get_attempt"'
```

Then in the app at `http://100.86.89.59:8081/`: the Home pill reads `up to date · …`, and after answering a live item from the tutor, `await_item_outcome` returns `response_text` and `outcome`.

---

## Self-review notes

- Spec §1 → Task 1; §1 `get_attempt` → Task 2; §2 → Task 3; §3 → Task 7; §4 → Task 4 (+ Review in Task 7); §5 → Task 5; §6 → Task 6; §7 canonical → Task 8, local + route → Task 9, app → Task 10; Deployment → Task 11.
- Names used across tasks: `deriveOutcome`, `AnsweredOutcome`, `buildTemplateDrawResponse`, `TemplateDrawResponse`, `fetchAndApplyTemplateDraw`, `isTemplateDownloaded`, `templateAvailable`, `OFFLINE_CLOUD_HINT`, `reason: "template_requires_connection"` — each defined in exactly one task and consumed by name afterwards.
