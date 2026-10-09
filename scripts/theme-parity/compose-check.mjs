// Compose a fixture workspace theme over an ambience builtin with theme-core and print key tokens.
// Usage: node compose-check.mjs <manifest.json> [ambience-id=builtin:forest] [mode=light]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const core = await import(pathToFileURL(resolve(import.meta.dirname, '../../theme-core/dist/index.js')).href)
const [file, amb = 'builtin:forest', mode = 'light'] = process.argv.slice(2)
const ws = JSON.parse(readFileSync(file, 'utf8'))
const { manifest, ignored } = core.compose({ workspace: ws, ambience: core.builtinById(amb) })
const map = core.resolveMode(manifest, mode).tokens
const css = core.toStylesheet(map, mode)
console.log('ignored:', JSON.stringify(ignored))
for (const v of ['--radius-md', '--corner-shape', '--font-body', '--color-accent']) {
  const m = css.match(new RegExp(v + ':([^;}]*)'))
  console.log(v, '=', m ? m[1] : '(absent)')
}
