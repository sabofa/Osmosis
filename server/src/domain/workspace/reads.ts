import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import { syncAssetFiles } from "./assetFiles.js";
import { classOf, getFileType } from "./fileTypes.js";
import { getNode } from "./graph.js";
import { CONTAINER_KINDS, KIND_TAGS } from "./types.js";
import type { Author, KindTag, NodeKind } from "./types.js";

// ----------------------------------------------------------------------------
// Graph reads (Learn spec/osmosis/workspace/01-shell.md §5).
//
// Two words are used the same way everywhere here:
//   live      a node that is not trashed. A placement is live when its child and
//             its container both are; a trashed node keeps its placements but
//             they are hidden.
//   unplaced  a live node with no placement in a live container (so a file whose
//             only container is in the trash is unplaced, and shows in the roots).
// ----------------------------------------------------------------------------

export interface NodeSummary {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: KindTag | null;
  type: string | null;
  class: string | null;
  placement_count: number;
  has_children: boolean;
  trashed_at: string | null;
}

export interface ChildRow {
  placement_id: string;
  name: string;
  node: NodeSummary;
}

export interface AppearsInRow {
  placement_id: string;
  container: { id: string; kind: NodeKind; title: string };
  name: string;
}

export interface SearchRow {
  placement_id: string | null;
  name: string;
  node: NodeSummary;
  container_id: string | null;
}

type Param = string | number | null;

// ---- summaries ---------------------------------------------------------------

// What a NodeSummary is built from, in one query: the node, its file's type and
// body (for class), the asset behind an asset file (for class), how many live
// containers it is placed in, and whether it holds any live child.
const SUMMARY_COLS = `
  n.id AS id, n.kind AS kind, n.title AS title, n.kind_tag AS kind_tag, n.trashed_at AS trashed_at,
  f.type AS file_type, f.body AS file_body, a.mime AS asset_mime, a.type AS asset_type,
  (SELECT COUNT(*) FROM ws_placement pc JOIN ws_node cc ON cc.id = pc.container_id
    WHERE pc.child_id = n.id AND cc.trashed_at IS NULL) AS placement_count,
  CASE WHEN n.trashed_at IS NULL AND EXISTS (
    SELECT 1 FROM ws_placement ph JOIN ws_node hc ON hc.id = ph.child_id
     WHERE ph.container_id = n.id AND hc.trashed_at IS NULL) THEN 1 ELSE 0 END AS has_children`;
const SUMMARY_JOINS = "LEFT JOIN ws_file f ON f.node_id = n.id LEFT JOIN asset a ON a.id = f.asset_id";
const NOT_UNPLACED = `EXISTS (SELECT 1 FROM ws_placement pu JOIN ws_node cu ON cu.id = pu.container_id
                               WHERE pu.child_id = n.id AND cu.trashed_at IS NULL)`;

interface SummaryRow {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: KindTag | null;
  trashed_at: string | null;
  file_type: string | null;
  file_body: string | null;
  asset_mime: string | null;
  asset_type: string | null;
  placement_count: number;
  has_children: number;
}

// A file's class: its type's page kinds through classOf; for an uploaded asset,
// what the upload is. A type that is no longer registered has no class rather
// than failing the whole listing.
function classFor(row: SummaryRow): string | null {
  if (row.kind !== "file" || row.file_type === null) return null;
  try {
    const spec = getFileType(row.file_type);
    if (spec.storage === "asset") {
      if (row.asset_type === null) return classOf([]);
      if (row.asset_mime === "application/pdf") return "pdf";
      if (row.asset_mime?.startsWith("image/")) return "image";
      return row.asset_type === "url" ? "link" : "document";
    }
    return classOf(spec.kinds(row.file_body));
  } catch (err) {
    if (err instanceof DomainError) return null;
    throw err;
  }
}

function toSummary(row: SummaryRow): NodeSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    kind_tag: row.kind_tag,
    type: row.file_type,
    class: classFor(row),
    placement_count: Number(row.placement_count),
    has_children: Number(row.has_children) === 1,
    trashed_at: row.trashed_at,
  };
}

function selectNodes(db: DatabaseSync, where: string, params: Param[] = []): SummaryRow[] {
  return db.prepare(`SELECT ${SUMMARY_COLS} FROM ws_node n ${SUMMARY_JOINS} WHERE ${where}`).all(...params) as unknown as SummaryRow[];
}

function summaryOf(db: DatabaseSync, id: string): NodeSummary | undefined {
  const row = selectNodes(db, "n.id = ?", [id])[0];
  return row ? toSummary(row) : undefined;
}

// ---- ordering ----------------------------------------------------------------

const collator = new Intl.Collator("en", { numeric: true });
const natural = (a: string, b: string): number => collator.compare(a, b);
const isContainer = (kind: NodeKind): boolean => CONTAINER_KINDS.includes(kind);

// Case-folded and NFC-normalized, the way names are compared (names.ts).
const fold = (s: string): string => s.normalize("NFC").toLocaleLowerCase("en");

// ---- the reads ---------------------------------------------------------------

export function appearsIn(db: DatabaseSync, nodeId: string): AppearsInRow[] {
  const node = getNode(db, nodeId);
  const rows = db
    .prepare(
      `SELECT p.id AS placement_id, p.name AS name, c.id AS container_id, c.kind AS container_kind, c.title AS container_title
         FROM ws_placement p JOIN ws_node c ON c.id = p.container_id
        WHERE p.child_id = ? AND c.trashed_at IS NULL`
    )
    .all(node.id) as unknown as { placement_id: string; name: string; container_id: string; container_kind: NodeKind; container_title: string }[];
  return rows
    .map((r) => ({ placement_id: r.placement_id, container: { id: r.container_id, kind: r.container_kind, title: r.container_title }, name: r.name }))
    .sort((a, b) => natural(a.container.title, b.container.title) || natural(a.name, b.name) || natural(a.placement_id, b.placement_id));
}

// Every track above the node, through folders and courses (and other tracks).
// Only live containers count, so a track in the trash is not a parent.
export function parentTracks(db: DatabaseSync, nodeId: string): { id: string; title: string }[] {
  const node = getNode(db, nodeId);
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id) AS (
         SELECT p.container_id FROM ws_placement p JOIN ws_node c ON c.id = p.container_id
          WHERE p.child_id = ? AND c.trashed_at IS NULL
         UNION
         SELECT p.container_id FROM ws_placement p JOIN up ON p.child_id = up.id JOIN ws_node c ON c.id = p.container_id
          WHERE c.trashed_at IS NULL
       )
       SELECT n.id AS id, n.title AS title FROM ws_node n WHERE n.kind = 'track' AND n.id IN (SELECT id FROM up)`
    )
    .all(node.id) as unknown as { id: string; title: string }[];
  return rows.sort((a, b) => natural(a.title, b.title) || natural(a.id, b.id));
}

export function getNodeDetail(
  db: DatabaseSync,
  id: string
): {
  node: NodeSummary;
  appears_in: AppearsInRow[];
  parent_tracks: { id: string; title: string }[];
  file: { type: string; revision: number; saved_at: string; saved_by: Author; asset_id: string | null } | null;
} {
  const node = summaryOf(db, id);
  if (!node) throw new DomainError("not_found", `No node ${id}.`);
  const file = db.prepare("SELECT type, revision, saved_at, saved_by, asset_id FROM ws_file WHERE node_id = ?").get(id) as unknown as
    | { type: string; revision: number; saved_at: string; saved_by: Author; asset_id: string | null }
    | undefined;
  return { node, appears_in: appearsIn(db, id), parent_tracks: parentTracks(db, id), file: file ?? null };
}

// The workspace's top level: every live track and course, and what is unplaced
// (files and folders only; a track or course with no parent is simply a root,
// not "unplaced"). Uploads get their asset file first, so a new upload is
// listed here the moment it exists.
export function listRoots(db: DatabaseSync): { tracks: NodeSummary[]; courses: NodeSummary[]; unplaced: NodeSummary[] } {
  syncAssetFiles(db);
  const sorted = (rows: SummaryRow[]): NodeSummary[] =>
    rows.map(toSummary).sort((a, b) => natural(a.title, b.title) || natural(a.id, b.id));
  return {
    tracks: sorted(selectNodes(db, "n.trashed_at IS NULL AND n.kind = 'track'")),
    courses: sorted(selectNodes(db, "n.trashed_at IS NULL AND n.kind = 'course'")),
    unplaced: sorted(selectNodes(db, `n.trashed_at IS NULL AND n.kind IN ('file', 'folder') AND NOT ${NOT_UNPLACED}`)),
  };
}

// Live children only, each under the name of its placement here. A trashed
// container has no live children. Containers come first, then files; within
// each, names sort naturally ("unit 2" before "unit 10").
export function listChildren(db: DatabaseSync, containerId: string): ChildRow[] {
  const container = getNode(db, containerId);
  if (container.trashed_at) return [];
  const rows = db
    .prepare(
      `SELECT p.id AS placement_id, p.name AS placement_name, ${SUMMARY_COLS}
         FROM ws_placement p JOIN ws_node n ON n.id = p.child_id ${SUMMARY_JOINS}
        WHERE p.container_id = ? AND n.trashed_at IS NULL`
    )
    .all(container.id) as unknown as (SummaryRow & { placement_id: string; placement_name: string })[];
  return rows
    .map((r) => ({ placement_id: r.placement_id, name: r.placement_name, node: toSummary(r) }))
    .sort(
      (a, b) =>
        Number(isContainer(b.node.kind)) - Number(isContainer(a.node.kind)) || natural(a.name, b.name) || natural(a.placement_id, b.placement_id)
    );
}

// Walks the live placements down from a container. The root is included in the
// walk (so a trashed root reaches nothing) and the caller drops it.
const DOWN_CTE = `WITH RECURSIVE down(id) AS (
  SELECT id FROM ws_node WHERE id = ? AND trashed_at IS NULL
  UNION
  SELECT p.child_id FROM ws_placement p JOIN down ON p.container_id = down.id JOIN ws_node ch ON ch.id = p.child_id
   WHERE ch.trashed_at IS NULL
)`;

// Ids of the live nodes reachable downward from a container, not the container.
export function reach(db: DatabaseSync, containerId: string): string[] {
  const root = getNode(db, containerId);
  const rows = db.prepare(`${DOWN_CTE} SELECT id FROM down WHERE id <> ?`).all(root.id, root.id) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

// The courses under a track, each with the placement names from the track down
// to it ("Year 1", "math"). A course reachable by several routes is listed
// once, by its shortest route.
export function coursesIn(db: DatabaseSync, trackId: string): { node: NodeSummary; path: string[] }[] {
  const root = getNode(db, trackId);
  if (root.trashed_at) return [];
  const childrenOf = db.prepare(
    `SELECT p.child_id AS id, p.name AS name, n.kind AS kind FROM ws_placement p JOIN ws_node n ON n.id = p.child_id
      WHERE p.container_id = ? AND n.trashed_at IS NULL`
  );
  const seen = new Set<string>([root.id]);
  const found: { id: string; path: string[] }[] = [];
  const queue: { id: string; path: string[] }[] = [{ id: root.id, path: [] }];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const children = (childrenOf.all(at.id) as unknown as { id: string; name: string; kind: NodeKind }[]).sort(
      (a, b) => natural(a.name, b.name) || natural(a.id, b.id)
    );
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const path = [...at.path, child.name];
      if (child.kind === "course") found.push({ id: child.id, path });
      if (isContainer(child.kind)) queue.push({ id: child.id, path });
    }
  }
  return found
    .sort((a, b) => natural(a.path.join("/"), b.path.join("/")))
    .map((f) => ({ node: summaryOf(db, f.id)!, path: f.path }));
}

// Plain filtering in JS over rows from SQL: a personal bank is small, and FTS is
// a later step. `q` matches the placement's name, the node's title, and the
// type's searchText of the body. One row per live placement (so a file in two
// courses appears twice, under each local name). With a scope, only the
// placements within reach of that container; without one, every live placement
// plus each unplaced node (a root track or course included) once, with no
// placement and its title as the name.
export function searchWorkspace(db: DatabaseSync, opts: { q?: string; scope?: string; kind_tag?: KindTag }): SearchRow[] {
  syncAssetFiles(db);
  if (opts.kind_tag !== undefined && !KIND_TAGS.includes(opts.kind_tag)) {
    throw new DomainError("invalid_input", `Unknown kind tag "${String(opts.kind_tag)}".`);
  }
  const tag = opts.kind_tag !== undefined ? " AND n.kind_tag = ?" : "";
  const tagParam: Param[] = opts.kind_tag !== undefined ? [opts.kind_tag] : [];
  const placementCols = `p.id AS placement_id, p.name AS placement_name, p.container_id AS container_id, ${SUMMARY_COLS}`;

  type Found = SummaryRow & { placement_id: string | null; placement_name: string | null; container_id: string | null };
  let rows: Found[];
  if (opts.scope !== undefined) {
    const root = getNode(db, opts.scope);
    rows = db
      .prepare(
        `${DOWN_CTE}
         SELECT ${placementCols}
           FROM ws_placement p JOIN down ON down.id = p.container_id
           JOIN ws_node n ON n.id = p.child_id AND n.trashed_at IS NULL ${SUMMARY_JOINS}
          WHERE 1 = 1${tag}`
      )
      .all(root.id, ...tagParam) as unknown as Found[];
  } else {
    const placed = db
      .prepare(
        `SELECT ${placementCols}
           FROM ws_placement p JOIN ws_node c ON c.id = p.container_id AND c.trashed_at IS NULL
           JOIN ws_node n ON n.id = p.child_id AND n.trashed_at IS NULL ${SUMMARY_JOINS}
          WHERE 1 = 1${tag}`
      )
      .all(...tagParam) as unknown as Found[];
    const unplaced = db
      .prepare(
        `SELECT NULL AS placement_id, NULL AS placement_name, NULL AS container_id, ${SUMMARY_COLS}
           FROM ws_node n ${SUMMARY_JOINS}
          WHERE n.trashed_at IS NULL AND NOT ${NOT_UNPLACED}${tag}`
      )
      .all(...tagParam) as unknown as Found[];
    rows = [...placed, ...unplaced];
  }

  const q = fold((opts.q ?? "").trim());
  const matches = (row: Found): boolean => {
    if (q === "") return true;
    if (fold(row.placement_name ?? row.title).includes(q) || fold(row.title).includes(q)) return true;
    if (row.file_type === null) return false;
    try {
      const text = getFileType(row.file_type).searchText?.(row.file_body);
      return text !== undefined && fold(text).includes(q);
    } catch (err) {
      if (err instanceof DomainError) return false;
      throw err;
    }
  };
  return rows
    .filter(matches)
    .map((r) => ({ placement_id: r.placement_id, name: r.placement_name ?? r.title, node: toSummary(r), container_id: r.container_id }))
    .sort((a, b) => natural(a.name, b.name) || natural(a.placement_id ?? "", b.placement_id ?? "") || natural(a.node.id, b.node.id));
}

// Everything in the trash, most recently trashed first. Uploads get their asset
// file first, so an upload deleted behind the graph's back is here already.
export function listTrash(db: DatabaseSync): NodeSummary[] {
  syncAssetFiles(db);
  return selectNodes(db, "n.trashed_at IS NOT NULL")
    .map(toSummary)
    .sort((a, b) => natural(b.trashed_at ?? "", a.trashed_at ?? "") || natural(a.title, b.title) || natural(a.id, b.id));
}
