import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { DatabaseSync } from "node:sqlite";
import type { EnvConfig } from "../env.js";
import type { NodeRow } from "../node.js";
import { PROTOCOL_VERSION } from "../protocol.js";
import { mountMcp } from "../mcp/server.js";
import { registerApiRoutes } from "./apiRoutes.js";

export interface AppContext {
  db: DatabaseSync;
  env: EnvConfig;
  node: NodeRow;
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

    mountMcp(app, ctx);
  }

  registerApiRoutes(app, ctx);

  return app;
}
