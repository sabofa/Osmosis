import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The v2 review harness: one designated port that shows both engines, rather
// than the two separate per-engine dev servers (5174/5176) that each only
// show half the picture. Multi-page by design — index.html is a thin tab
// shell and each engine gets its own document (see index.html's comment for
// why that isolation matters), all served by this single server.
const here = fileURLToPath(new URL('.', import.meta.url))

// The Paint Lab's "Save as defaults": POST /__paint/tuning writes the lab's
// params to graph-engine/src/space/paint/tuning.json, which M2 reads as the
// shipping defaults. Dev server only (apply: 'serve'), a fixed path, and a body
// that must be a JSON object of painter params (paintLabTuning.ts validates and
// formats it). It asks for application/json, which a cross-site form cannot
// send without a CORS preflight this server never grants.
const TUNING_FILE = fileURLToPath(new URL('../graph-engine/src/space/paint/tuning.json', import.meta.url))
const TUNING_BODY_LIMIT = 1_000_000
const posix = (path: string) => path.replaceAll('\\', '/')
// A type only: the module itself is loaded through the dev server below, so the
// config stays free of imports from the repo's TypeScript.
type TuningModule = typeof import('./src/paintLabTuning')

function paintTuning(): Plugin {
  return {
    name: 'osmosis-paint-tuning',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__paint/tuning', (req, res) => {
        const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST the params as JSON.' }, { Allow: 'POST' })
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
          return reply(415, { ok: false, error: 'Send Content-Type: application/json.' })
        }
        const chunks: Buffer[] = []
        let size = 0
        let refused = false
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > TUNING_BODY_LIMIT) {
            if (!refused) reply(413, { ok: false, error: 'That body is far too large to be painter params.' })
            refused = true
            return
          }
          chunks.push(chunk)
        })
        req.on('end', async () => {
          if (refused) return
          try {
            const { handleTuningPost } = (await server.ssrLoadModule('/src/paintLabTuning.ts')) as TuningModule
            const result = handleTuningPost(Buffer.concat(chunks).toString('utf8'), (text) => writeFileSync(TUNING_FILE, text, 'utf8'))
            reply(result.status, result.body)
          } catch (error) {
            reply(500, { ok: false, error: `The tuning handler failed: ${error instanceof Error ? error.message : String(error)}` })
          }
        })
        req.on('error', () => {
          if (!refused) reply(400, { ok: false, error: 'The request body could not be read.' })
        })
      })
    },
    // Saving rewrites tuning.json, which the lab imports for its starting
    // params. Without this, the write would hot-reload the page under the person
    // who just pressed Save, throwing away the camera and everything unsaved.
    // The next load reads the new file.
    hotUpdate({ file }) {
      if (posix(file) === posix(TUNING_FILE)) return []
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [react(), paintTuning()],
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
