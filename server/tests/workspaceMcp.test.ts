import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openTestDb } from "./helpers.js";
import { registerTools, PRESENTER_TOOLS } from "../src/mcp/tools.js";
import { TOOLS_VERSION } from "../src/protocol.js";
import type { ToolScope } from "../src/domain/readme.js";

// The tutor and the planner reach the workspace through seven ws_* tools. They
// read, create, write, append and place. Removing things (trash, delete,
// restore, purge) and rearranging the tree are Ben's, so none of those exist
// here.

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

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  async function setUpUnit() {
    const course = (await call("ws_create", { kind: "course", title: "chem 101", as: "planner" })).body.node;
    const unit = (await call("ws_create", { kind: "folder", title: "unit-3", container_id: course.id, as: "planner" })).body.node;
    const notes = (await call("ws_create", { kind: "file", title: "USERNOTES", format: "markdown", container_id: unit.id, as: "tutor" })).body.node;
    return { course, unit, notes };
  }

  describe("creating", () => {
    it("creates a course, a unit folder in it, and a USERNOTES file in the unit", async () => {
      const course = await call("ws_create", { kind: "course", title: "chem 101", as: "planner" });
      expect(course.isError).toBe(false);
      expect(course.body.node).toMatchObject({ kind: "course", title: "chem 101" });
      expect(course.body.placement).toBeNull();

      const unit = await call("ws_create", { kind: "folder", title: "unit-3", container_id: course.body.node.id, as: "planner" });
      expect(unit.body.placement).toMatchObject({ container_id: course.body.node.id, name: "unit-3" });

      const notes = await call("ws_create", { kind: "file", title: "USERNOTES", format: "markdown", container_id: unit.body.node.id, as: "tutor" });
      expect(notes.isError).toBe(false);
      expect(notes.body.node).toMatchObject({ kind: "file", title: "USERNOTES" });
      expect(notes.body.placement).toMatchObject({ container_id: unit.body.node.id, name: "USERNOTES" });
      const detail = await call("ws_read", { node_id: notes.body.node.id });
      expect(detail.body.content).toMatchObject({ format: "markdown", body: null, version: 1, author: "tutor" });
    });

    it("accepts a trajectory, and what it holds follows the containment matrix", async () => {
      const traj = await call("ws_create", { kind: "trajectory", title: "quant", as: "planner" });
      expect(traj.isError).toBe(false);
      expect(traj.body.node).toMatchObject({ kind: "trajectory", title: "quant" });
      expect(traj.body.placement).toBeNull();

      const track = await call("ws_create", { kind: "track", title: "math", container_id: traj.body.node.id, as: "planner" });
      expect(track.isError).toBe(false);
      expect(track.body.placement).toMatchObject({ container_id: traj.body.node.id, name: "math" });
      const syllabus = await call("ws_create", { kind: "file", title: "Syllabus", format: "markdown", body: "# Plan", container_id: traj.body.node.id, as: "planner" });
      expect(syllabus.isError).toBe(false);

      // A trajectory goes nowhere; a track holds no track.
      const before = count("ws_node");
      const nested = await call("ws_create", { kind: "trajectory", title: "inside a track", container_id: track.body.node.id, as: "planner" });
      expect(nested.isError).toBe(true);
      expect(nested.body.error).toBe("containment_not_allowed");
      const trackInTrack = await call("ws_create", { kind: "track", title: "inner", container_id: track.body.node.id, as: "planner" });
      expect(trackInTrack.body.error).toBe("containment_not_allowed");
      expect(count("ws_node")).toBe(before);
    });

    it("takes the file's format and body, a kind tag, and a local name; a file without a format is refused", async () => {
      const { unit } = await setUpUnit();
      const hw = await call("ws_create", {
        kind: "file",
        title: "Problem set 3",
        format: "markdown",
        body: "1. balance the equation",
        kind_tag: "homework",
        container_id: unit.id,
        name: "PS3",
        as: "planner",
      });
      expect(hw.isError).toBe(false);
      expect(hw.body.node.kind_tag).toBe("homework");
      expect(hw.body.placement.name).toBe("PS3");
      expect((await call("ws_read", { node_id: hw.body.node.id })).body.content).toMatchObject({
        body: "1. balance the equation",
        author: "planner",
      });

      const noFormat = await call("ws_create", { kind: "file", title: "formatless", container_id: unit.id, as: "tutor" });
      expect(noFormat.isError).toBe(true);
      expect(noFormat.body.error).toBe("invalid_input");
      expect(noFormat.body.message).toMatch(/format/);
      // The tag vocabulary is open, but it has a grammar.
      expect((await call("ws_create", { kind: "file", title: "lecture", format: "markdown", kind_tag: "lecture-notes", as: "tutor" })).isError).toBe(false);
      expect((await call("ws_create", { kind: "file", title: "odd", format: "markdown", kind_tag: "Not A Tag", as: "tutor" })).body.error).toBe("invalid_input");
      expect((await call("ws_create", { kind: "file", title: "odd", format: "Not A Format", as: "tutor" })).body.error).toBe("invalid_input");

      // A name is a placement's, so it needs somewhere to place.
      const nameOnly = await call("ws_create", { kind: "folder", title: "loose", name: "x", as: "tutor" });
      expect(nameOnly.body.error).toBe("invalid_input");
      // A track holds no body: say so instead of dropping it.
      const bodyOnTrack = await call("ws_create", { kind: "track", title: "t", body: "text", as: "tutor" });
      expect(bodyOnTrack.body.error).toBe("invalid_input");
      // A kind tag is for files.
      expect((await call("ws_create", { kind: "folder", title: "f", kind_tag: "source", as: "tutor" })).body.error).toBe("invalid_input");
    });

    it("a taken name is refused as name_taken and nothing is created", async () => {
      const { unit } = await setUpUnit();
      const before = count("ws_node");
      const again = await call("ws_create", { kind: "file", title: "USERNOTES", format: "markdown", container_id: unit.id, as: "tutor" });
      expect(again.isError).toBe(true);
      expect(again.body.error).toBe("name_taken");
      expect(count("ws_node")).toBe(before);
    });
  });

  describe("authors", () => {
    it("the writer is named on every write: without `as` it is a schema error and writes nothing", async () => {
      const missing = await call("ws_create", { kind: "course", title: "no author" });
      expect(missing.isError).toBe(true);
      expect(missing.text).toMatch(/\bas\b/);
      expect(count("ws_node")).toBe(0);

      // Ben is not one of the writers over MCP: his edits arrive over HTTP.
      const ben = await call("ws_create", { kind: "course", title: "as ben", as: "ben" });
      expect(ben.isError).toBe(true);
      expect(count("ws_node")).toBe(0);

      const { notes } = await setUpUnit();
      expect((await call("ws_write", { node_id: notes.id, body: "x", version: 1 })).isError).toBe(true);
      expect((await call("ws_append", { node_id: notes.id, text: "x" })).isError).toBe(true);
      expect((await call("ws_write", { node_id: notes.id, body: "x", version: 1, as: "ben" })).isError).toBe(true);
      expect((await call("ws_read", { node_id: notes.id })).body.content.version).toBe(1);
    });

    it("every version carries who wrote it, so each agent can see what the other did", async () => {
      const { notes } = await setUpUnit();
      await call("ws_append", { node_id: notes.id, text: "tutor note", as: "tutor" });
      await call("ws_write", { node_id: notes.id, body: "the plan", version: 2, as: "planner" });
      expect((await call("ws_read", { node_id: notes.id })).body.content).toMatchObject({ version: 3, author: "planner" });
      expect(db.prepare("SELECT version, author FROM ws_content WHERE node_id = ? ORDER BY version").all(notes.id)).toEqual([
        { version: 1, author: "tutor" },
        { version: 2, author: "tutor" },
        { version: 3, author: "planner" },
      ]);
    });
  });

  describe("reading", () => {
    it("with no container, ws_list is the roots plus everything unplaced", async () => {
      const traj = (await call("ws_create", { kind: "trajectory", title: "quant", as: "planner" })).body.node;
      const track = (await call("ws_create", { kind: "track", title: "math", container_id: traj.id, as: "planner" })).body.node;
      const course = (await call("ws_create", { kind: "course", title: "micro", as: "planner" })).body.node;
      const looseFile = (await call("ws_create", { kind: "file", title: "scratch", format: "markdown", as: "tutor" })).body.node;
      const looseFolder = (await call("ws_create", { kind: "folder", title: "inbox", as: "tutor" })).body.node;
      const placed = (await call("ws_create", { kind: "file", title: "placed", format: "markdown", container_id: course.id, as: "tutor" })).body.node;

      const res = await call("ws_list", {});
      expect(res.isError).toBe(false);
      expect(Object.keys(res.body).sort()).toEqual(["courses", "tracks", "trajectories", "unplaced"]);
      expect(res.body.trajectories).toMatchObject([{ id: traj.id, kind: "trajectory", top_level: true }]);
      expect(res.body.tracks).toMatchObject([{ id: track.id, top_level: false }]);
      expect(res.body.courses).toMatchObject([{ id: course.id, top_level: true }]);
      expect(ids(res.body.unplaced).sort()).toEqual([looseFile.id, looseFolder.id].sort());
      expect(ids(res.body.unplaced)).not.toContain(placed.id);
    });

    it("with a container, ws_list gives the container and its live children, containers first", async () => {
      const { course, unit, notes } = await setUpUnit();
      await call("ws_create", { kind: "file", title: "syllabus", format: "markdown", container_id: course.id, as: "planner" });

      const kids = await call("ws_list", { container_id: course.id });
      expect(kids.isError).toBe(false);
      expect(kids.body.container).toMatchObject({ id: course.id, kind: "course", title: "chem 101" });
      expect(kids.body.children.map((r: { name: string }) => r.name)).toEqual(["unit-3", "syllabus"]);
      expect(kids.body.children[0]).toMatchObject({ appears_elsewhere: false, node: { id: unit.id, kind: "folder", has_children: true } });
      expect((await call("ws_list", { container_id: unit.id })).body.children.map((r: { node: { id: string } }) => r.node.id)).toEqual([notes.id]);
      const missing = await call("ws_list", { container_id: "nope" });
      expect(missing.isError).toBe(true);
      expect(missing.body.error).toBe("not_found");
    });

    it("ws_read gives the summary, where the node appears, and for a file its content with version and author", async () => {
      const { course, unit, notes } = await setUpUnit();
      await call("ws_append", { node_id: notes.id, text: "- note", as: "tutor" });
      await call("ws_place", { container_id: course.id, child_id: notes.id, name: "Notes at the top" });

      const read = await call("ws_read", { node_id: notes.id });
      expect(read.isError).toBe(false);
      expect(read.body.node).toMatchObject({ id: notes.id, kind: "file", format: "markdown", placement_count: 2 });
      expect(read.body.appears_in.map((a: { name: string; container: { id: string } }) => [a.name, a.container.id]).sort()).toEqual(
        [
          ["Notes at the top", course.id],
          ["USERNOTES", unit.id],
        ].sort()
      );
      expect(read.body.content).toMatchObject({ format: "markdown", body: "- note", version: 2, author: "tutor", asset_id: null });
      expect(typeof read.body.content.saved_at).toBe("string");
      // The derived search text is the layer's business, not something to read back.
      expect(read.body.content).not.toHaveProperty("search_text");

      const folder = await call("ws_read", { node_id: unit.id });
      expect(folder.body.node).toMatchObject({ id: unit.id, kind: "folder" });
      expect(folder.body.content).toBeNull();
      expect((await call("ws_read", { node_id: "nope" })).body.error).toBe("not_found");
    });

    it("ws_search finds by text, scope and tag; one row per placement; unplaced nodes are not found", async () => {
      const { course, unit, notes } = await setUpUnit();
      await call("ws_append", { node_id: notes.id, text: "price elasticity", as: "tutor" });
      await call("ws_create", { kind: "file", title: "elasticity scratch", format: "markdown", body: "elasticity", as: "tutor" });

      const found = await call("ws_search", { q: "elasticity", scope: course.id });
      expect(found.body.results.map((r: { node: { id: string } }) => r.node.id)).toEqual([notes.id]);
      expect(found.body.results[0]).toMatchObject({ name: "USERNOTES", container_id: unit.id });
      // Unplaced, so not reached from here: it waits in ws_list's unplaced.
      expect((await call("ws_search", { q: "elasticity" })).body.results).toHaveLength(1);

      await call("ws_create", { kind: "file", title: "PS1", format: "markdown", kind_tag: "homework", container_id: unit.id, as: "planner" });
      expect((await call("ws_search", { kind_tag: "homework" })).body.results.map((r: { name: string }) => r.name)).toEqual(["PS1"]);
      expect((await call("ws_search", { q: "elasticity", kind_tag: "homework" })).body.results).toEqual([]);
      expect((await call("ws_search", { kind_tag: "Not A Tag" })).isError).toBe(true);
      expect((await call("ws_search", { scope: "nope" })).body.error).toBe("not_found");
    });
  });

  describe("writing", () => {
    it("appends twice as the tutor; ws_read shows both notes and who wrote them", async () => {
      const { notes } = await setUpUnit();
      const first = await call("ws_append", { node_id: notes.id, text: "- confuses moles with mass (3.2 g of C asked as mol)", as: "tutor" });
      expect(first.isError).toBe(false);
      expect(first.body.version).toBe(2);
      expect((await call("ws_append", { node_id: notes.id, text: "- second note, after the first", as: "tutor" })).body.version).toBe(3);

      const read = await call("ws_read", { node_id: notes.id });
      expect(read.isError).toBe(false);
      expect(read.body.content.body).toBe("- confuses moles with mass (3.2 g of C asked as mol)\n\n- second note, after the first");
      expect(read.body.content).toMatchObject({ version: 3, author: "tutor" });
      expect(read.body.appears_in).toHaveLength(1);
    });

    it("a write against a stale version is an error that names the current one; a fresh one lands", async () => {
      const { notes } = await setUpUnit();
      await call("ws_append", { node_id: notes.id, text: "ben-visible note", as: "tutor" });
      const stale = await call("ws_write", { node_id: notes.id, body: "rewritten", version: 1, as: "tutor" });
      expect(stale.isError).toBe(true);
      expect(stale.body.error).toBe("stale_version");
      expect(stale.body.message).toMatch(/current version is 2/);
      expect((await call("ws_read", { node_id: notes.id })).body.content.body).toBe("ben-visible note");

      const fresh = await call("ws_write", { node_id: notes.id, body: "rewritten", version: 2, as: "planner" });
      expect(fresh.isError).toBe(false);
      expect(fresh.body.version).toBe(3);
      expect(typeof fresh.body.saved_at).toBe("string");
      expect((await call("ws_read", { node_id: notes.id })).body.content).toMatchObject({ body: "rewritten", author: "planner", version: 3 });
    });

    it("ws_write takes `version`: the old names are not accepted, and the number must be an integer", async () => {
      const { notes } = await setUpUnit();
      for (const args of [{ base_revision: 1 }, { base_version: 1 }, { revision: 1 }, {}, { version: 1.5 }, { version: "1" }]) {
        const res = await call("ws_write", { node_id: notes.id, body: "x", as: "tutor", ...args });
        expect(res.isError, JSON.stringify(args)).toBe(true);
      }
      expect((await call("ws_read", { node_id: notes.id })).body.content.version).toBe(1);
      expect((await call("ws_write", { node_id: notes.id, body: "x", version: 1, as: "tutor" })).isError).toBe(false);
    });

    it("appending to a format that is not appendable names the code", async () => {
      const graph = (await call("ws_create", { kind: "file", title: "g", format: "graph", body: "y = x", as: "tutor" })).body.node;
      const refused = await call("ws_append", { node_id: graph.id, text: "y = 2x", as: "tutor" });
      expect(refused.isError).toBe(true);
      expect(refused.body.error).toBe("not_appendable");
      // A container holds no file content at all.
      const course = (await call("ws_create", { kind: "course", title: "c", as: "tutor" })).body.node;
      expect((await call("ws_append", { node_id: course.id, text: "x", as: "tutor" })).body.error).toBe("invalid_input");
      expect((await call("ws_write", { node_id: course.id, body: "x", version: 1, as: "tutor" })).body.error).toBe("invalid_input");
    });

    it("a write to an archived file is refused: archiving is Ben's, and so is undoing it", async () => {
      const { notes } = await setUpUnit();
      db.prepare("UPDATE ws_node SET archived_at = datetime('now') WHERE id = ?").run(notes.id);
      expect((await call("ws_append", { node_id: notes.id, text: "x", as: "tutor" })).body.error).toBe("archived");
      expect((await call("ws_write", { node_id: notes.id, body: "x", version: 1, as: "tutor" })).body.error).toBe("archived");
    });
  });

  describe("placing", () => {
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
      const traj = (await call("ws_create", { kind: "trajectory", title: "stem", as: "planner" })).body.node;
      expect((await call("ws_place", { container_id: traj.id, child_id: track.id })).isError).toBe(false);
      // f1 holds f2, so f2 can't hold f1: the cycle check is the domain's.
      const folder = (await call("ws_create", { kind: "folder", title: "f1", container_id: traj.id, as: "planner" })).body.node;
      const inner = (await call("ws_create", { kind: "folder", title: "f2", container_id: folder.id, as: "planner" })).body.node;
      const cycle = await call("ws_place", { container_id: inner.id, child_id: folder.id });
      expect(cycle.isError).toBe(true);
      expect(cycle.body.error).toBe("cycle_rejected");
    });

    it("a node can appear twice, and ws_list says so", async () => {
      const { course, notes } = await setUpUnit();
      const other = (await call("ws_create", { kind: "course", title: "physics", as: "planner" })).body.node;
      await call("ws_place", { container_id: other.id, child_id: notes.id, name: "Shared notes" });
      const kids = await call("ws_list", { container_id: other.id });
      expect(kids.body.children).toMatchObject([{ name: "Shared notes", appears_elsewhere: true, node: { id: notes.id, placement_count: 2 } }]);
      expect(course.id).not.toBe(other.id);
    });
  });

  describe("the tool surface", () => {
    it("offers read, create, write, append and place and nothing that removes or rearranges", async () => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names.filter((n) => n.startsWith("ws_")).sort()).toEqual(WS_TOOLS);
    });

    it("has no tool to trash, delete, restore or purge anything in the workspace", async () => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const name of ["trash", "delete", "restore", "purge", "remove", "destroy", "archive", "move", "rename", "retitle", "unplace"]) {
        for (const prefix of ["ws_", "workspace_", "node_", "placement_"]) expect(names, `${prefix}${name}`).not.toContain(`${prefix}${name}`);
        expect(names, name).not.toContain(name);
      }
      // However they are spelled: no workspace tool's name says what only Ben does.
      for (const name of names.filter((n) => /^ws_|workspace|placement/.test(n))) {
        expect(name).not.toMatch(/trash|delete|restore|purge|remove|destroy|archive|move|rename|retitle/);
      }
      // And none of the seven can be asked to do it: no input says so.
      const tools = (await client.listTools()).tools.filter((t) => t.name.startsWith("ws_"));
      for (const tool of tools) {
        for (const prop of Object.keys(tool.inputSchema.properties ?? {})) expect(prop).not.toMatch(/trash|delete|restore|purge|archive|with_orphans/);
      }
    });

    it("describes the writer, and the version a write must carry; `as` is a required tutor/planner enum", async () => {
      const tools = (await client.listTools()).tools;
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      const asOf = (name: string) => (byName[name].inputSchema.properties as Record<string, { enum?: string[]; description?: string }>).as;
      for (const name of ["ws_create", "ws_write", "ws_append"]) {
        expect(asOf(name).enum).toEqual(["tutor", "planner"]);
        expect(asOf(name).description).toMatch(/USERNOTES/);
        expect(byName[name].inputSchema.required).toContain("as");
      }
      // The reads and the place carry no writer.
      for (const name of ["ws_list", "ws_read", "ws_search", "ws_place"]) {
        expect(Object.keys(byName[name].inputSchema.properties ?? {})).not.toContain("as");
      }
      expect(byName.ws_write.inputSchema.required).toEqual(expect.arrayContaining(["node_id", "body", "version", "as"]));
      expect(byName.ws_write.description).toMatch(/read/i);
      expect(byName.ws_write.description).toMatch(/stale_version/);
      expect(byName.ws_read.description).toMatch(/version/);
      expect(byName.ws_append.description).toMatch(/USERNOTES/);
      expect(byName.ws_place.inputSchema.required).toEqual(["container_id", "child_id"]);
    });

    it("says version everywhere: no ws_* name, field or description still says revision", async () => {
      const tools = (await client.listTools()).tools.filter((t) => t.name.startsWith("ws_"));
      for (const tool of tools) expect(JSON.stringify(tool)).not.toMatch(/revision/i);
    });

    it("ws_create takes the kinds of the new model, and a format rather than a type", async () => {
      const create = (await client.listTools()).tools.find((t) => t.name === "ws_create")!;
      const props = create.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(props.kind.enum).toEqual(["trajectory", "track", "course", "folder", "file"]);
      expect(Object.keys(props)).toContain("format");
      expect(Object.keys(props)).not.toContain("type");
      expect(create.description).toMatch(/trajectory/);
      expect(create.description).toMatch(/a trajectory holds tracks, courses, folders and files/);
      expect(create.description).toMatch(/a folder holds folders and files/);
    });

    it("ws_create tells the tutor a taken name means the node exists: use it, never make a numbered copy", async () => {
      const tools = (await client.listTools()).tools;
      const description = tools.find((t) => t.name === "ws_create")?.description ?? "";
      expect(description).toMatch(/name_taken/);
      expect(description).toMatch(/call ws_list on the container and use the existing node/);
      expect(description).toMatch(/For USERNOTES that means ws_append to it/);
      expect(description).toMatch(/Never create a numbered copy/);
      expect(description).not.toMatch(/which name is free/);
    });

    it("keeps TOOLS_VERSION where this branch introduced it", () => {
      expect(TOOLS_VERSION).toBe(9);
    });
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

  it("the allowlist names exactly the same seven ws_* tools, and no more", () => {
    expect(PRESENTER_TOOLS.filter((n) => n.startsWith("ws_")).sort()).toEqual(WS_TOOLS);
  });

  it("and they work there: the tutor server holds this token", async () => {
    const { call } = await connect("presenter");
    const made = await call("ws_create", { kind: "folder", title: "inbox", as: "tutor" });
    expect(made.isError).toBe(false);
    expect((await call("ws_list", {})).body.unplaced.map((n: { id: string }) => n.id)).toEqual([made.body.node.id]);
  });
});
