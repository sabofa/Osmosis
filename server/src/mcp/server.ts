import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../http/app.js";
import { registerTools } from "./tools.js";

export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "osmosis", version: "1.0.0" });
  registerTools(server, ctx.db, ctx.env.uploadsDir);
  return server;
}

// Constant-time compare that also tolerates a length mismatch without
// short-circuiting on it (timingSafeEqual throws if the buffers differ in
// length, which would otherwise itself leak the token length via timing).
function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mountMcp(app: FastifyInstance, ctx: AppContext): void {
  // The token lives in the URL path (not a header) because /mcp is meant to
  // be pasted whole into a "Remote MCP server URL" field — e.g. claude.ai's
  // custom connector dialog, which takes a URL and nothing else for a plain
  // shared-secret setup. A wrong or missing token 404s rather than 401s, so
  // scanning for "does something live here" gets no signal either way.
  //
  // Stateless mode (sessionIdGenerator: undefined): each HTTP request gets its own
  // transport, so it needs its own McpServer too — a Server can only be connected to
  // one transport at a time.
  app.all("/mcp/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!ctx.env.mcpAuthToken || !tokenMatches(token, ctx.env.mcpAuthToken)) {
      reply.code(404).send();
      return;
    }

    const mcpServer = buildMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.hijack();
  });
}
