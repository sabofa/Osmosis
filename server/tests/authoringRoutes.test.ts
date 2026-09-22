import { describe, it, expect } from "vitest";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { clearData } from "../src/http/authoringRoutes.js";
import { v4 as uuidv4 } from "uuid";

function app(db = openTestDb()) {
  const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null, uploadsDir: ".", mcpAuthToken: "t", webDistDir: null };
  const a = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
  return { app: a, db };
}

describe("authoring and admin over HTTP", () => {
  it("creates, edits and retires a question", async () => {
    const { app: a, db } = app();
    insertTag(db, "math");
    const created = await a.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        questions: [
          {
            type: "mc",
            prompt: "2+2?",
            tags: ["math"],
            choices: [
              { body: "4", is_correct: true },
              { body: "5", is_correct: false },
            ],
          },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().created[0].id as string;
    const edited = await a.inject({ method: "PATCH", url: `/api/questions/${id}`, payload: { prompt: "What is 2+2?" } });
    expect(edited.statusCode).toBe(200);
    const retired = await a.inject({ method: "POST", url: `/api/questions/${id}/retire`, payload: { reason: "test" } });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().retired_at).toBeTruthy();
    const bad = await a.inject({ method: "POST", url: "/api/questions", payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it("creates a template and shows its draw SQL", async () => {
    const { app: a, db } = app();
    insertTag(db, "geo");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["geo"] });
    const created = await a.inject({
      method: "POST",
      url: "/api/templates",
      payload: { name: "Geo", tag_query: { all: ["geo"] }, question_count: 2 },
    });
    expect(created.statusCode).toBe(200);
    const sql = await a.inject({ method: "GET", url: `/api/templates/${created.json().id}/sql` });
    expect(sql.statusCode).toBe(200);
    expect(sql.json().eligibility_sql).toMatch(/^SELECT q\.id.*WHERE q\.retired_at IS NULL/s);
    expect(sql.json().template.name).toBe("Geo");
  });

  it("opens a session, presents into it, and grades over HTTP", async () => {
    const { app: a, db } = app();
    insertTag(db, "w");
    const q = insertQuestion(db, { type: "written", tags: ["w"] });
    const s = await a.inject({ method: "POST", url: "/api/sessions", payload: { name: "Mine" } });
    expect(s.statusCode).toBe(200);
    const p = await a.inject({ method: "POST", url: `/api/sessions/${s.json().id}/present`, payload: { question_id: q.id } });
    expect(p.statusCode).toBe(200);
    const { attempt_id, response_id } = p.json();
    await a.inject({ method: "PATCH", url: `/api/attempts/${attempt_id}/responses/${response_id}`, payload: { response_text: "because" } });
    await a.inject({ method: "POST", url: `/api/attempts/${attempt_id}/submit` });
    const ungraded = await a.inject({ method: "GET", url: "/api/responses/ungraded" });
    expect(ungraded.json().total).toBe(1);
    const g = await a.inject({ method: "POST", url: `/api/responses/${response_id}/tutor-grade`, payload: { grader: "judge", score: 1, diagnosis: "fine" } });
    expect(g.statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/api/responses/ungraded" })).json().total).toBe(0);
  });

  it("reports status, reindexes, and clears only what it is told to", async () => {
    const { app: a, db } = app();
    insertTag(db, "m");
    const q = insertQuestion(db, { tags: ["m"] });
    const attemptId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', datetime('now'), datetime('now'))").run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, 0)").run(uuidv4(), attemptId, q.id);

    const status = await a.inject({ method: "GET", url: "/api/admin/status" });
    expect(status.json().counts.attempt).toBe(1);
    expect(status.json().counts.question).toBe(1);

    const re = await a.inject({ method: "POST", url: "/api/admin/reindex" });
    expect(re.json().reindexed).toBe(true);

    const refused = await a.inject({ method: "POST", url: "/api/admin/clear", payload: { scope: "attempts" } });
    expect(refused.statusCode).toBe(400);
    const cleared = await a.inject({ method: "POST", url: "/api/admin/clear", payload: { scope: "attempts", confirm: "CLEAR" } });
    expect(cleared.json().deleted.attempts).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(1);

    expect(clearData(db, "all")).toMatchObject({ attempts: 0 });
  });
});
