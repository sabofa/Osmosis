import type { DatabaseSync } from "node:sqlite";
import { checkContent, searchSourceFor } from "./formats.js";
import { deleteNode } from "./graph.js";
import { inSavepoint } from "./savepoint.js";

// ----------------------------------------------------------------------------
// Uploads (Learn spec/osmosis/workspace/02-data-layer.md §8).
//
// Every upload gets one file node in the workspace, so a PDF Ben uploaded is
// something he can place in a course, tag as a source and find in search
// without the asset table knowing about the graph. The wrapper's id is
// `asset:<asset id>`: stable, and what lets the sync run again and again
// without duplicating anything. It has format `upload`, kind tag `source`, and
// starts unplaced; Ben files it where he wants.
//
// Deleting the asset sets the wrapper's asset_id to NULL (ON DELETE SET NULL);
// the next sync archives it, so it shows up in the archive instead of dangling.
// A NULL whose asset still exists is not a deletion (see the re-link below).
// A wrapper that was purged while its asset still existed would be made again on
// the next sync, which is why purge refuses that (asset_in_use): the way to be
// rid of an upload for good is to delete the asset, after which the wrapper is
// archived and can be purged, and nothing makes it again.
//
// assets.ts calls this after every asset it creates or deletes, which are the
// only doors an asset comes in or goes out by. The server also runs it once at
// startup, for the uploads that predate the workspace.
// ----------------------------------------------------------------------------

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

export function syncUploads(db: DatabaseSync): void {
  inSavepoint(db, "ws_sync_uploads", () => {
    const missing = db
      .prepare("SELECT a.id AS id, a.title AS title FROM asset a WHERE NOT EXISTS (SELECT 1 FROM ws_node n WHERE n.id = 'asset:' || a.id)")
      .all() as { id: string; title: string }[];
    const insertNode = db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES (?, 'file', ?, 'source')");
    const insertContent = db.prepare(
      "INSERT INTO ws_content (node_id, version, format, body, asset_id, search_text, author) VALUES (?, 1, 'upload', NULL, ?, ?, 'ben')"
    );
    for (const asset of missing) {
      const nodeId = `asset:${asset.id}`;
      // The same search text createNode and saveContent would give this file.
      const { search_text } = checkContent("upload", null, searchSourceFor(db, "upload", null, asset.id));
      insertNode.run(nodeId, wrapperTitle(asset.title));
      insertContent.run(nodeId, asset.id, search_text);
    }

    // A wrapper's asset_id is NULL only because ON DELETE SET NULL fired, and
    // that fires for any DELETE on the asset row, including a migration that
    // rebuilds the asset table (DROP TABLE) with every upload still in it.
    // Re-link a canonical wrapper whose upload exists before the archiving below
    // reads a NULL as "the upload was deleted". Only `asset:<id>` is the
    // canonical wrapper; a file that merely points at an asset is not relinked.
    db.prepare(
      `UPDATE ws_content SET asset_id = substr(node_id, 7)
        WHERE format = 'upload' AND asset_id IS NULL AND substr(node_id, 1, 6) = 'asset:'
          AND EXISTS (SELECT 1 FROM asset a WHERE a.id = substr(ws_content.node_id, 7))`
    ).run();

    // What is left with no asset is an upload that was deleted. It is archived
    // the way any delete archives (the node and every placement marked, one
    // archive batch, the containers it left stamped) so a restore sees it like
    // any other archived file. Every version of an upload carries the same asset,
    // so any version with none means the asset is gone.
    const dangling = db
      .prepare(
        `SELECT DISTINCT n.id AS id FROM ws_node n JOIN ws_content c ON c.node_id = n.id
          WHERE n.archived_at IS NULL AND c.format = 'upload' AND c.asset_id IS NULL`
      )
      .all() as { id: string }[];
    for (const { id } of dangling) deleteNode(db, id);
  });
}
