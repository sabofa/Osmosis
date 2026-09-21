import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { AppContext } from "./app.js";

// ----------------------------------------------------------------------------
// Live sessions on a local node.
//
// The tutor creates sessions, items and shows on the canonical node, over
// MCP, and they never sync down: a live item is answered once, by whoever is
// looking at the screen right now. So a local node forwards everything the
// Live pages read and write straight to canonical — sessions, the stream,
// its SSE events, shows, and any attempt this node does not own — and the
// app never has to know which node it is talking to.
//
// Registered as a preHandler hook: Fastify has parsed the JSON body by then,
// which is re-sent as JSON, and a forwarded request is answered here and
// never reaches the local handler. Offline, it is a 503 the app already
// knows how to read.
// ----------------------------------------------------------------------------

const FORWARD_TIMEOUT_MS = 20_000;

export function shouldForward(
  method: string,
  url: string,
  attemptIsLocal: (id: string) => boolean
): boolean {
  const path = url.split("?")[0];
  if (path === "/api/sessions" || path.startsWith("/api/sessions/")) return true;
  if (path.startsWith("/api/shows/")) return true;
  if (path === "/api/attempts/live-pending") return true;
  // An attempt this node does not hold belongs to canonical (a live item);
  // one it does hold is its own and stays local, whatever the method.
  const attempt = /^\/api\/attempts\/([^/]+)(\/|$)/.exec(path);
  if (attempt && !attemptIsLocal(decodeURIComponent(attempt[1]))) return true;
  void method;
  return false;
}

export function registerLiveProxy(app: FastifyInstance, ctx: AppContext): void {
  if (ctx.env.role !== "local" || !ctx.env.remoteUrl) return;
  const remote = ctx.env.remoteUrl.replace(/\/$/, "");
  const findAttempt = ctx.db.prepare("SELECT 1 FROM attempt WHERE id = ?");
  const attemptIsLocal = (id: string) => !!findAttempt.get(id);

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!shouldForward(request.method, request.url, attemptIsLocal)) return;

    if (!ctx.runtime.online) {
      reply.code(503).send({ reason: "requires_connection", message: "Live sessions live on the server; this device is offline." });
      return;
    }

    const controller = new AbortController();
    // The socket, not the request: a request with a body has already emitted
    // its own 'close' by the time the body is parsed, which is what a
    // preHandler runs after. The socket closes when the client actually
    // leaves.
    const socket = request.raw.socket;
    const onClose = () => controller.abort();
    socket?.on("close", onClose);
    // SSE streams run until the client leaves; everything else gets a deadline.
    const isStream = request.headers.accept?.includes("text/event-stream");
    const timer = isStream ? null : setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

    const headers: Record<string, string> = {};
    for (const name of ["accept", "last-event-id"]) {
      const v = request.headers[name];
      if (typeof v === "string") headers[name] = v;
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined;
    if (hasBody) headers["content-type"] = "application/json";

    let upstream: Response;
    try {
      upstream = await fetch(remote + request.url, {
        method: request.method,
        headers,
        body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      socket?.off("close", onClose);
      if (!reply.sent) {
        reply.code(503).send({ reason: "requires_connection", message: (err as Error).message });
      }
      return;
    }

    reply.hijack();
    const out: Record<string, string> = {};
    for (const name of ["content-type", "cache-control", "x-accel-buffering"]) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    if (isStream) out.connection = "keep-alive";
    reply.raw.writeHead(upstream.status, out);
    if (!upstream.body) {
      reply.raw.end();
    } else {
      const body = Readable.fromWeb(upstream.body as never);
      body.on("error", () => reply.raw.end());
      body.pipe(reply.raw);
    }
    reply.raw.on("close", () => {
      if (timer) clearTimeout(timer);
      socket?.off("close", onClose);
      controller.abort();
    });
  });
}
