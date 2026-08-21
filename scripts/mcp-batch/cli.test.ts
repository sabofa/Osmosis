import { describe, it, expect, afterEach } from "vitest";
import { parseArgs } from "./cli.mjs";

describe("parseArgs", () => {
  const originalEnv = process.env.OSMOSIS_MCP_URL;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OSMOSIS_MCP_URL;
    else process.env.OSMOSIS_MCP_URL = originalEnv;
  });

  it("reads the file path positionally and the URL from the env var", () => {
    process.env.OSMOSIS_MCP_URL = "http://localhost:4177/mcp/tok";
    const args = parseArgs(["calls.json"]);
    expect(args).toEqual({
      url: "http://localhost:4177/mcp/tok",
      raw: false,
      file: "calls.json",
      timeoutMs: 30000,
      error: null,
    });
  });

  it("--url overrides the env var, --raw sets raw true, in any order", () => {
    delete process.env.OSMOSIS_MCP_URL;
    const args = parseArgs(["--raw", "--url", "http://localhost:9/mcp/x", "calls.json"]);
    expect(args).toEqual({
      url: "http://localhost:9/mcp/x",
      raw: true,
      file: "calls.json",
      timeoutMs: 30000,
      error: null,
    });
  });

  it("url is null and file is null when neither is provided", () => {
    delete process.env.OSMOSIS_MCP_URL;
    expect(parseArgs([])).toEqual({ url: null, raw: false, file: null, timeoutMs: 30000, error: null });
  });

  it("--timeout overrides the default and OSMOSIS_MCP_TIMEOUT_MS env var fallback", () => {
    delete process.env.OSMOSIS_MCP_URL;
    const originalTimeout = process.env.OSMOSIS_MCP_TIMEOUT_MS;
    try {
      delete process.env.OSMOSIS_MCP_TIMEOUT_MS;
      const args = parseArgs(["--timeout", "5000", "--url", "http://localhost:9/mcp/x", "calls.json"]);
      expect(args.timeoutMs).toBe(5000);

      process.env.OSMOSIS_MCP_TIMEOUT_MS = "8000";
      const argsFromEnv = parseArgs(["--url", "http://localhost:9/mcp/x", "calls.json"]);
      expect(argsFromEnv.timeoutMs).toBe(8000);
    } finally {
      if (originalTimeout === undefined) delete process.env.OSMOSIS_MCP_TIMEOUT_MS;
      else process.env.OSMOSIS_MCP_TIMEOUT_MS = originalTimeout;
    }
  });

  it("an unrecognized flag is reported as an error rather than swallowed as the file path", () => {
    delete process.env.OSMOSIS_MCP_URL;
    const args = parseArgs(["--bogus", "--url", "http://localhost:9/mcp/x", "calls.json"]);
    expect(args.error).toMatch(/unrecognized flag/i);
    expect(args.error).toContain("--bogus");
  });
});

import { createServer } from "node:http";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "./cli.mjs";

describe("main (end-to-end against a local HTTP server)", () => {
  it("POSTs each call to the real HTTP server and prints a summary per call, exit code 0 on full success", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const resultObj =
          parsed.params.name === "create_tag"
            ? { content: [{ type: "text", text: JSON.stringify({ slug: parsed.params.arguments.slug }) }] }
            : { content: [{ type: "text", text: JSON.stringify({ tags: [] }) }] };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ result: resultObj, jsonrpc: "2.0", id: parsed.id })}\n\n`);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), "mcp-batch-test-"));
    const callsFile = join(dir, "calls.json");
    writeFileSync(
      callsFile,
      JSON.stringify([
        { name: "create_tag", arguments: { slug: "math", label: "Math" } },
        { name: "list_tags", arguments: {} },
      ])
    );

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    let exitCode: number;
    try {
      exitCode = await main(["--url", `http://127.0.0.1:${port}/mcp/tok`, callsFile]);
    } finally {
      console.log = originalLog;
      unlinkSync(callsFile);
      await new Promise((resolve) => server.close(resolve));
    }

    expect(exitCode).toBe(0);
    expect(logs[0]).toBe("[0] create_tag: created tag: math");
    expect(logs[1]).toContain("[1] list_tags:");
    expect(JSON.parse(logs[1].replace("[1] list_tags: ", ""))).toEqual({ tags: [] });
  });

  it("includes a create_questions call and asserts the printed summary never leaks prompt_preview/created content", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        let resultObj;
        if (parsed.params.name === "create_questions") {
          resultObj = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  created: [
                    { id: "q1", lineage_id: "l1", prompt_preview: "What is the capital of France?" },
                    { id: "q2", lineage_id: "l2", prompt_preview: "What is 7 * 8?" },
                  ],
                  rejected: [],
                  warnings: [],
                  possible_duplicates: [],
                }),
              },
            ],
          };
        } else {
          resultObj = { content: [{ type: "text", text: JSON.stringify({ slug: parsed.params.arguments.slug }) }] };
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ result: resultObj, jsonrpc: "2.0", id: parsed.id })}\n\n`);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), "mcp-batch-test-"));
    const callsFile = join(dir, "calls.json");
    writeFileSync(
      callsFile,
      JSON.stringify([
        { name: "create_tag", arguments: { slug: "math", label: "Math" } },
        { name: "create_questions", arguments: { questions: [] } },
      ])
    );

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    let exitCode: number;
    try {
      exitCode = await main(["--url", `http://127.0.0.1:${port}/mcp/tok`, callsFile]);
    } finally {
      console.log = originalLog;
      unlinkSync(callsFile);
      await new Promise((resolve) => server.close(resolve));
    }

    expect(exitCode).toBe(0);
    const combined = logs.join("\n");
    expect(combined).toContain("created: 2, rejected: 0, warnings: 0, possible_duplicates: 0");
    expect(combined).not.toContain("prompt_preview");
    expect(combined).not.toContain("What is the capital of France?");
    expect(combined).not.toContain("What is 7 * 8?");
  });
});

describe("main: calls file shape validation", () => {
  it("rejects a calls file whose top level is an object instead of an array, before any network call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-batch-test-"));
    const callsFile = join(dir, "calls.json");
    writeFileSync(callsFile, JSON.stringify({ calls: [{ name: "create_tag", arguments: {} }] }));

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => errors.push(msg);

    let exitCode: number;
    try {
      // Bogus/unreachable URL: if validation didn't short-circuit before any
      // network call, this would hang or throw a network error instead of
      // returning cleanly with exit code 1.
      exitCode = await main(["--url", "http://127.0.0.1:1/mcp/tok", callsFile]);
    } finally {
      console.error = originalError;
      unlinkSync(callsFile);
    }

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/must be a json array/i);
  });

  it("rejects a calls file with an entry missing a string name field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-batch-test-"));
    const callsFile = join(dir, "calls.json");
    writeFileSync(
      callsFile,
      JSON.stringify([{ name: "create_tag", arguments: {} }, { arguments: { slug: "x" } }])
    );

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => errors.push(msg);

    let exitCode: number;
    try {
      exitCode = await main(["--url", "http://127.0.0.1:1/mcp/tok", callsFile]);
    } finally {
      console.error = originalError;
      unlinkSync(callsFile);
    }

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/must be a json array/i);
  });
});
