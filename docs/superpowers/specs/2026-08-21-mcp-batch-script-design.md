# MCP Batch Script

Date: 2026-08-21

## Context

The two MCP content-authoring stress tests (`2026-08-20-mcp-stress-test-findings.md`,
`-v2.md`) measured a real cost gap between two ways of driving the same MCP
tool surface with the same Claude model:

- **v1**, curl-driven from an isolated subagent: 184 questions authored for
  129,980 total tokens (input+output combined) — roughly 700 tokens/question.
- **v2**, native Claude tool-calling in a long-lived session: ~90,000 *input*
  tokens alone per 100 questions — roughly 900+ tokens/question before output
  is even counted.

The gap isn't about content quality or which model authors the text — both
runs used the same model and produced comparably good content. It's
architectural, and `MCP-SPEC.md` §3 already documents the root cause: all 21
tool schemas resend on every turn a connector is enabled for, regardless of
whether that turn calls a tool, and a native chat session's conversation
history — every prior batch's full call and response — keeps accumulating
and gets resent as input on every later turn. Neither cost has anything to
do with who's composing the question text; both are purely a function of
driving a long turn-by-turn native tool-calling loop.

A separate proposal (offloading question *generation* to DeepSeek, with
Claude fact-checking the output) was considered and explicitly deferred —
it optimizes a different axis (which model authors content) and doesn't
touch either of the two costs identified above. It may be worth revisiting
later, scoped as a verification layer rather than a generation swap; not
part of this spec.

## Goals

- A reusable script that drives the MCP tool surface without native
  tool-calling's per-turn schema resend or accumulating-history cost.
- Claude's job shrinks to: compose the call content as JSON, run the
  script, read a short summary — no hand-written curl, no SSE-frame/`data:`
  line parsing, no reading back a full response that echoes content Claude
  itself just sent (e.g. `create_questions`'s per-item `prompt_preview`).
- General enough to drive any of the 21 tools, not just `create_questions`
  — a thin JSON-RPC client, not a question-specific batcher.

## Non-goals

- No DeepSeek/generation offloading — explicitly deferred, see Context.
- No new server-side endpoint. The script talks to the exact same
  `/mcp/:token` JSON-RPC surface a real connector session would, so
  validation (`validateQuestionInput`, slug grammar, etc.) stays identical.
- No retry/backoff, no parallelism, no job queue. Sequential and simple.
- **Not a replacement for native tool-calling in general.** For a small,
  one-off session (a handful of questions, one or two `create_questions`
  calls), native tool-calling is the better choice — the per-turn schema
  resend and history accumulation barely matter at that scale, and
  composing a JSON file plus shelling out is more steps than just calling
  the tool directly. This script exists for the case that actually costs
  real tokens today: multiple sequential batches or 50+ items authored in
  one sitting. It's opt-in, not a default authoring path.

## Design

### Location

A new workspace, `scripts/mcp-batch/` (added to the root `package.json`'s
`workspaces` array alongside `server`/`web`/`graph-engine`/`document-engine`)
— its own `package.json` with `vitest` as a dev dependency and a `test`
script, matching this repo's existing per-workspace convention. It's a
standalone MCP client, not part of the server runtime, so it doesn't belong
inside `server/`.

Files:
- `scripts/mcp-batch/package.json` — `{name: "mcp-batch", private: true, type: "module", scripts: {test: "vitest run"}, devDependencies: {vitest: "^3.0.0"}}` (version pinned to match the root's existing vitest version).
- `scripts/mcp-batch/cli.mjs` — entry point: argv parsing, reads the input file, calls `runBatch`, prints output, sets exit code.
- `scripts/mcp-batch/lib.mjs` — the testable core: `parseMcpResponse` (SSE-frame stripping + JSON parse), `callTool` (one JSON-RPC `tools/call` POST), `summarize` (per-tool-name response formatting), `runBatch` (sequential execution + continue-on-error + overall exit status).
- `scripts/mcp-batch/lib.test.ts` — vitest tests against `lib.mjs`, mocked `fetch`.

### Interface

- Config: `OSMOSIS_MCP_URL` env var — the full `http://host:port/mcp/<token>` URL (same shape already used in `.mcp.json`). `--url <value>` flag overrides it for a one-off invocation.
- Input: a required positional file path argument, a JSON file containing an array of `{name: string, arguments: object}` — the exact shape `tools/call`'s `params` already expects, so Claude composing this JSON is composing the real protocol payload, one thin wrapping layer removed.
- Invocation: `node scripts/mcp-batch/cli.mjs calls.json`.
- `--raw` flag: forces full JSON passthrough for every call in the batch, overriding the default summarization (see below).

### Behavior

`runBatch` iterates the call array in order, synchronously (each call awaited before the next starts — no concurrency). For each call:

1. POST the JSON-RPC envelope (`{jsonrpc: "2.0", id: <incrementing>, method: "tools/call", params: {name, arguments}}`) to the configured URL, with a 30-second timeout (`AbortSignal.timeout(30000)`, matching the pattern already used in `server/src/sync/client.ts` and `server/src/domain/modelGrading.ts`).
2. Parse the SSE-framed response (`event: message\ndata: {...}`) back to plain JSON.
3. If the HTTP request itself fails (network error, timeout) or the parsed response's `result.isError` is true, log the error clearly (including which call index and tool name failed) and continue to the next call — never abort the batch over one bad call, matching `create_questions`'s own per-item error isolation.
4. Otherwise, print the call's summary (see below).

After all calls complete, the process exits with code `0` if every call succeeded, `1` if any failed — so a caller (Claude, or anything else) can detect failure without parsing printed text.

### Response summarization

Default (no `--raw`): a compact, tool-specific summary, not the raw response —

- `create_questions` → counts (`created: N, rejected: N, warnings: N, possible_duplicates: N`), plus the **full content** of any non-empty `rejected`/`warnings`/`possible_duplicates` arrays (those need a human/Claude's attention), but never the `created` array's per-item `prompt_preview` echoes — that's pure restated content, the single biggest source of wasted read-back tokens in the v1/v2 transcripts.
- `create_tag` → one line: success + the created `slug` (tags have no separate id; slug is the identifier).
- `create_template` / `edit_template` → one line: `id`, `eligible_count`, `short` (both share this response shape — `eligible_count`/`short` are worth surfacing since a near-zero eligible count is exactly the kind of thing an author needs to notice immediately, on creation or after an edit).
- `edit_question` → one line: `id`, `versioned` (whether the edit created a new version or applied in place — real, worth-noticing information, per `EditQuestionResult`'s actual shape).
- `retire_template` / `retire_question` → one line: success + the affected `id`.
- `set_config` → one line: `key = value` (its real response shape is `{key, value, updated_at}`; `updated_at` isn't worth echoing).
- `merge_tags` → one line: `from_slug -> to_slug, N questions repointed` (its real response shape is `{from_slug, to_slug, retired_at, questions_updated}` — no per-question detail worth echoing).
- `list_tags` / `list_templates` / `list_assets` / `search_questions` / `search_assets` / `get_question` / `get_results` / `get_config` / `read_asset` / `readme` / `bootstrap` / `create_asset` → full passthrough. These are read/informational calls (or, for `create_asset`, a call whose response — `extracted_text` — is itself the thing a caller most likely needs next, e.g. to compute anchor offsets); trimming them would remove the actual payload the caller wanted.

A tool name not in this list (future tool additions) falls back to full passthrough — safer default than silently dropping unrecognized content.

### Testing

`lib.test.ts`, vitest, mocked `fetch` (same style as `server/tests/modelGrading.test.ts`'s `gradeWithDeepSeek` tests):

- `parseMcpResponse` correctly strips SSE framing and parses the inner JSON, for both a success and an `isError: true` response.
- `summarize` produces the documented compact form for `create_questions` (including the "never echo `prompt_preview`, always echo `rejected`/`warnings`/`possible_duplicates`" rule) and for a couple of the other summarized tool names, and full passthrough for both a read-tool name and an unrecognized tool name.
- `runBatch` continues past a failed call (mocked to reject or return `isError: true` on call 2 of 3) and still executes call 3, and the overall result reflects the failure (for the CLI's exit-code decision).
- `runBatch` executes calls strictly in order (mocked `fetch` records call sequence).

### Documentation

A short usage note added to `MCP-SPEC.md` (a new subsection, not a new
top-level doc) covering: what this is, the token-cost evidence from the two
stress tests, and the explicit "opt-in for big sessions, not a default"
guidance from this spec's Non-goals — so a future reader of `MCP-SPEC.md`
sees both authoring paths (native tool-calling, and this script) and when
each applies, in one place.
