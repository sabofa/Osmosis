import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../protocol.js";
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
} from "../domain/templates.js";
import {
  createAttempt,
  getAttemptDetail,
  listAttempts,
  answerResponse,
  submitAttempt,
  gradeResponse,
} from "../domain/attempts.js";
import { getResults } from "../domain/results.js";
import { DomainError } from "../domain/errors.js";
import { addSlice, removeSlice } from "../domain/sync.js";
import { runSync, pullOneSlice } from "../sync/client.js";
import type { AppContext } from "./app.js";

function sendDomainError(reply: { code: (n: number) => { send: (body: unknown) => void } }, err: unknown) {
  if (err instanceof DomainError) {
    const status = err.code === "not_found" ? 404 : 400;
    reply.code(status).send({ error: err.code, message: err.message });
    return;
  }
  throw err;
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

    return {
      online: ctx.env.role === "canonical" ? true : ctx.runtime.online,
      canonical: ctx.node.canonical === 1,
      node: { id: ctx.node.id, label: ctx.node.label, canonical: ctx.node.canonical === 1 },
      last_pull_at: syncState?.last_pull_at ?? null,
      last_push_at: syncState?.last_push_at ?? null,
      outbox_depth: outboxDepth,
      dead_outbox_depth: deadOutbox.length,
      dead_outbox: deadOutbox,
      slices,
      protocol_version: PROTOCOL_VERSION,
      remote_protocol_version: syncState?.remote_protocol_version ?? null,
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
    try {
      return downloadTemplate(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.delete("/api/templates/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return deleteLocalTemplate(db, id);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/attempts", async (request, reply) => {
    const body = request.body as { source: string; template_id?: string; daily_kind?: string };
    if (body.daily_kind) {
      reply.code(503).send({ reason: "daily_requires_connection" });
      return;
    }
    try {
      return createAttempt(db, { node_id: ctx.node.id, source: body.source as "template" | "adhoc", template_id: body.template_id }, ctx.env.role);
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

  app.get("/api/attempts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return getAttemptDetail(db, id);
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
    };
    try {
      return answerResponse(db, id, response_id, body);
    } catch (err) {
      sendDomainError(reply, err);
      return;
    }
  });

  app.post("/api/attempts/:id/submit", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return submitAttempt(db, id, ctx.env.role);
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
    const q = request.query as { tag?: string; since?: string; limit?: string };
    return getResults(db, {
      scope: "tag",
      tag_query: q.tag ? { all: [q.tag] } : undefined,
      since: q.since,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get("/api/results/questions", async (request) => {
    const q = request.query as { tag?: string; limit?: string };
    return getResults(db, {
      scope: "question",
      tag_query: q.tag ? { all: [q.tag] } : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get("/api/results/daily", async (request) => {
    const q = request.query as { limit?: string };
    return getResults(db, { scope: "daily", limit: q.limit ? Number(q.limit) : undefined });
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
      const asset = await createAsset(db, ctx.env.uploadsDir, {
        title,
        type,
        content: type === "file" ? buffer.toString("base64") : buffer.toString("utf8"),
        filename: type === "file" ? file.filename : null,
        mime: type === "file" ? file.mimetype : null,
      });
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
    return reply
      .header("Content-Disposition", `inline; filename="${asset.filename ?? asset.storage_path}"`)
      .header("Content-Type", asset.mime ?? "application/octet-stream")
      .send(createReadStream(filePath));
  });

  app.get("/api/slices", async () => ({
    slices: db.prepare("SELECT tag_slug, pulled_at, question_count FROM local_slice ORDER BY tag_slug").all(),
  }));

  app.post("/api/slices", async (request) => {
    const { tag_slug } = request.body as { tag_slug: string };
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

  app.delete("/api/slices/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    return removeSlice(db, slug);
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
