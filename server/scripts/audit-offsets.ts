// Read-only audit: which assets have extracted_text that is non-BMP (surrogate
// pairs) or not NFC, and how many questions are anchored in each.
// Usage: npx tsx scripts/audit-offsets.ts <path-to-db>
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { isNfc } from "document-engine/core";

export function auditText(text: string): { nonBmp: number; nonNfc: boolean } {
  let nonBmp = 0;
  for (const ch of text) if (ch.codePointAt(0)! > 0xffff) nonBmp++;
  return { nonBmp, nonNfc: !isNfc(text) };
}

export interface AuditRow {
  id: string;
  title: string;
  nonBmp: number;
  nonNfc: boolean;
  anchoredQuestions: number;
}

export function auditDb(db: DatabaseSync): AuditRow[] {
  const assets = db
    .prepare("SELECT id, title, extracted_text FROM asset WHERE extracted_text IS NOT NULL")
    .all() as unknown as { id: string; title: string; extracted_text: string }[];
  const count = db.prepare(
    `SELECT COUNT(*) AS n FROM question WHERE document_id = ?
       AND (document_anchor_start IS NOT NULL OR document_marker_offset IS NOT NULL)`
  );
  const rows: AuditRow[] = [];
  for (const a of assets) {
    const r = auditText(a.extracted_text);
    if (r.nonBmp === 0 && !r.nonNfc) continue;
    const n = (count.get(a.id) as { n: number }).n;
    rows.push({ id: a.id, title: a.title, ...r, anchoredQuestions: n });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/audit-offsets.ts <db-path>");
    process.exit(2);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = auditDb(db);
  console.log("id\tnonBmp\tnonNfc\tanchored_questions\ttitle");
  for (const r of rows) console.log(`${r.id}\t${r.nonBmp}\t${r.nonNfc}\t${r.anchoredQuestions}\t${r.title}`);
  console.log(`${rows.length} asset(s) flagged`);
  db.close();
}
