import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { openTestDb } from "./helpers.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import type { EnvConfig } from "../src/env.js";
import { PRESENTER_TOOLS } from "../src/mcp/tools.js";
import { listToolNames } from "../src/protocol.js";

const FULL = "full-token-aaa";
const PRESENTER = "presenter-token-bbb";

// The presenter surface is a second shared secret on the same /mcp route: the
// tutor server gets only this one, and the tools it can reach are the live
// teaching loop, not the bank-maintenance surface. Exercised over the real
// HTTP transport because the scope decision lives in the route, not the domain.
describe("presenter-token MCP scope", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-presenter-test-"));

  async function rpc(token: string, method: string, params: unknown): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    return JSON.parse(dataLine ? dataLine.slice("data:".length).trim() : raw);
  }

  beforeAll(async () => {
    const db = openTestDb();
    const env: EnvConfig = {
      role: "canonical",
      label: "test-canonical",
      port: 0,
      dbPath: ":memory:",
      remoteUrl: null,
      uploadsDir,
      mcpAuthToken: FULL,
      mcpPresenterToken: PRESENTER,
      deepseekApiKey: null,
      webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("lists exactly the allowlist for the presenter token", async () => {
    const envelope = await rpc(PRESENTER, "tools/list", {});
    const names = (envelope.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([...PRESENTER_TOOLS].sort());
  });

  it("lists the full inventory for the full token", async () => {
    const envelope = await rpc(FULL, "tools/list", {});
    const names = (envelope.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain("search_questions");
    expect(names.length).toBeGreaterThan(PRESENTER_TOOLS.length);
  });

  it("refuses a full-scope tool called with the presenter token", async () => {
    const envelope = await rpc(PRESENTER, "tools/call", { name: "search_questions", arguments: {} });
    const text = JSON.stringify(envelope);
    expect(text.toLowerCase()).toMatch(/not found|unknown tool/);
    // And it is genuinely not registered, not merely erroring at the domain layer.
    expect(envelope.result?.isError ?? envelope.error).toBeTruthy();
  });

  it("reports its own scope and only its own tools from readme", async () => {
    const presenterReadme = JSON.parse(
      (await rpc(PRESENTER, "tools/call", { name: "readme", arguments: {} })).result.content[0].text
    );
    expect(presenterReadme.scope).toBe("presenter");
    expect([...presenterReadme.node.tools].sort()).toEqual([...PRESENTER_TOOLS].sort());

    const fullReadme = JSON.parse(
      (await rpc(FULL, "tools/call", { name: "readme", arguments: {} })).result.content[0].text
    );
    expect(fullReadme.scope).toBe("full");
    expect(fullReadme.node.tools).toContain("search_questions");
  });

  it("404s an unknown token on both the JSON-RPC route and the upload route", async () => {
    const res = await fetch(`${baseUrl}/mcp/not-a-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(404);

    const form = new FormData();
    form.append("file", new Blob(["hi"], { type: "text/plain" }), "note.txt");
    const up = await fetch(`${baseUrl}/mcp/not-a-token/upload`, { method: "POST", body: form });
    expect(up.status).toBe(404);
  });

  it("accepts the presenter token on the upload route too", async () => {
    const form = new FormData();
    form.append("file", new Blob(["a presenter-uploaded note"], { type: "text/plain" }), "note.txt");
    const res = await fetch(`${baseUrl}/mcp/${PRESENTER}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(200);
  });
});

describe("PRESENTER_TOOLS allowlist", () => {
  // The concrete list, not a membership check: DEPLOY.md, MCP-SPEC.md and
  // server/.env.canonical.example all spell these eleven names out in prose,
  // and prose has no other way to notice that the allowlist grew. Change the
  // allowlist and this test fails; fix this test and the docs are next to it
  // in the diff.
  it("is exactly the eleven tools the deploy docs name", () => {
    expect([...PRESENTER_TOOLS].sort()).toEqual([
      "await_item_outcome",
      "await_show_outcome",
      "create_questions",
      "create_session",
      "end_session",
      "get_attempt",
      "grade_response",
      "present_item",
      "present_show",
      "readme",
      "update_show",
    ]);
  });

  it("names only tools the full registration actually registers", () => {
    // listToolNames() is filled by the full registration the suite above ran,
    // so a typo'd allowlist entry shows up here rather than as a silently
    // missing tool on the presenter surface.
    const full = new Set(listToolNames());
    for (const name of PRESENTER_TOOLS) expect(full.has(name)).toBe(true);
  });
});
