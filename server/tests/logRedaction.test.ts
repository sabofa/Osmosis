import { describe, it, expect } from "vitest";
import { redactMcpTokenInUrl } from "../src/http/app.js";

// The MCP token is a path segment, so Fastify's default request log would
// write both shared secrets straight into journald on every call.
describe("redactMcpTokenInUrl", () => {
  it("redacts the token on the JSON-RPC route", () => {
    expect(redactMcpTokenInUrl("/mcp/deadbeefcafe")).toBe("/mcp/<redacted>");
  });

  it("keeps the upload suffix, and the query string, while redacting the token", () => {
    expect(redactMcpTokenInUrl("/mcp/deadbeefcafe/upload")).toBe("/mcp/<redacted>/upload");
    expect(redactMcpTokenInUrl("/mcp/deadbeefcafe?x=1")).toBe("/mcp/<redacted>?x=1");
  });

  it("leaves every other path alone", () => {
    expect(redactMcpTokenInUrl("/api/tags")).toBe("/api/tags");
    expect(redactMcpTokenInUrl("/sync/health")).toBe("/sync/health");
    // Not a token-bearing route: nothing follows /mcp to redact.
    expect(redactMcpTokenInUrl("/mcp")).toBe("/mcp");
    expect(redactMcpTokenInUrl("/mcp/")).toBe("/mcp/");
    // Only the leading segment — a "/mcp/" later in the path isn't the route.
    expect(redactMcpTokenInUrl("/api/x/mcp/secret")).toBe("/api/x/mcp/secret");
  });
});
