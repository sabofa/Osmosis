import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb, insertTag } from "./helpers.js";
import { createAsset, deleteAsset } from "../src/domain/assets.js";
import { createQuestions, editQuestion, getQuestionDetail } from "../src/domain/questions.js";

const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-asset-delete-"));
afterAll(() => rmSync(uploadsDir, { recursive: true, force: true }));

describe("deleteAsset", () => {
  it("clears a referencing question's anchor and marker offsets along with document_id, so the question stays editable", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const asset = await createAsset(
      db,
      uploadsDir,
      { title: "passage", type: "text", content: "The quick brown fox jumps over the lazy dog." },
      "human"
    );
    const q = createQuestions(db, [
      {
        type: "written",
        prompt: "p",
        tags: ["a"],
        model_answer: "m",
        document_id: asset.id,
        document_anchor_label: "excerpt",
        document_anchor_start: 4,
        document_anchor_end: 9,
        document_marker_offset: 10,
      },
    ]).created[0];

    deleteAsset(db, uploadsDir, asset.id);

    const detail = getQuestionDetail(db, q.id);
    expect(detail.document_id).toBeNull();
    expect(detail.document_anchor_label).toBeNull();
    expect(detail.document_anchor_start).toBeNull();
    expect(detail.document_anchor_end).toBeNull();
    expect(detail.document_marker_offset).toBeNull();

    // The whole point: a later unrelated edit must not bounce off the
    // "document_marker_offset requires document_id" validation.
    expect(() => editQuestion(db, q.id, { prompt: "p2" })).not.toThrow();
  });
});

describe("createAsset failure cleanup", () => {
  it("does not leave an orphaned file on disk when text extraction throws", async () => {
    const db = openTestDb();
    const before = readdirSync(uploadsDir).length;
    // image/* extraction goes through DeepSeek and throws without an API key.
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await expect(
        createAsset(
          db,
          uploadsDir,
          { title: "img", type: "file", content: Buffer.from("not really a png").toString("base64"), filename: "x.png", mime: "image/png" },
          "human"
        )
      ).rejects.toThrow();
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
    }
    expect(readdirSync(uploadsDir).length).toBe(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM asset").get() as { n: number }).n).toBe(0);
  });
});
