import { defineConfig } from 'vitest/config'

// Tests of review/ code (pure modules only). Run from graph-engine/ (where vitest is installed):
//   npx vitest run --maxWorkers=2 --config ../review/vitest.config.mts --root ../review
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
