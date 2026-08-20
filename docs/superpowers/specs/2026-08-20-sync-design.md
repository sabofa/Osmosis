# Sync (Push/Pull Protocol)

Date: 2026-08-20

## Context

Osmosis's backend has three real gaps versus the original design (see the
2026-08-19 repo-orientation notes): sync, daily draws, and model grading.
This spec covers sync only — the foundational piece, since daily draws
depend on the online/offline distinction sync provides, and both were
called out separately during brainstorming to keep each spec focused on one
subsystem. Daily draws and model grading get their own specs later. A
fourth item, a hidden debug/stress-test API for exercising all of this
programmatically, comes after all three backend subsystems exist.

The schema for this already exists (`server/migrations/001_init.sql`):
`outbox`, `local_slice`, `sync_state` tables, `attempt.offline` /
`attempt.synced_at` columns, `grade` table with supersede semantics. Only
`GET /sync/health` is wired up (`server/src/http/app.ts:24-27`); nothing
populates or drains the outbox, and there is no `/sync/pull` or
`/sync/push` handler.

There is also a pre-existing placeholder to retire: `local_template`
(`server/migrations/003_local_template.sql`), a simple "downloaded"
marker for the Library UI's template-download toggle, explicitly written
as a stand-in "ready to be backed by an actual sync later without
changing its shape" (its own migration's comment). This spec replaces it.

Deployment context: sync is developed and exercised as two instances on
one machine (`canonical` on one port, `local` on another) for now, per
the original plan's Phase 0 reasoning — killing one process makes offline
genuinely, unsimulatably offline. Deploying to a real remote server is a
separate, later step once sync is proven locally.

## Goals

- Implement the sync protocol exactly as specified in the existing
  `SPEC-Osmosis.md`-derived design (§8, reproduced/summarized below):
  cursor-based pull of bank content (tags, questions, templates, grades
  scoped to the requesting node), idempotent batched push of results
  (attempts, responses, grades).
- A local node's outbox is populated on every attempt submit / grade
  write, drained on every successful push, and never loses data —
  survives process kills mid-push, survives extended offline periods,
  survives a replayed push (idempotent by locally-generated UUID primary
  key).
- Slice management becomes real: `local_slice` (tag-based) replaces
  `local_template` as the mechanism controlling what bank content a local
  node holds. Removing a slice prunes local questions in it that no local
  response references; adding one triggers a full pull.
- The Library page's existing "download a template" UX is preserved,
  reimplemented underneath as "add this template's referenced tags as
  slices" instead of writing to `local_template`.
- All five sync trigger conditions from the spec are wired: app start, on
  submit if online, periodic (`sync_interval_sec`), manual
  (`POST /api/sync`), and offline→online transition.
- A connectivity monitor pings the remote's `/sync/health` every 30s
  (local nodes only) and exposes `online` via the existing `/api/status`.
- `protocol_version` mismatch is recorded and already has a read path via
  `/api/status`'s `remote_protocol_version` field — sync just needs to
  populate it from every sync response.

## Non-goals

- Daily draws, model grading, the debug/stress-test API — separate specs.
- Actual deployment to a real remote server — sync is built and tested as
  two local instances; real deployment is a later, separate step.
- Any frontend work beyond what's needed to keep Library's download
  button and add functional (not redesigned) slice controls to Settings.
  Settings' visual redesign is the previously-deferred, separate spec.
- Auto-update on `protocol_version` mismatch — out of scope for 1.0 per
  the original spec (§14); this spec only records and surfaces the
  mismatch, doesn't act on it.

## Design

### Domain layer (testable without HTTP)

`server/src/domain/sync.ts`:

- `buildPullResponse(db, request)` — canonical-side. Cursor-based
  (`since` = `created_at`/`retired_at`) export of tags, questions (full
  shape including `graph_spec`/`desmos_allowed`/`document_*` columns
  added in migrations 004/005), templates, and — when
  `include_grades_for_node` is set — grades written against responses
  that originated from the requesting `node_id` since `since` (the
  mechanism that returns a model re-grade to the node that produced the
  original written answer). `slices` in the request are tag slugs;
  expansion to descendants happens server-side (existing tag-hierarchy
  query logic, same as template eligibility resolution). Returns a
  `cursor` (server's current time) for the next `since`.
- `applyPushRequest(db, request)` — canonical-side. Idempotent upsert by
  primary key for `attempts`, then `responses`, then `grades`, in that
  order (foreign keys resolve). Each row's ID is checked against existing
  data: if absent, insert and report `accepted`; if present and identical
  in effect, report `duplicate` (never an error); if a referenced
  question/attempt ID doesn't exist, report `rejected` with a reason.
  Written responses arriving fresh (no existing grade) that come from
  local self-grades get queued for model regrading — returns
  `regrade_queued` (empty in practice until the model-grading subsystem
  exists, but the accounting is correct now).
- `applyPullResponse(db, response)` — local-side. Upserts tags/questions/
  templates by PK (a non-null `retired_at` on an incoming row applies the
  retirement — the local row is never deleted, since local responses may
  still reference it). Applies incoming grades (upsert by PK, respecting
  the same supersede semantics as local grade writes). Updates
  `local_slice.pulled_at`/`question_count` for slices covered by the
  pull. Stores the response's `cursor` for the next pull's `since`.

Both `buildPullResponse`/`applyPushRequest` (canonical) and
`applyPullResponse` (local) are unit-testable directly against
`openTestDb()` fixtures with no HTTP involved, matching the existing
`attempts.test.ts` pattern: two in-memory DBs in one test file, canonical
building a response, local applying it, assertions on both sides.

### Local node's sync engine

`server/src/sync/client.ts`:

- `runSync(ctx): Promise<SyncResult>` — push-then-pull against
  `env.remoteUrl` via `fetch`, in that order (spec §8.4: results are
  irreplaceable, bank content is always re-pullable, so push goes first).
  On push: reads all outbox rows with `tries < 5`, batches them into one
  `POST /sync/push` request body, and on response clears outbox entries
  for both `accepted` and `duplicate` IDs, increments `tries` and sets
  `last_error` for `rejected` IDs (marking dead at `tries >= 5`, already
  surfaced by the existing `/api/status` dead-outbox read path). On pull:
  sends `local_slice` tag slugs, `sync_state`'s stored cursor, and
  `include_grades_for_node: true`; applies the response via
  `applyPullResponse`; updates `sync_state.last_pull_at`/`last_push_at`/
  `remote_protocol_version`.
- Any network failure (unreachable host, non-2xx, timeout) is caught,
  recorded in `sync_state.last_error`, and treated as "offline" — never
  thrown up as a user-facing error (per spec §8.5/§11.2: a failed sync
  updates a status indicator and retries, no error dialog).
- Connectivity monitor: a `setInterval` (local nodes only, 30s) calling
  `GET {remote_url}/sync/health`. Maintains an in-memory `online: boolean`
  on the app context (not persisted — resets to unknown/false on
  restart, becomes known on the first successful or failed check).
  Surfaced via the existing `/api/status` route (add an `online` field
  next to the fields it already reads). A false→true transition
  additionally triggers `runSync` (the offline→online sync trigger).
- Periodic sync: a second `setInterval` at `config.sync_interval_sec`
  (default 300) calling `runSync`, local nodes only.
- Triggers wired: on app start (one `runSync` call after `app.listen`
  resolves, local only), on submit if `online` is currently true (fired
  from the attempt-submit domain call, fire-and-forget, not blocking the
  HTTP response), the periodic interval, manual (new
  `POST /api/sync` route calling `runSync` and returning its result), and
  the offline→online transition above.

### Outbox population

Attempt submit (`domain/attempts.ts`'s existing submit path) and grade
write (self-grade, and later model-grade) each enqueue an `outbox` row
(`entity_type` in `attempt`/`response`/`grade`, JSON snapshot payload) —
**only when the node is `local`** (canonical never pushes to itself, per
spec §1.2: "the canonical node is a local node whose remote is itself").
On attempt submit, the attempt row, all its response rows, and their
`auto_mc` grades are enqueued together as one logical unit (spec §7.1's
"enqueue attempt, its response rows, and its grade rows to the outbox as
one logical unit").

### Slice management (replaces `local_template`)

- `GET /api/slices` — existing read pattern from `/api/status`, promoted
  to its own endpoint: lists `local_slice` rows.
- `POST /api/slices { tag_slug }` — inserts (or refreshes) a
  `local_slice` row and triggers an immediate full pull scoped to that
  slice (tag + descendants, expanded server-side per the earlier design
  decision: one slice per referenced tag literal, not per descendant leaf).
- `DELETE /api/slices/:slug` — removes the `local_slice` row and prunes
  local `question` rows in that slice that no local `response` row
  references (existing FK/lookup pattern, same shape as other prune
  logic in the codebase).
- Library's `POST /api/templates/:id/download` and
  `DELETE /api/templates/:id/download` routes are reimplemented: instead
  of writing `local_template`, they resolve the template's `tag_query`
  (the literal tags mentioned in `all`/`any`/`none`) and call the same
  slice-add/remove logic for each one. `TemplateSummary.downloaded`
  becomes "every referenced tag has a `local_slice` row";
  `downloaded_at` becomes the oldest `pulled_at` among those slices (so
  `update_available` — comparing `downloaded_at` against the template's
  `updated_at`/latest question `created_at` — keeps working unchanged).
- `local_template` table, its migration's placeholder status, and the two
  old route implementations are removed. No new migration is needed to
  drop the table (SQLite tables are cheap to leave orphaned, but since
  this is pre-launch, a follow-up migration dropping it is fine — decide
  at implementation time based on whether any other code still
  references it after the routes are rewired).

### Frontend

Minimal, functional-only (not a redesign — Settings' visual overhaul is
the separate, deferred spec):

- Settings gets a slice list (tag slug, pulled_at, question_count) with
  add (tag-slug input or picker) and remove controls, wired to the new
  `/api/slices` endpoints.
- Settings' existing sync status display (already reads `/api/status`)
  gains the `online` field and a manual "Sync now" button wired to the
  new `POST /api/sync`.
- Library's download button's underlying API calls are unchanged from
  the frontend's perspective (`downloadTemplate`/`removeDownload` in
  `web/src/lib/api.ts` still hit the same `/api/templates/:id/download`
  routes) — this is a backend reimplementation, not a frontend change,
  so no `web/` changes are needed here at all.

## Testing / verification

Per the original plan's Phase 5 exit criteria, run as an explicit test
script (not just ad hoc checks):

1. Local pulls two slices; question counts match canonical for those tags.
2. Kill canonical. Take three tests on local. All succeed, outbox depth
   is 3 (`/api/status`'s existing `outbox_depth` field).
3. Restart canonical. Local syncs (wait for periodic interval or trigger
   manually). Attempts appear on canonical with correct scores.
4. **Replay the same push payload manually** (call `applyPushRequest`
   twice with an identical request in a domain-level test, or push twice
   over real HTTP in an integration test). Every ID returns in
   `duplicate` both times, nothing duplicates, outbox clears identically.
   This is the single most important test in the project per the
   original plan — it's the whole justification for locally-generated
   UUIDs, and it directly serves the "lasts for a long time" durability
   goal: sync must survive being retried indefinitely without corrupting
   data.
5. Retire a question on canonical, pull on local — it stops appearing in
   draws but old responses still render in Review.
6. Kill canonical mid-push (simulate via an aborted request or a domain-
   level partial-application test). Restart. Outbox replays cleanly with
   no partial state.
7. Remove a slice with attempt history; referenced questions survive the
   prune.

Test structure: domain-level tests (two in-memory DBs, no HTTP) for the
protocol logic itself (criteria 1, 4, 5, 7 are naturally domain-level);
a smaller set of real HTTP integration tests (`app.listen(0)`, `local`'s
`runSync` pointed at the ephemeral port via `fetch`) for criteria 2, 3, 6
which inherently involve process-level behavior (killing/restarting a
server, actual network calls).

## Open questions

None outstanding — architecture, slice-replacement strategy, and slice
granularity were confirmed with the user during brainstorming.
