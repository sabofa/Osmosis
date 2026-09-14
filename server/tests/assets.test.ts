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

describe("POST /api/assets", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-asset-test-"));

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
    app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("stamps an asset uploaded through the human web-upload path as created_by='human'", async () => {
    const form = new FormData();
    form.append("title", "My note");
    form.append("file", new Blob(["hello world, this is a test document."], { type: "text/plain" }), "note.txt");

    const res = await fetch(`${baseUrl}/api/assets`, { method: "POST", body: form });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { created_by: string };
    expect(body.created_by).toBe("human");
  });
});
