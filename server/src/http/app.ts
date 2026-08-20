import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { DatabaseSync } from "node:sqlite";
import type { EnvConfig } from "../env.js";
import type { NodeRow } from "../node.js";
import { PROTOCOL_VERSION } from "../protocol.js";
import { mountMcp } from "../mcp/server.js";
import { registerApiRoutes } from "./apiRoutes.js";
import { buildPullResponse, applyPushRequest, buildQuestionPayloads, type PullRequest, type PushRequest } from "../domain/sync.js";
import { resolveDailyDraw } from "../domain/dailyDraw.js";
import type { SyncRuntime } from "../sync/client.js";

export interface AppContext {
  db: DatabaseSync;
  env: EnvConfig;
  node: NodeRow;
  runtime: SyncRuntime;
}

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(multipart);

  // /sync and /mcp — canonical only. /sync never touches the public internet
  // (Tailscale-only in prod); /mcp is the sole public surface, via cloudflared.
  if (ctx.env.role === "canonical") {
    app.get("/sync/health", async () => ({
      protocol_version: PROTOCOL_VERSION,
      node_id: ctx.node.id,
    }));

    app.post("/sync/pull", async (request) => {
      return buildPullResponse(ctx.db, request.body as PullRequest);
    });

    app.post("/sync/push", async (request) => {
      return applyPushRequest(ctx.db, request.body as PushRequest);
    });

    app.post("/sync/daily-draw", async (request) => {
      const { kind } = request.body as { kind: "question" | "quiz" };
      const resolved = resolveDailyDraw(ctx.db, kind);
      const questions = buildQuestionPayloads(ctx.db, resolved.questions.map((q) => q.id));
      const usedTagSlugs = [...new Set(questions.flatMap((q) => (q as { tags: string[] }).tags))];
      const tagMatch = usedTagSlugs.length > 0
        ? ctx.db.prepare(`SELECT slug, label, parent_slug, description, retired_at FROM tag WHERE slug IN (${usedTagSlugs.map(() => "?").join(",")})`).all(...usedTagSlugs)
        : [];
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

    mountMcp(app, ctx);
  }

  registerApiRoutes(app, ctx);

  return app;
}
