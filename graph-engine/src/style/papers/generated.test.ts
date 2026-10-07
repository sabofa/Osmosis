import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import type { PaperSettings } from '../tokens'
import { resolveTheme } from '../theme/adapter'
import type { ThemeInput } from '../theme/types'
import type { GeneratedPaperType } from './generate/types'
import { generatedPaper, paperBaseColour, paperKey, paperKeysIn, parsePaperKey } from './generated'
import type { PaperInput } from './types'

const VIEW = { x: -350, y: -250, width: 700, height: 500 }
const BOARDS: GeneratedPaperType[] = ['blackboard', 'greenboard', 'whiteboard']
const OTHERS: GeneratedPaperType[] = ['canvas', 'linen', 'paperFine', 'paperRough', 'kraft', 'notebook', 'graphPaper', 'dotted']

const input = (theme: ThemeInput, seed = 3, tint = theme.colours.paper): PaperInput => ({
  settings: { type: 'paper', tint, texture: 0.6, grid: 24 } as PaperSettings,
  tint,
  view: VIEW,
  id: (name) => `P-${name}`,
  colour: (hex) => hex,
  random: randomFor('paper', seed),
  theme,
  seed,
})
const svg = (type: GeneratedPaperType, i: PaperInput) => {
  const out = generatedPaper(type, i)
  return [...out.defs, ...out.background].join('')
}
const light = resolveTheme({ mode: 'light' })
const dark = resolveTheme({ mode: 'dark' })

describe('generated papers', () => {
  it('is deterministic, and its key is the self-describing one', () => {
    for (const type of [...BOARDS, ...OTHERS]) {
      expect(svg(type, input(light))).toBe(svg(type, input(light)))
      const [key] = paperKeysIn(svg(type, input(light)))
      const base = paperBaseColour(type, light, light.colours.paper)
      expect(key).toBe(paperKey(type, 3, 512, 0.6, base))
      expect(parsePaperKey(key)).toEqual({ type, seed: 3, size: 512, texture: 0.6, baseHex: base })
    }
    expect(parsePaperKey('nonsense')).toBeNull()
    expect(parsePaperKey('paper-v1:nope:1:2:3:#ffffff')).toBeNull()
  })

  it('puts a keyed pattern, then a flat sheet first, covering three view boxes each way', () => {
    const out = generatedPaper('linen', input(light))
    expect(out.defs[0]).toMatch(/<pattern id="P-[^"]*" data-paper-key="paper-v1:linen:/)
    expect(out.defs[0]).toMatch(/<image data-paper-key="[^"]+" href="" width="512" height="512"\/>/)
    expect(out.background[0]).toMatch(/^<rect x="-2450" y="-1750" width="4900" height="3500" fill="#/)
    expect(out.background[1]).toMatch(/fill="url\(#P-/)
  })

  it('draws a board the same in light and dark', () => {
    for (const type of BOARDS) expect(svg(type, input(light))).toBe(svg(type, input(dark)))
  })

  it('a changed paper colour changes papers but not boards; a changed accent changes a board', () => {
    const other = resolveTheme({ mode: 'light', colours: { paper: '#d0e0ff' } })
    for (const type of OTHERS) {
      expect(svg(type, input(other))).not.toBe(svg(type, input(light)))
      expect(paperKeysIn(svg(type, input(other)))).not.toEqual(paperKeysIn(svg(type, input(light))))
    }
    for (const type of BOARDS) expect(svg(type, input(other))).toBe(svg(type, input(light)))
    const accent = resolveTheme({ mode: 'light', colours: { accent: '#2255cc' } })
    expect(paperBaseColour('blackboard', accent, '#ffffff')).not.toBe(paperBaseColour('blackboard', light, '#ffffff'))
  })

  it('kraft is pulled toward brown; others keep the tint', () => {
    expect(paperBaseColour('kraft', light, '#ffffff')).not.toBe('#ffffff')
    expect(paperBaseColour('linen', light, '#abcdef')).toBe('#abcdef')
  })

  it('finds each distinct key once, in order', () => {
    const a = svg('linen', input(light))
    const b = svg('kraft', input(light))
    const keys = paperKeysIn(a + b + a)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^paper-v1:linen:/)
    expect(keys[1]).toMatch(/^paper-v1:kraft:/)
    expect(paperKeysIn('<svg/>')).toEqual([])
  })

  it('lays tray dust on the two dark boards only, seeded', () => {
    for (const type of BOARDS) {
      const dusty = type !== 'whiteboard'
      expect(svg(type, input(light)).includes('data-paper="tray"')).toBe(dusty)
      if (dusty) expect(svg(type, input(light, 4))).not.toBe(svg(type, input(light, 3)))
    }
    for (const type of OTHERS) expect(svg(type, input(light))).not.toContain('data-paper="tray"')
  })

  it('draws rulings in the theme line colours', () => {
    for (const type of ['notebook', 'graphPaper', 'dotted'] as const) {
      const out = svg(type, input(light))
      expect(out).toContain('data-paper="rules"')
      expect(out).toContain(type === 'notebook' ? light.colours.line : light.colours.lineStrong)
    }
    expect(svg('notebook', input(light))).toContain(light.colours.line)
    expect(svg('notebook', input(light))).toContain('data-paper="margin"')
    expect(svg('linen', input(light))).not.toContain('data-paper="rules"')
  })
})
