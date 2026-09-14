import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.js";
import { extractText } from "../lib/extract/index.js";

export type AssetType = "url" | "text" | "file";

// Base64 length, not decoded byte length — checked before decoding so an
// oversized upload never gets fully buffered into memory just to measure it.
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil((25 * 1024 * 1024 * 4) / 3);

export interface AssetRow {
  id: string;
  title: string;
  type: AssetType;
  content: string | null;
  filename: string | null;
  mime: string | null;
  storage_path: string | null;
  extracted_text: string | null;
  created_by: "claude" | "human";
  created_at: string;
}

export interface CreateAssetInput {
  title: string;
  type: AssetType;
  content?: string | null;
  filename?: string | null;
  mime?: string | null;
}

// Strips path separators and ".." segments so a hostile filename can't escape
// the uploads directory.
function sanitizeFilename(filename: string): string {
  const stripped = filename.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  return stripped.length > 0 ? stripped : "file";
}

export async function createAsset(
  db: DatabaseSync,
  uploadsDir: string,
  input: CreateAssetInput,
  createdBy: "claude" | "human"
): Promise<AssetRow> {
  const id = uuidv4();
  let storagePath: string | null = null;
  let filePath: string | undefined;

  if (input.type === "file") {
    if (!input.content) {
      throw new DomainError("invalid_asset", "file assets require base64 content");
    }
    if (input.content.length > MAX_UPLOAD_BASE64_LENGTH) {
      throw new DomainError("upload_too_large", "file assets are capped at 25MB");
    }
    const safeName = sanitizeFilename(input.filename ?? "upload");
    const diskName = `${id}-${safeName}`;
    mkdirSync(uploadsDir, { recursive: true });
    filePath = join(uploadsDir, diskName);
    writeFileSync(filePath, Buffer.from(input.content, "base64"));
    storagePath = diskName;
  }

  let extractedText: string | null;
  try {
    extractedText = await extractText({
      type: input.type,
      content: input.content ?? undefined,
      mime: input.mime ?? undefined,
      filePath,
    });
  } catch (err) {
    // The file was written before extraction (extraction reads it back from
    // disk). No asset row will exist for it, so don't leave it orphaned.
    if (filePath && existsSync(filePath)) unlinkSync(filePath);
    throw err;
  }

  db.prepare(
    `INSERT INTO asset (id, title, type, content, filename, mime, storage_path, extracted_text, created_by)
     VALUES (@id, @title, @type, @content, @filename, @mime, @storage_path, @extracted_text, @created_by)`
  ).run({
    id,
    title: input.title,
    type: input.type,
    content: input.type === "file" ? null : input.content ?? null,
    filename: input.filename ?? null,
    mime: input.mime ?? null,
    storage_path: storagePath,
    extracted_text: extractedText,
    created_by: createdBy,
  });

  return getAsset(db, id);
}

export function getAsset(db: DatabaseSync, id: string): AssetRow {
  const row = db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
  if (!row) throw new DomainError("not_found", `Asset "${id}" does not exist.`);
  return row;
}

export interface AssetSummary {
  id: string;
  title: string;
  type: AssetType;
  created_at: string;
  created_by: "claude" | "human";
}

export function listAssets(
  db: DatabaseSync,
  opts?: { unlinkedOnly?: boolean; limit?: number; offset?: number }
): AssetSummary[] {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  if (opts?.limit === undefined) {
    return db
      .prepare(`SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC`)
      .all() as unknown as AssetSummary[];
  }
  return db
    .prepare(
      `SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(opts.limit, opts.offset ?? 0) as unknown as AssetSummary[];
}

export function countAssets(db: DatabaseSync, opts?: { unlinkedOnly?: boolean }): number {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM asset ${where}`).get() as { n: number };
  return row.n;
}

export interface AssetSearchResult {
  id: string;
  title: string;
  type: AssetType;
  snippet: string;
}

export function searchAssets(
  db: DatabaseSync,
  query: string,
  opts?: { type?: AssetType; limit?: number; offset?: number }
): { total: number; assets: AssetSearchResult[] } {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 32);
  if (tokens.length === 0) return { total: 0, assets: [] };
  const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");

  const clauses = ["asset_fts MATCH ?"];
  const args: unknown[] = [ftsQuery];
  if (opts?.type) {
    clauses.push("a.type = ?");
    args.push(opts.type);
  }
  const where = clauses.join(" AND ");

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM asset_fts f JOIN asset a ON a.rowid = f.rowid WHERE ${where}`)
      .get(...(args as any[])) as { n: number }
  ).n;

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const assets = db
    .prepare(
      `SELECT a.id, a.title, a.type,
              snippet(asset_fts, 1, '[', ']', '...', 10) AS snippet
       FROM asset_fts f
       JOIN asset a ON a.rowid = f.rowid
       WHERE ${where}
       ORDER BY rank
       LIMIT ? OFFSET ?`
    )
    .all(...([...args, limit, offset] as any[])) as unknown as AssetSearchResult[];

  return { total, assets };
}

export function deleteAsset(db: DatabaseSync, uploadsDir: string, id: string): { id: string } {
  const asset = getAsset(db, id);

  // question.document_id is ON DELETE SET NULL, but the anchor/marker
  // offsets that only make sense relative to that document would survive
  // the delete — and validateQuestionInput rejects a marker without a
  // document_id, so every later edit of such a question would bounce until
  // someone manually cleared the offsets. Clear the whole linkage as one
  // unit, in the same transaction as the delete.
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE question
       SET document_id = NULL, document_anchor_label = NULL, document_anchor_start = NULL,
           document_anchor_end = NULL, document_marker_offset = NULL, updated_at = datetime('now')
       WHERE document_id = ?`
    ).run(id);
    db.prepare("DELETE FROM asset WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Disk cleanup after the row is gone: a failed unlink leaves a stray file,
  // which is recoverable; a stray DB row pointing at a deleted file is not.
  if (asset.type === "file" && asset.storage_path) {
    const filePath = join(uploadsDir, asset.storage_path);
    if (existsSync(filePath)) unlinkSync(filePath);
  }
  return { id };
}
