# Workspace Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workspace's data layer and a plain shell frame, so another agent can add special file types (item files, long-lived documents such as USERNOTES) by registering them, without touching the shell.

**Architecture:** Every track, course, folder and file is a `ws_node`. A `ws_placement` is an edge `container → child` that carries the local name. File content lives in `ws_file` under a registered `type`, and each save writes a `ws_file_revision` recording its author (ben, tutor or planner). The server exposes `/api/ws/*`; a local node forwards those calls to canonical. MCP tools let the tutor and the planner read and write. In the web app, a "Workspace" rail entry opens a full-window shell: a picker, then a sidebar tree, a tab bar, and a center pane that renders each file through a file-type registry.

**Tech Stack:** Node 24 `node:sqlite` (`DatabaseSync`), Fastify 5, `@modelcontextprotocol/sdk`, zod, vitest 3 (server); React + Vite + TypeScript (web, no router: page state in `App.tsx`).

**Spec:** Learn repo `spec/osmosis/workspace/01-shell.md`, especially §2–§5, §7–§9, §12 and §17. Ben's verbatim brief is `brief-2026-10-03-shell.md` and his answers are `ruling-2026-10-03-shell-answers.md`. The brief wins over `01-shell.md`.

## Global Constraints

- Branch `workspace/frame` (worktree `.claude/worktrees/workspace-frame`), stacked on `stage-2a/retention-loop`. The new migration is **`023_workspace.sql`**.
- **Other Claude sessions share this repo** (graph-engine worktrees `milestone-a*`). Use `git add <explicit paths>` only. Never stash, pop or drop. Don't touch `graph-engine/`, `review/` or other worktrees.
- Tests: `cd server && npx vitest run --maxWorkers=2 <file>`. The full suite is `npx vitest run --maxWorkers=2` (about 95 s; baseline 526 passing). Typecheck: `cd server && npx tsc -p tsconfig.json --noEmit`, and in web `cd web && npx tsc -b && npx vitest run`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (implementers) / `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (controller).
- Code style: match the surrounding code. Comments explain *why*, in full sentences. DomainError codes are snake_case. SQL is in template strings.
- **Placement rules (spec §3), non-negotiable:**
  - Remove-from-here and destroy are different operations and never share a button or an endpoint.
  - Removing a node's last placement leaves it **unplaced**. It is never destroyed.
  - Names live on placements, and a rename-here touches one placement.
  - Cycles are refused when a placement is created, counting hidden placements of trashed nodes too.
- **Containment (§4):** track holds track, course, folder, file. Course holds folder, file. Folder holds course, folder, file.
- **Names:** NFC-normalized, trimmed, 1–200 codepoints, no `/`, no control characters (U+0000–U+001F, U+007F). Unique among the **live** placements of a container, compared case-insensitively (`toLocaleLowerCase('en')`).
- **Authors:** `'ben' | 'tutor' | 'planner'`. The HTTP app writes as `ben`. MCP write tools require `as: 'tutor' | 'planner'`.
- **Kind tags:** `'source' | 'resource' | 'homework' | 'test' | 'flowchart'`, or null. One per file node (Ben, §15 #8).
- **No advanced UI** (Ben): no drag-and-drop, no rooting UI, no search UI beyond the partition chips, and no styling polish beyond reusing the app's existing CSS variables.
- Directed mode **guides, never limits** (Ben, §15 #4): nothing in the shell gates or collapses tabs.

---

## File Structure

**Server, new:**
- `server/migrations/023_workspace.sql`: the four tables.
- `server/src/domain/workspace/types.ts`: shared types and constants.
- `server/src/domain/workspace/fileTypes.ts`: the server half of the file-type registry, plus the built-ins (`markdown`, `graph`, `asset`).
- `server/src/domain/workspace/names.ts`: name normalization and validation.
- `server/src/domain/workspace/graph.ts`: writes. Create, place, rename, move, remove, destroy, restore, purge, set kind tag; containment and cycle checks.
- `server/src/domain/workspace/reads.ts`: reads. getNode, roots, children, appearsIn, parentTracks, reach, coursesIn, search, unplaced, trash.
- `server/src/domain/workspace/content.ts`: readContent, saveContent (optimistic revision), appendContent.
- `server/src/domain/workspace/assetFiles.ts`: `syncAssetFiles`, which keeps one unplaced `asset` file per upload.
- `server/src/domain/workspace/index.ts`: re-exports.
- `server/src/http/workspaceRoutes.ts`: `/api/ws/*`.
- `server/src/mcp/workspaceTools.ts`: MCP tools.
- `server/tests/workspaceGraph.test.ts`, `workspaceReads.test.ts`, `workspaceContent.test.ts`, `workspaceRoutes.test.ts`, `workspaceMcp.test.ts`.

**Server, modified:**
- `server/src/http/app.ts`: register the routes.
- `server/src/http/liveProxy.ts`: forward `/api/ws/`.
- `server/src/mcp/tools.ts`: call the workspace registrar; add the tools to `PRESENTER_TOOLS`.
- `server/src/protocol.ts`: `TOOLS_VERSION` 8 → 9.
- `server/tests/itemChannel.test.ts`: the version assertion.
- The presenter-scope test: the list.

**Web, new:**
- `web/src/workspace/wsApi.ts`: the typed API client.
- `web/src/workspace/fileTypes.tsx`: the web half of the registry, plus the built-ins.
- `web/src/workspace/tabs.ts`: a pure tab-state reducer (tested).
- `web/src/workspace/Workspace.tsx`: the shell (header, sidebar, tabs, center), plus the workspace stack.
- `web/src/workspace/Picker.tsx`, `Sidebar.tsx`, `Tree.tsx`, `CenterPane.tsx`, `MarkdownFile.tsx`.
- `web/src/workspace/workspace.css`.
- `web/src/workspace/tabs.test.ts`, `fileTypes.test.ts`.

**Web, modified:**
- `web/src/components/Rail.tsx`: the `workspace` page.
- `web/src/App.tsx`: render the shell full-window, with the rail hidden.

**Docs:**
- `docs/workspace/FILE-TYPES.md`: the guide for the agent who builds special file types.
- `MCP-SPEC.md`: tool rows and the workspace section.

---

### Task 1: Migration, types, names, file-type registry

**Files:**
- Create: `server/migrations/023_workspace.sql`, `server/src/domain/workspace/types.ts`, `server/src/domain/workspace/names.ts`, `server/src/domain/workspace/fileTypes.ts`
- Test: `server/tests/workspaceGraph.test.ts` (the first describe blocks)

**Interfaces — Produces:**
```ts
// types.ts
export type NodeKind = "track" | "course" | "folder" | "file";
export type KindTag = "source" | "resource" | "homework" | "test" | "flowchart";
export type Author = "ben" | "tutor" | "planner";
export const NODE_KINDS: readonly NodeKind[]; export const KIND_TAGS: readonly KindTag[]; export const AUTHORS: readonly Author[];
export const CONTAINER_KINDS: readonly NodeKind[]; // ["track","course","folder"]
export const MAY_HOLD: Record<NodeKind, readonly NodeKind[]>; // §4 matrix; file: []
export interface NodeRow { id: string; kind: NodeKind; title: string; kind_tag: KindTag | null; created_at: string; updated_at: string; trashed_at: string | null }
export interface PlacementRow { id: string; container_id: string; child_id: string; name: string; created_at: string }
export interface FileRow { node_id: string; type: string; body: string | null; asset_id: string | null; revision: number; saved_at: string; saved_by: Author }
// names.ts
export function normalizeName(raw: string): string;          // throws DomainError("invalid_name")
export function sameName(a: string, b: string): boolean;     // case-insensitive, NFC
// fileTypes.ts
export interface FileTypeSpec { type: string; storage: "text" | "json" | "asset"; appendable: boolean; kinds(body: string | null): string[]; validate?(body: string | null): string | null; searchText?(body: string | null): string; }
export function registerFileType(spec: FileTypeSpec): void;  // throws on duplicate type
export function getFileType(type: string): FileTypeSpec;     // throws DomainError("unknown_file_type")
export function listFileTypes(): FileTypeSpec[];
export function classOf(kinds: string[]): "document" | "graph" | "flowchart" | "spreadsheet" | "code" | "mixed" | "empty";
```

- [ ] **Step 1: Write the migration** `server/migrations/023_workspace.sql`:

```sql
-- The workspace (Learn spec/osmosis/workspace/01-shell.md §2). Every track,
-- course, folder and file is a node; a placement is an edge that says "this
-- node appears in this container, under this name". A node has no primary
-- parent — that is the point (the brief: "every primary parent is a lie
-- somewhere"). Containment, cycles and name uniqueness are enforced in
-- domain/workspace/graph.ts: they depend on live vs. trashed nodes and on
-- Unicode case folding, neither of which a SQLite constraint can see.

CREATE TABLE ws_node (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('track', 'course', 'folder', 'file')),
    title       TEXT NOT NULL,
    kind_tag    TEXT CHECK (kind_tag IN ('source', 'resource', 'homework', 'test', 'flowchart')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    trashed_at  TEXT
);
CREATE INDEX ws_node_live_kind ON ws_node (kind) WHERE trashed_at IS NULL;

CREATE TABLE ws_placement (
    id           TEXT PRIMARY KEY,
    container_id TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    child_id     TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (container_id, child_id)
);
CREATE INDEX ws_placement_child ON ws_placement (child_id);

-- Content, files only. `type` names a registered file type
-- (domain/workspace/fileTypes.ts): the built-ins are markdown, graph and
-- asset; special types (item files, USERNOTES …) are added by registering.
CREATE TABLE ws_file (
    node_id   TEXT PRIMARY KEY REFERENCES ws_node (id) ON DELETE CASCADE,
    type      TEXT NOT NULL,
    body      TEXT,
    asset_id  TEXT REFERENCES asset (id) ON DELETE SET NULL,
    revision  INTEGER NOT NULL DEFAULT 1,
    saved_at  TEXT NOT NULL DEFAULT (datetime('now')),
    saved_by  TEXT NOT NULL DEFAULT 'ben' CHECK (saved_by IN ('ben', 'tutor', 'planner'))
);

-- One row per save, so every revision says who wrote it: Ben, the tutor
-- (who teaches, and writes its notes about Ben into a unit's USERNOTES) or
-- the planner (who writes the plan). Retention: all kept for now.
CREATE TABLE ws_file_revision (
    node_id   TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    revision  INTEGER NOT NULL,
    type      TEXT NOT NULL,
    body      TEXT,
    asset_id  TEXT,
    saved_at  TEXT NOT NULL,
    saved_by  TEXT NOT NULL CHECK (saved_by IN ('ben', 'tutor', 'planner')),
    PRIMARY KEY (node_id, revision)
);
```

- [ ] **Step 2: Write `types.ts`**, exactly the interfaces above, with:
  `MAY_HOLD = { track: ["track","course","folder","file"], course: ["folder","file"], folder: ["course","folder","file"], file: [] }`.

- [ ] **Step 3: Write the failing tests** in `server/tests/workspaceGraph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName, sameName } from "../src/domain/workspace/names.js";
import { getFileType, registerFileType, classOf } from "../src/domain/workspace/fileTypes.js";
import { DomainError } from "../src/domain/errors.js";

describe("names", () => {
  it("normalizes to NFC and trims", () => {
    expect(normalizeName("  Café notes ")).toBe("Café notes");
  });
  it("refuses empty, slash, control characters and over-long names", () => {
    for (const bad of ["", "   ", "a/b", "a\u0007b", "x".repeat(201)]) {
      expect(() => normalizeName(bad)).toThrow(DomainError);
    }
    expect(normalizeName("x".repeat(200))).toHaveLength(200);
  });
  it("compares case-insensitively beyond ASCII", () => {
    expect(sameName("Ελαστικότητα", "ΕΛΑΣΤΙΚΌΤΗΤΑ")).toBe(true);
    expect(sameName("notes", "Notes ")).toBe(true);
    expect(sameName("notes", "note")).toBe(false);
  });
});

describe("file types", () => {
  it("has the three built-ins", () => {
    expect(getFileType("markdown")).toMatchObject({ storage: "text", appendable: true });
    expect(getFileType("markdown").kinds("# hi")).toEqual(["text"]);
    expect(getFileType("graph").kinds("y = x^2")).toEqual(["plot"]);
    expect(getFileType("asset").storage).toBe("asset");
  });
  it("refuses an unknown type and a duplicate registration", () => {
    expect(() => getFileType("nope")).toThrow(DomainError);
    expect(() => registerFileType({ type: "markdown", storage: "text", appendable: true, kinds: () => ["text"] })).toThrow();
  });
  it("derives class from page kinds (graph-engine spec, Classification)", () => {
    expect(classOf(["text"])).toBe("document");
    expect(classOf(["plot"])).toBe("graph");
    expect(classOf(["space", "figure"])).toBe("graph");
    expect(classOf(["flow"])).toBe("flowchart");
    expect(classOf(["sheet"])).toBe("spreadsheet");
    expect(classOf(["code"])).toBe("code");
    expect(classOf(["text", "flow"])).toBe("mixed");
    expect(classOf([])).toBe("empty");
  });
});
```

- [ ] **Step 4: Run them; they fail** (modules missing): `cd server && npx vitest run --maxWorkers=2 tests/workspaceGraph.test.ts`.

- [ ] **Step 5: Implement `names.ts`:**

```ts
import { DomainError } from "../errors.js";

// The text-encoding standard both engines obey (NFC on ingest), plus what a
// folder export needs: no "/", no control characters, and a length a
// filesystem accepts. Length counts codepoints, not UTF-16 units.
export function normalizeName(raw: string): string {
  const name = (raw ?? "").normalize("NFC").trim();
  const length = [...name].length;
  if (length === 0) throw new DomainError("invalid_name", "A name can't be empty.");
  if (length > 200) throw new DomainError("invalid_name", "A name is at most 200 characters.");
  if (name.includes("/")) throw new DomainError("invalid_name", 'A name can\'t contain "/".');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new DomainError("invalid_name", "A name can't contain control characters.");
  return name;
}

// Case-insensitive the way Windows and macOS are, so a folder export never
// produces two paths that collide on disk. SQLite's NOCASE folds ASCII only.
export function sameName(a: string, b: string): boolean {
  return a.normalize("NFC").trim().toLocaleLowerCase("en") === b.normalize("NFC").trim().toLocaleLowerCase("en");
}
```

- [ ] **Step 6: Implement `fileTypes.ts`:**

```ts
import { DomainError } from "../errors.js";

// The server half of the file-type registry (spec §17). A type says how its
// content is stored, which page kinds it holds (for class), whether an
// agent may append to it, and optionally how to validate it and what search
// should read. Adding a special type — an item file, USERNOTES — is one
// registerFileType call here and one registration in web/src/workspace/
// fileTypes.tsx; see docs/workspace/FILE-TYPES.md.
export interface FileTypeSpec {
  type: string;
  storage: "text" | "json" | "asset";
  appendable: boolean;
  kinds(body: string | null): string[];
  validate?(body: string | null): string | null;
  searchText?(body: string | null): string;
}

const registry = new Map<string, FileTypeSpec>();

export function registerFileType(spec: FileTypeSpec): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(spec.type)) throw new Error(`file type "${spec.type}" must be lowercase a-z, 0-9, "-"`);
  if (registry.has(spec.type)) throw new Error(`file type "${spec.type}" is already registered`);
  registry.set(spec.type, spec);
}

export function getFileType(type: string): FileTypeSpec {
  const spec = registry.get(type);
  if (!spec) throw new DomainError("unknown_file_type", `No file type "${type}" is registered.`);
  return spec;
}

export function listFileTypes(): FileTypeSpec[] {
  return [...registry.values()];
}

const FAMILY: Record<string, string> = { text: "document", plot: "graph", space: "graph", figure: "graph", flow: "flowchart", sheet: "spreadsheet", code: "code" };

// graph-engine spec, Classification: one family is that family's class,
// more than one is mixed. "empty" is a file whose type holds no pages (an
// asset, or a special type that declares none).
export function classOf(kinds: string[]): "document" | "graph" | "flowchart" | "spreadsheet" | "code" | "mixed" | "empty" {
  const families = new Set(kinds.map((k) => FAMILY[k] ?? "mixed"));
  if (families.size === 0) return "empty";
  if (families.size > 1) return "mixed";
  return [...families][0] as "document" | "graph" | "flowchart" | "spreadsheet" | "code" | "mixed";
}

// Built-ins. A bare one-page document is "the text is the document"
// (graph-engine spec, Container format): markdown is a text page, graph is a
// plot page in the graph_spec DSL. asset wraps an upload without copying it.
registerFileType({ type: "markdown", storage: "text", appendable: true, kinds: () => ["text"], searchText: (b) => b ?? "" });
registerFileType({ type: "graph", storage: "text", appendable: false, kinds: () => ["plot"], searchText: (b) => b ?? "" });
registerFileType({ type: "asset", storage: "asset", appendable: false, kinds: () => [] });
```

- [ ] **Step 7: Run the tests; they pass.** Also run `tests/retentionMigration.test.ts` to confirm 023 applies on top of 022.
- [ ] **Step 8: Commit** `feat(workspace): migration 023, types, names, file-type registry`.

---

### Task 2: Graph writes, the four rules

**Files:**
- Create: `server/src/domain/workspace/graph.ts`
- Test: `server/tests/workspaceGraph.test.ts` (append)

**Interfaces:**
- Consumes: Task 1.
- Produces:
```ts
export interface CreateNodeInput { kind: NodeKind; title: string; kind_tag?: KindTag | null; file?: { type: string; body?: string | null; asset_id?: string | null }; place_in?: { container_id: string; name?: string } ; author?: Author }
export function createNode(db, input: CreateNodeInput): { node: NodeRow; placement: PlacementRow | null };
export function placeNode(db, input: { container_id: string; child_id: string; name?: string }): PlacementRow;  // place also
export function renamePlacement(db, placementId: string, name: string): PlacementRow;                         // rename here
export function movePlacement(db, placementId: string, containerId: string): PlacementRow;                    // move
export function removePlacement(db, placementId: string): { removed: PlacementRow; became_unplaced: boolean }; // remove from here
export function renameNode(db, nodeId: string, title: string, opts?: { everywhere?: boolean }): NodeRow;     // title; everywhere also renames placements still equal to the old title
export function setKindTag(db, nodeId: string, tag: KindTag | null): NodeRow;
export function destroyNode(db, nodeId: string, opts?: { withOrphans?: boolean }): { trashed: string[] };    // to trash
export function restoreNode(db, nodeId: string): { restored: string; renamed: { placement_id: string; name: string }[] };
export function purgeNode(db, nodeId: string): { purged: string };   // must already be trashed
```
Every write runs in a `SAVEPOINT` (callers may already be in a transaction) and stamps `updated_at` on the nodes it changes.

**The rules, as the implementation must enforce them:**
1. **Containment.** `container.kind` must be a container kind (track, course or folder), and `child.kind` must be in `MAY_HOLD[container.kind]`. Otherwise `DomainError("containment_not_allowed", …)`.
2. **No placing into, or of, a trashed node:** `DomainError("trashed")`.
3. **Cycles.** Refuse with `DomainError("cycle_rejected")` if `child_id === container_id`, or if `child_id` is an ancestor of `container_id` across **all** placements (trashed nodes included):
```sql
WITH RECURSIVE up(id) AS (
  SELECT container_id FROM ws_placement WHERE child_id = ?      -- start: parents of the target container
  UNION
  SELECT p.container_id FROM ws_placement p JOIN up ON p.child_id = up.id
)
SELECT 1 FROM up WHERE id = ? LIMIT 1                            -- params: (container_id, child_id)
```
4. **Names.** `name ?? child.title` goes through `normalizeName`. Refuse with `DomainError("name_taken", "… try \"<name> (2)\"")` if a **live** sibling placement has `sameName`. Siblings are the container's placements whose child is not trashed, excluding the placement being renamed. The suggestion is the lowest free `name (n)`, n ≥ 2. Use a helper `freeName(db, containerId, name, exceptPlacementId?)` that also serves restore.
5. **Remove from here** deletes one placement. `became_unplaced` is true when the child has no placements left.
6. **Destroy** sets `trashed_at` on the node. With `withOrphans`, it also trashes every **direct child** placed nowhere else (its only placement is in this container), recursively for container children. It never deletes a placement.
7. **Restore** clears `trashed_at`. Any of the node's placements whose name now collides with a live sibling is renamed to `freeName(...)` and reported.
8. **Purge** requires `trashed_at` (`DomainError("not_trashed")`) and deletes the node row (placements, file and revisions cascade). Children placed only in it become unplaced as a consequence.
9. **Files.** `createNode` with `kind: "file"` requires `file.type` registered (`getFileType`) and runs `validate` if defined (non-null result → `DomainError("invalid_content", msg)`). It inserts `ws_file` revision 1 and a `ws_file_revision` row, `saved_by = author ?? "ben"`. `asset` storage requires an `asset_id` that exists. Non-file kinds with `file` given → `DomainError("invalid_input")`.

- [ ] **Step 1: Write the failing tests** (append to `workspaceGraph.test.ts`):

```ts
import { openTestDb } from "./helpers.js";
import { createNode, placeNode, renamePlacement, movePlacement, removePlacement, destroyNode, restoreNode, purgeNode, renameNode } from "../src/domain/workspace/graph.js";

function md(db: ReturnType<typeof openTestDb>, title: string, place_in?: { container_id: string; name?: string }) {
  return createNode(db, { kind: "file", title, file: { type: "markdown", body: `# ${title}` }, place_in });
}
const ids = (db: ReturnType<typeof openTestDb>, childId: string) =>
  (db.prepare("SELECT container_id, name FROM ws_placement WHERE child_id = ? ORDER BY name").all(childId) as { container_id: string; name: string }[]);

describe("rule 1 — remove means remove-from-here", () => {
  it("removing one placement leaves the others; the last one leaves the file unplaced, never destroyed", () => {
    const db = openTestDb();
    const track = createNode(db, { kind: "track", title: "quant" }).node;
    const course = createNode(db, { kind: "course", title: "micro", place_in: { container_id: track.id } }).node;
    const { node: notes, placement: inTrack } = md(db, "Elasticity notes", { container_id: track.id });
    const inCourse = placeNode(db, { container_id: course.id, child_id: notes.id, name: "Supporting material" });

    expect(removePlacement(db, inTrack!.id).became_unplaced).toBe(false);
    expect(ids(db, notes.id)).toEqual([{ container_id: course.id, name: "Supporting material" }]);
    expect(removePlacement(db, inCourse.id).became_unplaced).toBe(true);
    const row = db.prepare("SELECT trashed_at FROM ws_node WHERE id = ?").get(notes.id) as { trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
  });

  it("destroy trashes the node and keeps its placements hidden; restore brings them back; purge deletes", () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "unit-3" }).node;
    const { node } = md(db, "a", { container_id: folder.id });
    expect(destroyNode(db, node.id).trashed).toEqual([node.id]);
    expect(ids(db, node.id)).toHaveLength(1);
    md(db, "a", { container_id: folder.id }); // the name is free while the first is trashed
    const restored = restoreNode(db, node.id);
    expect(restored.renamed).toEqual([{ placement_id: expect.any(String), name: "a (2)" }]);
    destroyNode(db, node.id);
    purgeNode(db, node.id);
    expect(db.prepare("SELECT 1 FROM ws_node WHERE id = ?").get(node.id)).toBeUndefined();
  });

  it("destroying a container offers its orphans: only children placed nowhere else, and only when asked", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const only = md(db, "only-in-A", { container_id: a.id }).node;
    const shared = md(db, "shared", { container_id: a.id }).node;
    placeNode(db, { container_id: b.id, child_id: shared.id });
    expect(destroyNode(db, a.id).trashed).toEqual([a.id]);
    restoreNode(db, a.id);
    expect(destroyNode(db, a.id, { withOrphans: true }).trashed.sort()).toEqual([a.id, only.id].sort());
  });
});

describe("rule 2 — names live on placements", () => {
  it("renames one placement, leaves the others and the title", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "quant" }).node;
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    const { node, placement } = md(db, "Elasticity notes", { container_id: t.id });
    placeNode(db, { container_id: c.id, child_id: node.id });
    renamePlacement(db, placement!.id, "Supporting material");
    expect(ids(db, node.id).map((p) => p.name).sort()).toEqual(["Elasticity notes", "Supporting material"]);
    expect((db.prepare("SELECT title FROM ws_node WHERE id = ?").get(node.id) as { title: string }).title).toBe("Elasticity notes");
  });

  it("refuses a name a live sibling already has, case-insensitively, with a suggestion", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    md(db, "Notes", { container_id: f.id });
    expect(() => md(db, "notes", { container_id: f.id })).toThrow(/name_taken|Notes \(2\)|notes \(2\)/);
  });

  it("rename everywhere follows placements that still carry the old title, and only those", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "old", { container_id: a.id });
    const other = placeNode(db, { container_id: b.id, child_id: node.id, name: "custom" });
    renameNode(db, node.id, "new", { everywhere: true });
    expect(ids(db, node.id).map((p) => p.name).sort()).toEqual(["custom", "new"]);
    expect(placement && other).toBeTruthy();
  });
});

describe("rule 4 — cycles are refused at placement time", () => {
  it("refuses self, direct and indirect cycles, including through a trashed node", () => {
    const db = openTestDb();
    const t1 = createNode(db, { kind: "track", title: "t1" }).node;
    const t2 = createNode(db, { kind: "track", title: "t2", place_in: { container_id: t1.id } }).node;
    const t3 = createNode(db, { kind: "track", title: "t3", place_in: { container_id: t2.id } }).node;
    expect(() => placeNode(db, { container_id: t1.id, child_id: t1.id })).toThrow(/cycle/);
    expect(() => placeNode(db, { container_id: t2.id, child_id: t1.id })).toThrow(/cycle/);
    expect(() => placeNode(db, { container_id: t3.id, child_id: t1.id })).toThrow(/cycle/);
    destroyNode(db, t2.id);
    expect(() => placeNode(db, { container_id: t3.id, child_id: t1.id })).toThrow(/cycle|trashed/);
  });
});

describe("containment", () => {
  it("follows the matrix: no course or track inside a course, folders may hold courses", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c" }).node;
    const c2 = createNode(db, { kind: "course", title: "c2" }).node;
    const f = createNode(db, { kind: "folder", title: "Year 1" }).node;
    const file = md(db, "x").node;
    expect(() => placeNode(db, { container_id: c.id, child_id: t.id })).toThrow(/containment/);
    expect(() => placeNode(db, { container_id: c.id, child_id: c2.id })).toThrow(/containment/);
    expect(() => placeNode(db, { container_id: file.id, child_id: c.id })).toThrow(/containment/);
    expect(placeNode(db, { container_id: f.id, child_id: c.id })).toBeTruthy();
    expect(placeNode(db, { container_id: t.id, child_id: f.id })).toBeTruthy();
  });

  it("refuses an unregistered file type, and a file body the type rejects", () => {
    const db = openTestDb();
    expect(() => createNode(db, { kind: "file", title: "x", file: { type: "nope" } })).toThrow(/unknown_file_type|No file type/);
  });

  it("move re-parents one placement atomically and checks the destination like a new placement", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    movePlacement(db, placement!.id, b.id);
    expect(ids(db, node.id)).toEqual([{ container_id: b.id, name: "n" }]);
    const inner = createNode(db, { kind: "folder", title: "inner", place_in: { container_id: a.id } });
    expect(() => movePlacement(db, inner.placement!.id, inner.node.id)).toThrow(/cycle/);
  });
});
```

- [ ] **Step 2: Run; they fail** (no `graph.ts`).
- [ ] **Step 3: Implement `graph.ts`** to the rules above. Use `uuid` v4 ids, an `inSavepoint(db, name, fn)` helper (copy the one in `server/src/domain/retention.ts`), and `getNode(db, id)` returning the row or throwing `DomainError("not_found")`. A trashed node is "live: false" for name checks.
- [ ] **Step 4: Run; they pass.** Then `npx tsc -p tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(workspace): the four placement rules — place, rename here, move, remove from here, destroy, restore, purge`.

---

### Task 3: Reads, content, asset files

**Files:**
- Create: `server/src/domain/workspace/reads.ts`, `content.ts`, `assetFiles.ts`, `index.ts`
- Test: `server/tests/workspaceReads.test.ts`, `server/tests/workspaceContent.test.ts`

**Interfaces — Produces:**
```ts
// reads.ts
export interface NodeSummary { id: string; kind: NodeKind; title: string; kind_tag: KindTag | null; type: string | null; class: string | null; placement_count: number; has_children: boolean; trashed_at: string | null }
export interface ChildRow { placement_id: string; name: string; node: NodeSummary }
export interface AppearsInRow { placement_id: string; container: { id: string; kind: NodeKind; title: string }; name: string }
export function getNodeDetail(db, id): { node: NodeSummary; appears_in: AppearsInRow[]; parent_tracks: { id: string; title: string }[]; file: { type: string; revision: number; saved_at: string; saved_by: Author; asset_id: string | null } | null };
export function listRoots(db): { tracks: NodeSummary[]; courses: NodeSummary[]; unplaced: NodeSummary[] };   // tracks/courses: all live; unplaced: live nodes with no live-container placement, excluding tracks and courses
export function listChildren(db, containerId): ChildRow[];   // live children only; order: containers (track, course, folder) first, then files; natural sort on name (localeCompare with numeric: true)
export function appearsIn(db, nodeId): AppearsInRow[];       // live containers only
export function parentTracks(db, nodeId): { id: string; title: string }[];  // every track ancestor, through folders
export function reach(db, containerId): string[];            // live node ids reachable downward, excluding the root
export function coursesIn(db, trackId): { node: NodeSummary; path: string[] }[];  // courses in reach, with the placement names from the track down
export function searchWorkspace(db, opts: { q?: string; scope?: string; kind_tag?: KindTag }): { placement_id: string | null; name: string; node: NodeSummary; container_id: string | null }[];
export function listTrash(db): NodeSummary[];
// content.ts
export function readContent(db, nodeId): { type: string; body: string | null; asset_id: string | null; revision: number; saved_at: string; saved_by: Author };
export function saveContent(db, nodeId, input: { body: string | null; base_revision: number; author: Author }): { revision: number; saved_at: string };   // stale → DomainError("stale_revision") carrying current revision in message
export function appendContent(db, nodeId, input: { text: string; author: Author }): { revision: number };  // appendable text types only → DomainError("not_appendable")
export function listRevisions(db, nodeId): { revision: number; saved_at: string; saved_by: Author }[];
// assetFiles.ts
export function syncAssetFiles(db): void;  // one unplaced 'asset' file per asset, id `asset:<asset id>`; a wrapper whose asset is gone is trashed
```

**Behaviour:**
- **A live child** is a placement whose child is not trashed and whose container is not trashed.
- **`placement_count`** counts placements in live containers.
- **`has_children`** is true for containers with at least one live child.
- **`class`** = `classOf(getFileType(type).kinds(body))` for files, and null otherwise. For `asset` files it is `"pdf" | "image" | "link" | "document"`, from the asset's `mime` (`application/pdf` → pdf, `image/*` → image) and `type` (`url` → link, otherwise document).
- **Search**:
  - It matches `q` case-insensitively against placement name, node title, and `searchText(body)` for text types. For the frame this is plain JS filtering over rows from SQL. A personal bank is small, and FTS is a later step.
  - It returns **one row per live placement** within `reach(scope)`. With no scope, it also returns unplaced nodes, one row each, with `placement_id: null` and `name = title`.
  - `kind_tag` filters on the node.
- **`saveContent`**:
  - It checks `base_revision === current revision`. Otherwise it throws `DomainError("stale_revision", "… current revision is N")`.
  - It runs the type's `validate`.
  - It bumps the revision, writes the revision row with `saved_by`, and stamps the node's `updated_at`.
  - `appendContent` joins with `"\n\n"` when the body is non-empty, and needs no base revision. Appending is how the tutor adds to USERNOTES without clobbering Ben's edits.
- **`syncAssetFiles`** is idempotent:
  - It inserts missing wrapper nodes: `kind 'file'`, `title` = the asset's title, `kind_tag 'source'`, a `ws_file` row with `type 'asset'` and that `asset_id`, `saved_by 'ben'`.
  - It trashes wrappers whose `asset_id` became NULL.
  - `listRoots` and `searchWorkspace` call it first.

- [ ] **Step 1: Write failing tests** `server/tests/workspaceReads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { createNode, placeNode, removePlacement, destroyNode } from "../src/domain/workspace/graph.js";
import { listRoots, listChildren, appearsIn, parentTracks, reach, coursesIn, searchWorkspace, getNodeDetail } from "../src/domain/workspace/reads.js";

function file(db: ReturnType<typeof openTestDb>, title: string, container_id?: string, body = "body text") {
  return createNode(db, { kind: "file", title, file: { type: "markdown", body }, place_in: container_id ? { container_id } : undefined }).node;
}

describe("workspace reads", () => {
  it("children: containers first, then natural order by local name; trashed children hidden", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    file(db, "unit 10", c.id); file(db, "unit 2", c.id);
    const f = createNode(db, { kind: "folder", title: "zeta", place_in: { container_id: c.id } }).node;
    const gone = file(db, "gone", c.id);
    destroyNode(db, gone.id);
    expect(listChildren(db, c.id).map((r) => r.name)).toEqual(["zeta", "unit 2", "unit 10"]);
    expect(listChildren(db, c.id)[0].node.id).toBe(f.id);
  });

  it("appears-in lists every live placement; it drives the badge (placement_count)", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "quant" }).node;
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    const n = file(db, "Elasticity notes", t.id);
    placeNode(db, { container_id: c.id, child_id: n.id, name: "Supporting material" });
    expect(appearsIn(db, n.id).map((r) => `${r.container.title}/${r.name}`).sort()).toEqual(["micro/Supporting material", "quant/Elasticity notes"]);
    expect(listChildren(db, t.id)[0].node.placement_count).toBe(2);
  });

  it("parent tracks are found through folders; a course in two tracks reports both", () => {
    const db = openTestDb();
    const quant = createNode(db, { kind: "track", title: "quant" }).node;
    const amc = createNode(db, { kind: "track", title: "amc" }).node;
    const year = createNode(db, { kind: "folder", title: "Year 1", place_in: { container_id: quant.id } }).node;
    const math = createNode(db, { kind: "course", title: "math", place_in: { container_id: year.id } }).node;
    placeNode(db, { container_id: amc.id, child_id: math.id });
    expect(parentTracks(db, math.id).map((t) => t.title).sort()).toEqual(["amc", "quant"]);
    expect(coursesIn(db, quant.id)).toEqual([{ node: expect.objectContaining({ id: math.id }), path: ["Year 1", "math"] }]);
  });

  it("reach is the downward closure; roots list tracks, courses and unplaced files", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c", place_in: { container_id: t.id } }).node;
    const inC = file(db, "in c", c.id);
    const loose = file(db, "loose");
    expect(reach(db, t.id).sort()).toEqual([c.id, inC.id].sort());
    const roots = listRoots(db);
    expect(roots.tracks.map((n) => n.id)).toEqual([t.id]);
    expect(roots.courses.map((n) => n.id)).toEqual([c.id]);
    expect(roots.unplaced.map((n) => n.id)).toEqual([loose.id]);
    removePlacement(db, getNodeDetail(db, inC.id).appears_in[0].placement_id);
    expect(listRoots(db).unplaced.map((n) => n.id).sort()).toEqual([inC.id, loose.id].sort());
  });

  it("search returns one row per placement under its local name, scoped to reach", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c", place_in: { container_id: t.id } }).node;
    const n = file(db, "Elasticity notes", t.id, "price elasticity of demand");
    placeNode(db, { container_id: c.id, child_id: n.id, name: "Supporting material" });
    expect(searchWorkspace(db, { q: "elasticity", scope: t.id }).map((r) => r.name).sort()).toEqual(["Elasticity notes", "Supporting material"]);
    expect(searchWorkspace(db, { q: "demand", scope: c.id }).map((r) => r.name)).toEqual(["Supporting material"]);
  });
});
```

`server/tests/workspaceContent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { createNode } from "../src/domain/workspace/graph.js";
import { readContent, saveContent, appendContent, listRevisions } from "../src/domain/workspace/content.js";
import { syncAssetFiles } from "../src/domain/workspace/assetFiles.js";
import { listRoots } from "../src/domain/workspace/reads.js";

describe("workspace content", () => {
  it("saves optimistically: a stale base revision is refused with the current one", () => {
    const db = openTestDb();
    const n = createNode(db, { kind: "file", title: "f", file: { type: "markdown", body: "one" } }).node;
    expect(saveContent(db, n.id, { body: "two", base_revision: 1, author: "ben" }).revision).toBe(2);
    expect(() => saveContent(db, n.id, { body: "three", base_revision: 1, author: "ben" })).toThrow(/stale_revision|current revision is 2/);
    expect(readContent(db, n.id)).toMatchObject({ body: "two", revision: 2, saved_by: "ben" });
  });

  it("appends without a base revision, records who wrote each revision, and refuses non-appendable types", () => {
    const db = openTestDb();
    const notes = createNode(db, { kind: "file", title: "USERNOTES", file: { type: "markdown", body: "" } }).node;
    appendContent(db, notes.id, { text: "- confuses moles with mass (2026-10-03, Q on 3.2 g of C)", author: "tutor" });
    appendContent(db, notes.id, { text: "- second note", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("- confuses moles with mass (2026-10-03, Q on 3.2 g of C)\n\n- second note");
    expect(listRevisions(db, notes.id).map((r) => r.saved_by)).toEqual(["ben", "tutor", "tutor"]);
    const g = createNode(db, { kind: "file", title: "g", file: { type: "graph", body: "y = x" } }).node;
    expect(() => appendContent(db, g.id, { text: "y = 2x", author: "planner" })).toThrow(/not_appendable/);
  });

  it("gives every upload one unplaced asset file, idempotently", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Ebbing ch3', 'text', 'x')").run();
    syncAssetFiles(db); syncAssetFiles(db);
    const unplaced = listRoots(db).unplaced;
    expect(unplaced.map((n) => n.id)).toEqual(["asset:a1"]);
    expect(unplaced[0]).toMatchObject({ type: "asset", kind_tag: "source", class: "document" });
  });
});
```

- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** `reads.ts`, `content.ts`, `assetFiles.ts` and an `index.ts` that re-exports `graph`, `reads`, `content`, `assetFiles`, `fileTypes`, `names` and `types`. Reach and parent tracks are recursive CTEs over `ws_placement` joined to `ws_node` with `trashed_at IS NULL` on both ends.
- [ ] **Step 4: Run** both files and the Task 2 tests; all pass. `npx tsc -p tsconfig.json --noEmit` is clean.
- [ ] **Step 5: Commit** `feat(workspace): reads (children, appears-in, parent tracks, reach, search), optimistic content, asset files`.

---

### Task 4: HTTP API, local-node forwarding, MCP tools

**Files:**
- Create: `server/src/http/workspaceRoutes.ts`, `server/src/mcp/workspaceTools.ts`
- Modify: `server/src/http/app.ts` (register after `registerAuthoringRoutes`), `server/src/http/liveProxy.ts` (`shouldForward`: `if (path.startsWith("/api/ws/") || path === "/api/ws") return true;`), `server/src/mcp/tools.ts` (call `registerWorkspaceTools(registerTool, db)` inside `registerTools`; append the tool names to `PRESENTER_TOOLS`), `server/src/protocol.ts` (`TOOLS_VERSION = 9`), `server/tests/itemChannel.test.ts` (`toBe(9)`), plus the test that asserts the presenter list (`grep -rn "PRESENTER_TOOLS\|list_ungraded_written" server/tests`)
- Test: `server/tests/workspaceRoutes.test.ts`, `server/tests/workspaceMcp.test.ts`

**HTTP routes** (all JSON; errors via the same `sendDomainError` shape, `{error, message}`; status 404 for `not_found`, **409 for `stale_revision`**, 400 otherwise):

| Method, path | Domain call |
|---|---|
| `GET /api/ws/roots` | `listRoots` |
| `GET /api/ws/file-types` | `listFileTypes().map(t => ({type, storage, appendable}))` |
| `GET /api/ws/nodes/:id` | `getNodeDetail` |
| `GET /api/ws/nodes/:id/children` | `listChildren` |
| `GET /api/ws/nodes/:id/courses` | `coursesIn` |
| `GET /api/ws/nodes/:id/content` | `readContent` |
| `PUT /api/ws/nodes/:id/content` `{body, base_revision}` | `saveContent(…, author: "ben")` |
| `POST /api/ws/nodes` `CreateNodeInput` | `createNode(…, author: "ben")` → 201 |
| `PATCH /api/ws/nodes/:id` `{title?, everywhere?, kind_tag?}` | `renameNode` / `setKindTag` |
| `DELETE /api/ws/nodes/:id?with_orphans=true` | `destroyNode` |
| `POST /api/ws/placements` `{container_id, child_id, name?}` | `placeNode` → 201 |
| `PATCH /api/ws/placements/:id` `{name?, container_id?}` | `renamePlacement` / `movePlacement` |
| `DELETE /api/ws/placements/:id` | `removePlacement` |
| `GET /api/ws/search?q=&scope=&kind_tag=` | `searchWorkspace` |
| `GET /api/ws/trash` · `POST /api/ws/trash/:id/restore` · `DELETE /api/ws/trash/:id` | `listTrash` / `restoreNode` / `purgeNode` |

`DELETE /api/ws/nodes/:id` and `DELETE /api/ws/placements/:id` are deliberately different paths (rule 1).

**MCP tools** (`workspaceTools.ts`). Every write takes `as: z.enum(["tutor", "planner"])`, described as: *"Who is writing. The tutor teaches Ben and writes its notes about him into the unit's USERNOTES file with specific examples; the planner writes the plan. Recorded on the revision."*

| Tool | Args | Does |
|---|---|---|
| `ws_list` | `container_id?` | roots when absent, else `listChildren` |
| `ws_read` | `node_id` | `getNodeDetail` + `readContent` for files |
| `ws_search` | `q?`, `scope?`, `kind_tag?` | `searchWorkspace` |
| `ws_create` | `kind`, `title`, `container_id?`, `name?`, `type?`, `body?`, `kind_tag?`, `as` | `createNode`; `type` required when `kind` is `file` |
| `ws_write` | `node_id`, `body`, `base_revision`, `as` | `saveContent`; the description says to read first and pass the revision you read, and that a stale revision means Ben edited it since, so read again |
| `ws_append` | `node_id`, `text`, `as` | `appendContent`; the description says this is how notes go into USERNOTES without clobbering Ben's edits |
| `ws_place` | `container_id`, `child_id`, `name?` | `placeNode` |

All seven go into `PRESENTER_TOOLS` (the tutor server writes). There are no remove, destroy or move tools: rearranging the tree is Ben's.

- [ ] **Step 1: Write failing route tests.** Use the pattern in an existing route test, e.g. `grep -ln "buildApp\|app.inject" server/tests | head -3`, and reuse its app-construction helper. Cover:
  - create a track, then a course placed in it (201)
  - `GET children` lists the course
  - `PUT content` with a stale revision → 409 `{error: "stale_revision"}`
  - `DELETE /api/ws/placements/:id` returns `{became_unplaced: true}` for a last placement
  - `DELETE /api/ws/nodes/:id` trashes, and `GET /api/ws/trash` lists it
  - `POST /api/ws/placements` making a cycle → 400 `cycle_rejected`
  - `GET /api/ws/file-types` includes `markdown`
- [ ] **Step 2: Write a failing forwarding test.** Add to the existing liveProxy tests: `shouldForward("GET", "/api/ws/roots", () => false)` is `true`, and `shouldForward("GET", "/api/wsx", …)` is `false`.
- [ ] **Step 3: Write failing MCP tests** (`workspaceMcp.test.ts`), using the in-memory client pattern in `server/tests/retention.test.ts` ("the loop over MCP"):
  - `ws_create` a course and a folder `unit-3` in it, then a markdown `USERNOTES` in the unit, `as: "tutor"`
  - `ws_append` twice, `as: "tutor"`
  - `ws_read` shows both notes and `saved_by: "tutor"`
  - `ws_write` with a stale `base_revision` is an error
  - `ws_create` without `as` is a schema error
  - a presenter-scoped registration lists all seven `ws_*` tools
- [ ] **Step 4: Run; they fail.**
- [ ] **Step 5: Implement** the routes, the forwarding line, the tools, the `PRESENTER_TOOLS` additions and `TOOLS_VERSION = 9`. Fix the two existing assertions (the version, and the presenter list).
- [ ] **Step 6: Run** the new files, `itemChannel`, `outcomePolish` and the presenter-scope test, then the **full suite** (`npx vitest run --maxWorkers=2`; expect 526 + new, all passing) and `tsc`.
- [ ] **Step 7: Commit** `feat(workspace): /api/ws routes, local-node forwarding, ws_* MCP tools for the tutor and planner (TOOLS_VERSION 9)`.

---

### Task 5: The web frame

**Files:**
- Create: `web/src/workspace/wsApi.ts`, `fileTypes.tsx`, `tabs.ts`, `tabs.test.ts`, `fileTypes.test.ts`, `Workspace.tsx`, `Picker.tsx`, `Sidebar.tsx`, `Tree.tsx`, `CenterPane.tsx`, `MarkdownFile.tsx`, `workspace.css`
- Modify: `web/src/components/Rail.tsx` (add `'workspace'` to `Page` and an item `{ page: 'workspace', label: 'Workspace', icon: <FolderIcon size={16} /> }`, using an icon from `./icons`; check `grep -n "export function FolderIcon" web/src/components/icons.tsx`), `web/src/App.tsx` (when `page === 'workspace'`, render `<Workspace onExit={() => navigate(previousPage)} />` full-window with **no Rail**, the same way Take hides it)

**Interfaces — Consumes:** the HTTP contract in Task 4. **Produces:**
```ts
// fileTypes.tsx — the web half of the registry
export interface FileViewProps { nodeId: string; type: string; body: string | null; assetId: string | null; revision: number; onSaved(revision: number): void }
export interface WebFileType { type: string; label: string; icon?: React.ReactNode; View: React.ComponentType<FileViewProps>; newBody?: string }
export function registerWebFileType(t: WebFileType): void;          // throws on duplicate
export function webFileType(type: string): WebFileType | null;      // null → CenterPane's fallback
export function listWebFileTypes(): WebFileType[];
// tabs.ts — pure
export interface Tab { nodeId: string; title: string; directed: boolean }
export interface TabState { tabs: Tab[]; active: string | null }
export function openTab(s: TabState, t: { nodeId: string; title: string; directed?: boolean }): TabState;  // focuses an existing tab for the same node, never duplicates
export function closeTab(s: TabState, nodeId: string): TabState;   // activates the right neighbour, else the left, else null
export function focusTab(s: TabState, nodeId: string): TabState;
```

**What the frame does.** It is plain, with no advanced UI, and uses the app's CSS variables:
- **Picker** (no workspace open). Three lists from `GET /api/ws/roots`: Tracks, Courses, Unplaced. Each track or course row has **Open**. Unplaced files open in a tab of a scratch view. There are **New track** / **New course** buttons (title through `window.prompt` for now) and an **Exit** button.
- **Shell.**
  - **Header:** the workspace title and kind. For a course, the parent tracks ("in: quant · amc"), each a button that opens that track. **Up** appears when the workspace stack has an entry. **Switch** returns to the picker, and **Exit** leaves.
  - **Sidebar** (`Ctrl+B` hides it):
    1. **Mode switcher:** Files | Tools. Tools shows "No tools yet."
    2. **Partition strip:** a chip per kind tag. A chip lists `GET /api/ws/search?scope=<root>&kind_tag=<tag>` rows as `name — path`, and clicking a row opens the file.
    3. **Tree.**
       - In a course workspace, it is the course's children.
       - In a track workspace, it has two sections: **Planning** (the track's children that are not courses) and **Courses** (from `/courses`, showing `path.join(' / ')`).
  - **Tree rows** (lazy children via `/children`):
    - a kind glyph
    - the local name
    - a kind-tag dot
    - a shared badge `×N` when `placement_count > 1`, whose `title` attribute lists the `appears_in` containers on hover (fetched on hover)
  - **Clicks:** a file opens a tab, a folder toggles, and a course **replaces the workspace**, pushing the current one on the stack.
  - **Row menu (`⋯`):**
    - New file (markdown) and New folder, on containers
    - Rename here
    - divider
    - **Remove from "<container>"**
    - **Destroy…**, with a `ConfirmDialog` listing `appears_in` and, for containers, an "also destroy N items placed nowhere else" checkbox
  - **Tabs:** tab bar via `tabs.ts`; middle-click closes.
  - **Center pane:** fetch `/content`, then render `webFileType(type)?.View`. Fallback: `Can't show files of type "<type>" yet.`, with the raw body in a `<pre>`.
- **Built-in web types:**
  - **`markdown`**: `MarkdownFile`. View mode uses `RichText`. An **Edit** toggle shows a `<textarea>` and **Save** calls `PUT` with `base_revision`. On 409 it shows "Changed elsewhere — Reload / Overwrite": Overwrite re-reads the revision and saves again.
  - **`graph`**: `GraphPanel spec={body}`.
  - **`asset`**: `DocumentPanel documentId={assetId} anchorLabel={null} anchorStart={null} anchorEnd={null} mode="full"`.
- **State.** The last workspace and the open tabs per workspace go in `localStorage` under `osmosis:ws:last` and `osmosis:ws:tabs:<rootId>`, with every read and write wrapped in try/catch.

- [ ] **Step 1: Write failing pure tests** `web/src/workspace/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openTab, closeTab, focusTab, type TabState } from './tabs'

const empty: TabState = { tabs: [], active: null }

describe('tabs', () => {
  it('opens, focuses an existing tab instead of duplicating it, and keeps order', () => {
    let s = openTab(empty, { nodeId: 'a', title: 'A' })
    s = openTab(s, { nodeId: 'b', title: 'B' })
    s = openTab(s, { nodeId: 'a', title: 'A again' })
    expect(s.tabs.map((t) => t.nodeId)).toEqual(['a', 'b'])
    expect(s.active).toBe('a')
  })
  it('closing the active tab activates its right neighbour, else its left, else nothing', () => {
    let s = ['a', 'b', 'c'].reduce((acc, id) => openTab(acc, { nodeId: id, title: id }), empty)
    s = focusTab(s, 'b')
    s = closeTab(s, 'b'); expect(s.active).toBe('c')
    s = closeTab(s, 'c'); expect(s.active).toBe('a')
    s = closeTab(s, 'a'); expect(s.active).toBeNull()
  })
  it('marks a tab the tutor opened as directed, without limiting anything else', () => {
    const s = openTab(empty, { nodeId: 'q', title: 'Item', directed: true })
    expect(s.tabs[0].directed).toBe(true)
  })
})
```

`web/src/workspace/fileTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { webFileType, registerWebFileType, listWebFileTypes } from './fileTypes'

describe('web file types', () => {
  it('has markdown, graph and asset built in, and no fallback entry', () => {
    expect(['markdown', 'graph', 'asset'].every((t) => webFileType(t))).toBe(true)
    expect(webFileType('item-set')).toBeNull()
  })
  it('refuses a duplicate registration', () => {
    expect(() => registerWebFileType({ type: 'markdown', label: 'x', View: () => null })).toThrow()
    expect(listWebFileTypes().length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run; they fail:** `cd web && npx vitest run src/workspace`.
- [ ] **Step 3: Implement** `tabs.ts`, `fileTypes.tsx` and `wsApi.ts`. `wsApi` mirrors the routes; each call throws an `Error` carrying `status` and `error` code, so a 409 is detectable.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Implement** the components and the Rail/App wiring. `cd web && npx tsc -b` must be clean, and `npx vitest run` green.
- [ ] **Step 6: Commit** `feat(workspace): the plain frame — rail entry, picker, sidebar tree, tabs, center pane through the file-type registry`.

---

### Task 6: The guide for special file types, and the spec rows

**Files:**
- Create: `docs/workspace/FILE-TYPES.md`
- Modify: `MCP-SPEC.md` (§3 tool rows for the seven `ws_*` tools; a short §3.6 "The workspace" pointing at the Learn spec; `tools_version` now 9)

**`FILE-TYPES.md` must contain, concretely:**
1. **What a file type is.** Server `FileTypeSpec`, web `WebFileType`, and how `storage` works (`text` | `json` | `asset`).
2. **Adding a type, step by step**, worked through a complete example: a `usernotes` type.
   - **Server:** `registerFileType({ type: "usernotes", storage: "text", appendable: true, kinds: () => ["text"], validate: … })`, placed in `server/src/domain/workspace/fileTypes.ts` under a "Special types" heading, or in its own module imported from there.
   - **Web:** `registerWebFileType({ type: "usernotes", label: "User notes", View: UserNotesView, newBody: "" })`.
   - A test for each half, copying the patterns in `workspaceContent.test.ts` and `fileTypes.test.ts`.
3. **A JSON-backed example**, sketched for an item-set file: `storage: "json"`, a `validate` that parses the body and checks `{ items: [{ question_id }] }`, and a View that renders through the existing question components. It must state the brief's constraints:
   - the viewer is a viewer
   - evidence comes only from items with outcomes, so an item file **points at** items and never stores answers
   - directed mode guides, never limits
4. **How agents write.**
   - `ws_create` / `ws_write` / `ws_append` with `as: tutor | planner`.
   - Append for notes, write with `base_revision` for whole documents.
   - The tutor/planner distinction, verbatim from Ben's ruling.
5. **What the frame does not do yet**, so an agent doesn't assume it:
   - no folder export
   - no search UI beyond the partition
   - no rooting UI
   - no drag-and-drop
   - no tutor-directed tab opening (a tool for that comes with live sessions)
   - USERNOTES is a convention to build, not a built-in

- [ ] **Step 1: Write the guide and the spec rows.**
- [ ] **Step 2: Verify every code identifier the guide names exists:**

```bash
grep -n "export function registerFileType\|export function registerWebFileType" -r server/src web/src
```

- [ ] **Step 3: Commit** `docs(workspace): FILE-TYPES guide for special file types; MCP-SPEC rows`.

---

## Self-Review

**Spec coverage** (`01-shell.md`):

| Section | Covered by |
|---|---|
| §2 data model | Task 1 (with `type` per §17) |
| §3 rules | Task 2 |
| §4 containment | Task 2 |
| §5 reads | Task 3 |
| §6 content (asset files, optimistic saves) | Task 3; the interim editor in Task 5 |
| §7 entry, picker, kinds, descent and Up | Task 5 |
| §8 sidebar, frame-level | Task 5 |
| §9 tabs | Task 5 |
| §10 hooks | `readable` is not built (Ben: guide, never limit). Exposure events are not built; noted in FILE-TYPES.md "not yet" |
| §12 API | Task 4 |
| §17 registry and authors | Tasks 1, 3, 4, 5, 6 |

**Deliberately out of scope** (Ben: frame only): §13 folders, §14 Learn import, §7.5 rooting UI, drag-and-drop, the track large view, the Live page change, and tutor tab direction. They are listed in the checklist.

**Types.** `NodeSummary.class` includes the asset classes (`pdf | image | link | document`) in addition to `classOf`'s set. The web types it as `string`.
