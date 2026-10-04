import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import type { EnvConfig } from "../src/env.js";
import { createAsset, deleteAsset } from "../src/domain/assets.js";
import { openTestDb } from "./helpers.js";

// The HTTP face of the workspace graph (/api/ws/*). The domain has its own
// suites; these pin the wire: routes, status codes (404 not_found, 409
// stale_version, 400 for every other refusal), the {error, message, detail?}
// shape, that empty query parameters mean "not given", and that everything Ben
// does over HTTP is authored "ben".

const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-ws-routes-"));

interface Summary {
  id: string;
  kind: string;
  title: string;
  top_level: boolean;
}
interface ChildRow {
  placement_id: string;
  name: string;
  node: Summary;
}

describe("/api/ws routes", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeEach(async () => {
    db = openTestDb();
    const env: EnvConfig = {
      role: "canonical",
      label: "ws-routes",
      port: 0,
      dbPath: ":memory:",
      remoteUrl: null,
      uploadsDir,
      mcpAuthToken: "t",
      mcpPresenterToken: null,
      webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object | undefined });
    return { status: res.statusCode, body: res.json() };
  };
  // Creates a node (always a 201) and returns it.
  const make = async (kind: string, title: string, extra: Record<string, unknown> = {}) => {
    const res = await call("POST", "/api/ws/nodes", { kind, title, ...extra });
    expect(res.status).toBe(201);
    return res.body.node as Summary;
  };
  const note = (title: string, container_id?: string, body = "hello") => make("file", title, { format: "markdown", body, container_id });
  const kids = async (id: string) => (await call("GET", `/api/ws/nodes/${id}/children`)).body as ChildRow[];
  const placementOf = async (containerId: string, childId: string) => (await kids(containerId)).find((r) => r.node.id === childId)!.placement_id;
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const nodeIds = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

  describe("creating and reading", () => {
    it("creates a trajectory, a track in it and a course in the track (201), and children lists each level", async () => {
      const traj = await call("POST", "/api/ws/nodes", { kind: "trajectory", title: "quant" });
      expect(traj.status).toBe(201);
      expect(traj.body.node).toMatchObject({ kind: "trajectory", title: "quant", kind_tag: null });
      expect(traj.body.placement).toBeNull();

      const track = await call("POST", "/api/ws/nodes", { kind: "track", title: "math", container_id: traj.body.node.id });
      expect(track.status).toBe(201);
      expect(track.body.placement).toMatchObject({ container_id: traj.body.node.id, child_id: track.body.node.id, name: "math" });

      const course = await call("POST", "/api/ws/nodes", { kind: "course", title: "micro", container_id: track.body.node.id, name: "Micro I" });
      expect(course.status).toBe(201);
      expect(course.body.placement).toMatchObject({ container_id: track.body.node.id, child_id: course.body.node.id, name: "Micro I" });

      const level1 = await call("GET", `/api/ws/nodes/${traj.body.node.id}/children`);
      expect(level1.status).toBe(200);
      expect(level1.body.map((r: ChildRow) => [r.name, r.node.id, r.node.kind])).toEqual([["math", track.body.node.id, "track"]]);
      const level2 = await call("GET", `/api/ws/nodes/${track.body.node.id}/children`);
      expect(level2.body.map((r: ChildRow) => [r.name, r.node.id, r.node.title])).toEqual([["Micro I", course.body.node.id, "micro"]]);
    });

    it("creates a file with a format, a body, a kind tag, and a local name in one call", async () => {
      const course = await make("course", "micro");
      const res = await call("POST", "/api/ws/nodes", {
        kind: "file",
        title: "Problem set 3",
        format: "markdown",
        body: "1. derive demand",
        kind_tag: "homework",
        container_id: course.id,
        name: "PS3",
      });
      expect(res.status).toBe(201);
      expect(res.body.node).toMatchObject({ kind: "file", title: "Problem set 3", kind_tag: "homework" });
      expect(res.body.placement).toMatchObject({ container_id: course.id, name: "PS3" });
      const content = await call("GET", `/api/ws/nodes/${res.body.node.id}/content`);
      expect(content.body).toMatchObject({ format: "markdown", body: "1. derive demand", version: 1, author: "ben", asset_id: null });
    });

    it("roots lists every live trajectory, track and course with top_level; unplaced lists loose files and folders", async () => {
      const traj = await make("trajectory", "quant");
      const track = await make("track", "math", { container_id: traj.id });
      const course = await make("course", "micro");
      const placedCourse = await make("course", "macro", { container_id: track.id });
      const loose = await note("loose notes");
      const folder = await make("folder", "inbox");
      await note("shelved", course.id);

      const roots = await call("GET", "/api/ws/roots");
      expect(roots.status).toBe(200);
      expect(Object.keys(roots.body).sort()).toEqual(["courses", "tracks", "trajectories"]);
      expect(roots.body.trajectories).toMatchObject([{ id: traj.id, top_level: true }]);
      expect(roots.body.tracks).toMatchObject([{ id: track.id, top_level: false }]);
      // Every live course, placed or not.
      expect(roots.body.courses).toMatchObject([
        { id: placedCourse.id, top_level: false },
        { id: course.id, top_level: true },
      ]);

      const unplaced = await call("GET", "/api/ws/unplaced");
      expect(unplaced.status).toBe(200);
      expect(ids(unplaced.body).sort()).toEqual([loose.id, folder.id].sort());
    });

    it("detail carries the summary, every container the node appears in, and the content header", async () => {
      const track = await make("track", "quant");
      const course = await make("course", "micro", { container_id: track.id });
      const n = await note("unit notes", course.id, "# Elasticity");
      const other = await make("course", "macro");
      await call("POST", "/api/ws/placements", { container_id: other.id, child_id: n.id, name: "Supporting material" });

      const detail = await call("GET", `/api/ws/nodes/${n.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.node).toMatchObject({ id: n.id, kind: "file", format: "markdown", placement_count: 2 });
      expect(detail.body.appears_in.map((a: { name: string; container: { id: string } }) => [a.name, a.container.id]).sort()).toEqual(
        [
          ["Supporting material", other.id],
          ["unit notes", course.id],
        ].sort()
      );
      expect(detail.body.content).toMatchObject({ format: "markdown", version: 1, author: "ben", asset_id: null });
      // The header, never the body: that is GET content.
      expect(detail.body.content).not.toHaveProperty("body");

      const container = await call("GET", `/api/ws/nodes/${course.id}`);
      expect(container.body.node).toMatchObject({ id: course.id, kind: "course", has_children: true });
      expect(container.body.content).toBeNull();
    });

    it("children come containers first, then files, in natural order", async () => {
      const course = await make("course", "micro");
      await note("notes 10", course.id);
      await note("notes 2", course.id);
      await make("folder", "unit 2", { container_id: course.id });
      await make("folder", "unit 10", { container_id: course.id });
      const rows = await kids(course.id);
      expect(rows.map((r) => r.name)).toEqual(["unit 2", "unit 10", "notes 2", "notes 10"]);
    });

    it("subtree is depth-first with 0-based depth and the parent placement", async () => {
      const traj = await make("trajectory", "quant");
      const track = await make("track", "math", { container_id: traj.id });
      const course = await make("course", "micro", { container_id: track.id });
      const unit = await make("folder", "unit", { container_id: course.id });
      await note("notes", unit.id);

      const res = await call("GET", `/api/ws/nodes/${traj.id}/subtree`);
      expect(res.status).toBe(200);
      const rows = res.body as { placement_id: string; parent_placement_id: string | null; depth: number; name: string }[];
      expect(rows.map((r) => [r.name, r.depth])).toEqual([
        ["math", 0],
        ["micro", 1],
        ["unit", 2],
        ["notes", 3],
      ]);
      expect(rows[0].parent_placement_id).toBeNull();
      expect(rows[1].parent_placement_id).toBe(rows[0].placement_id);
      expect(rows[3].parent_placement_id).toBe(rows[2].placement_id);
    });

    it("context gives a track the trajectory's own documents, and nothing for any other kind", async () => {
      const traj = await make("trajectory", "quant");
      const syllabus = await note("Syllabus", traj.id);
      const track = await make("track", "math", { container_id: traj.id });
      const sibling = await make("track", "stats", { container_id: traj.id });
      await note("stats-only notes", sibling.id);

      const ctx = await call("GET", `/api/ws/nodes/${track.id}/context`);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toHaveLength(1);
      expect(ctx.body[0]).toMatchObject({ name: "Syllabus", container_id: traj.id });
      expect(ctx.body[0].node.id).toBe(syllabus.id);
      expect((await call("GET", `/api/ws/nodes/${traj.id}/context`)).body).toEqual([]);
    });

    it("lists the registered formats and what each can do", async () => {
      const res = await call("GET", "/api/ws/formats");
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual({ format: "markdown", searchable: true, appendable: true, validated: false });
      expect(res.body).toContainEqual({ format: "graph", searchable: true, appendable: false, validated: false });
      expect(res.body.map((f: { format: string }) => f.format)).toContain("upload");
    });

    it("the old routes are gone: there is no trash, courses or file-types path", async () => {
      const t = await make("track", "quant");
      expect((await call("GET", "/api/ws/trash")).status).toBe(404);
      expect((await call("GET", "/api/ws/file-types")).status).toBe(404);
      expect((await call("GET", `/api/ws/nodes/${t.id}/courses`)).status).toBe(404);
      expect((await call("POST", `/api/ws/trash/${t.id}/restore`)).status).toBe(404);
    });
  });

  describe("authors", () => {
    it("signs every write Ben's: a body that names another author is refused or ignored, never obeyed", async () => {
      const t = await make("track", "quant");
      // Creating: an `author` is not a field of a node, so it is a 400 and nothing is written.
      const spoof = await call("POST", "/api/ws/nodes", { kind: "file", title: "plan", author: "planner", format: "markdown", body: "x", container_id: t.id });
      expect(spoof.status).toBe(400);
      expect(spoof.body.error).toBe("invalid_input");
      expect(await kids(t.id)).toEqual([]);

      const created = await call("POST", "/api/ws/nodes", { kind: "file", title: "plan", format: "markdown", body: "x", container_id: t.id });
      expect(created.status).toBe(201);
      const id = created.body.node.id;
      expect((await call("GET", `/api/ws/nodes/${id}/content`)).body.author).toBe("ben");

      // Saving: the field is not read, so the version is Ben's all the same.
      const saved = await call("PUT", `/api/ws/nodes/${id}/content`, { body: "y", base_version: 1, author: "tutor" });
      expect(saved.status).toBe(200);
      expect(saved.body.version).toBe(2);
      expect((await call("GET", `/api/ws/nodes/${id}/content`)).body).toMatchObject({ body: "y", version: 2, author: "ben" });
      expect((await call("GET", `/api/ws/nodes/${id}/versions`)).body.map((v: { author: string }) => v.author)).toEqual(["ben", "ben"]);
    });
  });

  describe("content", () => {
    it("PUT content appends the next version and says when it was saved; versions lists each one", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id, "one");
      const saved = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "two", base_version: 1 });
      expect(saved.status).toBe(200);
      expect(saved.body.version).toBe(2);
      expect(typeof saved.body.saved_at).toBe("string");
      expect((await call("GET", `/api/ws/nodes/${n.id}/content`)).body).toMatchObject({ format: "markdown", body: "two", version: 2 });

      const versions = await call("GET", `/api/ws/nodes/${n.id}/versions`);
      expect(versions.status).toBe(200);
      expect(versions.body.map((v: { version: number; author: string }) => [v.version, v.author])).toEqual([
        [1, "ben"],
        [2, "ben"],
      ]);
      for (const v of versions.body) expect(typeof v.saved_at).toBe("string");
    });

    it("PUT content with a stale version is a 409 stale_version carrying the current version", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id);
      expect((await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "two", base_version: 1 })).status).toBe(200);

      const stale = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "three", base_version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe("stale_version");
      expect(stale.body.message).toMatch(/current version is 2/);
      expect(stale.body.detail).toEqual({ current_version: 2 });
      expect((await call("GET", `/api/ws/nodes/${n.id}/content`)).body.body).toBe("two");
    });

    it("PUT content wants a body and an integer base_version; neither is guessed", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id);
      const put = (payload: unknown) => call("PUT", `/api/ws/nodes/${n.id}/content`, payload);
      for (const payload of [{ body: "x" }, { base_version: 1 }, { body: "x", base_version: "1" }, { body: "x", base_version: 1.5 }, { body: 7, base_version: 1 }, {}]) {
        const res = await put(payload);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      // The old name for the same thing is not an alias.
      expect((await put({ body: "x", base_revision: 1 })).status).toBe(400);
      // And a request with no JSON body at all.
      expect((await call("PUT", `/api/ws/nodes/${n.id}/content`)).status).toBe(400);
      expect((await call("GET", `/api/ws/nodes/${n.id}/content`)).body.version).toBe(1);
    });

    it("content of a non-file is a 400, of an archived file a read but not a write", async () => {
      const t = await make("track", "quant");
      expect((await call("GET", `/api/ws/nodes/${t.id}/content`)).status).toBe(400);
      expect((await call("GET", `/api/ws/nodes/${t.id}/versions`)).status).toBe(400);

      const n = await note("n", t.id);
      await call("DELETE", `/api/ws/nodes/${n.id}`);
      expect((await call("GET", `/api/ws/nodes/${n.id}/content`)).status).toBe(200);
      const write = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "late", base_version: 1 });
      expect(write.status).toBe(400);
      expect(write.body.error).toBe("archived");
    });
  });

  describe("every route answers 404 for a node that is not there", () => {
    const cases: [string, "GET" | "POST" | "PUT" | "PATCH" | "DELETE", string, unknown?][] = [
      ["node detail", "GET", "/api/ws/nodes/nope"],
      ["children", "GET", "/api/ws/nodes/nope/children"],
      ["subtree", "GET", "/api/ws/nodes/nope/subtree"],
      ["context", "GET", "/api/ws/nodes/nope/context"],
      ["content", "GET", "/api/ws/nodes/nope/content"],
      ["versions", "GET", "/api/ws/nodes/nope/versions"],
      ["delete preview", "GET", "/api/ws/nodes/nope/delete-preview"],
      ["archived placements", "GET", "/api/ws/nodes/nope/archived-placements"],
      ["save content", "PUT", "/api/ws/nodes/nope/content", { body: "x", base_version: 1 }],
      ["patch node", "PATCH", "/api/ws/nodes/nope", { title: "x" }],
      ["delete node", "DELETE", "/api/ws/nodes/nope"],
      ["restore", "POST", "/api/ws/nodes/nope/restore", { placements: [] }],
      ["purge", "DELETE", "/api/ws/archive/nope"],
      ["patch placement", "PATCH", "/api/ws/placements/nope", { name: "x" }],
      ["trash placement", "DELETE", "/api/ws/placements/nope"],
      ["create into a missing container", "POST", "/api/ws/nodes", { kind: "folder", title: "x", container_id: "nope" }],
      ["place into a missing container", "POST", "/api/ws/placements", { container_id: "nope", child_id: "nope-too" }],
      ["search in a missing scope", "GET", "/api/ws/search?scope=nope"],
      ["by-kind-tag in a missing scope", "GET", "/api/ws/by-kind-tag?tag=source&scope=nope"],
    ];
    for (const [label, method, url, payload] of cases) {
      it(label, async () => {
        const res = await call(method, url, payload);
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("not_found");
        expect(typeof res.body.message).toBe("string");
      });
    }

    it("a refused create leaves nothing behind", async () => {
      await call("POST", "/api/ws/nodes", { kind: "folder", title: "x", container_id: "nope" });
      const course = await make("course", "c");
      const refused = await call("POST", "/api/ws/nodes", { kind: "course", title: "inside a course", container_id: course.id });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("containment_not_allowed");
      expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 1 });
    });
  });

  describe("POST /nodes validates its body", () => {
    it("a missing or mistyped field is a 400 invalid_input", async () => {
      for (const payload of [
        {},
        { title: "no kind" },
        { kind: "track" },
        { kind: "track", title: 7 },
        { kind: "track", title: "t", container_id: 7 },
        { kind: "file", title: "f", format: 7 },
        { kind: "file", title: "f", format: "markdown", body: 7 },
        { kind: "file", title: "f", format: "upload", asset_id: 7 },
        { kind: "folder", title: "f", kind_tag: 7 },
      ]) {
        const res = await call("POST", "/api/ws/nodes", payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      expect((await call("POST", "/api/ws/nodes", [1, 2])).status).toBe(400);
      expect((await call("POST", "/api/ws/nodes")).status).toBe(400);
      expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 0 });
    });

    it("an unknown field is a 400, so a misspelled container_id does not quietly leave an unplaced node", async () => {
      const t = await make("track", "quant");
      for (const extra of [{ container: t.id }, { containerId: t.id }, { parent_id: t.id }, { type: "markdown" }, { author: "tutor" }, { place_in: { container_id: t.id } }]) {
        const res = await call("POST", "/api/ws/nodes", { kind: "folder", title: "f", ...extra });
        expect(res.status, JSON.stringify(extra)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
        expect(res.body.message).toContain(`"${Object.keys(extra)[0]}"`);
      }
      expect(await kids(t.id)).toEqual([]);
      expect((await call("GET", "/api/ws/unplaced")).body).toEqual([]);
      // Every field the route does take is still accepted, together.
      const all = await call("POST", "/api/ws/nodes", {
        kind: "file",
        title: "t",
        kind_tag: "source",
        format: "markdown",
        body: "b",
        asset_id: null,
        container_id: t.id,
        name: "n",
      });
      expect(all.status).toBe(201);
    });

    it("the domain's refusals come through as 400s with their codes", async () => {
      const post = (payload: unknown) => call("POST", "/api/ws/nodes", payload);
      expect((await post({ kind: "bogus", title: "x" })).body.error).toBe("invalid_input");
      expect((await post({ kind: "file", title: "no format" })).body.error).toBe("invalid_input");
      expect((await post({ kind: "folder", title: "tagged", kind_tag: "homework" })).body.error).toBe("invalid_input");
      expect((await post({ kind: "track", title: "bad/name" })).body.error).toBe("invalid_name");
      expect((await post({ kind: "folder", title: "x", name: "orphan name" })).body.error).toBe("invalid_input");
      expect((await post({ kind: "file", title: "f", format: "Not A Format" })).body.error).toBe("invalid_input");
    });
  });

  describe("PATCH /nodes/:id", () => {
    it("retitles without touching the names placements wear", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const res = await call("PATCH", `/api/ws/nodes/${c.id}`, { title: "microeconomics" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: c.id, title: "microeconomics" });
      expect((await kids(t.id))[0].name).toBe("micro");
    });

    it("sets and clears a kind tag; any valid tag is accepted", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id);
      const tagged = await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "homework" });
      expect(tagged.status).toBe(200);
      expect(tagged.body.kind_tag).toBe("homework");
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "lecture-notes" })).body.kind_tag).toBe("lecture-notes");
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: null })).body.kind_tag).toBeNull();
    });

    it("a title and a tag land together or not at all", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id);
      const both = await call("PATCH", `/api/ws/nodes/${n.id}`, { title: "renamed", kind_tag: "test" });
      expect(both.status).toBe(200);
      expect(both.body).toMatchObject({ title: "renamed", kind_tag: "test" });

      const bad = await call("PATCH", `/api/ws/nodes/${n.id}`, { title: "again", kind_tag: "Not Valid" });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("invalid_input");
      expect((await call("GET", `/api/ws/nodes/${n.id}`)).body.node).toMatchObject({ title: "renamed", kind_tag: "test" });

      // A tag on a container is refused by the domain, after the title was written: it rolls back.
      const onTrack = await call("PATCH", `/api/ws/nodes/${t.id}`, { title: "should not stick", kind_tag: "source" });
      expect(onTrack.status).toBe(400);
      expect((await call("GET", `/api/ws/nodes/${t.id}`)).body.node.title).toBe("quant");
    });

    it("an empty patch, an unknown field and a mistyped field are 400s", async () => {
      const t = await make("track", "quant");
      const n = await note("n", t.id);
      const patch = (payload: unknown) => call("PATCH", `/api/ws/nodes/${n.id}`, payload);
      for (const payload of [{}, { everywhere: true }, { title: "x", name: "y" }, { kind_tag: "test", author: "tutor" }, { title: 7 }, { title: null }, { kind_tag: 7 }, { kind_tag: "" }]) {
        const res = await patch(payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`)).status).toBe(400);
      expect((await call("GET", `/api/ws/nodes/${n.id}`)).body.node).toMatchObject({ title: "n", kind_tag: null });
    });
  });

  describe("placements", () => {
    it("places a node under a chosen name (201), renames it there, and moves it", async () => {
      const t = await make("track", "quant");
      const a = await make("course", "micro");
      const b = await make("course", "macro");
      const n = await note("n", a.id);

      const placed = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: a.id, name: "Year 1 micro" });
      expect(placed.status).toBe(201);
      expect(placed.body).toMatchObject({ container_id: t.id, child_id: a.id, name: "Year 1 micro" });

      const renamed = await call("PATCH", `/api/ws/placements/${placed.body.id}`, { name: "Micro" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe("Micro");
      expect((await call("GET", `/api/ws/nodes/${a.id}`)).body.node.title).toBe("micro"); // the title is untouched

      const filePlacement = await placementOf(a.id, n.id);
      const moved = await call("PATCH", `/api/ws/placements/${filePlacement}`, { container_id: b.id });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ id: filePlacement, container_id: b.id, child_id: n.id, name: "n" });
      expect((await kids(b.id)).map((r) => r.name)).toEqual(["n"]);
      expect(await kids(a.id)).toEqual([]);
    });

    it("a move and a rename together run in that order, so the new name is checked where it will live", async () => {
      const c = await make("course", "micro");
      const f1 = await make("folder", "unit 1", { container_id: c.id });
      const f2 = await make("folder", "unit 2", { container_id: c.id });
      const n = await note("notes", f1.id);
      await note("recap", f1.id);
      await note("summary", f2.id);
      const p = await placementOf(f1.id, n.id);
      // "summary" is free in unit 1 but taken in unit 2, where the placement is going.
      const clash = await call("PATCH", `/api/ws/placements/${p}`, { container_id: f2.id, name: "summary" });
      expect(clash.status).toBe(400);
      expect(clash.body.error).toBe("name_taken");
      expect(nodeIds(await kids(f1.id))).toContain(n.id);

      // "recap" is taken in unit 1 but free in unit 2: it only works if the move comes first.
      const ok = await call("PATCH", `/api/ws/placements/${p}`, { container_id: f2.id, name: "recap" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: p, container_id: f2.id, name: "recap" });
    });

    it("a failed rename undoes the move that came before it", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const folder = await make("folder", "f", { container_id: t.id });
      const n = await note("n", c.id);
      await note("taken", folder.id);
      const placementId = await placementOf(c.id, n.id);
      // The move would succeed; the rename collides in the destination: neither happens.
      const res = await call("PATCH", `/api/ws/placements/${placementId}`, { container_id: folder.id, name: "taken" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name_taken");
      expect(nodeIds(await kids(c.id))).toEqual([n.id]);
      expect((await kids(c.id))[0].name).toBe("n");
    });

    it("a placement that would make a cycle is a 400 cycle_rejected", async () => {
      const traj = await make("trajectory", "quant");
      const a = await make("folder", "a", { container_id: traj.id });
      const b = await make("folder", "b", { container_id: a.id });
      const cycle = await call("POST", "/api/ws/placements", { container_id: b.id, child_id: a.id });
      expect(cycle.status).toBe(400);
      expect(cycle.body.error).toBe("cycle_rejected");
      expect(typeof cycle.body.message).toBe("string");

      // A move closes the same cycle.
      const c = await make("folder", "c", { container_id: b.id });
      const placementOfA = await placementOf(traj.id, a.id);
      const move = await call("PATCH", `/api/ws/placements/${placementOfA}`, { container_id: c.id });
      expect(move.status).toBe(400);
      expect(move.body.error).toBe("cycle_rejected");
    });

    it("names collide as a 400 name_taken carrying the free name", async () => {
      const t = await make("track", "quant");
      await make("course", "micro", { container_id: t.id });
      const other = await make("course", "micro");
      const taken = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: other.id });
      expect(taken.status).toBe(400);
      expect(taken.body.error).toBe("name_taken");
      expect(taken.body.detail).toEqual({ suggestion: "micro (2)" });
      expect(taken.body.message).toMatch(/micro \(2\)/);

      // Case-insensitive, and a rename hits the same rule.
      const shouting = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: other.id, name: "MICRO" });
      expect(shouting.body.error).toBe("name_taken");
      const placed = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: other.id, name: "micro 2" });
      const rename = await call("PATCH", `/api/ws/placements/${placed.body.id}`, { name: "micro" });
      expect(rename.status).toBe(400);
      expect(rename.body.detail).toEqual({ suggestion: "micro (2)" });
    });

    it("containment and duplicates are 400s with their codes", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const traj = await make("trajectory", "quant 2");
      const n = await note("n", c.id);
      const post = (container_id: string, child_id: string) => call("POST", "/api/ws/placements", { container_id, child_id });
      expect((await post(n.id, c.id)).body.error).toBe("containment_not_allowed");
      expect((await post(c.id, t.id)).body.error).toBe("containment_not_allowed");
      expect((await post(t.id, traj.id)).body.error).toBe("containment_not_allowed");
      expect((await post(t.id, c.id)).body.error).toBe("already_placed");
    });

    it("POST and PATCH placements validate their fields instead of failing inside the database", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      for (const payload of [{}, { container_id: t.id }, { child_id: c.id }, { container_id: 7, child_id: c.id }, { container_id: t.id, child_id: c.id, name: 7 }]) {
        const res = await call("POST", "/api/ws/placements", payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      const p = await placementOf(t.id, c.id);
      for (const payload of [{}, { child_id: "x" }, { name: "x", author: "tutor" }, { name: 7 }, { name: null }, { container_id: 7 }]) {
        const res = await call("PATCH", `/api/ws/placements/${p}`, payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      expect((await kids(t.id))[0]).toMatchObject({ placement_id: p, name: "micro" });
    });

    it("DELETE trashes this one placement; the node lives on and says when it became unplaced", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const placementId = await placementOf(t.id, c.id);

      const removed = await call("DELETE", `/api/ws/placements/${placementId}`);
      expect(removed.status).toBe(200);
      expect(removed.body.became_unplaced).toBe(true);
      expect(removed.body.removed).toMatchObject({ id: placementId, child_id: c.id, container_id: t.id });
      // Still a live node, now a top-level course; nothing is archived.
      expect((await call("GET", `/api/ws/nodes/${c.id}`)).body.node).toMatchObject({ archived_at: null, top_level: true });
      expect((await call("GET", "/api/ws/archive")).body).toEqual([]);
      // The row is gone: a second trash is a 404.
      expect((await call("DELETE", `/api/ws/placements/${placementId}`)).status).toBe(404);
    });

    it("trashing a file's last placement leaves it unplaced, and a trash that is not the last says so", async () => {
      const t1 = await make("track", "quant");
      const t2 = await make("track", "amc");
      const c = await make("course", "micro", { container_id: t1.id });
      await call("POST", "/api/ws/placements", { container_id: t2.id, child_id: c.id });
      const first = await placementOf(t1.id, c.id);
      expect((await call("DELETE", `/api/ws/placements/${first}`)).body.became_unplaced).toBe(false);

      const n = await note("n", t2.id);
      const only = await placementOf(t2.id, n.id);
      expect((await call("DELETE", `/api/ws/placements/${only}`)).body.became_unplaced).toBe(true);
      expect(ids((await call("GET", "/api/ws/unplaced")).body)).toEqual([n.id]);
    });
  });

  describe("deleting, the archive and restore", () => {
    it("delete-preview says where a node will disappear from and which orphans go with it, and changes nothing", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const alone = await note("only here", c.id);
      const shared = await note("shared", c.id);
      const elsewhere = await make("course", "macro");
      await call("POST", "/api/ws/placements", { container_id: elsewhere.id, child_id: shared.id });

      const preview = await call("GET", `/api/ws/nodes/${c.id}/delete-preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.appears_in).toMatchObject([{ name: "micro", container: { id: t.id, kind: "track", title: "quant" } }]);
      expect(ids(preview.body.orphans)).toEqual([alone.id]);
      expect((await call("GET", "/api/ws/archive")).body).toEqual([]);
      expect(await kids(t.id)).toHaveLength(1);

      await call("DELETE", `/api/ws/nodes/${c.id}`);
      const again = await call("GET", `/api/ws/nodes/${c.id}/delete-preview`);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe("archived");
    });

    it("DELETE archives the node everywhere and lists it in the archive; the children wait, unplaced", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const n = await note("n", c.id);

      const gone = await call("DELETE", `/api/ws/nodes/${c.id}`);
      expect(gone.status).toBe(200);
      expect(gone.body.archived).toEqual([c.id]);
      expect(typeof gone.body.batch).toBe("string");
      expect(await kids(t.id)).toEqual([]);

      const archive = await call("GET", "/api/ws/archive");
      expect(archive.status).toBe(200);
      expect(ids(archive.body)).toEqual([c.id]);
      expect(archive.body[0].archived_at).not.toBeNull();
      // Its file keeps its own placement, hidden: it is reachable as unplaced.
      expect(ids((await call("GET", "/api/ws/unplaced")).body)).toEqual([n.id]);
    });

    it("with_orphans=true takes along what would be left unplaced; false and absent leave it", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const n = await note("n", c.id);

      for (const query of ["", "?with_orphans=false", "?with_orphans="]) {
        const plain = await call("DELETE", `/api/ws/nodes/${c.id}${query}`);
        expect(plain.status, query).toBe(200);
        expect(plain.body.archived, query).toEqual([c.id]);
        const placement = (await call("GET", `/api/ws/nodes/${c.id}/archived-placements`)).body[0].placement_id;
        expect((await call("POST", `/api/ws/nodes/${c.id}/restore`, { placements: [placement] })).status).toBe(200);
      }

      const withOrphans = await call("DELETE", `/api/ws/nodes/${c.id}?with_orphans=true`);
      expect(withOrphans.status).toBe(200);
      expect(withOrphans.body.archived).toEqual([c.id, n.id]);
      expect(ids((await call("GET", "/api/ws/archive")).body).sort()).toEqual([c.id, n.id].sort());
    });

    it("any other with_orphans value, or one given twice, is a 400 and deletes nothing", async () => {
      const t = await make("track", "quant");
      for (const query of ["?with_orphans=1", "?with_orphans=yes", "?with_orphans=TRUE", "?with_orphans=true&with_orphans=true", "?with_orphans=&with_orphans="]) {
        const res = await call("DELETE", `/api/ws/nodes/${t.id}${query}`);
        expect(res.status, query).toBe(400);
        expect(res.body.error, query).toBe("invalid_input");
      }
      expect((await call("GET", `/api/ws/nodes/${t.id}`)).body.node.archived_at).toBeNull();
      expect((await call("GET", "/api/ws/archive")).body).toEqual([]);
    });

    it("restore brings back exactly the placements chosen, and drops the rest", async () => {
      const t1 = await make("track", "quant");
      const t2 = await make("track", "amc");
      const c = await make("course", "micro", { container_id: t1.id });
      await call("POST", "/api/ws/placements", { container_id: t2.id, child_id: c.id });
      await call("DELETE", `/api/ws/nodes/${c.id}`);

      const archived = await call("GET", `/api/ws/nodes/${c.id}/archived-placements`);
      expect(archived.status).toBe(200);
      expect(archived.body).toHaveLength(2);
      expect(archived.body.map((p: { container: { id: string } }) => p.container.id).sort()).toEqual([t1.id, t2.id].sort());
      expect(archived.body[0]).toMatchObject({ name: "micro", container: { kind: "track", archived: false } });

      const chosen = archived.body.find((p: { container: { id: string } }) => p.container.id === t2.id).placement_id;
      const back = await call("POST", `/api/ws/nodes/${c.id}/restore`, { placements: [chosen] });
      expect(back.status).toBe(200);
      expect(back.body).toEqual({ restored: c.id, placements: [{ placement_id: chosen, name: "micro", renamed: false }], skipped: [], batch_mates: [] });
      expect(await kids(t1.id)).toEqual([]);
      expect(nodeIds(await kids(t2.id))).toEqual([c.id]);
      expect((await call("GET", "/api/ws/archive")).body).toEqual([]);
      // The unchosen placement was dropped, not left as a ghost.
      expect((await call("GET", `/api/ws/nodes/${c.id}`)).body.appears_in).toHaveLength(1);
    });

    it("choosing no placement restores the node unplaced; a clash is renamed and reported", async () => {
      const t = await make("track", "quant");
      const a = await make("course", "micro", { container_id: t.id });
      const pa = await placementOf(t.id, a.id);
      await call("DELETE", `/api/ws/nodes/${a.id}`);
      const squatter = await make("course", "micro");
      await call("POST", "/api/ws/placements", { container_id: t.id, child_id: squatter.id });

      const renamed = await call("POST", `/api/ws/nodes/${a.id}/restore`, { placements: [pa] });
      expect(renamed.status).toBe(200);
      expect(renamed.body.placements).toEqual([{ placement_id: pa, name: "micro (2)", renamed: true }]);

      const b = await make("course", "macro", { container_id: t.id });
      await call("DELETE", `/api/ws/nodes/${b.id}`);
      const unplaced = await call("POST", `/api/ws/nodes/${b.id}/restore`, { placements: [] });
      expect(unplaced.status).toBe(200);
      expect(unplaced.body.placements).toEqual([]);
      expect((await call("GET", `/api/ws/nodes/${b.id}`)).body.appears_in).toEqual([]);
    });

    it("a chosen placement in a container that is still archived is skipped, and revives with the container", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const n = await note("n", c.id);
      const pn = await placementOf(c.id, n.id);
      await call("DELETE", `/api/ws/nodes/${n.id}`);
      await call("DELETE", `/api/ws/nodes/${c.id}`);

      const info = await call("GET", `/api/ws/nodes/${n.id}/archived-placements`);
      expect(info.body).toMatchObject([{ placement_id: pn, container: { id: c.id, archived: true } }]);
      const skipped = await call("POST", `/api/ws/nodes/${n.id}/restore`, { placements: [pn] });
      expect(skipped.status).toBe(200);
      expect(skipped.body.skipped).toEqual([{ placement_id: pn, reason: "container_archived" }]);
      expect(skipped.body.placements).toEqual([]);

      const placementOfC = (await call("GET", `/api/ws/nodes/${c.id}/archived-placements`)).body[0].placement_id;
      await call("POST", `/api/ws/nodes/${c.id}/restore`, { placements: [placementOfC] });
      expect(nodeIds(await kids(c.id))).toEqual([n.id]);
    });

    it("restore lists the nodes deleted in the same batch", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const n = await note("n", c.id);
      await call("DELETE", `/api/ws/nodes/${c.id}?with_orphans=true`);

      const pc = (await call("GET", `/api/ws/nodes/${c.id}/archived-placements`)).body[0].placement_id;
      const back = await call("POST", `/api/ws/nodes/${c.id}/restore`, { placements: [pc] });
      expect(back.status).toBe(200);
      expect(back.body.batch_mates).toMatchObject([{ id: n.id, kind: "file", archived_at: expect.any(String) }]);
    });

    it("restore wants a list of placement ids; anything else is a 400, and a stranger's placement too", async () => {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const live = await placementOf(t.id, c.id);
      await call("DELETE", `/api/ws/nodes/${c.id}`);
      const restore = (payload?: unknown) => call("POST", `/api/ws/nodes/${c.id}/restore`, payload);
      for (const payload of [{}, { placements: "all" }, { placements: [7] }, { placements: null }, [live]]) {
        const res = await restore(payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect(res.body.error).toBe("invalid_input");
      }
      expect((await restore()).status).toBe(400);

      // A placement of some other node is not this node's to choose.
      const other = await make("course", "macro", { container_id: t.id });
      const foreign = await placementOf(t.id, other.id);
      await call("DELETE", `/api/ws/nodes/${other.id}`);
      const stranger = await restore({ placements: [foreign] });
      expect(stranger.status).toBe(400);
      expect(stranger.body.error).toBe("invalid_input");
      // Nothing happened to c on the way.
      expect(ids((await call("GET", "/api/ws/archive")).body).sort()).toEqual([c.id, other.id].sort());

      const liveNode = await make("course", "live one");
      const notArchived = await call("POST", `/api/ws/nodes/${liveNode.id}/restore`, { placements: [] });
      expect(notArchived.status).toBe(400);
      expect(notArchived.body.error).toBe("not_archived");
    });

    it("purge only takes what is already archived", async () => {
      const t = await make("track", "quant");
      const live = await call("DELETE", `/api/ws/archive/${t.id}`);
      expect(live.status).toBe(400);
      expect(live.body.error).toBe("not_archived");

      await call("DELETE", `/api/ws/nodes/${t.id}`);
      const purged = await call("DELETE", `/api/ws/archive/${t.id}`);
      expect(purged.status).toBe(200);
      expect(purged.body).toEqual({ purged: t.id });
      expect((await call("GET", `/api/ws/nodes/${t.id}`)).status).toBe(404);
      expect((await call("GET", "/api/ws/archive")).body).toEqual([]);
    });

    it("an upload appears unplaced the moment it exists; its wrapper can't be purged until the upload is deleted", async () => {
      const asset = await createAsset(db, uploadsDir, { title: "syllabus", type: "text", content: "week 1" }, "human");
      const wrapper = `asset:${asset.id}`;
      expect(ids((await call("GET", "/api/ws/unplaced")).body)).toContain(wrapper);
      const detail = await call("GET", `/api/ws/nodes/${encodeURIComponent(wrapper)}`);
      expect(detail.body.node).toMatchObject({ kind: "file", format: "upload", kind_tag: "source" });
      expect(detail.body.content).toMatchObject({ format: "upload", asset_id: asset.id, author: "ben" });

      await call("DELETE", `/api/ws/nodes/${encodeURIComponent(wrapper)}`);
      const refused = await call("DELETE", `/api/ws/archive/${encodeURIComponent(wrapper)}`);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("asset_in_use");

      deleteAsset(db, uploadsDir, asset.id);
      const purged = await call("DELETE", `/api/ws/archive/${encodeURIComponent(wrapper)}`);
      expect(purged.status).toBe(200);
      expect(purged.body.purged).toBe(wrapper);
    });

    it("restoring an upload whose asset was deleted is a 400 upload_gone that says to purge it", async () => {
      const asset = await createAsset(db, uploadsDir, { title: "old paper", type: "text", content: "week 1" }, "human");
      const wrapper = `asset:${asset.id}`;
      const course = await make("course", "micro");
      await call("POST", "/api/ws/placements", { container_id: course.id, child_id: wrapper });
      const marked = await placementOf(course.id, wrapper);

      // Deleting the upload archives its wrapper (the sync that runs after an asset is deleted).
      deleteAsset(db, uploadsDir, asset.id);
      expect(ids((await call("GET", "/api/ws/archive")).body)).toContain(wrapper);

      const res = await call("POST", `/api/ws/nodes/${encodeURIComponent(wrapper)}/restore`, { placements: [marked] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("upload_gone");
      expect(res.body.message).toBe("The upload was deleted; purge it instead.");
      // Still archived, and purge is the way out.
      expect(ids((await call("GET", "/api/ws/archive")).body)).toContain(wrapper);
      expect((await call("DELETE", `/api/ws/archive/${encodeURIComponent(wrapper)}`)).status).toBe(200);
    });
  });

  describe("search and by-kind-tag", () => {
    // Elasticity notes in micro (tagged homework), Growth in another course, an unplaced file.
    async function seed() {
      const t = await make("track", "quant");
      const c = await make("course", "micro", { container_id: t.id });
      const other = await make("course", "macro");
      const n = await note("Elasticity notes", c.id, "price elasticity of demand");
      const g = await note("Growth", other.id, "solow model");
      await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "homework" });
      const loose = await note("Elasticity scratch", undefined, "elasticity too");
      return { t, c, other, n, g, loose };
    }

    it("search filters by text, scope and kind tag, and never lists an unplaced node", async () => {
      const { t, c, other, n, loose } = await seed();

      const byText = await call("GET", "/api/ws/search?q=elasticity");
      expect(byText.status).toBe(200);
      expect(nodeIds(byText.body)).toEqual([n.id]);
      expect(byText.body[0]).toMatchObject({ name: "Elasticity notes", container_id: c.id });
      expect(nodeIds(byText.body)).not.toContain(loose.id);

      expect(nodeIds((await call("GET", `/api/ws/search?scope=${t.id}&kind_tag=homework`)).body)).toEqual([n.id]);
      expect((await call("GET", `/api/ws/search?scope=${other.id}&kind_tag=homework`)).body).toEqual([]);
      // A custom tag is as good as a suggested one.
      expect((await call("GET", "/api/ws/search?kind_tag=lecture-notes")).body).toEqual([]);
    });

    it("empty query parameters mean not given", async () => {
      const { c, other } = await seed();
      const empty = await call("GET", "/api/ws/search?q=&scope=&kind_tag=");
      expect(empty.status).toBe(200);
      // Every live placement: micro in the track, and the two files. (macro sits at the top, in no container, so it has none.)
      expect(empty.body.map((r: { name: string }) => r.name).sort()).toEqual(["Elasticity notes", "Growth", "micro"].sort());
      expect((await call("GET", "/api/ws/search?q=growth&scope=")).body).toHaveLength(1);
      expect(nodeIds((await call("GET", `/api/ws/search?scope=${c.id}&kind_tag=`)).body)).toHaveLength(1);
      expect((await call("GET", `/api/ws/search?scope=${other.id}&q=`)).body).toHaveLength(1);
    });

    it("a parameter given twice is a 400, as is an invalid tag", async () => {
      await seed();
      for (const url of ["/api/ws/search?q=a&q=b", "/api/ws/search?scope=x&scope=y", "/api/ws/search?kind_tag=source&kind_tag=test", "/api/ws/search?q=&q="]) {
        const res = await call("GET", url);
        expect(res.status, url).toBe(400);
        expect(res.body.error, url).toBe("invalid_input");
      }
      const bad = await call("GET", "/api/ws/search?kind_tag=Not%20A%20Tag");
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("invalid_input");
    });

    it("by-kind-tag lists the files carrying a tag, workspace-wide or inside a scope", async () => {
      const { t, c, other } = await seed();
      const second = await make("file", "PS2", { format: "markdown", container_id: other.id, kind_tag: "homework" });

      const all = await call("GET", "/api/ws/by-kind-tag?tag=homework");
      expect(all.status).toBe(200);
      expect(all.body.map((r: { name: string }) => r.name)).toEqual(["Elasticity notes", "PS2"]);
      expect(all.body[0]).toMatchObject({ container_id: c.id });
      expect(typeof all.body[0].placement_id).toBe("string");

      expect(all.body.length).toBe(2);
      expect(nodeIds((await call("GET", `/api/ws/by-kind-tag?tag=homework&scope=${other.id}`)).body)).toEqual([second.id]);
      expect((await call("GET", `/api/ws/by-kind-tag?tag=homework&scope=${t.id}`)).body).toHaveLength(1);
      // An empty scope is no scope.
      expect((await call("GET", "/api/ws/by-kind-tag?tag=homework&scope=")).body).toHaveLength(2);
    });

    it("by-kind-tag wants exactly one valid tag", async () => {
      await seed();
      for (const url of ["/api/ws/by-kind-tag", "/api/ws/by-kind-tag?tag=", "/api/ws/by-kind-tag?tag=a&tag=b", "/api/ws/by-kind-tag?tag=Bad%21", "/api/ws/by-kind-tag?tag=x&scope=a&scope=b"]) {
        const res = await call("GET", url);
        expect(res.status, url).toBe(400);
        expect(res.body.error, url).toBe("invalid_input");
      }
    });
  });

  describe("error bodies", () => {
    it("carry {error, message}, and a detail only when the domain gave one", async () => {
      const missing = await call("GET", "/api/ws/nodes/nope");
      expect(Object.keys(missing.body).sort()).toEqual(["error", "message"]);

      const t = await make("track", "quant");
      const n = await note("n", t.id);
      await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "two", base_version: 1 });
      const stale = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "x", base_version: 1 });
      expect(Object.keys(stale.body).sort()).toEqual(["detail", "error", "message"]);
    });
  });
});
