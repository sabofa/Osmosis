import type { DatabaseSync } from "node:sqlite";
import { inSavepoint } from "./savepoint.js";

// Every upload gets one file node in the workspace (spec §13), so a PDF Ben
// uploaded is something he can place in a course, tag as a source and find in
// search without the asset table knowing about the graph. The wrapper's id is
// `asset:<asset id>`: stable, and what lets this run again and again without
// duplicating anything. It starts unplaced; Ben files it where he wants.
//
// Deleting the asset sets the wrapper's asset_id to NULL (ON DELETE SET NULL);
// the next sync trashes it, so it shows up in the trash instead of dangling.
// A wrapper that was trashed and then purged is made again on the next sync:
// the way to be rid of an upload for good is to delete the asset.

const NAME_LIMIT = 200;

// An upload's title is free text (a URL, a filename, a page title), but a
// node's title is the default placement name, which can't hold "/" or control
// characters and has a length limit. The title stays as the asset has it
// wherever that is already a valid name.
function wrapperTitle(raw: string | null): string {
  const cleaned = (raw ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\//g, "-").trim();
  const capped = [...cleaned].slice(0, NAME_LIMIT).join("").trim();
  return capped || "Untitled upload";
}

export function syncAssetFiles(db: DatabaseSync): void {
  inSavepoint(db, "ws_sync_asset_files", () => {
    const missing = db
      .prepare("SELECT a.id AS id, a.title AS title FROM asset a WHERE NOT EXISTS (SELECT 1 FROM ws_node n WHERE n.id = 'asset:' || a.id)")
      .all() as { id: string; title: string }[];
    const insertNode = db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES (?, 'file', ?, 'source')");
    const insertFile = db.prepare("INSERT INTO ws_file (node_id, type, body, asset_id, revision, saved_by) VALUES (?, 'asset', NULL, ?, 1, 'ben')");
    const insertRevision = db.prepare(
      `INSERT INTO ws_file_revision (node_id, revision, type, body, asset_id, saved_at, saved_by)
       SELECT node_id, revision, type, body, asset_id, saved_at, saved_by FROM ws_file WHERE node_id = ?`
    );
    for (const asset of missing) {
      const nodeId = `asset:${asset.id}`;
      insertNode.run(nodeId, wrapperTitle(asset.title));
      insertFile.run(nodeId, asset.id);
      insertRevision.run(nodeId);
    }
    db.prepare(
      `UPDATE ws_node SET trashed_at = datetime('now'), updated_at = datetime('now')
        WHERE trashed_at IS NULL AND id IN (SELECT node_id FROM ws_file WHERE type = 'asset' AND asset_id IS NULL)`
    ).run();
  });
}
