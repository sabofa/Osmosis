#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runBatch } from "./lib.mjs";

const RECOGNIZED_FLAGS = new Set(["--url", "--raw", "--timeout"]);

export function parseArgs(argv) {
  let url = process.env.OSMOSIS_MCP_URL ?? null;
  let raw = false;
  let file = null;
  let timeoutMs = process.env.OSMOSIS_MCP_TIMEOUT_MS
    ? Number(process.env.OSMOSIS_MCP_TIMEOUT_MS)
    : 30000;
  let error = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") {
      url = argv[++i] ?? null;
      continue;
    }
    if (arg === "--raw") {
      raw = true;
      continue;
    }
    if (arg === "--timeout") {
      timeoutMs = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith("--") && !RECOGNIZED_FLAGS.has(arg)) {
      error = `Unrecognized flag: ${arg}`;
      continue;
    }
    if (file === null) {
      file = arg;
    }
  }

  return { url, raw, file, timeoutMs, error };
}

export async function main(argv) {
  const { url, raw, file, timeoutMs, error } = parseArgs(argv);

  if (error) {
    console.error(error);
    return 1;
  }
  if (!url) {
    console.error("Missing MCP URL: set OSMOSIS_MCP_URL or pass --url <url>");
    return 1;
  }
  if (!file) {
    console.error("Usage: node cli.mjs [--url <url>] [--raw] [--timeout <ms>] <calls.json>");
    return 1;
  }

  const calls = JSON.parse(readFileSync(file, "utf8"));

  if (!Array.isArray(calls)) {
    console.error("calls file must be a JSON array of {name, arguments} objects");
    return 1;
  }
  for (const call of calls) {
    if (!call || typeof call.name !== "string") {
      console.error("calls file must be a JSON array of {name, arguments} objects");
      return 1;
    }
  }

  const { anyFailed } = await runBatch(url, calls, {
    raw,
    timeoutMs,
    onResult: (r) => {
      console.log(`[${r.index}] ${r.name}: ${r.ok ? "" : "FAILED "}${r.message}`);
    },
  });

  return anyFailed ? 1 : 0;
}

// Only run when executed directly (`node cli.mjs ...`), not when imported
// by cli.test.ts. pathToFileURL (not a plain "file://" + string concat) is
// required for this comparison to work on Windows, where process.argv[1]
// is a backslash path ("C:\...") that doesn't turn into a valid file URL by
// simply prepending "file://" to it.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
