import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb } from "./helpers.js";
import { getActiveThemeId, listThemes } from "../src/domain/themes.js";

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
  let body: unknown;
  try {
    body = JSON.parse(content[0].text);
  } catch {
    body = { message: content[0].text };
  }
  return { body: body as any, isError: (result as { isError?: boolean }).isError === true };
}

describe("theme MCP tools", () => {
  it("save (with make_active), list, set_active to a builtin, delete", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);

    let r = await callTool(client, "save_theme", {
      id: "midnight", name: "Midnight",
      tokens: { light: { "--accent": "#123456" }, dark: { "--accent": "#abcdef", "--bg": "#000000" } },
      custom_css: ".panel{}", make_active: true,
    });
    expect(r.isError).toBe(false);
    expect(r.body.active).toBe(true);
    expect(getActiveThemeId(db)).toBe("midnight");

    r = await callTool(client, "list_themes", {});
    expect(r.body.themes.map((t: { id: string }) => t.id)).toEqual(["midnight"]);
    expect(r.body.active_theme_id).toBe("midnight");
    expect(r.body.builtin_ids).toContain("builtin:slate");

    r = await callTool(client, "set_active_theme", { id: "builtin:forest" });
    expect(r.isError).toBe(false);
    expect(getActiveThemeId(db)).toBe("builtin:forest");

    r = await callTool(client, "delete_theme", { id: "midnight" });
    expect(r.isError).toBe(false);
    expect(listThemes(db)).toEqual([]);
  });

  it("rejects unknown token keys and non-hex colours before the domain layer sees them", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    let r = await callTool(client, "save_theme", { id: "x", name: "x", tokens: { light: { "--font": "#000000" }, dark: {} } });
    expect(r.isError).toBe(true);
    r = await callTool(client, "save_theme", { id: "x", name: "x", tokens: { light: { "--accent": "red" }, dark: {} } });
    expect(r.isError).toBe(true);
    expect(listThemes(db)).toEqual([]);
  });
});
