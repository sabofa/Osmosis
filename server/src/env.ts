import { dirname, resolve, join } from "node:path";

export interface EnvConfig {
  role: "canonical" | "local";
  label: string;
  port: number;
  dbPath: string;
  remoteUrl: string | null;
  uploadsDir: string;
  mcpAuthToken: string | null;
  deepseekApiKey: string | null;
  // Absolute path of the built web app (web/dist). When set, the server
  // serves it at / so a deployment is one process on one port and the app's
  // /api calls are same-origin with no proxy in front. Unset in dev, where
  // Vite serves the app and proxies /api itself.
  webDistDir: string | null;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadEnvConfig(): EnvConfig {
  const role = required("NODE_ROLE");
  if (role !== "canonical" && role !== "local") {
    throw new Error(`NODE_ROLE must be "canonical" or "local", got: ${role}`);
  }

  const remoteUrl = process.env.REMOTE_URL ?? null;
  if (role === "canonical" && remoteUrl) {
    throw new Error("Canonical node must not set REMOTE_URL");
  }
  if (role === "local" && !remoteUrl) {
    throw new Error("Local node requires REMOTE_URL");
  }

  const dbPath = required("DB_PATH");
  const uploadsDir = process.env.UPLOADS_DIR ?? join(dirname(resolve(dbPath)), "uploads");

  const mcpAuthToken = process.env.MCP_AUTH_TOKEN ?? null;
  if (role === "canonical" && !mcpAuthToken) {
    throw new Error(
      "Missing required env var: MCP_AUTH_TOKEN (canonical node exposes /mcp publicly and refuses to start without a token)"
    );
  }

  return {
    role,
    label: required("NODE_LABEL"),
    port: Number(required("PORT")),
    dbPath,
    remoteUrl,
    uploadsDir,
    mcpAuthToken,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? null,
    webDistDir: process.env.WEB_DIST_DIR ? resolve(process.env.WEB_DIST_DIR) : null,
  };
}
