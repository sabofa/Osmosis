# Osmosis MCP Spec

What the MCP surface should be and do, for the authoring Claude connecting as a
remote connector (claude.ai custom connector, or any MCP client with no shell
of its own). This supplements `SPEC-Osmosis.md` §9 — that document describes
the bank/sync model; this one is specifically about the Claude-facing protocol
surface and stays up to date as that surface grows past the original 13 tools.

Status tags: **[DONE]** exists in `server/src/mcp/tools.ts` today. **[NEW]**
proposed here, not built. Bottom section covers everything **[NEW]** with a
concrete implementation sketch.

---

## 1. Transport and auth

`POST/GET /mcp/:token` on the canonical node only, mounted via cloudflared.
The token is a path segment, not a header, because the only client-side
surface available (e.g. claude.ai's "Add custom connector" dialog) accepts a
URL and nothing else for a plain shared-secret setup — no custom header
field, and OAuth is unnecessary machinery for a single trusted user. Wrong or
missing token returns a bare 404, not 401, so the endpoint gives no signal to
anyone probing it. **[DONE]** — `server/src/mcp/server.ts`, `MCP_AUTH_TOKEN`
env var, canonical node refuses to boot without one set.

Revocation is "rotate `MCP_AUTH_TOKEN`, restart, re-paste the URL into the
connector dialog." No live-revoke list is needed for a single-user tool.

---

## 2. The two-tier orientation problem

A hosted claude.ai session has no access to this spec, the source code, or
any prior session's context. Everything it knows about conventions has to
arrive through tool calls. `bootstrap(subject)` currently carries all of it —
conventions, tag taxonomy, calculator policy, results pointer — every time,
for every subject. That means a session that does biology today and
chemistry tomorrow re-reads the same universal authoring rules twice, and a
session that never touches graphing still has no way to *learn* the graph DSL
exists without stumbling into it via a rejected `graph_spec`.

Split into two tools:

### `readme` **[NEW]**

Called once, at the very start of a session, before anything subject-specific
is known. Fixed content, doesn't touch the database beyond a cheap read (bank
size, protocol version). Covers everything true regardless of subject:

```
readme() -> {
  node: { protocol_version, bank_size, last_write_at },
  workflow: string,          // "call bootstrap(subject) next, once per subject you touch this session"
  prompt_conventions: {...}, // prompt_style, explanation_style, difficulty_scale, mc_choice_count, written_length_target
  calculator_conventions: string,   // calculator_policy AND desmos_allowed, the distinction between them
  document_conventions: string,     // document_id / document_anchor_* / document_marker_offset, when to use which
  duplicate_workflow: string,       // possible_duplicates is a report not a rejection; call retire_question on the loser
  batching_guidance: string,        // prefer batches of ~25-30 questions per create_questions call, see §5
}
```

This is the "read once per session" tier. It never repeats itself within a
session and a client is expected to call it exactly once, first.

### `bootstrap(subject)` **[DONE, needs one addition]**

Stays exactly what it is today — subject-scoped tag taxonomy, `results_pointer`,
`skill_level` — called once *per subject* touched this session, cheap enough
to call more than once (biology, then later chemistry, each gets its own
call, neither repeats the universal stuff `readme` already covered).

Addition: a `graph_dsl_reference` field, populated only when the resolved
subject subtree plausibly uses it (math, physics, chem stoichiometry/graphing,
stats — a config-driven allowlist of top-level tag slugs, not a hardcoded
"math" check, so this generalizes as the tag vocabulary grows). Compact
version of the grammar in `graph-engine/src/parser/types.ts` — statement
forms one line each, config directives one line each, no implementation
asides. See §6 of the "not implemented" section for the actual grammar
content this pulls from.

**Why split instead of just growing bootstrap**: the alternative is
`bootstrap` conditionally including the universal stuff only on the first
call of a session — but MCP tool calls are stateless per the transport
(`sessionIdGenerator: undefined`, see `mcp/server.ts`), so "first call this
session" isn't something the server can detect without adding session state
it currently has none of. Two tools with two different call cadences is
simpler than adding session tracking to answer "have I told this client the
universal stuff yet."

---

## 3. Full tool inventory (target state)

| Tool | Status | Purpose |
|---|---|---|
| `readme` | **[NEW]** | Universal conventions, called once per session |
| `bootstrap` | **[DONE]**, +DSL field | Subject-scoped taxonomy + results pointer, called once per subject |
| `list_tags` | [DONE] | Controlled vocabulary listing |
| `create_tag` | [DONE] | One tag at a time, by design |
| `merge_tags` | [DONE] | Vocabulary cleanup |
| `search_questions` | [DONE] | Cheap summaries, omits explanation/rubric/graph_spec |
| `get_question` | [DONE] | Full detail for one question — the missing read path before an edit |
| `create_questions` | [DONE] | Batched, per-question rejection detail |
| `edit_question` | [DONE] | Versions if attempted, in-place otherwise |
| `retire_question` | [DONE] | Soft retire |
| `list_templates` | [DONE] | Live eligible_count |
| `create_template` / `edit_template` / `retire_template` | [DONE] | Draw specs |
| `get_results` | [DONE] | Weak-area signal, `response_text` on wrong written answers |
| `get_config` / `set_config` | [DONE] | Refuses unknown keys and secrets |
| `create_asset` | [DONE], scope narrowed | `type: text`/`url` only — see §5 for why `type: file` should route elsewhere when a shell is available |
| `list_assets` | [DONE] | Cheap listing, no query required — "what's uploaded and unlinked" via `unlinked_only` |
| `read_asset` | [DONE] | Full `extracted_text` |
| `search_assets` | [DONE] | FTS snippets |

20 tools today (`readme` and the `graph_dsl_reference` field on `bootstrap`
are the two pieces still outstanding), 21 at target. Every tool schema is
sent on every turn a connector is enabled for, regardless of whether it's
called that turn — tool *count* isn't free, so nothing gets added here that
doesn't close an actual gap.

---

## 4. The missing read path: `get_question` — closed

`search_questions` deliberately strips `explanation`/`rubric`/`graph_spec` to
stay cheap in listings (spec §9.4's `QuestionSummary`). That's correct for
scanning, but it used to mean there was **no MCP tool that returns a full
question**. `get_question(id)` now wraps the existing `getQuestionDetail`
domain function (`mcp/tools.ts`) — Claude can read back exactly what it wrote
before editing it, rather than guessing at `edit_question`'s current-value
merge behavior blind.

---

## 5. Document upload: three paths, pick per situation

1. **Human uploads via the web UI.** `POST /api/assets` (multipart, already
   built, `http/apiRoutes.ts`) — the right path for anything the user already
   has as a file. Zero MCP involvement, zero token cost to Claude.
2. **Claude authors text directly.** `create_asset(type: "text")` — Claude
   writing its own source notes. Fine as-is, content is small by construction.
3. **Claude's own sandbox has the bytes** (Code Execution enabled alongside
   the connector, or Claude Code). Base64-through-MCP is the wrong tool here —
   a multi-MB PDF costs hundreds of thousands of tokens to transmit as base64
   through a tool call. Needs a dedicated upload path — see §7.

`create_asset(type: "file", content: base64)` **stays** as the fallback for a
plain connector session with no shell at all — the only remaining way such a
session can get a file in. It just shouldn't be the *first* choice once §7 exists.

---

## 6. Invalid-entry feedback (already correct, documented here for completeness)

`validateQuestionInput` in `domain/questions.ts` runs inside `create_questions`
and `edit_question`, per-question, before any write commits. Graph/document
fields specifically:

- `graph_spec` → parsed with the actual `graph-engine` parser
  (`parseSpec`), not a heuristic. Failure → `invalid_graph_spec`, `detail`
  carries the parser's own line-numbered message.
- `document_anchor_start/end` → bounds-checked against the referenced asset's
  real `extracted_text.length` (when known — see the open note below on
  `type: "url"` assets, which have no extracted text and so skip this check
  entirely today).
- `document_marker_offset` → range-checked and additionally required to land
  on an actual token (`document-engine`'s `findTokenSpan`), not mid-whitespace.

Rejections are per-question in a batch; valid siblings still commit. This is
the mechanism that makes a 100-question `create_questions` call self-correcting
in one round trip instead of needing a retry loop — keep it exactly as-is.

---

## 7. Not implemented — what's missing and how to build each one

Done since the last revision of this doc: `get_question` (§7.1), `list_assets`
with `unlinked_only` (§7.2), the `possible_duplicates` cap + preview
truncation (§7.6), `response_text` truncation (§7.7), the upload size cap
(§7.8), and the url-asset anchor guard (§7.9) — all landed in
`domain/questions.ts`, `domain/results.ts`, `domain/assets.ts`, and
`mcp/tools.ts`, with test coverage in `tests/questions.test.ts`. What's left:

### 7.3 `readme` MCP tool
New domain function `domain/readme.ts`, static content plus one cheap COUNT
query for `bank_size`/`last_write_at` (reuse the same query `bootstrap`
already runs). Registered as a zero-argument tool. The content itself is
mostly copy-and-trim from `bootstrap.ts`'s current `conventions` block plus
the `desmos_allowed` paragraph currently duplicated on every
`create_questions`/`edit_question` call ([tools.ts:35-43] and
[tools.ts:196-204]) — moving it here and shrinking the inline param
description to one line is the same change, done once.

### 7.4 `graph_dsl_reference` field on `bootstrap`
Condense `graph-engine/src/parser/types.ts` lines 22-72 (the grammar comment)
into ~30-40 lines: one line per statement form, one line per `@key:`
directive, drop the implementation-detail asides (the "why 3-tuple vs 2-tuple"
kind of commentary belongs in the source, not in what Claude reads). Gate
inclusion on the resolved subject: a config table (`{top_level_slug: boolean}`
or a simple prefix allowlist — `["math", "physics", ...]`) rather than a
hardcoded string check, so it extends cleanly as tags grow. Lives in
`domain/bootstrap.ts` next to `conventions`.

### 7.5 Direct-upload endpoint for a sandboxed Claude
`POST /mcp/:token/upload` (same token gate, sibling to the MCP route, plain
multipart — `@fastify/multipart` is already registered at the app level).
Handler calls the same `createAsset(db, uploadsDir, {...})` domain function
`create_asset` uses, just fed from `request.file()` instead of a base64
JSON field — `createAsset` already enforces the 25MB cap added for the
base64 path, so multipart uploads get it for free. Should return the same
shape `create_asset` returns (`{id, title, type, extracted_text}`), small
JSON, so the calling shell
script has something to hand back to the model in one line. This is the
piece that makes "Claude curls a file in directly" actually reachable, since
`/api` is localhost-only per the deployment model and can't be hit from a
remote sandbox.

### 7.10 Batch-size / timeout guidance for `create_questions`
Not yet measured: how long a real 100-question `create_questions` call takes
end-to-end (per-question FTS duplicate check + individual transaction each,
`domain/questions.ts`), versus whatever timeout ceiling sits between a
claude.ai connector and a `trycloudflare.com` quick tunnel. If it's tight,
either the `readme` batching_guidance field caps recommended batch size
(~25-30, matching the table in §2), or the duplicate-check query gets
batched into one query across all incoming prompts instead of one FTS query
per question. Needs a timing test before deciding which.
