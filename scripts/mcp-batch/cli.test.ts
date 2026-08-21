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
    expect(args).toEqual({ url: "http://localhost:4177/mcp/tok", raw: false, file: "calls.json" });
  });

  it("--url overrides the env var, --raw sets raw true, in any order", () => {
    delete process.env.OSMOSIS_MCP_URL;
    const args = parseArgs(["--raw", "--url", "http://localhost:9/mcp/x", "calls.json"]);
    expect(args).toEqual({ url: "http://localhost:9/mcp/x", raw: true, file: "calls.json" });
  });

  it("url is null and file is null when neither is provided", () => {
    delete process.env.OSMOSIS_MCP_URL;
    expect(parseArgs([])).toEqual({ url: null, raw: false, file: null });
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
});
