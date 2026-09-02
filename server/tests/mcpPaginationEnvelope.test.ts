import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createTemplate } from "../src/domain/templates.js";
import { createAsset } from "../src/domain/assets.js";

// Exercises the actual registered MCP tool handlers (not just the domain
// functions underneath them) via a real client<->server round trip over an
// in-memory transport pair -- the SDK's own supported pattern for testing a
// server without spinning up HTTP. This is the untested surface the branch's
// other pagination tests (domain-level, or the arithmetic-only
// searchQuestionsHasMore.test.ts) never actually touch: does each handler's
// `{ total, <rows>, has_more }` envelope construction do the right thing at
// both page boundaries.

async function connectedClient(db: ReturnType<typeof openTestDb>): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
  registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe("text");
  return JSON.parse(content[0].text);
}

describe("MCP handler pagination envelopes", () => {
  let db: ReturnType<typeof openTestDb>;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    db = openTestDb();
    ({ client, server } = await connectedClient(db));
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("list_assets: { total, assets, has_more } is correct across two pages", async () => {
    for (let i = 0; i < 3; i++) {
      await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Asset ${i}`, type: "text", content: `content ${i}` }, "claude");
    }

    const page1 = await callTool(client, "list_assets", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.assets).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const page2 = await callTool(client, "list_assets", { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.assets).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it("search_assets: { total, assets, has_more } is correct across two pages", async () => {
    for (let i = 0; i < 3; i++) {
      await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Widget ${i}`, type: "text", content: "widget content" }, "claude");
    }

    const page1 = await callTool(client, "search_assets", { query: "widget", limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.assets).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const page2 = await callTool(client, "search_assets", { query: "widget", limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.assets).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it("list_tags: { total, tags, has_more } is correct across two pages", async () => {
    for (const slug of ["a", "b", "c"]) insertTag(db, slug);

    const page1 = await callTool(client, "list_tags", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.tags).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const page2 = await callTool(client, "list_tags", { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.tags).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it("list_templates: { total, templates, has_more } is correct across two pages", async () => {
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) {
      createTemplate(db, { name: `Template ${i}`, tag_query: { all: ["a"] }, question_count: 5 });
    }

    const page1 = await callTool(client, "list_templates", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.templates).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const page2 = await callTool(client, "list_templates", { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.templates).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it("search_questions: { total, questions, has_more } is correct across two pages", async () => {
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["a"] });

    const page1 = await callTool(client, "search_questions", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.questions).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const page2 = await callTool(client, "search_questions", { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.questions).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });
});
