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
