// Writes docs/styles/{GUIDE,paint,figures,media,backgrounds}.md from docs/styles/sweep.json, overview.md and recipes/*.md.
// Run from graph-engine/: npx tsx tools/build-guide.mts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGuideDocs } from '../src/style/settings/guideDocs.ts'
import type { SweepFile } from '../src/style/settings/sweepTypes.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'styles')
const sweepPath = join(dir, 'sweep.json')
if (!existsSync(sweepPath)) {
  console.error(`build-guide: ${sweepPath} is missing. Run tools/settings-sweep.mts first to write it.`)
  process.exit(1)
}
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const sweep = JSON.parse(read(sweepPath)) as SweepFile
const overview = existsSync(join(dir, 'overview.md')) ? read(join(dir, 'overview.md')) : ''
const recipesDir = join(dir, 'recipes')
const recipes: Record<string, string> = {}
if (existsSync(recipesDir)) for (const name of readdirSync(recipesDir).filter((file) => file.endsWith('.md'))) recipes[name] = read(join(recipesDir, name))

const docs = buildGuideDocs(sweep, recipes, overview)
mkdirSync(dir, { recursive: true })
for (const [name, text] of Object.entries(docs)) writeFileSync(join(dir, name), text, { encoding: 'utf8' })
console.log(`build-guide: wrote ${Object.keys(docs).length} files to ${dir}`)
