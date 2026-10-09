import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { auditText, auditDb } from "../scripts/audit-offsets.js";

describe("auditText", () => {
  it("counts non-BMP code points and detects non-NFC", () => {
    expect(auditText("plain")).toEqual({ nonBmp: 0, nonNfc: false });
    expect(auditText("a\u{1D465}b\u{1F600}")).toEqual({ nonBmp: 2, nonNfc: false });
    expect(auditText("é")).toEqual({ nonBmp: 0, nonNfc: true });
  });
});

describe("auditDb", () => {
  it("flags only affected assets with anchored question counts", () => {
    const db = openTestDb();
    const ins = db.prepare("INSERT INTO asset (id, title, type, extracted_text, created_by) VALUES (?, ?, 'text', ?, 'human')");
    ins.run("clean", "clean", "hello");
    ins.run("emoji", "emoji", "hi \u{1F600}");
    ins.run("combo", "combo", "é");
    db.prepare(
      `INSERT INTO question (id, lineage_id, version, type, prompt, difficulty, calculator_policy, document_id, document_anchor_start)
       VALUES ('q1','l1',1,'mc','p',1,'n_a','emoji',3)`
    ).run();
    const before = db.prepare("SELECT COUNT(*) n FROM question").get();
    const rows = auditDb(db);
    expect(rows.map((r) => r.id).sort()).toEqual(["combo", "emoji"]);
    expect(rows.find((r) => r.id === "emoji")!.anchoredQuestions).toBe(1);
    expect(rows.find((r) => r.id === "combo")!.anchoredQuestions).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM question").get()).toEqual(before);
  });
});
