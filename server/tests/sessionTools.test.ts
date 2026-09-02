import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";

// Exercises the real registered MCP handlers over an in-memory client<->server
// transport pair (same pattern as mcpPaginationEnvelope.test.ts), so the tool
// schemas and their session_id threading are covered, not just the domain
// functions underneath.

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
  return { body: JSON.parse(content[0].text), isError: (result as { isError?: boolean }).isError === true };
}

describe("session MCP tools", () => {
  let db: ReturnType<typeof openTestDb>;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    db = openTestDb();
    ({ client, server } = await connectedClient(db));
    insertTag(db, "algebra");
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("create_session returns the new session and writes the row", async () => {
    const { body, isError } = await callTool(client, "create_session", { name: "Tuesday", tag_slug: "algebra" });
    expect(isError).toBe(false);
    expect(body.name).toBe("Tuesday");
    expect(body.tag_slug).toBe("algebra");
    expect(db.prepare("SELECT id FROM tutor_session WHERE id = ?").get(body.id)).toBeTruthy();
  });

  it("create_session surfaces a DomainError as an MCP error envelope", async () => {
    const { body, isError } = await callTool(client, "create_session", { name: "s", tag_slug: "missing" });
    expect(isError).toBe(true);
    expect(body.error).toBe("not_found");
  });

  it("end_session stamps ended_at", async () => {
    const { body: session } = await callTool(client, "create_session", { name: "s" });
    const { body, isError } = await callTool(client, "end_session", { session_id: session.id });
    expect(isError).toBe(false);
    expect(body.ended_at).toBeTruthy();
  });

  it("present_item threads session_id through to the attempt", async () => {
    const q = insertQuestion(db, { tags: ["algebra"] });
    const { body: session } = await callTool(client, "create_session", { name: "s" });

    const { body: presented, isError } = await callTool(client, "present_item", {
      question_id: q.id,
      session_id: session.id,
    });
    expect(isError).toBe(false);

    const row = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(presented.attempt_id) as {
      session_id: string | null;
    };
    expect(row.session_id).toBe(session.id);
  });

  it("present_item still works with no session_id (session_id IS NULL path)", async () => {
    const q = insertQuestion(db, { tags: ["algebra"] });
    const { body: presented, isError } = await callTool(client, "present_item", { question_id: q.id });
    expect(isError).toBe(false);
    const row = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(presented.attempt_id) as {
      session_id: string | null;
    };
    expect(row.session_id).toBeNull();
  });

  it("create_template threads session_id through", async () => {
    insertQuestion(db, { tags: ["algebra"] });
    const { body: session } = await callTool(client, "create_session", { name: "s" });

    const { body: created, isError } = await callTool(client, "create_template", {
      name: "session test",
      tag_query: { all: ["algebra"] },
      question_count: 1,
      session_id: session.id,
    });
    expect(isError).toBe(false);

    const row = db.prepare("SELECT session_id FROM template WHERE id = ?").get(created.id) as {
      session_id: string | null;
    };
    expect(row.session_id).toBe(session.id);
  });

  it("get_session returns the session with its attempts and templates", async () => {
    const q = insertQuestion(db, { tags: ["algebra"] });
    const { body: session } = await callTool(client, "create_session", { name: "review me" });
    await callTool(client, "present_item", { question_id: q.id, session_id: session.id });
    await callTool(client, "create_template", {
      name: "scoped",
      tag_query: { all: ["algebra"] },
      question_count: 1,
      session_id: session.id,
    });

    const { body, isError } = await callTool(client, "get_session", { session_id: session.id });
    expect(isError).toBe(false);
    expect(body.name).toBe("review me");
    expect(body.attempts).toHaveLength(1);
    expect(body.templates).toHaveLength(1);
  });

  it("get_session errors for an unknown id", async () => {
    const { body, isError } = await callTool(client, "get_session", { session_id: uuidv4() });
    expect(isError).toBe(true);
    expect(body.error).toBe("not_found");
  });

  it("list_sessions: { total, sessions, has_more } is correct across two pages", async () => {
    for (const name of ["a", "b", "c"]) await callTool(client, "create_session", { name });

    const { body: page1 } = await callTool(client, "list_sessions", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.sessions).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const { body: page2 } = await callTool(client, "list_sessions", { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.sessions).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });

  it("list_sessions defaults to a full first page when called with no args", async () => {
    await callTool(client, "create_session", { name: "only" });
    const { body } = await callTool(client, "list_sessions", {});
    expect(body.total).toBe(1);
    expect(body.sessions).toHaveLength(1);
    expect(body.has_more).toBe(false);
  });
});
