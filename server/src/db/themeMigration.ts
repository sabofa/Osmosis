import type { DatabaseSync } from "node:sqlite";
import { migrate as migrateTheme } from "theme-core";

// Converts legacy-shaped theme rows (manifest IS NULL) into manifests. Does
// not touch updated_at: a conversion is not an edit and must not win a sync.
// Rows that cannot be converted stay NULL and are reported in `failed`.
export function convertLegacyThemes(db: DatabaseSync): { converted: number; failed: string[] } {
  const rows = db
    .prepare("SELECT id, name, tokens, custom_css FROM theme WHERE manifest IS NULL")
    .all() as { id: string; name: string; tokens: string; custom_css: string | null }[];
  const update = db.prepare("UPDATE theme SET manifest = ?, schema_version = 1 WHERE id = ?");
  let converted = 0;
  const failed: string[] = [];
  for (const r of rows) {
    try {
      const m = migrateTheme({ id: r.id, name: r.name, tokens: JSON.parse(r.tokens), custom_css: r.custom_css ?? "" });
      update.run(JSON.stringify(m), r.id);
      converted++;
    } catch (err) {
      failed.push(r.id);
      console.warn(`theme "${r.id}" could not be converted to a manifest: ${(err as Error).message}`);
    }
  }
  return { converted, failed };
}
