#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runBatch } from "./lib.mjs";

export function parseArgs(argv) {
  let url = process.env.OSMOSIS_MCP_URL ?? null;
  let raw = false;
  let file = null;

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
    if (file === null) {
      file = arg;
    }
  }

  return { url, raw, file };
}

export async function main(argv) {
  const { url, raw, file } = parseArgs(argv);

  if (!url) {
    console.error("Missing MCP URL: set OSMOSIS_MCP_URL or pass --url <url>");
    return 1;
  }
  if (!file) {
    console.error("Usage: node cli.mjs [--url <url>] [--raw] <calls.json>");
    return 1;
  }

  const calls = JSON.parse(readFileSync(file, "utf8"));
  const { results, anyFailed } = await runBatch(url, calls, { raw });

  for (const r of results) {
    console.log(`[${r.index}] ${r.name}: ${r.ok ? "" : "FAILED "}${r.message}`);
  }

  return anyFailed ? 1 : 0;
}

// Only run when executed directly (`node cli.mjs ...`), not when imported
// by cli.test.ts. pathToFileURL (not a plain "file://" + string concat) is
// required for this comparison to work on Windows, where process.argv[1]
// is a backslash path ("C:\...") that doesn't turn into a valid file URL by
// simply prepending "file://" to it.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
