import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The dev demo/review harness bundles theme-core from source (the lib
    // build uses its own config and keeps theme-core type-only).
    alias: { 'theme-core': fileURLToPath(new URL('../theme-core/src/index.ts', import.meta.url)) },
  },
})
