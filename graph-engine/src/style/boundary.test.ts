import { describe, expect, it } from 'vitest'

// The import boundary of style/ (geometry's sign-off, 2026-10-04).
//
// The line, fill, paper and media modules of style/ must stay portable to the 2D
// engines (the graphing engine, the figure renderer), which have no space code.
// So, by reading the import specifiers of every file under style/:
//
//   - no file under style/ imports anything from space/, except the files under
//     style/settings/**;
//   - the files under style/settings/** import only space/paint/params (the painter's
//     parameters, a plain data module: the registry reads its schema and defaults),
//     and nothing else from space/.
//
// This test file is not scanned: the sources it checks itself against are written
// out below.

const SOURCES = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// Comments may name what they forbid; code may not.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

// Every module specifier a file names: "from '...'" (imports, type imports and
// re-exports, across lines), "import '...'" and "import('...')".
function specifiersOf(source: string): string[] {
  const text = code(source)
  const found: string[] = []
  for (const pattern of [/\bfrom\s*['"]([^'"\n]+)['"]/g, /\bimport\s*['"]([^'"\n]+)['"]/g, /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[1])
  }
  return found
}

// A relative specifier resolved against the file that wrote it, as a path from style/
// ("../space/paint/params"). A specifier that is not relative is returned as it is.
function resolved(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const parts = file.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..' && parts[parts.length - 1] !== '.') parts.pop()
      else parts.push('..')
    } else parts.push(part)
  }
  // The glob's keys start with "./", which is style/ itself.
  return parts.filter((part, index) => !(part === '.' && index === 0 && parts.length > 1)).join('/')
}

// The path a specifier reaches in space/, or null when it reaches elsewhere. A relative one is
// resolved from the file's folder, and space/ is "../space" from style/ (src/space); a style/
// folder that happens to be called space would resolve to "space/..." and is not it. A
// specifier that is not relative (an alias, a package) is in space when it has a space/ segment.
function spaceTarget(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const target = resolved(file, specifier)
    return /^\.\.\/space(\/|$)/.test(target) ? target : null
  }
  return /(^|\/)space(\/|$)/.test(specifier) ? specifier : null
}
const insideSettings = (file: string) => file.startsWith('./settings/')
const PAINT_PARAMS = /^\.\.\/space\/paint\/params(\.ts)?$/

// What a source breaks, as one line each. `file` is its key in the glob ("./media/clean.ts").
function violationsOf(file: string, source: string): string[] {
  const out: string[] = []
  for (const specifier of specifiersOf(source)) {
    const target = spaceTarget(file, specifier)
    if (target === null) continue
    if (!insideSettings(file)) out.push(`${file} imports '${specifier}': only style/settings/** may import from space/`)
    else if (!PAINT_PARAMS.test(target)) out.push(`${file} imports '${specifier}': style/settings/** may import only space/paint/params from space/`)
  }
  return out
}

describe('style/ imports nothing from space/ but the settings, and they only space/paint/params', () => {
  const files = Object.keys(SOURCES).filter((path) => path !== './boundary.test.ts')

  it('reads the whole of style/, tests included, and sees the registry reach for the painter', () => {
    expect(files.length).toBeGreaterThan(60)
    expect(files).toContain('./media/clean.ts')
    expect(files).toContain('./settings/registry.ts')
    expect(files).toContain('./layers.ts')
    const registry = specifiersOf(SOURCES['./settings/registry.ts']).map((specifier) => resolved('./settings/registry.ts', specifier))
    expect(registry).toContain('../space/paint/params')
  })

  it('has no file that breaks the boundary', () => {
    const violations = files.flatMap((file) => violationsOf(file, SOURCES[file]))
    expect(violations).toEqual([])
  })

  it('keeps the painter behind settings/ (layers.ts re-exports toPaintParams, which lives there)', () => {
    expect(specifiersOf(SOURCES['./layers.ts'])).toContain('./settings/paintParams')
    expect(specifiersOf(SOURCES['./settings/paintParams.ts']).map((specifier) => resolved('./settings/paintParams.ts', specifier))).toContain('../space/paint/params')
  })
})

// The checker itself, on sources written out here: it refuses what it should and passes
// what it should, so a green boundary test above means something.
describe('the boundary check catches a stray import', () => {
  const stray = (specifier: string) => `import { thing } from '${specifier}'\nexport const x = thing\n`

  it('refuses a space/ import in a media module, whatever its spelling', () => {
    for (const source of [
      stray('../../space/paint/params'),
      stray('../../space/oklab'),
      "import type { Vec3 } from '../../space/vec'",
      "export { oklab } from '../../space/oklab'",
      "import '../../space/gl/backend'",
      "const lazy = import('../../space/oklab')",
      "import {\n  a,\n  b,\n} from '../../space/oklab'",
    ]) {
      expect(violationsOf('./media/clean.ts', source), source).toHaveLength(1)
    }
    // The path is resolved from the file's folder: the same specifier means something else elsewhere.
    expect(violationsOf('./clean.ts', stray('../space/oklab'))).toHaveLength(1)
    expect(violationsOf('./lines/pencil.ts', stray('../../space/oklab'))).toHaveLength(1)
    expect(violationsOf('./media/clean.ts', stray('../space/oklab'))).toEqual([]) // style/space/, not src/space/
    expect(violationsOf('./media/clean.ts', stray('../../../space/oklab'))).toEqual([]) // above src/
    // A specifier that is not relative is in space when it has a space/ segment.
    expect(violationsOf('./media/clean.ts', stray('@/space/oklab'))).toHaveLength(1)
    expect(violationsOf('./settings/registry.ts', stray('space/paint/params'))).toHaveLength(1)
  })

  it('refuses a space/ import in the files at the top of style/ as well', () => {
    expect(violationsOf('./layers.ts', stray('../space/paint/params'))).toHaveLength(1)
    expect(violationsOf('./resolve.ts', stray('../space/paint/params'))).toHaveLength(1)
    expect(violationsOf('./fills/fills.test.ts', stray('../../space/paint/params'))).toHaveLength(1)
  })

  it('lets the settings import space/paint/params, and nothing else from space/', () => {
    expect(violationsOf('./settings/registry.ts', stray('../../space/paint/params'))).toEqual([])
    expect(violationsOf('./settings/meanings/paintTemplates.ts', stray('../../../space/paint/params'))).toEqual([])
    expect(violationsOf('./settings/registry.ts', stray('../../space/paint/params.ts'))).toEqual([])
    expect(violationsOf('./settings/registry.ts', stray('../../space/paint/curves'))).toHaveLength(1)
    expect(violationsOf('./settings/registry.ts', stray('../../space/oklab'))).toHaveLength(1)
    expect(violationsOf('./settings/meanings/paint.ts', stray('../../../space/paint/model/roles'))).toHaveLength(1)
  })

  it('does not mistake style/ names or comments for space/ imports', () => {
    expect(violationsOf('./media/clean.ts', "import { x } from '../spacing'\nimport { y } from './space'\n")).toEqual([])
    expect(violationsOf('./media/clean.ts', "// import { x } from '../../space/oklab'\n/* from '../../space/oklab' */\n")).toEqual([])
    expect(violationsOf('./media/clean.ts', "import { x } from '../color'\n")).toEqual([])
  })
})
