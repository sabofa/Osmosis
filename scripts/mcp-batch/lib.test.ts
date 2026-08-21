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

import { summarize } from "./lib.mjs";

describe("summarize", () => {
  it("create_questions: counts only, plus full rejected/warnings/possible_duplicates, never the created array's content", () => {
    const payload = {
      created: [
        { id: "q1", lineage_id: "l1", prompt_preview: "What is 2+2?" },
        { id: "q2", lineage_id: "l2", prompt_preview: "What is 3+3?" },
      ],
      rejected: [{ index: 2, reason: "invalid_difficulty", detail: "must be 1-5" }],
      warnings: [{ index: 0, message: "mc question has 5 choices; readme()'s convention is 4 choices" }],
      possible_duplicates: [],
    };
    const text = summarize("create_questions", payload);
    expect(text).toContain("created: 2, rejected: 1, warnings: 1, possible_duplicates: 0");
    expect(text).toContain("invalid_difficulty");
    expect(text).toContain("5 choices");
    expect(text).not.toContain("q1");
    expect(text).not.toContain("prompt_preview");
    expect(text).not.toContain("What is 2+2?");
  });

  it("create_questions: omits the rejected/warnings/possible_duplicates lines entirely when all are empty", () => {
    const payload = { created: [{ id: "q1", lineage_id: "l1", prompt_preview: "x" }], rejected: [], warnings: [], possible_duplicates: [] };
    const text = summarize("create_questions", payload);
    expect(text).toBe("created: 1, rejected: 0, warnings: 0, possible_duplicates: 0");
  });

  it("create_tag: the created slug, not the full row", () => {
    const text = summarize("create_tag", { slug: "math:algebra", label: "Algebra", parent_slug: "math", description: null, created_at: "now", retired_at: null });
    expect(text).toBe("created tag: math:algebra");
  });

  it("create_template and edit_template: id, eligible_count, short", () => {
    expect(summarize("create_template", { id: "t1", eligible_count: 47, short: false })).toBe(
      "id: t1, eligible_count: 47, short: false"
    );
    expect(summarize("edit_template", { id: "t1", eligible_count: 3, short: true })).toBe(
      "id: t1, eligible_count: 3, short: true"
    );
  });

  it("edit_question: id and versioned", () => {
    const text = summarize("edit_question", { id: "q1", lineage_id: "l1", version: 2, versioned: true, supersedes_id: "q0" });
    expect(text).toBe("id: q1, versioned: true");
  });

  it("retire_template and retire_question: id and retired_at", () => {
    expect(summarize("retire_question", { id: "q1", retired_at: "2026-08-21" })).toBe("id: q1, retired_at: 2026-08-21");
    expect(summarize("retire_template", { id: "t1", retired_at: "2026-08-21" })).toBe("id: t1, retired_at: 2026-08-21");
  });

  it("set_config: key = value", () => {
    expect(summarize("set_config", { key: "model_grader_daily_limit", value: 5, updated_at: "now" })).toBe(
      "model_grader_daily_limit = 5"
    );
  });

  it("merge_tags: from -> to and the repointed count", () => {
    const text = summarize("merge_tags", { from_slug: "algebra-old", to_slug: "algebra", retired_at: "now", questions_updated: 12 });
    expect(text).toBe("algebra-old -> algebra, 12 questions repointed");
  });

  it("a read/informational tool name passes the payload through in full, unmodified", () => {
    const payload = { tags: [{ slug: "math", label: "Math" }] };
    expect(JSON.parse(summarize("list_tags", payload))).toEqual(payload);
  });

  it("an unrecognized tool name falls back to full passthrough", () => {
    const payload = { anything: "at all" };
    expect(JSON.parse(summarize("some_future_tool", payload))).toEqual(payload);
  });
});
