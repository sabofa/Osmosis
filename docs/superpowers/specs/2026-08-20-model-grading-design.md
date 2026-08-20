# Model Grading (DeepSeek-V4-Flash)

Date: 2026-08-20

## Context

This is the third of three backend gaps identified in the original repo
survey (sync ✅ merged, daily draws ✅ merged, model grading — this spec).
The schema and supersede semantics for model grading already exist
(`grade.grader = 'model'`, the `grade_one_live_per_response` unique
partial index, and a guard in `gradeResponse` — `attempts.ts:493` —
refusing a self-grade to overwrite a live model grade without
`override: true`). Sync already carries model grades both directions:
`applyPushRequest` computes `regrade_queued` (accounting only — nothing
currently consumes it) and `buildPullResponse`/`applyPullResponse`
already sync `grader = 'model'` rows back down to their originating node.
What's missing is the piece that actually produces a model grade: a real
LLM call.

The original design's plan ("API key in config, server UI only") doesn't
fit this app's actual architecture — there is no separate server-only UI;
every node serves the same web SPA. This spec replaces that with an env
var, matching the existing `MCP_AUTH_TOKEN` pattern.

Scope was narrowed during brainstorming based on direct user feedback:
the user is skeptical of this feature's value ("I can grade myself at
times") and wants firm cost control, not full spec parity. Two decisions
follow from that: only `written_grader`'s `self_only` and
`model_when_online` modes are built (not `model_required`, which adds
offline-draw-exclusion complexity for a mode the user is unlikely to
use), and a hard daily cap on model-grading calls is a first-class,
user-adjustable setting, not an afterthought.

## Goals

- A written response that's been self-graded gets picked up by a
  canonical-only background sweep, sent to DeepSeek-V4-Flash for grading,
  and the resulting model grade supersedes the self-grade — exactly the
  supersede semantics the schema already enforces.
- The DeepSeek API key lives in an env var (`DEEPSEEK_API_KEY`), never in
  the SQLite `config` table, never settable via MCP or `/api`.
- A hard, user-adjustable daily cap (`model_grader_daily_limit` config
  key, default 20) bounds worst-case spend to a fixed, predictable number
  of API calls per rolling 24 hours — enforced in the sweep itself, not
  just documented.
- `written_grader` defaults to `self_only` (the feature does nothing,
  costs nothing, until the user explicitly turns it on) — matches the
  user's stated preference to mostly self-grade.
- Settings UI: a `written_grader` mode toggle, an editable daily-limit
  number field, and a live "X of Y grades used today" indicator, so cost
  exposure is always visible, not just capped.

## Non-goals

- `model_required` mode and its offline-draw-exclusion behavior —
  explicitly dropped per the scoping decision above.
- Any new npm dependency — the DeepSeek API is OpenAI-compatible REST,
  called with plain `fetch`, matching the sync client's existing
  convention (`server/src/sync/client.ts`) rather than adding an SDK.
- Making `regrade_queued`'s HTTP-response value do anything beyond what
  it already does (an accounting signal in the push response) — the
  actual sweep queries the `grade`/`response` tables directly rather than
  consuming a persisted queue, since the eligibility condition ("written,
  live grade is self, no live model grade") is fully expressible as a
  direct SQL query against existing tables. No new queue table.
- Any change to the grading rubric/prompt beyond a single, versioned
  template (see Design) — prompt engineering iteration is a future
  concern, not blocking this spec.

## Design

### Grading call

`server/src/domain/modelGrading.ts`, new file:

```ts
export interface GradeCallParams {
  prompt: string;
  modelAnswer: string;
  rubric: unknown | null; // parsed JSON, e.g. {"criteria":[{"point":"...","weight":0.4}]}
  responseText: string;
}
export interface GradeCallResult {
  score: number; // clamped to [0, 1]
  feedback: string;
}
export async function gradeWithDeepSeek(
  apiKey: string,
  params: GradeCallParams,
  fetchImpl: typeof fetch = fetch
): Promise<GradeCallResult>;
```

Calls `POST https://api.deepseek.com/chat/completions` with
`Authorization: Bearer <apiKey>`, `model: "deepseek-v4-flash"`,
`response_format: {type: "json_object"}`, and a system+user message
constructed from `params` instructing the model to grade the response
against the model answer and rubric (when present) and return exactly
`{"score": <0-1 float>, "feedback": "<1-3 sentences>"}`. The `fetchImpl`
parameter exists purely for testability (inject a stub in tests; defaults
to the real global `fetch` in production) — this mirrors the existing
`rng: () => number = Math.random` injection pattern already used in
`draw.ts`'s `resolveDrawFromParams`.

Response parsing: `JSON.parse` the completion content, clamp `score` to
`[0, 1]` (a malformed or out-of-range score from the model shouldn't be
allowed to violate the `grade.score BETWEEN 0 AND 1` CHECK constraint —
clamp defensively rather than trust the model's arithmetic), and throw a
clear error if the response isn't valid JSON with a numeric `score` field
(the sweep catches and logs this per-response, per Error Handling below,
rather than letting one malformed response kill the whole sweep).

A single exported `RUBRIC_VERSION` constant (e.g. `"v1"`) is stored on
every model grade written by this spec's prompt template, bumped by hand
whenever the template changes materially enough that old and new grades
shouldn't be treated as directly comparable.

### Writing the grade

```ts
export function writeModelGrade(
  db: DatabaseSync,
  responseId: string,
  result: GradeCallResult
): void;
```

Reuses `attempts.ts`'s existing supersede transaction shape (see
`gradeResponse`): if a live grade exists for `responseId`, set its
`superseded_at`; insert the new grade with `grader: 'model'`,
`model_name: 'deepseek-v4-flash'`, `rubric_version: RUBRIC_VERSION`. This
function does not itself check "is the existing live grade a self-grade"
— it's only ever called from the sweep, which already selected exactly
those responses (see below), so the precondition holds by construction.

### The sweep

```ts
export interface SweepResult {
  graded: number;
  skipped: number; // written responses eligible but past today's cap
  errors: number;   // grading calls that failed/parsed badly, logged, not fatal
}
export async function sweepModelGrading(
  db: DatabaseSync,
  apiKey: string,
  dailyLimit: number,
  fetchImpl: typeof fetch = fetch
): Promise<SweepResult>;
```

1. Read `config.written_grader`. If `self_only`, return
   `{graded: 0, skipped: 0, errors: 0}` immediately — no query, no calls,
   no cost.
2. Count model grades already written in the last rolling 24 hours
   (`SELECT COUNT(*) FROM grade WHERE grader = 'model' AND graded_at >=
   datetime('now', '-1 day')`) — a rolling window, not a calendar-day
   boundary, deliberately avoiding any dependency on `daily_timezone`
   machinery for what's fundamentally a cost-safety knob, not a
   user-facing "today" concept.
3. Query eligible responses: written type, has a live grade with
   `grader = 'self'`, no live grade with `grader = 'model'` (i.e.
   `response.id` joined through `grade` where the current live row's
   `grader = 'self'` — this is exactly "self-graded, not yet
   model-graded").
4. Process up to `dailyLimit - alreadyGradedInWindow` of them (0 if
   already at/over the cap — the rest count as `skipped`), calling
   `gradeWithDeepSeek` then `writeModelGrade` for each. A per-response
   failure increments `errors` and moves to the next response rather than
   aborting the sweep (see Error Handling).

### Trigger

A canonical-only background timer, `server/src/grading/scheduler.ts`
(new module, small — this is deliberately its own file rather than
folded into `sync/client.ts`, since sync's timers are local-node-only and
this one is the opposite: canonical-only), calling `sweepModelGrading`
every 5 minutes. Wired into `server/src/index.ts` alongside the existing
`startSyncBackground` call, gated on `ctx.env.role === "canonical"` (the
mirror-image gate of `startSyncBackground`'s `role === "local"` check).
No-ops with zero cost/API calls if `DEEPSEEK_API_KEY` isn't set in the
environment — the feature is fully inert by default on a fresh install.

### Config & env

- `server/src/env.ts`: add `deepseekApiKey: string | null` to
  `EnvConfig`, read from `process.env.DEEPSEEK_API_KEY`, optional (no
  `required()` call — canonical can run without it, the scheduler just
  never has anything to do).
- New migration `008_model_grader_daily_limit.sql`: seeds
  `model_grader_daily_limit` into `config` with default `'20'`, same
  idempotent `INSERT ... WHERE NOT EXISTS` pattern as migration 006.
  `model_grader_daily_limit` is added to `config.ts`'s `ALLOWED_KEYS` (it
  is not a secret — safe to read/write over `/api/config`, unlike the API
  key itself).

### HTTP surface

No new routes required for the sweep itself (it's a pure background
timer). `GET /api/status` gains one additional field,
`model_grades_today: number` — the same rolling-24h count the sweep
itself computes, exposed for the Settings indicator. Computing it is
cheap (one `COUNT(*)` query) and meaningful on every node (0 on a node
that isn't canonical or doesn't have grading configured — harmless, not
worth hiding behind a role check).

### Frontend

`web/src/components/Settings.tsx`, functional-only (same discipline as
the sync-protocol and daily-draws plans' frontend work — reuse existing
patterns, no redesign):
- A `written_grader` toggle (two options: self_only / model_when_online)
  — a simple two-state control; check `Settings.tsx` for an existing
  toggle/select pattern to reuse (e.g. `ThemeEditor`'s mode selector, if
  its shape fits) before inventing a new one.
- A `model_grader_daily_limit` field using the existing `NumberSetting`
  component (already used for `synced_attempt_retention_days`,
  `daily_quiz_size`, etc. in this same file).
- A read-only "`X of Y` grades used today" line, sourced from the new
  `/api/status` field and the `model_grader_daily_limit` config value.

### Error handling

- A DeepSeek API call that fails outright (network error, non-2xx) or
  returns unparseable/invalid JSON is caught per-response inside the
  sweep loop, logged (server-side `console.error` or the existing
  Fastify logger, matching how other background failures in this
  codebase are surfaced — check `sync/client.ts`'s error handling for the
  established convention), counted in `SweepResult.errors`, and the
  response is left at its current self-grade (not retried within the
  same sweep pass — it remains eligible and gets picked up again on the
  next scheduled sweep, naturally self-healing without special retry
  logic).
- A missing `DEEPSEEK_API_KEY` when `written_grader` is
  `model_when_online`: the scheduler simply never calls `sweepModelGrading`
  in the first place if the key is absent (checked once at scheduler
  start, not per-tick) — this should also surface somewhere visible in
  Settings (e.g. the "X of Y" line reads "not configured" instead of a
  count) so the user isn't confused about why grading silently isn't
  happening after they flip the toggle.

## Testing / verification

- `gradeWithDeepSeek`: unit tests with a stubbed `fetchImpl` covering
  success (valid JSON response → correct score/feedback), out-of-range
  score clamping, and malformed-JSON error handling.
- `writeModelGrade`: unit test confirming supersede semantics (existing
  self-grade's `superseded_at` gets set, new grade is live, `grader`/
  `model_name`/`rubric_version` correct) — matches the existing
  `gradeResponse` test style in `tests/attempts.test.ts`.
- `sweepModelGrading`: tests for — `self_only` mode makes zero calls;
  respects the daily limit (seed grades already in the rolling window,
  confirm `skipped` accounts for the remainder); a per-response API
  failure doesn't abort processing of the rest of the batch.
- Manual verification requires a real `DEEPSEEK_API_KEY` (not available
  in an automated test run) — the implementer's report should note this
  plainly rather than claim end-to-end verification without one; domain-
  level tests with a stubbed fetch are the primary coverage.

## Open questions

None outstanding — scope, cost controls, and the secrets-storage
approach were all confirmed with the user during brainstorming.
