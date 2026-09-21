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

// An ampersand, an angle-bracketed accented letter and CJK: the three things
// an accidental HTML-entity encode, a latin-1 decode or a lossy transcode
// would each mangle differently. This travels the real MCP HTTP transport,
// not the domain layer, because the transport is where an encoding bug lives.
const TRICKY = "R&D <é> 日本";

const TOKEN = "test-token-123";

describe("UTF-8 survives the MCP HTTP transport unchanged", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-utf8-test-"));
  let lastContentType: string | null = null;
  let lastBody: Uint8Array = new Uint8Array();

  async function callTool(name: string, args: unknown): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp/${TOKEN}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    lastContentType = res.headers.get("content-type");

    lastBody = new Uint8Array(await res.clone().arrayBuffer());
    const raw = await res.text();
    // The SDK answers as SSE when the client accepts it, plain JSON otherwise.
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    const envelope = JSON.parse(dataLine ? dataLine.slice("data:".length).trim() : raw);
    expect(envelope.error).toBeUndefined();
    expect(envelope.result?.isError).toBeFalsy();
    return JSON.parse(envelope.result.content[0].text);
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
      mcpAuthToken: TOKEN,
      deepseekApiKey: null,
      webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("returns a UTF-8 response body", async () => {
    const created = await callTool("create_tag", { slug: "utf8_ct", label: TRICKY });
    expect(created.label).toBe(TRICKY);

    // Both media types the transport may answer with are UTF-8 by their own
    // spec — application/json per RFC 8259 §8.1, text/event-stream per the
    // SSE spec (always decoded as UTF-8) — so an absent charset is correct
    // rather than ambiguous. If one is present it had better say utf-8.
    expect(lastContentType).toMatch(/^(application\/json|text\/event-stream)(;|$)/);
    if (/charset=/i.test(lastContentType ?? "")) {
      expect(lastContentType!.toLowerCase()).toContain("charset=utf-8");
    }

    // The bytes on the wire, not just what fetch chose to decode them as: a
    // latin-1 or entity-encoding transport would not contain this sequence.
    expect(Buffer.from(lastBody).includes(Buffer.from(TRICKY, "utf8"))).toBe(true);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(lastBody)).toContain(TRICKY);
  });

  it("round-trips a tricky label through create_tag and list_tags", async () => {
    const created = await callTool("create_tag", { slug: "utf8_probe", label: TRICKY });
    expect(created.label).toBe(TRICKY);

    const listed = await callTool("list_tags", { prefix: "utf8_probe" });
    expect(listed.tags.find((t: any) => t.slug === "utf8_probe").label).toBe(TRICKY);
  });

  it("round-trips a tricky prompt, choice body and explanation through create_questions and get_question", async () => {
    await callTool("create_tag", { slug: "utf8_q", label: "probe" });
    const result = await callTool("create_questions", {
      questions: [
        {
          type: "mc",
          prompt: `Which one is ${TRICKY}?`,
          tags: ["utf8_q"],
          explanation: `Because ${TRICKY}.`,
          choices: [
            { body: `yes ${TRICKY}`, is_correct: true },
            { body: `no ${TRICKY}`, is_correct: false, misconception: `confuses ${TRICKY}` },
          ],
        },
      ],
    });
    expect(result.rejected).toEqual([]);

    const detail = await callTool("get_question", { id: result.created[0].id });
    expect(detail.prompt).toBe(`Which one is ${TRICKY}?`);
    expect(detail.explanation).toBe(`Because ${TRICKY}.`);
    expect(detail.choices.map((c: any) => c.body)).toEqual([`yes ${TRICKY}`, `no ${TRICKY}`]);
    expect(detail.choices[1].misconception).toBe(`confuses ${TRICKY}`);
  });
});
