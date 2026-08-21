# Optimization Lab

Date: 2026-08-21

## Context

Two live stress tests measured Osmosis's MCP authoring token cost under different
calling mechanisms (native tool-calling vs. `scripts/mcp-batch`) and found the
gap wasn't primarily about *what* was being sent, but *how* — schema resend,
history accumulation, source-file reads. The natural next question: could an
AI, given the actual codebase and a live per-call cost signal, find further
optimizations itself — in the tool responses, the domain logic behind them, or
the batching mechanism — that weren't obvious from outside?

Testing that needs two things the real Osmosis product deliberately doesn't
have: **destructive freedom** (hard delete, not soft-retire, so the AI can
iterate on content without accumulating retired cruft) and **live per-call
cost feedback** (so it has a signal to optimize against at all). Neither
belongs in the real product. This spec is the infrastructure for a separate,
fully isolated sandbox where both exist.

This spec covers the **lab infrastructure only** — the isolated clone, the new
lab-only tools, the cost-feedback field. Actually running an experiment in it
(dispatching an agent with a self-optimization goal, evaluating what it
changed) is a follow-up action once the lab exists, not part of this build.

## Goals

- A fully isolated clone of the Osmosis repo the AI can edit, run, and break
  freely, with zero path back to the real project's code, data, or git
  history.
- Lab-only MCP tools (`delete_tag`, `delete_question`, `delete_template`) that
  hard-delete rather than soft-retire, added to the lab's `tools.ts` only —
  never proposed for or merged into the real product.
- Every MCP tool response carries an estimated token cost for *that response*
  — the half of the cost equation the server can actually measure (what the
  AI will pay as input on its next turn), clearly labeled as an estimate, not
  an exact count.
- The lab boots and behaves like a normal canonical Osmosis node otherwise —
  same migrations, same tool surface plus the three additions, same
  `scripts/mcp-batch` available inside it.

## Non-goals

- Not building or running the actual optimization experiment — this spec is
  the sandbox, not the experiment.
- Not solving the "output token" half of the cost signal (what the AI spent
  *generating* a call) — per the earlier discussion, that's only knowable
  client-side; the lab reports response-size only.
- Not adding hard-delete or cost-feedback to the real product. If the
  experiment surfaces a change worth keeping, that becomes its own separate
  proposal, reviewed and built the normal way — nothing in this lab merges
  back automatically.
- Not building any new safety/permission system beyond filesystem isolation.
  The lab is a full clone the AI can do anything to *within its own
  directory*; the directory boundary is the entire safety model.

## Design

### 1. The clone

A plain filesystem copy of the current repo state to a new, separate
directory — `C:\Users\benif\osmosis-lab\` — created via a straight recursive
copy (not `git clone`, not a worktree): the lab doesn't need git history, and
a copy guarantees zero shared object database or remote with the real repo.
`node_modules` is excluded from the copy (regenerated via `npm install` inside
the lab) to keep the copy fast and avoid dragging over anything
platform/path-specific.

After copying: `npm install` at the lab root, then `npm run build:lib` in
`graph-engine/` and `document-engine/` (same two-step this repo's own
onboarding requires), matching this session's own established setup sequence.

### 2. Lab-only hard-delete tools

Three new tools registered in the **lab's** `server/src/mcp/tools.ts` only
(this file is edited post-copy, inside the lab — never touched in the real
repo):

```ts
server.registerTool(
  "delete_tag",
  {
    description: "LAB ONLY — permanently deletes a tag row. Fails if the tag has children or is referenced by any question (FK RESTRICT) — clean those up first. Unlike retire_question/merge_tags in the real product, this is unrecoverable.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    try {
      db.prepare("DELETE FROM tag WHERE slug = ?").run(slug);
      return ok({ deleted_slug: slug });
    } catch (err) {
      return fail(err);
    }
  }
);
```

```ts
server.registerTool(
  "delete_question",
  {
    description: "LAB ONLY — permanently deletes a question row (a single version, not the whole lineage). Unlike retire_question in the real product, this is unrecoverable.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      db.prepare("DELETE FROM question WHERE id = ?").run(id);
      return ok({ deleted_id: id });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "delete_template",
  {
    description: "LAB ONLY — permanently deletes a template row. Unlike retire_template in the real product, this is unrecoverable.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      db.prepare("DELETE FROM template WHERE id = ?").run(id);
      return ok({ deleted_id: id });
    } catch (err) {
      return fail(err);
    }
  }
);
```

All three are a bare parameterized `DELETE`, letting real FK constraints
(`ON DELETE RESTRICT` where the schema has them — e.g. `tag.parent_slug`,
`question_tag.tag_slug`) surface as a normal `fail()`-wrapped SQLite error
rather than being silently worked around. This is deliberate: the AI
experimenting in the lab should see the schema's actual constraints, not a
sandboxed illusion where anything goes with zero consequence.

No test suite coverage is required for these three tools — they're
intentionally not part of the real product's tested surface, and the lab
itself is the disposable testing ground.

### 3. Per-call token-cost estimate

Modify the lab's `ok()`/`fail()` helpers (`server/src/mcp/tools.ts`) to embed
an estimate of the response payload's own size:

```ts
function withCostEstimate(payload: unknown): unknown {
  const text = JSON.stringify(payload);
  return { ...(payload as Record<string, unknown>), _response_tokens_estimate: Math.ceil(text.length / 4) };
}

function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(withCostEstimate(result)) }] };
}

function fail(err: unknown) {
  const errorPayload =
    err instanceof DomainError
      ? { error: err.code, message: err.message }
      : { error: "internal_error", message: err instanceof Error ? err.message : String(err) };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(withCostEstimate(errorPayload)) }] };
}
```

`chars / 4` is the standard rough token-estimation heuristic (not exact —
Claude's real tokenizer isn't public) and is explicitly labeled as such via
the field name (`_..._estimate`, not `_..._tokens`). It runs server-side,
inside `ok()`/`fail()`, before the response ever leaves the server — so it
measures the **raw, untrimmed** MCP response, not whatever a client
happens to do with it afterward. This matters: `scripts/mcp-batch`'s
`summarize()` (if the AI calls tools through it) trims for *display* only,
client-side, after the full response has already been received over HTTP —
it doesn't change what was transmitted or what this field reports. If the
AI calls tools natively instead, the raw payload this field measures *is*
exactly what it receives as input. Either way, the estimate reflects the
real cost of the underlying tool response, not however a batching layer
chooses to present it — which is the more useful signal for an AI trying
to find inefficiencies in the tool responses themselves, not just in how
they're displayed.

The `payload as Record<string, unknown>` spread assumes every tool response
is a plain object — true for all 21 real tools plus the 3 new lab tools today
(checked against every `ok(...)` call site in `tools.ts`); if a future tool
ever returned a bare array or primitive, this would need adjusting, but
that's not a case that exists in the current tool surface.

### 4. Verifying the lab boots

After the copy + tool additions, boot the lab exactly like any other
Osmosis instance (fresh `.env` file, `NODE_ROLE=canonical`, a generated
`MCP_AUTH_TOKEN`, a throwaway `DB_PATH`) and confirm with a real call:
`readme()` should return successfully with the new
`_response_tokens_estimate` field present, and a `create_tag` +
`delete_tag` round trip should leave `list_tags` showing the tag gone.

## Testing

This is an infrastructure setup, not new product code with its own unit-test
surface — there's no CI/automated test suite for "does a separate cloned
directory exist and boot." Verification is the real round-trip check in
§4 above: boot the lab, call `readme()`, confirm the estimate field, create
and hard-delete a tag, confirm it's actually gone via `list_tags`. If any of
that fails, the lab isn't ready to hand off for an actual experiment.
