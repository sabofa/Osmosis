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
// formats it). A request is first checked by refuseTuningRequest (method, the
// browser's Sec-Fetch-Site, the Origin against this server's own host and port,
// the exact media type): a page on another site cannot make the browser write
// the file.
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
      server.middlewares.use('/__paint/tuning', async (req, res) => {
        const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
          res.end(JSON.stringify(body))
        }
        let tuning: TuningModule
        try {
          tuning = (await server.ssrLoadModule('/src/paintLabTuning.ts')) as TuningModule
        } catch (error) {
          req.resume()
          return reply(500, { ok: false, error: `The tuning handler failed to load: ${error instanceof Error ? error.message : String(error)}` })
        }
        const refusal = tuning.refuseTuningRequest(req.method, req.headers)
        if (refusal) {
          req.resume()
          return reply(refusal.status, refusal.body, refusal.headers)
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
            const result = tuning.handleTuningPost(Buffer.concat(chunks).toString('utf8'), (text) => writeFileSync(TUNING_FILE, text, 'utf8'))
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

// The Style Lab's Save: POST /__styles/save?theme=<id> writes a built-in theme's style set to
// graph-engine/src/style/theme/builtinStyles/<id>.json. Dev server only, the same origin and media-type
// checks as /__paint/tuning (refuseTuningRequest), a path only styleSetPath allows (a known theme id, never
// a traversal), and a body that parseStyleSet accepts, written back in canonical form.
type StyleSetsModule = typeof import('./src/styles/styleSets')
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

function styleSetSave(): Plugin {
  return {
    name: 'osmosis-style-set-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__styles/save', async (req, res) => {
        const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
          res.end(JSON.stringify(body))
        }
        let tuning: TuningModule
        let sets: StyleSetsModule
        try {
          tuning = (await server.ssrLoadModule('/src/paintLabTuning.ts')) as TuningModule
          sets = (await server.ssrLoadModule('/src/styles/styleSets.ts')) as StyleSetsModule
        } catch (error) {
          req.resume()
          return reply(500, { ok: false, error: `The style-set handler failed to load: ${error instanceof Error ? error.message : String(error)}` })
        }
        const refusal = tuning.refuseTuningRequest(req.method, req.headers)
        if (refusal) {
          req.resume()
          return reply(refusal.status, refusal.body, refusal.headers)
        }
        const theme = new URL(req.url ?? '', 'http://localhost').searchParams.get('theme') ?? ''
        const path = sets.styleSetPath(theme)
        if (!path) {
          req.resume()
          return reply(400, { ok: false, error: `"${theme}" is not a built-in theme (${sets.THEME_IDS.join(', ')}).` })
        }
        const chunks: Buffer[] = []
        let size = 0
        let refused = false
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > TUNING_BODY_LIMIT) {
            if (!refused) reply(413, { ok: false, error: 'That body is far too large to be a style set.' })
            refused = true
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          if (refused) return
          try {
            const parsed = sets.parseStyleSet(Buffer.concat(chunks).toString('utf8'))
            if ('error' in parsed) return reply(400, { ok: false, error: parsed.error })
            writeFileSync(REPO_ROOT + path, sets.serialiseStyleSet(parsed.styles), 'utf8')
            reply(200, { ok: true, path })
          } catch (error) {
            reply(500, { ok: false, error: `The style-set handler failed: ${error instanceof Error ? error.message : String(error)}` })
          }
        })
        req.on('error', () => {
          if (!refused) reply(400, { ok: false, error: 'The request body could not be read.' })
        })
      })
    },
    // Saving rewrites a builtinStyles file the lab imports; do not hot-reload the page under the person who pressed Save.
    hotUpdate({ file }) {
      if (/\/graph-engine\/src\/style\/theme\/builtinStyles\/[a-z0-9-]+\.json$/.test(posix(file))) return []
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [react(), paintTuning(), styleSetSave()],
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
