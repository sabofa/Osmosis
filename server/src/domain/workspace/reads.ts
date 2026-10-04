import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import type { NodeKind } from "./types.js";

// ----------------------------------------------------------------------------
// Graph reads (Learn spec/osmosis/workspace/02-data-layer.md §6).
//
// This file holds only what the writes in graph.ts need to answer with: the
// NodeSummary shape, `summarize`, and the one read deletePreview is built on.
// The rest of the spec's queries (children, unplaced, roots, subtree, search,
// ...) are the reads task's, and they build on these.
//
// "Live" is used the same way everywhere: a node is live when `archived_at` is
// null, and a placement is live when it, its container and its child all are.
// A placement inside an archived container is hidden, not marked.
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

// One row per id, in the order given, for ids that exist. The counts are
// correlated subqueries so each summary is one statement.
export function summarize(db: DatabaseSync, nodeIds: readonly string[]): NodeSummary[] {
  const select = db.prepare(
    `SELECT n.id AS id, n.kind AS kind, n.title AS title, n.kind_tag AS kind_tag, n.archived_at AS archived_at,
            (SELECT c.format FROM ws_content c WHERE c.node_id = n.id ORDER BY c.version DESC LIMIT 1) AS format,
            (SELECT COUNT(*) FROM ws_placement p JOIN ws_node co ON co.id = p.container_id
              WHERE p.child_id = n.id AND p.archived_at IS NULL AND co.archived_at IS NULL AND n.archived_at IS NULL) AS placement_count,
            EXISTS (SELECT 1 FROM ws_placement p JOIN ws_node ch ON ch.id = p.child_id
                     WHERE p.container_id = n.id AND p.archived_at IS NULL AND ch.archived_at IS NULL AND n.archived_at IS NULL) AS has_children
       FROM ws_node n WHERE n.id = ?`
  );
  const summaries: NodeSummary[] = [];
  for (const id of nodeIds) {
    const row = select.get(id) as unknown as SummaryRow | undefined;
    if (!row) continue;
    const placementCount = Number(row.placement_count);
    summaries.push({
      id: row.id,
      kind: row.kind,
      title: row.title,
      kind_tag: row.kind_tag,
      format: row.format,
      placement_count: placementCount,
      has_children: Number(row.has_children) === 1,
      archived_at: row.archived_at,
      top_level: row.archived_at === null && TOP_LEVEL_KINDS.includes(row.kind) && placementCount === 0,
    });
  }
  return summaries;
}

const collator = new Intl.Collator("en", { numeric: true });

// Every live container the node is placed in: where it will disappear from
// when it is deleted, the badge for "shared", and the parent list a course or
// track shows.
export function appearsIn(db: DatabaseSync, nodeId: string): AppearsInRow[] {
  const node = db.prepare("SELECT id FROM ws_node WHERE id = ?").get(nodeId);
  if (!node) throw new DomainError("not_found", `No node ${nodeId}.`);
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
        collator.compare(a.container.title, b.container.title) || collator.compare(a.name, b.name) || collator.compare(a.placement_id, b.placement_id)
    );
}
