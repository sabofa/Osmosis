# Workspace Data Layer Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Controller after a context compaction:**
> 1. Read this file's Global Constraints and Contracts.
> 2. Read the ledger at `.superpowers/sdd/2026-10-04-workspace-data-layer-rework/progress.md`, then `git log --oneline -15`.
> 3. Resume at the first task with no `Task N: complete` line.
> 4. The memory note `workspace-rework-handoff.md` says the same.

**Goal:** rework the workspace data layer on `workspace/frame` to the approved spec. That means:
- five kinds (trajectory added)
- `trash` / `delete` / `restore` / `purge` semantics
- one versioned content table
- format hooks in place of a content-interpreting registry
- open kind tags
- the spec's queries

The HTTP routes, the MCP tools, the plain web frame and the docs follow.

**Spec (binding):**
- Ben's Learn repo, `C:\Users\benif\Learn\spec\osmosis\workspace\02-data-layer.md`. It was approved with all §10 decisions as proposed.
- It expands `brief-2026-10-04-data-layer.md` in the same folder, which is verbatim and wins on conflict.
- Where the plan and the spec disagree, the spec wins.

**Architecture:**
- `server/src/domain/workspace/` is rewritten in place: same folder, same index re-export.
- Migration `023_workspace.sql` is rewritten in place. It was never merged or deployed (Ben's ruling).
- The HTTP routes in `server/src/http/workspaceRoutes.ts` and the MCP tools in `server/src/mcp/workspaceTools.ts` are adapted to the new operations.
- The web frame in `web/src/workspace/` is adapted, not redesigned. Ben: "dont make advanced ui yet just the frame". He also said the markdown editor and viewers are placeholders, because documents move to the document engine later.

**Tech stack:**
- Server: Node 24 `node:sqlite` (synchronous), Fastify 5, MCP SDK, zod, vitest 3.
- Web: React + Vite + TypeScript. Vitest has no DOM, so only pure modules get unit tests.

## Global Constraints

**Repo and git**
- Branch `workspace/frame`, worktree `C:\Users\benif\Osmosis\.claude\worktrees\workspace-frame`. It is stacked on `stage-2a/retention-loop`, whose migration is 022.
- Other Claude sessions share this repo. Use explicit `git add <paths>`. Never stash, pop or drop. Don't touch `graph-engine/`, `review/` or other worktrees.

**Commands**
- Server: `cd server && npx vitest run --maxWorkers=2 <files>`. Run the full suite once before each commit (about 95 s; 677 passing at the start). Typecheck with `npx tsc -p tsconfig.json --noEmit`.
- Web: `cd web && npx vitest run` (224 at the start), `npx tsc -b`, `npx vite build`.
- Ben's PC is shared. Give every headless Edge run a timeout and kill its process tree afterwards. Stop any throwaway server you start. Never touch port 8081.

**Commits and style**
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` for implementers, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` for the controller.
- Match the surrounding code style. Comments explain *why*, in full sentences. Domain error codes are snake_case.

**Kinds and containment**
- Kinds: `trajectory | track | course | folder | file`.
- Containment:
  - trajectory holds track, course, folder, file
  - track holds course, folder, file
  - course holds folder, file
  - folder holds folder, file
  - file holds nothing
- Folders have **no built-in meaning**. A folder may be a unit, research, attachments, notes, anything (Ben).

**Live, trash, delete**
- **Live** means `archived_at IS NULL` on the placement, its container and its child. Every read is live-only unless it is named otherwise.
- `trash(placement)` **deletes the row**. Trashing the last placement makes the node **unplaced**; it is never archived.
- `delete(node)` sets `archived_at` on the node and on **every one of its placements** (marked, not dropped), and gives every node archived in that call one shared `archive_batch`.
  - With `with_orphans`, the fixpoint orphans are archived too, in the same batch. Fixpoint: start from S = {node}; a live node joins S when every one of its live placements is in a container that is archived or in S.
  - The placements of a deleted container's children are **not** marked. They are hidden while the container is archived.
- `restore(node, chosen placement ids)` works like this:
  1. It clears the node's `archived_at` and `archive_batch`.
  2. It un-marks the chosen placements whose container is live. A name collision is renamed to the lowest free `name (n)` and reported.
  3. A chosen placement whose container is still archived **stays marked** and is reported `skipped: container_archived`.
  4. Unchosen placements are **dropped**.
  5. It returns `batch_mates`: the other nodes still archived in the same batch.
  6. **Restoring a container also un-marks** any marked placements *inside* it whose child is live. Those are the skipped ones from step 3, now reviving.
- `purge(node)` requires the node to be archived (`not_archived`). The rows cascade. An upload wrapper whose asset still exists is refused (`asset_in_use`).

**Cycles**
- Rejected at `place` and `move` time across **all** placements, archived ones included (`cycle_rejected`).

**Names**
- NFC, trimmed, 1–200 codepoints, no `/`, no control characters. Titles use the same grammar.
- Unique among a container's **live** placements, compared case-insensitively with `toLocaleLowerCase('en')`. A clash raises `name_taken`, whose message and `detail.suggestion` give the lowest free `name (n)`, n ≥ 2.
- There is no rename-everywhere. `rename` touches one placement and `retitle` touches only the title.

**Kind tag**
- Open vocabulary, matching `^[a-z][a-z0-9_-]{0,31}$`, or null.
- Files only; anything else is refused with `invalid_input`.
- The UI suggests source, resource, homework, test and flowchart.

**Content**
- One table, `ws_content`, with one row per version (`node_id`, `version`, `format`, `body`, `asset_id`, `search_text`, `author`, `saved_at`). The latest version is the current content.
- `format` is opaque and matches `^[a-z][a-z0-9-]{0,39}$`. The layer **never interprets** content. Format **hooks** may supply `searchText`, `validate` and `append`. A format without hooks is stored verbatim: it is unsearchable by content and not appendable.
- Hooks run only on writes, never during reads. A hook that throws fails that write with `invalid_content`.
- Built-in formats:
  - `markdown`: `searchText` = body; `append` joins with `"\n\n"` when the body is non-empty.
  - `graph`: `searchText` = body.
  - `upload`: `searchText` = the asset's `extracted_text`.

**Saving and authors**
- Saves are optimistic. If `base_version` is not the latest, the save fails with `stale_version`, mapped to HTTP **409** with `detail.current_version`.
- `append` needs no base version.
- Authors are `ben | tutor | planner`. HTTP always writes as `ben`. MCP writes require `as: tutor | planner` with no default.

**Queries**
- `unplaced()` lists **files and folders** with no live placement.
- `roots()` lists every live trajectory, track and course, each flagged `top_level` when it has no live placement.
- `search()` excludes unplaced nodes.

**Uploads**
- Every asset has a wrapper file node `asset:<asset id>`, with `format: upload`, `kind_tag: source`, and `author: ben` on version 1. It starts unplaced.
- It is created when the asset is created and archived when the asset is deleted.
- The sync re-links a wrapper (sets its `asset_id`) whose asset row still exists before archiving anything.

**Not in scope**
- No advanced UI, no git export, no rooting UI, no drag-and-drop.

## Contracts (all tasks rely on these names and shapes)

### Domain: `server/src/domain/workspace/`, re-exported from `index.ts`

```ts
// types.ts
export type NodeKind = "trajectory" | "track" | "course" | "folder" | "file";
export type Author = "ben" | "tutor" | "planner";
export const NODE_KINDS, CONTAINER_KINDS /* trajectory, track, course, folder */, AUTHORS;
export const MAY_HOLD: Record<NodeKind, readonly NodeKind[]>;
export const SUGGESTED_KIND_TAGS = ["source", "resource", "homework", "test", "flowchart"] as const;
export interface NodeRow { id; kind: NodeKind; title; kind_tag: string | null; created_at; updated_at; archived_at: string | null; archive_batch: string | null }
export interface PlacementRow { id; container_id; child_id; name; created_at; archived_at: string | null }
export interface ContentRow { node_id; version: number; format; body: string | null; asset_id: string | null; search_text: string | null; author: Author; saved_at }
// names.ts — unchanged: normalizeName, sameName; plus normalizeKindTag(raw): string | null (throws invalid_input)
// formats.ts — replaces fileTypes.ts
export interface FormatHooks { format: string; searchText?(body: string | null): string; validate?(body: string | null): string | null; append?(body: string | null, text: string): string }
export function registerFormat(h: FormatHooks): void;          // throws on duplicate or bad format name
export function formatHooks(format: string): FormatHooks | null; // null = no hooks (allowed)
export function listFormats(): { format: string; searchable: boolean; appendable: boolean; validated: boolean }[];
// graph.ts (writes)
export function getNode(db, id): NodeRow;                                  // not_found
export function createNode(db, i: { kind; title; kind_tag?; format?; body?; asset_id?; container_id?; name?; author?: Author }): { node: NodeRow; placement: PlacementRow | null };
export function place(db, i: { container_id; child_id; name? }): PlacementRow;
export function move(db, placementId, containerId): PlacementRow;
export function trash(db, placementId): { removed: PlacementRow; became_unplaced: boolean };
export function deletePreview(db, nodeId): { appears_in: AppearsInRow[]; orphans: NodeSummary[] };
export function deleteNode(db, nodeId, opts?: { with_orphans?: boolean }): { archived: string[]; batch: string };
export function archivedPlacements(db, nodeId): { placement_id; name; container: { id; kind: NodeKind; title; archived: boolean } }[];
export function restore(db, nodeId, placementIds: string[]): { restored: string; placements: { placement_id; name; renamed: boolean }[]; skipped: { placement_id; reason: "container_archived" }[]; batch_mates: NodeSummary[] };
export function purge(db, nodeId): { purged: string };
export function rename(db, placementId, name): PlacementRow;
export function retitle(db, nodeId, title): NodeRow;
export function setKindTag(db, nodeId, tag: string | null): NodeRow;
// content.ts
export function readContent(db, nodeId): ContentRow;                       // latest version
export function saveContent(db, nodeId, i: { body: string | null; base_version: number; author: Author }): { version: number; saved_at: string };
export function appendContent(db, nodeId, i: { text: string; author: Author }): { version: number };
export function listVersions(db, nodeId): { version: number; author: Author; saved_at: string }[];
// reads.ts
export interface NodeSummary { id; kind: NodeKind; title; kind_tag: string | null; format: string | null; placement_count: number; has_children: boolean; archived_at: string | null; top_level: boolean }
export interface ChildRow { placement_id; name; appears_elsewhere: boolean; node: NodeSummary }
export interface AppearsInRow { placement_id; name; container: { id; kind: NodeKind; title } }
export interface SubtreeRow { placement_id; parent_placement_id: string | null; depth: number; name; node: NodeSummary }
export function getNodeDetail(db, id): { node: NodeSummary; appears_in: AppearsInRow[]; content: { format; version; saved_at; author; asset_id } | null };
export function children(db, containerId): ChildRow[];      // containers first, then files; natural sort (numeric localeCompare)
export function appearsIn(db, nodeId): AppearsInRow[];
export function unplaced(db): NodeSummary[];
export function roots(db): { trajectories: NodeSummary[]; tracks: NodeSummary[]; courses: NodeSummary[] };
export function subtree(db, containerId): SubtreeRow[];     // depth-first, children order as in children()
export function byKindTag(db, tag: string, scope?: string): { placement_id; name; container_id; node: NodeSummary }[];
export function search(db, i: { q?: string; scope?: string; kind_tag?: string }): { placement_id; name; container_id; node: NodeSummary }[];
export function archived(db): NodeSummary[];
export function context(db, containerId): { placement_id; name; container_id; node: NodeSummary }[];  // track only, else []
// uploads.ts (replaces assetFiles.ts)
export function syncUploads(db): void;
```

### HTTP (`/api/ws`)

Status codes: `not_found` is 404, `stale_version` is 409, and everything else is 400. Error bodies are `{error, message, detail?}`.

| Route | Calls |
|---|---|
| `GET /roots` | `roots` |
| `GET /unplaced` | `unplaced` |
| `GET /archive` | `archived` |
| `GET /formats` | `listFormats` |
| `GET /nodes/:id` | `getNodeDetail` |
| `GET /nodes/:id/children` | `children` |
| `GET /nodes/:id/subtree` | `subtree` |
| `GET /nodes/:id/context` | `context` |
| `GET /nodes/:id/content` | `readContent` |
| `PUT /nodes/:id/content` `{body, base_version}` | `saveContent` (author ben) |
| `GET /nodes/:id/versions` | `listVersions` |
| `POST /nodes` `{kind, title, kind_tag?, format?, body?, asset_id?, container_id?, name?}` | `createNode` (author ben), returns 201 |
| `PATCH /nodes/:id` `{title?, kind_tag?}` | `retitle` / `setKindTag`, applied atomically. An empty body or an unknown field is 400 |
| `GET /nodes/:id/delete-preview` | `deletePreview` |
| `DELETE /nodes/:id?with_orphans=true\|false` | `deleteNode`. Any other value of `with_orphans` is 400 |
| `GET /nodes/:id/archived-placements` | `archivedPlacements` |
| `POST /nodes/:id/restore` `{placements: string[]}` | `restore` |
| `DELETE /archive/:id` | `purge` |
| `POST /placements` `{container_id, child_id, name?}` | `place`, returns 201 |
| `PATCH /placements/:id` `{name?, container_id?}` | `move`, then `rename`, atomically |
| `DELETE /placements/:id` | `trash` |
| `GET /search?q=&scope=&kind_tag=` | `search` |
| `GET /by-kind-tag?tag=&scope=` | `byKindTag` |

### MCP (`workspaceTools.ts`)

- The seven tools keep their names: `ws_list`, `ws_read`, `ws_search`, `ws_create`, `ws_write`, `ws_append`, `ws_place`.
- `revision` becomes `version` everywhere.
- `ws_create` accepts kind `trajectory` and `format`.
- `ws_list` with no `container_id` returns `roots()` plus `unplaced()`.
- There are no trash, delete, restore or purge tools: rearranging and removing are Ben's.
- `TOOLS_VERSION` stays **9**. This branch introduced 9 and has never been deployed.

---

### Task 1: Migration, types, names, formats, and the writes

**Files**
- Rewrite: `server/migrations/023_workspace.sql` (spec §2), `server/src/domain/workspace/types.ts`, `names.ts` (add `normalizeKindTag`), `graph.ts`.
- Replace `fileTypes.ts` with `formats.ts`, deleting `fileTypes.ts`.
- Keep `savepoint.ts`.
- Test: rewrite `server/tests/workspaceGraph.test.ts`.

**Required tests.** Each one asserts exact error codes.
1. Containment, all 25 pairs. At least: trajectory accepts track/course/folder/file. Track accepts course/folder/file but refuses track. Course refuses course/track. Folder refuses course. File refuses everything.
2. Cycle rejection: self, direct, indirect, and through an archived node.
3. Names: NFC/trim/length/`/`/control characters; a case-insensitive clash gives the suggestion `x (2)`; a title is normalized.
4. `trash`:
   - one of two placements leaves the other;
   - the last placement gives `became_unplaced`, and the node is not archived.
5. `delete`:
   - marks the node and every one of its placements;
   - a container's children's own placements stay unmarked;
   - the batch id is shared;
   - `deletePreview` lists `appears_in` and the fixpoint orphans (course plus subfolder, and a file also placed elsewhere is excluded);
   - `with_orphans` archives exactly those orphans, in the same batch.
6. `restore`:
   - a chosen subset revives only those placements;
   - unchosen placements are dropped;
   - a collision is renamed `name (2)` and `renamed: true`;
   - a chosen placement whose container is archived stays marked and is reported skipped;
   - restoring that container later revives it;
   - `batch_mates` is listed.
7. `purge`:
   - requires the node to be archived;
   - cascades;
   - children placed only in it become unplaced.
8. `rename` touches one placement. `retitle` touches only the title.
9. `move`:
   - re-checks containment, cycles and the name at the destination;
   - keeps the id and name;
   - a refused move changes nothing.
10. `createNode`:
    - a file requires a format matching the grammar;
    - `validate` runs, and `invalid_content` comes back when it refuses or throws;
    - version 1 is written with the author;
    - a kind tag on a non-file is refused;
    - an upload requires an existing `asset_id`.
11. `setKindTag`: open vocabulary, the grammar, null clears it.
12. Formats: built-ins present; duplicate registration refused; a format with no hooks is accepted.
13. Savepoint: an operation inside an outer BEGIN that is then rolled back leaves no trace.

- [ ] Write the tests, then watch them fail (RED).
- [ ] Implement.
- [ ] Watch them pass (GREEN), then run `tsc`.
- [ ] Commit `refactor(workspace): data layer to the approved spec — five kinds, trash/delete/restore/purge, versioned content, format hooks (writes)`.

### Task 2: Content, reads, uploads

**Files**
- Rewrite: `content.ts`, `reads.ts`. Replace `assetFiles.ts` with `uploads.ts`. Update the `server/src/domain/assets.ts` hook calls (`syncUploads`) and `index.ts`.
- Tests: rewrite `server/tests/workspaceReads.test.ts` and `workspaceContent.test.ts`.

**Required tests**
1. `saveContent`:
   - a stale base gives `stale_version` with the current version in `detail`;
   - the version increments;
   - `search_text` comes from the hook;
   - the author is recorded.
2. `appendContent`:
   - markdown joins with a blank line;
   - a format with no `append` hook gives `not_appendable`;
   - no base version is needed.
3. `listVersions` returns `{version, author, saved_at}` for each version.
4. `children`:
   - live only;
   - containers first, natural sort;
   - `appears_elsewhere`;
   - a trashed or archived child is hidden.
5. `appearsIn` includes both trajectory and track parents of a course.
6. `unplaced`:
   - files and folders only;
   - a node whose only placements are in an archived container is included.
7. `roots`:
   - all live trajectories, tracks and courses;
   - `top_level` flags.
8. `subtree`:
   - parent placement ids and depths;
   - a node placed twice appears twice;
   - archived nodes are excluded.
9. `byKindTag` returns rows for tagged files, scoped and unscoped.
10. `search`:
    - matches name, title and `search_text`;
    - one row per placement;
    - **unplaced nodes are excluded**;
    - scoped.
11. `archived` lists archived nodes.
12. `context`:
    - a track sees its parent trajectories' files, including those in trajectory folders;
    - it does not see another track's or a course's files under the trajectory;
    - a non-track gets `[]`.
13. Uploads:
    - creating an asset creates `asset:<id>` unplaced, with format `upload`;
    - deleting the asset archives the wrapper;
    - re-link: a nulled `asset_id` whose asset still exists is restored by the sync and not archived;
    - purging a wrapper of a live asset gives `asset_in_use`;
    - after the asset is deleted, purge works and the wrapper does not come back.
14. Reads never call hooks. A format whose `searchText` throws can still be listed, because `search_text` was computed at write time.

- [ ] Write the tests, then watch them fail (RED).
- [ ] Implement.
- [ ] Watch them pass (GREEN).
- [ ] Run the full server suite. Other workspace tests may fail here until Task 3; note them in the report and do not edit route or MCP tests.
- [ ] Run `tsc`. A typecheck failure in `workspaceRoutes.ts` or `workspaceTools.ts` is expected and Task 3's.
- [ ] Commit `refactor(workspace): content versions, the spec's queries, uploads`.

### Task 3: HTTP routes, MCP tools, forwarding

**Files**
- Rewrite: `server/src/http/workspaceRoutes.ts` (the Contracts table) and `server/src/mcp/workspaceTools.ts` (Contracts).
- Keep `liveProxy.ts`, which forwards `/api/ws` and `/api/ws/*`.
- Tests: rewrite `server/tests/workspaceRoutes.test.ts` and `workspaceMcp.test.ts`. Check `mcpPresenterScope.test.ts` and `itemChannel.test.ts`; the presenter list and `TOOLS_VERSION 9` are unchanged.

**Required tests.** Every route, its happy path and its error mapping:
- 404 when the node isn't found
- 409 `stale_version` with `detail.current_version`
- 400 `cycle_rejected`
- 400 `name_taken` with `detail.suggestion`
- 400 for a bad `with_orphans` value
- 400 for an empty or unknown-field PATCH
- the author can't be spoofed over HTTP
- MCP:
  - the `as` enum is required
  - `ws_write` uses `version`
  - `ws_create` accepts a trajectory
  - `ws_list` roots include unplaced
  - no trash, delete or purge tools exist
- the presenter scope lists the seven tools

Also update the `ws_create` description: on `name_taken`, call `ws_list` on the container and use the existing node; for USERNOTES, use `ws_append`; never create a numbered copy. Keep this wording.

- [ ] Write the tests, then watch them fail (RED).
- [ ] Implement.
- [ ] Watch them pass (GREEN).
- [ ] The **full server suite must be green**, and `tsc` clean.
- [ ] Commit `refactor(workspace): routes and ws_* tools on the new operations`.

### Task 4: The web frame on the new API

**Files:** `web/src/workspace/*`, adapted rather than redesigned. Ben: the frame is a placeholder for the document engine's views and editing mode.

**Changes**
1. **`wsApi.ts`** matches the HTTP contract. `revision` becomes `version` across `useFileDraft`, `saveFlow` and `ConflictBanner`, and the never-overwrite behaviour and its tests are unchanged.
2. **Picker:**
   - lists trajectories, tracks and courses from `/roots` (top-level ones marked), and Unplaced from `/unplaced`;
   - the **"Trash" section becomes "Archive"**, from `/archive`.
   - **Restore** opens a checklist of `/nodes/:id/archived-placements`. Containers that are still archived are shown as "comes back when <container> is restored". Restore posts the chosen ids, then offers the `batch_mates` ("also restore N deleted with it").
   - **Purge** stays behind a confirm and surfaces `asset_in_use`.
3. **Row menus:**
   - "Remove from <container>" calls `trash`.
   - "Delete…" fetches `/delete-preview`, lists `appears_in` and offers "also delete N items placed nowhere else", then calls `DELETE ?with_orphans=`.
   - "Rename here" calls `rename`. There is no rename-everywhere.
   - "Place in…" and Undo after a remove stay.
   - "New …" entries follow the new containment matrix (`newMenu.ts`): trajectory added, track-in-track removed, course-in-folder removed.
   - "New trajectory" is in the Picker.
4. **Tag ▸:**
   - offers the five suggestions plus "Other…", a prompt validated against `^[a-z][a-z0-9_-]{0,31}$`, plus None;
   - the partition chips list the five suggestions, plus any other tag present in the workspace.
5. **Course and track header:** "in:" lists `appears_in` containers of kind trajectory or track. Each is clickable.
6. **Track sidebar:** Planning (non-course children) and Courses (course children). Track-in-track is gone. A **trajectory workspace** gets the same two-section layout: Planning (files and folders), plus Tracks and Courses.
7. **Search UI** (the partition only) excludes unplaced nodes, which the server already does.

**Required tests:** update every pure module's tests (`newMenu`, `rows`, `graphWalk` if still used, `saveFlow`, `wsApi`, `tabs`, `wsState`, `trash`→`archive` helpers, `placing`). Add tests for:
- the restore-checklist model (which placements are restorable now, which are pending)
- kind-tag validation
- the trajectory matrix

Do a runtime check in headless Edge against a throwaway server, with a timeout, killing the process tree afterwards.

- [ ] Write or update the tests, then watch them fail (RED).
- [ ] Implement.
- [ ] Watch them pass (GREEN).
- [ ] `npx tsc -b`, `npx vite build`.
- [ ] Commit `refactor(workspace): frame on the new data layer — archive, restore choice, trajectories, open tags`.

### Task 5: Docs

**Files**
- `docs/workspace/FILE-TYPES.md`: the server half becomes **format hooks** (`registerFormat`, `searchText`, `validate`, `append`; the layer never interprets). The web registry is unchanged. Rename `revision` to `version`.
- `MCP-SPEC.md`: §3.6 and the tool rows.
- Copy the updated `FILE-TYPES.md` to Learn `spec/osmosis/workspace/FILE-TYPES.md`, then commit and push Learn.

**Verify:** grep every identifier the docs name.

- [ ] Commit `docs(workspace): format hooks, versions, the reworked operations`.

## Self-review

| Spec section | Covered by |
|---|---|
| §2 | Task 1 |
| §3 | Task 1 (containment) |
| §4 | Tasks 1 and 2 (names, titles, kind tag) |
| §5 | Tasks 1 and 2 (operations) |
| §6 | Task 2 (queries) |
| §7 | Tasks 1 and 2 (formats) |
| §8 | Task 2 (uploads) |
| §9 | Tasks 2 and 3 (concurrency, authors) |
| §10 | the Contracts and the Task 1–2 tests (decisions) |
| §11 | out of scope: the git export is open |
| §12 | Tasks 1–5 (rework list) |
