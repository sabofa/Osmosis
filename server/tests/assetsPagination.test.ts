import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { createAsset, listAssets, countAssets } from "../src/domain/assets.js";

async function seedAssets(db: ReturnType<typeof openTestDb>, n: number) {
  for (let i = 0; i < n; i++) {
    await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Asset ${i}`, type: "text", content: `content ${i}` }, "claude");
  }
}

describe("listAssets pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed (unchanged default behavior)", async () => {
    const db = openTestDb();
    await seedAssets(db, 5);
    const rows = listAssets(db);
    expect(rows).toHaveLength(5);
  });

  it("returns a bounded page when limit/offset are passed", async () => {
    const db = openTestDb();
    await seedAssets(db, 5);
    const page = listAssets(db, { limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
    const nextPage = listAssets(db, { limit: 2, offset: 2 });
    expect(nextPage).toHaveLength(2);
    expect(nextPage[0].id).not.toBe(page[0].id);
  });
});

describe("countAssets", () => {
  it("counts all assets matching the same WHERE clause listAssets would use", async () => {
    const db = openTestDb();
    await seedAssets(db, 3);
    expect(countAssets(db)).toBe(3);
    expect(countAssets(db, { unlinkedOnly: true })).toBe(3);
  });
});
