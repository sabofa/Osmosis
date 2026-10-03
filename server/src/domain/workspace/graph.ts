import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../errors.js";
import { getFileType } from "./fileTypes.js";
import { normalizeName, sameName } from "./names.js";
import { AUTHORS, CONTAINER_KINDS, KIND_TAGS, MAY_HOLD, NODE_KINDS } from "./types.js";
import type { Author, KindTag, NodeKind, NodeRow, PlacementRow } from "./types.js";

// ----------------------------------------------------------------------------
// Graph writes (Learn spec/osmosis/workspace/01-shell.md §2-§4).
//
// A node is a track, course, folder or file; a placement says "this node
// appears in this container, under this name". The four rules the writes
// enforce:
//   1. Remove means remove-from-here: removePlacement deletes one edge and the
//      node lives on, unplaced if that was its last. Only destroyNode trashes.
//   2. Names live on placements. The node's `title` is just the default name;
//      renaming a placement never touches it. renameNode(everywhere) follows
//      the placements that still carry the old title.
//   3. Containment (MAY_HOLD) and no cycles, checked on every placement.
//   4. Names are unique among the *live* siblings of a container. A trashed
//      node holds no name; restoring it renames whatever now collides.
//
// Every write runs in a SAVEPOINT (callers may already hold a transaction) and
// stamps updated_at on the nodes it changes: the node for a node-level write,
// the containers whose contents changed for a placement-level one.
// ----------------------------------------------------------------------------

export interface CreateNodeInput {
  kind: NodeKind;
  title: string;
  kind_tag?: KindTag | null;
  file?: { type: string; body?: string | null; asset_id?: string | null };
  place_in?: { container_id: string; name?: string };
  author?: Author;
}

const NAME_LIMIT = 200;

// SAVEPOINT / RELEASE / ROLLBACK TO rather than BEGIN: a caller may already be
// inside a transaction, and a nested BEGIN is an error.
function inSavepoint<T>(db: DatabaseSync, name: string, fn: () => T): T {
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

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

// Containment, then trashed, then cycles — the order the spec lists them.
function assertMayPlace(db: DatabaseSync, container: NodeRow, child: NodeRow): void {
  if (!CONTAINER_KINDS.includes(container.kind)) {
    throw new DomainError("containment_not_allowed", `A ${container.kind} can't hold anything (containment rule).`);
  }
  if (!MAY_HOLD[container.kind].includes(child.kind)) {
    throw new DomainError("containment_not_allowed", `A ${container.kind} can't hold a ${child.kind} (containment rule).`);
  }
  if (container.trashed_at) {
    throw new DomainError("trashed", `"${container.title}" is in the trash; restore it before placing anything in it.`);
  }
  if (child.trashed_at) {
    throw new DomainError("trashed", `"${child.title}" is in the trash; restore it before placing it.`);
  }
  if (child.id === container.id || isAncestor(db, child.id, container.id)) {
    throw new DomainError("cycle_rejected", `Placing "${child.title}" in "${container.title}" would make a cycle.`);
  }
}

// Is `ancestorId` above `nodeId` through any chain of placements? Trashed
// nodes count: a trashed folder can be restored, and the cycle with it.
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

// Names of the placements in a container whose child is not trashed. The one
// being renamed or moved is not its own sibling.
function liveSiblingNames(db: DatabaseSync, containerId: string, exceptPlacementId: string): string[] {
  const rows = db
    .prepare(
      `SELECT p.name AS name FROM ws_placement p JOIN ws_node n ON n.id = p.child_id
        WHERE p.container_id = ? AND p.id <> ? AND n.trashed_at IS NULL`
    )
    .all(containerId, exceptPlacementId) as { name: string }[];
  return rows.map((r) => r.name);
}

// `name` if no live sibling has it, otherwise the lowest free "name (n)",
// n >= 2. Serves the name_taken suggestion and restore. A suffix never pushes
// a name past the length limit: the base gives way instead.
export function freeName(db: DatabaseSync, containerId: string, name: string, exceptPlacementId?: string): string {
  const wanted = normalizeName(name);
  const taken = liveSiblingNames(db, containerId, exceptPlacementId ?? "");
  const isTaken = (candidate: string) => taken.some((t) => sameName(t, candidate));
  if (!isTaken(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const base = [...wanted].slice(0, NAME_LIMIT - [...suffix].length).join("").trimEnd();
    const candidate = base + suffix;
    if (!isTaken(candidate)) return candidate;
  }
}

// A trashed child holds no name, so nothing it is called can collide; restore
// settles it. `name` must already be normalized.
function assertNameFree(db: DatabaseSync, containerId: string, name: string, exceptPlacementId: string, child: NodeRow): void {
  if (child.trashed_at) return;
  const free = freeName(db, containerId, name, exceptPlacementId);
  if (free !== name) {
    throw new DomainError("name_taken", `"${name}" is already taken here; try "${free}".`, { suggestion: free });
  }
}

// ---- placements --------------------------------------------------------------

function insertPlacement(db: DatabaseSync, container: NodeRow, child: NodeRow, rawName: string | undefined): PlacementRow {
  assertMayPlace(db, container, child);
  const name = normalizeName(rawName ?? child.title);
  const already = db.prepare("SELECT 1 FROM ws_placement WHERE container_id = ? AND child_id = ?").get(container.id, child.id);
  if (already) throw new DomainError("already_placed", `"${child.title}" is already in "${container.title}".`);
  assertNameFree(db, container.id, name, "", child);
  const id = uuidv4();
  db.prepare("INSERT INTO ws_placement (id, container_id, child_id, name) VALUES (?, ?, ?, ?)").run(id, container.id, child.id, name);
  stamp(db, container.id);
  return getPlacement(db, id);
}

export function placeNode(db: DatabaseSync, input: { container_id: string; child_id: string; name?: string }): PlacementRow {
  return inSavepoint(db, "ws_place_node", () =>
    insertPlacement(db, getNode(db, input.container_id), getNode(db, input.child_id), input.name)
  );
}

export function renamePlacement(db: DatabaseSync, placementId: string, name: string): PlacementRow {
  return inSavepoint(db, "ws_rename_placement", () => {
    const placement = getPlacement(db, placementId);
    const clean = normalizeName(name);
    assertNameFree(db, placement.container_id, clean, placement.id, getNode(db, placement.child_id));
    db.prepare("UPDATE ws_placement SET name = ? WHERE id = ?").run(clean, placement.id);
    stamp(db, placement.container_id);
    return getPlacement(db, placement.id);
  });
}

// Re-parents one placement. It keeps its id and its name, and the destination
// is checked exactly like a new placement.
export function movePlacement(db: DatabaseSync, placementId: string, containerId: string): PlacementRow {
  return inSavepoint(db, "ws_move_placement", () => {
    const placement = getPlacement(db, placementId);
    if (placement.container_id === containerId) return placement;
    const container = getNode(db, containerId);
    const child = getNode(db, placement.child_id);
    assertMayPlace(db, container, child);
    const already = db.prepare("SELECT 1 FROM ws_placement WHERE container_id = ? AND child_id = ?").get(container.id, child.id);
    if (already) throw new DomainError("already_placed", `"${child.title}" is already in "${container.title}".`);
    assertNameFree(db, container.id, placement.name, placement.id, child);
    db.prepare("UPDATE ws_placement SET container_id = ? WHERE id = ?").run(container.id, placement.id);
    stamp(db, placement.container_id, container.id);
    return getPlacement(db, placement.id);
  });
}

// "Remove" means remove from here: one placement goes, the node stays, and if
// that was its last placement the node is simply unplaced, not destroyed.
export function removePlacement(db: DatabaseSync, placementId: string): { removed: PlacementRow; became_unplaced: boolean } {
  return inSavepoint(db, "ws_remove_placement", () => {
    const removed = getPlacement(db, placementId);
    db.prepare("DELETE FROM ws_placement WHERE id = ?").run(removed.id);
    const left = db.prepare("SELECT COUNT(*) AS n FROM ws_placement WHERE child_id = ?").get(removed.child_id) as { n: number };
    stamp(db, removed.container_id);
    return { removed, became_unplaced: left.n === 0 };
  });
}

// ---- nodes -------------------------------------------------------------------

function checkFile(db: DatabaseSync, file: NonNullable<CreateNodeInput["file"]>): { type: string; body: string | null; assetId: string | null } {
  const spec = getFileType(file.type);
  if (file.body != null && typeof file.body !== "string") throw new DomainError("invalid_input", "A file body is text.");
  const body = file.body ?? null;
  const assetId = file.asset_id ?? null;
  if (spec.storage === "asset") {
    if (body !== null) throw new DomainError("invalid_input", `A "${spec.type}" file holds an uploaded asset, not text.`);
    if (assetId === null) throw new DomainError("invalid_input", `A "${spec.type}" file needs an asset_id.`);
    if (!db.prepare("SELECT 1 FROM asset WHERE id = ?").get(assetId)) throw new DomainError("not_found", `No asset ${assetId}.`);
  } else if (assetId !== null) {
    throw new DomainError("invalid_input", `A "${spec.type}" file holds ${spec.storage}, not an asset.`);
  }
  const problem = spec.validate?.(body);
  if (problem) throw new DomainError("invalid_content", problem);
  return { type: spec.type, body, assetId };
}

export function createNode(db: DatabaseSync, input: CreateNodeInput): { node: NodeRow; placement: PlacementRow | null } {
  return inSavepoint(db, "ws_create_node", () => {
    if (!NODE_KINDS.includes(input.kind)) throw new DomainError("invalid_input", `Unknown node kind "${String(input.kind)}".`);
    // The title is the default placement name, so it must be a valid one.
    const title = normalizeName(input.title);
    const kindTag = input.kind_tag ?? null;
    if (kindTag !== null && !KIND_TAGS.includes(kindTag)) throw new DomainError("invalid_input", `Unknown kind tag "${String(kindTag)}".`);
    const author = input.author ?? "ben";
    if (!AUTHORS.includes(author)) throw new DomainError("invalid_input", `Unknown author "${String(author)}".`);

    let file: ReturnType<typeof checkFile> | null = null;
    if (input.kind === "file") {
      if (input.file == null) throw new DomainError("invalid_input", "A file needs a file type.");
      file = checkFile(db, input.file);
    } else if (input.file != null) {
      throw new DomainError("invalid_input", `A ${input.kind} holds no file content.`);
    }
    const container = input.place_in ? getNode(db, input.place_in.container_id) : null;

    const id = uuidv4();
    db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES (?, ?, ?, ?)").run(id, input.kind, title, kindTag);
    if (file) {
      db.prepare("INSERT INTO ws_file (node_id, type, body, asset_id, revision, saved_by) VALUES (?, ?, ?, ?, 1, ?)").run(
        id,
        file.type,
        file.body,
        file.assetId,
        author
      );
      db.prepare(
        `INSERT INTO ws_file_revision (node_id, revision, type, body, asset_id, saved_at, saved_by)
         SELECT node_id, revision, type, body, asset_id, saved_at, saved_by FROM ws_file WHERE node_id = ?`
      ).run(id);
    }
    const node = getNode(db, id);
    const placement = container ? insertPlacement(db, container, node, input.place_in?.name) : null;
    return { node, placement };
  });
}

// Renames the node's title. With `everywhere`, placements that still carry the
// old title follow it; one a user renamed on purpose is left alone. A
// collision at any of them refuses the whole rename.
export function renameNode(db: DatabaseSync, nodeId: string, title: string, opts?: { everywhere?: boolean }): NodeRow {
  return inSavepoint(db, "ws_rename_node", () => {
    const node = getNode(db, nodeId);
    const clean = normalizeName(title);
    if (opts?.everywhere) {
      const following = db.prepare("SELECT * FROM ws_placement WHERE child_id = ? AND name = ?").all(node.id, node.title) as unknown as PlacementRow[];
      for (const placement of following) {
        if (placement.name === clean) continue;
        assertNameFree(db, placement.container_id, clean, placement.id, node);
        db.prepare("UPDATE ws_placement SET name = ? WHERE id = ?").run(clean, placement.id);
        stamp(db, placement.container_id);
      }
    }
    db.prepare("UPDATE ws_node SET title = ?, updated_at = datetime('now') WHERE id = ?").run(clean, node.id);
    return getNode(db, node.id);
  });
}

export function setKindTag(db: DatabaseSync, nodeId: string, tag: KindTag | null): NodeRow {
  return inSavepoint(db, "ws_set_kind_tag", () => {
    const node = getNode(db, nodeId);
    if (tag !== null && !KIND_TAGS.includes(tag)) throw new DomainError("invalid_input", `Unknown kind tag "${String(tag)}".`);
    db.prepare("UPDATE ws_node SET kind_tag = ?, updated_at = datetime('now') WHERE id = ?").run(tag, node.id);
    return getNode(db, node.id);
  });
}

// ---- trash -------------------------------------------------------------------

// Sends a node to the trash. No placement is deleted: a trashed node keeps
// its places, hidden, so restore puts everything back. With `withOrphans`,
// each direct child placed nowhere else goes too — recursively through the
// containers among them. Children that are shared, or already trashed, stay.
export function destroyNode(db: DatabaseSync, nodeId: string, opts?: { withOrphans?: boolean }): { trashed: string[] } {
  return inSavepoint(db, "ws_destroy_node", () => {
    const node = getNode(db, nodeId);
    if (node.trashed_at) throw new DomainError("trashed", `"${node.title}" is already in the trash.`);
    const trashed: string[] = [];
    const trash = (id: string) => {
      db.prepare("UPDATE ws_node SET trashed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
      trashed.push(id);
    };
    trash(node.id);
    if (opts?.withOrphans) {
      const orphans = db.prepare(
        `SELECT p.child_id AS id, n.kind AS kind FROM ws_placement p JOIN ws_node n ON n.id = p.child_id
          WHERE p.container_id = ? AND n.trashed_at IS NULL
            AND (SELECT COUNT(*) FROM ws_placement q WHERE q.child_id = p.child_id) = 1`
      );
      const queue = [node.id];
      for (let containerId = queue.shift(); containerId !== undefined; containerId = queue.shift()) {
        for (const child of orphans.all(containerId) as { id: string; kind: NodeKind }[]) {
          trash(child.id);
          if (CONTAINER_KINDS.includes(child.kind)) queue.push(child.id);
        }
      }
    }
    return { trashed };
  });
}

// Brings a node back from the trash. Its placements were hidden, not removed;
// any whose name now collides with a live sibling is renamed to the lowest
// free "name (n)" and reported, so the caller can tell the user.
export function restoreNode(db: DatabaseSync, nodeId: string): { restored: string; renamed: { placement_id: string; name: string }[] } {
  return inSavepoint(db, "ws_restore_node", () => {
    const node = getNode(db, nodeId);
    if (!node.trashed_at) throw new DomainError("not_trashed", `"${node.title}" is not in the trash.`);
    db.prepare("UPDATE ws_node SET trashed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(node.id);
    const renamed: { placement_id: string; name: string }[] = [];
    const placements = db.prepare("SELECT * FROM ws_placement WHERE child_id = ? ORDER BY created_at, id").all(node.id) as unknown as PlacementRow[];
    for (const placement of placements) {
      const free = freeName(db, placement.container_id, placement.name, placement.id);
      if (free === placement.name) continue;
      db.prepare("UPDATE ws_placement SET name = ? WHERE id = ?").run(free, placement.id);
      stamp(db, placement.container_id);
      renamed.push({ placement_id: placement.id, name: free });
    }
    return { restored: node.id, renamed };
  });
}

// Deletes a trashed node for good. Its placements, file and revisions go with
// it (ON DELETE CASCADE); a child placed only in it is left unplaced, not
// destroyed.
export function purgeNode(db: DatabaseSync, nodeId: string): { purged: string } {
  return inSavepoint(db, "ws_purge_node", () => {
    const node = getNode(db, nodeId);
    if (!node.trashed_at) throw new DomainError("not_trashed", `"${node.title}" must be in the trash before it is purged.`);
    const containers = db.prepare("SELECT container_id FROM ws_placement WHERE child_id = ?").all(node.id) as { container_id: string }[];
    stamp(db, ...containers.map((c) => c.container_id));
    db.prepare("DELETE FROM ws_node WHERE id = ?").run(node.id);
    return { purged: node.id };
  });
}
