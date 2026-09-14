# Rich outcomes, cloud tests, and the canonical sync pill — design

Date: 2026-09-14. Status: approved in chat, implementation plan follows.

## Context

Osmosis is now hosted (see `DEPLOY.md`): one canonical node on `puplirserver`
serving the API, the MCP endpoint, and the web app. The first live tutoring
session exposed three gaps, and the tutor side delivered a requirements audit
(`07` §1 asks, checked against the live tool surface). This design covers the
parts of that audit that change *existing* read paths plus two app-side
behaviours Ben asked for. Schema-level asks from the audit (three-way
`authored_from`, `node_keys[]`, due-item reasons beyond what `last_result`
already encodes, `course_ref`, idempotency keys, psychometrics) are explicitly
out of scope here and get their own design.

## Goals

1. **Outputs as rich as inputs.** Every field a response accepts on the way in
   (`selected_choice_id`, `response_text`, `confidence`, `idk`,
   `misapplied_method`, `elapsed_ms`) is readable on every outcome path the
   tutor uses: `await_item_outcome`, `submit_quick_check`, `get_results`
   (question scope), and a new `get_attempt` tool.
2. **Latency is actually recorded.** The app sends `elapsed_ms`; today the
   column exists and nothing writes it.
3. **An ungraded response is not a zero.** Every mean over scores ignores
   `NULL` and reports an `ungraded` count beside it.
4. **Due items say why they are due.**
5. **The canonical node's sync pill shows a real time**, not "synced never".
6. **Cloud tests.** On a local node, a template that is not downloaded can
   still be started while online by drawing from the canonical server; a
   downloaded template draws locally and works offline. Multiple local devices
   each hold their own downloads. Deleting a download returns the template to
   cloud-only.

## Non-goals

- Anything that changes the `question` schema (node sets, provenance values).
- Linking outcomes to `retention_schedule.last_result` (nothing calls
  `recordRetentionResult` today; that is the retention-model design).
- Psychometrics, idempotency keys, homework due dates.

---

## 1. Outcome record

`getItemOutcome` (backs `await_item_outcome`) and `submitQuickCheck` return,
for `status: "answered"`:

```
{
  status: "answered",
  outcome: "correct" | "partial" | "incorrect" | "dont_know" | "ungraded",
  score: number | null,            // live grade's score, null when ungraded
  correct: boolean | null,         // unchanged: mc only
  selected_choice_id: string | null,
  chosen_misconception: string | null,   // choice.misconception of the selected choice
  correct_choice_id: string | null,
  response_text: string | null,
  confidence: "unsure" | "somewhat" | "confident" | null,
  idk: boolean,
  misapplied_method: string | null,
  elapsed_ms: number | null,
  answered_at: string | null,
  explanation: string | null,
  model_answer: string | null,
}
```

`outcome` derivation, in order: `idk` → `dont_know`; no live grade →
`ungraded`; score ≥ 1 → `correct`; score ≤ 0 → `incorrect`; else `partial`.

`submitQuickCheck` currently returns only `{ explanation, model_answer }`. It
returns the full record above instead (it already has everything after
`submitAttempt`). The tutor's complaint that a written answer's text was not
visible is fixed by this.

New MCP tool `get_attempt(attempt_id)` returns `getAttemptDetail` unchanged.
Its per-response shape already carries every input field plus the live grade.
Registered in `mcp/tools.ts`; description points the tutor at it as the
attempt-scope read.

## 2. `get_results` question scope

`recent_responses` is returned for every question type, not only written, and
each entry becomes:

```
{ response_text (truncated), selected_choice_id, idk, confidence,
  misapplied_method, elapsed_ms, score, answered_at }
```

Per-lineage row also gains `graded` (count of scored responses) and
`ungraded` (count with no live grade). `responses` stays the total.

## 3. Latency from the app

`Take.tsx` keeps a per-response elapsed counter: time accumulates while a
response is the visible one (start on show, pause on navigate away, resume on
return). Every answer PATCH for that response includes the current
`elapsed_ms`, and leaving a question (Next, dot navigation, Finish) sends one
PATCH with `elapsed_ms` if the counter moved since the last send. The server
already accepts and stores it; `answerResponse` validates it as a non-negative
number (done today).

## 4. Null score is not zero

Every `AVG(COALESCE(rs.score, 0))` becomes `AVG(rs.score)` (SQLite `AVG`
ignores `NULL`), and each aggregate that reports a mean also reports
`ungraded`. Touch points:

| Where | Change |
|---|---|
| `tag_performance` view (migration `015_null_score_not_zero.sql`, `DROP VIEW` + `CREATE VIEW`) | `mean_score = AVG(score)`, `misses` counts only graded responses `< 0.5`, new `graded` column |
| `results.ts` tagScope `recent_mean`/`prior_mean` | `AVG(score)` |
| `results.ts` questionScope, attemptScope, dailyScope | `AVG(score)` + `ungraded` |
| `attempts.ts` listAttempts, `sessions.ts` getSessionDetail | `AVG(score)` + `ungraded` |
| `templates.ts` toSummary | attempt mean over graded responses only |
| `bootstrap.ts` weakest_tags | reads the view; unchanged code |
| `Review.tsx` | mean over graded responses; header shows "n ungraded" when > 0 |

`draw.ts` weak weighting already filters `score IS NOT NULL`; unchanged.

## 5. Due-item reason

`getDueItems` rows gain `reason`: `never_demonstrated` when
`last_result = 'never_attempted'`, `decayed` after `pass`, `lapsed` after
`fail`. Pure derivation, no schema change.

## 6. Canonical sync pill

`/api/status` gains `last_write_at`: the latest of `MAX(question.created_at)`,
`MAX(tag.created_at)`, `MAX(attempt.submitted_at)`, `MAX(asset.created_at)`.
Home and Settings render the pill as:

- canonical: `up to date · <timeAgo(last_write_at)>` (or `up to date` when
  the bank is empty)
- local: `synced <timeAgo(last_pull_at)>` as today; `never` only if no pull
  has ever succeeded.

## 7. Cloud tests

### Vocabulary

- **downloaded**: every tag literal the template's `tag_query` references is
  a held slice on this node (`TemplateSummary.downloaded`, exists today).
  Draws locally; works offline.
- **cloud**: not downloaded. Runs only while online by asking canonical for
  the draw. On the canonical node itself every template is local by
  definition; the app hides download controls there (exists today).

### Canonical side: `POST /sync/template-draw`

Request `{ node_id, protocol_version, template_id }`. Resolves
`resolveTemplateDraw(db, template_id)` on canonical (frozen templates return
their frozen set) and answers exactly like `/sync/daily-draw`:

```
{ protocol_version, template_id, tags, questions, question_order,
  short_draw, requested, returned, mix_adjusted }
```

`tags` is the ancestor closure of every tag on the drawn questions
(`fetchTagAncestorClosure`), `questions` the full `buildQuestionPayloads`
rows. 404 (`not_found`) for an unknown template, 400 `template_retired` for a
retired one, both as `{ error, message }`.

### Local side: `fetchAndApplyTemplateDraw(ctx, templateId)`

Mirrors `fetchAndApplyDailyDraw`: POST to `${remoteUrl}/sync/template-draw`,
then in one transaction `upsertBankContent(tags, questions)`. Returns the
ordered question list. The mirrored questions carry no slice; they persist
because their responses reference them, and `removeSlice`'s prune already
skips referenced questions.

### `createAttempt` accepts a pre-resolved draw

`CreateAttemptInput` for `source: "template"` gains optional
`questions?: EligibleQuestion[]`. When present the template path skips
`resolveTemplateDraw` and inserts responses for exactly those questions in
order. Template existence is still checked. A draw with zero questions is
rejected with `DomainError("empty_draw")` on both paths — today an empty local
pool creates an attempt with no responses and the Take screen crashes on it.

### `POST /api/attempts` (source template) on a local node

```
downloaded (all literals held)        → local draw (as today)
not downloaded, online                → cloud draw via fetchAndApplyTemplateDraw
not downloaded, offline               → 503 { reason: "template_requires_connection" }
canonical                             → local draw (as today)
```

"Downloaded" is decided by the same slice check `toSummary` uses
(`referencedTagLiterals` all present in `local_slice`), factored into a
`isTemplateDownloaded(db, templateId)` helper in `templates.ts`.

`/api/templates` (list) gains no new fields; `downloaded` already exists and
`/api/status.online` already exists. The response for a cloud-drawn attempt
includes `{ short_draw, requested, returned, mix_adjusted }` like the daily
path.

### App

- Library card and detail: badge reads `downloaded` or `cloud`. The Start
  button is disabled with title "Offline — download this test to use it
  offline" when `!status.online && !template.downloaded && !isCanonical`.
  Same gate on Home's Start button and on TemplateDetail's.
- Delete keeps working as today (removes the slices not needed by another
  downloaded template); the card flips to `cloud`.
- Home's start error surfaces the 503 reason as "This test needs a
  connection, or download it first."

### Multiple devices

Nothing new is required: each local node has its own `node` row, its own
`local_slice` set, and pushes its own attempts. Cloud draws are per-request
and stateless on canonical. Two devices starting the same non-frozen cloud
template get independent draws, which matches local behaviour.

## Testing

Vitest, `server/tests/`:

- `outcomeRecord.test.ts` — mc correct / incorrect / dont_know, written
  ungraded then self-graded partial; `chosen_misconception` present;
  `submitQuickCheck` returns `response_text`.
- `getAttemptTool.test.ts` — MCP handler envelope for `get_attempt`, 404 path.
- `resultsResponses.test.ts` — question scope returns `recent_responses` for
  mc with `selected_choice_id`; `graded`/`ungraded` counts.
- `nullScore.test.ts` — one graded 1 + one ungraded → `mean_score` 1,
  `ungraded` 1, at attempt, question, tag (view), session, template, daily
  scopes.
- `dueReason.test.ts` — three `last_result` values map to three reasons.
- `statusLastWrite.test.ts` — `last_write_at` null on empty bank, latest of the
  four sources otherwise.
- `templateDraw.test.ts` — canonical route shape, 404/400 cases; local
  `fetchAndApplyTemplateDraw` mirrors questions and tags; `createAttempt` with
  explicit questions preserves order; empty draw rejected.
- `cloudTemplateRoutes.test.ts` — two-node HTTP test in the
  `dailyDrawDurability` style: local + canonical, template not downloaded →
  online creates attempt from canonical's draw; offline → 503; after
  downloading → local draw without touching canonical.

Web: typecheck + lint; manual browser pass on Take (latency in PATCH bodies),
Library gating, pill text.

## Deployment

After merge: on `puplirserver`, `cd ~/Osmosis && git pull && bash
deploy/install.sh` (rebuilds, runs migration 015, restarts the service). The
cloudflared tunnel is untouched. Verify `await_item_outcome` on a fresh
`present_item` returns the new fields through the public URL.
