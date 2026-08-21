# MCP Batch Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/mcp-batch/`, a reusable, zero-intelligence MCP JSON-RPC client that drives the Osmosis MCP tool surface for bulk authoring sessions without native tool-calling's per-turn schema resend or accumulating-history token cost, per `docs/superpowers/specs/2026-08-21-mcp-batch-script-design.md`.

**Architecture:** A new npm workspace with a testable core library (`lib.mjs`: SSE-response parsing, one JSON-RPC `tools/call` POST, per-tool response summarization, sequential batch execution with continue-on-error) and a thin CLI entry point (`cli.mjs`: argv/env parsing, wiring, exit codes) that a caller (Claude via Bash, or a human) invokes directly.

**Tech Stack:** Plain Node.js (global `fetch`, `AbortSignal.timeout`), vitest for tests. No new runtime dependencies.

## Global Constraints

- No new server-side endpoint — talks to the existing `/mcp/:token` JSON-RPC surface exactly as a real MCP connector session would, so server-side validation is unchanged.
- Sequential execution only — no retries, no backoff, no parallelism, no job queue.
- A per-call failure (network error, timeout, or the tool response's `isError: true`) is logged and execution continues to the next call in the batch; the process exits nonzero overall if anything failed.
- Default output is a compact, per-tool-specific summary (see Task 2's exact rules) — never the raw response — except for read/informational tools and `create_asset`, which pass through in full since their response *is* the payload a caller needs. `--raw` forces full passthrough for every call.
- This tool is opt-in for large sessions (multiple sequential batches, or 50+ items in one sitting) — not a general replacement for native tool-calling on small/one-off work. This constraint doesn't change any code in this plan; it's the guidance Task 5's documentation must state.

---

### Task 1: Workspace scaffolding, `parseMcpResponse`, `callTool`

**Files:**
- Create: `scripts/mcp-batch/package.json`
- Create: `scripts/mcp-batch/lib.mjs`
- Create: `scripts/mcp-batch/lib.test.ts`
- Modify: `package.json` (root) — add `"scripts/mcp-batch"` to `workspaces`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2-4):
  ```js
  // scripts/mcp-batch/lib.mjs
  export function parseMcpResponse(rawBody: string): { isError: boolean; payload: unknown };
  export async function callTool(url: string, name: string, args: object, id: number, fetchImpl?: typeof fetch): Promise<{ isError: boolean; payload: unknown }>;
  ```

- [ ] **Step 1: Add the new workspace to root `package.json`**

Read `package.json` (repo root) first — current content:
```json
{
  "name": "osmosis",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "server",
    "web",
    "graph-engine",
    "document-engine"
  ]
}
```
Add `"scripts/mcp-batch"` to the `workspaces` array (order doesn't matter; append it last).

- [ ] **Step 2: Create the new workspace's `package.json`**

`scripts/mcp-batch/package.json`:
```json
{
  "name": "mcp-batch",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Run `npm install` at the repo root**

Run: `npm install` (from the repo root)
Expected: installs `vitest` for the new `mcp-batch` workspace; no errors.

- [ ] **Step 4: Write the failing tests for `parseMcpResponse`**

`scripts/mcp-batch/lib.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { parseMcpResponse, callTool } from "./lib.mjs";

describe("parseMcpResponse", () => {
  it("parses a successful tool response's SSE framing and inner JSON-encoded content", () => {
    const raw =
      'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"created\\":[{\\"id\\":\\"q1\\"}]}"}]},"jsonrpc":"2.0","id":1}\n\n';
    const { isError, payload } = parseMcpResponse(raw);
    expect(isError).toBe(false);
    expect(payload).toEqual({ created: [{ id: "q1" }] });
  });

  it("marks isError true and still parses the inner content when the tool call itself failed", () => {
    const raw =
      'event: message\ndata: {"result":{"isError":true,"content":[{"type":"text","text":"{\\"error\\":\\"invalid_slug_format\\",\\"message\\":\\"bad slug\\"}"}]},"jsonrpc":"2.0","id":2}\n\n';
    const { isError, payload } = parseMcpResponse(raw);
    expect(isError).toBe(true);
    expect(payload).toEqual({ error: "invalid_slug_format", message: "bad slug" });
  });

  it("throws a clear error when there is no data: line", () => {
    expect(() => parseMcpResponse("not an SSE frame at all")).toThrow(/no "data:" line/i);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: FAIL — `lib.mjs` does not exist (or does not export `parseMcpResponse`).

- [ ] **Step 6: Implement `parseMcpResponse`**

`scripts/mcp-batch/lib.mjs`:
```js
export function parseMcpResponse(rawBody) {
  const dataLine = rawBody.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`No "data:" line in MCP response body: ${rawBody}`);
  }
  const envelope = JSON.parse(dataLine.slice("data:".length).trim());
  const contentText = envelope.result?.content?.[0]?.text;
  const payload = contentText !== undefined ? JSON.parse(contentText) : envelope.result;
  return { isError: Boolean(envelope.result?.isError), payload };
}
```

- [ ] **Step 7: Run the tests to verify `parseMcpResponse`'s tests pass**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: `parseMcpResponse`'s 3 tests PASS. (`callTool`'s tests, added next, will still fail — that's expected at this point.)

- [ ] **Step 8: Write the failing tests for `callTool`**

Append to `scripts/mcp-batch/lib.test.ts`:
```ts
function mockFetch(rawBody, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, text: async () => rawBody })) as unknown as typeof fetch;
}

describe("callTool", () => {
  it("POSTs a tools/call JSON-RPC envelope and returns the parsed response", async () => {
    const raw =
      'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"tags\\":[]}"}]},"jsonrpc":"2.0","id":1}\n\n';
    const fetchImpl = mockFetch(raw);

    const result = await callTool("http://localhost:9/mcp/tok", "list_tags", {}, 1, fetchImpl);

    expect(result).toEqual({ isError: false, payload: { tags: [] } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:9/mcp/tok",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    const callBody = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(callBody).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_tags", arguments: {} },
    });
  });

  it("throws a clear error on a non-ok HTTP response", async () => {
    const fetchImpl = mockFetch("", false, 500);
    await expect(callTool("http://localhost:9/mcp/tok", "list_tags", {}, 1, fetchImpl)).rejects.toThrow(/http 500/i);
  });
});
```

- [ ] **Step 9: Run the tests to verify `callTool`'s tests fail**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: FAIL — `callTool` not exported.

- [ ] **Step 10: Implement `callTool`**

Append to `scripts/mcp-batch/lib.mjs`:
```js
export async function callTool(url, name, args, id, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`MCP request failed: HTTP ${res.status}`);
  }

  const text = await res.text();
  return parseMcpResponse(text);
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 12: Commit**

```bash
git add package.json scripts/mcp-batch/package.json scripts/mcp-batch/lib.mjs scripts/mcp-batch/lib.test.ts package-lock.json
git commit -m "feat: mcp-batch workspace scaffolding, SSE response parsing, tools/call POST"
```

---

### Task 2: `summarize`

**Files:**
- Modify: `scripts/mcp-batch/lib.mjs`
- Modify: `scripts/mcp-batch/lib.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 directly (takes a tool name and an already-parsed `payload`, as `parseMcpResponse`/`callTool` produce it).
- Produces (used by Task 3):
  ```js
  export function summarize(name: string, payload: unknown): string;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `scripts/mcp-batch/lib.test.ts`:
```ts
import { summarize } from "./lib.mjs";

describe("summarize", () => {
  it("create_questions: counts only, plus full rejected/warnings/possible_duplicates, never the created array's content", () => {
    const payload = {
      created: [
        { id: "q1", lineage_id: "l1", prompt_preview: "What is 2+2?" },
        { id: "q2", lineage_id: "l2", prompt_preview: "What is 3+3?" },
      ],
      rejected: [{ index: 2, reason: "invalid_difficulty", detail: "must be 1-5" }],
      warnings: [{ index: 0, message: "mc question has 5 choices; readme()'s convention is 4 choices" }],
      possible_duplicates: [],
    };
    const text = summarize("create_questions", payload);
    expect(text).toContain("created: 2, rejected: 1, warnings: 1, possible_duplicates: 0");
    expect(text).toContain("invalid_difficulty");
    expect(text).toContain("5 choices");
    expect(text).not.toContain("q1");
    expect(text).not.toContain("prompt_preview");
    expect(text).not.toContain("What is 2+2?");
  });

  it("create_questions: omits the rejected/warnings/possible_duplicates lines entirely when all are empty", () => {
    const payload = { created: [{ id: "q1", lineage_id: "l1", prompt_preview: "x" }], rejected: [], warnings: [], possible_duplicates: [] };
    const text = summarize("create_questions", payload);
    expect(text).toBe("created: 1, rejected: 0, warnings: 0, possible_duplicates: 0");
  });

  it("create_tag: the created slug, not the full row", () => {
    const text = summarize("create_tag", { slug: "math:algebra", label: "Algebra", parent_slug: "math", description: null, created_at: "now", retired_at: null });
    expect(text).toBe("created tag: math:algebra");
  });

  it("create_template and edit_template: id, eligible_count, short", () => {
    expect(summarize("create_template", { id: "t1", eligible_count: 47, short: false })).toBe(
      "id: t1, eligible_count: 47, short: false"
    );
    expect(summarize("edit_template", { id: "t1", eligible_count: 3, short: true })).toBe(
      "id: t1, eligible_count: 3, short: true"
    );
  });

  it("edit_question: id and versioned", () => {
    const text = summarize("edit_question", { id: "q1", lineage_id: "l1", version: 2, versioned: true, supersedes_id: "q0" });
    expect(text).toBe("id: q1, versioned: true");
  });

  it("retire_template and retire_question: id and retired_at", () => {
    expect(summarize("retire_question", { id: "q1", retired_at: "2026-08-21" })).toBe("id: q1, retired_at: 2026-08-21");
    expect(summarize("retire_template", { id: "t1", retired_at: "2026-08-21" })).toBe("id: t1, retired_at: 2026-08-21");
  });

  it("set_config: key = value", () => {
    expect(summarize("set_config", { key: "model_grader_daily_limit", value: 5, updated_at: "now" })).toBe(
      "model_grader_daily_limit = 5"
    );
  });

  it("merge_tags: from -> to and the repointed count", () => {
    const text = summarize("merge_tags", { from_slug: "algebra-old", to_slug: "algebra", retired_at: "now", questions_updated: 12 });
    expect(text).toBe("algebra-old -> algebra, 12 questions repointed");
  });

  it("a read/informational tool name passes the payload through in full, unmodified", () => {
    const payload = { tags: [{ slug: "math", label: "Math" }] };
    expect(JSON.parse(summarize("list_tags", payload))).toEqual(payload);
  });

  it("an unrecognized tool name falls back to full passthrough", () => {
    const payload = { anything: "at all" };
    expect(JSON.parse(summarize("some_future_tool", payload))).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: FAIL — `summarize` not exported.

- [ ] **Step 3: Implement `summarize`**

Append to `scripts/mcp-batch/lib.mjs`:
```js
export function summarize(name, payload) {
  if (name === "create_questions") {
    const createdCount = payload.created?.length ?? 0;
    const rejected = payload.rejected ?? [];
    const warnings = payload.warnings ?? [];
    const duplicates = payload.possible_duplicates ?? [];
    const lines = [
      `created: ${createdCount}, rejected: ${rejected.length}, warnings: ${warnings.length}, possible_duplicates: ${duplicates.length}`,
    ];
    if (rejected.length > 0) lines.push(`rejected: ${JSON.stringify(rejected)}`);
    if (warnings.length > 0) lines.push(`warnings: ${JSON.stringify(warnings)}`);
    if (duplicates.length > 0) lines.push(`possible_duplicates: ${JSON.stringify(duplicates)}`);
    return lines.join("\n");
  }

  if (name === "create_tag") {
    return `created tag: ${payload.slug}`;
  }

  if (name === "create_template" || name === "edit_template") {
    return `id: ${payload.id}, eligible_count: ${payload.eligible_count}, short: ${payload.short}`;
  }

  if (name === "edit_question") {
    return `id: ${payload.id}, versioned: ${payload.versioned}`;
  }

  if (name === "retire_template" || name === "retire_question") {
    return `id: ${payload.id}, retired_at: ${payload.retired_at}`;
  }

  if (name === "set_config") {
    return `${payload.key} = ${JSON.stringify(payload.value)}`;
  }

  if (name === "merge_tags") {
    return `${payload.from_slug} -> ${payload.to_slug}, ${payload.questions_updated} questions repointed`;
  }

  // Read/informational tools (list_tags, list_templates, list_assets,
  // search_questions, search_assets, get_question, get_results, get_config,
  // read_asset, readme, bootstrap, create_asset) and any unrecognized future
  // tool name: full passthrough. Trimming a read tool's response would
  // remove the actual payload the caller asked for.
  return JSON.stringify(payload);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: PASS, all 15 tests green (5 from Task 1 + 10 from this task).

- [ ] **Step 5: Commit**

```bash
git add scripts/mcp-batch/lib.mjs scripts/mcp-batch/lib.test.ts
git commit -m "feat: mcp-batch per-tool response summarization"
```

---

### Task 3: `runBatch`

**Files:**
- Modify: `scripts/mcp-batch/lib.mjs`
- Modify: `scripts/mcp-batch/lib.test.ts`

**Interfaces:**
- Consumes: `callTool`, `summarize` (Tasks 1-2, same file).
- Produces (used by Task 4):
  ```js
  export interface BatchCallResult {
    index: number;
    name: string;
    ok: boolean;
    message: string;
  }
  export async function runBatch(
    url: string,
    calls: { name: string; arguments: object }[],
    opts?: { raw?: boolean; fetchImpl?: typeof fetch }
  ): Promise<{ results: BatchCallResult[]; anyFailed: boolean }>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `scripts/mcp-batch/lib.test.ts`:
```ts
import { runBatch } from "./lib.mjs";

function sseFrame(id, resultObj) {
  return `event: message\ndata: ${JSON.stringify({ result: resultObj, jsonrpc: "2.0", id })}\n\n`;
}

function textContent(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

describe("runBatch", () => {
  it("executes calls in order and returns a per-call summary", async () => {
    const calls = [
      { name: "create_tag", arguments: { slug: "math", label: "Math" } },
      { name: "list_tags", arguments: {} },
    ];
    const seenUrls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      seenUrls.push(body.params.name);
      const resultObj =
        body.params.name === "create_tag"
          ? textContent({ slug: "math", label: "Math", parent_slug: null, description: null, created_at: "now", retired_at: null })
          : textContent({ tags: [] });
      return { ok: true, status: 200, text: async () => sseFrame(body.id, resultObj) };
    });

    const { results, anyFailed } = await runBatch("http://localhost:9/mcp/tok", calls, { fetchImpl });

    expect(seenUrls).toEqual(["create_tag", "list_tags"]);
    expect(anyFailed).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ index: 0, name: "create_tag", ok: true, message: "created tag: math" });
    expect(results[1].ok).toBe(true);
    expect(JSON.parse(results[1].message)).toEqual({ tags: [] });
  });

  it("continues past a failed call (network error) and still executes the next one", async () => {
    const calls = [
      { name: "create_tag", arguments: { slug: "bad slug", label: "x" } },
      { name: "list_tags", arguments: {} },
    ];
    let call = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      call += 1;
      if (call === 1) throw new Error("network unreachable");
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => sseFrame(body.id, textContent({ tags: [] })) };
    });

    const { results, anyFailed } = await runBatch("http://localhost:9/mcp/tok", calls, { fetchImpl });

    expect(anyFailed).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain("network unreachable");
    expect(results[1].ok).toBe(true);
  });

  it("continues past a call where the tool itself reports isError, and marks anyFailed", async () => {
    const calls = [{ name: "create_tag", arguments: { slug: "bad slug!", label: "x" } }];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const resultObj = { isError: true, ...textContent({ error: "invalid_slug_format", message: "bad slug" }) };
      return { ok: true, status: 200, text: async () => sseFrame(body.id, resultObj) };
    });

    const { results, anyFailed } = await runBatch("http://localhost:9/mcp/tok", calls, { fetchImpl });

    expect(anyFailed).toBe(true);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain("invalid_slug_format");
  });

  it("raw: true forces full JSON passthrough even for a normally-summarized tool", async () => {
    const calls = [{ name: "create_tag", arguments: { slug: "math", label: "Math" } }];
    const fullRow = { slug: "math", label: "Math", parent_slug: null, description: null, created_at: "now", retired_at: null };
    const fetchImpl = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => sseFrame(body.id, textContent(fullRow)) };
    });

    const { results } = await runBatch("http://localhost:9/mcp/tok", calls, { fetchImpl, raw: true });

    expect(JSON.parse(results[0].message)).toEqual(fullRow);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: FAIL — `runBatch` not exported.

- [ ] **Step 3: Implement `runBatch`**

Append to `scripts/mcp-batch/lib.mjs`:
```js
export async function runBatch(url, calls, opts = {}) {
  const { raw = false, fetchImpl = fetch } = opts;
  const results = [];
  let anyFailed = false;

  for (let i = 0; i < calls.length; i++) {
    const { name, arguments: args } = calls[i];
    try {
      const { isError, payload } = await callTool(url, name, args, i + 1, fetchImpl);
      if (isError) {
        anyFailed = true;
        results.push({ index: i, name, ok: false, message: JSON.stringify(payload) });
      } else {
        const message = raw ? JSON.stringify(payload) : summarize(name, payload);
        results.push({ index: i, name, ok: true, message });
      }
    } catch (err) {
      anyFailed = true;
      results.push({ index: i, name, ok: false, message: err.message });
    }
  }

  return { results, anyFailed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd scripts/mcp-batch && npx vitest run lib.test.ts`
Expected: PASS, all 19 tests green (15 from Tasks 1-2 + 4 from this task).

- [ ] **Step 5: Commit**

```bash
git add scripts/mcp-batch/lib.mjs scripts/mcp-batch/lib.test.ts
git commit -m "feat: mcp-batch sequential batch execution with continue-on-error"
```

---

### Task 4: `cli.mjs`

**Files:**
- Create: `scripts/mcp-batch/cli.mjs`
- Create: `scripts/mcp-batch/cli.test.ts`

**Interfaces:**
- Consumes: `runBatch` (Task 3, `./lib.mjs`).
- Produces: the actual command a caller runs — `node scripts/mcp-batch/cli.mjs [--url <url>] [--raw] <calls.json>` — no further tasks depend on this programmatically, so no exported functions are required to be reused elsewhere, but `parseArgs` is exported anyway so it's unit-testable without spawning a process.

- [ ] **Step 1: Write the failing unit test for argument parsing**

`scripts/mcp-batch/cli.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { parseArgs } from "./cli.mjs";

describe("parseArgs", () => {
  const originalEnv = process.env.OSMOSIS_MCP_URL;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OSMOSIS_MCP_URL;
    else process.env.OSMOSIS_MCP_URL = originalEnv;
  });

  it("reads the file path positionally and the URL from the env var", () => {
    process.env.OSMOSIS_MCP_URL = "http://localhost:4177/mcp/tok";
    const args = parseArgs(["calls.json"]);
    expect(args).toEqual({ url: "http://localhost:4177/mcp/tok", raw: false, file: "calls.json" });
  });

  it("--url overrides the env var, --raw sets raw true, in any order", () => {
    delete process.env.OSMOSIS_MCP_URL;
    const args = parseArgs(["--raw", "--url", "http://localhost:9/mcp/x", "calls.json"]);
    expect(args).toEqual({ url: "http://localhost:9/mcp/x", raw: true, file: "calls.json" });
  });

  it("url is null and file is null when neither is provided", () => {
    delete process.env.OSMOSIS_MCP_URL;
    expect(parseArgs([])).toEqual({ url: null, raw: false, file: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd scripts/mcp-batch && npx vitest run cli.test.ts`
Expected: FAIL — `cli.mjs` does not exist.

- [ ] **Step 3: Implement `cli.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runBatch } from "./lib.mjs";

export function parseArgs(argv) {
  let url = process.env.OSMOSIS_MCP_URL ?? null;
  let raw = false;
  let file = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") {
      url = argv[++i] ?? null;
      continue;
    }
    if (arg === "--raw") {
      raw = true;
      continue;
    }
    if (file === null) {
      file = arg;
    }
  }

  return { url, raw, file };
}

export async function main(argv) {
  const { url, raw, file } = parseArgs(argv);

  if (!url) {
    console.error("Missing MCP URL: set OSMOSIS_MCP_URL or pass --url <url>");
    return 1;
  }
  if (!file) {
    console.error("Usage: node cli.mjs [--url <url>] [--raw] <calls.json>");
    return 1;
  }

  const calls = JSON.parse(readFileSync(file, "utf8"));
  const { results, anyFailed } = await runBatch(url, calls, { raw });

  for (const r of results) {
    console.log(`[${r.index}] ${r.name}: ${r.ok ? "" : "FAILED "}${r.message}`);
  }

  return anyFailed ? 1 : 0;
}

// Only run when executed directly (`node cli.mjs ...`), not when imported
// by cli.test.ts. pathToFileURL (not a plain "file://" + string concat) is
// required for this comparison to work on Windows, where process.argv[1]
// is a backslash path ("C:\...") that doesn't turn into a valid file URL by
// simply prepending "file://" to it.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd scripts/mcp-batch && npx vitest run cli.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Write a real end-to-end integration test against a local HTTP server**

Append to `scripts/mcp-batch/cli.test.ts`:
```ts
import { createServer } from "node:http";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "./cli.mjs";

describe("main (end-to-end against a local HTTP server)", () => {
  it("POSTs each call to the real HTTP server and prints a summary per call, exit code 0 on full success", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const resultObj =
          parsed.params.name === "create_tag"
            ? { content: [{ type: "text", text: JSON.stringify({ slug: parsed.params.arguments.slug }) }] }
            : { content: [{ type: "text", text: JSON.stringify({ tags: [] }) }] };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ result: resultObj, jsonrpc: "2.0", id: parsed.id })}\n\n`);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), "mcp-batch-test-"));
    const callsFile = join(dir, "calls.json");
    writeFileSync(
      callsFile,
      JSON.stringify([
        { name: "create_tag", arguments: { slug: "math", label: "Math" } },
        { name: "list_tags", arguments: {} },
      ])
    );

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    let exitCode: number;
    try {
      exitCode = await main(["--url", `http://127.0.0.1:${port}/mcp/tok`, callsFile]);
    } finally {
      console.log = originalLog;
      unlinkSync(callsFile);
      await new Promise((resolve) => server.close(resolve));
    }

    expect(exitCode).toBe(0);
    expect(logs[0]).toBe("[0] create_tag: created tag: math");
    expect(logs[1]).toContain("[1] list_tags:");
    expect(JSON.parse(logs[1].replace("[1] list_tags: ", ""))).toEqual({ tags: [] });
  });
});
```

- [ ] **Step 6: Run the full test suite to verify it passes**

Run: `cd scripts/mcp-batch && npx vitest run`
Expected: PASS, all tests green across `lib.test.ts` and `cli.test.ts`.

- [ ] **Step 7: Manual smoke test against a real running instance**

If a canonical Osmosis server with an MCP token is reachable (e.g. `http://localhost:8081/mcp/<token>` or `http://localhost:4177/mcp/<token>`, if either is still running from earlier work in this repo), write a small real `calls.json` (e.g. one `readme` call — `[{"name": "readme", "arguments": {}}]`) and run:
```bash
OSMOSIS_MCP_URL="http://localhost:<port>/mcp/<token>" node scripts/mcp-batch/cli.mjs calls.json
```
Confirm it prints the full `readme()` output (a read tool — full passthrough) and exits 0. If no server is reachable, skip this step and note it in the task's completion — the automated integration test in Step 5-6 is the real coverage; this is a bonus sanity check when the opportunity is available, not a hard requirement.

- [ ] **Step 8: Commit**

```bash
git add scripts/mcp-batch/cli.mjs scripts/mcp-batch/cli.test.ts
git commit -m "feat: mcp-batch CLI entry point"
```

---

### Task 5: Documentation

**Files:**
- Modify: `MCP-SPEC.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add a new subsection to `MCP-SPEC.md`**

Read `MCP-SPEC.md` in full first (it's referenced extensively by this plan's earlier tasks and by the design spec) to place this consistently with its existing section numbering and tone. Add a new section after §3 ("Full tool inventory") — renumber subsequent sections if `MCP-SPEC.md` numbers them sequentially (check its current section numbers before deciding whether renumbering is needed; if sections are referenced elsewhere by number, e.g. in this plan or in the design spec, a renumber doesn't break those references since they cite content, not fixed section numbers). Content:

```markdown
## 3a. Bulk authoring: `scripts/mcp-batch`

Native tool-calling has a real, measured cost at scale: all 21 tool schemas
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
```

- [ ] **Step 2: Commit**

```bash
git add MCP-SPEC.md
git commit -m "docs: document scripts/mcp-batch in MCP-SPEC.md"
```

---

## Self-Review Notes

- **Spec coverage:** Design spec's "Location" → Task 1 (workspace scaffolding). "Interface" → Task 4 (`cli.mjs`'s argv/env handling). "Behavior" (sequential, timeout, continue-on-error, exit codes) → Tasks 1 (timeout in `callTool`) and 3 (`runBatch`'s sequencing/error handling/`anyFailed`). "Response summarization" (every named tool's exact rule, `--raw` override) → Task 2 (`summarize`) and Task 3 (`raw` flag threading). "Testing" (all four bullet points: SSE parsing success/error, summarize per-tool + passthrough, continue-on-error, in-order execution) → Tasks 1 and 3's tests cover these exactly; Task 2 additionally covers every individual tool's summarization rule the design spec enumerates, which the design's own testing section only asked for "a couple of" — this plan is stricter than the spec's minimum, covering all nine summarized tool names plus both passthrough cases, since under-testing a rules table this specific is where a real bug would hide. "Documentation" → Task 5.
- **Placeholder scan:** every step has real, complete code — no TBD/TODO, no "add appropriate error handling" prose without an implementation.
- **Type/naming consistency:** `parseMcpResponse`/`callTool` (Task 1) return `{isError, payload}` consistently; `runBatch` (Task 3) consumes that exact shape and produces `{index, name, ok, message}`, which `cli.mjs` (Task 4) consumes with matching field names throughout. `summarize(name, payload)`'s signature (Task 2) matches how `runBatch` calls it (Task 3). The nine summarized tool names and the passthrough list match the design spec's enumeration exactly (cross-checked against the actual domain function return shapes during spec-writing, not just the spec's prose).
