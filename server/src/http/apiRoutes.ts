import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, TOOLS_VERSION } from "../protocol.js";
import { listTags } from "../domain/tags.js";
import { searchQuestions, getQuestionDetail, getDocumentMarkers } from "../domain/questions.js";
import { createAsset, getAsset, listAssets, deleteAsset } from "../domain/assets.js";
import { getConfig, setConfig } from "../domain/config.js";
import {
  listTemplates,
  getTemplateDetail,
  getTemplateQuestions,
  downloadTemplate,
  deleteLocalTemplate,
  referencedTagLiterals,
  isTemplateDownloaded,
} from "../domain/templates.js";
import {
  createAttempt,
  createDailyAttempt,
  getAttemptDetail,
  listAttempts,
  answerResponse,
  submitAttempt,
  gradeResponse,
  sweepAbandonedAttempts,
  pauseAttempt,
  resumeAttempt,
} from "../domain/attempts.js";
import { listSessions, getSessionDetail } from "../domain/sessions.js";
import { resolveDailyDraw } from "../domain/dailyDraw.js";
import { getResults } from "../domain/results.js";
import { DomainError } from "../domain/errors.js";
import { addSlice, removeSlice } from "../domain/sync.js";
import { runSync, pullOneSlice, fetchAndApplyDailyDraw, fetchAndApplyTemplateDraw, forwardToCanonical, ForwardError } from "../sync/client.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId, applyThemesFromPull,
  type ThemeRow, type ThemeInput, type ThemeTokens,
} from "../domain/themes.js";
import type { AppContext } from "./app.js";

function sendDomainError(reply: { code: (n: number) => { send: (body: unknown) => void } }, err: unknown) {
  if (err instanceof DomainError) {
    const status = err.code === "not_found" ? 404 : 400;
    reply.code(status).send({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

// Slices are a local-node concept: the canonical node *is* the bank, it does
// not hold a slice of it. Without this guard, removeSlice's prune (reached via
// DELETE /api/slices/:slug and DELETE /api/templates/:id/download) would
// delete real bank questions on canonical.
function rejectIfCanonical(
  ctx: AppContext,
  reply: { code: (n: number) => { send: (body: unknown) => void } }
): boolean {
  if (ctx.env.role !== "canonical") return false;
  reply.code(400).send({
    error: "canonical_node",
    message: "Canonical nodes don't hold slices — this operation only applies to local nodes.",
  });
  return true;
}

export function registerApiRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get("/api/status", async () => {
    const syncState = db
      .prepare("SELECT last_pull_at, last_push_at, remote_protocol_version FROM sync_state WHERE id = 1")
      .get() as { last_pull_at: string | null; last_push_at: string | null; remote_protocol_version: number | null };
    const outboxDepth = (db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tries < 5").get() as { n: number }).n;
    const deadOutbox = db
      .prepare(
        "SELECT id, entity_type, entity_id, tries, last_try_at, last_error FROM outbox WHERE tries >= 5 ORDER BY last_try_at DESC"
      )
      .all() as { id: number; entity_type: string; entity_id: string; tries: number; last_try_at: string | null; last_error: string | null }[];
    const slices = (db.prepare("SELECT tag_slug FROM local_slice").all() as { tag_slug: string }[]).map(
      (r) => r.tag_slug
    );
    const modelGradesToday = (
      db.prepare("SELECT COUNT(*) AS n FROM grade WHERE grader = 'model' AND graded_at >= datetime('now', '-1 day')").get() as {
        n: number;
      }
    ).n;

    // The canonical node never pulls, so last_pull_at is meaningless there;
    // the app's "synced" pill shows the last time anything changed instead.
    const lastWrite = (
      db
        .prepare(
          `SELECT MAX(t) AS t FROM (
             SELECT MAX(created_at) AS t FROM question
             UNION ALL SELECT MAX(created_at) FROM tag
             UNION ALL SELECT MAX(submitted_at) FROM attempt
             UNION ALL SELECT MAX(created_at) FROM asset
           )`
        )
        .get() as { t: string | null }
    ).t;

    return {
      online: ctx.env.role === "canonical" ? true : ctx.runtime.online,
      canonical: ctx.node.canonical === 1,
      node: { id: ctx.node.id, label: ctx.node.label, canonical: ctx.node.canonical === 1 },
      // Where this node syncs to (null on canonical). The server app lives at
      // the same origin, so the app can link a local node's user there for
      // anything that only exists on canonical (live tutoring sessions).
      remote_url: ctx.env.remoteUrl,
      last_pull_at: syncState?.last_pull_at ?? null,
      last_push_at: syncState?.last_push_at ?? null,
      last_write_at: lastWrite,
      outbox_depth: outboxDepth,
      dead_outbox_depth: deadOutbox.length,
      dead_outbox: deadOutbox,
      slices,
      protocol_version: PROTOCOL_VERSION,
      tools_version: TOOLS_VERSION,
      remote_protocol_version: syncState?.remote_protocol_version ?? null,
      model_grades_today: modelGradesToday,
      model_grading_configured: ctx.env.deepseekApiKey !== null,
    };
  });

  app.post("/api/sync", async () => {
    const result = await runSync(ctx, ctx.runtime);
    return { ...result, online: ctx.runtime.online };
  });

  app.get("/api/tags", async (request) => {
    const q = request.query as { prefix?: string; include_retired?: string };
    return { tags: listTags(db, { prefix: q.prefix, includeRetired: q.include_retired === "true" }) };
  });

  app.get("/api/questions", async (request) => {
    const q = request.query as Record<string, string | undefined>;
    return searchQuestions(db, {
      text: q.text,
      type: q.type as "mc" | "written" | undefined,
      difficulty_min: q.difficulty_min ? Number(q.difficulty_min) : undefined,
      difficulty_max: q.difficulty_max ? Number(q.difficulty_max) : undefined,
      calculator_policy: q.calculator_policy as "allowed" | "forbidden" | "n_a" | undefined,
      include_retired: q.include_retired === "true",
      tag_query: q.tag ? { all: [q.tag] } : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/api/questions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getQuestionDetail(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/templates", async () => ({ templates: listTemplates(db) }));

  app.get("/api/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getTemplateDetail(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/templates/:id/questions", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { questions: getTemplateQuestions(db, id) };
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/templates/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (rejectIfCanonical(ctx, reply)) return;
    let result: { id: string; downloaded_at: string };
    try {
      result = downloadTemplate(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
    // Mirror POST /api/slices: record the slices, then best-effort pull their
    // content right away rather than waiting for the next periodic sync. A
    // failure here (offline) leaves the slice at the never-pulled sentinel,
    // which runSync backfills once the node is online again.
    try {
      const detail = getTemplateDetail(db, id);
      for (const tag of referencedTagLiterals(detail.tag_query)) {
        try {
          await pullOneSlice(ctx, tag);
        } catch {
          // best effort, per above
        }
      }
    } catch {
      // best effort, per above
    }
    return result;
  });

  app.delete("/api/templates/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (rejectIfCanonical(ctx, reply)) return;
    try {
      return deleteLocalTemplate(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  // Tutoring sessions — backs the app's "Live" nav: a list of sessions, each
  // expandable into its templates plus attempt history (and the distinguished
  // live-session row that polls /api/attempts/live-pending?session_id=...).
  app.get("/api/sessions", async (request) => {
    const q = request.query as { limit?: string; offset?: string };
    return listSessions(db, {
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getSessionDetail(db, id, { viewer: "learner" });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/attempts", async (request, reply) => {
    // No/empty body (or a non-object) must be a 400, not a TypeError 500
    // from destructuring undefined below.
    const body = (request.body ?? {}) as { source?: string; template_id?: string; question_ids?: string[]; daily_kind?: string };
    if (typeof body !== "object" || Array.isArray(body)) {
      reply.code(400).send({ error: "invalid_body", message: "POST /api/attempts expects a JSON object body." });
      return;
    }
    if (body.daily_kind !== undefined) {
      if (body.daily_kind !== "question" && body.daily_kind !== "quiz") {
        reply.code(400).send({
          error: "invalid_daily_kind",
          message: `daily_kind must be "question" or "quiz", got ${JSON.stringify(body.daily_kind)}`,
        });
        return;
      }
      const kind = body.daily_kind;
      try {
        if (ctx.env.role === "canonical") {
          const resolved = resolveDailyDraw(db, kind);
          const result = createDailyAttempt(
            db,
            { node_id: ctx.node.id, kind: kind === "question" ? "daily_question" : "daily_quiz",
              daily_draw_id: resolved.daily_draw_id, questions: resolved.questions },
            ctx.env.role
          );
          return { attempt_id: result.attempt_id, questions: result.questions,
                    short_draw: resolved.short_draw, requested: resolved.requested, returned: resolved.returned };
        }
        if (!ctx.runtime.online) {
          reply.code(503).send({ reason: "daily_requires_connection" });
          return;
        }
        const fetched = await fetchAndApplyDailyDraw(ctx, kind);
        const result = createDailyAttempt(
          db,
          { node_id: ctx.node.id, kind: kind === "question" ? "daily_question" : "daily_quiz",
            daily_draw_id: fetched.daily_draw_id, questions: fetched.questions },
          ctx.env.role
        );
        return { attempt_id: result.attempt_id, questions: result.questions,
                  short_draw: fetched.short_draw, requested: fetched.requested, returned: fetched.returned };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("daily-draw fetch failed")) {
          reply.code(503).send({ reason: "daily_requires_connection" });
          return;
        }
        sendDomainError(reply, err);
        return;
      }
    }
    try {
      const source = body.source as string;
      if (source === "template") {
        if (!body.template_id) {
          reply.code(400).send({ error: "template_id_required", message: "source 'template' requires template_id" });
          return;
        }
        // Canonical is the bank; a downloaded template has its slices here.
        // Anything else is a cloud test: canonical resolves the draw while
        // we're online, and offline it simply isn't available on this device.
        if (ctx.env.role === "canonical" || isTemplateDownloaded(db, body.template_id)) {
          return createAttempt(db, { node_id: ctx.node.id, source: "template", template_id: body.template_id }, ctx.env.role);
        }
        if (!ctx.runtime.online) {
          reply.code(503).send({ reason: "template_requires_connection" });
          return;
        }
        let drawn: Awaited<ReturnType<typeof fetchAndApplyTemplateDraw>>;
        try {
          drawn = await fetchAndApplyTemplateDraw(ctx, body.template_id);
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("template-draw fetch failed")) {
            reply.code(503).send({ reason: "template_requires_connection" });
            return;
          }
          throw err;
        }
        const result = createAttempt(
          db,
          { node_id: ctx.node.id, source: "template", template_id: body.template_id, questions: drawn.questions },
          ctx.env.role
        );
        return { attempt_id: result.attempt_id, questions: result.questions, short_draw: drawn.short_draw,
                 requested: drawn.requested, returned: drawn.returned, mix_adjusted: drawn.mix_adjusted };
      } else {
        // "adhoc" over this REST endpoint was reverted: it produced attempts
        // tagged app_live with no session_id, which GET /api/attempts/live-pending
        // (now session-required) can never discover — unreachable state the app
        // could create but never render. The tutor's real live-item path is MCP
        // (present_item), not this route. If the app ever needs to self-serve
        // adhoc attempts, this branch should accept session_id in the body first.
        reply.code(400).send({ error: "unsupported_source", message: `source must be "template", got ${JSON.stringify(source)}` });
        return;
      }
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/attempts", async (request) => {
    const q = request.query as { limit?: string; offset?: string };
    return listAttempts(db, {
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  // session_id is required: the live screen is always reached *through* a
  // session now, so without it this route could hand the app some other
  // session's leftover pending item.
  app.get("/api/attempts/live-pending", async (request, reply) => {
    const q = request.query as { session_id?: string };
    if (!q.session_id) {
      reply.code(400).send({
        error: "session_id_required",
        message: "GET /api/attempts/live-pending requires a session_id query param.",
      });
      return;
    }

    // The abandonment sweep is lazy (runs inside the attempt read/create
    // paths, not on a timer). Run it here too, or an item older than
    // abandon_after_hours that nothing has read since would still match
    // `abandoned_at IS NULL` below and get handed to the app as live — where
    // every answer PATCH then fails with attempt_abandoned.
    sweepAbandonedAttempts(db);

    const row = db
      .prepare(
        `SELECT id FROM attempt
         WHERE source = 'adhoc' AND delivery_mode = 'app_live'
           AND session_id = ?
           AND submitted_at IS NULL AND abandoned_at IS NULL
         ORDER BY started_at DESC, id DESC LIMIT 1`
      )
      .get(q.session_id) as { id: string } | undefined;

    if (!row) return { attempt: null };
    return { attempt: getAttemptDetail(db, row.id, { viewer: "learner" }) };
  });

  // Every /api read of an attempt is the app, i.e. the learner: a
  // deferred-reveal attempt withholds its answer key here until the session
  // it belongs to ends. The MCP tools read as the tutor and see everything.
  app.get("/api/attempts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getAttemptDetail(db, id, { viewer: "learner" });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.patch("/api/attempts/:id/responses/:response_id", async (request, reply) => {
    const { id, response_id } = request.params as { id: string; response_id: string };
    const body = request.body as {
      selected_choice_id?: string | null;
      response_text?: string | null;
      skipped?: boolean;
      elapsed_ms?: number;
      confidence?: "unsure" | "somewhat" | "confident" | null;
      idk?: boolean;
      misapplied_method?: string | null;
      best_guess_choice_id?: string | null;
    };
    try {
      return answerResponse(db, id, response_id, body);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  // The learner stepping away from a live item and coming back (spec §2.8).
  // A paused attempt is never swept as abandoned, and answering resumes it, so
  // the app never has to sequence resume-then-answer itself.
  app.post("/api/attempts/:id/pause", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return pauseAttempt(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/attempts/:id/resume", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return resumeAttempt(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/attempts/:id/submit", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      submitAttempt(db, id, ctx.env.role);
      // 5th sync trigger (spec): on submit, if currently online. Deliberately
      // not awaited — the submit response must not block on the network.
      if (ctx.env.role === "local" && ctx.runtime.online) {
        void runSync(ctx, ctx.runtime);
      }
      // Re-read as the learner: submitAttempt's own return is the tutor's
      // full record, which a deferred attempt must not put on the screen.
      return getAttemptDetail(db, id, { viewer: "learner" });
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/responses/:id/grade", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { grader: "self"; score: number; feedback?: string | null; override?: boolean };
    try {
      return gradeResponse(db, id, body, ctx.env.role);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/results/tags", async (request) => {
    const q = request.query as { tag?: string; since?: string; limit?: string; offset?: string };
    return getResults(
      db,
      {
        scope: "tag",
        tag_query: q.tag ? { all: [q.tag] } : undefined,
        since: q.since,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      },
      { viewer: "learner" }
    );
  });

  app.get("/api/results/questions", async (request) => {
    const q = request.query as { tag?: string; limit?: string; offset?: string };
    return getResults(
      db,
      {
        scope: "question",
        tag_query: q.tag ? { all: [q.tag] } : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      },
      { viewer: "learner" }
    );
  });

  app.get("/api/results/daily", async (request) => {
    const q = request.query as { limit?: string; offset?: string };
    return getResults(
      db,
      {
        scope: "daily",
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      },
      { viewer: "learner" }
    );
  });

  app.get("/api/assets", async () => ({ assets: listAssets(db) }));

  app.get("/api/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getAsset(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/assets/:id/questions", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      getAsset(db, id); // 404s if the document doesn't exist
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
    return { markers: getDocumentMarkers(db, id) };
  });

  app.post("/api/assets", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400).send({ error: "invalid_asset", message: "multipart file is required" });
      return;
    }
    const buffer = await file.toBuffer();
    const field = (name: string): string | undefined => {
      const f = file.fields[name];
      return f && !Array.isArray(f) && f.type === "field" ? String(f.value) : undefined;
    };
    const title = field("title") ?? file.filename;
    const typeField = field("type");
    const type = typeField === "url" || typeField === "text" ? typeField : "file";
    try {
      const asset = await createAsset(
        db,
        ctx.env.uploadsDir,
        {
          title,
          type,
          content: type === "file" ? buffer.toString("base64") : buffer.toString("utf8"),
          filename: type === "file" ? file.filename : null,
          mime: type === "file" ? file.mimetype : null,
        },
        "human"
      );
      return asset;
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return deleteAsset(db, ctx.env.uploadsDir, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/assets/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    let asset;
    try {
      asset = getAsset(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
    if (asset.type !== "file" || !asset.storage_path) {
      reply.code(404).send({ error: "not_found", message: `Asset "${id}" has no downloadable file.` });
      return;
    }
    const filePath = join(ctx.env.uploadsDir, asset.storage_path);
    if (!existsSync(filePath)) {
      reply.code(404).send({ error: "not_found", message: `Stored file for asset "${id}" is missing on disk.` });
      return;
    }
    // "inline", not "attachment" — this single endpoint serves both the
    // DocumentPanel <iframe>/<img> preview AND the explicit Download link.
    // "attachment" forces every consumer (including the preview iframe) to
    // download instead of render, which is what made the PDF silently
    // download with no visible preview. The Download link still downloads
    // correctly regardless: its HTML `download` attribute forces a save on
    // click for a same-origin URL independent of this header.
    //
    // The `return` here matters — every other route in this file returns a
    // plain value and lets Fastify serialize it, but this one replies
    // manually via reply.send(). Without `return`, this async handler's
    // promise resolves with `undefined` right after `.send()` is *called*
    // (not after the stream finishes), and that races Fastify's own
    // promise-based reply completion against the still-in-flight stream —
    // observed in practice as "stream closed prematurely" in the server log
    // and a 200 response with an empty body.
    // A filename is user/tutor-supplied; a `"` would terminate the quoted
    // header parameter and a CR/LF makes Node reject the header outright
    // (ERR_INVALID_CHAR → 500). Strip both rather than trust the input.
    const headerSafeName = (asset.filename ?? asset.storage_path).replace(/["\\\x00-\x1f\x7f]/g, "_");
    return reply
      .header("Content-Disposition", `inline; filename="${headerSafeName}"`)
      .header("Content-Type", asset.mime ?? "application/octet-stream")
      .send(createReadStream(filePath));
  });

  app.get("/api/slices", async () => ({
    slices: db.prepare("SELECT tag_slug, pulled_at, question_count FROM local_slice ORDER BY tag_slug").all(),
  }));

  app.post("/api/slices", async (request, reply) => {
    const { tag_slug } = request.body as { tag_slug: string };
    if (rejectIfCanonical(ctx, reply)) return;
    addSlice(db, tag_slug);
    try {
      await pullOneSlice(ctx, tag_slug);
    } catch (err) {
      // Slice is recorded even if the immediate pull fails (e.g. offline) —
      // the next periodic/manual sync picks it up, matching "adding one
      // triggers a full pull" as an intent, not a synchronous guarantee.
    }
    return { tag_slug };
  });

  app.delete("/api/slices/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (rejectIfCanonical(ctx, reply)) return;
    try {
      return removeSlice(db, slug);
    } catch (err) {
      if (err instanceof DomainError) {
        sendDomainError(reply, err);
        return;
      }
      // removeSlice can still raise a raw SQLite error (e.g. an FK we didn't
      // anticipate); a 400 with the detail beats a bare unhandled 500.
      reply.code(400).send({ error: "slice_remove_failed", message: String((err as Error).message ?? err) });
      return;
    }
  });

  // ---- Themes: user-level, canonical-owned, forwarded from local nodes ----
  // Reads are always local (the pull keeps the local copy current). Writes on
  // a local node go to canonical first and then mirror canonical's answer.
  const isLocal = ctx.env.role === "local";

  async function forwardOrLocal<T>(
    reply: { code: (n: number) => { send: (body: unknown) => void } },
    forward: () => Promise<T>,
    local: (fromCanonical: T | null) => unknown
  ): Promise<unknown> {
    if (!isLocal) return local(null);
    if (!ctx.runtime.online) {
      reply.code(503).send({ reason: "theme_requires_connection", message: "Theme changes need a connection to the server." });
      return;
    }
    let fromCanonical: T;
    try {
      fromCanonical = await forward();
    } catch (err) {
      if (err instanceof ForwardError) {
        reply.code(err.status).send(err.status === 503 ? { reason: "theme_requires_connection", message: "Theme changes need a connection to the server." } : err.body);
        return;
      }
      throw err;
    }
    return local(fromCanonical);
  }

  app.get("/api/themes", async () => ({ themes: listThemes(db), active_theme_id: getActiveThemeId(db) }));

  app.put("/api/themes/active", async (request, reply) => {
    const body = (request.body ?? {}) as { id?: string | null };
    const id = body.id ?? null;
    try {
      return await forwardOrLocal(
        reply,
        () => forwardToCanonical<{ active_theme_id: string | null }>(ctx, "PUT", "/api/themes/active", { id }),
        () => setActiveTheme(db, id)
      );
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.put("/api/themes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { name?: string; tokens?: ThemeTokens; custom_css?: string };
    const input: ThemeInput = { id, name: body.name ?? "", tokens: body.tokens as ThemeTokens, custom_css: body.custom_css };
    try {
      return await forwardOrLocal(
        reply,
        () => forwardToCanonical<ThemeRow>(ctx, "PUT", `/api/themes/${encodeURIComponent(id)}`, body),
        (fromCanonical) => {
          if (fromCanonical) {
            // Mirror canonical's row verbatim (its clock, not ours) so the
            // next pull's newer-wins compare treats it as already applied.
            applyThemesFromPull(db, [fromCanonical], undefined);
            return fromCanonical;
          }
          return saveTheme(db, input);
        }
      );
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.delete("/api/themes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await forwardOrLocal(
        reply,
        () => forwardToCanonical<{ id: string; tombstone: ThemeRow }>(ctx, "DELETE", `/api/themes/${encodeURIComponent(id)}`),
        (fromCanonical) => {
          if (fromCanonical) {
            applyThemesFromPull(db, [fromCanonical.tombstone], undefined);
            if (getActiveThemeId(db) === id) setActiveTheme(db, null);
            return { id };
          }
          const result = deleteTheme(db, id);
          const tombstone = listThemesForSync(db).find((t) => t.id === id)!;
          return { ...result, tombstone };
        }
      );
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.get("/api/config", async () => getConfig(db));

  app.patch("/api/config", async (request, reply) => {
    const { key, value } = request.body as { key: string; value: unknown };
    try {
      return setConfig(db, key, value);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });
}
