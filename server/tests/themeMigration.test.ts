import { describe, it, expect, vi } from "vitest";
import { resolve, toLegacyTokens } from "theme-core";
import { openTestDb } from "./helpers.js";
import { migrate } from "../src/db/migrate.js";
import { convertLegacyThemes } from "../src/db/themeMigration.js";

const KEYS = ["--accent", "--accent-wash", "--bg", "--surface", "--ink", "--muted", "--line", "--line-strong"];
const mode = (v: string) => Object.fromEntries(KEYS.map((k, i) => [k, `#${v}${v}${i}${i}${v}${v}`.slice(0, 7)]));

describe("legacy theme conversion", () => {
  it("converts legacy rows without touching updated_at, and is idempotent", () => {
    const db = openTestDb();
    const tokens = { light: mode("1"), dark: mode("a") };
    db.prepare(
      "INSERT INTO theme (id, name, tokens, custom_css, updated_at, deleted_at, manifest) VALUES ('old','Old',?,'.x{}','2020-01-01 00:00:00',NULL,NULL)"
    ).run(JSON.stringify(tokens));
    migrate(db);
    const row = db.prepare("SELECT * FROM theme WHERE id='old'").get() as any;
    expect(row.manifest).not.toBeNull();
    expect(row.schema_version).toBe(1);
    expect(row.updated_at).toBe("2020-01-01 00:00:00");
    const back = toLegacyTokens(resolve(JSON.parse(row.manifest)));
    for (const m of ["light", "dark"] as const) {
      for (const k of KEYS) expect(back[m][k]).toBe((tokens[m] as any)[k]);
    }
    expect(convertLegacyThemes(db).converted).toBe(0);
  });

  it("reports rows that cannot be converted and leaves them NULL", () => {
    const db = openTestDb();
    db.prepare(
      "INSERT INTO theme (id, name, tokens, custom_css, updated_at, manifest) VALUES ('bad','Bad','not json','','2020-01-01 00:00:00',NULL)"
    ).run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = convertLegacyThemes(db);
    warn.mockRestore();
    expect(r).toEqual({ converted: 0, failed: ["bad"] });
    expect((db.prepare("SELECT manifest FROM theme WHERE id='bad'").get() as any).manifest).toBeNull();
  });
});
