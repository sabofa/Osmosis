# MCP Content-Authoring Stress Test (Math) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — see rationale below) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boot a throwaway local canonical node, register its MCP tool surface as a real connection, and dispatch a tool-restricted subagent to author ~150-200 math questions through it — producing both populated content and a friction report on the tools themselves, per `docs/superpowers/specs/2026-08-20-mcp-math-stress-test-design.md`.

**Architecture:** Env-config + background server process (existing `server/src/index.ts`, no code changes) → `.mcp.json` registration of its `/mcp/:token` endpoint → a one-off restricted-tool agent definition (`.claude/agents/osmosis-author.md`) → a single subagent dispatch that authors content and returns a friction report as its final message → controller captures that report to a findings doc and cleans up scaffolding.

**Tech Stack:** Existing Fastify/`node:sqlite`/MCP SDK server (`server/`), no new dependencies, no code changes to `server/`/`web/`/`graph-engine`/`document-engine` — this plan only adds transient env/config/agent-definition files plus one findings doc.

**Note on execution mode:** most tasks here are single controller actions (write a file, start a process, verify a response) rather than independent developer work with its own test cycle — the one task that needs a fresh subagent (Task 4) *is* the point of the exercise, not one of several peer tasks. `executing-plans` (inline, batch-with-checkpoints) fits this shape better than the full per-task-review ceremony of `subagent-driven-development`, which is built for several independently-reviewable developer tasks. This plan's self-review section still requires care per Task 4's brief and Task 5's verification.

## Global Constraints

- Local-only: no cloudflared tunnel, no `REMOTE_URL`/sync partner, no `DEEPSEEK_API_KEY`. Nothing leaves `localhost`.
- No changes to `server/`, `web/`, `graph-engine/`, or `document-engine/` source in this plan — the tool surface is exercised as-is, findings become a *future* follow-up.
- `DB_PATH` must resolve under the repo-root `data/` directory (already gitignored via `data/*.db`) — not `server/data/`, which the root `.gitignore`'s `data/*.db` pattern does not cover.
- The authoring subagent's tool access is restricted to exactly the `mcp__osmosis-mathstress__*` namespace — no Bash, Read, Grep, Write, Glob, or Agent — so it has to learn conventions via `readme()`/`bootstrap()` like a real cold-start connector session, not by reading source.
- Target content: ~150-200 questions, mixed MC/written, real difficulty spread, spanning a math tag taxonomy the subagent designs itself; 1-2 templates.
- Scaffolding created for this exercise (`.mcp.json` entry, `.claude/agents/osmosis-author.md`, `server/.env.mathstress`) is removed at the end (Task 6); the populated `data/mathstress.db` is left for the user to keep or discard.

---

### Task 1: Environment and server boot

**Files:**
- Create: `server/.env.mathstress`
- No source changes — uses existing `server/src/index.ts`, `server/src/env.ts`, `server/src/db/migrate.ts`

**Interfaces:**
- Consumes: nothing new — existing `loadEnvConfig()`/`openDb()`/`migrate()`/`buildApp()` flow.
- Produces (used by Task 2): a running canonical server on `http://localhost:<PORT>`, with `/mcp/:token` reachable at the token from this task's env file.

- [ ] **Step 1: Generate a random MCP auth token**

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Save the printed hex string — it's used in both this task's env file and Task 2's `.mcp.json` URL. Call it `<TOKEN>` below.

- [ ] **Step 2: Write the env file**

`server/.env.mathstress` (already covered by the repo's `.env.*` gitignore pattern):

```
NODE_ROLE=canonical
NODE_LABEL=mathstress
PORT=4177
DB_PATH=../data/mathstress.db
UPLOADS_DIR=../data/mathstress-uploads
MCP_AUTH_TOKEN=<TOKEN>
```

Substitute the real token from Step 1 for `<TOKEN>`. `DB_PATH`/`UPLOADS_DIR` are relative to `server/` (where the process runs) and resolve to the repo-root `data/` directory. If port 4177 is already in use (check with the Step 3 boot attempt), pick another port here and carry the change into Task 2's `.mcp.json`.

- [ ] **Step 3: Start the server in the background**

```bash
cd server && npx tsx --env-file=.env.mathstress src/index.ts
```

Run this with the background-execution option (`run_in_background: true` on the Bash tool) — it's a long-lived process, not a one-shot command. Capture its startup log line (`Applied migrations: ...` and `Node <id> (mathstress), role=canonical`) to confirm it booted and the schema migrated cleanly against the fresh `data/mathstress.db`.

- [ ] **Step 4: Verify liveness**

```bash
curl -s http://localhost:4177/sync/health
```

Expected: a JSON body with `protocol_version` and `node_id` fields (this route is canonical-only but unauthenticated by token — a cheap liveness check distinct from the token-gated `/mcp` surface). If this fails (connection refused), check the background process's output for a startup error (most likely: port already in use, or a missing/malformed env var) before proceeding.

---

### Task 2: MCP registration and connection sanity check

**Files:**
- Create/modify: `.mcp.json` (repo root)

**Interfaces:**
- Consumes: `<PORT>` and `<TOKEN>` from Task 1.
- Produces (used by Task 3 and 4): the 21 tools available in this session as `mcp__osmosis-mathstress__*`.

- [ ] **Step 1: Write or extend `.mcp.json`**

If `.mcp.json` doesn't exist at the repo root, create it. If it exists, add this entry to its `mcpServers` object without disturbing any other entries already there:

```json
{
  "mcpServers": {
    "osmosis-mathstress": {
      "type": "http",
      "url": "http://localhost:4177/mcp/<TOKEN>"
    }
  }
}
```

Substitute the real port/token from Task 1.

- [ ] **Step 2: Reconnect MCP servers so the new tools are discoverable**

However this session's harness picks up a new `.mcp.json` entry (a reconnect action, or it's picked up automatically) — confirm the `mcp__osmosis-mathstress__*` tools are now listed as available (deferred or direct) before moving on. If they don't appear, double check the URL (host/port/token) matches Task 1 exactly and that the server is still running (`curl /sync/health` again).

- [ ] **Step 3: Sanity-check the connection with a real call**

Call `mcp__osmosis-mathstress__readme` yourself (the controller, not the subagent yet) and confirm it returns a non-error JSON body with `node.bank_size` (expect `0` — nothing authored yet), `workflow`, and the convention fields described in `MCP-SPEC.md` §2. This confirms the transport and auth work end-to-end before handing the connection to a subagent that can't debug connection failures itself (it has no Bash/curl access).

---

### Task 3: The restricted-tool agent definition

**Files:**
- Create: `.claude/agents/osmosis-author.md`

**Interfaces:**
- Consumes: nothing — this is a static agent definition file.
- Produces (used by Task 4): an agent type (`osmosis-author`) dispatchable via the `Agent` tool, whose tool access is exactly the 21 `mcp__osmosis-mathstress__*` tools.

- [ ] **Step 1: Write the agent definition**

`.claude/agents/osmosis-author.md`:

```markdown
---
name: osmosis-author
description: One-off content-authoring agent restricted to the Osmosis MCP tool surface, for the 2026-08-20 math content stress test. Not for general use.
tools: mcp__osmosis-mathstress__readme, mcp__osmosis-mathstress__bootstrap, mcp__osmosis-mathstress__list_tags, mcp__osmosis-mathstress__create_tag, mcp__osmosis-mathstress__merge_tags, mcp__osmosis-mathstress__search_questions, mcp__osmosis-mathstress__get_question, mcp__osmosis-mathstress__create_questions, mcp__osmosis-mathstress__edit_question, mcp__osmosis-mathstress__retire_question, mcp__osmosis-mathstress__list_templates, mcp__osmosis-mathstress__create_template, mcp__osmosis-mathstress__edit_template, mcp__osmosis-mathstress__retire_template, mcp__osmosis-mathstress__get_results, mcp__osmosis-mathstress__get_config, mcp__osmosis-mathstress__set_config, mcp__osmosis-mathstress__create_asset, mcp__osmosis-mathstress__list_assets, mcp__osmosis-mathstress__read_asset, mcp__osmosis-mathstress__search_assets
model: sonnet
---

You are authoring math content for the Osmosis question bank through its
MCP tool surface. You have no filesystem, shell, or web access — only the
21 tools listed above. This is deliberate: you're standing in for a real
cold-start claude.ai connector session that has no access to this
project's source code or docs, only what the tools themselves tell you.

Learn everything about conventions, taxonomy, and workflow from the tools
themselves — call `readme` first, then `bootstrap` for the subject you're
given. Do not assume you know the schema or conventions in advance; if a
tool call is rejected, read the error and adjust.
```

- [ ] **Step 2: Confirm the file is syntactically valid**

There's no automated check for this (agent definitions are read at dispatch time) — visually confirm the frontmatter is valid YAML (correct `---` delimiters, `tools:` is a single comma-separated line) and that every tool name matches Task 2's confirmed `mcp__osmosis-mathstress__*` prefix exactly.

---

### Task 4: Dispatch the authoring subagent

**Files:** None created directly by this task — this is a subagent dispatch. The subagent's tool calls write to `data/mathstress.db` via the running server (Task 1).

**Interfaces:**
- Consumes: the `osmosis-author` agent type (Task 3), the live MCP connection (Task 2).
- Produces (used by Task 5): a populated database, and a friction report returned as the subagent's final message text (not written to a file by the subagent itself — it has no Write tool by design; the controller captures and saves it in Task 5).

- [ ] **Step 1: Dispatch**

Use the `Agent` tool with `subagent_type: "osmosis-author"`. The dispatch prompt (this is the actual brief the subagent sees — write the real content here, not a placeholder):

```
You are authoring a math content bank for a stress test of the Osmosis
MCP tools. Work entirely through your available mcp__osmosis-mathstress__*
tools — you have no other tool access.

Steps:
1. Call readme() first, then bootstrap("math"). Read both responses in
   full before doing anything else — they carry the conventions
   (prompt style, calculator policy, batching guidance, tag taxonomy
   pointers) you need for everything below.
2. Design and create a tag taxonomy under "math" using create_tag,
   one call per tag per the tool's own documented shape. Use your own
   judgment on subtopic breakdown (algebra, geometry, trigonometry,
   calculus, statistics are reasonable candidates, but you decide the
   actual structure and depth based on what bootstrap tells you about
   tag conventions).
3. Author roughly 150-200 questions spanning that taxonomy: a mix of
   multiple-choice and written questions, a real spread across the
   difficulty scale bootstrap describes, using create_questions in
   batches sized per the tool's own batching guidance from readme.
   Write real, correct math content — valid answers, plausible
   multiple-choice distractors, and (where you use graph_spec) valid
   graph DSL per bootstrap's reference. If a batch call reports
   possible_duplicates or per-question rejections, read and act on
   them (revise or drop the offending question) rather than ignoring
   the report.
4. Create 1-2 templates (draw specs) covering some of what you built,
   using create_template.
5. When finished, call list_tags, search_questions (broad, to get a
   sense of total count), and list_templates to gather final counts
   for your report.

This is explicitly a stress test of the tools themselves, not just a
content-generation exercise. As you go, keep track of: anything about a
tool's description or schema that confused you or needed a second read;
any validation error you hit and what it turned out to mean; any point
where you wanted a capability the tools don't offer; anything that felt
like a redundant or avoidable round trip; and anything you'd tell the
tool's author to change.

Your final message (not a file — you have no Write tool) must contain,
in this order:
1. A content summary: final tag count, question count (by type and
   roughly by difficulty), template count.
2. Your friction report: the observations above, as concrete and
   specific as you can make them — cite the actual tool name, the
   actual error message or confusing phrase, not a vague summary.
3. Concrete suggestions for improving tool descriptions, schemas, or
   batching guidance, if you have any.

Do not summarize prematurely — give this your full session length. The
value of this exercise is in a real, thorough attempt, not a quick pass.
```

Run this in the foreground (`run_in_background: false` is the Agent tool's default posture only when your very next action depends on the result — here it does, since Task 5 reads the subagent's returned report directly) unless you judge the expected run to be long enough that backgrounding and continuing other work makes sense; either way, do not fabricate or guess at its content or progress before it actually returns.

- [ ] **Step 2: Capture the full returned message**

Save the subagent's complete final message text — you'll write it into Task 5's findings doc verbatim (lightly reformatted into markdown sections if needed, but not summarized or trimmed).

---

### Task 5: Verify results and write the findings doc

**Files:**
- Create: `docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md`

**Interfaces:**
- Consumes: Task 4's captured report text; live MCP connection (Task 2) for independent verification.
- Produces: a committed findings doc; a summary relayed to the user.

- [ ] **Step 1: Independently verify content counts**

Don't just trust the subagent's self-reported counts — call `mcp__osmosis-mathstress__list_tags`, `mcp__osmosis-mathstress__search_questions` (with a broad/empty query if the tool supports it, otherwise per-tag), and `mcp__osmosis-mathstress__list_templates` yourself and compare against what the subagent reported. Note any discrepancy in the findings doc rather than silently trusting either number.

- [ ] **Step 2: Write the findings doc**

`docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md`:

```markdown
# MCP Content-Authoring Stress Test — Findings (Math)

Date: 2026-08-20

Companion to `2026-08-20-mcp-math-stress-test-design.md`. One cold-start
subagent session authoring math content through the full MCP tool surface,
restricted to exactly those tools (no source/doc access) — see that spec
for the exercise's design.

## Content produced

[Fill in: tag count, question count by type/difficulty, template count —
from Task 5 Step 1's independent verification, noting any discrepancy
against the subagent's self-report.]

## Friction report (subagent's own account, verbatim)

[Paste Task 4's captured final message here, reformatted into markdown
sections but not trimmed or summarized.]

## Notes for MCP-SPEC.md §8

[Your own one-paragraph read on which of the subagent's suggestions look
like real, actionable follow-ups vs. one-session noise — this is your
editorial judgment as controller, not the subagent's own claim.]
```

Fill in the bracketed sections with the real content from Steps 1 and Task 4's capture — no placeholders left in the committed version.

- [ ] **Step 3: Commit the findings doc**

```bash
git add docs/superpowers/specs/2026-08-20-mcp-stress-test-findings.md
git commit -m "docs: findings from MCP content-authoring stress test (math)"
```

---

### Task 6: Cleanup

**Files:**
- Modify: `.mcp.json` (remove the `osmosis-mathstress` entry)
- Delete: `.claude/agents/osmosis-author.md`

**Interfaces:** None — this task only removes scaffolding created by Tasks 2-3.

- [ ] **Step 1: Stop the background server**

Terminate the process started in Task 1 Step 3.

- [ ] **Step 2: Remove the MCP registration**

Edit `.mcp.json` to remove the `osmosis-mathstress` entry from `mcpServers` (delete the whole file if it was empty before Task 2 added this entry and nothing else has been added to it since).

- [ ] **Step 3: Remove the one-off agent definition**

```bash
rm .claude/agents/osmosis-author.md
```

- [ ] **Step 4: Report to the user**

Summarize: content counts (from Task 5), a short pull-quote or two from the friction report's most concrete findings, the findings doc's path, and that `data/mathstress.db` / `server/.env.mathstress` / `data/mathstress-uploads` are left in place (gitignored) for them to keep or discard — ask which they'd like, don't assume.

---

## Execution Deviation (recorded during Task 2)

The `.mcp.json` "real MCP connection" approach (Tasks 2-3 as originally
written) doesn't work in this harness: project-scoped MCP servers are
loaded only at session start, and a mid-session `.mcp.json` edit is
invisible both to the controller session and to any subagent it
dispatches (confirmed via a probe dispatch — a fresh subagent saw no
`mcp__osmosis-mathstress__*` tools either). Restarting the session was
impractical for the user to trigger on demand, and `/api/*` turned out to
have **no content-creation routes at all** (confirmed by reading
`server/src/http/apiRoutes.ts` — it's read-only for the bank plus
attempts/grading/asset-upload; creation is exclusively the MCP tools' job
by design).

**Resolution:** the same `/mcp/:token` endpoint, driven by raw JSON-RPC
over `curl` instead of native tool-calling. Confirmed working directly:
`tools/list` and `tools/call` both succeed statelessly with no prior
`initialize` call needed (matches `StreamableHTTPServerTransport`'s
`sessionIdGenerator: undefined` stateless mode). This still exercises the
exact same schemas, descriptions, and validation — it just tests them via
a hand-built HTTP client instead of Claude's native tool-picking UI, which
is a real, acknowledged weakening of the friction-report signal (noted in
the findings doc) but not a different tool surface.

Task 3's agent definition is revised: `tools: Bash` only (no MCP tools to
grant), instructed to use `curl` against `/mcp/:token` and explicitly told
not to read repository source to learn tool behavior — `tools/list`'s
returned schemas and each call's own responses/errors are its only
allowed source of truth, preserving the cold-start intent as best this
fallback allows. `.mcp.json`'s `osmosis-mathstress` entry and Task 2's
steps are moot and skipped; Task 6 cleanup still removes the entry since
it was written to disk.

**Second deviation, discovered dispatching Task 4:** custom agent
definitions under `.claude/agents/*.md` have the exact same "loaded at
session start only" limitation as `.mcp.json` — the freshly written
`osmosis-author.md` wasn't recognized (`Agent type 'osmosis-author' not
found`). No hard tool-restriction mechanism is available mid-session at
all. Final resolution: dispatch on the built-in `general-purpose` agent
type (full tool access) with an explicit, emphatic prompt-level
instruction not to use Read/Grep/Glob/Write except for the final report
file — a soft, prompt-enforced restriction rather than a hard one. This
is a real weakening of the exercise's "genuinely cold-start" guarantee
(the subagent *could* cheat by reading source; it's trusted not to) and
is called out explicitly in the findings doc rather than glossed over.

## Self-Review Notes

- **Spec coverage:** §1 Environment → Task 1. §2 MCP registration → Task 2. §3 The subagent → Tasks 3-4. §4 Friction report → Task 4 (capture) + Task 5 (write/commit). §5 Execution flow → Tasks 1-5 in order, matching the spec's own numbered steps. §6 Cleanup → Task 6. All spec sections covered.
- **Placeholder scan:** Task 4's dispatch prompt and Task 3's agent definition are both full, real content — not summarized or stubbed. Task 5's findings doc template has bracketed fill-in points, but those are explicitly the point (content only known after Task 4 runs), and Step 2 explicitly instructs leaving no placeholders in the *committed* version.
- **Type/naming consistency:** The `mcp__osmosis-mathstress__*` prefix is used identically across Tasks 2, 3, and 4 (21 tool names enumerated once in Task 3, matching the count and names confirmed against `server/src/mcp/tools.ts`'s `registerTool` calls during planning). `<TOKEN>`/`<PORT>` from Task 1 are consumed identically in Task 2. The findings doc filename in Task 5 matches the one referenced in the design spec §4.
- **Deviation from spec, noted and resolved:** the spec's §3 says the subagent gets no Write tool; §4 says it "writes" the friction report to a file path. Task 4/5 resolve this by having the subagent return the report as message text instead of writing a file (it genuinely has no Write tool per the spec's own restriction), with the controller (Task 5) doing the actual file write. This preserves the spec's core intent (subagent restricted to domain tools only) while fixing a small mechanical gap the spec didn't spell out.
