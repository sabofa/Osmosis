import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import { normalizeKindTag } from "./names.js";
import { CONTAINER_KINDS } from "./types.js";
import type { Author, NodeKind } from "./types.js";

// ----------------------------------------------------------------------------
// Graph reads (Learn spec/osmosis/workspace/02-data-layer.md §6).
//
// "Live" is used the same way everywhere: a node is live when `archived_at` is
// null, and a placement is live when it, its container and its child all are.
// A placement inside an archived container is hidden, not marked. Every read
// here is live-only unless it is named otherwise (`archived` is).
//
// Reads never call a format hook (spec §7). Search matches the `search_text`
// that was stored when each version was written, so a body whose format can no
// longer read it costs that file nothing in a listing.
// ----------------------------------------------------------------------------

export interface NodeSummary {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: string | null;
  // The latest content version's format; null for anything that is not a file.
  format: string | null;
  // Live placements only, so an archived node always has none.
  placement_count: number;
  has_children: boolean;
  archived_at: string | null;
  // A live trajectory, track or course with no live placement. That is a normal
  // state for a container, not the "unplaced" of a file or a folder; for any
  // other kind, and for an archived node, it is false.
  top_level: boolean;
}

export interface AppearsInRow {
  placement_id: string;
  name: string;
  container: { id: string; kind: NodeKind; title: string };
}

export interface ChildRow {
  placement_id: string;
  name: string;
  // True when the node has more than one live placement.
  appears_elsewhere: boolean;
  node: NodeSummary;
}

// One row per placement path under a container. `depth` is 0 for the container's
// direct children, which have no parent placement, and one more for each level
// down, so a tree can be drawn from the rows alone.
export interface SubtreeRow {
  placement_id: string;
  parent_placement_id: string | null;
  depth: number;
  name: string;
  node: NodeSummary;
}

// A live placement and what it places: what by_kind_tag, search and context return.
export interface PlacedRow {
  placement_id: string;
  name: string;
  container_id: string;
  node: NodeSummary;
}

// ---- summaries ---------------------------------------------------------------

// What a NodeSummary is built from, in one statement: the node, its latest
// version's format, how many live placements it has, and whether it holds any
// live child.
const SUMMARY_COLS = `
  n.id AS id, n.kind AS kind, n.title AS title, n.kind_tag AS kind_tag, n.archived_at AS archived_at,
  (SELECT c.format FROM ws_content c WHERE c.node_id = n.id ORDER BY c.version DESC LIMIT 1) AS format,
  (SELECT COUNT(*) FROM ws_placement p JOIN ws_node co ON co.id = p.container_id
    WHERE p.child_id = n.id AND p.archived_at IS NULL AND co.archived_at IS NULL AND n.archived_at IS NULL) AS placement_count,
  EXISTS (SELECT 1 FROM ws_placement p JOIN ws_node ch ON ch.id = p.child_id
           WHERE p.container_id = n.id AND p.archived_at IS NULL AND ch.archived_at IS NULL AND n.archived_at IS NULL) AS has_children`;

interface SummaryRow {
  id: string;
  kind: NodeKind;
  title: string;
  kind_tag: string | null;
  archived_at: string | null;
  format: string | null;
  placement_count: number;
  has_children: number;
}

const TOP_LEVEL_KINDS: readonly NodeKind[] = ["trajectory", "track", "course"];

function toSummary(row: SummaryRow): NodeSummary {
  const placementCount = Number(row.placement_count);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    kind_tag: row.kind_tag,
    format: row.format,
    placement_count: placementCount,
    has_children: Number(row.has_children) === 1,
    archived_at: row.archived_at,
    top_level: row.archived_at === null && TOP_LEVEL_KINDS.includes(row.kind) && placementCount === 0,
  };
}

// One row per id, in the order given, for ids that exist.
export function summarize(db: DatabaseSync, nodeIds: readonly string[]): NodeSummary[] {
  const select = db.prepare(`SELECT ${SUMMARY_COLS} FROM ws_node n WHERE n.id = ?`);
  const summaries: NodeSummary[] = [];
  for (const id of nodeIds) {
    const row = select.get(id) as unknown as SummaryRow | undefined;
    if (row) summaries.push(toSummary(row));
  }
  return summaries;
}

function summariesWhere(db: DatabaseSync, where: string): NodeSummary[] {
  return (db.prepare(`SELECT ${SUMMARY_COLS} FROM ws_node n WHERE ${where}`).all() as unknown as SummaryRow[]).map(toSummary);
}

// The node's kind, or not_found. Reads need no more of a node than that, and
// importing graph.ts's getNode instead would make this file and graph.ts (which
// builds on summarize and appearsIn) import each other.
function kindOf(db: DatabaseSync, id: string): NodeKind {
  const row = db.prepare("SELECT kind FROM ws_node WHERE id = ?").get(id) as { kind: NodeKind } | undefined;
  if (!row) throw new DomainError("not_found", `No node ${id}.`);
  return row.kind;
}

// ---- ordering ----------------------------------------------------------------

const collator = new Intl.Collator("en", { numeric: true });
const natural = (a: string, b: string): number => collator.compare(a, b);
const isContainer = (kind: NodeKind): boolean => CONTAINER_KINDS.includes(kind);

// Case-folded and NFC-normalized, the way names are compared (names.ts). SQLite's
// lower() folds ASCII only, so matching happens here.
const fold = (s: string): string => s.normalize("NFC").toLocaleLowerCase("en");

const byTitle = (a: NodeSummary, b: NodeSummary): number => natural(a.title, b.title) || natural(a.id, b.id);
const byName = (a: { name: string; placement_id: string }, b: { name: string; placement_id: string }): number =>
  natural(a.name, b.name) || natural(a.placement_id, b.placement_id);

// ---- one container's live placements, and the walk down from it ---------------

// The live placements directly in a container, in the order the tree shows them:
// containers first, then files, each by natural sort on the local name. An
// archived container has none, and neither has a file.
function liveChildren(db: DatabaseSync, containerId: string): { placement_id: string; name: string; node: NodeSummary }[] {
  const rows = db
    .prepare(
      `SELECT p.id AS placement_id, p.name AS placement_name, ${SUMMARY_COLS}
         FROM ws_placement p JOIN ws_node n ON n.id = p.child_id JOIN ws_node c ON c.id = p.container_id
        WHERE p.container_id = ? AND p.archived_at IS NULL AND n.archived_at IS NULL AND c.archived_at IS NULL`
    )
    .all(containerId) as unknown as (SummaryRow & { placement_id: string; placement_name: string })[];
  return rows
    .map((r) => ({ placement_id: r.placement_id, name: r.placement_name, node: toSummary(r) }))
    .sort((a, b) => Number(isContainer(b.node.kind)) - Number(isContainer(a.node.kind)) || byName(a, b));
}

// The live nodes under a container, the container itself included, by any route
// of live placements. A walk over nodes (not paths), so it terminates even
// where a node is reachable twice. Placements whose container is in this set are
// the placements of the subtree.
const DOWN_CTE = `WITH RECURSIVE down(id) AS (
  SELECT id FROM ws_node WHERE id = ? AND archived_at IS NULL
  UNION
  SELECT p.child_id FROM ws_placement p JOIN down ON p.container_id = down.id JOIN ws_node ch ON ch.id = p.child_id
   WHERE p.archived_at IS NULL AND ch.archived_at IS NULL
)`;

// Every live placement in the workspace, or in the subtree of `scope`, optionally
// of files carrying `kindTag`. One row per placement, however many routes lead
// to it. `search_text` is the latest version's, which only search wants.
interface PlacementHit extends SummaryRow {
  placement_id: string;
  placement_name: string;
  container_id: string;
  search_text: string | null;
}

function livePlacements(db: DatabaseSync, scope: string | null | undefined, kindTag: string | null, withText: boolean): PlacementHit[] {
  if (scope != null) kindOf(db, scope);
  const text = withText ? "(SELECT c.search_text FROM ws_content c WHERE c.node_id = n.id ORDER BY c.version DESC LIMIT 1)" : "NULL";
  const cols = `p.id AS placement_id, p.name AS placement_name, p.container_id AS container_id, ${SUMMARY_COLS}, ${text} AS search_text`;
  const tag = kindTag !== null ? " AND n.kind_tag = ?" : "";
  const tagParam = kindTag !== null ? [kindTag] : [];
  const sql =
    scope != null
      ? `${DOWN_CTE}
         SELECT ${cols} FROM ws_placement p JOIN down ON down.id = p.container_id JOIN ws_node n ON n.id = p.child_id
          WHERE p.archived_at IS NULL AND n.archived_at IS NULL${tag}`
      : `SELECT ${cols} FROM ws_placement p JOIN ws_node c ON c.id = p.container_id JOIN ws_node n ON n.id = p.child_id
          WHERE p.archived_at IS NULL AND c.archived_at IS NULL AND n.archived_at IS NULL${tag}`;
  const params = scope != null ? [scope, ...tagParam] : tagParam;
  return db.prepare(sql).all(...params) as unknown as PlacementHit[];
}

function toPlaced(hit: PlacementHit): PlacedRow {
  return { placement_id: hit.placement_id, name: hit.placement_name, container_id: hit.container_id, node: toSummary(hit) };
}

// ---- the reads ---------------------------------------------------------------

// Every live container the node is placed in: where it will disappear from
// when it is deleted, the badge for "shared", and the parent list a course or
// track shows ("which trajectories and tracks am I part of").
export function appearsIn(db: DatabaseSync, nodeId: string): AppearsInRow[] {
  kindOf(db, nodeId);
  const rows = db
    .prepare(
      `SELECT p.id AS placement_id, p.name AS name, c.id AS container_id, c.kind AS container_kind, c.title AS container_title
         FROM ws_placement p JOIN ws_node c ON c.id = p.container_id JOIN ws_node n ON n.id = p.child_id
        WHERE p.child_id = ? AND p.archived_at IS NULL AND c.archived_at IS NULL AND n.archived_at IS NULL`
    )
    .all(nodeId) as unknown as { placement_id: string; name: string; container_id: string; container_kind: NodeKind; container_title: string }[];
  return rows
    .map((r) => ({ placement_id: r.placement_id, name: r.name, container: { id: r.container_id, kind: r.container_kind, title: r.container_title } }))
    .sort(
      (a, b) =>
        natural(a.container.title, b.container.title) || natural(a.name, b.name) || natural(a.placement_id, b.placement_id)
    );
}

// One node: its summary, where it appears, and for a file the header of its
// latest version (never the body; that is readContent).
export function getNodeDetail(
  db: DatabaseSync,
  id: string
): {
  node: NodeSummary;
  appears_in: AppearsInRow[];
  content: { format: string; version: number; saved_at: string; author: Author; asset_id: string | null } | null;
} {
  const [node] = summarize(db, [id]);
  if (!node) throw new DomainError("not_found", `No node ${id}.`);
  const content = db
    .prepare("SELECT format, version, saved_at, author, asset_id FROM ws_content WHERE node_id = ? ORDER BY version DESC LIMIT 1")
    .get(id) as unknown as { format: string; version: number; saved_at: string; author: Author; asset_id: string | null } | undefined;
  return { node, appears_in: appearsIn(db, id), content: content ?? null };
}

// The tree's basic read: one row per live placement in the container, containers
// first, then files, by natural sort on the local name.
export function children(db: DatabaseSync, containerId: string): ChildRow[] {
  kindOf(db, containerId);
  return liveChildren(db, containerId).map((row) => ({
    placement_id: row.placement_id,
    name: row.name,
    appears_elsewhere: row.node.placement_count > 1,
    node: row.node,
  }));
}

// Files and folders with no live placement, reached from the menu bar and not the
// sidebar. A trajectory, track or course with no placement is top level, which
// is normal and is `roots`' business. A node whose only placements are in an
// archived container has no live placement either, so it is here: reachable,
// rather than stranded where only a restore could find it.
export function unplaced(db: DatabaseSync): NodeSummary[] {
  return summariesWhere(
    db,
    `n.archived_at IS NULL AND n.kind IN ('file', 'folder') AND NOT EXISTS (
       SELECT 1 FROM ws_placement p JOIN ws_node c ON c.id = p.container_id WHERE p.child_id = n.id AND p.archived_at IS NULL AND c.archived_at IS NULL)`
  ).sort(byTitle);
}

// Every live trajectory, track and course, so the picker can open any of them,
// placed or not. `top_level` says which have no live placement.
export function roots(db: DatabaseSync): { trajectories: NodeSummary[]; tracks: NodeSummary[]; courses: NodeSummary[] } {
  const live = summariesWhere(db, "n.archived_at IS NULL AND n.kind IN ('trajectory', 'track', 'course')").sort(byTitle);
  return {
    trajectories: live.filter((n) => n.kind === "trajectory"),
    tracks: live.filter((n) => n.kind === "track"),
    courses: live.filter((n) => n.kind === "course"),
  };
}

// The container's live descendants, depth-first in children() order, one row per
// placement path: a node placed twice inside the subtree appears twice, and what
// is under it once per route. The query is the same whether or not the caller is
// rooted there. Cycles can't exist (place() and move() reject them), and a walk
// refuses to re-enter a node it is already inside, so it ends even on a database
// somebody edited by hand.
export function subtree(db: DatabaseSync, containerId: string): SubtreeRow[] {
  kindOf(db, containerId);
  const rows: SubtreeRow[] = [];
  const walk = (id: string, parentPlacement: string | null, depth: number, inside: ReadonlySet<string>): void => {
    for (const child of liveChildren(db, id)) {
      if (inside.has(child.node.id)) continue;
      rows.push({ placement_id: child.placement_id, parent_placement_id: parentPlacement, depth, name: child.name, node: child.node });
      if (isContainer(child.node.kind)) walk(child.node.id, child.placement_id, depth + 1, new Set(inside).add(child.node.id));
    }
  };
  walk(containerId, null, 0, new Set([containerId]));
  return rows;
}

// For the sidebar's filtered partition: one row per live placement of a file
// carrying `tag`, limited to the scope's subtree when there is one and across the
// whole workspace when there is not. An unplaced file has no placement, so it has
// no row.
export function byKindTag(db: DatabaseSync, tag: string, scope?: string | null): PlacedRow[] {
  const clean = normalizeKindTag(tag);
  if (clean === null) throw new DomainError("invalid_input", "A kind tag is required.");
  return livePlacements(db, scope, clean, false).map(toPlaced).sort(byName);
}

// Case-insensitive match on placement names, node titles and the latest version's
// stored search_text: one row per live placement, under that placement's name,
// limited to the scope's subtree when there is one. A match on a title or on text
// is a match on the node, so each of its placements is a row; a match on a name
// is a match on that placement alone. Unplaced nodes are not returned (the brief);
// they are reached through unplaced(). Plain filtering in JS over rows from SQL:
// a personal workspace is small, and full-text search is a later step.
export function search(db: DatabaseSync, input: { q?: string; scope?: string | null; kind_tag?: string | null }): PlacedRow[] {
  const tag = normalizeKindTag(input.kind_tag); // absent (or null) means no filter; anything else must be a valid tag
  if (input.q != null && typeof input.q !== "string") throw new DomainError("invalid_input", "q is text.");
  const q = fold((input.q ?? "").trim());
  const matches = (hit: PlacementHit): boolean =>
    q === "" || fold(hit.placement_name).includes(q) || fold(hit.title).includes(q) || (hit.search_text !== null && fold(hit.search_text).includes(q));
  // The text of every placed file is only worth pulling out of SQLite when there is a
  // query to match it against: with none, every placement is a hit and its text unused.
  return livePlacements(db, input.scope, tag, q !== "").filter(matches).map(toPlaced).sort(byName);
}

// What is archived, most recently archived first: the Archive view. Nodes only;
// archived_placements() says where each one used to be.
export function archived(db: DatabaseSync): NodeSummary[] {
  return summariesWhere(db, "n.archived_at IS NOT NULL").sort(
    (a, b) => (a.archived_at! < b.archived_at! ? 1 : a.archived_at! > b.archived_at! ? -1 : 0) || byTitle(a, b)
  );
}

// What a track may read besides its own reach (spec §6.9): the files in the
// subtrees of its parent trajectories, leaving out the subtrees of the tracks and
// courses placed there. That is the trajectory's own documents (its syllabus,
// scope notes and research, in any folder of its own), not the other tracks'.
// For anything but a track, []. One row per placement, so a folder placed in two
// of the track's trajectories does not double its files.
export function context(db: DatabaseSync, containerId: string): PlacedRow[] {
  if (kindOf(db, containerId) !== "track") return [];
  const rows: PlacedRow[] = [];
  const seen = new Set<string>();
  const walk = (id: string, inside: ReadonlySet<string>): void => {
    for (const child of liveChildren(db, id)) {
      if (child.node.kind === "file") {
        if (seen.has(child.placement_id)) continue;
        seen.add(child.placement_id);
        rows.push({ placement_id: child.placement_id, name: child.name, container_id: id, node: child.node });
      } else if (child.node.kind === "folder" && !inside.has(child.node.id)) {
        walk(child.node.id, new Set(inside).add(child.node.id));
      }
    }
  };
  // Only a trajectory can hold a track (MAY_HOLD), so every live container this
  // track appears in is one of its parent trajectories.
  for (const parent of appearsIn(db, containerId)) walk(parent.container.id, new Set([parent.container.id]));
  return rows;
}
