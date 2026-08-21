export function parseMcpResponse(rawBody) {
  const dataLine = rawBody.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`No "data:" line in MCP response body: ${rawBody}`);
  }
  const envelope = JSON.parse(dataLine.slice("data:".length).trim());
  const contentText = envelope.result?.content?.[0]?.text;
  const payload = contentText !== undefined ? JSON.parse(contentText) : envelope.result;
  return { isError: Boolean(envelope.result?.isError), payload };
}

export async function callTool(url, name, args, id, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`MCP request failed: HTTP ${res.status}`);
  }

  const text = await res.text();
  return parseMcpResponse(text);
}

export function summarize(name, payload) {
  if (name === "create_questions") {
    const createdCount = payload.created?.length ?? 0;
    const rejected = payload.rejected ?? [];
    const warnings = payload.warnings ?? [];
    const duplicates = payload.possible_duplicates ?? [];
    const lines = [
      `created: ${createdCount}, rejected: ${rejected.length}, warnings: ${warnings.length}, possible_duplicates: ${duplicates.length}`,
    ];
    if (rejected.length > 0) lines.push(`rejected: ${JSON.stringify(rejected)}`);
    if (warnings.length > 0) lines.push(`warnings: ${JSON.stringify(warnings)}`);
    if (duplicates.length > 0) lines.push(`possible_duplicates: ${JSON.stringify(duplicates)}`);
    return lines.join("\n");
  }

  if (name === "create_tag") {
    return `created tag: ${payload.slug}`;
  }

  if (name === "create_template" || name === "edit_template") {
    return `id: ${payload.id}, eligible_count: ${payload.eligible_count}, short: ${payload.short}`;
  }

  if (name === "edit_question") {
    return `id: ${payload.id}, versioned: ${payload.versioned}`;
  }

  if (name === "retire_template" || name === "retire_question") {
    return `id: ${payload.id}, retired_at: ${payload.retired_at}`;
  }

  if (name === "set_config") {
    return `${payload.key} = ${JSON.stringify(payload.value)}`;
  }

  if (name === "merge_tags") {
    return `${payload.from_slug} -> ${payload.to_slug}, ${payload.questions_updated} questions repointed`;
  }

  // Read/informational tools (list_tags, list_templates, list_assets,
  // search_questions, search_assets, get_question, get_results, get_config,
  // read_asset, readme, bootstrap, create_asset) and any unrecognized future
  // tool name: full passthrough. Trimming a read tool's response would
  // remove the actual payload the caller asked for.
  return JSON.stringify(payload);
}

export async function runBatch(url, calls, opts = {}) {
  const { raw = false, fetchImpl = fetch } = opts;
  const results = [];
  let anyFailed = false;

  for (let i = 0; i < calls.length; i++) {
    const { name, arguments: args } = calls[i];
    try {
      const { isError, payload } = await callTool(url, name, args, i + 1, fetchImpl);
      if (isError) {
        anyFailed = true;
        results.push({ index: i, name, ok: false, message: JSON.stringify(payload) });
      } else {
        const message = raw ? JSON.stringify(payload) : summarize(name, payload);
        results.push({ index: i, name, ok: true, message });
      }
    } catch (err) {
      anyFailed = true;
      results.push({ index: i, name, ok: false, message: err.message });
    }
  }

  return { results, anyFailed };
}
