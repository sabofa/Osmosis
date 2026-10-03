import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openTestDb } from "./helpers.js";
import { registerTools, PRESENTER_TOOLS } from "../src/mcp/tools.js";
import type { ToolScope } from "../src/domain/readme.js";

// The tutor and the planner reach the workspace through seven ws_* tools. They
// read, create, write, append and place. Rearranging the tree (remove, move,
// destroy) is Ben's, so none of those exist here.

const WS_TOOLS = ["ws_append", "ws_create", "ws_list", "ws_place", "ws_read", "ws_search", "ws_write"];

async function connect(scope: ToolScope = "full") {
  const db = openTestDb();
  const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
  registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node", scope);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  // Never throws: a protocol-level refusal (a schema error) comes back as
  // isError with the SDK's message, the same as a domain refusal.
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      const text = result.content[0].text;
      let body: any = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* a plain-text refusal from the SDK */
      }
      return { body, text, isError: result.isError === true };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return { body: text as any, text, isError: true };
    }
  };
  return { db, client, call };
}

describe("ws_* MCP tools", () => {
  let call: Awaited<ReturnType<typeof connect>>["call"];
  let client: Awaited<ReturnType<typeof connect>>["client"];
  let db: Awaited<ReturnType<typeof connect>>["db"];
  beforeEach(async () => {
    ({ call, client, db } = await connect());
  });

  async function setUpUnit() {
    const course = (await call("ws_create", { kind: "course", title: "chem 101", as: "planner" })).body.node;
    const unit = (await call("ws_create", { kind: "folder", title: "unit-3", container_id: course.id, as: "planner" })).body.node;
    const notes = (await call("ws_create", { kind: "file", title: "USERNOTES", type: "markdown", container_id: unit.id, as: "tutor" })).body.node;
    return { course, unit, notes };
  }

  it("creates a course, a unit folder in it, and a USERNOTES file in the unit", async () => {
    const course = await call("ws_create", { kind: "course", title: "chem 101", as: "planner" });
    expect(course.isError).toBe(false);
    expect(course.body.node).toMatchObject({ kind: "course", title: "chem 101" });
    expect(course.body.placement).toBeNull();

    const unit = await call("ws_create", { kind: "folder", title: "unit-3", container_id: course.body.node.id, as: "planner" });
    expect(unit.body.placement).toMatchObject({ container_id: course.body.node.id, name: "unit-3" });

    const notes = await call("ws_create", { kind: "file", title: "USERNOTES", type: "markdown", container_id: unit.body.node.id, as: "tutor" });
    expect(notes.isError).toBe(false);
    expect(notes.body.node).toMatchObject({ kind: "file", title: "USERNOTES" });
    expect(notes.body.placement).toMatchObject({ container_id: unit.body.node.id, name: "USERNOTES" });
    const detail = await call("ws_read", { node_id: notes.body.node.id });
    expect(detail.body.content).toMatchObject({ type: "markdown", body: null, revision: 1, saved_by: "tutor" });
  });

  it("appends twice as the tutor; ws_read shows both notes and who wrote them", async () => {
    const { notes } = await setUpUnit();
    const first = await call("ws_append", { node_id: notes.id, text: "- confuses moles with mass (3.2 g of C asked as mol)", as: "tutor" });
    expect(first.isError).toBe(false);
    expect(first.body.revision).toBe(2);
    expect((await call("ws_append", { node_id: notes.id, text: "- second note, after the first", as: "tutor" })).body.revision).toBe(3);

    const read = await call("ws_read", { node_id: notes.id });
    expect(read.isError).toBe(false);
    expect(read.body.content.body).toBe("- confuses moles with mass (3.2 g of C asked as mol)\n\n- second note, after the first");
    expect(read.body.content).toMatchObject({ revision: 3, saved_by: "tutor" });
    expect(read.body.file).toMatchObject({ saved_by: "tutor", revision: 3 });
    expect(read.body.node).toMatchObject({ id: notes.id, kind: "file", type: "markdown" });
    expect(read.body.appears_in).toHaveLength(1);
  });

  it("a write against a stale revision is an error that names the current one; a fresh one lands", async () => {
    const { notes } = await setUpUnit();
    await call("ws_append", { node_id: notes.id, text: "ben-visible note", as: "tutor" });
    const stale = await call("ws_write", { node_id: notes.id, body: "rewritten", base_revision: 1, as: "tutor" });
    expect(stale.isError).toBe(true);
    expect(stale.body.error).toBe("stale_revision");
    expect(stale.body.message).toMatch(/current revision is 2/);
    expect((await call("ws_read", { node_id: notes.id })).body.content.body).toBe("ben-visible note");

    const fresh = await call("ws_write", { node_id: notes.id, body: "rewritten", base_revision: 2, as: "planner" });
    expect(fresh.isError).toBe(false);
    expect(fresh.body.revision).toBe(3);
    expect((await call("ws_read", { node_id: notes.id })).body.content).toMatchObject({ body: "rewritten", saved_by: "planner" });
  });

  it("the writer is named on every write: ws_create without `as` is a schema error and writes nothing", async () => {
    const missing = await call("ws_create", { kind: "course", title: "no author" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/\bas\b/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 0 });

    // Ben is not one of the writers over MCP: his edits arrive over HTTP.
    const ben = await call("ws_create", { kind: "course", title: "as ben", as: "ben" });
    expect(ben.isError).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 0 });

    const { notes } = await setUpUnit();
    expect((await call("ws_write", { node_id: notes.id, body: "x", base_revision: 1 })).isError).toBe(true);
    expect((await call("ws_append", { node_id: notes.id, text: "x" })).isError).toBe(true);
    expect((await call("ws_read", { node_id: notes.id })).body.content.revision).toBe(1);
  });

  it("lists roots with no container, children with one; searches by text, scope and tag", async () => {
    const { course, unit, notes } = await setUpUnit();
    await call("ws_append", { node_id: notes.id, text: "price elasticity", as: "tutor" });

    const roots = await call("ws_list", {});
    expect(roots.body.courses.map((n: { id: string }) => n.id)).toEqual([course.id]);
    expect(roots.body).toHaveProperty("tracks");
    expect(roots.body).toHaveProperty("unplaced");

    const kids = await call("ws_list", { container_id: course.id });
    expect(kids.body.children.map((r: { name: string }) => r.name)).toEqual(["unit-3"]);
    expect((await call("ws_list", { container_id: "nope" })).body.error).toBe("not_found");

    const found = await call("ws_search", { q: "elasticity", scope: course.id });
    expect(found.body.results.map((r: { node: { id: string } }) => r.node.id)).toEqual([notes.id]);
    expect(found.body.results[0]).toMatchObject({ name: "USERNOTES", container_id: unit.id });
    expect((await call("ws_search", { q: "elasticity", kind_tag: "homework" })).body.results).toEqual([]);
    expect((await call("ws_search", { kind_tag: "nonsense" })).isError).toBe(true);
  });

  it("ws_create takes the file's type and body, a kind tag, and a local name; a file without a type is refused", async () => {
    const { unit } = await setUpUnit();
    const hw = await call("ws_create", {
      kind: "file",
      title: "Problem set 3",
      type: "markdown",
      body: "1. balance the equation",
      kind_tag: "homework",
      container_id: unit.id,
      name: "PS3",
      as: "planner",
    });
    expect(hw.isError).toBe(false);
    expect(hw.body.node.kind_tag).toBe("homework");
    expect(hw.body.placement.name).toBe("PS3");
    expect((await call("ws_read", { node_id: hw.body.node.id })).body.content).toMatchObject({ body: "1. balance the equation", saved_by: "planner" });

    const noType = await call("ws_create", { kind: "file", title: "typeless", container_id: unit.id, as: "tutor" });
    expect(noType.isError).toBe(true);
    expect(noType.body.error).toBe("invalid_input");
    expect(noType.body.message).toMatch(/type/);
    expect((await call("ws_create", { kind: "file", title: "odd", type: "no-such-type", as: "tutor" })).body.error).toBe("unknown_file_type");

    // A name is a placement's, so it needs somewhere to place.
    const nameOnly = await call("ws_create", { kind: "folder", title: "loose", name: "x", as: "tutor" });
    expect(nameOnly.body.error).toBe("invalid_input");
    // A track holds no body: say so instead of dropping it.
    const bodyOnTrack = await call("ws_create", { kind: "track", title: "t", body: "text", as: "tutor" });
    expect(bodyOnTrack.body.error).toBe("invalid_input");
  });

  it("ws_place puts an existing node in another container under a name; the domain's rules still say no", async () => {
    const { course, notes } = await setUpUnit();
    const track = (await call("ws_create", { kind: "track", title: "quant", as: "planner" })).body.node;
    const placed = await call("ws_place", { container_id: track.id, child_id: course.id, name: "Chemistry" });
    expect(placed.isError).toBe(false);
    expect(placed.body.placement).toMatchObject({ container_id: track.id, child_id: course.id, name: "Chemistry" });

    const again = await call("ws_place", { container_id: track.id, child_id: course.id });
    expect(again.isError).toBe(true);
    expect(again.body.error).toBe("already_placed");
    const intoFile = await call("ws_place", { container_id: notes.id, child_id: track.id });
    expect(intoFile.body.error).toBe("containment_not_allowed");
    const other = (await call("ws_create", { kind: "track", title: "amc", container_id: track.id, as: "planner" })).body.node;
    const cycle = await call("ws_place", { container_id: other.id, child_id: track.id });
    expect(cycle.isError).toBe(true);
    expect(cycle.body.error).toBe("cycle_rejected");
  });

  it("appending to a type that is not appendable names the code", async () => {
    const graph = (await call("ws_create", { kind: "file", title: "g", type: "graph", body: "y = x", as: "tutor" })).body.node;
    const refused = await call("ws_append", { node_id: graph.id, text: "y = 2x", as: "tutor" });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toBe("not_appendable");
  });

  it("offers read, create, write, append and place and nothing that rearranges the tree", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith("ws_")).sort();
    expect(tools).toEqual(WS_TOOLS);
    for (const name of tools) expect(name).not.toMatch(/remove|destroy|move|delete|purge|trash/);
  });

  it("describes the writer, and the revision a write must carry", async () => {
    const tools = (await client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const asOf = (name: string) => (byName[name].inputSchema.properties as Record<string, { enum?: string[]; description?: string }>).as;
    for (const name of ["ws_create", "ws_write", "ws_append"]) {
      expect(asOf(name).enum).toEqual(["tutor", "planner"]);
      expect(asOf(name).description).toMatch(/USERNOTES/);
      expect(byName[name].inputSchema.required).toContain("as");
    }
    expect(byName.ws_write.description).toMatch(/read/i);
    expect(byName.ws_write.description).toMatch(/stale_revision/);
    expect(byName.ws_append.description).toMatch(/USERNOTES/);
    expect(byName.ws_place.inputSchema.required).toEqual(["container_id", "child_id"]);
  });
});

describe("ws_* tools on the presenter surface", () => {
  it("a presenter-scoped registration lists all seven, and they are in the allowlist", async () => {
    const { client } = await connect("presenter");
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of WS_TOOLS) {
      expect(names).toContain(name);
      expect(PRESENTER_TOOLS).toContain(name);
    }
    expect(names.sort()).toEqual([...PRESENTER_TOOLS].sort());
  });

  it("and they work there: the tutor server holds this token", async () => {
    const { call } = await connect("presenter");
    const made = await call("ws_create", { kind: "folder", title: "inbox", as: "tutor" });
    expect(made.isError).toBe(false);
    expect((await call("ws_list", {})).body.unplaced.map((n: { id: string }) => n.id)).toEqual([made.body.node.id]);
  });
});
