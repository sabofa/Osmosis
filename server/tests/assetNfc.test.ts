import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb } from "./helpers.js";

const NON_NFC = "caf" + "é";
const NFC = "café";

vi.mock("../src/lib/extract/pdf.js", () => ({ extractPdf: async () => "caf" + "é pdf" }));

import { createAsset } from "../src/domain/assets.js";

const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-nfc-"));
afterAll(() => rmSync(uploadsDir, { recursive: true, force: true }));

describe("createAsset NFC ingest", () => {
  let db: ReturnType<typeof openTestDb>;
  beforeEach(() => {
    db = openTestDb();
  });

  it("normalizes text asset content and extracted_text", async () => {
    const a = await createAsset(db, uploadsDir, { title: "t", type: "text", content: NON_NFC }, "human");
    expect(a.content).toBe(NFC);
    expect(a.extracted_text).toBe(NFC);
  });

  it("leaves already-NFC text byte-identical", async () => {
    const a = await createAsset(db, uploadsDir, { title: "t", type: "text", content: NFC + " plain" }, "human");
    expect(a.content).toBe(NFC + " plain");
    expect(a.extracted_text).toBe(NFC + " plain");
  });

  it("normalizes markdown file extracted_text but keeps stored bytes", async () => {
    const a = await createAsset(
      db,
      uploadsDir,
      { title: "m", type: "file", filename: "n.md", mime: "text/markdown", content: Buffer.from(NON_NFC, "utf8").toString("base64") },
      "human"
    );
    expect(a.extracted_text).toBe(NFC);
    expect(readFileSync(join(uploadsDir, a.storage_path!), "utf8")).toBe(NON_NFC);
  });

  it("normalizes text/plain file extracted_text", async () => {
    const a = await createAsset(
      db,
      uploadsDir,
      { title: "p", type: "file", filename: "n.txt", mime: "text/plain", content: Buffer.from(NON_NFC, "utf8").toString("base64") },
      "human"
    );
    expect(a.extracted_text).toBe(NFC);
  });

  it("does not normalize PDF extracted_text", async () => {
    const a = await createAsset(
      db,
      uploadsDir,
      { title: "d", type: "file", filename: "d.pdf", mime: "application/pdf", content: Buffer.from("x").toString("base64") },
      "human"
    );
    expect(a.extracted_text).toBe("caf" + "é pdf");
  });
});
