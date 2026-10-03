import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../src/db/migrate.js";
import { isValidNodeKey } from "../src/domain/nodeKeys.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// A database as it stood before 022: every earlier migration applied and
// recorded, so migrate() picks up exactly 022 afterwards.
function openPre022Db(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < "022")
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
  }
  return db;
}

let n = 0;
function seed(db: DatabaseSync, nodeKey: string | null, tags: string[] = [], withKeyRow = true): string {
  n += 1;
  const id = `q${n}`;
  db.prepare(
    "INSERT INTO question (id, lineage_id, version, type, prompt, model_answer, node_key) VALUES (?, ?, 1, 'written', ?, 'a', ?)"
  ).run(id, `l${n}`, `prompt ${n}`, nodeKey);
  for (const t of tags) {
    db.prepare("INSERT OR IGNORE INTO tag (slug, label) VALUES (?, ?)").run(t, t);
    db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)").run(id, t);
  }
  if (nodeKey && withKeyRow) {
    db.prepare("INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, 1, 0)").run(id, nodeKey);
  }
  return id;
}

function keysOf(db: DatabaseSync, id: string): { column: string | null; rows: { node_key: string; is_primary: number }[] } {
  const column = (db.prepare("SELECT node_key FROM question WHERE id = ?").get(id) as { node_key: string | null }).node_key;
  const rows = db
    .prepare("SELECT node_key, is_primary FROM question_node_key WHERE question_id = ? ORDER BY ordinal")
    .all(id) as { node_key: string; is_primary: number }[];
  return { column, rows };
}

const CH3_4 = "node:chemistry_ch3_4_bonding_and_equations:ionic_vs_molecular_compounds_formula_writing_charge_balancing_balancing_chemical_equations";

describe("022 — node keys rendered into tag shape", () => {
  it("renders the legacy values on record by the evidence on their items, column and key rows alike", () => {
    const db = openPre022Db();
    const sec24 = seed(db, "2.4", ["chem", "chem:atomic_weight"]);
    const sec26 = seed(db, "2.6", ["chem", "chem:chemical_formulas"]);
    const tagged = seed(db, "writing-balancing-formulas", [`${CH3_4}:writing_balancing_formulas`]);
    const untagged = seed(db, "writing-balancing-formulas", ["tutor:live"]);
    const balancing = seed(db, "balancing-chemical-equations");
    const ionic = seed(db, "ionic-vs-molecular-compounds");

    migrate(db);

    expect(keysOf(db, sec24)).toEqual({
      column: "node:chemistry:atoms_molecules_ions:atomic_weight",
      rows: [{ node_key: "node:chemistry:atoms_molecules_ions:atomic_weight", is_primary: 1 }],
    });
    expect(keysOf(db, sec26).column).toBe("node:chemistry:atoms_molecules_ions:chemical_formulas");
    // The same legacy key renders the same way whether or not the item carried the tag.
    expect(keysOf(db, tagged).column).toBe(`${CH3_4}:writing_balancing_formulas`);
    expect(keysOf(db, untagged).column).toBe(`${CH3_4}:writing_balancing_formulas`);
    expect(keysOf(db, balancing).column).toBe(`${CH3_4}:balancing_chemical_equations`);
    expect(keysOf(db, ionic).column).toBe(`${CH3_4}:ionic_vs_molecular_compounds`);
    for (const id of [sec24, sec26, tagged, untagged, balancing, ionic]) {
      expect(isValidNodeKey(keysOf(db, id).column!)).toBe(true);
    }
  });

  it("renders an unknown legacy value under node:legacy:, leaves tag-shaped keys and keyless rows alone", () => {
    const db = openPre022Db();
    const probe = seed(db, "probe-throwaway", ["math"]);
    const already = seed(db, "node:ebbing11e:3.2:mole_conversions");
    const none = seed(db, null);

    migrate(db);

    expect(keysOf(db, probe).column).toBe("node:legacy:probe_throwaway");
    expect(keysOf(db, already).column).toBe("node:ebbing11e:3.2:mole_conversions");
    expect(keysOf(db, none)).toEqual({ column: null, rows: [] });
  });

  it("gives a row with a node_key but no key rows its one primary row", () => {
    const db = openPre022Db();
    const id = seed(db, "node:ebbing11e:3.1:formula_weight", [], false);

    migrate(db);

    expect(keysOf(db, id).rows).toEqual([{ node_key: "node:ebbing11e:3.1:formula_weight", is_primary: 1 }]);
  });

  it("keeps one row, primary, when a question carries both the legacy spelling and its rendering", () => {
    const db = openPre022Db();
    const id = seed(db, "2.4");
    db.prepare("INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, 0, 1)").run(
      id,
      "node:chemistry:atoms_molecules_ions:atomic_weight"
    );

    migrate(db);

    expect(keysOf(db, id).rows).toEqual([{ node_key: "node:chemistry:atoms_molecules_ions:atomic_weight", is_primary: 1 }]);
  });

  it("stamps updated_at on every question whose keys moved, so an incremental pull re-sends it", () => {
    const db = openPre022Db();
    const moved = seed(db, "2.4");
    const still = seed(db, "node:ebbing11e:3.2:mole_conversions");

    migrate(db);

    const stamp = (id: string) => (db.prepare("SELECT updated_at FROM question WHERE id = ?").get(id) as { updated_at: string | null }).updated_at;
    expect(stamp(moved)).not.toBeNull();
    expect(stamp(still)).toBeNull();
  });

  it("registers every node key in use as a node: tag, labelled by its leaf", () => {
    const db = openPre022Db();
    seed(db, "2.4");
    seed(db, "node:chemistry:stoichiometry:grams_to_moles");

    migrate(db);

    const label = (slug: string) => (db.prepare("SELECT label FROM tag WHERE slug = ?").get(slug) as { label: string } | undefined)?.label;
    expect(label("node:chemistry:atoms_molecules_ions:atomic_weight")).toBe("atomic weight");
    expect(label("node:chemistry:stoichiometry:grams_to_moles")).toBe("grams to moles");
  });
});

describe("022 — retention schedule, template due_mode, config", () => {
  it("keeps 013's table under a new name and creates the two-key row", () => {
    const db = openPre022Db();
    db.prepare(
      "INSERT INTO retention_schedule (id, identity_key, retention_target, first_gap_days, due_at, target_source) VALUES ('r1', 'calc:x', 't', 1, '2026-01-01 00:00:00', 'engine')"
    ).run();

    migrate(db);

    expect((db.prepare("SELECT COUNT(*) AS n FROM retention_schedule_v1").get() as { n: number }).n).toBe(1);
    const cols = (db.prepare("PRAGMA table_info(retention_schedule)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["node_key", "lineage_id", "retention_target", "role", "created_at"]);
  });

  it("gives every existing template due_mode 'weight' and seeds the two retention config keys", () => {
    const db = openPre022Db();
    db.prepare("INSERT INTO template (id, name, tag_query, question_count) VALUES ('t1', 'hw', '{}', 5)").run();

    migrate(db);

    expect((db.prepare("SELECT due_mode FROM template WHERE id = 't1'").get() as { due_mode: string }).due_mode).toBe("weight");
    const cfg = Object.fromEntries(
      (db.prepare("SELECT key, value FROM config WHERE key LIKE 'retention_%'").all() as { key: string; value: string }[]).map((r) => [
        r.key,
        JSON.parse(r.value),
      ])
    );
    expect(cfg).toEqual({ retention_draw_k: 3, retention_clamp_floor_hours: 24 });
  });
});
