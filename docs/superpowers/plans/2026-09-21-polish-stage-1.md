# Polish stage 1 — implementation plan

Spec: `docs/superpowers/specs/2026-09-21-polish-stage-1.md` (binding). Tutor-side source docs are in `.superpowers/sdd/2026-09-21-polish-stage-1/` (`OSMOSIS-ASKS.md`, `OSMOSIS-FRONTEND.md`). Codebase survey with file:line pointers: `.superpowers/sdd/2026-09-21-polish-stage-1/codebase-survey.md`.

## Global constraints

- **Server:** `server/` is a Fastify + `node:sqlite` TypeScript workspace. Migrations are numbered SQL files in `server/migrations/` (next free number: check `ls server/migrations`; last is `016_*`). `server/src/db/migrate.ts` runs them in order on boot. Never edit an existing migration; add a new one.
- **Tests:** server uses vitest (`cd server && npx vitest run`, all 322 must stay green; `npx tsc -p tsconfig.json --noEmit` must pass). Test DB helper: `server/tests/helpers.ts` (`openTestDb`, `insertTag`, `insertQuestion`). HTTP-level MCP test pattern: `server/tests/mcpUpload.test.ts`. Live-item flow patterns: `server/tests/presentItem.test.ts`, `server/tests/awaitItemOutcome.test.ts`, `server/tests/outcomeRecord.test.ts`.
- **Web:** `web/` is React 19 + Vite, no router (page state machine in `web/src/App.tsx`), no test framework until Task 2 adds vitest. `cd web && npx tsc -b && npx vite build` must pass after every web task. Theme tokens live in `web/src/index.css` (`--font-body`, `--font-display`, colour tokens) — new UI uses existing tokens, no hardcoded colours.
- **The rule of §2:** anything accepted on input is readable on every output path (`await_item_outcome`, `submit_quick_check`, `get_attempt`, `get_results` attempt/question scope, `GET /api/attempts/:id`).
- **A null score is never 0** in any aggregate.
- **MCP surface docs:** every new/changed tool gets a row in `MCP-SPEC.md` §3's inventory table, and the tool count there is updated.
- **Commits:** one or more per task, message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push.
- Implementers never spawn subagents.

---

### Task 1: Third-session blockers (server) — §4.1 slug dots, §4.2, §1.3 UTF-8 round-trip, §3.2 ordinal, §3.3 misconception optional, §2.10 verify

Files: `server/src/domain/tags.ts`, `server/src/mcp/tools.ts`, `server/src/domain/questions.ts`, `server/src/domain/readme.ts`, tests.

1. **§4.1** In `server/src/domain/tags.ts` change `SLUG_SEGMENT` from `[a-z0-9]+(_[a-z0-9]+)*` to `[a-z0-9]+([._][a-z0-9]+)*`. A segment may contain `.` or `_` between alphanumerics, never leading/trailing/doubled. Update `readme.ts`'s `tag_conventions` prose to say dots are allowed inside a segment (section numbers like `2.4`). Test: `node:ebbing11e:2.4:atomic_weight` is valid; `a..b`, `.a`, `a.` , `a-b` are invalid.
2. **§4.2** `create_session` description in `tools.ts` gains the clause: "`tag_slug` must already exist (create_tag first); an unknown slug is rejected with not_found."
3. **§1.3** Add `server/tests/utf8RoundTrip.test.ts`: through the real MCP HTTP transport (copy the boot pattern from `tests/mcpUpload.test.ts` and drive JSON-RPC `tools/call` as the mcp-batch client does — see `scripts/mcp-batch/` for the request shape), call `create_tag` with `label: "R&D <é> 日本"` then `list_tags`, and `create_questions` with a prompt/choice body/explanation containing the same string then `get_question`; assert byte-identical strings back. Also assert `Content-Type` of the JSON-RPC response includes `charset=utf-8` or is `application/json` (which is UTF-8 by RFC 8259). If the round-trip already passes with no code change, that is the deliverable: the test pins it, and the report says so.
4. **§3.2** Add a test that `create_questions` with five choices stores `ordinal` 0–4 in the order sent and `present_item`'s question snapshot returns choices sorted by `ordinal` with the `ordinal` field present on each choice. If the snapshot omits `ordinal`, add it (check `questionSnapshot` in `server/src/domain/attempts.ts`).
5. **§3.3** In `server/src/domain/questions.ts` `validateQuestionInput`: a distractor with `misconception` missing/null/empty string is accepted and stored as NULL (no `missing_misconception` rejection anywhere, drop the `checkMisconception` option and its callers). The literal string `"distractor (imported; misconception not recorded)"` sent as a misconception is normalised to NULL on write (create and edit). `readme.ts` conventions: say misconception is optional and null means unknown. Existing tests that assert the rejection get updated to assert acceptance.
6. **§2.10** Read `server/tests/nullScore.test.ts`; add a case if missing: an attempt with one graded (score 1) and one ungraded (NULL) response reports `mean_score: 1` and `ungraded: 1` at attempt scope in `get_results` AND in `getSessionDetail`; an attempt with only ungraded responses reports `mean_score: null`, never 0. Verify `listAttempts` too.
7. Update `MCP-SPEC.md` where the tag grammar / misconception rules are described.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-1-report.md`.

---

### Task 2: Rendering (web) — §1.1 KaTeX, §1.2 mhchem, §1.4 document font, §1.5

Files: `web/package.json`, new `web/src/lib/richText.ts` + `web/src/components/RichText.tsx`, `web/src/components/Take.tsx`, `Review.tsx`, `Bank.tsx`, `DocumentPanel.tsx`, `Settings.tsx`, `web/src/index.css`.

1. `cd web && npm install katex && npm install -D @types/katex vitest` (run from repo root with `-w web` if workspace install is needed). Add `"test": "vitest run"` to `web/package.json` and a `web/vitest.config.ts` (environment `node`; tests under `web/src/**/*.test.ts`).
2. `web/src/lib/richText.ts`: pure `segment(text: string): Segment[]` where `Segment = {kind:'text'|'inline'|'display', value:string}`. Grammar: display math is `\[ … \]` or `$$ … $$`; inline is `$ … $` where a `$` immediately followed by a digit or whitespace-then-digit… **keep it simple and predictable**: `\$` is a literal dollar; otherwise `$…$` on one logical run is inline math; unmatched `$` is literal text. Also `render(text): string` producing HTML: text segments are HTML-escaped with `\n\n` → paragraph breaks and `\n` → `<br>`, math segments through `katex.renderToString(value, {throwOnError:false, displayMode, trust:false})`. Import `katex/contrib/mhchem` once (side-effect import) so `\ce{…}` and `\pu{…}` work. Unit tests in `web/src/lib/richText.test.ts`: `$\frac{a}{b}$`, `$\sqrt{30}$`, `\[x^2\]`, `\ce{Al2(SO4)3}` inside `$…$`, `\ce{2H2 + O2 -> 2H2O}`, a `\$5` literal, text with `<script>` is escaped, `é 日本` survives, `\vec{v}` and `10\,\mathrm{m/s}` render (no error class in output).
3. `RichText.tsx`: `<RichText text={…} inline? className? />` renders `render(text)` via `dangerouslySetInnerHTML` (the only allowed place for it; the text segments are escaped in `render`). Import `katex/dist/katex.min.css` once in `web/src/main.tsx`.
4. Use `<RichText>` for `prompt`, every `choices[].body`, `explanation`, `model_answer`, and `rubric` in `Take.tsx`, `Review.tsx`, `Bank.tsx` (list rows AND any detail view). Keep the surrounding markup; only the string becomes rich.
5. **§1.4** Add a "Document font" control in `Settings.tsx` under the theme section: `system` (current), `serif` (`Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif`), `mono` (`'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace`). Persist in `localStorage` key `osmosis.documentFont`; expose via a tiny hook `useDocumentFont()`; `DocumentPanel.tsx` (the document viewer/editor container) sets `style={{fontFamily}}` from it and a data attribute `data-doc-font` so `.katex` inside inherits a sane size (`font-size: 1.05em`). Applies to the document viewer opened from Settings and to `DocumentPanel` in Take.
6. Build must stay under control: import katex normally (it is ~280 kB minified; acceptable), no CDN.
7. Verify: `npx vitest run` in web, `npx tsc -b`, `npx vite build`.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-2-report.md`.

---

### Task 3: Outcome record completeness (server) — §2.1–2.9, §3.4, §3.7, §3.8

Files: new migration `server/migrations/017_outcome_polish.sql`, `server/src/domain/attempts.ts`, `results.ts`, `sessions.ts`, `readme.ts`, `server/src/protocol.ts`, `server/src/mcp/tools.ts`, `server/src/http/apiRoutes.ts`, `MCP-SPEC.md`, tests.

Migration 017:
- `ALTER TABLE response ADD COLUMN best_guess_choice_id TEXT REFERENCES choice(id)`
- `ALTER TABLE response ADD COLUMN diagnosis TEXT` (the tutor's one-line diagnosis, §3.1/§7.3)
- `ALTER TABLE attempt ADD COLUMN paused_at TEXT` and `ALTER TABLE attempt ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0` (accumulated pause time)
- Recreate `grade` so `grader` CHECK is `('auto_mc','self','model','oracle','judge')` (SQLite: create new table, copy, drop, rename; keep indexes/FKs — read `001_init.sql:235-247` and any later grade migrations first).

Behaviour:
1. **§2.3 best guess.** `answerResponse` accepts `best_guess_choice_id` (validated against the response's question like `selected_choice_id`; only meaningful with `idk: true`, reject with `best_guess_requires_idk` otherwise). `submitAttempt` never scores it: an idk response is graded as today (dont_know path). Output on every path: `best_guess_choice_id` and `best_guess_correct: boolean | null` (computed server-side from `choice.is_correct`, null when no guess). `PATCH /api/attempts/:id/responses/:rid` body type gains it.
2. **§2.1/2.2/2.6/2.7** `get_results` attempt scope and question scope `recent_responses` rows carry `selected_choice_id`, `idk`, `best_guess_choice_id`, `best_guess_correct`, `confidence`, `misapplied_method`, `chosen_misconception`, `grader`, `diagnosis`, `outcome` (same `deriveOutcome` as attempts.ts — export it and reuse). `getAttemptDetail` per-response gains `chosen_misconception`, `best_guess_choice_id`, `best_guess_correct`, `diagnosis`, `outcome`, and `grade.grader`. Aggregates (`correct`/`incorrect` counts anywhere) exclude idk rows; add a `dont_know` count beside them where a correct/incorrect count exists.
3. **§2.4 confidence.** Document in `readme()` under `prompt_conventions.confidence_scale`: `{ labels: ["unsure","somewhat","confident"], numeric: {unsure:1, somewhat:3, confident:5} }`. Every output that carries `confidence` also carries `confidence_numeric` (1/3/5/null).
4. **§2.8 paused.** New domain fns `pauseAttempt(db, id)` / `resumeAttempt(db, id)`: pause sets `paused_at` (error `already_paused`); resume adds `now - paused_at` to `paused_ms` and clears `paused_at`. Routes `POST /api/attempts/:id/pause` and `/resume`. `getItemOutcome` returns `{status:"paused", paused_at}` when paused and unanswered. `sweepAbandonedAttempts` never abandons a paused attempt and counts `paused_ms` against the abandon window (`started_at + paused_ms + abandon_after_hours`). `answerResponse` on a paused attempt auto-resumes. Attempt detail exposes `paused_at`, `paused_ms`.
5. **§2.9 grader.** New MCP tool `grade_response` `{response_id, score?: number 0..1, grader: "oracle"|"judge", diagnosis?: string}`: upserts a grade row with that grader (overrides any self/model grade; `override=1`), stores `diagnosis` on the response, allowed on submitted attempts only for written questions, and for mc questions allows `diagnosis` only (score is ignored, `auto_mc` grade untouched). `POST /api/responses/:id/grade` keeps `self`. Every output that carries a score carries `grader`. Also `get_results` question scope rows add `graded_by: {self, model, oracle, judge, auto_mc}` counts.
6. **§3.4** `await_item_outcome` accepts `timeout_s?: number` (default 25, clamp 1..25); the description says so. Also returns `status: "paused"` when paused.
7. **§3.7** `endSession` returns `{id, ended_at, summary: {presented, answered, abandoned, dont_know, paused_now:false}}` computed over attempts with `session_id` and `delivery_mode = 'app_live'` (presented = attempts; answered = submitted; abandoned = abandoned_at set and not submitted). Any attempt still pending at end_session is marked abandoned (so the count is final).
8. **§3.8** `server/src/protocol.ts` adds `export const TOOLS_VERSION = 2` (bump whenever a tool is added/removed/changes shape — this task bumps it to 2, later tasks bump again). `readme().node` gains `tools_version` and `tools: string[]` (sorted registered tool names — collect the names from `registerTools` via a module-level array), and `push: false` (Task 6 flips it). `/sync/health` and `/api/status` also report `tools_version`.
9. Update tool descriptions (`await_item_outcome`, `get_attempt`, `get_results`, `submit_quick_check`) to list the new fields. `MCP-SPEC.md` §3 table: add `grade_response`, update counts.

Tests: extend `outcomeRecord.test.ts` / `richOutcomes.test.ts` / new `outcomePolish.test.ts` for: best guess never scored and visible on all four read paths; idk excluded from correct/incorrect counts; paused status and sweep behaviour; grade_response oracle row distinguishable in get_results; end_session summary counts; timeout_s clamp; readme tools_version.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-3-report.md`.

---

### Task 4: Item channel (server) — §3.1 reveal, §3.5 ephemeral, §3.9 idempotency, §3.10 node_keys

Files: migration `018_item_channel.sql`, `server/src/domain/attempts.ts`, `questions.ts`, `sessions.ts`, `draw.ts` / `getEligibleQuestions`, `retention` due-items, `server/src/mcp/tools.ts`, `apiRoutes.ts`, `MCP-SPEC.md`, tests.

Migration 018:
- `ALTER TABLE attempt ADD COLUMN reveal TEXT NOT NULL DEFAULT 'immediate' CHECK (reveal IN ('immediate','deferred'))`
- `ALTER TABLE tutor_session ADD COLUMN reveal_default TEXT NOT NULL DEFAULT 'immediate' CHECK (...)`
- `ALTER TABLE question ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0`; `ALTER TABLE question ADD COLUMN session_id TEXT REFERENCES tutor_session(id)`
- `CREATE TABLE create_questions_batch (idempotency_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
- `CREATE TABLE question_node_key (question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE, node_key TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, ordinal INTEGER NOT NULL, PRIMARY KEY (question_id, node_key))` + index on `node_key`. Backfill: every existing `question.node_key` becomes one primary row.

Behaviour:
1. **§3.1 reveal.** `create_session` accepts `reveal_default` (`immediate`|`deferred`, default immediate). `present_item` accepts `reveal` (overrides; else session default; else immediate); stored on the attempt. While an attempt has `reveal='deferred'` AND its session is not ended, the app-facing reads (`GET /api/attempts/:id`, `POST /api/attempts/:id/submit`'s response, `getAttemptDetail` when called from the API) return `reveal: 'deferred'`, `revealed: false`, and omit `is_correct` on choices, `score`, `explanation`, `model_answer`, `correct_choice_id`, `outcome` per response. The MCP tools (`await_item_outcome`, `get_attempt`, `get_results`) always see everything — the tutor is not the learner. Once the session is ended, `revealed: true` and the full record is returned. Implement as `getAttemptDetail(db, id, { viewer: 'learner' | 'tutor' })`.
2. **§3.5 ephemeral.** `create_questions` accepts `ephemeral?: boolean` (batch-level) and `session_id?: string`; `ephemeral: true` requires `session_id` (reject `ephemeral_requires_session`). Ephemeral questions: excluded from `getEligibleQuestions`/template draws/daily draws/due items/`search_questions` (unless `include_ephemeral: true`)/bootstrap counts/`readme.bank_size`; presentable via `present_item(question_id)` only while the session is open; `endSession` retires them (`retired_reason = 'ephemeral_session_ended'`). `get_question` shows `ephemeral: true`.
3. **§3.9 idempotency.** `create_questions` accepts `idempotency_key?: string` (≤128 chars). If a row exists in `create_questions_batch` for the key, return the stored result verbatim with `replayed: true` and create nothing. Otherwise run, then store the result. Test: same batch twice → one set of question rows, second response `replayed: true`.
4. **§3.10 node_keys.** `questionInputShape` accepts `node_keys?: string[]` (each tag-shaped per the Task-1 slug grammar, else per-question rejection `invalid_node_key`); first is primary; `node_key` (singular) stays accepted and, when only it is given, becomes the single primary. Writes go to `question_node_key`; `question.node_key` column is kept in sync as the primary. Reads: `get_question`, `search_questions` rows, `present_item` snapshot, and every outcome record carry `node_keys: string[]` (primary first) and `node_key` (primary). `search_questions` accepts `node_key?: string` — exact match, or prefix match when it ends with `:` — and `session_id?: string`. `provenance`, `claim_rung`, `tags` already stored; confirm with a test that all four round-trip through `create_questions` → `search_questions`.
5. Bump `TOOLS_VERSION`. Update descriptions and `MCP-SPEC.md`.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-4-report.md`.

---

### Task 5: Presenter token and tags (server + deploy) — §3.6, §4.3, §4.4

Files: `server/src/env.ts`, `server/src/mcp/server.ts`, `server/src/mcp/tools.ts`, `server/src/domain/bootstrap.ts`, `server/src/domain/tags.ts`, new `server/src/domain/taxonomies/*.ts`, `deploy/install.sh`, `DEPLOY.md`, `MCP-SPEC.md`, tests.

1. **§3.6 presenter token.** New env `MCP_PRESENTER_TOKEN` (optional; when unset the presenter surface is off). `registerTools(server, db, uploadsDir, nodeId, scope: 'full' | 'presenter')`: in `presenter` scope register only `readme`, `create_session`, `create_questions`, `present_item`, `await_item_outcome`, `get_attempt`, `end_session`, `grade_response`, plus (once Task 8 lands) `present_show`, `update_show`, `await_show_outcome` — implement as an allowlist constant `PRESENTER_TOOLS` so Task 8 just appends. `/mcp/:token` resolves the token: full token → full scope; presenter token → presenter scope; else 404. `/mcp/:token/upload` accepts both tokens. `readme()` gains `scope` in its output. Never log tokens. `deploy/install.sh` generates `MCP_PRESENTER_TOKEN` into `/etc/osmosis/canonical.env` when absent (same pattern as `MCP_AUTH_TOKEN`); `DEPLOY.md` documents it and that the tutor server gets only this token. Note in DEPLOY.md that "Tailscale-only" for the presenter surface is a cloudflared ingress choice: document the ingress rule shape but do not change `deploy/cloudflared.yml` semantics beyond a comment (the shared tunnel on this host is hand-edited).
   Tests: presenter token lists exactly the allowlist via `tools/list`; calling `search_questions` with it returns a JSON-RPC "tool not found" error; wrong token 404.
2. **§4.4 tag kinds.** `list_tags` rows gain `kind`: `node` when slug starts with `node:`, `tech` for `tech:`, `topic` for `topic:`, else `subject`. `list_tags` accepts `prefix?: string` (slug prefix filter) and `kind?: string`. `merge_tags` is verified by test to work across all three prefixed kinds (it already repoints `question_tag`; add a `question_node_key` repoint when merging `node:` tags — coordinate with Task 4's table). `readme.tag_conventions` documents the three prefixes.
3. **§4.3 seeded taxonomy.** Add `server/src/domain/taxonomies/chemistry.ts` exporting a seed: subject root `chemistry` (label "Chemistry"), topic tags for Ebbing *General Chemistry* 11e chapters 1–12 as `chemistry:<slug>` (e.g. `chemistry:matter_and_measurement`, `chemistry:atoms_molecules_ions`, `chemistry:stoichiometry`, `chemistry:reactions_in_solution`, `chemistry:gases`, `chemistry:thermochemistry`, `chemistry:quantum_theory`, `chemistry:electron_configurations`, `chemistry:ionic_covalent_bonding`, `chemistry:molecular_geometry`, `chemistry:liquids_solids`, `chemistry:solutions`), plus `tech:` tags `tech:mhchem`, `tech:calculator`. Also a small `mathematics` seed (`math` root with `math:algebra`, `math:geometry`, `math:number_theory`, `math:counting_probability` for AMC) — check existing tags in `bootstrap.ts` tests; do not duplicate a slug that a seed test already inserts. `bootstrap(subject)` result gains `taxonomy: { seeded: boolean, seed_available: boolean, tag_count }`; new arg `seed?: boolean` — when true and a seed exists for the resolved subject, creates every seed tag that does not exist (idempotent) and returns the taxonomy. The description tells the caller: "If `taxonomy.tag_count` is 0 and `seed_available`, call again with `seed: true` before minting tags." Tests: bootstrap chemistry on an empty bank → seed_available true, tag_count 0; with seed → tags exist; second seed call creates nothing new.
4. Bump `TOOLS_VERSION`; update `MCP-SPEC.md` (§1 transport now describes two tokens).

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-5-report.md`.

---

### Task 6: Session organisation and push (server + web) — §6.1–6.3, §5.4, §7.5

Files: migration `019_session_summary.sql`, `server/src/domain/sessions.ts`, `attempts.ts`, new `server/src/lib/events.ts`, `server/src/http/apiRoutes.ts`, `server/src/http/app.ts`, `readme.ts`, `web/src/lib/api.ts`, `web/src/components/SessionList.tsx`, `LiveItem.tsx`, `web/src/components/Home.tsx`, tests.

1. **§6.2 summary.** Migration: `ALTER TABLE tutor_session ADD COLUMN summary TEXT`. `end_session` accepts `summary?: string` (markdown; the same text the tutor said) and stores it. `getSessionDetail` and `listSessions` rows return `summary`, `status: 'open' | 'closed'`, and `source: 'tutor'` (a `tutor_session` row is always tutor-created).
2. **§6.3 source.** `listAttempts` rows and `GET /api/attempts` gain `source_kind: 'tutor' | 'self'` (`tutor` when `session_id` is set or `delivery_mode = 'app_live'`). Home's recent-attempts list (find it in `Home.tsx` / `Results.tsx`) shows a small "tutor" pill on tutor rows.
3. **§6.1 list.** `SessionList.tsx`: sessions ordered newest first (already), each row shows `open`/`closed` state distinctly (closed rows muted, with the closed time); the "Live session" action is only offered for open sessions; a closed session opens to its detail with the `summary` rendered first (via `<RichText>` from Task 2) above the attempt list. Open sessions that the tutor left behind can be closed from the app via a "Mark closed" button → `POST /api/sessions/:id/end` (new route, same domain fn).
4. **§5.4 push.** `server/src/lib/events.ts`: a process-wide `EventEmitter` keyed by session id; `emitSessionEvent(sessionId, {type, ...})`. Emit on `presentItem` (`item_presented`, `{attempt_id, response_id}`), `answerResponse`/`submitAttempt` (`item_answered`), `pause/resume`, `endSession` (`session_ended`), and Task 8 will add `show_presented`/`show_updated`. Route `GET /api/sessions/:id/events` is an SSE stream (`text/event-stream`, `retry: 2000`, a `: ping` comment every 15 s, `id:` incrementing, closes cleanly on client disconnect and on `app.close()`). `readme().node.push = true`, `/sync/health` and `/api/status` report `push: true`.
   Web: `web/src/lib/liveEvents.ts` `subscribeSession(sessionId, onEvent, onStateChange)` using `EventSource`; `LiveItem.tsx` subscribes and re-fetches `live-pending` immediately on `item_presented` (and on `open`), keeping a 15 s polling fallback while the stream is disconnected. Expected latency present→visible: well under one second on LAN.
   Tests: SSE route test with `app.inject` is awkward — instead unit-test `events.ts` and test the route with a real `listen()` on port 0 plus `fetch` reading the first event after `presentItem` (pattern: `mcpUpload.test.ts` boots a real server).
5. Bump `TOOLS_VERSION`; `MCP-SPEC.md` notes `end_session.summary` and push.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-6-report.md`.

---

### Task 7: Ease of use (web) — §7.1, §7.2, §7.3, §7.4, §7.6, §7.7, §7.8, §2.3 UI, §2.4 UI, §2.5

Files: `web/src/components/Take.tsx` (+ css), `Review.tsx`, `LiveItem.tsx`, `SessionList.tsx`, `App.tsx`, `web/src/lib/api.ts`, new `web/src/hooks/useKeyboard.ts`, `web/src/lib/notify.ts`.

1. **§7.1 keyboard.** In Take: `1`–`5` select choice by ordinal, `Enter` submits (or Next when already answered), `b` blanks (clear selection, `skipped`), `?` toggles idk, `u`/`s`/`c` set confidence, `Space` acknowledges a show item (Task 8) / advances when on a "recorded" card. Ignored while focus is in a textarea/input except `Enter`+`Ctrl`. Focus moves to the new item container (`tabIndex=-1`, `.focus()`) when an item lands. A one-line hint row lists the keys.
2. **§2.3 UI.** When idk is chosen, the choice buttons stay enabled but re-labelled with a "best guess (not scored)" caption; picking one sends `best_guess_choice_id`; the primary selection is cleared. Two steps, never alongside.
3. **§2.4 UI.** Confidence buttons show exactly `unsure` / `somewhat` / `confident`.
4. **§2.5.** `elapsed_ms` starts at first paint of the item (`useEffect` after mount, `performance.now()`), pauses while the drill is paused (§7.6) and while `document.hidden`, and is sent with every PATCH and once more on submit.
5. **§7.2 timer.** Two timers when a `time_limit_sec` exists: set timer (from template) and per-item timer (elapsed for the current item). Monospace digits, no colour change until under 60 s, then one muted emphasis class. When the set ends, Take shows "Time. Your answers are recorded." with one Finish button — it never auto-submits behind the learner's back beyond what it does today; keep existing auto-submit behaviour but preface it with that message for 2 s.
6. **§7.6 pause.** A "Back in five" button on the live banner calls `POST /api/attempts/:id/pause`; the timer and elapsed counter stop; a "Resume" button calls `/resume`. Paused state visible.
7. **§7.3 review.** `Review.tsx`, when the attempt has `reveal: 'deferred'` and `revealed: false`: show every item as "recorded" with his answer only. When `revealed: true` (session closed): his answer, the key, `explanation`, and the tutor's `diagnosis` line where present, plus `chosen_misconception` when present. The summary header counts `correct / incorrect / don't know / ungraded` separately (idk never in incorrect).
8. **§7.4 notification.** `notify.ts`: request `Notification` permission once from Settings (a toggle "Notify when the tutor asks"); on `item_presented` / `show_presented` while `document.hidden` or `!document.hasFocus()`, post a desktop notification "Osmosis — the tutor sent an item" and flash `document.title` (`● Osmosis`) until focus returns.
9. **§7.7 one tab.** When any session is open (`status: 'open'` in `/api/sessions`), `App.tsx` starts on the live page for the newest open session instead of Home; the rail still reaches bank/library/results/settings. The session stream is the home view while open.
10. **§7.8 layout.** Live page at ≥1100 px: two columns — stream left (max 720 px), current graph/document panel right (sticky). Below that, one column. Use CSS grid in `LiveItem.css`.

Verify: `tsc -b`, `vite build`, vitest for any pure helper (keyboard map, timer formatting). Manual check via the built app is not required of the implementer; the controller does it.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-7-report.md`.

---

### Task 8: Showing (server + web) — §5.1, §5.2, §5.3, §5.5

Files: migration `020_show.sql`, new `server/src/domain/shows.ts`, `server/src/mcp/tools.ts`, `apiRoutes.ts`, `events.ts`, `web/src/components/LiveItem.tsx` → session stream, new `web/src/components/ShowCard.tsx`, `web/src/lib/api.ts`, `MCP-SPEC.md`, tests.

Migration 020: `CREATE TABLE show (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES tutor_session(id), kind TEXT NOT NULL CHECK (kind IN ('text','markdown','graph')), payload TEXT NOT NULL, caption TEXT, context_json TEXT, presented_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, seen_at TEXT, dwell_ms INTEGER, acknowledged_at TEXT, dismissed_at TEXT)` + index on `session_id, presented_at`. Also `ALTER TABLE attempt ADD COLUMN context_json TEXT`.

1. **§5.1** MCP `present_show {session_id, kind, payload, caption?, context?: {course?, unit?, node?, step?, timer_s?}}` → `{show_id, presented_at}`; `await_show_outcome {show_id, timeout_s?}` → `{status: 'pending'|'seen'|'acknowledged', seen_at, dwell_ms, acknowledged_at}` (polls like `await_item_outcome`); `update_show {show_id, payload}` (**§5.2**; graph only re-renders in place — the web keeps the same `<GraphPanel>` instance and feeds it the new spec; `@bounds` in the spec is what holds the frame, the server only stores). `present_item` accepts the same `context` and stores it. Ephemeral: shows are never in the bank. `end_session` summary gains `shows: n`. Events: `show_presented`, `show_updated`. Web routes: `GET /api/sessions/:id/stream` → ordered list of `{kind:'item'|'show', at, ...}` merging attempts (`delivery_mode='app_live'`) and shows by time; `POST /api/shows/:id/seen {dwell_ms}` and `/acknowledge {dwell_ms}`. Add the three tools to `PRESENTER_TOOLS`.
2. **§5.3 stream.** `LiveItem.tsx` becomes the session stream: renders `/api/sessions/:id/stream` in order, newest at the bottom, auto-scrolls to a newly landed entry, each entry an item card (Take, embedded) or a `ShowCard` (`text`/`markdown` via `<RichText>`; `graph` via the existing `GraphPanel`), with an OK button that posts `acknowledge` with `dwell_ms` measured from first paint. Thin banner at top from the latest `context` (`course · unit · node · step`, timer when `timer_s`), and a state line: *waiting on you* when an item is pending, *tutor is thinking* otherwise. Space acknowledges the newest unacknowledged show (Task 7's keyboard hook).
3. **§5.5 reveal gate.** While any item in the stream has a pending outcome, every earlier entry collapses to a one-line stub ("collapsed while an item is open") — shows and previous items alike — and expands again once the outcome is recorded. For a `reveal: 'deferred'` attempt the entry stays collapsed until `revealed: true`. Implement in the stream component, not the server (not tamper-proof by design).
4. Bump `TOOLS_VERSION`; `MCP-SPEC.md` inventory.

Report at `.superpowers/sdd/2026-09-21-polish-stage-1/task-8-report.md`.
