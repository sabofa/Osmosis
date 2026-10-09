import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

describe('source hygiene', () => {
  it('no .ts/.tsx under src contains a NUL or stray control byte', () => {
    const bad: string[] = []
    for (const f of walk(__dirname)) {
      const b = readFileSync(f)
      for (let i = 0; i < b.length; i++) {
        const c = b[i]
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) { bad.push(`${f}@${i}:${c}`); break }
      }
    }
    expect(bad).toEqual([])
  })
})
