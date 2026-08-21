# Document Builder Reference

A complete reference for assets and document anchoring — how source material
gets into the bank, and how a question points back at a specific piece of it.
Smaller surface than the graph DSL (see `GRAPH-DSL-REFERENCE.md`), but with
real sharp edges worth documenting properly.

Source of truth is `server/src/domain/assets.ts`, `server/src/lib/extract/`,
`server/src/domain/questions.ts` (the `document_*` validation in
`validateQuestionInput`), and `document-engine/src/core/findTokenSpan.ts`.

## What an asset is

An asset is one piece of source material — a URL, some raw text, or an
uploaded file — that a question can cite via `document_id`, optionally
pointing at a specific excerpt (`document_anchor_start`/`document_anchor_end`)
or a single inline marker (`document_marker_offset`). Assets exist
independently of questions; `list_assets(unlinked_only: true)` finds ones
nothing currently references.

Every asset has:
- `title` — required, human-readable.
- `type` — `"url" | "text" | "file"`, fixed at creation.
- `content` — for `text`, the raw text itself; for `url`, the URL string;
  `null` for `file` (the bytes live on disk, see below).
- `extracted_text` — what anchoring actually operates against (see next
  section). Can be `null`.
- `created_by` — `"claude" | "human"`, set explicitly by which path created
  the asset (`createAsset`'s `createdBy` parameter, `server/src/domain/assets.ts`):
  `POST /api/assets` (human web upload) passes `'human'`; `create_asset` and
  `POST /mcp/:token/upload` (both Claude-facing) pass `'claude'`. The column
  still defaults to `'claude'` at the schema level for any row that
  predates this being threaded through, but every current write path sets
  it explicitly now.

## Text extraction — what `extracted_text` actually contains, per type

| Type | `extracted_text` |
|---|---|
| `text` | The `content` you provided, verbatim — but `content` itself is optional in `create_asset`'s schema and unenforced for `type: "text"`; omit it and `extracted_text` is `null`, not empty text. |
| `file`, PDF (`mime: application/pdf`) | Extracted via `graph-engine`'s sibling `document-engine` package's PDF text layer. |
| `file`, image (`mime: image/*`) | Extracted via a DeepSeek vision-model call (`extractImageViaDeepSeek`, `server/src/lib/extract/image.ts`) — the one extraction path that costs a real API call. **Throws** (fails the whole `createAsset` call, doesn't just skip extraction) if `DEEPSEEK_API_KEY` isn't set. The vision model name used (`deepseek-vl`) is flagged in that file's own comment as an unverified placeholder — "double-check against DeepSeek's docs before relying on this in production." |
| `file`, `text/markdown` or `text/plain` | Read from disk verbatim. |
| `file`, any other mime | `null` — nothing extracted. |
| `url` | **Always `null`, unconditionally, by design** — see "The url caveat" below. |

Anchoring (`document_anchor_*`, `document_marker_offset`) only works against
a non-null `extracted_text`. A `null`-extraction asset can still be created
and cited by `document_id` for context/provenance, it just can't be anchored
into.

### The `url` caveat

`type: "url"` assets never get server-side text extraction — `extractText`
returns `null` unconditionally for them, deliberately, to avoid building an
SSRF surface (fetching arbitrary user-supplied URLs server-side). This means
a `url` asset is currently **inert for anchoring purposes**: you can
register one as a citation, but you can never point a question at a specific
span of it. `create_questions`/`edit_question` reject outright
(`invalid_document_anchor`) if you try. If you need to anchor into a web
page's actual content, fetch/read it yourself and register it as a `type:
"text"` asset with the real text as `content` instead.

## Three ways to create an asset

Pick per situation — these aren't interchangeable, they exist for different
environments:

1. **Human uploads via the web UI.** `POST /api/assets` (multipart,
   `server/src/http/apiRoutes.ts`) — the right path for anything the user
   already has as a file on their own machine. Zero MCP tool involvement,
   zero token cost.
2. **Claude authors text directly.** `create_asset(type: "text")` — Claude
   writing its own source notes/excerpts. Content is small by construction,
   so the normal tool-call path is fine.
3. **Claude's own sandbox has the file's bytes** (Code Execution enabled
   alongside an MCP connector, or Claude Code with shell access).
   `POST /mcp/:token/upload` — a plain multipart route, sibling to the
   JSON-RPC `/mcp/:token` endpoint and gated by the same token. A
   `curl -F file=@doc.pdf` sends the bytes disk-to-disk over HTTP; only the
   small JSON result (`{id, title, type, extracted_text}`) ever enters the
   model's context. This exists specifically because `/api` is
   localhost-only per the deployment model and unreachable from a remote
   sandbox, while `/mcp` is the one surface a deployed instance actually
   exposes publicly.

`create_asset(type: "file", content: <base64>)` is the **fallback** for a
plain connector session with no shell at all — the only remaining way such a
session can get file bytes in. It's not the first choice when a shell is
available: base64-through-a-tool-call costs roughly 4/3 of the file's raw
byte size in characters, so a multi-MB PDF becomes hundreds of thousands of
tokens through this path versus near-zero through path 3. All file uploads
(this path and path 3 alike) are capped at 25MB.

## Anchoring a question to an asset

Three independent fields, usable separately or together:

- **`document_id`** — the asset being referenced. Required for either of the
  two anchor mechanisms below; on its own (no anchor/marker), it's just a
  citation with no visual highlight.
- **`document_anchor_start` / `document_anchor_end`** — highlights a whole
  excerpt range in the asset's `extracted_text`. Both required together
  (setting one without the other is `invalid_document_anchor`). Bounds
  checked: `start >= 0`, `start <= end`, `end <= extracted_text.length`.
  `document_anchor_label` is an optional free-text label for the highlighted
  range.
- **`document_marker_offset`** — places one inline, clickable marker at a
  single character offset — e.g. the `"(A)"` or `"12."` in an
  ACT-English-style passage that a specific question is about. Clicking the
  rendered marker jumps the test-taker to that question. Requires
  `document_id`. The offset must land on an actual token, not mid-whitespace
  — validated (and rendered) via `document-engine`'s `findTokenSpan`, which
  expands a raw offset out to the punctuation-inclusive token it sits inside
  (so an offset pointing at the `"A"` in `"(A)"` correctly resolves to the
  full `"(A)"` span, not just the bare letter). An offset that lands in
  whitespace, or past the end of the text, fails validation
  (`invalid_document_marker`).

`document_anchor_*` and `document_marker_offset` are independent — a
question can use one, the other, both, or neither. Both require a
`document_id` whose asset actually has `extracted_text` (see the type table
above); pointing either at a `url` asset is rejected outright.

## Finding an existing asset before citing it

- **`list_assets(unlinked_only?)`** — cheap listing, no query needed.
  `unlinked_only: true` filters to assets no question currently references.
- **`search_assets(query, type?)`** — full-text search over titles and
  extracted text, returns snippets (not full content) — cheap enough to call
  speculatively before authoring a batch of anchored questions.
- **`read_asset(id)`** — the only call *in this trio* that returns an
  asset's full `extracted_text` (`create_asset`'s own response also includes
  it in full, at creation time). Call `read_asset` before computing anchor
  offsets on an asset you didn't just create yourself — don't guess offsets
  from a search snippet, compute them against the real text.

## Where the source of truth lives

- Asset domain logic (creation, listing, search, deletion): `server/src/domain/assets.ts`
- Text extraction per type: `server/src/lib/extract/index.ts`, `pdf.ts`, `image.ts`
- Document-anchor validation: `server/src/domain/questions.ts`'s `validateQuestionInput`
- Token-span boundary rule: `document-engine/src/core/findTokenSpan.ts`
- The two non-tool-call upload paths: `server/src/http/apiRoutes.ts` (`POST /api/assets`), `server/src/mcp/server.ts` (`POST /mcp/:token/upload`)
- Full MCP-surface context (auth, the SSRF tradeoff, size caps): `MCP-SPEC.md` §5, §6, §8.2
