import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites start two real Fastify nodes on real sockets and sync
    // between them (dailyDrawDurability, syncDurability, cloudTemplateRoutes,
    // themeRoutes). They take 1–3 s on an idle machine and blow through
    // vitest's 5 s default whenever a build or another suite is competing
    // for the CPU — that is load, not a hang.
    testTimeout: 20_000,
  },
});
