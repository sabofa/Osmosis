# Osmosis MCP Spec

What the MCP surface should be and do, for the authoring Claude connecting as a
remote connector (claude.ai custom connector, or any MCP client with no shell
of its own). This supplements `SPEC-Osmosis.md` §9 — that document describes
the bank/sync model; this one is specifically about the Claude-facing protocol
surface and stays up to date as that surface grows past the original 13 tools.

Status: everything in this document is **[DONE]** as of this revision. Bottom
section (§8) covers what's still open, each with a concrete next step.

---

## 1. Transport and auth

`POST/GET /mcp/:token` on the canonical node only, mounted via cloudflared.
The token is a path segment, not a header, because the only client-side
surface available (e.g. claude.ai's "Add custom connector" dialog) accepts a
URL and nothing else for a plain shared-secret setup — no custom header
field, and OAuth is unnecessary machinery for a single trusted user. Wrong or
missing token returns a bare 404, not 401, so the endpoint gives no signal to
anyone probing it. `server/src/mcp/server.ts`.

**Two tokens, two scopes.** The route resolves `:token` to a scope in
constant time (`tokenMatches`, a length-tolerant `timingSafeEqual`); anything
it doesn't recognise 404s. Neither value is ever logged: the token is a path
segment, so `buildApp`'s pino `req` serializer rewrites a logged url of
`/mcp/<token>[/upload]` to `/mcp/<redacted>[/upload]`
(`redactMcpTokenInUrl`, `server/src/http/app.ts`).

| Env var | Scope | Inventory |
|---|---|---|
| `MCP_AUTH_TOKEN` | `full` | all 48 tools. Required — the canonical node refuses to boot without one set |
| `MCP_PRESENTER_TOKEN` | `presenter` | `PRESENTER_TOOLS` in `server/src/mcp/tools.ts`: `readme`, `create_session`, `create_questions`, `present_item`, `await_item_outcome`, `present_show`, `update_show`, `await_show_outcome`, `get_attempt`, `end_session`, `grade_response`, `list_ungraded_written`, `ws_list`, `ws_read`, `ws_search`, `ws_create`, `ws_write`, `ws_append`, `ws_place` (§3.6). Optional — unset means the presenter surface does not exist |

`registerTools(server, db, uploadsDir, nodeId, scope)` skips any tool outside
the allowlist when the scope is `presenter`, so a withheld tool is genuinely
absent from `tools/list` and answers "tool not found", rather than being
listed and then refusing. The presenter token is what the **tutor server**
holds: it runs the live teaching loop and reads and writes Ben's workspace
(the seven `ws_*` tools, §3.6: read, create, write, append and place, and none
of them removes or moves anything), and it never needs to retire a question,
rewrite a template, change config or touch a theme, so the credential it
carries cannot do any of those things. `readme()` reports `scope` (`full` |
`presenter`) and a `node.tools` list scoped to the caller, so a tutor can
assert what it is holding instead of discovering it on a refused call. Two
identical tokens are refused at boot (`server/src/env.ts`) — the full token
resolves first, so an identical presenter token would silently be the full
surface.

The upload sibling `POST /mcp/:token/upload` accepts **either** token: it
writes an asset and reaches none of the tools the presenter scope withholds.

Restricting the presenter surface to Tailscale is a cloudflared *ingress*
choice, not something the server enforces — `path` is a regex over the request
path and cannot tell two secrets apart without a secret in the config file.
See DEPLOY.md.

Revocation is "rotate the token, restart, re-paste the URL into the connector
dialog (or into the tutor server's config)." No live-revoke list is needed for
a single-user tool.

---

## 2. The two-tier orientation problem

A hosted claude.ai session has no access to this spec, the source code, or
any prior session's context. Everything it knows about conventions has to
arrive through tool calls. `bootstrap(subject)` used to carry all of it —
conventions, tag taxonomy, calculator policy, results pointer — every time,
for every subject, which meant a session doing biology today and chemistry
tomorrow re-read the same universal authoring rules twice, and a session that
never touched graphing had no way to *learn* the graph DSL exists without
stumbling into it via a rejected `graph_spec`.

Split into two tools, `domain/readme.ts` and `domain/bootstrap.ts`:

### `readme()`

Zero-argument, called once at the very start of a session, before anything
subject-specific is known. Cheap — one COUNT query for `bank_size`, otherwise
static content:

```
readme() -> {
  scope: "full" | "presenter",  // which token surface the caller reached this node through
  node: { protocol_version, bank_size, last_write_at, tools, tools_version, push },
  workflow: string,               // call bootstrap(subject) next, once per subject touched this session
  prompt_conventions: {...},      // prompt_style, explanation_style, difficulty_scale, mc_choice_count, written_length_target, misconception
  calculator_conventions: string, // calculator_policy vs desmos_allowed — two independent axes, not redundant
  tag_conventions: string,        // slug grammar: lowercase, ":"-separated hierarchy, "_"- or "."-separated words, no hyphens
  document_conventions: string,   // document_id / document_anchor_* / document_marker_offset, when to use which
  duplicate_workflow: string,     // possible_duplicates is a report, not a rejection — retire_question the loser
  batching_guidance: string,      // prefer ~25-30 questions per create_questions call
}
```

### `bootstrap(subject)`

Stays subject-scoped — tag taxonomy, `results_pointer`, `skill_level` — called
once *per subject* touched this session. `conventions` and
`calculator_convention` moved out to `readme` (they no longer appear in
`BootstrapResult`); `graph_dsl_reference` was added, populated only when the
resolved subject's top-level slug is in a small allowlist
(`math`/`physics`/`chemistry`/`statistics`/`engineering` in
`domain/bootstrap.ts`, not a hardcoded `"math"` string check, so a new subject
just gets added to the set). Content is condensed from
`graph-engine/src/parser/types.ts`'s grammar comment and
`parser/parseConfig.ts`'s directive switch — one line per statement form, one
line per `@key:` directive, no implementation asides.

**Why split instead of just growing bootstrap**: the alternative is
`bootstrap` conditionally including the universal stuff only on the first call
of a session — but MCP tool calls are stateless per the transport
(`sessionIdGenerator: undefined`, `mcp/server.ts`), so "first call this
session" isn't something the server can detect without adding session state it
currently has none of. Two tools with two different call cadences is simpler
than adding session tracking to answer "have I told this client the universal
stuff yet."

---

## 3. Full tool inventory

48 tools on the full surface, 19 on the presenter surface (§1). Every schema is sent on every turn a connector is enabled for,
regardless of whether it's called that turn — tool *count* isn't free, which
is why `readme`/`bootstrap` were split by call cadence rather than just
becoming one larger tool.

| Tool | Purpose |
|---|---|
| `readme` | Universal conventions, called once per session. `node` carries `protocol_version`, `tools_version` (bumped whenever a tool is added, removed, or changes shape; now 10 — the theme tools on manifests, §3.7; 9 was the workspace tools, §3.6; 8 was the retention loop changing `set_retention_target`, `get_due_items`, `present_item` and the template tools), the sorted `tools` list *for the caller's scope*, and `push` (now `true` — see §3.3). Top-level `scope` is `full` or `presenter` — see §1. `tag_conventions` documents the three reserved slug prefixes; `retention_conventions` documents the retention loop (§3.5) |
| `bootstrap` | Subject-scoped taxonomy + results pointer + graph DSL reference, called once per subject. Returns `taxonomy: { seeded, seed_available, tag_count }`; `seed: true` creates the subject's shipped taxonomy (`server/src/domain/taxonomies/`, currently `chemistry` — Ebbing 11e ch. 1-12 plus `tech:mhchem`/`tech:calculator` — and `math`), idempotently, so an empty bank gets standard slugs instead of invented near-duplicates |
| `list_tags` | Controlled vocabulary listing. Every row carries `kind`, derived from the slug's leading segment: `node` (one teachable idea — the same string a question's `node_keys` carry), `tech` (a rendering/tooling requirement), `topic` (a cross-subject theme), else `subject`. Filters `prefix` (a slug and its descendants, cut only at `:` — `_` and `.` are literal, so `a_b` never reaches `a.b`) and `kind` compose — both are ANDed. Paginated (`limit`/`offset`, default 50); response is `{ total, tags, has_more }` |
| `create_tag` | One tag at a time, by design. Slug grammar: lowercase ascii segments joined by `:`, words within a segment joined by `_` or `.` — a separator always sits between alphanumerics, so `a..b`, `.a`, `a.` and `a-b` are rejected as `invalid_slug_format`. The `.` exists so a textbook section number survives into the slug (`node:ebbing11e:2.4:atomic_weight`) |
| `merge_tags` | Vocabulary cleanup. When **both** slugs are `node:` tags the node keys move too — `question_node_key` rows (collapsing rather than colliding on the `(question_id, node_key)` PK, and promoting the survivor when the merged key was primary) and the singular `question.node_key` — reported as `node_keys_updated`. A merge that isn't `node:`-to-`node:` leaves node keys alone rather than minting an invalid one |
| `search_questions` | Cheap summaries, omits explanation/rubric/graph_spec. Every row carries `node_keys` (primary first) and `node_key` (the primary). Filters: `node_key` (exact, or prefix when the value ends with `:` — `node:ebbing11e:2.4:` matches everything under that section), `session_id`, and `include_ephemeral` (session-only items are excluded otherwise). Paginated (`limit`/`offset`, default 50); response is `{ total, questions, has_more }` |
| `get_question` | Full detail for one question — the read path before an edit. Carries `node_keys`, `ephemeral` and `session_id` |
| `create_questions` | Batched, per-question rejection detail, capped duplicate reports. Batch-level `ephemeral` (requires `session_id`, else `ephemeral_requires_session`) and `idempotency_key` (≤128 chars: a repeated key writes nothing and replays the stored result verbatim with `replayed: true`. The key is *not* fingerprinted against the payload: the same key with a different batch replays the stored result and writes nothing, so mint a fresh key per batch). Per question, `node_keys` — first is primary, each `node:`-prefixed and tag-slug-shaped, else that question is rejected `invalid_node_key`; passing both `node_key` and a disagreeing `node_keys[0]` is `node_key_mismatch`. A choice's `misconception` is optional — missing, null, empty, or the placeholder `"distractor (imported; misconception not recorded)"` all store NULL, which reads as *unknown*, not *none*. A question is never rejected for a missing misconception |
| `edit_question` | Versions if attempted, in-place otherwise. Same optional-`misconception` normalisation as `create_questions`; `node_keys` replaces the whole set, a singular `node_key` replaces it with that one primary |
| `retire_question` | Soft retire |
| `list_templates` | Live eligible_count. Paginated (`limit`/`offset`, default 50); response is `{ total, templates, has_more }` |
| `create_template` / `edit_template` / `retire_template` | Draw specs. `due_mode` (§3.5): `weight` (default, and every template from before 022) favours due items; `gate` draws only due items, most overdue first — an Osmosis-scheduled homework or SM2 review set, empty when nothing is due; `off` ignores due-ness. Not synced: a downloaded template drawn offline on a local node has no schedule to read |
| `get_results` | Weak-area signal, truncated `response_text` on wrong written answers; a null `score` (ungraded) is never averaged as zero — tag/question rows carry `graded`, attempt/daily rows carry `ungraded`, so every mean's denominator is visible. Question rows also carry `graded_by` (`self`/`model`/`oracle`/`judge`/`auto_mc` counts); question and attempt rows both carry the full per-response record (`recent_responses` / `responses`). Accepts `offset` (all four scopes) to page through rows, but deliberately does *not* return `total`/`has_more` — offset-only, not the full pagination envelope used by the list/search tools above |
| `get_config` / `set_config` | Refuses unknown keys and secrets |
| `create_asset` | `type: text`/`url`/`file` (base64) — the file variant is the fallback path, see §5 |
| `list_assets` | Cheap listing, no query required; `unlinked_only` filters to unreferenced assets. Paginated (`limit`/`offset`, default 50); response is `{ total, assets, has_more }` |
| `read_asset` | Full `extracted_text` |
| `search_assets` | FTS snippets. Paginated (`limit`/`offset`, default 50); response is `{ total, assets, has_more }` |
| `get_attempt` | Full attempt read: per-response inputs + derived `outcome` + live grade. `chosen_misconception` and `best_guess_correct` are answer-key material and stay withheld until the attempt is submitted; the attempt carries `reveal`, `revealed`, `paused_at`/`paused_ms`. You read as the *tutor*: a `deferred` reveal withholds the key from the app's screens (`GET /api/attempts/:id`, the submit response), never from this tool |
| `await_item_outcome` / `submit_quick_check` | Once answered/graded, return the full outcome record: `outcome` (`correct`/`partial`/`incorrect`/`dont_know`/`ungraded`), `score`, `grader`, `selected_choice_id`, `chosen_misconception`, `correct_choice_id`, `best_guess_choice_id`, `best_guess_correct`, `response_text`, `confidence`, `confidence_numeric`, `idk`, `misapplied_method`, `diagnosis`, `elapsed_ms`, `answered_at`, `explanation`, `model_answer`, `node_key`, `node_keys`. `await_item_outcome` takes `timeout_s` (default 25, clamped 1..25) and also reports `status: "paused"` |
| `grade_response` | The tutor's own verdict on an answered item: `grader` `oracle`/`judge`, optional `score` 0..1, optional one-line `diagnosis`. Supersedes a self/model grade on a written item; on an mc item only the diagnosis is kept and the `auto_mc` grade against the question's own key stands |
| `list_ungraded_written` | Written answers waiting for a verdict (prompt, rubric, model answer, the learner's text, any self grade), oldest first; optional `session_id`, `include_self_graded`, `limit`. The read half of grading over MCP — there is no model grader |
| `end_session` | Ends the session and returns `summary: { presented, answered, abandoned, dont_know, shows, paused_now, retired_ephemeral }` (`shows` counts what `present_show` put up — see §3.4) over its live items, marking anything still unanswered abandoned so the counts are final, and retiring the session's ephemeral questions (`retired_reason = 'ephemeral_session_ended'`). Optional `summary` (markdown) is the tutor's closing recap for the learner: stored on the session, echoed back as `summary_text` (distinct from the counts object), and rendered above that session's attempt history in the app. Whitespace-only is stored as nothing said |
| `create_session` | Starts a tutoring session. `tag_slug` must already exist. `reveal_default` (`immediate`, the default, or `deferred`) sets what every item presented in it does with its answer key on the learner's screen |
| `present_item` | Creates a live item in the app. Takes `reveal` (`immediate`/`deferred`) overriding the session default and `context` (§3.4); the returned snapshot carries `node_keys`/`node_key`. A `tag_query` pick takes `due_mode` (§3.5): `weight` (default) favours due items, `gate` takes the most overdue due item or refuses `nothing_due`, `off` is the old uniform pick |
| `present_show` | Puts something non-answerable on the learner's screen — `kind` `text`/`markdown`/`graph` (see §3.4 on what `markdown` actually renders), `payload`, optional `caption` (≤500 chars) and `context`. A `graph` payload is parsed with the same grammar as a question's `graph_spec` and rejected `invalid_graph_spec` with the parser's own message. Returns `{ show_id, presented_at }`. See §3.4 |
| `update_show` | Replaces a graph show's spec so the app redraws it in the same canvas (set `@bounds` to hold the frame). Graph shows only — anything else is `update_not_supported` — and the session must still be open |
| `await_show_outcome` | Waits for the learner to work through a show, `timeout_s` default 25 clamped 1..25, polling every second and returning early on `acknowledged`. Returns `{ show_id, status: 'pending'/'seen'/'acknowledged', seen_at, dwell_ms, acknowledged_at }` |
| `set_retention_target` | Attaches a target to a **node key** (a non-node identity is refused `invalid_node_key`); every item carrying the key inherits it. Returns `{ id, node_key, identity_key, retention_target, needs_last_until, first_gap_days, due_at, node_items }` — `due_at` is gap 1, when the node's first probe is drawn. The same label again starts that target over (§3.5) |
| `get_due_items` | One row per due item (`id` = its `lineage_id`, `question_id` = the live version), most overdue first — overdue measured against the gap the item was meant to survive (`overdue_ratio`). Rows carry `node_key`/`node_keys`, `targets[]` (each with `role` `draw`/`reserve` and the draw's `probe` state), SM2 state (`easiness`, `repetitions`, `interval_days`, `retention_reviews`, `last_quality`), and `reason`: `never_demonstrated` (no retention review yet), `relearn` (reserve a failed draw brought forward, or never passed — go teach it), `lapsed` (failed after passing — resurface sooner), `decayed` (passed, interval run). The identity-keyed fields stay: `identity_key` (primary node key), `retention_target`/`target_source` (nearest open target), `last_result`. Filters `before`, `node_key` (segment-aware); paginated |
| `ws_list` / `ws_read` / `ws_search` | Read Ben's workspace (§3.6). `ws_list` with no `container_id` is the roots (every trajectory, track and course, each flagged `top_level` when it is placed nowhere) plus `unplaced` (the files and folders placed nowhere); with one it is that container's live children, containers first, under their local names. `ws_read` is a node's summary, `appears_in` and, for a file, its `content` (`format`, `body`, `version`, `saved_at`, `author`, `asset_id`); the `version` it shows is the one to hand back to `ws_write`. `ws_search` is text (placement names, titles, and a file's search text) with optional `scope` and `kind_tag`, one row per placement, and never lists an unplaced node |
| `ws_create` / `ws_write` / `ws_append` / `ws_place` | Write to it (§3.6). Each content write takes `as: tutor` or `planner`, no default, and that is recorded as the version's `author`. `ws_create` makes a trajectory, track, course, folder or file (a file needs `format`) and places it with `container_id`; `ws_write` replaces a file against the `version` you read (`stale_version` means Ben or the other agent saved it since); `ws_append` adds to a file whose format has an append hook (`markdown` does), with no version; `ws_place` puts an existing node in one more container. When `ws_create` or `ws_place` meets a taken name it answers `name_taken` with a message that points at the node already there (`ws_list` the container; for USERNOTES, `ws_append` to it) and never offers a numbered copy |
| `list_themes` / `get_theme` / `theme_tokens` / `save_theme` / `patch_theme` / `validate_theme` / `set_active_theme` / `delete_theme` | Themes as manifests (§3.7). `save_theme` takes a `manifest`, returns the validation `report`, and refuses an invalid one with the report attached; read each `warnings[].suggestion` and apply it with `patch_theme`. `theme_tokens` is the token reference |

Plus one plain (non-JSON-RPC) HTTP route on the same route family, `POST
/mcp/:token/upload`, which accepts either token — see §5.

### 3.1 Reveal, and who is reading

An attempt's `reveal` is `immediate` (the learner sees the answer key on
submit — every attempt before this existed, and the default still) or
`deferred` (they see it when `end_session` runs, so an early item's key can't
teach the next one). It comes from `present_item`'s own `reveal`, else the
session's `reveal_default`, else `immediate`.

Withholding applies to exactly one reader: the app. `GET /api/attempts/:id`,
the live-item poll and the submit response read as the *learner* and, while a
deferred attempt's session is open, return `revealed: false` with no
`is_correct`, `explanation`, `model_answer`, per-response `outcome`, `grade`
or `diagnosis` — the learner's own inputs all stay. Every MCP tool reads as
the *tutor* and is never gated. A deferred attempt with no session has nothing
to wait for and reveals on submit like an immediate one.

### 3.2 Ephemeral items

`create_questions(ephemeral: true, session_id)` writes items for one live
moment. They are excluded from `getEligibleQuestions` (so from every template
and daily draw), from `search_questions` unless `include_ephemeral: true`, and
from `readme`'s and `bootstrap`'s `bank_size`. They are presentable by
`present_item(question_id)` while their session runs, and `end_session`
retires them. Duplicate detection is deliberately left alone: an ephemeral
item still reports against the bank, since a near-duplicate is worth knowing
about whichever side it is on.

### 3.3 Push: the app doesn't poll for the tutor's next move

`readme().node.push` is `true`, and `/sync/health` and `/api/status` say the
same. It means this node publishes session events over SSE at `GET
/api/sessions/:id/events`, so `present_item` reaches the learner's screen in
well under a second instead of up to a poll interval later.

An event is `{ type, at, ...ids }` — `item_presented`, `item_answered`,
`attempt_paused`, `attempt_resumed`, `session_ended`, `show_presented`,
`show_updated` — emitted after the write
it announces has committed. It is a nudge to re-read, never state: a client
that missed one while reconnecting is a re-read behind, not out of sync, and
the app keeps a 15-second poll as its fallback whenever the stream is down.
Nothing in the tool surface changes — the tutor calls `present_item` exactly as
before and the push happens underneath it.

---

### 3.4 Showing

`present_show` is the other half of the live loop: putting something on the
learner's screen that is **not** a question. Nothing is answered, nothing is
graded, and nothing enters the bank — a show belongs to its session and dies
with it (migration `020_show.sql` gives it no lineage, no version and no
retire, and the sync column allowlists don't name it, so it stays node-local).

`kind` is `text`, `markdown` (both go through the app's rich-text renderer,
the one a question prompt uses — which today renders LaTeX and line breaks but
**not** markdown emphasis, so `**bold**` arrives with its asterisks showing)
or `graph` (a graph-engine spec, parsed at the tool boundary so a spec that
won't render is a rejection rather than an empty canvas).
`update_show` replaces a graph's spec in place: the app keeps the same
`<GraphPanel>` instance and feeds it the new spec, so the canvas redraws
without the frame jumping — put `@bounds` in the spec if you want to hold the
frame yourself. Prose has no in-place update; call `present_show` again.

What comes back is three facts, not one: `seen_at` (the card reached the
screen), `dwell_ms` (how long it actually stood in front of them, measured
from first paint and only ever growing) and `acknowledged_at` (they pressed OK
or Space). Only `acknowledged` means move on, and `dwell_ms` is worth reading
alongside it: an OK 400ms after the card appeared is not reading.

`context` — `{ course?, unit?, node?, step?, timer_s? }`, accepted by both
`present_show` and `present_item` — is the tutor's breadcrumb. It is stored as
JSON, displayed verbatim in the app's banner above the stream (`course · unit ·
node · step`, with `timer_s` as a countdown) and never interpreted. The banner
shows the most recent context across both kinds of entry, so an item that
names none does not blank what the show before it said.

The app renders all of this through `GET /api/sessions/:id/stream`: items
(by reference — `attempt_id`, `response_id` and `revealed`) merged with shows
(in full) in the order they landed, plus `POST /api/shows/:id/seen` and
`/acknowledge`, both taking `{ dwell_ms }`. The two differ on a closed
session: `/seen` is still accepted, because being seen is a measurement of
something that already happened and the show the learner was reading when the
tutor ended the session is the one whose dwell is most worth having;
`/acknowledge` is an act and returns **409**. While any item in that stream is
still open, every earlier entry collapses to a one-line stub, and a `deferred`
item stays collapsed until its key is released. That collapse is a web-side
rule and deliberately not tamper-proof: the server's job is withholding the
answer key (§3.1), and this one is about not leaving an earlier answer on the
same screen as the question being answered.

---

### 3.5 The retention loop (stage 2a, migration 022)

**Identity.** A node key is tag-shaped: `node:<topic_slug>:<subtopic>:<node_key>`
(or, for course material, `node:<textbook_slug>:<section>:<node_key>` — identity
is leaning away from textbooks, so new keys should prefer the topic shape). 022
rendered the free-form legacy values into that shape and registered every node
key in use as a `node:` tag, so `merge_tags` can merge two node identities. A
`node:` slug in a `tag_query` matches items by their `node_keys` as well as by
their tags.

**Two halves.** A target and its inheritance live on the node
(`node_retention_target`); scheduling lives on the item, keyed by `lineage_id`
(`retention_item`). The two-key row `retention_schedule (node_key, lineage_id,
retention_target, role)` joins them. SM2 state is not stored: it is replayed
from the item's graded responses on every read, so re-grades, late sync pushes
and reworded versions never leave it stale. A draw's *result* is the one thing
fixed once recorded: re-grading a probe afterwards does not reopen it.

**Gap 1.** `first_gap_days` = Cepeda's share of the time to `needs_last_until`,
measured from the target's `set_at` — or, for an item written after the target
was set, from the item's own authoring, so a freshly written item's session check
is never its probe.
At gap 1 the node's first probe is drawn: its discriminating items (filed with
`tests_error`), the first `k` by authoring order (config `retention_draw_k`,
default 3), plus one transfer item (its `node_keys` span this node and another,
preferring a node nothing has targeted). A node with no discriminating items
draws `k` weak-weighted. Everything else on the node is reserve, and an item
authored onto the node later joins the reserve.

**The draw's result.** Any miss fails it, at once; all probes passing passes it.
Pass: the reserve's first due is the node's gap-2 interval (the soonest any drawn
item comes back after its probe), clamped — no synthesized easiness, the item
stays `never_demonstrated` until a real grade starts SM2. Fail: the reserve is due
now, reason `relearn`, and its clock restarts at the failure — relearned reserve
earns no credit for surviving since the original teaching.

**Gap 2 onward: SM2.** From an item's first retention review (its first due or
later; earlier answers are the learning phase and only refresh it). Quality from
the outcome: correct·confident 5, ·somewhat 4, ·unsure 3; incorrect·unsure 2;
incorrect·somewhat or idk 1; incorrect·confident 0; partial 2; a missing
confidence reads as somewhat. Only `auto_mc`, `oracle` and `judge` grades
schedule — never `self` — and an idk always counts. Easiness updates on every
review; the interval is `max(previous, elapsed × easiness)`, so an early review
does not grow it and gap 2 = gap 1 × easiness. A miss relearns in one day.

**The clamp.** `next_due = min(review + interval, target − ratio × (target −
review))` over every open target on the item's nodes. Once that latest review
would be under `retention_clamp_floor_hours` (default 24) away, the target has had
its last pre-target pass and adds nothing; after every target has passed, SM2
runs free.

**Selection.** `due_mode` on templates and `present_item`: `gate` for homework
and SM2 review sets, `weight` for casual draws (the daily question and quiz always
weight). A due item's weight is ×2–4 by how overdue it is.

**Lifecycle.** `merge_tags` on two `node:` slugs moves the node's targets and
draws with its items (`retention_targets_moved`). A reworded version keeps the history (lineage). `retire_question`
on the live version ends the schedule (`status: ended`) and keeps the history.
Ephemeral items never schedule.

### 3.6 The workspace (tools_version 9)

Ben's workspace is a graph: trajectories, tracks, courses, folders and files are
nodes, and a *placement* says "this node appears in this container under this
name", so one file can sit in two courses under a name of its own in each. What
a container may hold: a trajectory holds tracks, courses, folders and files; a
track holds courses, folders and files; a course holds folders and files; a
folder holds folders and files; a file holds nothing. A folder has no built-in
meaning: a unit, research, attachments and notes are all just folders. The tutor
and the planner share the workspace with Ben through seven tools: `ws_list`,
`ws_read`, `ws_search` (read), `ws_create`, `ws_write`, `ws_append` (write) and
`ws_place` (file an existing node somewhere else). All seven are on the
presenter surface, because the tutor server writes its notes there.
`format`, `version` and `author` replaced the first design's `type`, `revision`
and `saved_by` before this surface was deployed, so `tools_version` stayed 9.

**Reading.** `ws_list` with no `container_id` returns the roots (every
trajectory, track and course) and `unplaced`. A trajectory, track or course that
is placed nowhere is `top_level`, which is a normal state for a container; a
file or folder placed nowhere is `unplaced`. `ws_search` never returns an
unplaced node: `ws_list` is where those are found. `ws_read` returns the node,
`appears_in` (the containers it is placed in) and, for a file, its `content`.

**Who wrote it.** Every content write (`ws_create`, `ws_write`, `ws_append`)
takes `as`: `tutor` or `planner`. There is no default and `ben` is not an
option; Ben's own edits arrive over HTTP (`/api/ws`) and are always signed as
him. The author is stored on the version and `ws_read` returns it as
`content.author`.

**Writing without clobbering.** Every save is a new *version* (1, 2, 3, ...) and
the latest is the file's content. `ws_write` replaces a file and must carry the
`version` that `ws_read` showed; if the file has been saved since, it is refused
as `stale_version` (the message names the current version) and the caller reads
again and merges. `ws_append` needs no version: it hands the new text to the
format's append hook, and `markdown`'s joins it after a blank line. That is how
the tutor's notes about Ben go into a unit's `USERNOTES` file, with specific
examples, without overwriting anything Ben changed. A format with no append hook
(`graph`, an uploaded document, any format nobody registered) answers
`not_appendable`.

**A taken name.** Names are unique among a container's live placements, compared
case-insensitively. A taken name means the node `ws_create` was about to make is
very likely there already, so `ws_create` and `ws_place` answer `name_taken` with
a message that says to `ws_list` the container and use the node that is there
(for USERNOTES, `ws_append` to it), and never to make a numbered copy. The
message does not offer a numbered name. The app's own HTTP API answers the same
code with the free name in `detail.suggestion`; an MCP result carries no detail.

**What is not here.** No remove (trash), delete, restore, purge, move, rename or
retitle: removing things and rearranging the tree are Ben's. An agent can add to
the workspace and fill it in, not tidy it away. Errors are the usual
`{ error, message }` (`not_found`, `name_taken`, `invalid_name`,
`containment_not_allowed`, `cycle_rejected`, `already_placed`, `archived`,
`invalid_input`, `invalid_content`, `not_appendable`, `stale_version`, ...).
`archived` means the node, or the container it is going into, is in Ben's
Archive and is read-only until he restores it.

**Uploads.** Every upload (an asset made by `create_asset`, the app, or the CLI)
gets a file node `asset:<asset id>` in the workspace the moment it is created:
`format` `upload`, tagged `source`, placed nowhere until Ben files it. Deleting
the upload archives that file, so it shows up in Ben's Archive.

**Formats.** A file has a `format`: an opaque name (lowercase letters, digits
and `-`, at most 40 characters) that the data layer never interprets, and a
`body` of text (an `upload` file has an `asset_id` and no body). `markdown`,
`graph` and `upload` are built in. `ws_create` accepts any valid format name,
registered or not: a format nobody registered is stored verbatim, so it is not
searchable by its content and not appendable. A format's owner registers hooks
on the server (`searchText`, `validate`, `append`), and they run on `ws_create`,
`ws_write` and `ws_append`: a body that `validate` refuses answers
`invalid_content` with its message. A file keeps the format it was made with.
Item files and other special formats arrive by registering hooks, not by a new
tool: `docs/workspace/FILE-TYPES.md`. The versions of a file (number, author,
time) are listed by `GET /api/ws/nodes/:id/versions` over HTTP; there is no MCP
tool for them, and no way to read an old version's body.

**Where to read more.** The design is the Learn spec
`spec/osmosis/workspace/02-data-layer.md` (operations §5, queries §6, format
hooks §7, uploads §8) and `01-shell.md` for the shell around it, with Ben's
answers in `ruling-2026-10-03-shell-answers.md` beside them.

### 3.7 Themes (tools_version 10)

A theme is a **manifest** (theme-core): a handful of seeds, dials, named font
stacks and optional token overrides. Everything else is derived. `tools_version`
is 10: the theme tools below replace the old `{id, name, tokens, custom_css}`
`save_theme`; `builtin:slate` and `builtin:plum` are gone (they resolve to
`builtin:osmosis`).

| Tool | Args | Result |
|---|---|---|
| `list_themes` | none | `{ themes: [{id, name, description, builtin, active}], active_theme_id }`. The four built-ins (`builtin:osmosis`, `builtin:forest`, `builtin:ocean`, `builtin:ember`) plus saved custom themes. |
| `get_theme` | `id`, `resolved?` | `{ id, name, builtin, manifest, resolved?: { light, dark, provenance } }`. `resolved` maps token name to final value per mode; `provenance` says whether each came from default, seed, dial or override. Unknown id: `not_found`. |
| `theme_tokens` | `group?` | `{ count, tokens: [{name, tier, group, type, modeDependent, allowed?, meaning}] }`, the author's reference. An unknown group fails and lists the valid ones. |
| `save_theme` | `manifest`, `make_active?` | `{ saved: true, theme: {id, name, updated_at}, report, active }`. |
| `patch_theme` | `id`, `patch`, `make_active?` | Same as `save_theme`. JSON merge patch onto the stored manifest (`null` deletes a key). Built-ins and unknown ids fail. |
| `validate_theme` | `manifest` | The `report` alone; stores nothing. |
| `set_active_theme` | `id` (`null` = `builtin:osmosis`) | `{ active_theme_id }`. |
| `delete_theme` | `id` | `{ id }`. Built-ins fail `builtin_theme`. |

`report` is `{ ok, errors: [{path, message, suggestion?}], warnings: [...] }`.
A manifest with errors is **not saved**: the call returns `isError` with
`{ saved: false, error: "invalid_theme", message, report }` so the author can read
`report.errors[].path` and fix it. Warnings (e.g. low contrast) still save;
read each `warnings[].suggestion` and apply it with `patch_theme`. Dials are
0..1 except `typeScale` 1.125..1.333 and `baseSize` 13..18 (px); fonts are named
stacks (`space-grotesk`, `inter`, `system-sans`, `system-serif`, `system-mono`,
`stix-two`, `latin-modern-math`). Give one mode's seeds and the other is
derived. `ambience`, `sounds`, `assets` and `graph.papers` are reserved slots:
stored and returned unchanged, no effect yet.

Worked example, `save_theme` with a 6-seed manifest:

```json
{
  "manifest": {
    "schema": 1, "id": "harbour", "name": "Harbour",
    "seeds": {
      "light": { "canvas": "#eef2f4", "surface": "#ffffff", "ink": "#16222b",
                 "accent": "#1f6f8b", "secondary": "#c9852b", "good": "#3f7d5a" }
    },
    "dials": { "roundness": 0.7, "warmth": 0.3 },
    "fonts": { "display": { "stack": "inter" } },
    "overrides": { "any": { "radius-md": "10px" } }
  },
  "make_active": true
}
```

The manifest above validates clean (`warnings: []`). Here is a real report, from
`validate` on a manifest whose light `ink` is `#dddddd` on a `#ffffff` canvas
(the dark-mode entries, which repeat the same three tokens, are left out):

```json
{
  "ok": true,
  "errors": [],
  "warnings": [
    { "path": "overrides.light.color-text",
      "message": "light: color-text on color-canvas has contrast 1.36, below 4.5",
      "suggestion": "set color-text to #767676 (contrast 4.5)" },
    { "path": "overrides.light.color-text",
      "message": "light: color-text on color-surface has contrast 1.36, below 4.5",
      "suggestion": "set color-text to #767676 (contrast 4.5)" },
    { "path": "overrides.light.color-text-muted",
      "message": "light: color-text-muted on color-surface has contrast 1.19, below 3",
      "suggestion": "set color-text-muted to #949494 (contrast 3.0)" }
  ]
}
```

`save_theme` wraps this as `{ saved: true, theme, report, active }`. A warning's
`path` names the derived token, and its `suggestion` is prose naming the value
to use; apply it with `patch_theme`, either as an override
(`patch: { overrides: { light: { "color-text": "#767676" } } }`) or by fixing
the seed that produced it (`patch: { seeds: { light: { ink: "#444444" } } }`).

Removed built-ins (`builtin:slate`, `builtin:plum`) resolve to `builtin:osmosis`
only as the **active pointer** (`set_active_theme`, or a stored pointer). They
are not themes: `get_theme("builtin:slate")` is `not_found`. An unknown
`builtin:*` id given to `set_active_theme` fails `unknown_builtin`.

## 3a. Bulk authoring: `scripts/mcp-batch`

Native tool-calling has a real, measured cost at scale: every tool schema
resends on every turn a connector is enabled for regardless of whether that
turn calls a tool, and a native chat session's conversation history — every
prior batch's full call and response — accumulates and resends as input on
every later turn. Two live stress tests (`docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md`,
`-v2.md`) measured this directly, on a 21-tool surface (§3 has today's count,
so the schema share is larger now): curl-driven authoring from an isolated
context cost roughly 700 tokens/question (input+output combined); native
tool-calling in a long-lived session cost roughly 900+ *input* tokens/question
alone, before output.

`scripts/mcp-batch/` is a small, zero-intelligence MCP JSON-RPC client that
sidesteps both costs — it's a plain HTTP client, so it never triggers a
schema resend, and it runs outside the conversation, so only its compact
summary output (not the raw protocol exchange) enters context. See
`docs/superpowers/specs/2026-08-21-mcp-batch-script-design.md` for the full
design.

**This is opt-in for large sessions, not a default authoring path.** For a
small, one-off session — a handful of questions, one or two
`create_questions` calls — native tool-calling is simpler and the schema-
resend/history cost barely matters at that scale. Reach for the script once
you're doing multiple sequential batches or authoring 50+ items in one
sitting.

**Usage.** Write a plain JSON array of `{name, arguments}` calls to a file,
then run the script against the MCP endpoint's URL:

```json
[
  { "name": "create_tag", "arguments": { "slug": "math:algebra", "label": "Algebra" } },
  { "name": "create_questions", "arguments": { "questions": [ /* ... */ ] } }
]
```

```
OSMOSIS_MCP_URL="http://host:port/mcp/<token>" node scripts/mcp-batch/cli.mjs calls.json
```

Flags: `--url <url>` (overrides `OSMOSIS_MCP_URL`), `--raw` (print each
call's full JSON response instead of the compact per-tool summary), and
`--timeout <ms>` (overrides the default 30000ms per-call request timeout;
also settable via `OSMOSIS_MCP_TIMEOUT_MS`).

A wrong or expired token produces a plain HTTP 404 from this tool — matching
the `/mcp` endpoint's own no-signal-on-wrong-token behavior — which reads
like a bad URL/path rather than a bad token, so don't mistake a 404 here for
a routing problem before checking the token.

Because `create_questions` commits questions to the database one at a time
rather than all-or-nothing, a client-side timeout leaves it ambiguous how
many questions actually landed — resolve that with `search_questions` to
check what's actually in the bank before blindly re-running the same batch.

---


## 4. `get_question`

`search_questions` deliberately strips `explanation`/`rubric`/`graph_spec` to
stay cheap in listings (spec §9.4's `QuestionSummary`). `get_question(id)`
wraps the existing `getQuestionDetail` domain function so Claude can read back
exactly what it wrote before editing it, rather than guessing at
`edit_question`'s current-value merge behavior blind.

---

## 5. Document upload: three paths, pick per situation

1. **Human uploads via the web UI.** `POST /api/assets` (multipart,
   `http/apiRoutes.ts`) — the right path for anything the user already has as
   a file. Zero MCP involvement, zero token cost to Claude.
2. **Claude authors text directly.** `create_asset(type: "text")` — Claude
   writing its own source notes. Content is small by construction.
3. **Claude's own sandbox has the bytes** (Code Execution enabled alongside
   the connector, or Claude Code). `POST /mcp/:token/upload` — same token
   gate as `/mcp` itself, plain multipart, handled in `mcp/server.ts` next to
   the JSON-RPC route. It calls the same `createAsset` domain function
   `create_asset` and `/api/assets` both use, just fed from `request.file()`
   instead of a base64 JSON field, and returns the same small shape
   (`{id, title, type, extracted_text}`). This exists specifically because
   `/api` is localhost-only per the deployment model and unreachable from a
   remote sandbox, while `/mcp` is the one surface cloudflared exposes — a
   `curl -F file=@doc.pdf` from Claude's shell never puts the file's bytes in
   the model's context, only the small JSON result does. Covered end-to-end in
   `tests/mcpUpload.test.ts` (correct token, wrong token → 404, missing file
   → 400).

`create_asset(type: "file", content: base64)` **stays** as the fallback for a
plain connector session with no shell at all — the only remaining way such a
session can get a file in. It just isn't the first choice when a shell is
available; base64-through-a-tool-call costs roughly 4/3 of a file's byte size
in characters, so a multi-MB PDF is hundreds of thousands of tokens through
that path versus near-zero through §5.3.

---

## 6. Invalid-entry feedback

`validateQuestionInput` in `domain/questions.ts` runs inside `create_questions`
and `edit_question`, per-question, before any write commits. Graph/document
fields specifically:

- `graph_spec` → parsed with the actual `graph-engine` parser (`parseSpec`),
  not a heuristic. Failure → `invalid_graph_spec`, `detail` carries the
  parser's own line-numbered message.
- `document_anchor_start/end` → bounds-checked against the referenced asset's
  real `extracted_text.length`. Rejected outright (`invalid_document_anchor`)
  against a `type: "url"` asset, which has no extracted text at all and so
  can't be bounds-checked — see `tests/questions.test.ts`'s url-asset test.
- `document_marker_offset` → range-checked and additionally required to land
  on an actual token (`document-engine`'s `findTokenSpan`), not
  mid-whitespace.

Rejections are per-question in a batch; valid siblings still commit. This is
the mechanism that makes a large `create_questions` call self-correcting in
one round trip instead of needing a retry loop.

---

## 7. Response-size discipline

Two places that reported unbounded results now cap them, both in
`domain/questions.ts` / `domain/results.ts`:

- `possible_duplicates` — top 3 per new question (`MAX_DUPLICATES_PER_QUESTION`),
  `existing_prompt` truncated to 120 chars. Measured need for this: a 100-
  question batch against a seeded 500-question bank (see §8's timing test)
  returned **294** duplicate reports uncapped, for a batch that only created
  100 questions — the report was closer to 3x the size of the batch's own
  content.
- `response_text` in `get_results(scope: 'question')` — truncated at 500
  chars (`RESPONSE_TEXT_PREVIEW_LENGTH`). Long enough to see *how* an answer
  was wrong, short enough that one verbose written response doesn't dominate
  a call spanning many lineages.

`create_asset`/the upload route also cap file size at 25MB
(`MAX_UPLOAD_BASE64_LENGTH` in `domain/assets.ts`) — protects the model's
context on the base64 path and the disk on both paths.

---

## 8. What's left

### 8.1 Batch-size guidance — informed by an actual measurement, not a guess

Ran `createQuestions` with a 100-question batch against an in-memory DB
pre-seeded with 500 existing questions (realistic duplicate-detection
candidate pool): **276ms** end-to-end, including the per-question FTS
duplicate check and individual transaction each question gets. That's not a
database-speed problem at any batch size worth using in practice — the
`readme` tool's "~25-30 questions per batch" guidance is a hedge against
*response payload size* and *tunnel/connector round-trip timeout*, not
against SQLite being slow. Worth revisiting only if a live batch through the
actual cloudflared tunnel times out in practice; the fix at that point is
almost certainly the tunnel/network hop, not the query.

### 8.2 SSRF-avoidance tradeoff on `type: "url"` assets, unresolved by design

`extractText` returns `null` for `type: "url"` unconditionally
(`lib/extract/index.ts`) rather than fetching server-side, specifically to
avoid building an SSRF surface. §6 makes sure that tradeoff can't silently
produce an unvalidated anchor, but it also means a `url` asset is currently
inert for anchoring purposes — Claude can register one as a citation but
never point a question at a specific span of it. Revisit only if URL-sourced
questions become common enough to justify designing a fetch allowlist; not
worth it for the current single-user scope.

### 8.3 No usage/abuse visibility beyond Fastify's request log

`/mcp/:token` and `/mcp/:token/upload` both log via Fastify's built-in logger
(`app.ts`), so a wrong-token flood is visible if someone goes looking, but
nothing surfaces it proactively. Low priority for a single-user tool; would
matter more if the tunnel URL ever leaks somewhere public.
