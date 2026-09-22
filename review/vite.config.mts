import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The v2 review harness: one designated port that shows both engines, rather
// than the two separate per-engine dev servers (5174/5176) that each only
// show half the picture. Multi-page by design — index.html is a thin tab
// shell and each engine gets its own document (see index.html's comment for
// why that isolation matters), all served by this single server.
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    // Designated, not "whatever's free": the whole point is a stable address
    // to keep open in a tab across sessions, so a taken port should fail
    // loudly here instead of silently moving to 5181.
    port: 5180,
    strictPort: true,
    fs: {
      // The engine sources live outside this root (../graph-engine,
      // ../document-engine) and are imported straight from source — no build
      // step, no dist/, so an edit in either engine hot-reloads here.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
})
