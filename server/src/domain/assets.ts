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
  input: CreateAssetInput
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

  const extractedText = await extractText({
    type: input.type,
    content: input.content ?? undefined,
    mime: input.mime ?? undefined,
    filePath,
  });

  db.prepare(
    `INSERT INTO asset (id, title, type, content, filename, mime, storage_path, extracted_text)
     VALUES (@id, @title, @type, @content, @filename, @mime, @storage_path, @extracted_text)`
  ).run({
    id,
    title: input.title,
    type: input.type,
    content: input.type === "file" ? null : input.content ?? null,
    filename: input.filename ?? null,
    mime: input.mime ?? null,
    storage_path: storagePath,
    extracted_text: extractedText,
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

export function listAssets(db: DatabaseSync, opts?: { unlinkedOnly?: boolean }): AssetSummary[] {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  return db
    .prepare(`SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC`)
    .all() as unknown as AssetSummary[];
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
  opts?: { type?: AssetType }
): AssetSearchResult[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 32);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");

  const clauses = ["asset_fts MATCH ?"];
  const args: unknown[] = [ftsQuery];
  if (opts?.type) {
    clauses.push("a.type = ?");
    args.push(opts.type);
  }

  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.type,
              snippet(asset_fts, 1, '[', ']', '...', 10) AS snippet
       FROM asset_fts f
       JOIN asset a ON a.rowid = f.rowid
       WHERE ${clauses.join(" AND ")}
       ORDER BY rank`
    )
    .all(...(args as any[])) as unknown as AssetSearchResult[];

  return rows;
}

export function deleteAsset(db: DatabaseSync, uploadsDir: string, id: string): { id: string } {
  const asset = getAsset(db, id);
  if (asset.type === "file" && asset.storage_path) {
    const filePath = join(uploadsDir, asset.storage_path);
    if (existsSync(filePath)) unlinkSync(filePath);
  }
  db.prepare("DELETE FROM asset WHERE id = ?").run(id);
  return { id };
}
