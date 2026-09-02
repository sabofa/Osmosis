# Tutor Item-Engine Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Scope note (read before executing):** this plan covers 7 architecturally distinct components (per the tutor's own handoff doc). Per `superpowers:writing-plans`' own scope-check rule, a spec this size should really be 7 sub-plans. Phase 1 below is written to full bite-sized TDD detail for its backend pieces because they're concrete today and unblock everything else — execute those as-is. The pieces of Phase 1 that are NOT full TDD are the web-app frontend components (Task 1.6's session UI, Task 1.7's live-item view) — real frontend/UX work with one remaining Decision Point (polling cadence) that this plan flags rather than guesses at. Phases 2-7 are written to file/schema/decision detail, not literal step-by-step test code, for the same reason — see each phase's Decision Point callouts. Before executing a Phase 2+ task list as literal TDD steps, resolve its Decision Points first and expand that phase into its own dated plan file using this one as the spec.
>
> **Revision note (2026-09-01, second pass):** this plan's first draft got the delivery surface wrong, the same way an earlier draft of the tutor's own handoff did. It designed `present_item`/`submit_response` as a synchronous pair where the tutor renders the question directly in its own chat transcript and Ben answers there. The handoff's revised §3 explicitly retracts that framing: the **Osmosis app**, not the chat transcript, is the primary rendering surface — because it can show multiple-choice with real distractor diagnostics and render graph-engine/Desmos content that a transcript cannot express at all, not merely to dodge the transcript-visibility problem. This revision restructures Phase 1 and restores a real Phase 3 to match. The original synchronous chat pair survives only in a narrower role — §3.3's single free-response in-node check — under the new names `quick_check`/`submit_quick_check` (Task 1.8).
>
> **Revision note (2026-09-01, third pass):** added the tutor-session concept per Ben's own design — a `create_session` MCP tool groups everything a tutor does (live items, session-specific tests) under one named, logged, navigable container in the app, resolving what was previously an open "screen vs. overlay vs. indicator" Decision Point in Task 1.6/1.7. Homework and other non-session flows are untouched (nullable FK, zero special-casing elsewhere). See Task 1.6.
>
> **Revision note (2026-09-02, fourth pass):** added Phase 8 — the tutor's own follow-on analysis, after being told about the session design, identified that the session sandbox is a *second output surface* for the tutor, not just a delivery mechanism, since the original handoff assumed text-only output throughout. This reopens several previously-settled corners: an interactive dependency-graph checkpoint (Item 1, top build priority), true in-session attempt capture that closes this plan's most dangerous known-open question — charitable repair masking what Ben actually attempted (Item 2, second priority) — a visible scaffold-rung dial, side-by-side attempt/canonical contrast, interleaved live queues, and session-scoped confusion-pattern computation. Also surfaced a real gap in Task 1.6 (no MCP-side way for the tutor to read its own session history back) and in Phase 2 (no way to keep a hastily-authored session-scratch item out of the general bank until it's actually good — a new "promote to bank" path). One item — a shared mid-node scratchpad — is flagged as something to build carefully or not at all, since it can defeat commit-before-reveal if the tutor can write into it while Ben is mid-attempt; this is now a hard Global Constraint, not just a note.

**Goal:** Turn Osmosis from a request/response question bank queried by an authoring LLM into the shared item-engine for a four-part system — presenting items live mid-conversation (rendered in the Osmosis app, not the chat transcript) to a tutor, capturing rich diagnostic outcomes (not just pass/fail), and eventually owning retention scheduling — without the tutor or any other component reaching around Osmosis to store items or track retention itself.

**Architecture:** Extend the existing attempt/response/grade lifecycle (`server/src/domain/attempts.ts`) rather than building a parallel "live session" subsystem — and extend the existing web Take screen rather than building a parallel rendering surface. The withholding pattern that today powers `Take.tsx` (`questionSnapshot(db, questionId, revealAnswer)`, `attempts.ts:58-101`) and the HTTP routes it already calls (`PATCH /api/attempts/:id/responses/:response_id`, `POST /api/attempts/:id/submit` — `apiRoutes.ts:265-295`) are reused almost unchanged for live delivery: what's missing is (a) a way for the tutor to create an attempt via MCP instead of Ben picking a template in the app, (b) a way for the app to discover that attempt exists and render it without Ben doing anything to start it, and (c) a way for the tutor to learn the outcome once Ben answers in the app. None of that requires new grading or withholding logic — `getAttemptDetail`/`answerResponse`/`submitAttempt` already do exactly what's needed. The `'adhoc'` attempt source this all sits on is already schema-legal (`server/migrations/001_init.sql:207-208`) but not yet implemented in `createAttempt` (which currently throws `unsupported_source` for anything but `'template'` — `attempts.ts:132-138`). Everything downstream (rich outcomes, scheduling, audit, identity) is new schema and new domain modules that plug into this same attempt/response backbone.

**Tech stack:** TypeScript, `node:sqlite` `DatabaseSync`, Zod (`server/src/mcp/tools.ts`), Vitest (`server/tests/`), `@modelcontextprotocol/sdk`, React (`web/src/`), Fastify (`server/src/http/`).

**How "live" actually works, mechanically (verified 2026-09-01):** Osmosis's MCP transport is **not** stdio — it's `StreamableHTTPServerTransport` mounted at `POST/GET /mcp/:token` on the canonical Fastify server (`server/src/mcp/server.ts:36-52`), token-gated, explicitly designed (per the code's own comments) for a remote Claude session's shell — cloudflared-tunneled — to reach. The handler runs in **stateless mode** (`sessionIdGenerator: undefined`): every single HTTP request gets a brand-new `McpServer` + transport pair, connected and torn down within that one request (`server.ts:43-51`). A tutor session — co-located with canonical Osmosis or reaching it over the network, doesn't matter — connects to the exact same `/mcp/:token` endpoint every authoring session already uses. Two consequences that shape this whole plan:

1. **No MCP tool call can stay open indefinitely waiting on Ben.** A stateless-per-request HTTP transport behind a tunnel is not a reliable place to block for however long Ben takes to answer in the app — could be seconds, could be five minutes if he's mid-thought about something else. So the app-mediated live loop (§3.2 of the handoff) can't be one blocking `present_item` call; it has to be `present_item` (returns immediately) followed by the tutor calling a bounded-wait `await_item_outcome` (returns either the outcome or "still waiting," and the tutor calls it again if the latter). This is the standard human-in-the-loop polling pattern for agent tools, and it's what Tasks 1.2/1.3 below implement.
2. **State that must survive between calls lives in the canonical SQLite database, not in any MCP session** — the MCP session doesn't outlive a single HTTP request. This is actually convenient: it's the same database the web app's HTTP routes already read and write, so "the tutor created an attempt via MCP" and "the app is polling for a pending attempt to render" are just two different processes reading the same `attempt`/`response` rows, no new coordination mechanism needed.

**Concrete gap this surfaces:** `registerTools(server, ctx.db, ctx.env.uploadsDir)` (`server/src/mcp/tools.ts`'s exported setup function, called from `buildMcpServer(ctx)` in `mcp/server.ts:10-14`) currently has no access to `ctx.node` at all — no tool handler can read the canonical node's own id today. Task 1.2 below fixes this directly.

**Spec:** The tutor's handoff document, revised 2026-09-01 (pasted into the planning conversation, not yet saved as a file in this repo — recommend saving a copy to `docs/handoffs/2026-09-01-tutor-osmosis-handoff.md` as part of Task 0 below, so it travels with this plan for future readers — if an earlier, superseded draft was already saved there, replace it rather than keeping both). Cross-checked against this repo's actual state by three research passes on 2026-09-01 — see "What the handoff got right and wrong about this repo" below.

## What the handoff got right and wrong about this repo

The handoff already correctly flags (in its own "What the tutor got wrong" section) that no FSRS exists, no live request/response exists, and Osmosis doesn't administer tests the way it assumes — all confirmed true by direct repo inspection. Additionally, this research pass found:

- **The live-I/O gap is smaller than the handoff assumes, but not as small as this plan's own first draft claimed.** The attempt/response/grade lifecycle, the answer-withholding snapshot pattern, and MC auto-grading already exist and are exercised daily by the web app — that part is genuinely proven machinery. But the app-mediated delivery loop the revised §3 requires (present via MCP → app discovers and renders it → Ben answers in the app → tutor learns the outcome) needs real new plumbing beyond the backend: a discovery mechanism for the app (Task 1.4's polling route), a session concept to organize and navigate to live items (Task 1.6), new frontend UI (Task 1.7), and a bounded-poll MCP pattern (Task 1.3) — not just two thin MCP wrappers around existing functions, which is what this plan's first draft under-scoped it as. See the revised "Scope estimate" section at the end.
- **Distractor-rationale metadata does not exist.** The `choice` table (`001_init.sql`) is `id, question_id, body, is_correct, ordinal` only — no field for "what wrong model does picking this represent." The handoff's §4 ("the option chosen is the diagnosis") requires new schema, not just new capture logic. See Phase 4.
- **No confidence/IDK capture exists.** `response.skipped` is the only adjacent field, and it conflates "didn't attempt" with "attempted but unsure." See Phase 4.
- **No scheduling/FSRS/retention concept exists at all** (confirmed by grep — zero hits for `fsrs`, `next_review`, `retention` as a scheduling concept). The only adjacent mechanism is `weak_weighted` draw weighting (`domain/draw.ts:65-115`), which biases random *draw* selection by recent score history — it has no `due_at`, no interval, no per-item schedule state. Phase 5 is genuinely new.
- **Tag slugs are the only identity/hierarchy key today, and they're less structured than the handoff assumes.** `tag.slug` is a free-form colon-segmented string (`math:functions:quadratic`) with a separate, independently-maintained `parent_slug` FK — the colon convention and the FK are two signals of hierarchy that aren't derived from one another. There is no `textbook_slug`/`section` concept, no node-grain concept, nothing self-directed-topic-shaped. See Phase 7 and the identity Decision Point.
- **Desmos and graph-engine are two unrelated things, not one "graphing" system** — confirmed directly and load-bearing for the revised §3, since it's the reason the app has to be the primary surface: `graph-engine` (its own DSL, parses `question.graph_spec`, is the real graph-as-item-content renderer, rendered by `web/src/components/GraphPanel.tsx`) is unrelated to `DesmosPanel.tsx` (a blank scratch-work calculator gated on `question.desmos_allowed`, with zero connection to `graph_spec`). Both are genuinely app-only — neither can render inside a Claude Code transcript — which is exactly the handoff's point.

## Global Constraints

- **Boundary rule (from the handoff, binding on this plan too):** Osmosis never calls D2L, never parses a PDF for content extraction beyond what `lib/extract/` already does for asset ingestion, and never reaches into the tutor's diagnosis logic. Anything Osmosis needs that isn't already published gets added to a component's own surface, not fetched sideways.
- **Osmosis owns scheduling and decay modeling entirely once Phase 5 exists.** The tutor supplies a retention-target ratio and a reason; when an item resurfaces is Osmosis's call, never the tutor's.
- **All new MCP tools follow the existing `ok(...)`/`fail(...)` response envelope** (`server/src/mcp/tools.ts:57-69`) and Zod `inputSchema` pattern already used by all 21 existing tools.
- **The withholding invariant is load-bearing, not a nicety, and applies regardless of delivery surface:** no MCP tool response may ever put `is_correct`, `explanation`, `model_answer`, or `rubric` into its response before the corresponding outcome is known — this matters even for app-rendered items, because Ben can watch the tutor's own tool-call transcript in Claude Code and would see anything `present_item`/`await_item_outcome` returns just as easily as anything inline in chat. This is what makes commit-before-reveal possible (the evidence the handoff cites: Buçinca et al. 2021).
- **`quick_check` (Task 1.8) is free-response only, enforced in code, not by convention.** §3.3 of the handoff scopes it to "one question, free-response, minimal" specifically because it's the one case that stays in chat — an MC quick-check in chat would leak the answer key into the transcript the same way the original (superseded) design would have, and would forgo the app's distractor-diagnostic recovery for no reason, since nothing prevents routing an MC item through the app-mediated loop (Tasks 1.2/1.3) instead, even for a short check.
- **Migrations are additive, forward-only SQL files** under `server/migrations/`, numbered sequentially after the current highest (`008_model_grader_daily_limit.sql`), following the existing `migrate.ts` convention (tracked-by-filename, run once, in order).
- **New domain modules get Vitest tests under `server/tests/`** using the existing `openTestDb()`/`insertTag()`/`insertQuestion()` helpers (`server/tests/helpers.ts`) — extend `helpers.ts` with new seed helpers as new phases need them, following the existing `seedScoredResponse`/`isoAgo`/`mulberry32` pattern rather than duplicating setup logic per test file.
- **A mid-attempt shared scratchpad, if ever built (Phase 8), must be strictly turn-based** — the tutor may write into it only after Ben has committed his current turn, never while an attempt is in progress and uncommitted. This is the same withholding invariant above, restated for a feature that would otherwise defeat it silently. See Phase 8's guardrail section for the full reasoning.
- Run `cd server && npm run typecheck && npm test` before every commit.

---

## Task 0: Save the handoff spec into the repo

**Files:**
- Create (or replace, if an earlier draft is already there): `docs/handoffs/2026-09-01-tutor-osmosis-handoff.md`

- [ ] **Step 1:** Save the full text of the tutor's *revised* handoff document (the one with the corrected §3) to `docs/handoffs/2026-09-01-tutor-osmosis-handoff.md`. If an earlier draft was already saved there from a prior pass, overwrite it — don't keep both versions in the repo, since the revised one explicitly retracts parts of the earlier one and keeping both invites someone to read the stale one later.
- [ ] **Step 2:** Commit.

```bash
git add docs/handoffs/2026-09-01-tutor-osmosis-handoff.md
git commit -m "docs: save revised tutor handoff spec (app is the primary delivery surface)"
```

---

## Phase 1: Live request/response (the prerequisite — full detail)

**Unblocks:** every other phase. Per the handoff's own sequencing, this is first not because it's most interesting but because nothing else is reachable before it.

**Shape of this phase, per the revised handoff's four-cell delivery table:** two independent delivery paths, sharing the same `createAttempt`/`answerResponse`/`submitAttempt` backbone:

| Task(s) | Delivery cell | Item types | Surface |
|---|---|---|---|
| 1.1-1.6 | App × Live (the primary loop, §3.2) | MC (with graphs/Desmos), written | Osmosis web app |
| 1.7 | Claude Code × Live (§3.3, narrow) | Free-response only | Tutor's own chat |

"App × Delayed" (Ben opening the app later and doing what's due) needs no new work in this phase — it's just the existing web app, and becomes relevant once Phase 5's `get_due_items` exists to populate a "what's due" queue. "Claude Code × Delayed" doesn't exist per the handoff's own table.

### Task 1.1: Implement the `adhoc` attempt source in `createAttempt`

**Files:**
- Modify: `server/src/domain/attempts.ts:119-162` (`CreateAttemptInput`, `createAttempt`)
- Test: `server/tests/adhocAttempts.test.ts` (new)

**Interfaces:**
- Produces: `CreateAttemptInput` gains an `adhoc` variant: `{ node_id: string; source: "adhoc"; question_ids: string[] }` alongside the existing `{ node_id, source: "template", template_id }` shape.
- Produces: `createAttempt(db, input, role?)` returns `{ attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] }` for the adhoc path too (matching the shape the `template` path already effectively returns, so callers don't need a source-specific branch).
- Consumes: nothing new from other modules.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/adhocAttempts.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createAttempt } from "../src/domain/attempts.js";

describe("createAttempt with source: adhoc", () => {
  it("creates an attempt with exactly the given question_ids, no template required", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });

    const result = createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: [q1.id, q2.id] });

    expect(result.attempt_id).toBeTruthy();
    const responseCount = (
      db.prepare("SELECT COUNT(*) AS n FROM response WHERE attempt_id = ?").get(result.attempt_id) as { n: number }
    ).n;
    expect(responseCount).toBe(2);

    const attemptRow = db.prepare("SELECT source, template_id FROM attempt WHERE id = ?").get(result.attempt_id) as {
      source: string;
      template_id: string | null;
    };
    expect(attemptRow.source).toBe("adhoc");
    expect(attemptRow.template_id).toBeNull();
  });

  it("rejects an empty question_ids list", () => {
    const db = openTestDb();
    expect(() => createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: [] })).toThrow();
  });

  it("rejects a question_id that doesn't exist", () => {
    const db = openTestDb();
    expect(() =>
      createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: ["not-a-real-id"] })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/adhocAttempts.test.ts
```
Expected: FAIL — `createAttempt` currently throws `DomainError("unsupported_source", ...)` for `source: "adhoc"` unconditionally (`attempts.ts:136-138`).

- [ ] **Step 3: Implement**

Replace `server/src/domain/attempts.ts:119-162`:

```typescript
export type CreateAttemptInput =
  | { node_id: string; source: "template"; template_id: string }
  | { node_id: string; source: "adhoc"; question_ids: string[] };

export function createAttempt(
  db: DatabaseSync,
  input: CreateAttemptInput,
  role: "canonical" | "local" = "canonical"
): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] } {
  sweepAbandonedAttempts(db);

  if (input.source === "template") {
    const draw = resolveTemplateDraw(db, input.template_id);
    const attemptId = uuidv4();

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO attempt (id, node_id, source, template_id, started_at)
         VALUES (?, ?, 'template', ?, datetime('now'))`
      ).run(attemptId, input.node_id, input.template_id);

      const insertResponse = db.prepare(
        "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
      );
      draw.questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { attempt_id: attemptId, questions: draw.questions };
  }

  // source === "adhoc"
  if (!input.question_ids || input.question_ids.length === 0) {
    throw new DomainError("empty_question_ids", "source 'adhoc' requires at least one question_id.");
  }

  const placeholders = input.question_ids.map(() => "?").join(",");
  const found = db
    .prepare(`SELECT id, lineage_id, type FROM question WHERE id IN (${placeholders}) AND retired_at IS NULL`)
    .all(...input.question_ids) as { id: string; lineage_id: string; type: "mc" | "written" }[];
  if (found.length !== input.question_ids.length) {
    const foundIds = new Set(found.map((q) => q.id));
    const missing = input.question_ids.filter((id) => !foundIds.has(id));
    throw new DomainError("question_not_found", `Question(s) not found or retired: ${missing.join(", ")}`);
  }
  // Preserve caller-specified order, not the SQL IN(...) result order.
  const byId = new Map(found.map((q) => [q.id, q]));
  const questions = input.question_ids.map((id) => byId.get(id)!);

  const attemptId = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, ?, 'adhoc', datetime('now'))`
    ).run(attemptId, input.node_id);

    const insertResponse = db.prepare(
      "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
    );
    questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { attempt_id: attemptId, questions };
}
```

**Note:** this changes `createAttempt`'s return shape from `{ attempt_id } & DrawResult` (whatever extra fields `DrawResult` carries beyond `questions`) to `{ attempt_id, questions }`. Before committing, check `DrawResult`'s full type definition in `draw.ts` (grep `interface DrawResult`) and confirm nothing else currently reads fields off `createAttempt`'s return beyond `attempt_id` and `questions` — grep all callers of `createAttempt` in `server/src/http/apiRoutes.ts` before assuming the narrower return type is safe.

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/adhocAttempts.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite — this touches a function the HTTP layer depends on**

```bash
cd server && npm run typecheck && npm test
```
Expected: all pass, including `server/tests/attempts.test.ts` and `server/tests/apiRoutes.test.ts` (confirms the `template` path is byte-for-byte unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/attempts.ts server/tests/adhocAttempts.test.ts
git commit -m "feat: implement the adhoc attempt source (schema already allowed it, code didn't)"
```

### Task 1.2: `present_item` MCP tool (creates the attempt, does not render it)

**Files:**
- Create: `server/migrations/009_delivery_mode.sql`
- Modify: `server/src/domain/attempts.ts` — extend `CreateAttemptInput`'s adhoc variant, add `presentItem`
- Modify: `server/src/mcp/server.ts` — thread `ctx.node.id` into `registerTools`
- Modify: `server/src/mcp/tools.ts` — extend `registerTools`'s signature, register `present_item`
- Test: `server/tests/presentItem.test.ts` (new)

**Interfaces:**
- Produces (migration): `attempt.delivery_mode TEXT CHECK (delivery_mode IN ('app_live', 'chat_quick_check') OR delivery_mode IS NULL)` — needed because the `adhoc` source is now shared by two different live-delivery paths (Task 1.2's app-mediated items and Task 1.8's chat quick-checks), and the app's polling route (Task 1.4) needs to tell them apart — a quick-check should never show up as "pending" in the app, since Ben answers it directly in chat with the tutor.
- Produces: `CreateAttemptInput`'s adhoc variant gains `delivery_mode: "app_live" | "chat_quick_check"` (required, not optional — every adhoc attempt going forward is one or the other, no ambiguous third case).
- Consumes: `createAttempt` from Task 1.1.
- Produces: `presentItem(db, input: { node_id: string; question_id?: string; tag_query?: TagQuery }): { attempt_id: string; response_id: string; question: Record<string, unknown> }` — creates an `adhoc`/`app_live` attempt and returns a withheld snapshot (for the tutor's own bookkeeping — the app is what actually shows this to Ben, but the tutor still benefits from knowing what was asked). `questionSnapshot` is private to `attempts.ts` today — export it (add `export` to its declaration at `attempts.ts:58`).

- [ ] **Step 1: Write the migration**

```sql
-- server/migrations/009_delivery_mode.sql
ALTER TABLE attempt ADD COLUMN delivery_mode TEXT CHECK (delivery_mode IN ('app_live', 'chat_quick_check') OR delivery_mode IS NULL);
```

- [ ] **Step 2: Write the failing test**

```typescript
// server/tests/presentItem.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem } from "../src/domain/attempts.js"; // new export, added in Step 4

describe("presentItem", () => {
  it("presents an explicit question_id without revealing is_correct or explanation, tagged app_live", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    const result = presentItem(db, { node_id: "test-node", question_id: q.id });

    expect(result.attempt_id).toBeTruthy();
    expect(result.response_id).toBeTruthy();
    expect(result.question.id).toBe(q.id);
    expect(result.question.explanation).toBeUndefined();
    expect(result.question.model_answer).toBeUndefined();
    for (const choice of result.question.choices as any[]) {
      expect(choice.is_correct).toBeUndefined();
    }

    const attemptRow = db.prepare("SELECT delivery_mode FROM attempt WHERE id = ?").get(result.attempt_id) as {
      delivery_mode: string;
    };
    expect(attemptRow.delivery_mode).toBe("app_live");
  });

  it("auto-picks an eligible question when given a tag_query instead of an explicit id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    const result = presentItem(db, { node_id: "test-node", tag_query: { all: ["a"] } });
    expect(result.question.id).toBe(q.id);
  });

  it("throws when neither question_id nor tag_query is given", () => {
    const db = openTestDb();
    expect(() => presentItem(db, { node_id: "test-node" } as any)).toThrow();
  });

  it("throws when tag_query matches nothing", () => {
    const db = openTestDb();
    insertTag(db, "empty");
    expect(() => presentItem(db, { node_id: "test-node", tag_query: { all: ["empty"] } })).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd server && npx vitest run tests/presentItem.test.ts
```
Expected: FAIL — `presentItem` is not exported from `attempts.ts` yet, and the migration hasn't been applied by the test's `openTestDb()` call until `migrate.ts` picks up the new file (it will automatically once the file exists under `server/migrations/`, since `migrate.ts` runs every untracked migration file in order — no code change needed for that part).

- [ ] **Step 4: Implement `presentItem` in `attempts.ts`**

First, update `CreateAttemptInput`'s adhoc variant (from Task 1.1) to require `delivery_mode`, and thread it into the INSERT:

```typescript
export type CreateAttemptInput =
  | { node_id: string; source: "template"; template_id: string }
  | { node_id: string; source: "adhoc"; question_ids: string[]; delivery_mode: "app_live" | "chat_quick_check" };
```

In `createAttempt`'s adhoc branch, change the INSERT to include it:

```typescript
db.prepare(
  `INSERT INTO attempt (id, node_id, source, delivery_mode, started_at) VALUES (?, ?, 'adhoc', ?, datetime('now'))`
).run(attemptId, input.node_id, input.delivery_mode);
```

(Go back and update Task 1.1's test file too — its three `source: "adhoc"` calls now need a `delivery_mode` field or they'll fail to typecheck. Pick `"app_live"` for those, since they're testing the generic mechanism, not either specific mode.)

Add `export` to `questionSnapshot`'s declaration (`attempts.ts:58`), then add a new exported function near `createAttempt`:

```typescript
import { getEligibleQuestions } from "./draw.js";
import type { TagQuery } from "./tagQuery.js";

export interface PresentItemInput {
  node_id: string;
  question_id?: string;
  tag_query?: TagQuery;
}

export function presentItem(db: DatabaseSync, input: PresentItemInput): {
  attempt_id: string;
  response_id: string;
  question: Record<string, unknown>;
} {
  let questionId: string;

  if (input.question_id) {
    questionId = input.question_id;
  } else if (input.tag_query) {
    const eligible = getEligibleQuestions(db, { tag_query: input.tag_query });
    if (eligible.length === 0) {
      throw new DomainError("no_eligible_questions", "No question matches the given tag_query.");
    }
    questionId = eligible[Math.floor(Math.random() * eligible.length)].id;
  } else {
    throw new DomainError("selection_required", "present_item requires either question_id or tag_query.");
  }

  const { attempt_id, questions } = createAttempt(db, {
    node_id: input.node_id,
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "app_live",
  });

  const response = db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string };

  return {
    attempt_id,
    response_id: response.id,
    question: questionSnapshot(db, questionId, false),
  };
}
```

**Decision point (flag, don't silently pick for the tutor):** random selection among eligible questions (`Math.random()`) is the simplest correct default and matches nothing in the existing weighted-draw logic. `draw.ts`'s `weak_weighted` weighting exists but operates over a whole template draw, not a single-item pick. Recommend shipping the simple random version first and revisiting weighted single-item selection once Phase 5 (scheduling) exists and there's an actual retention-driven reason to prefer one eligible question over another.

- [ ] **Step 5: Run to verify pass**

```bash
cd server && npx vitest run tests/presentItem.test.ts tests/adhocAttempts.test.ts
```
Expected: PASS (all tests across both files, after Step 4's Task-1.1-test update)

- [ ] **Step 6: Thread the canonical node's id into `registerTools`, then wire the MCP tool**

`registerTools(server, ctx.db, ctx.env.uploadsDir)` (current signature, called from `buildMcpServer(ctx)` in `server/src/mcp/server.ts:10-14`) has no access to `ctx.node` today, even though `AppContext` (`server/src/http/app.ts:14-19`) already carries `node: NodeRow` — `bootstrapNode` (`node.ts:15-33`) computes this once at boot. Add it as a fourth param.

In `server/src/mcp/server.ts`:
```typescript
export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "osmosis", version: "1.0.0" });
  registerTools(server, ctx.db, ctx.env.uploadsDir, ctx.node.id);
  return server;
}
```

In `server/src/mcp/tools.ts`, find `registerTools`'s exported function signature (grep `export function registerTools`) and add `nodeId: string` as a fourth parameter. Import `presentItem` and register:

```typescript
import { presentItem } from "../domain/attempts.js"; // awaitItemOutcome added in Task 1.3

export function registerTools(server: McpServer, db: DatabaseSync, uploadsDir: string, nodeId: string): void {
  // ...existing tool registrations...

  server.registerTool(
    "present_item",
    {
      description:
        "Create a live item for the learner to answer in the Osmosis app. Returns immediately with an attempt/response id — the item is NOT rendered in this conversation. Call await_item_outcome afterward to learn what happened once the learner answers in the app. Either pass question_id for a specific item you authored, or tag_query to let Osmosis pick an eligible one.",
      inputSchema: {
        question_id: z.string().optional(),
        tag_query: tagQueryShape,
      },
    },
    async ({ question_id, tag_query }) => {
      try {
        return ok(presentItem(db, { node_id: nodeId, question_id, tag_query }));
      } catch (err) {
        return fail(err);
      }
    }
  );
}
```

Dropped `node_id` from the input schema entirely — every call to `/mcp/:token` is already scoped to one running node by construction, so there's no legitimate case where the tutor should supply a different node id. Before this step, grep every call site of `registerTools(` (should be exactly one, in `mcp/server.ts`) and every test that constructs an `McpServer` directly (check `server/tests/mcpUpload.test.ts`) — both need the new fourth argument.

- [ ] **Step 7: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/migrations/009_delivery_mode.sql server/src/domain/attempts.ts server/src/mcp/server.ts server/src/mcp/tools.ts server/tests/presentItem.test.ts server/tests/adhocAttempts.test.ts
git commit -m "feat: add present_item MCP tool (creates a live app-rendered item, doesn't render it itself)"
```

### Task 1.3: `await_item_outcome` MCP tool (bounded poll for the app-side answer)

**Files:**
- Modify: `server/src/domain/attempts.ts` — add `getItemOutcome`
- Modify: `server/src/mcp/tools.ts` — register `await_item_outcome`
- Test: `server/tests/awaitItemOutcome.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — reads `attempt`/`response`/`grade`/`choice` rows that `answerResponse`/`submitAttempt` (already exported, `attempts.ts:350`/`397`) write when Ben answers via the app's existing `PATCH .../responses/:id` and `POST .../submit` routes.
- Produces: `getItemOutcome(db, responseId: string): { status: "answered"; correct: boolean | null; explanation: string | null; model_answer: string | null; correct_choice_id: string | null } | { status: "pending" }` — a single, non-blocking read of current state. The MCP tool wraps this in a bounded poll loop (Step 4 below) so the tutor doesn't have to hand-loop it itself for short waits, while still returning `"pending"` rather than hanging forever if Ben hasn't answered within the window.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/awaitItemOutcome.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, getItemOutcome } from "../src/domain/attempts.js";
import { answerResponse, submitAttempt } from "../src/domain/attempts.js";

describe("getItemOutcome", () => {
  it("reports pending before the app-side answer is submitted", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "test-node", question_id: q.id });

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("pending");
  });

  it("reports the outcome once the app's existing submit path has run", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "test-node", question_id: q.id });

    const correctChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(q.id) as { id: string }
    ).id;

    // Exactly what the app's PATCH + submit HTTP routes do under the hood
    // (apiRoutes.ts:265-295) — no new answer-recording logic, reusing what
    // already exists.
    answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: correctChoiceId });
    submitAttempt(db, presented.attempt_id);

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.correct).toBe(true);
      expect(outcome.correct_choice_id).toBe(correctChoiceId);
    }
  });

  it("throws on a response_id that doesn't exist", () => {
    const db = openTestDb();
    expect(() => getItemOutcome(db, "not-real")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/awaitItemOutcome.test.ts
```
Expected: FAIL — `getItemOutcome` doesn't exist yet.

- [ ] **Step 3: Implement**

Add to `server/src/domain/attempts.ts`:

```typescript
export type ItemOutcome =
  | { status: "pending" }
  | {
      status: "answered";
      correct: boolean | null;
      explanation: string | null;
      model_answer: string | null;
      correct_choice_id: string | null;
    };

export function getItemOutcome(db: DatabaseSync, responseId: string): ItemOutcome {
  const row = db
    .prepare(
      `SELECT r.attempt_id, r.question_id, a.submitted_at
       FROM response r JOIN attempt a ON a.id = r.attempt_id
       WHERE r.id = ?`
    )
    .get(responseId) as { attempt_id: string; question_id: string; submitted_at: string | null } | undefined;
  if (!row) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);

  if (!row.submitted_at) return { status: "pending" };

  const question = db.prepare("SELECT type, explanation, model_answer FROM question WHERE id = ?").get(
    row.question_id
  ) as { type: "mc" | "written"; explanation: string | null; model_answer: string | null };

  const liveGrade = db
    .prepare("SELECT score FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { score: number } | undefined;

  const correctChoice =
    question.type === "mc"
      ? (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(row.question_id) as
          | { id: string }
          | undefined)
      : undefined;

  return {
    status: "answered",
    correct: question.type === "mc" ? liveGrade?.score === 1 : null,
    explanation: question.explanation,
    model_answer: question.model_answer,
    correct_choice_id: correctChoice?.id ?? null,
  };
}
```

**Note on written responses:** matches the same reasoning as this plan's original `submit_response` design — `submitAttempt` only auto-grades `mc` (`attempts.ts:409-416`), so `correct` is `null` for `written` until a model or self grade lands separately. `getItemOutcome` still reports `status: "answered"` once `submitted_at` is set (Ben *did* answer, even if grading is still pending) — the tutor gets `explanation`/`model_answer` immediately and `correct: null` signals "answered, not yet graded," distinct from `status: "pending"` which means "hasn't answered at all."

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/awaitItemOutcome.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the MCP tool as a bounded poll**

```typescript
import { presentItem, getItemOutcome } from "../domain/attempts.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.registerTool(
  "await_item_outcome",
  {
    description:
      "Wait for the learner to answer the item from present_item, up to ~25 seconds. Returns the outcome once answered, or status: 'pending' if the learner hasn't answered yet in that window — call this again to keep waiting, or come back to it later in the conversation.",
    inputSchema: {
      response_id: z.string(),
    },
  },
  async ({ response_id }) => {
    try {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const outcome = getItemOutcome(db, response_id);
        if (outcome.status === "answered") return ok(outcome);
        await sleep(1_000);
      }
      return ok({ status: "pending" });
    } catch (err) {
      return fail(err);
    }
  }
);
```

**Decision Point — poll window length.** 25 seconds (well under typical HTTP/tunnel timeout ranges, and short enough that the tutor calling this in a loop a few times feels like a natural "still waiting, want to keep chatting while they think?" pause rather than an error) is a starting default, not a verified number — there's no data yet on how cloudflared's specific timeout is configured for this deployment, or on typical MCP client-side tool-call timeouts. Confirm the actual configured tunnel/proxy timeout before finalizing this value, and treat 25s as conservative-and-safe rather than tuned.

- [ ] **Step 6: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/attempts.ts server/src/mcp/tools.ts server/tests/awaitItemOutcome.test.ts
git commit -m "feat: add await_item_outcome MCP tool (bounded poll for the app-side answer)"
```

### Task 1.4: HTTP route for the app to discover a pending live item

**Files:**
- Modify: `server/src/http/apiRoutes.ts` — add `GET /api/attempts/live-pending`
- Test: `server/tests/apiRoutes.test.ts` (extend) or a new `server/tests/livePendingRoute.test.ts`, following whichever pattern `apiRoutes.test.ts` already uses for route-level tests (read it first — this plan hasn't captured its exact structure).

**Interfaces:**
- Produces: `GET /api/attempts/live-pending` → `{ attempt: AttemptDetail } | { attempt: null }` — returns the most recent `attempt` with `source = 'adhoc' AND delivery_mode = 'app_live' AND submitted_at IS NULL AND abandoned_at IS NULL`, in the same `AttemptDetail` shape `GET /api/attempts/:id` (`getAttemptDetail`, already exists) already returns, so the frontend's existing types/parsing for an attempt need no new shape to learn.

- [ ] **Step 1: Write the failing test**

Read `server/tests/apiRoutes.test.ts` first to match its existing setup pattern (it presumably already spins up a `buildApp`/`openTestDb` pair similar to `server/tests/assets.test.ts`, shown earlier in this plan's sibling pagination doc). Then add:

```typescript
// Add to server/tests/apiRoutes.test.ts, or a new file following the same setup pattern
it("GET /api/attempts/live-pending returns null when nothing is pending", async () => {
  const res = await fetch(`${baseUrl}/api/attempts/live-pending`);
  const body = await res.json();
  expect(body.attempt).toBeNull();
});

it("GET /api/attempts/live-pending returns the pending app_live attempt, not a chat_quick_check one", async () => {
  // seed one 'adhoc'/'chat_quick_check' attempt and one 'adhoc'/'app_live' attempt,
  // both unsubmitted, then assert the route returns only the app_live one.
  // Exact seeding call depends on presentItem's real signature (Task 1.2) —
  // fill in with a direct call to presentItem(db, {...}) for the app_live row
  // and a direct SQL insert (or the Task 1.8 domain function once it exists)
  // for the chat_quick_check row.
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/apiRoutes.test.ts
```
Expected: FAIL — the route doesn't exist yet (404).

- [ ] **Step 3: Implement**

In `server/src/http/apiRoutes.ts`, near the other `/api/attempts/*` routes (`apiRoutes.ts:194-295`):

```typescript
app.get("/api/attempts/live-pending", async () => {
  const row = db
    .prepare(
      `SELECT id FROM attempt
       WHERE source = 'adhoc' AND delivery_mode = 'app_live'
         AND submitted_at IS NULL AND abandoned_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    .get() as { id: string } | undefined;

  if (!row) return { attempt: null };
  return { attempt: getAttemptDetail(db, row.id) };
});
```

Add `getAttemptDetail` to `apiRoutes.ts`'s existing `attempts.js` import if it isn't already imported there (check — it likely already is, since `GET /api/attempts/:id` at `apiRoutes.ts:255-263` already uses it).

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/apiRoutes.test.ts
```
Expected: PASS

- [ ] **Step 5: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/http/apiRoutes.ts server/tests/apiRoutes.test.ts
git commit -m "feat: add GET /api/attempts/live-pending for the app to discover a tutor-created live item"
```

### Task 1.5: End-to-end backend test for the app-mediated loop

**Files:**
- Test: `server/tests/liveLoop.test.ts` (new)

- [ ] **Step 1: Write and run this test (no new implementation — it should pass immediately if Tasks 1.1-1.4 are correct)**

```typescript
// server/tests/liveLoop.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, getItemOutcome, answerResponse, submitAttempt } from "../src/domain/attempts.js";

describe("app-mediated live loop (present_item -> app answers -> await_item_outcome)", () => {
  it("never exposes is_correct before the app-side answer is submitted, and reports it correctly after", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"], prompt: "What is 2+2?" });

    const presented = presentItem(db, { node_id: "test-node", tag_query: { all: ["algebra"] } });
    expect(JSON.stringify(presented)).not.toMatch(/is_correct/);
    expect(JSON.stringify(presented)).not.toMatch(/explanation/);

    // Before Ben answers, the tutor's poll reports pending.
    expect(getItemOutcome(db, presented.response_id).status).toBe("pending");

    // This is exactly what the app's existing PATCH/submit HTTP routes do.
    const correctChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(presented.question.id) as {
        id: string;
      }
    ).id;
    answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: correctChoiceId });
    submitAttempt(db, presented.attempt_id);

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") expect(outcome.correct).toBe(true);
  });
});
```

```bash
cd server && npx vitest run tests/liveLoop.test.ts
```
Expected: PASS. If it fails, the bug is in Task 1.1-1.4, not in this test.

- [ ] **Step 2: Commit**

```bash
git add server/tests/liveLoop.test.ts
git commit -m "test: end-to-end backend coverage for the app-mediated live loop"
```

### Task 1.6: Tutor sessions — schema, `create_session` MCP tool, and how everything else plugs into it

**Resolves the frontend Decision Point 2 from the first pass of this task** (screen-vs-overlay-vs-indicator). Ben's own design: the tutor calls `create_session` once and everything it does afterward — live items and any session-scoped tests — happens under that session; the app gets a "Live" nav entry listing sessions, each session expands to show its tests plus one distinguished "Live session" row that opens the actual live-item screen scoped to that session; sessions are logged as collapsible rows for later review; homework the tutor generates independently stays entirely outside this — plain templates/question bank, no session involved. This is Option A from the original Decision Point, made concrete, and it's a better answer than "just a standalone screen" because it gives Ben somewhere to navigate *to* and something to look back *at* — the plain screen sketch had neither.

**No session concept exists in the schema today** — confirmed by this plan's research pass: `attempt.node_id` is physical-node identity (canonical vs. local), not a tutoring-session grouping, and there is no `session` table anywhere in the migrations.

**Files:**
- Create: `server/migrations/010_tutor_sessions.sql` (renumbered from the `011` shown below at execution time — Phase 2's `010_item_engine_ingestion_fields.sql` didn't exist yet when this task actually ran, so `010` was the real next-available number; confirmed via pre-flight ledger ruling. **If Phase 2 lands later, its migration must be renumbered to `012` or higher** — do not reuse `010`, it's taken.)
- Create: `server/src/domain/sessions.ts` — new domain module
- Modify: `server/src/domain/attempts.ts` — `CreateAttemptInput`'s adhoc variant gains optional `session_id`; `presentItem`/`quickCheck` (Tasks 1.2/1.8) accept and thread it through
- Modify: `server/src/domain/templates.ts` — `template` gains optional `session_id`, for the "session-specific test" case
- Modify: `server/src/mcp/tools.ts` — new `create_session` tool; `present_item`, `quick_check`, and `create_template`'s input schemas each gain optional `session_id`
- Modify: `server/src/http/apiRoutes.ts` — new `GET /api/sessions`, `GET /api/sessions/:id` (returns the session plus its templates and attempt history); `GET /api/attempts/live-pending` (Task 1.4) gains a required `session_id` query param, since the live screen is now always reached *through* a session, not standalone

**Schema:**

```sql
-- server/migrations/010_tutor_sessions.sql (see the renumbering note above)
CREATE TABLE tutor_session (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tag_slug    TEXT REFERENCES tag(slug),   -- nullable: a session need not be scoped to one tag
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT
);

ALTER TABLE attempt ADD COLUMN session_id TEXT REFERENCES tutor_session(id);
ALTER TABLE template ADD COLUMN session_id TEXT REFERENCES tutor_session(id);

CREATE INDEX attempt_by_session ON attempt (session_id, started_at DESC);
CREATE INDEX template_by_session ON template (session_id);
```

Both new FK columns are nullable by design — this is what keeps homework and any other non-session flow completely untouched: a template or attempt with `session_id IS NULL` behaves exactly as it does today, in every existing query and route, with zero special-casing needed anywhere that doesn't care about sessions.

**`create_session` domain function and MCP tool:**

```typescript
// server/src/domain/sessions.ts
import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";

export interface CreateSessionInput {
  name: string;
  tag_slug?: string;
}

export function createSession(db: DatabaseSync, input: CreateSessionInput): { id: string; name: string; tag_slug: string | null } {
  const id = uuidv4();
  db.prepare("INSERT INTO tutor_session (id, name, tag_slug) VALUES (?, ?, ?)").run(id, input.name, input.tag_slug ?? null);
  return { id, name: input.name, tag_slug: input.tag_slug ?? null };
}

export function endSession(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE tutor_session SET ended_at = datetime('now') WHERE id = ?").run(id);
}

export function listSessions(db: DatabaseSync, opts: { limit?: number; offset?: number } = {}): { total: number; sessions: unknown[] } {
  // Mirror the total/limit/offset pattern already established by searchQuestions
  // (questions.ts:630-709) and reused throughout the sibling pagination plan —
  // same contract, same reasoning: an AI or the app browsing session history
  // needs the same paging story every other listing tool already has.
  const total = (db.prepare("SELECT COUNT(*) AS n FROM tutor_session").get() as { n: number }).n;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sessions = db
    .prepare("SELECT id, name, tag_slug, created_at, ended_at FROM tutor_session ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset);
  return { total, sessions };
}
```

MCP registration (`server/src/mcp/tools.ts`):

```typescript
server.registerTool(
  "create_session",
  {
    description: "Start a new tutoring session. Everything you present live afterward, and any session-specific test you create, should be tagged with the returned session id so it groups together in the app under one 'Live' entry.",
    inputSchema: { name: z.string(), tag_slug: z.string().optional() },
  },
  async ({ name, tag_slug }) => {
    try {
      return ok(createSession(db, { name, tag_slug }));
    } catch (err) {
      return fail(err);
    }
  }
);
```

**Threading `session_id` through the existing tools:**

- `present_item` (Task 1.2) and `quick_check` (Task 1.8) both gain an optional `session_id: z.string().optional()` in their input schema, passed down into `createAttempt`'s adhoc variant, which needs `session_id?: string` added alongside `delivery_mode`.
- `create_template` (already exists) gains an optional `session_id` — this is Ben's "session specific test" capability: the tutor calls `create_template` as it already can, just with a `session_id` attached, and that template shows up under the session in the app instead of the general template list. No new template-creation logic needed, only the new column and one new optional field threaded through.
- **Decision Point — is `session_id` required or optional on `present_item`?** Optional is the safer default: it means `present_item` still works standalone (useful for testing, or a future non-session live-delivery use nobody's identified yet), while every real tutor-driven call in practice would supply it. Recommend leaving it optional at the schema/API level, but documenting in the tool description that the tutor should always call `create_session` first and pass its id — enforcement-by-convention here, not enforcement-by-constraint, since a hard requirement would make `present_item` unusable in isolation (e.g. in tests, or in Task 1.2's own test suite, which currently calls it without a session at all — those tests stay valid, they just exercise the `session_id IS NULL` path).

**App-side implications (folds into Task 1.7's rebuild below):** the "Live" nav is now a sessions list, not a single live screen. `GET /api/sessions` backs that list; opening a session hits `GET /api/sessions/:id` for its templates + attempt history; the distinguished "Live session" row within an open session is what mounts the actual polling live-item view (Task 1.7), now called with that session's id so `GET /api/attempts/live-pending?session_id=...` only ever surfaces items belonging to the session Ben is currently looking at — not some other session's leftover pending item.

### Task 1.7: Web app "Live" surface, now session-shaped

**Files:**
- Create: `web/src/components/SessionList.tsx` — the "Live" nav entry's landing view: fetches `GET /api/sessions`, renders each as a collapsible row (name, tag, started/ended, and once expanded, its templates + the distinguished "Live session" row)
- Create: `web/src/components/SessionDetail.tsx` (or fold into `SessionList`'s expanded row state — a UI-structure call, not an architectural one) — shows a session's templates (existing template-taking flow, unchanged, just filtered to `session_id`) and its past attempt history (existing attempt list/detail views, filtered to `session_id`)
- Create: `web/src/components/LiveItem.tsx` (renamed from the earlier sketch's `LiveSession.tsx` — "session" now means the tutor_session container, so the polling live-item view needs a different name to avoid confusion) — mounted when Ben clicks the "Live session" row inside an open session
- Reuse, not duplicate: `web/src/components/Take.tsx` (unchanged reasoning from the first pass — generic over `attempt.responses`, a single live item renders through it with zero changes), `web/src/lib/api.ts`'s existing `answerResponse`/`submitAttempt` client functions, `QuestionPanel.tsx`/`GraphPanel.tsx`/`DesmosPanel.tsx` (confirm exact props by reading them before building `LiveItem` — this plan's research pass confirmed they exist but not their integration surface)

**What `LiveItem` needs to do (same mechanism as the first pass, now session-scoped):**
1. Poll `GET /api/attempts/live-pending?session_id=<this session's id>` on some interval.
2. When it returns a non-null attempt, hand the fetched `AttemptDetail` straight to the existing `Take` component.
3. When `Take`'s `onFinish` fires, stop rendering the pending state and go back to polling (or show a small "waiting for the next item" state) — `await_item_outcome` (Task 1.3) on the tutor's side picks up the `submitted_at` change on its own next poll tick.

**Remaining Decision Point — polling cadence.** Still a taste call, not a technical one: 2-3 seconds is a reasonable default for `LiveItem`'s poll against `live-pending`, and something slower (e.g. 5-10 seconds) is probably fine for `SessionList`'s own poll against `GET /api/sessions` if it needs to reflect session activity live at all — that list changing while Ben watches it is much lower-stakes than a live item appearing promptly.

**Now resolved, no longer an open question:** the screen-vs-overlay-vs-indicator choice from the original Decision Point 2 — it's a dedicated screen, reached by navigating Live → a session → the session's "Live session" row, per Ben's design above. What was previously flagged as "what if Ben isn't looking at the app" is unchanged in kind (the tutor can keep chatting and the poll just returns `"pending"` until Ben navigates there) but is now less of an open question in practice, since a named, logged session gives Ben an obvious, discoverable place to go back to rather than a single ambiguous "live" state.

**Do not write literal TDD steps for these three components until `QuestionPanel.tsx`/`GraphPanel.tsx`/`DesmosPanel.tsx` have actually been read** — this task correctly names the reuse targets but hasn't verified their exact props/integration surface.

### Task 1.8: `quick_check` / `submit_quick_check` — the narrow chat-mediated in-node check (§3.3)

**This is the one case where the original (superseded) synchronous chat design was actually right** — §3.3 explicitly wants this to stay in Claude Code, free-response only, without switching surfaces mid-node. It's essentially this plan's original `present_item`/`submit_response` pair, renamed to avoid confusion with Tasks 1.2/1.3's app-mediated tools, and scoped to free-response only per the Global Constraints note above.

**Files:**
- Modify: `server/src/domain/attempts.ts` — add `quickCheck`, `submitQuickCheck`
- Modify: `server/src/mcp/tools.ts` — register `quick_check`, `submit_quick_check`
- Test: `server/tests/quickCheck.test.ts` (new)

**Interfaces:**
- Produces: `quickCheck(db, input: { node_id: string; question_id?: string; tag_query?: TagQuery }): { attempt_id: string; response_id: string; question: Record<string, unknown> }` — same shape as `presentItem`, but throws if the selected question's `type !== "written"`, and creates the attempt with `delivery_mode: "chat_quick_check"` instead of `"app_live"` (so Task 1.4's app-polling route never picks it up).
- Produces: `submitQuickCheck(db, input: { response_id: string; response_text: string }): { explanation: string | null; model_answer: string | null }` — records the answer and reveals the model answer/explanation immediately (no `correct` field — written responses aren't auto-graded, matching `getItemOutcome`'s same reasoning in Task 1.3).

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/quickCheck.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { quickCheck, submitQuickCheck } from "../src/domain/attempts.js";

describe("quickCheck", () => {
  it("presents a written question inline, withholding the model answer", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });

    const result = quickCheck(db, { node_id: "test-node", question_id: q.id });
    expect(result.question.model_answer).toBeUndefined();

    const attemptRow = db.prepare("SELECT delivery_mode FROM attempt WHERE id = ?").get(result.attempt_id) as {
      delivery_mode: string;
    };
    expect(attemptRow.delivery_mode).toBe("chat_quick_check");
  });

  it("rejects an mc question — quick_check is free-response only", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "mc" });
    expect(() => quickCheck(db, { node_id: "test-node", question_id: q.id })).toThrow();
  });
});

describe("submitQuickCheck", () => {
  it("records the answer and reveals the model answer", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const presented = quickCheck(db, { node_id: "test-node", question_id: q.id });

    const outcome = submitQuickCheck(db, {
      response_id: presented.response_id,
      response_text: "My answer is that the derivative measures instantaneous rate of change.",
    });
    expect(outcome.model_answer).toBe("model answer"); // seeded by insertQuestion's helper default
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/quickCheck.test.ts
```
Expected: FAIL — neither function exists yet.

- [ ] **Step 3: Implement**

Add to `server/src/domain/attempts.ts`:

```typescript
export function quickCheck(
  db: DatabaseSync,
  input: { node_id: string; question_id?: string; tag_query?: TagQuery }
): { attempt_id: string; response_id: string; question: Record<string, unknown> } {
  let questionId: string;

  if (input.question_id) {
    questionId = input.question_id;
  } else if (input.tag_query) {
    const eligible = getEligibleQuestions(db, { tag_query: input.tag_query });
    const written = eligible.filter((q) => q.type === "written");
    if (written.length === 0) {
      throw new DomainError("no_eligible_questions", "No written question matches the given tag_query.");
    }
    questionId = written[Math.floor(Math.random() * written.length)].id;
  } else {
    throw new DomainError("selection_required", "quick_check requires either question_id or tag_query.");
  }

  const question = db.prepare("SELECT type FROM question WHERE id = ?").get(questionId) as { type: string } | undefined;
  if (!question) throw new DomainError("not_found", `Question "${questionId}" does not exist.`);
  if (question.type !== "written") {
    throw new DomainError("mc_not_allowed", "quick_check is free-response only — use present_item for mc items.");
  }

  const { attempt_id, questions } = createAttempt(db, {
    node_id: input.node_id,
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "chat_quick_check",
  });

  const response = db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string };

  return { attempt_id, response_id: response.id, question: questionSnapshot(db, questionId, false) };
}

export function submitQuickCheck(
  db: DatabaseSync,
  input: { response_id: string; response_text: string }
): { explanation: string | null; model_answer: string | null } {
  const row = db.prepare("SELECT attempt_id, question_id FROM response WHERE id = ?").get(input.response_id) as
    | { attempt_id: string; question_id: string }
    | undefined;
  if (!row) throw new DomainError("not_found", `Response "${input.response_id}" does not exist.`);

  answerResponse(db, row.attempt_id, input.response_id, { response_text: input.response_text });
  submitAttempt(db, row.attempt_id);

  const question = db.prepare("SELECT explanation, model_answer FROM question WHERE id = ?").get(row.question_id) as {
    explanation: string | null;
    model_answer: string | null;
  };
  return { explanation: question.explanation, model_answer: question.model_answer };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/quickCheck.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the MCP tools**

```typescript
import { quickCheck, submitQuickCheck } from "../domain/attempts.js";

server.registerTool(
  "quick_check",
  {
    description:
      "A single free-response check, presented inline in this conversation, for the in-node comprehension check immediately after teaching. Not for anything else — use present_item/await_item_outcome for multiple-choice or anything that benefits from the app's graph/Desmos rendering.",
    inputSchema: { question_id: z.string().optional(), tag_query: tagQueryShape },
  },
  async ({ question_id, tag_query }) => {
    try {
      return ok(quickCheck(db, { node_id: nodeId, question_id, tag_query }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "submit_quick_check",
  {
    description: "Record the learner's free-response answer to a quick_check and get the model answer back.",
    inputSchema: { response_id: z.string(), response_text: z.string() },
  },
  async ({ response_id, response_text }) => {
    try {
      return ok(submitQuickCheck(db, { response_id, response_text }));
    } catch (err) {
      return fail(err);
    }
  }
);
```

- [ ] **Step 6: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/attempts.ts server/src/mcp/tools.ts server/tests/quickCheck.test.ts
git commit -m "feat: add quick_check/submit_quick_check MCP tools (chat-mediated, free-response-only in-node check)"
```

---

## Phase 2: Ingestion — items the tutor writes

**Depends on:** nothing new beyond existing `create_questions`/`edit_question` (already shipped, `mcp/tools.ts`). This phase is mostly about **adding metadata fields** the handoff's §2 asks for, most of which don't exist yet.

**Also see Phase 8's "promote to bank" section** — it extends this phase's migration with `question.session_id`/`promoted_at`, so a question hastily authored for one session probe doesn't leak into the general bank/homework pool until deliberately promoted. Fold that into this phase's migration when both are executed, rather than as a separate later change.

**What already exists and needs no work:** "what it's about" (tags — already required on every question), basic authoring via `create_questions`.

**What's missing, per §2 of the handoff:**

| Requested field | Current state | Plan |
|---|---|---|
| Claim rung (`can_state` → `can_transfer`) | Does not exist on `question` | New column `question.claim_rung TEXT CHECK (claim_rung IN ('can_state','can_apply','can_discriminate','can_explain_why','can_transfer'))`, nullable (not every item needs to claim a rung) |
| Error under test | Does not exist | New column `question.tests_error TEXT`, nullable, free-text or a future controlled vocabulary — **Decision Point:** free text now, tighten to an enum/lookup table later once real usage shows the actual error taxonomy, matching how `tag` itself started free-form |
| Provenance (tutor-authored vs. textbook-sourced) | `question.created_by` exists today but is `CHECK (created_by IN ('claude', 'human'))` — a *who wrote the JSON*, not *where the content came from* axis | These are different questions. Add a new column `question.provenance TEXT CHECK (provenance IN ('tutor_authored', 'textbook_sourced'))`, nullable at first (backfill unknown as `NULL`, not a guess) rather than overloading `created_by` |

**Files for this phase:**
- Create: `server/migrations/011_item_engine_ingestion_fields.sql` — adds the three columns above (renumbered again: `009` went to Task 1.2's `delivery_mode`, and `010` went to Task 1.6's `tutor_sessions` when Phase 1 actually shipped before this phase — re-check the real highest number in `server/migrations/` before assigning, as this document's own numbers have now drifted twice)
- Modify: `server/src/domain/questions.ts` — extend `CreateQuestionInput`/`EditQuestionInput` (find exact type names via `grep "interface.*QuestionInput" server/src/domain/questions.ts`) to accept `claim_rung`, `tests_error`, `provenance`; extend `QuestionSummary`/`QuestionDetail` to return them
- Modify: `server/src/mcp/tools.ts` — extend `questionInputShape` (currently `tools.ts:27-52`) with the three new optional fields, with Zod enums for `claim_rung` and `provenance` matching the CHECK constraints exactly (so a schema violation is caught by Zod before it hits SQLite's CHECK and produces a less legible error)

**Decision Point — is `claim_rung` per-question or per-node (§7 territory)?** The handoff's own §7 says the tutor works at *node* grain ("one teachable idea, several per section... node keys are minted by the tutor"), which is finer than a question. If a node concept lands in Phase 7, `claim_rung` may belong on a future `question_node` join table (a question can support a rung for more than one node) rather than as a bare column on `question`. Recommend shipping the simple `question.claim_rung` column now (Phase 2 doesn't need to wait on Phase 7's node-grain decision) and revisiting whether it needs to move to a join table once Phase 7 actually defines what a node is.

Given the schema-only nature of this phase and its dependency on the Phase 7 identity decision, do not expand this into literal TDD tasks until: (a) the `tests_error` free-text-vs-enum decision above is confirmed, and (b) Phase 7's node-grain decision (see below) is at least provisionally settled.

---

## Phase 3: Delivery — the Osmosis app as the primary question surface

**This phase is Phase 1, not folded away.** An earlier pass of this plan treated §3 as fully subsumed by a chat-mediated Phase 1 design — that was wrong the same way an earlier draft of the handoff itself was wrong, and for the same underlying reason: the app can render multiple-choice with real distractor diagnostics and graph-engine/Desmos content that a transcript cannot express at all, so the app has to be the primary surface, not a workaround for the transcript-visibility problem alone.

Concretely, §3's requirements map onto Phase 1's tasks as follows:

| Handoff requirement | Where it's satisfied |
|---|---|
| Tutor sends via MCP, app renders it | Task 1.2 (`present_item`) creates the attempt; Task 1.4 (`GET /api/attempts/live-pending`) is how the app discovers it; Task 1.6 (sessions) is how it's grouped and navigated to; Task 1.7 (`LiveItem`) is what renders it |
| Ben answers there, result returns while the conversation is still going | Task 1.7 reuses the app's existing PATCH/submit routes (already used by `Take.tsx`) for Ben's answer; Task 1.3 (`await_item_outcome`) is how the tutor learns the result without blocking indefinitely |
| Recovers MC distractor diagnostics | Automatic — the app already renders MC choices and calls the same grading path (`submitAttempt`'s `auto_mc`) that a template-based attempt uses |
| Recovers graph/Desmos rendering | Automatic — `Take.tsx`'s existing question-rendering path (via `QuestionPanel`/`GraphPanel`/`DesmosPanel`, confirm exact wiring before building Task 1.7) already handles `graph_spec`/`desmos_allowed` for any attempt, live-created or not |
| §3.3's in-node free-response check stays in chat | Task 1.8 (`quick_check`/`submit_quick_check`) |
| §3.4's "rendering surface is not evidence weight" | No Osmosis-side work needed — this is entirely the tutor's own claim-ladder gating logic (elapsed time, sleep boundary), and Osmosis doesn't need to encode delivery mode as a weighting signal. `attempt.delivery_mode` (Task 1.2's migration) exists for routing (which surface should render this), not for scoring — worth stating explicitly so a future contributor doesn't mistake it for an evidence-weight field. |
| §3.5's degraded fallback (free-response in chat while this is being built) | Already possible today via the existing `quick_check` design (Task 1.8) alone, before Task 1.6/1.7's session/app work lands — this is a real, useful partial-delivery milestone, not just a fallback for failure |

No separate task list is needed here beyond what Phase 1 already specifies — this section exists so the handoff's own §3 numbering has something to point at, and so the correction from this plan's first draft is visible rather than silently absorbed.

---

## Phase 4: Rich outcomes — the diagnosis is in which wrong answer

**Depends on:** Phase 1 (needs `await_item_outcome`/`submit_quick_check` to attach outcomes to).

This is, per the handoff, "the request most likely to be surprising, and the one the tutor's reason for existing depends on" — worth doing carefully rather than rushing to TDD tasks before the shape is confirmed.

**Schema additions needed:**

1. **Distractor rationale** — the `choice` table needs a field for "which wrong model does picking this represent." New migration:
   ```sql
   ALTER TABLE choice ADD COLUMN misconception TEXT;
   ```
   Nullable — the correct choice has no misconception; existing distractors written before this field existed have `NULL` (not "no misconception," just "not yet annotated" — **Decision Point:** should ingestion (Phase 2) start *requiring* `misconception` on every non-correct MC choice going forward, i.e. a NOT NULL-at-the-application-layer rule enforced in `createQuestions`'s validation, even though the DB column itself stays nullable for backward compatibility with existing rows? Recommend yes, enforced in `domain/questions.ts` validation, not the DB CHECK constraint — this matches the handoff's framing that this is the *point* of items in this system, not an optional enrichment.)

2. **Confidence + IDK as a third outcome, not a wrong answer** — `response` needs a new column:
   ```sql
   ALTER TABLE response ADD COLUMN confidence TEXT CHECK (confidence IN ('unsure', 'somewhat', 'confident') OR confidence IS NULL);
   ALTER TABLE response ADD COLUMN idk INTEGER NOT NULL DEFAULT 0 CHECK (idk IN (0, 1));
   ```
   **Decision Point — confidence scale.** The handoff says "confidence at commitment, where it's cheap to collect" but doesn't specify a scale. A 3-point scale (`unsure`/`somewhat`/`confident`) is proposed above as a reasonable default that's cheap to answer under time pressure — a continuous 0-100 slider would collect more information but cost more attention at exactly the moment the handoff says needs to be cheap. Recommend the 3-point scale; flag as negotiable with the tutor since it consumes their input schema too.
   `idk` as a separate boolean (not a 4th confidence value) matches the handoff's explicit requirement that "I don't know" is "a third outcome, not a wrong answer."
   Both fields need a UI home in `Take.tsx` (Phase 1's app surface) as well as in `submit_quick_check`'s input schema — this phase touches the frontend again, not just the backend, since confidence has to be collected from Ben at answer time in whichever surface he's using.

3. **Which method was misapplied** (the handoff's "one with a deadline" item) — needs a home on `response`, not `choice`, since it's about a wrong *method*, not a wrong *choice*, and only applies once a response is graded:
   ```sql
   ALTER TABLE response ADD COLUMN misapplied_method TEXT;
   ```
   Nullable, free text initially (same free-text-first rationale as `tests_error` in Phase 2).

**Files for this phase (once the Decision Points above are resolved):**
- Create: `server/migrations/0NN_rich_outcomes.sql`
- Modify: `server/src/domain/attempts.ts` — `answerResponse`'s `AnswerResponseChanges` (`attempts.ts:343-348`) needs `confidence`/`idk`/`misapplied_method` plumbed through its `UPDATE`; `getItemOutcome`/`submitQuickCheck` (Phase 1) need to surface them in their return
- Modify: `server/src/mcp/tools.ts` — `submit_quick_check`'s `inputSchema` needs `confidence`/`idk` added (a chat-mediated quick check can still collect them via the tool call, same as the app can via a UI control)
- Modify: `web/src/components/Take.tsx` — needs a confidence/IDK control on the answer UI, wired to the same PATCH route (`answerResponse`)
- Modify: `server/src/mcp/tools.ts` — `choiceShape` (currently `tools.ts:22-25`) needs `misconception: z.string().nullable().optional()`, and `create_questions`'s validation needs the "misconception required on non-correct MC choices" rule from Decision Point 1 above, if adopted

Do not expand this into literal TDD tasks until the three Decision Points above are confirmed.

---

## Phase 5: Scheduling — intervals as a function

**Depends on:** Phase 1 (needs attempts to know what to schedule against), Phase 7 (needs a stable identity to schedule *against*), and a real answer to §5's two design questions, which the handoff explicitly assigns to Osmosis, not the tutor.

**New schema — a per-identity, per-target schedule state.** Nothing like this exists today; `weak_weighted` draw weighting is not a scheduler. Proposed new table:

```sql
CREATE TABLE retention_schedule (
    id              TEXT PRIMARY KEY,
    identity_key    TEXT NOT NULL,        -- shape depends on Phase 7's identity decision
    retention_target TEXT NOT NULL,       -- e.g. an ISO date the material needs to last until, or a free-text reason
    first_gap_days  REAL NOT NULL,        -- computed from Cepeda et al.'s 20-40% / 5-10% ratio table
    due_at          TEXT NOT NULL,
    last_result     TEXT CHECK (last_result IN ('pass', 'fail', 'never_attempted')),
    target_source   TEXT CHECK (target_source IN ('engine', 'tutor_direct')),  -- see Phase 7's identity Decision Point
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (identity_key, retention_target)
);
CREATE INDEX retention_schedule_due ON retention_schedule (due_at);
CREATE INDEX retention_schedule_identity ON retention_schedule (identity_key);
```

**Decision Point — multiple retention targets per identity.** The handoff flags this explicitly ("a section usually has more than one retention target... the tutor's working rule is that the far target sets the schedule and the near one adds an extra pass, but the right handling is a retention question and therefore yours"). `UNIQUE(identity_key, retention_target)` above lets one identity carry several open targets; a `nextDueForIdentity(db, identity_key)` query should take the *minimum* `due_at` across all of that identity's rows (the near target's extra pass), while each row's own `first_gap_days` is computed once, at creation, against its own target's date.

**Decision Point — stale vs. never-had-it.** `last_result`'s three-value enum (`pass`/`fail`/`never_attempted`) is the mechanism — the schedule row must be created (with `last_result: 'never_attempted'`) at the moment the tutor first supplies a retention target for that identity, not lazily on first attempt, or "never learned" and "not yet asked again" become indistinguishable.

**Decision Point — sub-floor probes.** `first_gap_days` needs to accept sub-1-day values (hours, as a fraction of a day) — the `REAL` type above allows this; don't add a `CHECK (first_gap_days >= 1)` guard, which would silently break this requirement.

**New MCP tools needed (sketched, not detailed — depends on the Decision Points above being resolved first):**
- `set_retention_target(identity_key, retention_target, reason?)` — tutor-facing, creates/updates a `retention_schedule` row.
- `get_due_items(before?: string, limit?, offset?)` — returns identities whose `due_at` has passed. This is where Phase 5 connects to `present_item` (Task 1.2) — its `tag_query`-based auto-pick should eventually prefer due items over `Math.random()` once this exists.

**Do not expand Phase 5 into TDD tasks until Phase 7's identity shape is settled.**

---

## Phase 6: Retrospective audit — covering a hole nothing else can

**Depends on:** Phase 4 (needs `misconception`/`provenance` fields to compute the leakage-detection metric) and enough real response volume to be statistically meaningful.

**What this phase computes, per the handoff's §6, and where each metric's inputs live:**

| Metric | Reads from |
|---|---|
| Dead distractors (never picked) | `response.selected_choice_id` grouped by `choice.id`, joined to `choice.question_id` |
| Items that fail to discriminate (no/negative discrimination) | `response_score` view (already exists, confirm exact migration number) joined against `response`, computing a point-biserial-style correlation between "picked this item right" and "scored well overall" — genuinely new statistical code |
| Tutor-authored vs. textbook-sourced pass-rate gap at matched difficulty | `question.provenance` (Phase 2) × `response_score`, grouped by `question.difficulty`, comparing mean scores between provenance groups within each difficulty bucket |
| Auto-retirement of broken items | A new scheduled/on-demand sweep (mirrors the existing pattern in `server/src/grading/scheduler.ts`) that calls `retireQuestion` (already exists) when an item crosses a dead-distractor or negative-discrimination threshold |

**Files for this phase (sketch only):**
- Create: `server/src/domain/audit.ts`
- Create: a `config`-table entry (reusing `domain/config.ts`) for retirement thresholds, not a new table
- New MCP tool: `run_retrospective_audit()` or similar, on-demand rather than automatic at first

**Decision Point — discrimination statistic.** Point-biserial correlation, with a minimum-attempts-per-item floor (e.g. 10) below which an item is excluded from audit output rather than flagged, surfaced as a distinct "not enough data yet" category rather than silent omission.

This phase should not be started until Phase 4 has shipped and accumulated real response history.

---

## Phase 7: Identity — what an item points at

**This is the decision every other phase blocks on**, so resolve it early even though the handoff sequences it last.

**Current state:** `tag.slug` (`math:functions:quadratic`-style, colon-segmented, free-form beyond a regex) is the only identity/hierarchy key in the system. No `textbook_slug`/`section` concept exists. No node-grain concept exists. No self-directed-topic concept exists as a distinct type from a tag.

**The three things the handoff needs this to do, mapped against what tags can already do:**

1. **A section revisited in a different course next year is the same thing.** ✅ Already true — tag slugs carry no course/term component today, so `math:functions:quadratic` is already term-independent by construction.

2. **A node inside a section is addressable.** ❌ Not today. **Recommendation:** don't try to make this a *tag*. Proposed shape: a new nullable `question.node_key TEXT` column, *not* a new tag, and *not* a new hierarchy level under `tag`. `retention_schedule`'s `identity_key` (Phase 5) can then be either a tag slug (section-grain) or a `node_key` (finer-than-section-grain). **Counter-proposal to send back to the tutor:** node keys don't need to nest inside the tag hierarchy at all; they need to *reference* a tag (for rollup/reporting) while being independently addressable for scheduling.

3. **A self-directed topic (no course, no textbook) fits the same shape.** ⚠️ Partially — a tag slug already works as a self-directed topic slug with zero schema change. **The gap:** nothing distinguishes a formally-scoped section from a self-directed one. **Recommendation:** answerable from `question.provenance` (Phase 2) and from `retention_schedule.target_source` (`'engine'` vs. `'tutor_direct'`, already added to Phase 5's table above) — not from anything on `tag` itself.

**Concrete recommendation to send back to the tutor:**

> Osmosis's tag hierarchy already satisfies the "term-independent" requirement by construction, and can host self-directed topics with zero schema change. The one real gap is node-grain addressing, which we're not solving by extending the tag hierarchy — we're adding a `question.node_key` field that references (but doesn't nest under) the tag hierarchy, so the tutor's node keys stay exactly what the handoff already says they should be: stable strings it mints and owns, that Osmosis stores and can schedule against, without Osmosis trying to model node semantics it has no basis to model.

**Files for this phase:**
- Migration: `ALTER TABLE question ADD COLUMN node_key TEXT;` plus `CREATE INDEX question_node_key ON question(node_key) WHERE node_key IS NOT NULL;` — small enough to fold into Phase 2's migration (both are additive nullable columns on `question`)
- Modify: `server/src/domain/questions.ts` and `mcp/tools.ts`'s `questionInputShape` — add optional `node_key`

---

## Phase 8: The session sandbox as a second output surface

**Why this phase exists, stated once rather than repeated per sub-item:** the tutor's own follow-on analysis (fed back after seeing Ben's session design) identified something neither version of the handoff named — the session (Task 1.6/1.7) isn't just a delivery mechanism for items, it's the tutor's **first non-text output surface**. Everything in the original and revised handoff assumed the tutor could only emit text (or, after the §3 revision, present an item and get back pass/fail/which-choice). A rendering surface the tutor can push arbitrary structured content to, and get back structured interaction from — not just an answer to a question — reopens design decisions the handoff made under a constraint that no longer fully holds.

**Depends on:** Task 1.6 (sessions) and Task 1.7 (the live rendering surface) as a floor. Individual items below have further dependencies noted per item.

**Priority, per the tutor's own ranking, not alphabetical or numbered order:** if only one thing from this phase gets built, it's **Item 1** (graph-rendered plan checkpoint) — it's the mandatory step most at risk of becoming a rubber stamp, and clicking-to-disagree is a materially lower bar than composing a written objection, which is the actual audit-quality lever. If a second thing, it's **Item 2** (in-session attempt capture) — it closes the design's most dangerous known-open question (charitable repair masking what Ben actually attempted) and nothing else in this plan can.

### Item 1 — Plan checkpoint as an interactive graph, not transcript mermaid

**What it needs from Osmosis:** a generic way for the tutor to push a renderable, interactive artifact into a session that isn't an item/attempt at all — a dependency graph with nodes Ben can click to approve or dispute, not a question with choices. This does not fit the `attempt`/`response` model Tasks 1.1-1.8 are built on (there's no "correct answer" to a checkpoint), so it needs its own lightweight schema, not a misuse of `question`/`choice`.

**Sketch:**
```sql
CREATE TABLE session_checkpoint (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES tutor_session(id),
    kind        TEXT NOT NULL,              -- 'plan_graph' first; extensible for Item 5's scaffold dial, etc.
    payload     TEXT NOT NULL,              -- JSON: nodes/edges/labels — shape owned by the tutor, opaque to Osmosis
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);
CREATE TABLE session_checkpoint_response (
    checkpoint_id TEXT NOT NULL REFERENCES session_checkpoint(id),
    node_id       TEXT NOT NULL,             -- the tutor's own id for the clicked node, opaque to Osmosis
    action        TEXT NOT NULL CHECK (action IN ('approve', 'dispute')),
    note          TEXT,                      -- optional free text if Ben wants to say why
    responded_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (checkpoint_id, node_id)
);
```
`payload`'s exact shape (node/edge structure) is deliberately left to the tutor, not Osmosis — Osmosis's job is to store and relay it, not to understand dependency-graph semantics, matching the boundary rule. New MCP tools: `present_checkpoint(session_id, kind, payload)` (create + return `checkpoint_id`, same immediate-return-then-poll shape as `present_item`/`await_item_outcome`) and `await_checkpoint_outcome(checkpoint_id)` (bounded poll, same pattern as Task 1.3). New app component reuses `LiveItem`'s polling shell but renders `payload` as a graph (likely via `graph-engine` if its DSL/renderer can be repurposed for a dependency graph rather than a mathematical one — **unverified, check `graph-engine`'s renderer for whether it's mathematically-specific or generic enough to reuse before committing to this**) with click handlers posting to a new `PATCH /api/checkpoints/:id/nodes/:node_id`.

**Decision Point:** whether `payload`'s node/edge JSON schema should be validated by Osmosis at all (the way `graph_spec` is validated against the graph-engine parser today) or accepted opaquely. Recommend opaque for v1 — validating a schema Osmosis doesn't semantically own risks exactly the kind of "reaching around" the boundary rule warns against; if malformed payloads become a real problem in practice, add validation later against whatever shape the tutor settles on.

### Item 2 — In-session attempt capture (closes the charitable-repair gap)

**What it needs from Osmosis:** the ability to capture what Ben actually typed or drew while working a problem, not just a final MC choice or a finished written answer — so the tutor reads the real attempt rather than reconstructing it from Ben's description of it after the fact.

For **typed** work, this is smaller than it sounds: `response.response_text` (already exists) already captures free text, and `Take.tsx`'s existing debounced-save pattern (`WRITTEN_SAVE_DEBOUNCE_MS`, `Take.tsx:12`) already persists it as Ben types, not just on submit — so a written attempt is *already* captured incrementally, not reconstructed. **The real gap is specifically graph-based work** — nothing today lets Ben draw/plot something as a gradable response; `graph_spec` (on `question`) is author-side display content only, never learner-side input. Confirm whether `graph-engine`'s renderer supports an editable/interactive mode (not just static display) before designing this — this plan's research pass never checked, since nothing today asks it to be interactive.

**Sketch, if `graph-engine` does support learner-editable state:**
```sql
ALTER TABLE response ADD COLUMN response_graph_spec TEXT;  -- learner-produced, same DSL as question.graph_spec
```
Captured the same incremental way `response_text` already is — the frontend debounce-saves it via the existing `PATCH /api/attempts/:id/responses/:id` route, which just needs the new field added to `AnswerResponseChanges` (Phase 4 already touches this same interface for `confidence`/`idk`/`misapplied_method` — bundle this in alongside those rather than as a separate migration, since they're all incremental additions to the same answer-recording path).

**If `graph-engine` turns out not to support editable input**, this item either needs a different, simpler capture mechanism (e.g., a plain freehand/coordinate-click canvas, much smaller in scope than reusing the full DSL) or gets deferred — don't force a fit. Resolve this before writing any literal implementation.

### Item 3 — Graphed items unblock the top claim rungs

Not new work beyond confirming a connection: `can_discriminate`-rung items like "which of these four curves is the derivative" or "identify the equivalence point on this titration curve" are just ordinary MC questions with `graph_spec` set — already fully supported by the existing schema and by Phase 2's `claim_rung` field. The only actual gap is delivery (an MC item with a graph needs to render somewhere that can show the graph, which is exactly what Task 1.7's app surface — not chat — provides). No new schema, no new task; this item is here to name why Phase 2's `claim_rung` and Task 1.7's app-rendering matter together, not separately.

### Item 4 — Session log as calibration evidence (and a missing MCP tool)

**This surfaces a real gap in Task 1.6 as originally written**, not new scope: Task 1.6 added `GET /api/sessions`/`GET /api/sessions/:id` as HTTP routes for the *app*, but the tutor talks to Osmosis over MCP, not HTTP — there was no way for the tutor itself to read back session history for its own calibration reasoning. Add:

```typescript
server.registerTool(
  "get_session",
  {
    description: "Read a past tutoring session — its name, tag, and attempt history — for calibration or review.",
    inputSchema: { session_id: z.string() },
  },
  async ({ session_id }) => {
    try {
      return ok(getSessionDetail(db, session_id)); // new domain function, mirrors getAttemptDetail's shape
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_sessions",
  {
    description: "List past tutoring sessions, most recent first.",
    inputSchema: { limit: z.number().optional(), offset: z.number().optional() },
  },
  async ({ limit, offset }) => {
    try {
      const result = listSessions(db, { limit: limit ?? 50, offset: offset ?? 0 });
      return ok({ ...result, has_more: (offset ?? 0) + (result.sessions as unknown[]).length < result.total });
    } catch (err) {
      return fail(err);
    }
  }
);
```
This should really have shipped as part of Task 1.6 — treat it as an amendment to that task, not a separate later task, if Task 1.6 hasn't been executed yet.

### Item 5 — Live scaffold-rung dial

**What it needs from Osmosis:** the same generic checkpoint mechanism as Item 1 (`session_checkpoint` with `kind: 'scaffold_dial'`), showing Ben's current rung and letting him request a different one. The interaction is simpler than Item 1's graph (no nodes/edges, just a current value and a request action), so it can reuse `session_checkpoint`/`session_checkpoint_response` as-is once Item 1's mechanism exists — this item is mostly "Item 1's infrastructure, applied a second way," not independent new schema.

**Decision Point:** does "Ben requests a rung change" go through the checkpoint-response mechanism (a `dispute`-shaped action) or does it need its own action vocabulary (`action IN ('approve', 'dispute', 'request_rung')`)? Recommend widening the `action` CHECK constraint rather than inventing a parallel mechanism, once Item 1 is built and this item's actual interaction shape is confirmed.

### Item 6 — Side-by-side attempt/canonical contrast in the consolidate step

**Depends on Item 2** (there's no learner attempt to show side-by-side with the canonical solution until in-session capture exists). Once Item 2 lands, this is primarily a rendering feature — the raw data (`response.response_text`/`response_graph_spec`, the question's own `model_answer`/`explanation`) already exists; showing them side-by-side with a marked divergence point is a `LiveItem`-adjacent frontend view, and computing *where* they diverge is the tutor's diagnosis work (its job per the boundary rule), not Osmosis's — Osmosis's role is just to make both pieces of content available to render together, which it already does once Item 2 exists.

### Item 7 — Interleaved sets as a live queue

**Mostly already covered by Task 1.6's session-specific templates**, not new scope: `create_template` with a `session_id` (Task 1.6) already lets the tutor build a mixed-type item set scoped to one session, and the app's existing template-taking flow already presents a multi-question attempt without labeling each question's underlying concept/tag to the test-taker (confirm this by reading `QuestionPanel.tsx`, per Task 1.7's own outstanding verification note — don't assume). The one genuinely new piece: a session-level message slot (e.g., `tutor_session.interleave_note TEXT`, or reuse `session_checkpoint` with `kind: 'interleave_note'`) so the tutor can pre-announce "accuracy will drop here, that's expected" the way the handoff's own research requires, rather than the drop reading as unexplained regression.

### Item 8 — Confusion-pattern computation from session structure

**Depends on Phase 4** (`misapplied_method`) **and Item 7** (interleaved session structure) — this is Phase 6's discrimination/audit work, scoped to one session instead of the whole bank: once a session's response pattern is known (which items were competing, which method got misapplied on which), "problems from §X missed by applying §Y's method" becomes a query over `response.misapplied_method` grouped by `question` tag, filtered to one `session_id`. Recommend building this as a session-scoped variant of Phase 6's `domain/audit.ts`, once both dependencies exist — not before, and not as new infrastructure of its own.

### Guardrail: the shared mid-node scratchpad — do not build without enforcing turn-based writes

The tutor's own analysis flagged this one as worth being careful with, and it's binding enough to belong in Global Constraints, not just this phase's notes: **a scratchpad the tutor can write into while Ben is actively working is a route around commit-before-reveal that doesn't look like one** — the same withholding invariant this whole plan treats as load-bearing (Global Constraints, above) would be silently defeated by a tutor annotation landing mid-attempt. If this is ever built, the mechanism must be strictly turn-based: the tutor may write only after Ben has committed his current turn (submitted a response, or explicitly signaled "I'm stuck" via Item 5's dial), never concurrently with an in-progress, uncommitted attempt. This isn't a Decision Point to resolve later — it's a hard constraint on the feature, stated here so it isn't lost if this item gets picked up without re-reading this whole document.

### Cross-cutting: "promote to bank" — items authored inside a session shouldn't be dead-ended there

**A gap in Phase 2 as written**, surfaced by this feedback: Phase 2 gives every question `provenance` (tutor-authored vs. textbook-sourced) but nothing today distinguishes an item hastily authored for one specific session probe (e.g., a discriminating item built on the spot to test one hypothesis) from a deliberately bank-worthy one — and nothing prevents a good session-born item from just sitting there, unscheduled and unsearched, because nothing ever pointed retention scheduling (Phase 5) or general search at it.

**Proposed shape, extending Phase 2's migration:**
```sql
ALTER TABLE question ADD COLUMN session_id TEXT REFERENCES tutor_session(id);  -- nullable: set only for session-born items
ALTER TABLE question ADD COLUMN promoted_at TEXT;                              -- nullable: set once promoted to the general bank
```
**Decision Point — does an unpromoted session item stay invisible to `search_questions`/`get_eligible_questions`/draws by default, or just unscheduled?** Two real options: (a) `session_id IS NOT NULL AND promoted_at IS NULL` items are filtered out of `getEligibleQuestions`/`searchQuestions`'s default results entirely (visible only via `session_id`-scoped queries, i.e. within the session that spawned them) until promoted — the stricter, "scratch until proven" reading; (b) they're always visible everywhere, and `promoted_at` is purely informational, with promotion only mattering for Phase 5's scheduling (an unpromoted item never gets a `retention_schedule` row, but can still be drawn ad hoc). Recommend (a) — it matches the "session sandbox" framing (a sandbox implies things don't leak out until deliberately released) and avoids a hastily-worded discriminator item, written to test one specific hypothesis in one specific session, showing up in an unrelated homework template before anyone's reviewed it.

New MCP tool: `promote_question(question_id)` — sets `promoted_at = datetime('now')`, no other side effects (the item's `session_id` stays, for provenance/traceability — it's still true the item was born in that session, promotion doesn't erase that history, it just lifts the visibility restriction).

---

## Scope estimate to report back to the tutor (per §10 of the handoff)

Two things the handoff explicitly asks Osmosis to send back:

**1. Scope estimate on §1 (live request/response).** Moderate, and larger than this plan's own first draft under-scoped it as — worth being honest about that revision. The attempt/response/grade lifecycle, the answer-withholding snapshot pattern, and MC auto-grading already exist and are exercised daily by the production web app: that part is genuinely proven, low-risk work (Tasks 1.1-1.5 and 1.8, all backend, all fully TDD-specified in this plan). What's *not* small is the app-mediated delivery loop the revised §3 correctly insists on: a new session concept for organizing and navigating to live items (Task 1.6), a new frontend surface for the app to discover and render a tutor-created item within a session (Task 1.7), and a bounded-poll MCP pattern instead of a single blocking call, driven by the real constraint that Osmosis's MCP transport is a stateless-per-request HTTP endpoint behind a tunnel, not something that can hold a connection open indefinitely waiting on a human. Rough shape: the backend pieces (Tasks 1.1-1.5, 1.8, and the schema/tool half of Task 1.6) are well-specified, low-risk work; the frontend surfaces (Task 1.6's session UI, Task 1.7's live-item view) are real but bounded new UI work — the one open call left (polling cadence) is a taste decision, not a blocker. Not a rearchitecture, but not "two thin MCP wrappers" either, which is what an earlier pass of this plan claimed before the app-primary requirement was confirmed. **This still changes the tutor's sequencing assumption in one respect**: none of this needs new schema beyond a handful of small additive columns and one new table (`tutor_session`), and none of it depends on any other phase — so while it's not the smallest possible lift, it remains the correct thing to sequence first, and nothing about its real size threatens the ordering.

**2. Whether the tag hierarchy can carry §7 with a convention.** Mostly yes, with one clean addition rather than an extension of the existing hierarchy. Tag slugs are already term-independent by construction and already support self-directed topics with zero special-casing. The one real gap — node-grain addressing finer than a section — is deliberately *not* solved by adding a deeper level to the tag hierarchy; it's solved by a new `question.node_key` field that references a tag but doesn't nest inside it, matching the tutor's own description of node keys as tutor-minted, tutor-owned stable strings rather than taxonomy entries Osmosis should be governing. See Phase 7 above for the full reasoning and the counter-proposal text to send.

## Self-review notes (for whoever executes this plan)

- **Tasks 1.1-1.5, 1.8, and Task 1.6's schema/MCP half are fully verified against real current code** (every function signature, table schema, and line number cited was read directly from the repository, not reconstructed from memory) — execute them as written. **Task 1.7 (and Task 1.6's frontend half) are deliberately not to that standard** — they name real files to reuse (`Take.tsx`, `QuestionPanel.tsx`, `GraphPanel.tsx`, `DesmosPanel.tsx`, `web/src/lib/api.ts`) but this plan's research pass didn't read `Take.tsx`'s full body, `QuestionPanel.tsx`, or the app's routing/layout — read those before writing literal frontend implementation, and settle the remaining polling-cadence Decision Point with Ben first (the screen-vs-overlay question from the first pass is already resolved by Ben's session design).
- **Phases 2, 4, 5, 6, 7 are deliberately not expanded to literal TDD steps**, each for the same reason: at least one Decision Point changes its schema shape, and writing test code against a guessed schema is exactly the "confirm things that aren't true" failure mode the handoff's own opening section warns against repeating.
- **Phase 3 was restored, not left folded into Phase 1**, correcting this plan's own first-draft mistake once the handoff's revised §3 made clear the app is the primary surface, not a workaround. The correction is documented explicitly in the revision note at the top of this file and in Phase 3 itself, rather than silently rewritten, since the mistake is instructive: it's the same failure mode (designing around a requirement while having just acknowledged it) the handoff's own revision history flags in itself.
- **Migration numbering**: Task 1.2 claims `009_delivery_mode.sql`; Phase 2's migration is renumbered to `010` accordingly. If Phase 1 and Phase 2 end up executed out of order or by different people, re-check the actual highest existing migration number in `server/migrations/` before assigning either number — don't trust this document's numbers if time has passed and other migrations may have landed first.
