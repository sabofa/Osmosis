import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../errors.js";
import { checkContent, isFormatName } from "./formats.js";
import { normalizeKindTag, normalizeName, sameName } from "./names.js";
import { appearsIn, summarize } from "./reads.js";
import type { AppearsInRow, NodeSummary } from "./reads.js";
import { inSavepoint } from "./savepoint.js";
import { AUTHORS, CONTAINER_KINDS, MAY_HOLD, NODE_KINDS } from "./types.js";
import type { Author, NodeKind, NodeRow, PlacementRow } from "./types.js";

// ----------------------------------------------------------------------------
// Graph writes (Learn spec/osmosis/workspace/02-data-layer.md §3-§5).
//
// A node is a trajectory, track, course, folder or file; a placement says "this
// node appears in this container, under this name". The rules the writes
// enforce:
//   1. trash removes one placement row and the node lives on, unplaced if that
//      was its last. Only delete archives, and only purge destroys.
//   2. delete sets archived_at on the node and on every one of its placements
//      (marked, not dropped), so restore can offer them back. It leaves the
//      placements of a deleted container's children alone: they are hidden
//      because their container is archived, and reappear with it.
//   3. Names live on placements; `title` is only the default name and the
//      fallback. rename writes one placement, retitle writes only the title.
//   4. Containment (MAY_HOLD) and no cycles, checked on every place and move.
//      The cycle check walks every placement, archived ones included, so a
//      restore can never close a cycle nobody created.
//   5. Names are unique among a container's live placements. An archived child
//      holds no name; restore renames whatever now collides.
//
// "Live" means `archived_at` is null on the placement, its container and its
// child. Every write runs in a SAVEPOINT (callers may already hold a
// transaction) and stamps updated_at on the nodes it changes: the node for a
// node-level write, the containers whose contents changed for a placement-level
// one.
// ----------------------------------------------------------------------------

export interface CreateNodeInput {
  kind: NodeKind;
  title: string;
  kind_tag?: string | null;
  format?: string;
  body?: string | null;
  asset_id?: string | null;
  container_id?: string;
  name?: string;
  author?: Author;
}

const NAME_LIMIT = 200;

const collator = new Intl.Collator("en", { numeric: true });
const natural = (a: string, b: string): number => collator.compare(a, b);

export function getNode(db: DatabaseSync, id: string): NodeRow {
  const row = db.prepare("SELECT * FROM ws_node WHERE id = ?").get(id) as NodeRow | undefined;
  if (!row) throw new DomainError("not_found", `No node ${id}.`);
  return row;
}

function getPlacement(db: DatabaseSync, id: string): PlacementRow {
  const row = db.prepare("SELECT * FROM ws_placement WHERE id = ?").get(id) as PlacementRow | undefined;
  if (!row) throw new DomainError("not_found", `No placement ${id}.`);
  return row;
}

function stamp(db: DatabaseSync, ...nodeIds: string[]): void {
  const update = db.prepare("UPDATE ws_node SET updated_at = datetime('now') WHERE id = ?");
  for (const id of nodeIds) update.run(id);
}

// ---- the rules ---------------------------------------------------------------

// Containment, then archived, then cycles: the order the spec lists them.
function assertMayPlace(db: DatabaseSync, container: NodeRow, child: NodeRow): void {
  if (!MAY_HOLD[container.kind].includes(child.kind)) {
    throw new DomainError("containment_not_allowed", `A ${container.kind} can't hold a ${child.kind} (containment rule).`);
  }
  if (container.archived_at) {
    throw new DomainError("archived", `"${container.title}" is archived; restore it before placing anything in it.`);
  }
  if (child.archived_at) {
    throw new DomainError("archived", `"${child.title}" is archived; restore it before placing it.`);
  }
  if (child.id === container.id || isAncestor(db, child.id, container.id)) {
    throw new DomainError("cycle_rejected", `Placing "${child.title}" in "${container.title}" would make a cycle.`);
  }
}

// Is `ancestorId` above `nodeId` through any chain of placements? Archived
// nodes and marked placements count: either can be restored, and the cycle
// with them.
function isAncestor(db: DatabaseSync, ancestorId: string, nodeId: string): boolean {
  const hit = db
    .prepare(
      `WITH RECURSIVE up(id) AS (
         SELECT container_id FROM ws_placement WHERE child_id = ?
         UNION
         SELECT p.container_id FROM ws_placement p JOIN up ON p.child_id = up.id
       )
       SELECT 1 FROM up WHERE id = ? LIMIT 1`
    )
    .get(nodeId, ancestorId);
  return hit !== undefined;
}

// Is this placement live: not marked, and neither end archived?
function isLivePlacement(db: DatabaseSync, placement: PlacementRow): boolean {
  if (placement.archived_at !== null) return false;
  const ends = db
    .prepare("SELECT 1 FROM ws_node c, ws_node n WHERE c.id = ? AND n.id = ? AND c.archived_at IS NULL AND n.archived_at IS NULL")
    .get(placement.container_id, placement.child_id);
  return ends !== undefined;
}

// A placement that is marked, or hidden by an archived end, is not something
// to rename or move: the archive is a frozen copy until restore settles it.
function assertLivePlacement(db: DatabaseSync, placement: PlacementRow): { container: NodeRow; child: NodeRow } {
  const container = getNode(db, placement.container_id);
  const child = getNode(db, placement.child_id);
  if (placement.archived_at !== null || container.archived_at !== null || child.archived_at !== null) {
    throw new DomainError("archived", `"${placement.name}" in "${container.title}" is archived; restore it before changing it.`);
  }
  return { container, child };
}

function liveSiblingNames(db: DatabaseSync, containerId: string, exceptPlacementId: string): string[] {
  const rows = db
    .prepare(
      `SELECT p.name AS name FROM ws_placement p JOIN ws_node n ON n.id = p.child_id
        WHERE p.container_id = ? AND p.id <> ? AND p.archived_at IS NULL AND n.archived_at IS NULL`
    )
    .all(containerId, exceptPlacementId) as { name: string }[];
  return rows.map((r) => r.name);
}

// `name` if no live sibling has it, otherwise the lowest free "name (n)",
// n >= 2. Serves the name_taken suggestion and restore. A suffix never pushes
// a name past the length limit: the base gives way instead. The placement being
// renamed is not its own sibling.
function freeName(db: DatabaseSync, containerId: string, name: string, exceptPlacementId = ""): string {
  const wanted = normalizeName(name);
  const taken = liveSiblingNames(db, containerId, exceptPlacementId);
  const isTaken = (candidate: string) => taken.some((t) => sameName(t, candidate));
  if (!isTaken(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const base = [...wanted].slice(0, NAME_LIMIT - [...suffix].length).join("").trimEnd();
    const candidate = base + suffix;
    if (!isTaken(candidate)) return candidate;
  }
}

// `name` must already be normalized.
function assertNameFree(db: DatabaseSync, containerId: string, name: string, exceptPlacementId: string): void {
  const free = freeName(db, containerId, name, exceptPlacementId);
  if (free !== name) {
    throw new DomainError("name_taken", `"${name}" is already taken here; try "${free}".`, { suggestion: free });
  }
}

// ---- placements --------------------------------------------------------------

function assertNotPlaced(db: DatabaseSync, container: NodeRow, child: NodeRow): void {
  // Marked placements count: the pair is unique whatever state its row is in.
  const already = db.prepare("SELECT 1 FROM ws_placement WHERE container_id = ? AND child_id = ?").get(container.id, child.id);
  if (already) throw new DomainError("already_placed", `"${child.title}" is already in "${container.title}".`);
}

function insertPlacement(db: DatabaseSync, container: NodeRow, child: NodeRow, rawName: string | undefined): PlacementRow {
  assertMayPlace(db, container, child);
  const name = normalizeName(rawName ?? child.title);
  assertNotPlaced(db, container, child);
  assertNameFree(db, container.id, name, "");
  const id = uuidv4();
  db.prepare("INSERT INTO ws_placement (id, container_id, child_id, name) VALUES (?, ?, ?, ?)").run(id, container.id, child.id, name);
  stamp(db, container.id);
  return getPlacement(db, id);
}

export function place(db: DatabaseSync, input: { container_id: string; child_id: string; name?: string }): PlacementRow {
  return inSavepoint(db, "ws_place", () => insertPlacement(db, getNode(db, input.container_id), getNode(db, input.child_id), input.name));
}

// Re-parents one placement: `place` plus `trash` in one transaction, so it keeps
// its id and its name, and the destination is checked exactly like a new
// placement. Nothing is written until every check has passed.
export function move(db: DatabaseSync, placementId: string, containerId: string): PlacementRow {
  return inSavepoint(db, "ws_move", () => {
    const placement = getPlacement(db, placementId);
    const { container: from, child } = assertLivePlacement(db, placement);
    const to = getNode(db, containerId);
    if (to.id === from.id) return placement;
    assertMayPlace(db, to, child);
    assertNotPlaced(db, to, child);
    assertNameFree(db, to.id, placement.name, placement.id);
    db.prepare("UPDATE ws_placement SET container_id = ? WHERE id = ?").run(to.id, placement.id);
    stamp(db, from.id, to.id);
    return getPlacement(db, placement.id);
  });
}

// "Trash" is the tree's delete key: remove this one appearance. The row is
// deleted (restore is not meant to bring a trashed appearance back; undo is
// placing it again), the node stays everywhere else it is placed, and if that
// was its last live placement the node is unplaced, never archived. A
// placement that remains inside an archived container is hidden, so it does not
// count; and removing a placement that was already hidden or marked changes
// nothing about whether the node is placed, so that is not "became" unplaced.
export function trash(db: DatabaseSync, placementId: string): { removed: PlacementRow; became_unplaced: boolean } {
  return inSavepoint(db, "ws_trash", () => {
    const removed = getPlacement(db, placementId);
    const wasLive = isLivePlacement(db, removed);
    db.prepare("DELETE FROM ws_placement WHERE id = ?").run(removed.id);
    const left = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ws_placement p JOIN ws_node c ON c.id = p.container_id JOIN ws_node n ON n.id = p.child_id
          WHERE p.child_id = ? AND p.archived_at IS NULL AND c.archived_at IS NULL AND n.archived_at IS NULL`
      )
      .get(removed.child_id) as { n: number };
    stamp(db, removed.container_id);
    return { removed, became_unplaced: wasLive && left.n === 0 };
  });
}

// rename writes only the placement (spec §4.2) and retitle only the title
// (§4.1). There is no rename-everywhere: the brief keeps the two independent.
export function rename(db: DatabaseSync, placementId: string, name: string): PlacementRow {
  return inSavepoint(db, "ws_rename", () => {
    const placement = getPlacement(db, placementId);
    assertLivePlacement(db, placement);
    const clean = normalizeName(name);
    assertNameFree(db, placement.container_id, clean, placement.id);
    db.prepare("UPDATE ws_placement SET name = ? WHERE id = ?").run(clean, placement.id);
    stamp(db, placement.container_id);
    return getPlacement(db, placement.id);
  });
}

// ---- nodes -------------------------------------------------------------------

export function retitle(db: DatabaseSync, nodeId: string, title: string): NodeRow {
  return inSavepoint(db, "ws_retitle", () => {
    const node = getNode(db, nodeId);
    db.prepare("UPDATE ws_node SET title = ?, updated_at = datetime('now') WHERE id = ?").run(normalizeName(title), node.id);
    return getNode(db, node.id);
  });
}

// A tag is for files only. Clearing one is always fine: on a node that cannot
// carry one it is a no-op.
export function setKindTag(db: DatabaseSync, nodeId: string, tag: string | null): NodeRow {
  return inSavepoint(db, "ws_set_kind_tag", () => {
    const node = getNode(db, nodeId);
    const clean = normalizeKindTag(tag);
    if (clean !== null && node.kind !== "file") {
      throw new DomainError("invalid_input", `A ${node.kind} can't carry a kind tag; only files can.`);
    }
    db.prepare("UPDATE ws_node SET kind_tag = ?, updated_at = datetime('now') WHERE id = ?").run(clean, node.id);
    return getNode(db, node.id);
  });
}

interface PreparedContent {
  format: string;
  body: string | null;
  assetId: string | null;
  searchText: string | null;
}

// Version 1 of a new file's content. The layer reads `format` only to check its
// grammar and to know an upload from a text format: an upload holds an existing
// asset and no text, a text format holds no asset, and what search sees for an
// upload is the asset's extracted text. Everything else is the format's hooks.
function prepareContent(db: DatabaseSync, input: CreateNodeInput): PreparedContent {
  if (input.format == null) throw new DomainError("invalid_input", "A file needs a format.");
  if (!isFormatName(input.format)) {
    throw new DomainError("invalid_input", `"${String(input.format)}" is not a valid format name (lowercase a-z, 0-9 and "-", at most 40 characters).`);
  }
  if (input.body != null && typeof input.body !== "string") throw new DomainError("invalid_input", "A file body is text.");
  const format = input.format;
  const body = input.body ?? null;
  const assetId = input.asset_id ?? null;
  let searchSource = body;
  if (format === "upload") {
    if (body !== null) throw new DomainError("invalid_input", 'An "upload" file holds an uploaded asset, not text.');
    if (assetId === null) throw new DomainError("invalid_input", 'An "upload" file needs an asset_id.');
    const asset = db.prepare("SELECT extracted_text FROM asset WHERE id = ?").get(assetId) as { extracted_text: string | null } | undefined;
    if (!asset) throw new DomainError("not_found", `No asset ${String(assetId)}.`);
    searchSource = asset.extracted_text;
  } else if (assetId !== null) {
    throw new DomainError("invalid_input", `A "${format}" file holds text, not an asset.`);
  }
  return { format, body, assetId, searchText: checkContent(format, body, searchSource).search_text };
}

export function createNode(db: DatabaseSync, input: CreateNodeInput): { node: NodeRow; placement: PlacementRow | null } {
  return inSavepoint(db, "ws_create_node", () => {
    if (!NODE_KINDS.includes(input.kind)) throw new DomainError("invalid_input", `Unknown node kind "${String(input.kind)}".`);
    // The title is the default placement name, so it must be a valid one.
    const title = normalizeName(input.title);
    const kindTag = normalizeKindTag(input.kind_tag);
    if (kindTag !== null && input.kind !== "file") {
      throw new DomainError("invalid_input", `A ${input.kind} can't carry a kind tag; only files can.`);
    }
    const author = input.author ?? "ben";
    if (!AUTHORS.includes(author)) throw new DomainError("invalid_input", `Unknown author "${String(author)}".`);
    if (input.name != null && input.container_id == null) {
      throw new DomainError("invalid_input", "A name is the placement's name in a container, so it needs a container_id.");
    }

    let content: PreparedContent | null = null;
    if (input.kind === "file") {
      content = prepareContent(db, input);
    } else if (input.format != null || input.body != null || input.asset_id != null) {
      throw new DomainError("invalid_input", `A ${input.kind} holds no content.`);
    }
    const container = input.container_id != null ? getNode(db, input.container_id) : null;

    const id = uuidv4();
    db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES (?, ?, ?, ?)").run(id, input.kind, title, kindTag);
    if (content) {
      db.prepare(
        "INSERT INTO ws_content (node_id, version, format, body, asset_id, search_text, author) VALUES (?, 1, ?, ?, ?, ?, ?)"
      ).run(id, content.format, content.body, content.assetId, content.searchText, author);
    }
    const node = getNode(db, id);
    const placement = container ? insertPlacement(db, container, node, input.name) : null;
    return { node, placement };
  });
}

// ---- delete ------------------------------------------------------------------

// The nodes that would be left placed nowhere if `nodeId` went. That is a
// fixpoint: start from S = {the node}, and add a live node to S when every one
// of its live (unmarked) placements is in a container that is archived or in S.
// So a file placed in a course and in that course's subfolder goes with the
// course, while a file that is also placed in some other live container stays.
// Returned in the order they joined, not including the node itself.
function orphansOf(db: DatabaseSync, nodeId: string): string[] {
  const inSet = new Set<string>([nodeId]);
  const orphans: string[] = [];
  const childrenOf = db.prepare(
    `SELECT p.child_id AS id FROM ws_placement p JOIN ws_node n ON n.id = p.child_id
      WHERE p.container_id = ? AND p.archived_at IS NULL AND n.archived_at IS NULL ORDER BY p.created_at, p.id`
  );
  const placementsOf = db.prepare(
    `SELECT p.container_id AS container_id, c.archived_at AS archived_at FROM ws_placement p
       JOIN ws_node c ON c.id = p.container_id WHERE p.child_id = ? AND p.archived_at IS NULL`
  );
  // A candidate is a live child of something in S. Each pass can only grow S, so
  // it stops when a whole pass adds nothing.
  for (let grew = true; grew; ) {
    grew = false;
    for (const containerId of [...inSet]) {
      for (const { id } of childrenOf.all(containerId) as { id: string }[]) {
        if (inSet.has(id)) continue;
        const places = placementsOf.all(id) as { container_id: string; archived_at: string | null }[];
        if (places.every((p) => p.archived_at !== null || inSet.has(p.container_id))) {
          inSet.add(id);
          orphans.push(id);
          grew = true;
        }
      }
    }
  }
  return orphans;
}

function assertLiveNode(node: NodeRow): void {
  if (node.archived_at) throw new DomainError("archived", `"${node.title}" is already archived.`);
}

// What deleting a container would take with it, shown before anything happens:
// where the node will disappear from, and the orphans, the live nodes beneath it
// that are placed nowhere else. The caller shows the count, and only an explicit
// delete with `with_orphans` archives them too. Never silently.
export function deletePreview(db: DatabaseSync, nodeId: string): { appears_in: AppearsInRow[]; orphans: NodeSummary[] } {
  const node = getNode(db, nodeId);
  assertLiveNode(node);
  const orphans = summarize(db, orphansOf(db, node.id)).sort((a, b) => natural(a.title, b.title) || natural(a.id, b.id));
  return { appears_in: appearsIn(db, node.id), orphans };
}

// Archives the node everywhere: archived_at on the node and on every one of its
// placements, which are marked, not dropped, so restore can offer them back.
// Nothing is destroyed. Every node archived by this call shares one
// `archive_batch`, which is how restore finds what went with a container. A
// container's children keep their own placements in it, unmarked: they are
// hidden because the container is, and reappear when it is restored.
export function deleteNode(db: DatabaseSync, nodeId: string, opts?: { with_orphans?: boolean }): { archived: string[]; batch: string } {
  return inSavepoint(db, "ws_delete", () => {
    const node = getNode(db, nodeId);
    assertLiveNode(node);
    const archived = [node.id, ...(opts?.with_orphans ? orphansOf(db, node.id) : [])];
    const batch = uuidv4();
    const containersOf = db.prepare("SELECT container_id FROM ws_placement WHERE child_id = ? AND archived_at IS NULL");
    const markPlacements = db.prepare("UPDATE ws_placement SET archived_at = datetime('now') WHERE child_id = ? AND archived_at IS NULL");
    const markNode = db.prepare("UPDATE ws_node SET archived_at = datetime('now'), archive_batch = ?, updated_at = datetime('now') WHERE id = ?");
    for (const id of archived) {
      // The containers it vanishes from have changed contents.
      stamp(db, ...(containersOf.all(id) as { container_id: string }[]).map((r) => r.container_id));
      markPlacements.run(id);
      markNode.run(batch, id);
    }
    return { archived, batch };
  });
}

// ---- restore -----------------------------------------------------------------

// The node's marked placements, for the restore choice: each with its name and
// its container, and whether that container is itself archived (in which case
// choosing it will be skipped, not lost).
export function archivedPlacements(
  db: DatabaseSync,
  nodeId: string
): { placement_id: string; name: string; container: { id: string; kind: NodeKind; title: string; archived: boolean } }[] {
  const node = getNode(db, nodeId);
  const rows = db
    .prepare(
      `SELECT p.id AS placement_id, p.name AS name, c.id AS container_id, c.kind AS container_kind, c.title AS container_title,
              c.archived_at AS container_archived_at
         FROM ws_placement p JOIN ws_node c ON c.id = p.container_id
        WHERE p.child_id = ? AND p.archived_at IS NOT NULL`
    )
    .all(node.id) as unknown as {
    placement_id: string;
    name: string;
    container_id: string;
    container_kind: NodeKind;
    container_title: string;
    container_archived_at: string | null;
  }[];
  return rows
    .map((r) => ({
      placement_id: r.placement_id,
      name: r.name,
      container: { id: r.container_id, kind: r.container_kind, title: r.container_title, archived: r.container_archived_at !== null },
    }))
    .sort((a, b) => natural(a.container.title, b.container.title) || natural(a.name, b.name) || natural(a.placement_id, b.placement_id));
}

// Un-marks a placement, under the lowest free name if its own is taken now.
function revivePlacement(db: DatabaseSync, placement: PlacementRow): { name: string; renamed: boolean } {
  const name = freeName(db, placement.container_id, placement.name);
  db.prepare("UPDATE ws_placement SET archived_at = NULL, name = ? WHERE id = ?").run(name, placement.id);
  return { name, renamed: name !== placement.name };
}

// Brings a node back with exactly the placements the caller chose:
//   - A chosen placement whose container is live is un-marked. If its name
//     collides now, it is renamed to the free `name (n)` and reported.
//   - A chosen placement whose container is still archived stays marked and is
//     reported skipped: nothing appears inside an archived container, and the
//     choice is not lost, because restoring that container revives it.
//   - The unchosen placements are dropped. The node is live again, and an
//     archived placement of a live node would be a ghost that no read shows and
//     no call can revive. Choosing none restores the node unplaced.
//   - batch_mates are the other nodes archived by the same delete and still
//     archived, so a UI can offer "also restore N deleted with it".
//   - Restoring a container also un-marks the placements inside it whose child
//     is live: those are the skipped ones from the step above, now reviving.
export function restore(
  db: DatabaseSync,
  nodeId: string,
  placementIds: string[]
): {
  restored: string;
  placements: { placement_id: string; name: string; renamed: boolean }[];
  skipped: { placement_id: string; reason: "container_archived" }[];
  batch_mates: NodeSummary[];
} {
  return inSavepoint(db, "ws_restore", () => {
    const node = getNode(db, nodeId);
    if (!node.archived_at) throw new DomainError("not_archived", `"${node.title}" is not archived.`);
    if (!Array.isArray(placementIds)) throw new DomainError("invalid_input", "placements is a list of placement ids.");
    // Check every choice before changing anything.
    const chosen = [...new Set(placementIds)].map((id) => {
      const placement = getPlacement(db, id);
      if (placement.child_id !== node.id || placement.archived_at === null) {
        throw new DomainError("invalid_input", `Placement ${id} is not an archived placement of "${node.title}".`);
      }
      return placement;
    });

    db.prepare("UPDATE ws_node SET archived_at = NULL, archive_batch = NULL, updated_at = datetime('now') WHERE id = ?").run(node.id);

    const keep = new Set(chosen.map((p) => p.id));
    const marked = db.prepare("SELECT id FROM ws_placement WHERE child_id = ? AND archived_at IS NOT NULL").all(node.id) as { id: string }[];
    const drop = db.prepare("DELETE FROM ws_placement WHERE id = ?");
    for (const { id } of marked) if (!keep.has(id)) drop.run(id);

    const placements: { placement_id: string; name: string; renamed: boolean }[] = [];
    const skipped: { placement_id: string; reason: "container_archived" }[] = [];
    for (const placement of chosen) {
      if (getNode(db, placement.container_id).archived_at) {
        skipped.push({ placement_id: placement.id, reason: "container_archived" });
        continue;
      }
      const { name, renamed } = revivePlacement(db, placement);
      stamp(db, placement.container_id);
      placements.push({ placement_id: placement.id, name, renamed });
    }

    if (CONTAINER_KINDS.includes(node.kind)) {
      const waiting = db
        .prepare(
          `SELECT p.* FROM ws_placement p JOIN ws_node ch ON ch.id = p.child_id
            WHERE p.container_id = ? AND p.archived_at IS NOT NULL AND ch.archived_at IS NULL ORDER BY p.created_at, p.id`
        )
        .all(node.id) as unknown as PlacementRow[];
      for (const placement of waiting) revivePlacement(db, placement);
    }

    const mates =
      node.archive_batch === null
        ? []
        : (
            db.prepare("SELECT id FROM ws_node WHERE archive_batch = ? AND archived_at IS NOT NULL AND id <> ?").all(node.archive_batch, node.id) as {
              id: string;
            }[]
          ).map((r) => r.id);
    const batch_mates = summarize(db, mates).sort((a, b) => natural(a.title, b.title) || natural(a.id, b.id));
    return { restored: node.id, placements, skipped, batch_mates };
  });
}

// ---- purge -------------------------------------------------------------------

// The only operation that actually deletes. The node must be archived. Its
// placements (as container and as child) and content versions go with it (ON
// DELETE CASCADE); a child placed only in it is left unplaced, not archived. The
// one refusal beyond "must be archived" is an upload's wrapper while the upload
// exists (asset_in_use): the wrapper is `asset:<asset id>`, the next sync would
// only make it again, and deleting the upload is what archives it for good.
// A file that merely points at an asset is not the wrapper and purges as usual.
export function purge(db: DatabaseSync, nodeId: string): { purged: string } {
  return inSavepoint(db, "ws_purge", () => {
    const node = getNode(db, nodeId);
    if (!node.archived_at) throw new DomainError("not_archived", `"${node.title}" must be archived before it is purged.`);
    const wraps = db.prepare("SELECT 1 FROM asset a WHERE 'asset:' || a.id = ?").get(node.id);
    if (wraps) {
      throw new DomainError(
        "asset_in_use",
        `"${node.title}" is an upload that still exists, so it can't be purged. Delete the upload (Settings → Documents) to remove it for good.`
      );
    }
    const containers = db.prepare("SELECT container_id FROM ws_placement WHERE child_id = ?").all(node.id) as { container_id: string }[];
    stamp(db, ...containers.map((c) => c.container_id));
    db.prepare("DELETE FROM ws_node WHERE id = ?").run(node.id);
    return { purged: node.id };
  });
}
