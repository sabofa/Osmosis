// Vite config for the parity check: same as web/vite.config.ts but the /api
// proxy target comes from PARITY_API (default http://localhost:8082) so it
// never collides with a real dev backend on 8081.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'vite'

const root = process.env.PARITY_ROOT // absolute path of a web/ directory
const require = createRequire(root + '/package.json')
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default

export default defineConfig({
  root,
  plugins: [react()],
  server: { proxy: { '/api': process.env.PARITY_API ?? 'http://localhost:8082' } },
})
