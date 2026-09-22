import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { createQuestions, editQuestion, retireQuestion, type QuestionInput, type EditQuestionChanges } from "../domain/questions.js";
import { createTemplate, getTemplateDetail, type TemplateInput } from "../domain/templates.js";
import { buildEligibilityClause } from "../domain/draw.js";
import { createSession } from "../domain/sessions.js";
import { presentItem, gradeResponseByTutor, listUngradedWritten } from "../domain/attempts.js";
import { DomainError } from "../domain/errors.js";
import type { AppContext } from "./app.js";

// ----------------------------------------------------------------------------
// What the command line needs that the app's own screens never did: writing
// questions and templates, opening a session and presenting into it, grading
// over HTTP, and administration. The MCP tools do the same work for a
// connected Claude; these are the same domain functions for a human at a
// prompt. LAN-only like the rest of /api.
// ----------------------------------------------------------------------------

function sendDomainError(reply: { code: (n: number) => { send: (body: unknown) => void } }, err: unknown) {
  if (err instanceof DomainError) {
    reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

export type ClearScope = "attempts" | "daily" | "sessions" | "all";

// Rows that go, per scope. Questions, tags, templates, assets and themes are
// never touched — clearing is about what the learner did, not the bank.
export function clearData(db: DatabaseSync, scope: ClearScope): Record<string, number> {
  const counts: Record<string, number> = {};
  const run = (label: string, sql: string) => {
    counts[label] = Number(db.prepare(sql).run().changes);
  };
  db.exec("BEGIN");
  try {
    if (scope === "sessions" || scope === "all") {
      run("shows", "DELETE FROM show");
      run("live_grades", "DELETE FROM grade WHERE response_id IN (SELECT r.id FROM response r JOIN attempt a ON a.id = r.attempt_id WHERE a.session_id IS NOT NULL)");
      run("live_responses", "DELETE FROM response WHERE attempt_id IN (SELECT id FROM attempt WHERE session_id IS NOT NULL)");
      run("live_attempts", "DELETE FROM attempt WHERE session_id IS NOT NULL");
      run("session_templates", "DELETE FROM template WHERE session_id IS NOT NULL");
      run("ephemeral_questions_retired", "UPDATE question SET retired_at = COALESCE(retired_at, datetime('now')), retired_reason = COALESCE(retired_reason, 'session_cleared'), session_id = NULL WHERE session_id IS NOT NULL");
      run("sessions", "DELETE FROM tutor_session");
    }
    if (scope === "daily" || scope === "all") {
      run("daily_grades", "DELETE FROM grade WHERE response_id IN (SELECT r.id FROM response r JOIN attempt a ON a.id = r.attempt_id WHERE a.daily_draw_id IS NOT NULL)");
      run("daily_responses", "DELETE FROM response WHERE attempt_id IN (SELECT id FROM attempt WHERE daily_draw_id IS NOT NULL)");
      run("daily_attempts", "DELETE FROM attempt WHERE daily_draw_id IS NOT NULL");
      run("daily_draw_questions", "DELETE FROM daily_draw_question");
      run("daily_draws", "DELETE FROM daily_draw");
    }
    if (scope === "attempts" || scope === "all") {
      run("grades", "DELETE FROM grade");
      run("responses", "DELETE FROM response");
      run("attempts", "DELETE FROM attempt");
    }
    if (scope === "all") {
      run("retention", "DELETE FROM retention_schedule");
      run("outbox", "DELETE FROM outbox");
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return counts;
}

export function registerAuthoringRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  // ---- questions -------------------------------------------------------------
  app.post("/api/questions", async (request, reply) => {
    const body = (request.body ?? {}) as { questions?: QuestionInput[]; idempotency_key?: string };
    if (!Array.isArray(body.questions) || body.questions.length === 0) {
      reply.code(400).send({ error: "invalid_body", message: "questions: a non-empty array is required." });
      return;
    }
    try {
      return createQuestions(db, body.questions, { idempotency_key: body.idempotency_key });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.patch("/api/questions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return editQuestion(db, id, (request.body ?? {}) as EditQuestionChanges);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/questions/:id/retire", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = (request.body ?? {}) as { reason?: string };
    try {
      return retireQuestion(db, id, reason ?? "retired from the command line");
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  // ---- templates -------------------------------------------------------------
  app.post("/api/templates", async (request, reply) => {
    try {
      return createTemplate(db, (request.body ?? {}) as TemplateInput);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  // The template as data, plus the SQL its draw actually runs.
  app.get("/api/templates/:id/sql", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const template = getTemplateDetail(db, id) as unknown as Record<string, unknown> & {
        tag_query: TemplateInput["tag_query"];
        difficulty_min: number | null;
        difficulty_max: number | null;
        calculator_policy: string;
      };
      const clause = buildEligibilityClause({
        tag_query: template.tag_query,
        difficulty_min: template.difficulty_min,
        difficulty_max: template.difficulty_max,
        calculator_policy: template.calculator_policy as never,
      });
      const frozen = db
        .prepare("SELECT question_id FROM template_frozen_question WHERE template_id = ? ORDER BY ordinal")
        .all(id) as { question_id: string }[];
      return {
        template,
        eligibility_sql: `SELECT q.id, q.lineage_id, q.type FROM question q ${clause.sql}`,
        eligibility_args: clause.args,
        frozen_question_ids: frozen.map((f) => f.question_id),
      };
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  // ---- live ------------------------------------------------------------------
  app.post("/api/sessions", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; tag_slug?: string | null; reveal_default?: "immediate" | "deferred" };
    try {
      return createSession(db, { name: body.name ?? "", tag_slug: body.tag_slug ?? null, reveal_default: body.reveal_default });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/sessions/:id/present", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { question_id?: string; tag_query?: TemplateInput["tag_query"]; reveal?: "immediate" | "deferred" };
    try {
      return presentItem(db, { node_id: ctx.node.id, question_id: body.question_id, tag_query: body.tag_query, session_id: id, reveal: body.reveal });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/responses/:id/tutor-grade", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { grader?: "oracle" | "judge"; score?: number; diagnosis?: string | null };
    try {
      return gradeResponseByTutor(db, id, { grader: body.grader ?? "judge", score: body.score, diagnosis: body.diagnosis }, ctx.env.role);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/responses/ungraded", async (request) => {
    const q = request.query as { session_id?: string; include_self_graded?: string; limit?: string };
    return listUngradedWritten(db, {
      session_id: q.session_id,
      include_self_graded: q.include_self_graded === undefined ? undefined : q.include_self_graded !== "false",
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  // ---- administration ----------------------------------------------------------
  app.get("/api/admin/status", async () => {
    const tables = ["question", "tag", "template", "attempt", "response", "grade", "daily_draw", "tutor_session", "show", "asset", "outbox"];
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const pageCount = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
    const pageSize = (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
    return { role: ctx.env.role, node: ctx.node.label, db_path: ctx.env.dbPath, db_bytes: pageCount * pageSize, counts };
  });

  app.post("/api/admin/reindex", async () => {
    db.exec("INSERT INTO question_fts(question_fts) VALUES('rebuild')");
    db.exec("ANALYZE");
    db.exec("PRAGMA optimize");
    return { reindexed: true, fts_rows: (db.prepare("SELECT COUNT(*) AS n FROM question_fts").get() as { n: number }).n };
  });

  app.post("/api/admin/clear", async (request, reply) => {
    const body = (request.body ?? {}) as { scope?: string; confirm?: string };
    const scopes: ClearScope[] = ["attempts", "daily", "sessions", "all"];
    if (!scopes.includes(body.scope as ClearScope)) {
      reply.code(400).send({ error: "invalid_scope", message: `scope must be one of ${scopes.join(", ")}` });
      return;
    }
    if (body.confirm !== "CLEAR") {
      reply.code(400).send({ error: "confirm_required", message: 'Pass confirm: "CLEAR" to delete this data.' });
      return;
    }
    return { scope: body.scope, deleted: clearData(db, body.scope as ClearScope) };
  });
}
