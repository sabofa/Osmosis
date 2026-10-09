import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOKENS } from "theme-core";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb } from "./helpers.js";
import { getActiveThemeId, getActiveWorkspaceThemeId, listThemes } from "../src/domain/themes.js";

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

const small = (id = "midnight") => ({
  id, name: "Midnight", schema: 1,
  seeds: { light: { accent: "#2a5db0", canvas: "#f4f1ea", ink: "#1b1b1b" } },
  dials: { roundness: 0.8 }, fonts: {},
});

describe("theme MCP tools", () => {
  it("lists the 8 theme tools", async () => {
    const client = await connectedClient(openTestDb());
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["list_themes", "get_theme", "theme_tokens", "save_theme", "patch_theme", "validate_theme", "set_active_theme", "delete_theme"]) {
      expect(names).toContain(n);
    }
  });

  it("save (make_active), list shows builtins + custom and marks active", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    let r = await callTool(client, "save_theme", { manifest: small(), make_active: true });
    expect(r.isError).toBe(false);
    expect(r.body.report.ok).toBe(true);
    expect(r.body.active).toBe(true);
    expect(r.body.theme.id).toBe("midnight");
    expect(getActiveThemeId(db)).toBe("midnight");

    r = await callTool(client, "list_themes", {});
    const ids = r.body.themes.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["midnight", "builtin:osmosis", "builtin:forest", "builtin:ocean", "builtin:ember"]));
    expect(ids).not.toContain("builtin:slate");
    expect(ids).not.toContain("builtin:plum");
    expect(r.body.active_theme_id).toBe("midnight");
    expect(r.body.themes.filter((t: any) => t.active).map((t: any) => t.id)).toEqual(["midnight"]);
    expect(r.body.themes.find((t: any) => t.id === "builtin:forest").builtin).toBe(true);
    expect(r.body.themes.find((t: any) => t.id === "midnight").builtin).toBe(false);
  });

  it("get_theme returns manifest, and resolved maps when asked", async () => {
    const client = await connectedClient(openTestDb());
    await callTool(client, "save_theme", { manifest: small() });
    let r = await callTool(client, "get_theme", { id: "midnight" });
    expect(r.body.manifest.dials.roundness).toBe(0.8);
    expect(r.body.resolved).toBeUndefined();
    r = await callTool(client, "get_theme", { id: "midnight", resolved: true });
    expect(r.body.resolved.light["color-accent"]).toBeTruthy();
    expect(r.body.resolved.dark["color-accent"]).toBeTruthy();
    expect(r.body.resolved.light["color-accent"]).not.toBe(r.body.resolved.dark["color-accent"]);
    expect(r.body.resolved.provenance.light["color-accent"].source).toBe("seed");
    r = await callTool(client, "get_theme", { id: "builtin:ember" });
    expect(r.body.builtin).toBe(true);
    r = await callTool(client, "get_theme", { id: "nope" });
    expect(r.isError).toBe(true);
    expect(r.body.error).toBe("not_found");
  });

  it("patch_theme changes a dial and deletes an override via null", async () => {
    const client = await connectedClient(openTestDb());
    await callTool(client, "save_theme", { manifest: { ...small(), overrides: { any: { "radius-md": "9px" } } } });
    const r = await callTool(client, "patch_theme", { id: "midnight", patch: { dials: { roundness: 0.2 }, overrides: { any: { "radius-md": null } } }, make_active: true });
    expect(r.isError).toBe(false);
    expect(r.body.active).toBe(true);
    const g = await callTool(client, "get_theme", { id: "midnight" });
    expect(g.body.manifest.dials.roundness).toBe(0.2);
    expect(g.body.manifest.overrides?.any?.["radius-md"]).toBeUndefined();
    expect((await callTool(client, "patch_theme", { id: "builtin:ember", patch: {} })).isError).toBe(true);
    expect((await callTool(client, "patch_theme", { id: "ghost", patch: {} })).isError).toBe(true);
  });

  it("theme_tokens lists the registry, filters by group", async () => {
    const client = await connectedClient(openTestDb());
    let r = await callTool(client, "theme_tokens", {});
    expect(r.body.count).toBe(TOKENS.length);
    const byName = (n: string) => r.body.tokens.find((t: any) => t.name === n);
    expect(byName("color-surface")).toBeTruthy();
    expect(byName("elevation-mode").allowed.length).toBeGreaterThan(1);
    expect(byName("graph-marker-focus")).toBeTruthy();
    r = await callTool(client, "theme_tokens", { group: "graph" });
    expect(r.body.count).toBeGreaterThan(0);
    expect(r.body.count).toBeLessThan(TOKENS.length);
    expect(r.body.tokens.every((t: any) => t.group === "graph")).toBe(true);
    r = await callTool(client, "theme_tokens", { group: "bogus" });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.body)).toContain("graph");
  });

  it("validate_theme warns on low contrast and stores nothing", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    const m = { ...small("lowc"), seeds: { light: { ink: "#dddddd", canvas: "#ffffff", accent: "#2a5db0" } } };
    const r = await callTool(client, "validate_theme", { manifest: m });
    expect(r.isError).toBe(false);
    expect(r.body.ok).toBe(true);
    expect(r.body.warnings.length).toBeGreaterThan(0);
    expect(listThemes(db)).toEqual([]);
  });

  it("an invalid manifest returns the report with errors and stores nothing", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    const r = await callTool(client, "save_theme", { manifest: { ...small("bad"), dials: { roundness: 5 } } });
    expect(r.isError).toBe(true);
    expect(r.body.saved).toBe(false);
    expect(r.body.report.ok).toBe(false);
    expect(r.body.report.errors[0].path).toBe("dials.roundness");
    expect(listThemes(db)).toEqual([]);
  });

  it("set_active_theme(null) is builtin:osmosis; builtins cannot be deleted", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    await callTool(client, "save_theme", { manifest: small(), make_active: true });
    let r = await callTool(client, "set_active_theme", { id: null });
    expect(r.isError).toBe(false);
    expect(r.body.active_theme_id).toBe("builtin:osmosis");
    expect(getActiveThemeId(db)).toBe("builtin:osmosis");
    r = await callTool(client, "set_active_theme", { id: "builtin:forest" });
    expect(getActiveThemeId(db)).toBe("builtin:forest");
    r = await callTool(client, "set_active_theme", { id: "builtin:nope" });
    expect(r.isError).toBe(true);
    expect(r.body.error).toBe("unknown_builtin");
    r = await callTool(client, "delete_theme", { id: "builtin:forest" });
    expect(r.isError).toBe(true);
    expect(r.body.error).toBe("builtin_theme");
    r = await callTool(client, "delete_theme", { id: "midnight" });
    expect(r.isError).toBe(false);
    expect(listThemes(db)).toEqual([]);
  });

  it("list_themes carries layer and slot, filters by layer, and reports the workspace pointer", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    await callTool(client, "save_theme", { manifest: { ...small("amb"), layer: "ambience" } });
    await callTool(client, "set_active_theme", { id: "builtin:ws-clean", layer: "workspace" });
    await callTool(client, "set_active_theme", { id: "amb" });
    let r = await callTool(client, "list_themes", {});
    expect(r.body.active_workspace_theme_id).toBe("builtin:ws-clean");
    const by = (id: string) => r.body.themes.find((t: any) => t.id === id);
    expect(by("builtin:ws-clean")).toMatchObject({ layer: "workspace", slot: ["workspace"] });
    expect(by("amb")).toMatchObject({ layer: "ambience", slot: ["ambience"] });
    expect(by("builtin:forest")).toMatchObject({ layer: null, slot: [] });
    r = await callTool(client, "list_themes", { layer: "workspace" });
    const ids = r.body.themes.map((t: any) => t.id);
    expect(ids).toContain("builtin:ws-clean");
    expect(ids).toContain("builtin:forest");
    expect(ids).not.toContain("amb");
    r = await callTool(client, "list_themes", { layer: "ambience" });
    const ids2 = r.body.themes.map((t: any) => t.id);
    expect(ids2).toContain("amb");
    expect(ids2).not.toContain("builtin:ws-clean");
    expect((await callTool(client, "list_themes", { layer: "bogus" })).isError).toBe(true);
  });

  it("a theme active in both slots shows both; get_theme carries layer", async () => {
    const client = await connectedClient(openTestDb());
    await callTool(client, "set_active_theme", { id: "builtin:forest" });
    await callTool(client, "set_active_theme", { id: "builtin:forest", layer: "workspace" });
    const r = await callTool(client, "list_themes", {});
    expect(r.body.themes.find((t: any) => t.id === "builtin:forest").slot).toEqual(["ambience", "workspace"]);
    const g = await callTool(client, "get_theme", { id: "builtin:ws-clean" });
    expect(g.body.layer).toBe("workspace");
  });

  it("theme_tokens has an owner and filters by layer", async () => {
    const client = await connectedClient(openTestDb());
    let r = await callTool(client, "theme_tokens", {});
    expect(r.body.tokens.find((t: any) => t.name === "radius-md").owner).toBe("workspace");
    expect(r.body.tokens.find((t: any) => t.name === "color-accent").owner).toBe("ambience");
    expect(r.body.tokens.find((t: any) => t.name === "font-math").owner).toBe("shared");
    r = await callTool(client, "theme_tokens", { layer: "workspace" });
    let names = r.body.tokens.map((t: any) => t.name);
    for (const n of ["radius-md", "icon-sheet", "button-primary-bg", "font-body", "font-math"]) expect(names).toContain(n);
    expect(names).not.toContain("color-accent");
    r = await callTool(client, "theme_tokens", { layer: "ambience" });
    names = r.body.tokens.map((t: any) => t.name);
    expect(names).toContain("color-accent");
    expect(names).toContain("font-math");
    expect(names).not.toContain("radius-md");
    expect((await callTool(client, "theme_tokens", { layer: "bogus" })).isError).toBe(true);
  });

  it("set_active_theme takes a layer, clears with null, and returns both pointers", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    await callTool(client, "save_theme", { manifest: { ...small("amb"), layer: "ambience" } });
    let r = await callTool(client, "set_active_theme", { id: "builtin:ws-clean", layer: "workspace" });
    expect(r.isError).toBe(false);
    expect(r.body).toEqual({ active_theme_id: getActiveThemeId(db), active_workspace_theme_id: "builtin:ws-clean" });
    expect(getActiveWorkspaceThemeId(db)).toBe("builtin:ws-clean");
    r = await callTool(client, "set_active_theme", { id: "amb", layer: "workspace" });
    expect(r.isError).toBe(true);
    expect(r.body.error).toBe("wrong_layer");
    r = await callTool(client, "set_active_theme", { id: "builtin:ws-clean" });
    expect(r.body.error).toBe("wrong_layer");
    r = await callTool(client, "set_active_theme", { id: null, layer: "workspace" });
    expect(r.body.active_workspace_theme_id).toBeNull();
    r = await callTool(client, "set_active_theme", { id: null });
    expect(r.body).toMatchObject({ active_theme_id: "builtin:osmosis", active_workspace_theme_id: null });
    expect((await callTool(client, "set_active_theme", { id: null, layer: "bogus" })).isError).toBe(true);
  });

  it("validate_theme warns on a dial the ambience layer does not own", async () => {
    const client = await connectedClient(openTestDb());
    const r = await callTool(client, "validate_theme", { manifest: { ...small("amb"), layer: "ambience" } });
    expect(r.isError).toBe(false);
    expect(r.body.warnings.some((w: any) => /roundness/.test(w.path + w.message))).toBe(true);
  });

  describe("make_active routes by layer", () => {
    const lm = (id: string, layer?: string) => ({ ...small(id), ...(layer ? { layer } : {}) });
    it("workspace-layer manifest sets the workspace pointer only", async () => {
      const db = openTestDb();
      const client = await connectedClient(db);
      const r = await callTool(client, "save_theme", { manifest: lm("w", "workspace"), make_active: true });
      expect(r.isError).toBe(false);
      expect(r.body.active_workspace_theme_id).toBe("w");
      expect(r.body.active).toBe(true);
      expect(getActiveWorkspaceThemeId(db)).toBe("w");
      expect(getActiveThemeId(db)).toBeNull();
    });
    it("ambience-layer manifest sets the ambience pointer", async () => {
      const db = openTestDb();
      const client = await connectedClient(db);
      const r = await callTool(client, "save_theme", { manifest: lm("a", "ambience"), make_active: true });
      expect(r.isError).toBe(false);
      expect(getActiveThemeId(db)).toBe("a");
      expect(getActiveWorkspaceThemeId(db)).toBeNull();
      expect(r.body.active_workspace_theme_id).toBeNull();
    });
    it("full theme goes to the slot named by layer, default ambience", async () => {
      const db = openTestDb();
      const client = await connectedClient(db);
      await callTool(client, "save_theme", { manifest: lm("f"), make_active: true, layer: "workspace" });
      expect(getActiveWorkspaceThemeId(db)).toBe("f");
      expect(getActiveThemeId(db)).toBeNull();
      await callTool(client, "save_theme", { manifest: lm("g"), make_active: true });
      expect(getActiveThemeId(db)).toBe("g");
    });
    it("a mismatching explicit layer errors before anything is persisted", async () => {
      const db = openTestDb();
      const client = await connectedClient(db);
      const r = await callTool(client, "save_theme", { manifest: lm("a", "ambience"), make_active: true, layer: "workspace" });
      expect(r.isError).toBe(true);
      expect(r.body.error).toBe("wrong_layer");
      expect(listThemes(db)).toEqual([]);
    });
    it("patch_theme routes the same way and validates before persisting", async () => {
      const db = openTestDb();
      const client = await connectedClient(db);
      await callTool(client, "save_theme", { manifest: lm("w", "workspace") });
      await callTool(client, "save_theme", { manifest: lm("f") });
      let r = await callTool(client, "patch_theme", { id: "w", patch: { dials: { roundness: 0.3 } }, make_active: true });
      expect(r.isError).toBe(false);
      expect(getActiveWorkspaceThemeId(db)).toBe("w");
      expect(getActiveThemeId(db)).toBeNull();
      r = await callTool(client, "patch_theme", { id: "f", patch: {}, make_active: true, layer: "workspace" });
      expect(getActiveWorkspaceThemeId(db)).toBe("f");
      r = await callTool(client, "patch_theme", { id: "w", patch: { layer: "ambience", dials: { roundness: 0.9 } }, make_active: true, layer: "workspace" });
      expect(r.isError).toBe(true);
      const g = await callTool(client, "get_theme", { id: "w" });
      expect(g.body.layer).toBe("workspace");
      expect(g.body.manifest.dials.roundness).toBe(0.3);
    });
  });
});
