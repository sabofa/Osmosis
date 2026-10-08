import { describe, expect, it } from 'vitest'
import { parseColour } from '../colour.js'
import { toDocumentTokens } from '../contracts.js'
import { toCssVars } from '../emit.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, normalise, type Mode } from '../manifest.js'
import { resolve } from '../resolve.js'
import { TOKENS, createResolver, isValidTokenValue, tokenByName, ResolveError } from './index.js'

function make(mode: Mode = 'light', overrides?: Record<string, string>) {
  const s = DEFAULT_SEEDS[mode]
  return createResolver({
    mode, defs: TOKENS, dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS, overrides,
    seeds: { canvas: parseColour(s.canvas), surface: parseColour(s.surface), ink: parseColour(s.ink), accent: parseColour(s.accent) },
  })
}

const NL = String.fromCharCode(10)
const hex = (n: number): string => '0123456789abcdef'.repeat(8).slice(0, n)

describe('icon-sheet', () => {
  const def = tokenByName.get('icon-sheet')!
  it('is registered once in the shape group', () => {
    expect(def.group).toBe('shape')
    expect(def.tier).toBe('semantic')
    expect(def.modeDependent).toBe(false)
    expect(TOKENS.filter((t) => t.name === 'icon-sheet')).toHaveLength(1)
  })
  const valid = ['default', 'builtin:retro', 'builtin:a1-b_2', 'asset:0123456789abcdef', 'asset:' + hex(64), 'builtin:' + 'a'.repeat(32)]
  const invalid = ['', 'Default', 'builtin:', 'builtin:UP', 'builtin:' + 'a'.repeat(33), 'asset:xyz', 'asset:abc', 'asset:' + hex(64) + '0',
    'javascript:alert(1)', 'default;', 'a}b', 'default' + NL]
  for (const v of valid) it(`accepts ${JSON.stringify(v)}`, () => expect(isValidTokenValue(def, v)).toBe(true))
  for (const v of invalid) it(`rejects ${JSON.stringify(v)}`, () => expect(isValidTokenValue(def, v)).toBe(false))
  it('defaults to default in both modes', () => {
    for (const m of ['light', 'dark'] as Mode[]) expect(make(m).get('icon-sheet')).toBe('default')
  })
  it('bad override throws ResolveError naming the format', () => {
    expect(() => make('light', { 'icon-sheet': 'nope' }).get('icon-sheet')).toThrow(ResolveError)
    expect(() => make('light', { 'icon-sheet': 'nope' }).get('icon-sheet')).toThrow(/does not match the allowed format/)
  })
  it('good override resolves and emits --icon-sheet', () => {
    const r = make('light', { 'icon-sheet': 'builtin:retro' })
    expect(r.get('icon-sheet')).toBe('builtin:retro')
    expect(toCssVars(r.all())['--icon-sheet']).toBe('builtin:retro')
  })
  it('provenance default', () => {
    const t = resolve(normalise({ id: 'a', name: 'A' }))
    expect(t.provenance.light['icon-sheet']?.source).toBe('default')
  })
})

describe('doc-font-body', () => {
  it('registered in document group', () => {
    const d = tokenByName.get('doc-font-body')!
    expect(d.group).toBe('document')
    expect(d.type).toBe('font')
    expect(d.modeDependent).toBe(false)
  })
  it('equals font-body by default and follows its override', () => {
    const r = make()
    expect(r.get('doc-font-body')).toBe(r.get('font-body'))
    const o = make('light', { 'font-body': 'Georgia, serif' })
    expect(o.get('doc-font-body')).toBe('Georgia, serif')
  })
  it('is itself overridable', () => {
    const o = make('light', { 'doc-font-body': 'Lora, serif' })
    expect(o.get('doc-font-body')).toBe('Lora, serif')
    expect(o.get('font-body')).not.toBe('Lora, serif')
  })
  it('toDocumentTokens fonts.body reads doc-font-body', () => {
    const m = normalise({ id: 'a', name: 'A', overrides: { any: { 'doc-font-body': 'Lora, serif' } } })
    const r = resolve(m)
    const d = toDocumentTokens(r, m, 'light')
    expect(d.fonts.body).toBe('Lora, serif')
    expect(d.fonts.body).not.toBe(r.light['font-body'])
    const plain = normalise({ id: 'b', name: 'B' })
    const rp = resolve(plain)
    expect(toDocumentTokens(rp, plain, 'light').fonts.body).toBe(rp.light['doc-font-body'])
  })
})
