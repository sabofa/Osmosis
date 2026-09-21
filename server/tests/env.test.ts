import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnvConfig } from "../src/env.js";

const KEYS = ["NODE_ROLE", "NODE_LABEL", "PORT", "DB_PATH", "UPLOADS_DIR", "MCP_AUTH_TOKEN", "MCP_PRESENTER_TOKEN"];

describe("loadEnvConfig presenter token", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const k of KEYS) saved.set(k, process.env[k]);
    process.env.NODE_ROLE = "canonical";
    process.env.NODE_LABEL = "test";
    process.env.PORT = "8081";
    process.env.DB_PATH = "/var/lib/osmosis/canonical.db";
    process.env.UPLOADS_DIR = "/var/lib/osmosis/uploads";
    process.env.MCP_AUTH_TOKEN = "full-secret";
    delete process.env.MCP_PRESENTER_TOKEN;
  });

  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("leaves the presenter surface off when MCP_PRESENTER_TOKEN is unset", () => {
    expect(loadEnvConfig().mcpPresenterToken).toBeNull();
  });

  it("reads MCP_PRESENTER_TOKEN when set", () => {
    process.env.MCP_PRESENTER_TOKEN = "presenter-secret";
    expect(loadEnvConfig().mcpPresenterToken).toBe("presenter-secret");
  });

  // Two identical tokens would silently collapse the two surfaces into one —
  // the route resolves the full token first, so the presenter surface would
  // hand the tutor server the whole bank-maintenance inventory. Refuse to boot.
  it("refuses to boot when the presenter token equals the full token", () => {
    process.env.MCP_PRESENTER_TOKEN = "full-secret";
    expect(() => loadEnvConfig()).toThrow(/MCP_PRESENTER_TOKEN/);
    // The message must not contain the secret itself.
    try {
      loadEnvConfig();
    } catch (err) {
      expect((err as Error).message).not.toContain("full-secret");
    }
  });
});
