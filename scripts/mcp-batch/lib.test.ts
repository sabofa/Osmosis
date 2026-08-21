import { describe, it, expect, vi } from "vitest";
import { parseMcpResponse, callTool } from "./lib.mjs";

describe("parseMcpResponse", () => {
  it("parses a successful tool response's SSE framing and inner JSON-encoded content", () => {
    const raw =
      'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"created\\":[{\\"id\\":\\"q1\\"}]}"}]},"jsonrpc":"2.0","id":1}\n\n';
    const { isError, payload } = parseMcpResponse(raw);
    expect(isError).toBe(false);
    expect(payload).toEqual({ created: [{ id: "q1" }] });
  });

  it("marks isError true and still parses the inner content when the tool call itself failed", () => {
    const raw =
      'event: message\ndata: {"result":{"isError":true,"content":[{"type":"text","text":"{\\"error\\":\\"invalid_slug_format\\",\\"message\\":\\"bad slug\\"}"}]},"jsonrpc":"2.0","id":2}\n\n';
    const { isError, payload } = parseMcpResponse(raw);
    expect(isError).toBe(true);
    expect(payload).toEqual({ error: "invalid_slug_format", message: "bad slug" });
  });

  it("throws a clear error when there is no data: line", () => {
    expect(() => parseMcpResponse("not an SSE frame at all")).toThrow(/no "data:" line/i);
  });
});

function mockFetch(rawBody, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, text: async () => rawBody })) as unknown as typeof fetch;
}

describe("callTool", () => {
  it("POSTs a tools/call JSON-RPC envelope and returns the parsed response", async () => {
    const raw =
      'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"tags\\":[]}"}]},"jsonrpc":"2.0","id":1}\n\n';
    const fetchImpl = mockFetch(raw);

    const result = await callTool("http://localhost:9/mcp/tok", "list_tags", {}, 1, fetchImpl);

    expect(result).toEqual({ isError: false, payload: { tags: [] } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:9/mcp/tok",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    const callBody = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(callBody).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_tags", arguments: {} },
    });
  });

  it("throws a clear error on a non-ok HTTP response", async () => {
    const fetchImpl = mockFetch("", false, 500);
    await expect(callTool("http://localhost:9/mcp/tok", "list_tags", {}, 1, fetchImpl)).rejects.toThrow(/http 500/i);
  });
});
