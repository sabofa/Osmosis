import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { EnvConfig } from "../env.js";
import type { NodeRow } from "../node.js";
import { PROTOCOL_VERSION, TOOLS_VERSION } from "../protocol.js";
import { mountMcp } from "../mcp/server.js";
import { registerApiRoutes } from "./apiRoutes.js";
import { registerLiveProxy } from "./liveProxy.js";
import { buildPullResponse, applyPushRequest, buildQuestionPayloads, fetchTagAncestorClosure, buildTemplateDrawResponse, type PullRequest, type PushRequest } from "../domain/sync.js";
import { resolveDailyDraw } from "../domain/dailyDraw.js";
import { DomainError } from "../domain/errors.js";
import type { SyncRuntime } from "../sync/client.js";

export interface AppContext {
  db: DatabaseSync;
  env: EnvConfig;
  node: NodeRow;
  runtime: SyncRuntime;
  // Request logging, on unless a caller says otherwise. The one caller that
  // says otherwise is the test suite: a few hundred request lines per run bury
  // the assertion that actually failed. The serializer below — the thing that
  // keeps an MCP token out of journald — belongs to the production config and
  // is unaffected by turning the logger off in a test.
  logger?: boolean;
}

// The MCP shared secrets travel as a path segment (see mcp/server.ts for why),
// so Fastify's default request log would write both of them into journald on
// every call. The token is the segment straight after /mcp; anything after it
// (the /upload sibling, a query string) is kept, since it is what makes the
// line worth logging at all.
export function redactMcpTokenInUrl(url: string): string {
  return url.replace(/^\/mcp\/[^/?#]+/, "/mcp/<redacted>");
}

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify(
    ctx.logger === false
      ? { logger: false }
      : {
          logger: {
            serializers: {
              req: (request) => ({
                method: request.method,
                url: redactMcpTokenInUrl(request.url),
                host: request.host,
                remoteAddress: request.ip,
                remotePort: request.socket?.remotePort,
              }),
            },
          },
        }
  );
  app.register(multipart);

  // /sync and /mcp — canonical only. /sync never touches the public internet
  // (Tailscale-only in prod); /mcp is the sole public surface, via cloudflared.
  if (ctx.env.role === "canonical") {
    app.get("/sync/health", async () => ({
      protocol_version: PROTOCOL_VERSION,
      tools_version: TOOLS_VERSION,
      push: true,
      node_id: ctx.node.id,
    }));

    app.post("/sync/pull", async (request) => {
      return buildPullResponse(ctx.db, request.body as PullRequest);
    });

    app.post("/sync/push", async (request) => {
      return applyPushRequest(ctx.db, request.body as PushRequest);
    });

    app.post("/sync/daily-draw", async (request, reply) => {
      const { kind } = request.body as { kind: unknown };
      if (kind !== "question" && kind !== "quiz") {
        reply.code(400).send({ error: "invalid_kind", message: `kind must be "question" or "quiz", got ${JSON.stringify(kind)}` });
        return;
      }
      const resolved = resolveDailyDraw(ctx.db, kind);
      const questions = buildQuestionPayloads(ctx.db, resolved.questions.map((q) => q.id));
      const usedTagSlugs = [...new Set(questions.flatMap((q) => (q as { tags: string[] }).tags))];
      const tagMatch = fetchTagAncestorClosure(ctx.db, usedTagSlugs);
      return {
        protocol_version: PROTOCOL_VERSION,
        daily_draw_id: resolved.daily_draw_id,
        draw_date: resolved.draw_date,
        kind: resolved.kind,
        tags: tagMatch,
        questions,
        question_order: resolved.questions.map((q) => q.id),
        exclusion_relaxed: resolved.exclusion_relaxed,
        short_draw: resolved.short_draw,
        requested: resolved.requested,
        returned: resolved.returned,
      };
    });

    app.post("/sync/template-draw", async (request, reply) => {
      const { template_id } = (request.body ?? {}) as { template_id?: unknown };
      if (typeof template_id !== "string" || template_id.length === 0) {
        reply.code(400).send({ error: "invalid_template_id", message: "template_id (string) is required" });
        return;
      }
      try {
        return buildTemplateDrawResponse(ctx.db, template_id);
      } catch (err) {
        if (err instanceof DomainError) {
          reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }
    });

    mountMcp(app, ctx);
  }

  // A local node forwards the Live pages' reads and writes to canonical
  // (http/liveProxy.ts) — registered before the local routes so a forwarded
  // request never reaches them.
  registerLiveProxy(app, ctx);
  registerApiRoutes(app, ctx);

  // Production only: serve the built web app from the same process. The app
  // keeps all navigation in React state (no client-side routes), so plain
  // file serving with index.html at / is enough — no SPA fallback needed.
  // Registered last so /api, /sync and /mcp routes above always win.
  if (ctx.env.webDistDir) {
    if (!existsSync(join(ctx.env.webDistDir, "index.html"))) {
      throw new Error(`WEB_DIST_DIR is set but ${ctx.env.webDistDir} has no index.html — run the web build first`);
    }
    app.register(fastifyStatic, { root: ctx.env.webDistDir, prefix: "/" });
  }

  return app;
}
