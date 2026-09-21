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
| `MCP_AUTH_TOKEN` | `full` | all 37 tools. Required — the canonical node refuses to boot without one set |
| `MCP_PRESENTER_TOKEN` | `presenter` | `PRESENTER_TOOLS` in `server/src/mcp/tools.ts`: `readme`, `create_session`, `create_questions`, `present_item`, `await_item_outcome`, `present_show`, `update_show`, `await_show_outcome`, `get_attempt`, `end_session`, `grade_response`. Optional — unset means the presenter surface does not exist |

`registerTools(server, db, uploadsDir, nodeId, scope)` skips any tool outside
the allowlist when the scope is `presenter`, so a withheld tool is genuinely
absent from `tools/list` and answers "tool not found", rather than being
listed and then refusing. The presenter token is what the **tutor server**
holds: it runs the live teaching loop and never needs to retire a question,
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

40 tools on the full surface, 11 on the presenter surface (§1). Every schema is sent on every turn a connector is enabled for,
regardless of whether it's called that turn — tool *count* isn't free, which
is why `readme`/`bootstrap` were split by call cadence rather than just
becoming one larger tool.

| Tool | Purpose |
|---|---|
| `readme` | Universal conventions, called once per session. `node` carries `protocol_version`, `tools_version` (bumped whenever a tool is added, removed, or changes shape; now 6), the sorted `tools` list *for the caller's scope*, and `push` (now `true` — see §3.3). Top-level `scope` is `full` or `presenter` — see §1. `tag_conventions` documents the three reserved slug prefixes |
| `bootstrap` | Subject-scoped taxonomy + results pointer + graph DSL reference, called once per subject. Returns `taxonomy: { seeded, seed_available, tag_count }`; `seed: true` creates the subject's shipped taxonomy (`server/src/domain/taxonomies/`, currently `chemistry` — Ebbing 11e ch. 1-12 plus `tech:mhchem`/`tech:calculator` — and `math`), idempotently, so an empty bank gets standard slugs instead of invented near-duplicates |
| `list_tags` | Controlled vocabulary listing. Every row carries `kind`, derived from the slug's leading segment: `node` (one teachable idea — the same string a question's `node_keys` carry), `tech` (a rendering/tooling requirement), `topic` (a cross-subject theme), else `subject`. Filters `prefix` (a slug and its descendants) and `kind` compose — both are ANDed. Paginated (`limit`/`offset`, default 50); response is `{ total, tags, has_more }` |
| `create_tag` | One tag at a time, by design. Slug grammar: lowercase ascii segments joined by `:`, words within a segment joined by `_` or `.` — a separator always sits between alphanumerics, so `a..b`, `.a`, `a.` and `a-b` are rejected as `invalid_slug_format`. The `.` exists so a textbook section number survives into the slug (`node:ebbing11e:2.4:atomic_weight`) |
| `merge_tags` | Vocabulary cleanup. When **both** slugs are `node:` tags the node keys move too — `question_node_key` rows (collapsing rather than colliding on the `(question_id, node_key)` PK, and promoting the survivor when the merged key was primary) and the singular `question.node_key` — reported as `node_keys_updated`. A merge that isn't `node:`-to-`node:` leaves node keys alone rather than minting an invalid one |
| `search_questions` | Cheap summaries, omits explanation/rubric/graph_spec. Every row carries `node_keys` (primary first) and `node_key` (the primary). Filters: `node_key` (exact, or prefix when the value ends with `:` — `node:ebbing11e:2.4:` matches everything under that section), `session_id`, and `include_ephemeral` (session-only items are excluded otherwise). Paginated (`limit`/`offset`, default 50); response is `{ total, questions, has_more }` |
| `get_question` | Full detail for one question — the read path before an edit. Carries `node_keys`, `ephemeral` and `session_id` |
| `create_questions` | Batched, per-question rejection detail, capped duplicate reports. Batch-level `ephemeral` (requires `session_id`, else `ephemeral_requires_session`) and `idempotency_key` (≤128 chars: a repeated key writes nothing and replays the stored result verbatim with `replayed: true`. The key is *not* fingerprinted against the payload: the same key with a different batch replays the stored result and writes nothing, so mint a fresh key per batch). Per question, `node_keys` — first is primary, each `node:`-prefixed and tag-slug-shaped, else that question is rejected `invalid_node_key`; passing both `node_key` and a disagreeing `node_keys[0]` is `node_key_mismatch`. A choice's `misconception` is optional — missing, null, empty, or the placeholder `"distractor (imported; misconception not recorded)"` all store NULL, which reads as *unknown*, not *none*. A question is never rejected for a missing misconception |
| `edit_question` | Versions if attempted, in-place otherwise. Same optional-`misconception` normalisation as `create_questions`; `node_keys` replaces the whole set, a singular `node_key` replaces it with that one primary |
| `retire_question` | Soft retire |
| `list_templates` | Live eligible_count. Paginated (`limit`/`offset`, default 50); response is `{ total, templates, has_more }` |
| `create_template` / `edit_template` / `retire_template` | Draw specs |
| `get_results` | Weak-area signal, truncated `response_text` on wrong written answers; a null `score` (ungraded) is never averaged as zero — tag/question rows carry `graded`, attempt/daily rows carry `ungraded`, so every mean's denominator is visible. Question rows also carry `graded_by` (`self`/`model`/`oracle`/`judge`/`auto_mc` counts); question and attempt rows both carry the full per-response record (`recent_responses` / `responses`). Accepts `offset` (all four scopes) to page through rows, but deliberately does *not* return `total`/`has_more` — offset-only, not the full pagination envelope used by the list/search tools above |
| `get_config` / `set_config` | Refuses unknown keys and secrets |
| `create_asset` | `type: text`/`url`/`file` (base64) — the file variant is the fallback path, see §5 |
| `list_assets` | Cheap listing, no query required; `unlinked_only` filters to unreferenced assets. Paginated (`limit`/`offset`, default 50); response is `{ total, assets, has_more }` |
| `read_asset` | Full `extracted_text` |
| `search_assets` | FTS snippets. Paginated (`limit`/`offset`, default 50); response is `{ total, assets, has_more }` |
| `get_attempt` | Full attempt read: per-response inputs + derived `outcome` + live grade. `chosen_misconception` and `best_guess_correct` are answer-key material and stay withheld until the attempt is submitted; the attempt carries `reveal`, `revealed`, `paused_at`/`paused_ms`. You read as the *tutor*: a `deferred` reveal withholds the key from the app's screens (`GET /api/attempts/:id`, the submit response), never from this tool |
| `await_item_outcome` / `submit_quick_check` | Once answered/graded, return the full outcome record: `outcome` (`correct`/`partial`/`incorrect`/`dont_know`/`ungraded`), `score`, `grader`, `selected_choice_id`, `chosen_misconception`, `correct_choice_id`, `best_guess_choice_id`, `best_guess_correct`, `response_text`, `confidence`, `confidence_numeric`, `idk`, `misapplied_method`, `diagnosis`, `elapsed_ms`, `answered_at`, `explanation`, `model_answer`, `node_key`, `node_keys`. `await_item_outcome` takes `timeout_s` (default 25, clamped 1..25) and also reports `status: "paused"` |
| `grade_response` | The tutor's own verdict on an answered item: `grader` `oracle`/`judge`, optional `score` 0..1, optional one-line `diagnosis`. Supersedes a self/model grade on a written item; on an mc item only the diagnosis is kept and the `auto_mc` grade against the question's own key stands |
| `end_session` | Ends the session and returns `summary: { presented, answered, abandoned, dont_know, shows, paused_now, retired_ephemeral }` (`shows` counts what `present_show` put up — see §3.4) over its live items, marking anything still unanswered abandoned so the counts are final, and retiring the session's ephemeral questions (`retired_reason = 'ephemeral_session_ended'`). Optional `summary` (markdown) is the tutor's closing recap for the learner: stored on the session, echoed back as `summary_text` (distinct from the counts object), and rendered above that session's attempt history in the app. Whitespace-only is stored as nothing said |
| `create_session` | Starts a tutoring session. `tag_slug` must already exist. `reveal_default` (`immediate`, the default, or `deferred`) sets what every item presented in it does with its answer key on the learner's screen |
| `present_item` | Creates a live item in the app. Takes `reveal` (`immediate`/`deferred`) overriding the session default and `context` (§3.4); the returned snapshot carries `node_keys`/`node_key` |
| `present_show` | Puts something non-answerable on the learner's screen — `kind` `text`/`markdown`/`graph` (see §3.4 on what `markdown` actually renders), `payload`, optional `caption` (≤500 chars) and `context`. A `graph` payload is parsed with the same grammar as a question's `graph_spec` and rejected `invalid_graph_spec` with the parser's own message. Returns `{ show_id, presented_at }`. See §3.4 |
| `update_show` | Replaces a graph show's spec so the app redraws it in the same canvas (set `@bounds` to hold the frame). Graph shows only — anything else is `update_not_supported` — and the session must still be open |
| `await_show_outcome` | Waits for the learner to work through a show, `timeout_s` default 25 clamped 1..25, polling every second and returning early on `acknowledged`. Returns `{ show_id, status: 'pending'/'seen'/'acknowledged', seen_at, dwell_ms, acknowledged_at }` |
| `get_due_items` | Due-item queue, most-overdue first; each row carries `reason` (`never_demonstrated`/`decayed`/`lapsed`) |

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

## 3a. Bulk authoring: `scripts/mcp-batch`

Native tool-calling has a real, measured cost at scale: all 37 tool schemas
resend on every turn a connector is enabled for regardless of whether that
turn calls a tool, and a native chat session's conversation history — every
prior batch's full call and response — accumulates and resends as input on
every later turn. Two live stress tests (`docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md`,
`-v2.md`) measured this directly: curl-driven authoring from an isolated
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
