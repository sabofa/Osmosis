import { describe, expect, it } from 'vitest'
import { namedBy } from './style/importSpecifiers.testkit'

// The prose of the settings registry stays out of the renderers.
//
// The registry (style/settings/registry.ts) is the table of every setting, and the 2D figure
// renderer, the parser and the stack read it. What each setting MEANS (style/settings/meanings/*.ts,
// about 86 KB minified) is joined to the table only in style/settings/guide.ts, for the settings guide,
// the Style Lab and the tests. If a renderer imported the meanings, the prose would be in the bundle
// of every page that draws a figure. So, over every source of the engine, the scripts and the labs:
//
//   meanings/   only the guide, the meanings among themselves, and the tests read them;
//   guide.ts    inside graph-engine/src only the tests read it (its other readers, the generator and
//               the Style Lab, live outside src/, in tools/ and review/);
//   and, followed from the figure renderer, the parser, the stack and the registry, neither is reached.
//
// It lives here and not under style/, because it reads every source (as text, not as code), and
// style/boundary.test.ts holds that nothing under style/ can reach space/.

// Every source of the engine, the review labs and the scripts, keyed by its path from the repository
// root ("graph-engine/src/style/layers.ts"). The globs are relative to this folder.
const RAW = {
  ...import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../scripts/**/*.{ts,tsx,mts}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../review/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

const HERE = 'graph-engine/src'

// A path as a list of folders, "a/b/../c" -> "a/c".
function normalise(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

const SOURCES: Record<string, string> = Object.fromEntries(Object.entries(RAW).map(([key, source]) => [normalise(`${HERE}/${key}`), source]))

const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const MEANINGS = /(^|\/)style\/settings\/meanings(\/|$)/
const GUIDE_MODULE = /(^|\/)style\/settings\/guide(\.ts)?$/
// The one module of src/ besides the tests that may read the guide: it writes the guide's markdown and nothing renders from it.
const GUIDE_WRITER = 'graph-engine/src/style/settings/guideDocs.ts'

// The modules a source names, as paths from the repository root (a specifier that is not relative stays as it is).
function reachedBy(path: string, source: string): string[] {
  const dir = path.split('/').slice(0, -1).join('/')
  return namedBy(path, source)
    .filter((named) => named.kind !== 'computed')
    .map((named) => (named.specifier.startsWith('.') ? normalise(`${dir}/${named.specifier}`) : named.specifier))
}

// What a source breaks: reading the prose, or the guide, where it must not.
//   meanings/   only the guide (settings/guide.ts), the meanings themselves, and the tests;
//   guide.ts    inside graph-engine/src only the tests: the guide's other readers (the generator and
//               the Style Lab) live outside src/, in tools/ and review/.
function violationsOf(path: string, source: string): string[] {
  const out: string[] = []
  const inMeanings = MEANINGS.test(path)
  const isGuide = GUIDE_MODULE.test(path)
  const inEngine = path.startsWith('graph-engine/src/')
  // Cheap first: a source that never says either word cannot name them.
  if (!/meanings|guide/.test(source)) return out
  for (const target of reachedBy(path, source)) {
    if (MEANINGS.test(target) && !isGuide && !inMeanings && !isTest(path)) out.push(`${path} reads '${target}': only settings/guide.ts and tests may read the meanings`)
    if (GUIDE_MODULE.test(target) && inEngine && !isTest(path) && path !== GUIDE_WRITER) out.push(`${path} reads '${target}': in src/ only tests may read settings/guide.ts`)
  }
  return out
}

describe('the prose stays out of the renderers', () => {
  const paths = Object.keys(SOURCES)

  it('reads the engine, the scripts and the labs', () => {
    expect(paths.length).toBeGreaterThan(600)
    expect(paths).toContain('graph-engine/src/style/settings/guide.ts')
    expect(paths).toContain('graph-engine/src/style/settings/meanings/paint.ts')
    expect(paths).toContain('graph-engine/src/figure/render.ts')
    expect(paths).toContain('graph-engine/scripts/contact-sheet.ts')
    expect(paths).toContain('review/src/styleLab.tsx')
  })

  it('has the guide read the meanings, and nothing else in src/ but tests', () => {
    expect(reachedBy('graph-engine/src/style/settings/guide.ts', SOURCES['graph-engine/src/style/settings/guide.ts']).filter((path) => MEANINGS.test(path)).sort()).toEqual([
      'graph-engine/src/style/settings/meanings/boards',
      'graph-engine/src/style/settings/meanings/media',
      'graph-engine/src/style/settings/meanings/paint',
      'graph-engine/src/style/settings/meanings/style',
    ])
    const readers = paths.filter((path) => reachedBy(path, SOURCES[path]).some((target) => MEANINGS.test(target)))
    expect(readers.filter((path) => !isTest(path) && !MEANINGS.test(path)).sort()).toEqual(['graph-engine/src/style/settings/guide.ts'])
  })

  it('has no file that reads the meanings or the guide where it must not', () => {
    expect(paths.flatMap((path) => violationsOf(path, SOURCES[path]))).toEqual([])
  })

  // The same thing the other way round, and what the bundle depends on: follow every import from the
  // figure renderer, the parser, the stack and the registry, and the prose is never reached.
  it('never reaches the meanings or the guide from the figure renderer, the parser, the stack or the registry', () => {
    const ENTRIES = [
      'graph-engine/src/figure/render.ts',
      'graph-engine/src/parser/parseSpec.ts',
      'graph-engine/src/parser/parseConfig.ts',
      'graph-engine/src/style/layers.ts',
      'graph-engine/src/style/resolve.ts',
      'graph-engine/src/style/settings/registry.ts',
      'graph-engine/src/style/settings/values.ts',
      'graph-engine/src/style/settings/paintParams.ts',
      'graph-engine/src/style/theme/adapter.ts',
    ]
    const resolveFile = (target: string): string | undefined =>
      [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find((candidate) => SOURCES[candidate] !== undefined)

    const seen = new Set<string>()
    const queue = [...ENTRIES]
    const reached: string[] = []
    while (queue.length > 0) {
      const path = queue.pop()!
      if (seen.has(path)) continue
      seen.add(path)
      expect(SOURCES[path], `entry or import ${path} was not read`).toBeDefined()
      for (const target of reachedBy(path, SOURCES[path])) {
        const file = resolveFile(target)
        if (file === undefined) continue
        reached.push(file)
        queue.push(file)
      }
    }
    // The walk is real: it gets to the registry, the painter's defaults and the media.
    for (const expected of ['graph-engine/src/style/settings/registry.ts', 'graph-engine/src/space/paint/params.ts', 'graph-engine/src/style/media/index.ts', 'graph-engine/src/style/settings/units.ts']) {
      expect(seen.has(expected), expected).toBe(true)
    }
    expect([...seen].filter((path) => MEANINGS.test(path) || GUIDE_MODULE.test(path))).toEqual([])
  })
})

// The checker itself, on sources written out here, so that a green test above means something.
describe('the prose guard catches a stray reader', () => {
  const read = (specifier: string) => `import { STYLE_MEANINGS } from '${specifier}'\nexport const x = STYLE_MEANINGS\n`

  it('refuses the meanings in a module of the engine, whatever the spelling', () => {
    for (const source of [
      read('./meanings/style'),
      read('./meanings/style.ts'),
      "export { STYLE_MEANINGS } from './meanings/style'",
      "const lazy = import('./meanings/style')",
      'const lazy = import(`./meanings/style`)',
      "const lazy = require('./meanings/style')",
      "type T = typeof import('./meanings/style')",
    ]) {
      expect(violationsOf('graph-engine/src/style/settings/registry.ts', source), source).toHaveLength(1)
    }
    expect(violationsOf('graph-engine/src/style/layers.ts', read('./settings/meanings/style'))).toHaveLength(1)
    expect(violationsOf('graph-engine/src/figure/render.ts', read('../style/settings/meanings/paint'))).toHaveLength(1)
    expect(violationsOf('review/src/styleLab.tsx', read('../../graph-engine/src/style/settings/meanings/paint'))).toHaveLength(1)
  })

  it('refuses the guide in a module of src/ that is not a test, and lets the labs and the scripts read it', () => {
    expect(violationsOf('graph-engine/src/style/layers.ts', "import { GUIDE } from './settings/guide'")).toHaveLength(1)
    expect(violationsOf('graph-engine/src/figure/render.ts', "const lazy = import('../style/settings/guide')")).toHaveLength(1)
    expect(violationsOf('review/src/styles/guide.tsx', "import { GUIDE } from '../../../graph-engine/src/style/settings/guide'")).toEqual([])
    expect(violationsOf('graph-engine/tools/build-guide.mts', "import { GUIDE } from '../src/style/settings/guide'")).toEqual([])
  })

  it('lets the guide writer read the guide, and no other module of src/', () => {
    expect(violationsOf(GUIDE_WRITER, "import { GUIDE } from './guide'")).toEqual([])
    expect(violationsOf('graph-engine/src/style/settings/guideOther.ts', "import { GUIDE } from './guide'")).toHaveLength(1)
  })

  it('lets the guide, the meanings among themselves and the tests read them', () => {
    expect(violationsOf('graph-engine/src/style/settings/guide.ts', read('./meanings/style'))).toEqual([])
    expect(violationsOf('graph-engine/src/style/settings/meanings/paint.ts', "import { ROLE_MEANINGS } from './paintTemplates'")).toEqual([])
    expect(violationsOf('graph-engine/src/style/settings/registry.test.ts', "import { GUIDE } from './guide'")).toEqual([])
    expect(violationsOf('graph-engine/src/style/settings/registry.test.ts', read('./meanings/style'))).toEqual([])
  })

  it('does not mistake a comment, a string or a look-alike name for a reader', () => {
    expect(violationsOf('graph-engine/src/style/layers.ts', "// import { x } from './settings/meanings/style'\n")).toEqual([])
    expect(violationsOf('graph-engine/src/style/layers.ts', "const path = './settings/meanings/style'\nconst note = 'guide'\n")).toEqual([])
    expect(violationsOf('graph-engine/src/style/layers.ts', "import { x } from './settings/meaningful'\nimport { y } from './guidelines'\n")).toEqual([])
  })
})
