import { defineConfig } from 'vitest/config'

// Unit tests only cover the pure string→HTML layer (`src/lib/*.test.ts`), so a
// node environment is enough — no jsdom, no component rendering.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
