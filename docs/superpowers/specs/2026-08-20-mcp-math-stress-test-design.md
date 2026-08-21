# MCP Content-Authoring Stress Test (Math)

Date: 2026-08-20

## Context

`MCP-SPEC.md` documents a fully-built, 21-tool MCP authoring surface
(`readme`, `bootstrap`, tag/question/template/asset/config tools) meant for
a hosted claude.ai connector session with no shell of its own. It has never
been exercised by an actual cold-start client — every prior test is a unit
test calling the domain functions directly, and `MCP-SPEC.md` §8.1 already
flags one open question ("is 25-30 questions per batch actually right?")
that was only ever answered by a synthetic timing benchmark, not a live
authoring session.

Separately, the database has no content in it — no `.db` file exists in
this repo at all yet. Two needs meet: exercise the tool surface the way a
real remote client would, and get math content into the bank as a byproduct.

This is explicitly local-only. No cloudflared tunnel, no sync partner, no
`DEEPSEEK_API_KEY` — nothing here ships to any remote host or the user's
production server.

## Goals

- Boot a throwaway canonical node and register its `/mcp/:token` endpoint
  as a real MCP connection for this Claude Code session, so the 21 tools
  appear as genuine `mcp__osmosis-mathstress__*` tools — not a hand-rolled
  curl script — giving the truest signal on schema/naming/description
  friction.
- Dispatch a subagent whose tool access is *restricted to exactly those
  MCP tools* (no Bash, Read, Grep, Write, etc.), so it has to learn
  conventions and taxonomy the way a real cold-start connector session
  does — via `readme()`/`bootstrap()`, never by reading source.
- That subagent authors a math tag taxonomy and ~150-200 questions
  (mixed MC/written, real difficulty spread) plus 1-2 templates, using its
  own domain judgment for topic breakdown and question content.
- The subagent produces a written friction report: confusing tool
  descriptions, validation errors it hit and why, redundant round-trips,
  and concrete suggestions — live evidence for `MCP-SPEC.md` §8's open
  questions.
- End state: a populated `data/mathstress.db` at the repo root (gitignored,
  already covered by `data/*.db`) the user can inspect via the web UI, or
  discard.

## Non-goals

- No cloudflared tunnel, no sync/push to any other node, no real
  `DEEPSEEK_API_KEY` — nothing leaves `localhost`.
- No changes to the MCP tool implementations themselves in this pass —
  the friction report is a *finding*, not an immediate fix. Any resulting
  tool changes are a separate follow-up the user can choose to act on.
- No attempt to make the generated content exhaustive or curriculum-complete
  — "broad strokes," per the original ask, not a finished math course.
- Not a substitute for real usage/telemetry — this is one cold-start
  session's experience, not a statistically representative sample.

## Design

### 1. Environment

A new `server/.env.mathstress` (gitignored via the existing `.env.*`
pattern) with:

```
NODE_ROLE=canonical
NODE_LABEL=mathstress
PORT=4177
DB_PATH=../data/mathstress.db
UPLOADS_DIR=../data/mathstress-uploads
MCP_AUTH_TOKEN=<freshly generated random hex string>
```

`UPLOADS_DIR` is set explicitly (rather than left to its
`dirname(DB_PATH)/uploads` default) so any asset the subagent creates
lands in its own throwaway folder, not the repo's existing
`data/uploads/` — which already holds a real, unrelated file
(`junior_year_schedule_2026_2027[1].pdf`) that this exercise has no
reason to sit next to.

`DB_PATH` is relative to `server/` (where the process runs), so
`../data/mathstress.db` resolves to the repo-root `data/` directory —
already gitignored (`data/*.db`) and already home to the one existing
upload asset, unlike a `server/data/` directory, which the root
`.gitignore`'s `data/*.db` pattern does *not* cover (it's anchored to the
repo root, not matched at every depth). No `REMOTE_URL`, no
`DEEPSEEK_API_KEY`. Started via
`npx tsx --env-file=.env.mathstress src/index.ts` in the background
(`data/mathstress.db` doesn't exist yet, so `migrate()` creates the
schema fresh on first boot — no risk to any existing data, since none
exists in this repo today). Port 4177 chosen arbitrarily to avoid
colliding with the web dev server (5173-5175 range) or other running
instances; if occupied, pick the next free port and update `.mcp.json`
to match.

### 2. MCP registration

Add an entry to this session's `.mcp.json` (project-scoped, created if it
doesn't exist):

```json
{
  "mcpServers": {
    "osmosis-mathstress": {
      "type": "http",
      "url": "http://localhost:4177/mcp/<token>"
    }
  }
}
```

matching the server's `StreamableHTTPServerTransport` (stateless mode,
`server/src/mcp/server.ts`). Once connected, the 21 tools are discoverable
as `mcp__osmosis-mathstress__*`. This file is transient scaffolding for
the exercise — removed at cleanup (see §6) rather than left as permanent
project config, since it points at a throwaway local server and a
one-time token.

### 3. The subagent

A new one-off agent definition, `.claude/agents/osmosis-author.md`, with
frontmatter granting *only* the `mcp__osmosis-mathstress__*` tool
namespace — no Bash, Read, Grep, Write, Glob, or Agent. This is the actual
enforcement mechanism for "cold-start, tools-only" — none of the built-in
agent types (`general-purpose`, `claude`, `Explore`) restrict tool access
narrowly enough, and giving it Read/Grep would let it shortcut past
`readme()`/`bootstrap()` by reading `MCP-SPEC.md` or the domain source
directly, defeating the point of the exercise.

Dispatched on a standard-tier model (sonnet) — authoring real, correct
math content (valid answers, plausible MC distractors, well-formed
`graph_spec` where used) needs domain judgment a cheap model would get
wrong often enough to undermine the content half of the goal.

The dispatch brief tells the subagent: call `readme()` then
`bootstrap("math")` first, per the tools' own documented workflow; build a
tag taxonomy under `math` (its own judgment on subtopic breakdown —
algebra, geometry, trigonometry, calculus, statistics are likely
candidates but not mandated); author ~150-200 questions across it, mixed
MC/written, spanning the difficulty scale, batched through
`create_questions` at roughly the tool's own suggested batch size; create
1-2 templates; and write a friction report (§4) to a specified file path
at the end. It is explicitly told this is a stress test of the tools
themselves, not just a content-generation task — friction, confusion, and
anything requiring a second read of a tool description are worth noting
as they happen, not reconstructed from memory afterward.

### 4. Friction report

Written by the subagent to
`docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md` (a
findings doc, not a design doc — sibling location, different purpose).
Structure: what was confusing on first encounter, any tool call that
returned a validation error and why, tool descriptions that needed
re-reading or were misread once, redundant round-trips it noticed, and
concrete suggestions for tightening schemas/descriptions/batching
guidance. This becomes live evidence for `MCP-SPEC.md` §8's existing open
questions rather than a freestanding critique.

### 5. Execution flow

1. Generate token, write `.env.mathstress`.
2. Start the canonical server in the background; confirm it's listening
   via `GET /sync/health` (canonical-only, no token required — a cheap
   liveness check distinct from the token-gated `/mcp` surface itself).
3. Write `.mcp.json`, reconnect MCP servers so the tools become available
   in this session.
4. Write `.claude/agents/osmosis-author.md`.
5. Dispatch the subagent with its brief (foreground or background —
   controller's call at execution time based on expected run length).
6. On completion, read back the friction report and a content summary
   (tag/question/template counts) via the now-connected MCP tools or a
   direct `GET /api/...` check, and relay both to the user.

### 6. Cleanup

At the end of the run: stop the background server process. Leave
`data/mathstress.db` in place (gitignored) so the user can start
the server again later and browse the content via the web UI if they
want it; removing it is the user's call, not automatic. Remove the
`.mcp.json` entry and `.claude/agents/osmosis-author.md` — both were
scaffolding for this one exercise, not permanent project fixtures.

## Testing

Nothing here touches the server/web/graph-engine/document-engine source
in a way that needs new automated tests — this is an operational exercise
against already-shipped, already-tested tool implementations. Verification
is: the server starts cleanly, the MCP tools are reachable and produce a
non-error `readme()`/`bootstrap()` response, and the final content counts
in the database roughly match the ~150-200 question / 1-2 template target.
If the friction report surfaces a genuine tool bug (not just an ergonomics
complaint), that becomes a separate follow-up item with its own test
coverage — not fixed inline during this exercise.
