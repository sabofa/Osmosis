import { describe, expect, it } from 'vitest'
import { namedBy } from './style/importSpecifiers.testkit'

// style/papers/host.ts is the browser half of generated papers (it needs the DOM). The figure renderer, the
// parser and every index.ts (what a page imports to draw a figure) must never reach it: a renderer that
// imported it would break under node and drag canvas code into every bundle.

const SOURCES = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// A specifier named in `file` (a key of the glob, "./figure/x.ts"), as a path from src/.
function resolved(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const parts = file.replace(/^\.\//, '').split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

const isHost = (path: string) => /^style\/papers\/host(\.ts)?$/.test(path)
const guarded = (file: string) => /^\.\/(figure|parser)\//.test(file) || file.endsWith('/index.ts')

function hostReaders(sources: Record<string, string>): string[] {
  return Object.keys(sources)
    .filter(guarded)
    .filter((file) => namedBy(file, sources[file]).some(({ specifier }) => isHost(resolved(file, specifier))))
}

describe('style/papers/host stays out of the renderers', () => {
  it('reads the guarded files', () => {
    const files = Object.keys(SOURCES).filter(guarded)
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('./parser/index.ts')
    expect(files.some((file) => file.startsWith('./figure/'))).toBe(true)
  })

  it('is named by no figure/, parser/ or index.ts file', () => {
    expect(hostReaders(SOURCES)).toEqual([])
  })

  it('would catch a reader', () => {
    expect(hostReaders({ './figure/x.ts': "import { fillPaperTiles } from '../style/papers/host'" })).toEqual(['./figure/x.ts'])
    expect(hostReaders({ './style/papers/index.ts': "export * from './host'" })).toEqual(['./style/papers/index.ts'])
    expect(hostReaders({ './figure/x.ts': "import { x } from '../style/papers/generated'" })).toEqual([])
  })
})
