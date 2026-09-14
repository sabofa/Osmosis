// server/tests/templateDraw.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { buildTemplateDrawResponse } from "../src/domain/sync.js";
import { createTemplate, retireTemplate } from "../src/domain/templates.js";
import { createAttempt } from "../src/domain/attempts.js";
import { DomainError } from "../src/domain/errors.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

function canonicalApp(db: ReturnType<typeof openTestDb>) {
  const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
                uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
  return buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime() });
}

describe("buildTemplateDrawResponse", () => {
  it("returns the drawn questions with tags (ancestor closure) and a matching question_order", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:alg", "math");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["math:alg"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["math:alg"] }, question_count: 2 });

    const r = buildTemplateDrawResponse(db, t.id);
    expect(r.template_id).toBe(t.id);
    expect(r.questions).toHaveLength(2);
    expect([...r.question_order].sort()).toEqual(r.questions.map((q) => q.id as string).sort());
    expect(r.tags.map((x) => x.slug)).toEqual(["math", "math:alg"]);
    expect(r.requested).toBe(2);
    expect(r.returned).toBe(2);
    expect(r.short_draw).toBe(false);
  });

  it("a frozen template returns its frozen set in order", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "f", tag_query: { all: ["a"] }, question_count: 2, frozen: true });
    const frozen = (db.prepare("SELECT question_id FROM template_frozen_question WHERE template_id = ? ORDER BY ordinal").all(t.id) as { question_id: string }[]).map((r) => r.question_id);
    expect(buildTemplateDrawResponse(db, t.id).question_order).toEqual(frozen);
  });
});

describe("POST /sync/template-draw", () => {
  it("serves the draw on canonical; 404 unknown; 400 retired", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });
    const app = canonicalApp(db);
    await app.ready();

    const ok = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: t.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().questions).toHaveLength(1);

    const missing = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: uuidv4() } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("not_found");

    retireTemplate(db, t.id);
    const retired = await app.inject({ method: "POST", url: "/sync/template-draw", payload: { template_id: t.id } });
    expect(retired.statusCode).toBe(400);
    expect(retired.json().error).toBe("template_retired");
    await app.close();
  });
});

describe("createAttempt with an explicit draw", () => {
  it("uses the given questions in the given order and skips the local draw", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });

    const r = createAttempt(db, {
      node_id: "n", source: "template", template_id: t.id,
      questions: [{ id: q2.id, lineage_id: q2.lineage_id, type: "mc" }, { id: q1.id, lineage_id: q1.lineage_id, type: "mc" }],
    });
    const rows = db.prepare("SELECT question_id FROM response WHERE attempt_id = ? ORDER BY ordinal").all(r.attempt_id) as { question_id: string }[];
    expect(rows.map((x) => x.question_id)).toEqual([q2.id, q1.id]);
  });

  it("rejects an empty draw instead of creating an attempt with no responses", () => {
    const db = openTestDb();
    insertTag(db, "empty");
    const t = createTemplate(db, { name: "t", tag_query: { all: ["empty"] }, question_count: 3 });
    expect(() => createAttempt(db, { node_id: "n", source: "template", template_id: t.id })).toThrow(DomainError);
    expect(() => createAttempt(db, { node_id: "n", source: "template", template_id: t.id, questions: [] })).toThrow(/empty_draw|no eligible/i);
    expect((db.prepare("SELECT COUNT(*) AS n FROM attempt").get() as { n: number }).n).toBe(0);
  });
});
