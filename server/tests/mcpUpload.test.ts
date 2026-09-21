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

describe("POST /mcp/:token/upload", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-upload-test-"));

  beforeAll(async () => {
    const db = openTestDb();
    const env: EnvConfig = {
      role: "canonical",
      label: "test-canonical",
      port: 0,
      dbPath: ":memory:",
      remoteUrl: null,
      uploadsDir,
      mcpAuthToken: "test-token-123",
      deepseekApiKey: null, webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("404s on a wrong token, without revealing anything else", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello world"], { type: "text/plain" }), "note.txt");

    const res = await fetch(`${baseUrl}/mcp/wrong-token/upload`, { method: "POST", body: form });
    expect(res.status).toBe(404);
  });

  it("accepts a file upload with the correct token and extracts text, same shape create_asset returns", async () => {
    const form = new FormData();
    form.append("title", "My note");
    form.append("file", new Blob(["hello world, this is a test document."], { type: "text/plain" }), "note.txt");

    const res = await fetch(`${baseUrl}/mcp/test-token-123/upload`, { method: "POST", body: form });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; title: string; type: string; extracted_text: string | null };
    expect(body.title).toBe("My note");
    expect(body.type).toBe("file");
    expect(body.extracted_text).toContain("hello world");
    expect(Object.keys(body).sort()).toEqual(["extracted_text", "id", "title", "type"]);
  });

  it("400s when no file is attached", async () => {
    const form = new FormData();
    form.append("title", "No file here");

    const res = await fetch(`${baseUrl}/mcp/test-token-123/upload`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });
});
