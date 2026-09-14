import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, answerResponse, submitAttempt } from "../src/domain/attempts.js";

async function connectedClient(db: ReturnType<typeof openTestDb>): Promise<Client> {
  const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
  registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  return { body: JSON.parse(content[0].text), isError: (result as { isError?: boolean }).isError === true };
}

describe("get_attempt MCP tool", () => {
  it("returns the attempt with every per-response input field and the live grade", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine", confidence: "somewhat", misapplied_method: "guessed", elapsed_ms: 900 });
    submitAttempt(db, p.attempt_id);

    const client = await connectedClient(db);
    const { body, isError } = await callTool(client, "get_attempt", { attempt_id: p.attempt_id });
    expect(isError).toBe(false);
    expect(body.id).toBe(p.attempt_id);
    const r = body.responses[0];
    expect(r.response_text).toBe("nine");
    expect(r.confidence).toBe("somewhat");
    expect(r.misapplied_method).toBe("guessed");
    expect(r.elapsed_ms).toBe(900);
    expect(r.idk).toBe(false);
    expect(r.grade).toBeNull();
    expect(r.question.model_answer).toBe("model answer");
  });

  it("errors with not_found for an unknown id", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    const { body, isError } = await callTool(client, "get_attempt", { attempt_id: uuidv4() });
    expect(isError).toBe(true);
    expect(body.error).toBe("not_found");
  });
});
