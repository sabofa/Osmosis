import { describe, expect, it } from 'vitest'
import { fromSrc, globRoot, namedBy } from './importSpecifiers.testkit'

// The import boundary of style/ (geometry's sign-off, 2026-10-04).
//
// The line, fill, paper and media modules of style/ must stay portable to the 2D
// engines (the graphing engine, the figure renderer), which have no space code.
// So, by reading every module each file under style/ names (importSpecifiers.testkit.ts
// reads the file as TypeScript, so every way of naming a module is seen):
//
//   - no file under style/ names anything from space/, except the files under
//     style/settings/**;
//   - the files under style/settings/** name only space/paint/params (the painter's
//     parameters, a plain data module: the registry reads its schema and defaults),
//     and nothing else from space/.
//
// A module a file names counts when it is imported, re-exported, required, imported
// dynamically (a string or a template literal) or imported as a type, and so does a
// pattern given to import.meta.glob that can reach space/. A module named by a
// computed specifier cannot be checked, so it is refused. (Not seen: a pattern that
// climbs out of its folder after a wildcard is refused for climbing; a path built at
// run time and read with fs, or with new URL(..., import.meta.url), is not an import.)
//
// This test file is not scanned: the sources it checks itself against are written
// out below.

const SOURCES = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const insideSettings = (file: string) => file.startsWith('./settings/')
const PAINT_PARAMS = /^space\/paint\/params(\.ts)?$/

// What a source breaks, as one line each. `file` is its key in the glob ("./media/clean.ts").
function violationsOf(file: string, source: string): string[] {
  const out: string[] = []
  for (const { specifier, kind } of namedBy(file, source)) {
    if (kind === 'computed') {
      out.push(`${file} names a module with a computed specifier (${specifier}): it cannot be checked, so name it with a string`)
      continue
    }
    if (kind === 'glob') {
      if (specifier.startsWith('!')) continue // a pattern that leaves files out
      const root = specifier.startsWith('.') ? fromSrc(file, globRoot(specifier)) : specifier
      const segments = root.split('/').filter(Boolean)
      const reaches = specifier.startsWith('.')
        ? segments[0] === 'space' || segments.every((segment) => segment === '..')
        : /(^|\/)space(\/|$)/.test(specifier)
      const climbs = specifier.startsWith('.') && specifier.slice(globRoot(specifier).length).includes('..')
      if (specifier === '') out.push(`${file} globs a pattern with no fixed start, which can reach space/`)
      else if (climbs) out.push(`${file} globs '${specifier}', which climbs out of its folder after a wildcard, so it can reach space/`)
      else if (reaches) out.push(`${file} globs '${specifier}', which can reach space/`)
      continue
    }
    const target = fromSrc(file, specifier)
    const relative = specifier.startsWith('.')
    const inSpace = relative ? target === 'space' || target.startsWith('space/') : /(^|\/)space(\/|$)/.test(specifier)
    if (!inSpace) continue
    if (!insideSettings(file)) out.push(`${file} imports '${specifier}': only style/settings/** may import from space/`)
    else if (!relative || !PAINT_PARAMS.test(target)) out.push(`${file} imports '${specifier}': style/settings/** may import only space/paint/params from space/`)
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
    const registry = namedBy('./settings/registry.ts', SOURCES['./settings/registry.ts']).map(({ specifier }) => fromSrc('./settings/registry.ts', specifier))
    expect(registry).toContain('space/paint/params')
  })

  it('has no file that breaks the boundary', () => {
    const violations = files.flatMap((file) => violationsOf(file, SOURCES[file]))
    expect(violations).toEqual([])
  })

  it('keeps the painter behind settings/ (layers.ts re-exports toPaintParams, which lives there)', () => {
    expect(namedBy('./layers.ts', SOURCES['./layers.ts']).map((n) => n.specifier)).toContain('./settings/paintParams')
    const params = namedBy('./settings/paintParams.ts', SOURCES['./settings/paintParams.ts']).map(({ specifier }) => fromSrc('./settings/paintParams.ts', specifier))
    expect(params).toContain('space/paint/params')
  })
})

// The checker itself, on sources written out here: it refuses what it should and passes
// what it should, so a green boundary test above means something.
describe('the boundary check catches a stray import', () => {
  const stray = (specifier: string) => `import { thing } from '${specifier}'\nexport const x = thing\n`
  const refused = (file: string, source: string, count = 1) => expect(violationsOf(file, source), source).toHaveLength(count)

  it('refuses a space/ import in a media module, whatever its spelling', () => {
    for (const source of [
      stray('../../space/paint/params'),
      stray('../../space/oklab'),
      "import type { Vec3 } from '../../space/vec'",
      "export { oklab } from '../../space/oklab'",
      "export * from '../../space/oklab'",
      "import '../../space/gl/backend'",
      "import {\n  a,\n  b,\n} from '../../space/oklab'",
      "const lazy = import('../../space/oklab')",
      'const lazy = import(`../../space/oklab`)',
      "const lazy = require('../../space/oklab')",
      'const lazy = require(`../../space/oklab`)',
      "import oklab = require('../../space/oklab')",
      "type T = typeof import('../../space/oklab')",
      "type U = import('../../space/oklab').Oklab",
    ]) {
      refused('./media/clean.ts', source)
    }
  })

  it('refuses a space/ pattern given to import.meta.glob, in each of its forms', () => {
    for (const source of [
      "const all = import.meta.glob('../../space/**/*.ts')",
      "const all = import.meta.glob(`../../space/**/*.ts`)",
      "const all = import.meta.glob('../../space/paint/params.ts', { eager: true })",
      "const all = import.meta.glob(['./*.ts', '../../space/**/*.ts'])",
      "const all = import.meta.glob('../../space/**/*.ts', { query: '?raw', import: 'default', eager: true })",
      "const all = import.meta.globEager('../../space/**/*.ts')",
      "const all = import.meta.glob('../../**/*.ts')",
      "const all = import.meta.glob('/src/space/**/*.ts')",
    ]) {
      refused('./media/clean.ts', source)
    }
    // A pattern from the top of style/ that can reach space/ by its root alone.
    refused('./layers.ts', "const all = import.meta.glob('../**/*.ts')")
    refused('./layers.ts', "const all = import.meta.glob('../space/**/*.ts')")
    // One that climbs after a wildcard or a brace.
    refused('./layers.ts', "const all = import.meta.glob('./**/../space/*.ts')")
    refused('./layers.ts', "const all = import.meta.glob('./{a,../space}/*.ts')")
    // One with no fixed start.
    refused('./layers.ts', 'const all = import.meta.glob(`${root}/*.ts`)')
  })

  it('passes the patterns that stay in style/ or go to a neighbour that is not space/', () => {
    for (const source of [
      "const all = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true })",
      "const all = import.meta.glob('./**/*.{ts,tsx}')",
      "const all = import.meta.glob('./media/*.ts')",
      "const all = import.meta.glob('../figure/**/*.ts')",
      "const all = import.meta.glob(['./**/*.ts', '../figure/**/*.ts'])",
      "const all = import.meta.glob(['./**/*.ts', '!./settings/**'])",
    ]) {
      expect(violationsOf('./layers.ts', source), source).toEqual([])
    }
    expect(violationsOf('./media/clean.ts', "const all = import.meta.glob('./*.ts')")).toEqual([])
  })

  it('is not fooled by a string or a comment that looks like the other kind', () => {
    // A "//" in a string does not start a comment, so the import after it on the same line is read...
    refused('./media/clean.ts', "const site = 'https://example.org'; import { thing } from '../../space/oklab'\n")
    refused('./media/clean.ts', "const re = /\\/\\//; const site = \"//\"; const lazy = import('../../space/oklab')\n")
    // ...and a "/*" in a string does not open a comment that swallows the code up to the next "*/".
    refused('./media/clean.ts', "const open = '/*'\nimport { thing } from '../../space/oklab'\n/* a comment */\n")
    refused('./media/clean.ts', "const open = `/*`\nconst close = '*/'\nimport { thing } from '../../space/oklab'\n")
    // A comment, and a string that only names a path, is not an import.
    expect(violationsOf('./media/clean.ts', "// import { x } from '../../space/oklab'\n/* from '../../space/oklab' */\n")).toEqual([])
    expect(violationsOf('./media/clean.ts', "const path = '../../space/oklab'\nconst text = \"import x from '../../space/oklab'\"\n")).toEqual([])
    expect(violationsOf('./media/clean.ts', 'const text = `import(\'../../space/oklab\')`\n')).toEqual([])
  })

  it('refuses a space/ import in the files at the top of style/ as well', () => {
    refused('./layers.ts', stray('../space/paint/params'))
    refused('./resolve.ts', stray('../space/paint/params'))
    refused('./fills/fills.test.ts', stray('../../space/paint/params'))
    refused('./lines/pencil.ts', stray('../../space/oklab'))
  })

  it('resolves a specifier from the folder of the file that wrote it', () => {
    refused('./clean.ts', stray('../space/oklab'))
    expect(violationsOf('./media/clean.ts', stray('../space/oklab'))).toEqual([]) // style/space/, not src/space/
    expect(violationsOf('./media/clean.ts', stray('../../../space/oklab'))).toEqual([]) // above src/
    expect(violationsOf('./media/clean.ts', stray('../spacing'))).toEqual([])
    expect(violationsOf('./media/clean.ts', stray('./space'))).toEqual([])
    expect(violationsOf('./media/clean.ts', stray('../color'))).toEqual([])
    // A specifier that is not relative is in space when it has a space/ segment.
    refused('./media/clean.ts', stray('@/space/oklab'))
    refused('./settings/registry.ts', stray('space/paint/params'))
  })

  it('refuses a module named by a computed specifier, which cannot be checked', () => {
    refused('./media/clean.ts', 'const lazy = import(path)\n')
    refused('./media/clean.ts', "const lazy = import('../../' + name)\n")
    refused('./media/clean.ts', 'const lazy = require(path)\n')
    refused('./media/clean.ts', 'const all = import.meta.glob(pattern)\n')
    // A template with a fixed start is read for where it can reach.
    refused('./media/clean.ts', 'const lazy = import(`../../space/${name}`)\n')
    expect(violationsOf('./media/clean.ts', 'const lazy = import(`./inks/${name}`)\n')).toEqual([])
  })

  it('lets the settings import space/paint/params, and nothing else from space/', () => {
    expect(violationsOf('./settings/registry.ts', stray('../../space/paint/params'))).toEqual([])
    expect(violationsOf('./settings/meanings/paintTemplates.ts', stray('../../../space/paint/params'))).toEqual([])
    expect(violationsOf('./settings/registry.ts', stray('../../space/paint/params.ts'))).toEqual([])
    expect(violationsOf('./settings/registry.ts', "import type { PaintParams } from '../../space/paint/params'")).toEqual([])
    refused('./settings/registry.ts', stray('../../space/paint/curves'))
    refused('./settings/registry.ts', stray('../../space/oklab'))
    refused('./settings/registry.ts', "const lazy = import('../../space/paint/curves')")
    refused('./settings/registry.ts', 'const lazy = import(`../../space/paint/curves`)')
    refused('./settings/registry.ts', "const all = import.meta.glob('../../space/paint/*.ts')")
    refused('./settings/meanings/paint.ts', stray('../../../space/paint/model/roles'))
    refused('./settings/meanings/paint.ts', stray('../../../space/paint/params/more'))
  })
})
