// Space's import boundaries (K11, SP1), checked by reading the source. Every
// .ts file under src/space/ and src/math/ is scanned for its import
// specifiers (static, re-export and dynamic), resolved against src/.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'space/boundary.test.ts'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

interface Source {
  // relative to src/, with forward slashes
  file: string
  text: string
  // resolved against src/ when relative ("parser/types"), bare otherwise ("three")
  imports: string[]
}

function toSrc(path: string): string {
  return relative(SRC, path).split(sep).join('/')
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g

function read(root: string): Source[] {
  return walk(join(SRC, root)).map((path) => {
    const text = readFileSync(path, 'utf8')
    const imports: string[] = []
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match[1]
      imports.push(spec.startsWith('.') ? toSrc(resolve(dirname(path), spec)).replace(/\.ts$/, '') : spec)
    }
    return { file: toSrc(path), text, imports }
  })
}

const SPACE = read('space')
const MATH = read('math')

function offenders(sources: Source[], bad: (specifier: string) => boolean): string[] {
  return sources.flatMap((s) => s.imports.filter(bad).map((i) => `${s.file} imports ${i}`))
}

describe('space and math import boundaries', () => {
  it('finds the files it checks', () => {
    expect(SPACE.length).toBeGreaterThan(10)
    expect(MATH.length).toBeGreaterThan(5)
    expect(SPACE.find((s) => s.file === 'space/kernel/index.ts')?.imports).toContain('space/kernel/registry')
  })

  it('never imports three, React or anything under figure/', () => {
    const bad = (i: string) => i === 'three' || i.startsWith('three/') || i === 'react' || i.startsWith('react/') || i === 'react-dom' || i.startsWith('figure/')
    expect(offenders([...SPACE, ...MATH], bad)).toEqual([])
  })

  it('math/ imports nothing from space/', () => {
    expect(offenders(MATH, (i) => i.startsWith('space/'))).toEqual([])
  })

  it('space/grammar/ imports only what the server can bundle', () => {
    // The server bundles the parser, which reaches the grammar. Test files are
    // not bundled, so they may also import vitest and what they test with.
    const allowed = (i: string) =>
      ['parser/parseExpr', 'parser/tokenize', 'parser/types', 'parser/grammarUtil', 'space/config', 'space/scene/types'].includes(i) ||
      i.startsWith('math/') ||
      i.startsWith('space/grammar/')
    const grammar = SPACE.filter((s) => s.file.startsWith('space/grammar/') && !s.file.endsWith('.test.ts'))
    expect(grammar.length).toBeGreaterThan(5)
    expect(offenders(grammar, (i) => !allowed(i))).toEqual([])
  })

  it('only space/gl/ touches WebGL', () => {
    const touching = SPACE.filter((s) => s.file !== SELF && !s.file.startsWith('space/gl/'))
      .filter((s) => s.text.includes('WebGL2RenderingContext') || s.text.includes('getContext('))
      .map((s) => s.file)
    expect(touching).toEqual([])
  })

  it('only space/ui/ and space/SpaceRenderer.ts touch the DOM', () => {
    const touching = SPACE.filter((s) => s.file !== SELF && !s.file.startsWith('space/ui/') && s.file !== 'space/SpaceRenderer.ts')
      .filter((s) => /\b(document|window)\./.test(s.text))
      .map((s) => s.file)
    expect(touching).toEqual([])
  })
})
