import { dirname, resolve, join } from "node:path";

export interface EnvConfig {
  role: "canonical" | "local";
  label: string;
  port: number;
  dbPath: string;
  remoteUrl: string | null;
  uploadsDir: string;
  mcpAuthToken: string | null;
  // Second shared secret for the reduced "presenter" MCP surface (the tutor
  // server's own connection). Optional in the type so the many EnvConfig
  // literals that predate it stay valid; undefined and null both mean the
  // presenter surface is off.
  mcpPresenterToken?: string | null;
  // The git checkout this node updates from (deploy/install.sh writes it);
  // when unset the nearest .git above the working directory is used.
  repoDir?: string | null;
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

  const mcpPresenterToken = process.env.MCP_PRESENTER_TOKEN ?? null;
  if (mcpPresenterToken && mcpAuthToken && mcpPresenterToken === mcpAuthToken) {
    // Identical tokens collapse the two surfaces into one: /mcp/:token
    // resolves the full token first, so the presenter connection would
    // silently get the whole bank-maintenance inventory. Never name either
    // value in the message.
    throw new Error(
      "MCP_PRESENTER_TOKEN must differ from MCP_AUTH_TOKEN — they name two different surfaces, " +
        "and an identical value would hand the presenter connection the full tool inventory."
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
    mcpPresenterToken,
    webDistDir: process.env.WEB_DIST_DIR ? resolve(process.env.WEB_DIST_DIR) : null,
  };
}
