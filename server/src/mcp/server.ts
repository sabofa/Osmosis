import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../http/app.js";
import { registerTools } from "./tools.js";
import type { ToolScope } from "../domain/readme.js";
import { createAsset } from "../domain/assets.js";
import { DomainError } from "../domain/errors.js";

export function buildMcpServer(ctx: AppContext, scope: ToolScope = "full"): McpServer {
  const server = new McpServer({ name: "osmosis", version: "1.0.0" });
  registerTools(server, ctx.db, ctx.env.uploadsDir, ctx.node.id, scope);
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

// Two shared secrets on one route. MCP_AUTH_TOKEN is the authoring connector
// and gets everything; MCP_PRESENTER_TOKEN (optional — when unset the
// presenter surface simply doesn't exist) is the tutor server's own
// connection and gets only PRESENTER_TOOLS. Both compared in constant time,
// neither ever logged; an unrecognised token resolves to null and 404s the
// same way a missing one does.
function resolveScope(ctx: AppContext, token: string): ToolScope | null {
  if (ctx.env.mcpAuthToken && tokenMatches(token, ctx.env.mcpAuthToken)) return "full";
  if (ctx.env.mcpPresenterToken && tokenMatches(token, ctx.env.mcpPresenterToken)) return "presenter";
  return null;
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
    const scope = resolveScope(ctx, token);
    if (!scope) {
      reply.code(404).send();
      return;
    }

    const mcpServer = buildMcpServer(ctx, scope);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.hijack();
  });

  // Plain multipart upload, sibling to the JSON-RPC MCP route above and
  // gated by the same token. Exists so a Claude session with its own shell
  // (Code Execution, Claude Code) can hand a file to this node with a
  // single `curl -F file=@doc.pdf` — the bytes travel disk-to-disk over
  // HTTP and never pass through the model's context the way base64 inside
  // an MCP tool call would. /api/assets already does the human-upload
  // version of this; this route exists only because /api is localhost-only
  // per the deployment model (§13.1) and unreachable from a remote sandbox,
  // while /mcp is the one surface cloudflared actually exposes.
  app.post("/mcp/:token/upload", async (request, reply) => {
    // Either token: a presenter session hands over a file the same way an
    // authoring one does, and an upload writes an asset rather than reaching
    // any of the tools the presenter scope withholds.
    const { token } = request.params as { token: string };
    if (!resolveScope(ctx, token)) {
      reply.code(404).send();
      return;
    }

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

    try {
      const asset = await createAsset(
        ctx.db,
        ctx.env.uploadsDir,
        {
          title: field("title") ?? file.filename,
          type: "file",
          content: buffer.toString("base64"),
          filename: file.filename,
          mime: file.mimetype,
        },
        "claude"
      );
      reply.send({ id: asset.id, title: asset.title, type: asset.type, extracted_text: asset.extracted_text });
    } catch (err) {
      if (err instanceof DomainError) {
        reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  });
}
