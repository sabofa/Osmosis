import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { createAsset, listAssets, countAssets, searchAssets } from "../src/domain/assets.js";

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

describe("searchAssets pagination + envelope", () => {
  it("returns { total, assets } instead of a bare array, honoring limit/offset", async () => {
    const db = openTestDb();
    for (let i = 0; i < 5; i++) {
      await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Widget ${i}`, type: "text", content: "widget content" }, "claude");
    }
    const result = searchAssets(db, "widget", { limit: 2, offset: 0 });
    expect(result.total).toBe(5);
    expect(result.assets).toHaveLength(2);

    const page2 = searchAssets(db, "widget", { limit: 2, offset: 2 });
    expect(page2.assets).toHaveLength(2);
    expect(page2.assets[0].id).not.toBe(result.assets[0].id);
  });

  it("defaults to limit 50, offset 0 when neither is passed", async () => {
    const db = openTestDb();
    await createAsset(db, "/tmp/osmosis-test-uploads", { title: "Solo widget", type: "text", content: "widget content" }, "claude");
    const result = searchAssets(db, "widget");
    expect(result.total).toBe(1);
    expect(result.assets).toHaveLength(1);
  });
});
