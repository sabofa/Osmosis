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
  settings: { type: 'paper', tint: 'theme', texture: 0.6, grid: 24, tile: 512 } satisfies PaperSettings,
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

// An SVG pattern clips to its tile, so a line whose stroke reaches the tile's edge shows half its width: it must be
// drawn again a tile over. Every line near an edge needs its shifted copy.
function ruleLines(type: GeneratedPaperType, waver: 'slight' | 'rough') {
  const i = input(light)
  const out = generatedPaper(type, i, waver)
  const pattern = out.defs.find((d) => !d.includes('data-paper-key') && d.includes('<polyline'))!
  const lines = [...pattern.matchAll(/<polyline points="([^"]+)"[^>]*stroke-width="([\d.]+)"/g)].map((m) => ({
    width: Number(m[2]),
    pts: m[1].split(' ').map((p) => p.split(',').map(Number)),
  }))
  return { lines, tile: i.settings.grid * 10 }
}

describe('rulings at the tile edge', () => {
  for (const [type, waver] of [['graphPaper', 'slight'], ['graphPaper', 'rough'], ['notebook', 'slight']] as const) {
    it(`${type} (${waver}): a line within half a stroke of the edge has its wrapped copy`, () => {
      const { lines, tile } = ruleLines(type, waver)
      expect(lines.length).toBeGreaterThan(10)
      let near = 0
      for (const line of lines) {
        // Across the line: y for a horizontal one (x runs the tile), x for a vertical one.
        const horizontal = line.pts[line.pts.length - 1][0] - line.pts[0][0] > tile / 2
        const [along, across] = horizontal ? [0, 1] : [1, 0]
        const values = line.pts.map((p) => p[across])
        const half = line.width / 2
        const low = Math.min(...values) < half
        const high = Math.max(...values) > tile - half
        if (!low && !high) continue
        near++
        const shift = low ? tile : -tile
        const copy = lines.some(
          (other) =>
            other !== line &&
            other.pts.length === line.pts.length &&
            other.pts.every((p, n) => Math.abs(p[along] - line.pts[n][along]) < 1e-6 && Math.abs(p[across] - (line.pts[n][across] + shift)) < 0.02)
        )
        expect(copy, `${type} line near ${values[0]}`).toBe(true)
      }
      if (type === 'graphPaper') expect(near).toBeGreaterThanOrEqual(2)
    })
  }
})

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

  it('keys a tint in lower-case #rrggbb whatever way it is written', () => {
    const keyOf = (type: GeneratedPaperType, tint: string) => paperKeysIn(svg(type, input(light, 3, tint)))[0]
    expect(keyOf('canvas', '#EEDDCC')).toBe(keyOf('canvas', '#eeddcc'))
    expect(keyOf('canvas', '#EDC')).toBe(keyOf('canvas', '#eeddcc'))
    expect(keyOf('kraft', '#EDC')).toBe(keyOf('kraft', '#eeddcc'))
    expect(parsePaperKey(keyOf('canvas', '#EDC'))!.baseHex).toBe('#eeddcc')
  })

  it('dusts a tray finely: a gradient, many small specks denser at the bottom, a few faint smears', () => {
    const out = svg('blackboard', input(light))
    const tray = out.slice(out.indexOf('data-paper="tray"'))
    const radii = [...tray.matchAll(/<circle[^>]*\br="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(radii.length).toBeGreaterThan(150)
    expect(radii.length).toBeLessThan(400)
    expect(Math.max(...radii)).toBeLessThanOrEqual(2.1)
    expect(tray).not.toContain('<ellipse')
    expect((tray.match(/<line\b/g) ?? []).length).toBeGreaterThanOrEqual(3)
    const ys = [...tray.matchAll(/<circle[^>]*\bcy="(-?[\d.]+)"/g)].map((m) => Number(m[1]))
    const bottom = VIEW.y + VIEW.height
    expect(ys.filter((y) => y > bottom - (VIEW.height * 0.16) / 3).length).toBeGreaterThan(ys.length / 2)
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
