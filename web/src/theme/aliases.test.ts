/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { TOKENS, ALIASES } from 'theme-core'

const SRC = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p)
  }
  return out
}

const ALLOW_LIST: readonly string[] = []
const KNOWN_UNDEFINED: readonly string[] = []

const files = walk(SRC)
const refs = new Map<string, string[]>() // name -> "file:line"
const defined = new Set<string>()
for (const f of files) {
  // Comments mention names without using them; blank them out but keep line numbers.
  const blank = (c: string) => c.replace(/[^\n]/g, ' ')
  let text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, blank)
  if (!f.endsWith('.css')) text = text.replace(/^[ \t]*\/\/.*$/gm, blank)
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
      const list = refs.get(m[1]!) ?? []
      list.push(`${relative(SRC, f).split(sep).join('/')}:${i + 1}`)
      refs.set(m[1]!, list)
    }
    for (const m of line.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]!)
  })
}

const tokenNames = new Set(TOKENS.map((t) => `--${t.name}`))
const aliasNames = new Set(Object.keys(ALIASES))

describe('custom property coverage', () => {
  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('keeps the 8 legacy names as aliases of registry tokens', () => {
    for (const n of ['--bg', '--surface', '--ink', '--muted', '--line', '--line-strong', '--accent', '--accent-wash']) {
      expect(ALIASES[n], n).toBeDefined()
      expect(tokenNames.has(`--${ALIASES[n]}`), n).toBe(true)
    }
  })

  it('every alias target is a registry token', () => {
    for (const [a, t] of Object.entries(ALIASES)) expect(tokenNames.has(`--${t}`), a).toBe(true)
  })

  it('every var(--x) is a token, an alias, allow-listed, or known-undefined', () => {
    const ok = new Set([...tokenNames, ...aliasNames, ...ALLOW_LIST, ...KNOWN_UNDEFINED])
    const bad = [...refs].filter(([n]) => !ok.has(n)).map(([n, w]) => `${n} @ ${w[0]}`)
    expect(bad).toEqual([])
  })

  it('allow-listed names are really defined locally and not tokens/aliases', () => {
    for (const n of ALLOW_LIST) {
      expect(defined.has(n), n).toBe(true)
      expect(tokenNames.has(n) || aliasNames.has(n), n).toBe(false)
    }
  })

  it('known-undefined names are still referenced and still undefined', () => {
    for (const n of KNOWN_UNDEFINED) {
      expect(refs.has(n), `${n} no longer referenced: remove it`).toBe(true)
      expect(defined.has(n), `${n} now defined: remove it`).toBe(false)
    }
  })
})
