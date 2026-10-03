import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
// suites; these pin the wire: routes, status codes, the {error, message}
// shape, and that everything Ben does over HTTP is authored "ben".

const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-ws-routes-"));

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
  const track = async (title: string) => (await call("POST", "/api/ws/nodes", { kind: "track", title })).body.node;
  const course = async (title: string, container_id?: string) =>
    (await call("POST", "/api/ws/nodes", { kind: "course", title, place_in: container_id ? { container_id } : undefined })).body.node;
  const note = async (title: string, container_id: string, body = "hello") =>
    (await call("POST", "/api/ws/nodes", { kind: "file", title, file: { type: "markdown", body }, place_in: { container_id } })).body;

  describe("creating and reading", () => {
    it("creates a track, then a course placed in it (201), and children lists the course", async () => {
      const t = await call("POST", "/api/ws/nodes", { kind: "track", title: "quant" });
      expect(t.status).toBe(201);
      expect(t.body.node).toMatchObject({ kind: "track", title: "quant" });
      expect(t.body.placement).toBeNull();

      const c = await call("POST", "/api/ws/nodes", { kind: "course", title: "micro", place_in: { container_id: t.body.node.id } });
      expect(c.status).toBe(201);
      expect(c.body.placement).toMatchObject({ container_id: t.body.node.id, child_id: c.body.node.id, name: "micro" });

      const kids = await call("GET", `/api/ws/nodes/${t.body.node.id}/children`);
      expect(kids.status).toBe(200);
      expect(kids.body.map((r: { name: string; node: { id: string } }) => [r.name, r.node.id])).toEqual([["micro", c.body.node.id]]);
    });

    it("roots, detail, courses and content read what the domain reads", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const n = (await note("unit notes", c.id, "# Elasticity")).node;

      const roots = await call("GET", "/api/ws/roots");
      expect(roots.status).toBe(200);
      expect(roots.body.tracks.map((x: { id: string }) => x.id)).toEqual([t.id]);
      expect(roots.body.courses.map((x: { id: string }) => x.id)).toEqual([c.id]); // every live course, placed or not
      expect(roots.body.unplaced).toEqual([]);

      const detail = await call("GET", `/api/ws/nodes/${n.id}`);
      expect(detail.body.node).toMatchObject({ id: n.id, kind: "file", type: "markdown" });
      expect(detail.body.parent_tracks).toEqual([{ id: t.id, title: "quant" }]);
      expect(detail.body.file).toMatchObject({ type: "markdown", revision: 1, saved_by: "ben" });

      const courses = await call("GET", `/api/ws/nodes/${t.id}/courses`);
      expect(courses.body.map((r: { node: { id: string }; path: string[] }) => [r.node.id, r.path])).toEqual([[c.id, ["micro"]]]);

      const content = await call("GET", `/api/ws/nodes/${n.id}/content`);
      expect(content.body).toMatchObject({ type: "markdown", body: "# Elasticity", revision: 1, saved_by: "ben" });
    });

    it("lists the registered file types, markdown among them", async () => {
      const res = await call("GET", "/api/ws/file-types");
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual({ type: "markdown", storage: "text", appendable: true });
      expect(res.body).toContainEqual({ type: "graph", storage: "text", appendable: false });
      // The wire carries only what the app needs to choose a renderer.
      for (const t of res.body) expect(Object.keys(t).sort()).toEqual(["appendable", "storage", "type"]);
    });

    it("signs every write Ben's, whatever the body claims", async () => {
      const t = await track("quant");
      const created = await call("POST", "/api/ws/nodes", {
        kind: "file",
        title: "plan",
        author: "planner",
        file: { type: "markdown", body: "x" },
        place_in: { container_id: t.id },
      });
      expect(created.status).toBe(201);
      const id = created.body.node.id;
      expect((await call("GET", `/api/ws/nodes/${id}/content`)).body.saved_by).toBe("ben");

      const saved = await call("PUT", `/api/ws/nodes/${id}/content`, { body: "y", base_revision: 1, author: "tutor" });
      expect(saved.status).toBe(200);
      expect(saved.body.revision).toBe(2);
      expect((await call("GET", `/api/ws/nodes/${id}/content`)).body).toMatchObject({ body: "y", saved_by: "ben" });
    });
  });

  describe("content", () => {
    it("PUT content with a stale revision is a 409 stale_revision, and the message names the current one", async () => {
      const t = await track("quant");
      const n = (await note("n", t.id)).node;
      expect((await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "two", base_revision: 1 })).status).toBe(200);

      const stale = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "three", base_revision: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe("stale_revision");
      expect(stale.body.message).toMatch(/current revision is 2/);
      expect(stale.body.detail).toEqual({ current_revision: 2 });
      expect((await call("GET", `/api/ws/nodes/${n.id}/content`)).body.body).toBe("two");
    });

    it("PUT content wants a body and a base revision; neither is guessed", async () => {
      const t = await track("quant");
      const n = (await note("n", t.id)).node;
      const noBase = await call("PUT", `/api/ws/nodes/${n.id}/content`, { body: "x" });
      expect(noBase.status).toBe(400);
      expect(noBase.body.error).toBe("invalid_input");
      const noBody = await call("PUT", `/api/ws/nodes/${n.id}/content`, { base_revision: 1 });
      expect(noBody.status).toBe(400);
      expect(noBody.body.error).toBe("invalid_input");
    });

    it("content of a folder is a 400, of a missing node a 404", async () => {
      const t = await track("quant");
      expect((await call("GET", `/api/ws/nodes/${t.id}/content`)).status).toBe(400);
      const missing = await call("GET", "/api/ws/nodes/nope/content");
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("not_found");
      expect(typeof missing.body.message).toBe("string");
    });
  });

  describe("placements", () => {
    it("places a node under a chosen name (201), renames it there, and moves it", async () => {
      const t = await track("quant");
      const a = await course("micro");
      const b = await course("macro");
      const n = (await note("n", a.id)).node;

      const placed = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: a.id, name: "Year 1 micro" });
      expect(placed.status).toBe(201);
      expect(placed.body).toMatchObject({ container_id: t.id, child_id: a.id, name: "Year 1 micro" });

      const renamed = await call("PATCH", `/api/ws/placements/${placed.body.id}`, { name: "Micro" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe("Micro");
      expect((await call("GET", `/api/ws/nodes/${a.id}`)).body.node.title).toBe("micro"); // the title is untouched

      const filePlacement = (await call("GET", `/api/ws/nodes/${a.id}/children`)).body[0].placement_id;
      const moved = await call("PATCH", `/api/ws/placements/${filePlacement}`, { container_id: b.id });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ id: filePlacement, container_id: b.id, child_id: n.id });
      expect((await call("GET", `/api/ws/nodes/${b.id}/children`)).body.map((r: { name: string }) => r.name)).toEqual(["n"]);
    });

    it("a placement that would make a cycle is a 400 cycle_rejected", async () => {
      const a = (await call("POST", "/api/ws/nodes", { kind: "track", title: "a" })).body.node;
      const b = (await call("POST", "/api/ws/nodes", { kind: "track", title: "b", place_in: { container_id: a.id } })).body.node;
      const cycle = await call("POST", "/api/ws/placements", { container_id: b.id, child_id: a.id });
      expect(cycle.status).toBe(400);
      expect(cycle.body.error).toBe("cycle_rejected");
      expect(typeof cycle.body.message).toBe("string");
    });

    it("names collide as a 400 name_taken carrying the free name", async () => {
      const t = await track("quant");
      await course("micro", t.id);
      const other = await course("micro");
      const taken = await call("POST", "/api/ws/placements", { container_id: t.id, child_id: other.id });
      expect(taken.status).toBe(400);
      expect(taken.body.error).toBe("name_taken");
      expect(taken.body.detail).toEqual({ suggestion: "micro (2)" });
    });

    it("a rename and a move together are all-or-nothing", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const folder = (await call("POST", "/api/ws/nodes", { kind: "folder", title: "f", place_in: { container_id: t.id } })).body.node;
      const n = (await note("n", c.id)).node;
      await note("taken", folder.id);
      const placementId = (await call("GET", `/api/ws/nodes/${c.id}/children`)).body[0].placement_id;
      // The move would succeed, the rename collides in the destination: neither happens.
      const res = await call("PATCH", `/api/ws/placements/${placementId}`, { container_id: folder.id, name: "taken" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name_taken");
      expect((await call("GET", `/api/ws/nodes/${c.id}/children`)).body.map((r: { node: { id: string } }) => r.node.id)).toEqual([n.id]);
    });

    it("an empty placement patch is a 400, and a missing placement a 404", async () => {
      const t = await track("quant");
      await course("micro", t.id);
      const placementId = (await call("GET", `/api/ws/nodes/${t.id}/children`)).body[0].placement_id;
      expect((await call("PATCH", `/api/ws/placements/${placementId}`, {})).status).toBe(400);
      expect((await call("PATCH", "/api/ws/placements/nope", { name: "x" })).status).toBe(404);
      expect((await call("DELETE", "/api/ws/placements/nope")).status).toBe(404);
    });

    it("POST placements validates its ids instead of failing inside the database", async () => {
      const t = await track("quant");
      const res = await call("POST", "/api/ws/placements", { container_id: t.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_input");
    });

    it("DELETE a placement removes it from here; the node lives on and says it is unplaced", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const placementId = (await call("GET", `/api/ws/nodes/${t.id}/children`)).body[0].placement_id;

      const removed = await call("DELETE", `/api/ws/placements/${placementId}`);
      expect(removed.status).toBe(200);
      expect(removed.body.became_unplaced).toBe(true);
      expect(removed.body.removed).toMatchObject({ id: placementId, child_id: c.id });
      // Still a live node, now a root course; nothing is in the trash.
      expect((await call("GET", `/api/ws/nodes/${c.id}`)).body.node.trashed_at).toBeNull();
      expect((await call("GET", "/api/ws/roots")).body.courses.map((x: { id: string }) => x.id)).toEqual([c.id]);
      expect((await call("GET", "/api/ws/trash")).body).toEqual([]);
    });

    it("DELETE a placement that is not the last one is not unplaced", async () => {
      const t1 = await track("quant");
      const t2 = await track("amc");
      const c = await course("micro", t1.id);
      await call("POST", "/api/ws/placements", { container_id: t2.id, child_id: c.id });
      const placementId = (await call("GET", `/api/ws/nodes/${t1.id}/children`)).body[0].placement_id;
      expect((await call("DELETE", `/api/ws/placements/${placementId}`)).body.became_unplaced).toBe(false);
    });
  });

  describe("renaming and tagging", () => {
    it("PATCH a node renames its title; everywhere carries the placements that still wear it", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const renamed = await call("PATCH", `/api/ws/nodes/${c.id}`, { title: "microeconomics", everywhere: true });
      expect(renamed.status).toBe(200);
      expect(renamed.body.title).toBe("microeconomics");
      expect((await call("GET", `/api/ws/nodes/${t.id}/children`)).body[0].name).toBe("microeconomics");

      const quiet = await call("PATCH", `/api/ws/nodes/${c.id}`, { title: "micro" });
      expect(quiet.body.title).toBe("micro");
      expect((await call("GET", `/api/ws/nodes/${t.id}/children`)).body[0].name).toBe("microeconomics");
    });

    it("PATCH sets and clears a kind tag; an unknown tag, an empty patch and a bad title are 400s", async () => {
      const t = await track("quant");
      const n = (await note("n", t.id)).node;
      const tagged = await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "homework" });
      expect(tagged.status).toBe(200);
      expect(tagged.body.kind_tag).toBe("homework");
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: null })).body.kind_tag).toBeNull();

      const bad = await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "nonsense" });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("invalid_input");
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`, {})).status).toBe(400);
      expect((await call("PATCH", `/api/ws/nodes/${n.id}`, { title: 7 })).status).toBe(400);
      expect((await call("PATCH", "/api/ws/nodes/nope", { title: "x" })).status).toBe(404);
    });

    it("a title and a tag together land together or not at all", async () => {
      const t = await track("quant");
      const n = (await note("n", t.id)).node;
      const bad = await call("PATCH", `/api/ws/nodes/${n.id}`, { title: "renamed", kind_tag: "nonsense" });
      expect(bad.status).toBe(400);
      expect((await call("GET", `/api/ws/nodes/${n.id}`)).body.node.title).toBe("n");
    });
  });

  describe("destroying, the trash, search", () => {
    it("DELETE a node trashes it and the trash lists it; restore brings it back", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);

      const gone = await call("DELETE", `/api/ws/nodes/${c.id}`);
      expect(gone.status).toBe(200);
      expect(gone.body.trashed).toEqual([c.id]);
      expect((await call("GET", `/api/ws/nodes/${t.id}/children`)).body).toEqual([]);

      const trash = await call("GET", "/api/ws/trash");
      expect(trash.body.map((x: { id: string }) => x.id)).toEqual([c.id]);
      expect(trash.body[0].trashed_at).not.toBeNull();

      const back = await call("POST", `/api/ws/trash/${c.id}/restore`);
      expect(back.status).toBe(200);
      expect(back.body.restored).toBe(c.id);
      expect((await call("GET", "/api/ws/trash")).body).toEqual([]);
      expect((await call("GET", `/api/ws/nodes/${t.id}/children`)).body).toHaveLength(1);
    });

    it("with_orphans=true takes along what would be left unplaced; without it they stay", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const n = (await note("n", c.id)).node;
      const plain = await call("DELETE", `/api/ws/nodes/${c.id}`);
      expect(plain.body.trashed).toEqual([c.id]);
      await call("POST", `/api/ws/trash/${c.id}/restore`);

      const withOrphans = await call("DELETE", `/api/ws/nodes/${c.id}?with_orphans=true`);
      expect(withOrphans.status).toBe(200);
      expect(withOrphans.body.trashed).toEqual([c.id, n.id]);
    });

    it("purge only takes what is already trashed; restoring a live node is a 400", async () => {
      const t = await track("quant");
      const live = await call("DELETE", `/api/ws/trash/${t.id}`);
      expect(live.status).toBe(400);
      expect(live.body.error).toBe("not_trashed");
      expect((await call("POST", `/api/ws/trash/${t.id}/restore`)).body.error).toBe("not_trashed");

      await call("DELETE", `/api/ws/nodes/${t.id}`);
      const purged = await call("DELETE", `/api/ws/trash/${t.id}`);
      expect(purged.status).toBe(200);
      expect(purged.body.purged).toBe(t.id);
      expect((await call("GET", `/api/ws/nodes/${t.id}`)).status).toBe(404);
    });

    it("an upload appears unplaced the moment it exists; deleting the upload trashes its wrapper and the purge goes through", async () => {
      const asset = await createAsset(db, uploadsDir, { title: "syllabus", type: "text", content: "week 1" }, "human");
      const wrapper = `asset:${asset.id}`;
      const roots = await call("GET", "/api/ws/roots");
      expect(roots.body.unplaced.map((x: { id: string }) => x.id)).toContain(wrapper);

      // While the upload exists the wrapper can't be purged, even from the trash.
      await call("DELETE", `/api/ws/nodes/${encodeURIComponent(wrapper)}`);
      const refused = await call("DELETE", `/api/ws/trash/${encodeURIComponent(wrapper)}`);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("asset_in_use");

      deleteAsset(db, uploadsDir, asset.id);
      const purged = await call("DELETE", `/api/ws/trash/${encodeURIComponent(wrapper)}`);
      expect(purged.status).toBe(200);
      expect(purged.body.purged).toBe(wrapper);
    });

    it("search filters by text, scope and kind tag; empty parameters mean absent", async () => {
      const t = await track("quant");
      const c = await course("micro", t.id);
      const other = await course("macro");
      const n = (await note("Elasticity notes", c.id, "price elasticity of demand")).node;
      await note("Growth", other.id, "solow model");
      await call("PATCH", `/api/ws/nodes/${n.id}`, { kind_tag: "homework" });

      const byText = await call("GET", "/api/ws/search?q=elasticity");
      expect(byText.status).toBe(200);
      expect(byText.body.map((r: { node: { id: string } }) => r.node.id)).toEqual([n.id]);
      expect(byText.body[0]).toMatchObject({ name: "Elasticity notes", container_id: c.id });

      const scoped = await call("GET", `/api/ws/search?scope=${t.id}&kind_tag=homework`);
      expect(scoped.body.map((r: { node: { id: string } }) => r.node.id)).toEqual([n.id]);
      const scopedOther = await call("GET", `/api/ws/search?scope=${other.id}&kind_tag=homework`);
      expect(scopedOther.body).toEqual([]);

      const emptyParams = await call("GET", "/api/ws/search?q=&scope=&kind_tag=");
      expect(emptyParams.status).toBe(200);
      expect(emptyParams.body.length).toBeGreaterThanOrEqual(4);

      expect((await call("GET", "/api/ws/search?kind_tag=nonsense")).status).toBe(400);
      expect((await call("GET", "/api/ws/search?scope=nope")).status).toBe(404);
    });
  });
});
