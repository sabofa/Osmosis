import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDE, guideAt } from './guide'
import { buildGuideDocs, GUIDE_PAGES } from './guideDocs'
import type { SweepFile } from './sweepTypes'
import { REGISTRY, settingAt } from './registry'
import { UNITS } from './units'

// ---------------------------------------------------------------------------
// The guide is the table plus the prose
// ---------------------------------------------------------------------------

describe('the guide is the registry with its prose', () => {
  it('has one entry per registry setting, in the registry’s order', () => {
    expect(GUIDE.map((entry) => entry.path)).toEqual(REGISTRY.map((spec) => spec.path))
  })

  it('carries every table field of the setting as the registry has it', () => {
    for (const spec of REGISTRY) {
      const entry = guideAt(spec.path)!
      const { meaning, interactions, ...table } = entry
      expect(typeof meaning, spec.path).toBe('string')
      expect(Array.isArray(interactions), spec.path).toBe(true)
      expect(table, spec.path).toEqual(spec)
    }
  })

  it('finds nothing for a path that is not a setting', () => {
    for (const path of ['', 'paint', 'paint.value', 'paint.value.nope', 'toString', '__proto__']) expect(guideAt(path), path).toBeUndefined()
  })

  it('leaves the table without prose: the registry’s specs have no meaning and no interactions', () => {
    for (const spec of REGISTRY) {
      expect('meaning' in spec, spec.path).toBe(false)
      expect('interactions' in spec, spec.path).toBe(false)
    }
    expect(settingAt('style.line.looseness')).not.toHaveProperty('meaning')
  })

  it('does not freeze or change a spec of the registry when it copies it', () => {
    for (const spec of REGISTRY) {
      expect(guideAt(spec.path), spec.path).not.toBe(spec)
      expect(Object.isFrozen(spec), spec.path).toBe(true)
    }
  })

  it('has every unit in the table, and the guide’s entry says the same', () => {
    expect(Object.keys(UNITS)).toHaveLength(69)
    for (const spec of REGISTRY) {
      expect(spec.unit, spec.path).toBe(UNITS[spec.path])
      expect(guideAt(spec.path)!.unit, spec.path).toBe(UNITS[spec.path])
    }
  })
})

// ---------------------------------------------------------------------------
// The guide as markdown (guideDocs.ts)
// ---------------------------------------------------------------------------

const lf = (text: string): string => text.replace(/\r\n/g, '\n')
const RECIPES = { 'b.md': '### B\r\nsecond', 'a.md': '### A\nfirst' }
const OVERVIEW = '# Overview\n\nverbatim text'

function fixtureSweep(): SweepFile {
  const first = GUIDE[0].path
  const paint = GUIDE.find((entry) => entry.path.startsWith('paint.'))!.path
  return {
    header: { fixtures: {}, themes: [], steps: 9, note: 'fixture' },
    entries: [
      { path: first, engine: 'figures', measure: 'geometry', values: [0, 1, 2, 3, 4], change: [0, 1, 2, 3, 4], rating: 'strong', activeRange: [1, 3], saturates: false, detail: {} },
      { path: paint, engine: 'paint', measure: 'colour', values: [0, 1], change: [0, 0], rating: 'not-drawn-yet', activeRange: null, saturates: false, detail: {} },
    ],
  }
}

describe('buildGuideDocs', () => {
  const docs = buildGuideDocs(fixtureSweep(), RECIPES, OVERVIEW)
  const line = (page: string, path: string) => docs[page].split('\n').find((l) => l.startsWith(`| \`${path}\` |`))!

  it('is deterministic and uses LF only', () => {
    expect(buildGuideDocs(fixtureSweep(), RECIPES, OVERVIEW)).toEqual(docs)
    expect(Object.keys(docs).sort()).toEqual(['GUIDE.md', 'backgrounds.md', 'figures.md', 'media.md', 'paint.md'])
    for (const text of Object.values(docs)) expect(text).not.toContain('\r')
  })

  it('puts every GUIDE path in exactly one engine page', () => {
    for (const entry of GUIDE) {
      const on = GUIDE_PAGES.filter((page) => docs[page].split('\n').some((l) => l.startsWith(`| \`${entry.path}\` |`)))
      expect(on, entry.path).toHaveLength(1)
    }
    expect(docs['paint.md']).not.toMatch(/\| `(style|media|board)\./)
    expect(docs['figures.md']).not.toContain('| `style.paper.')
    expect(docs['backgrounds.md']).toMatch(/\| `board\./)
  })

  it('escapes | and newlines in a cell, so every row has 11 cells', () => {
    for (const page of GUIDE_PAGES) {
      for (const row of docs[page].split('\n').filter((l) => l.startsWith('| `'))) expect(row.replace(/\x5c\x7c/g, '').split('|'), row).toHaveLength(13)
    }
  })

  it('shows "not drawn yet", and dashes where there is no sweep entry', () => {
    const paint = GUIDE.find((entry) => entry.path.startsWith('paint.'))!.path
    expect(line('paint.md', paint)).toContain('| not drawn yet | — | — |')
    expect(line('figures.md', GUIDE[0].path)).toContain('| strong | 1 to 3 | 0 to 4 |')
    const other = GUIDE.find((entry) => entry.path.startsWith('media.'))!.path
    expect(line('media.md', other)).toContain('| — | — | — |')
  })

  it('says the paint ratings are per-frame', () => {
    expect(docs['paint.md']).toContain('Ratings are measured on the per-frame painter; see each meaning for bake differences.')
  })

  it('writes the overview verbatim, the page index with counts, then the recipes sorted by filename', () => {
    const guide = docs['GUIDE.md']
    expect(guide.startsWith('# Overview\n\nverbatim text\n')).toBe(true)
    expect(guide).toContain(`(paint.md): ${GUIDE.filter((e) => e.path.startsWith('paint.')).length} settings`)
    expect(guide.indexOf('## Recipes')).toBeGreaterThan(guide.indexOf('## Engine pages'))
    expect(guide.indexOf('### A\nfirst')).toBeGreaterThan(guide.indexOf('## Recipes'))
    expect(guide.indexOf('### B\nsecond')).toBeGreaterThan(guide.indexOf('### A\nfirst'))
  })
})

describe('the committed guide has not drifted from the registry', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'styles')
  const read = (path: string): string => lf(readFileSync(path, 'utf8'))

  it.skipIf(!existsSync(join(dir, 'sweep.json')))('is what the builder writes from the committed sweep, overview and recipes', () => {
    const sweep = JSON.parse(read(join(dir, 'sweep.json'))) as SweepFile
    const recipesDir = join(dir, 'recipes')
    const recipes: Record<string, string> = {}
    if (existsSync(recipesDir)) for (const name of readdirSync(recipesDir).filter((file) => file.endsWith('.md'))) recipes[name] = read(join(recipesDir, name))
    const overview = existsSync(join(dir, 'overview.md')) ? read(join(dir, 'overview.md')) : ''
    for (const [name, text] of Object.entries(buildGuideDocs(sweep, recipes, overview))) expect(read(join(dir, name)), name).toBe(text)
  })
})
