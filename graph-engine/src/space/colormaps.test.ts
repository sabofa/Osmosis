import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import {
  colorOf,
  colormapAt,
  colormapTable,
  NORMALISE_GLSL,
  NORMALISE_GLSL_FUNCTION,
  normalise,
  SEQUENTIAL_ANCHORS,
  tableEntry,
  type ColormapTheme,
} from './colormaps'
import { mixLab, oklabToSrgb, srgbToOklab } from './oklab'
import type { ColormapName } from './scene/types'
import { hexToRgb, spaceColors } from './theme'

const LIGHT: ColormapTheme = spaceColors(LIGHT_PALETTE, 'light')
const DARK: ColormapTheme = spaceColors(DARK_PALETTE, 'dark')
const SEQUENTIAL: Exclude<ColormapName, 'balance'>[] = ['viridis', 'magma', 'plasma', 'cividis', 'gray']

const lightness = (table: Uint8Array, i: number) => srgbToOklab(tableEntry(table, i))[0]
const bytes = (hex: number) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255]

describe('Oklab', () => {
  it('round-trips #21908C through Oklab within 1/255 per channel', () => {
    const rgb = hexToRgb(0x21908c)
    const back = oklabToSrgb(srgbToOklab(rgb))
    for (let c = 0; c < 3; c++) expect(Math.abs(back[c] - rgb[c])).toBeLessThanOrEqual(1 / 255)
  })

  it('puts white at L = 1 and black at L = 0 with no chroma', () => {
    const white = srgbToOklab([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 6)
    expect(white[1]).toBeCloseTo(0, 6)
    expect(srgbToOklab([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('colormap tables', () => {
  it.each(SEQUENTIAL)('%s: Oklab L never decreases across the 256 entries', (name) => {
    const table = colormapTable(name, LIGHT)
    expect(table).toHaveLength(256 * 4)
    const dips: number[] = []
    for (let i = 1; i < 256; i++) if (lightness(table, i) < lightness(table, i - 1)) dips.push(i)
    expect(dips).toEqual([])
  })

  it.each(SEQUENTIAL)('%s: entry 0 and entry 255 are the first and last anchors exactly', (name) => {
    const table = colormapTable(name, LIGHT)
    const anchors = SEQUENTIAL_ANCHORS[name]
    expect(Array.from(table.slice(0, 4))).toEqual(bytes(anchors[0]))
    expect(Array.from(table.slice(255 * 4))).toEqual(bytes(anchors[anchors.length - 1]))
  })

  it('interpolates in Oklab: viridis at t = 1/16 is the Oklab midpoint of its first two anchors', () => {
    const expected = oklabToSrgb(mixLab(srgbToOklab(hexToRgb(0x440154)), srgbToOklab(hexToRgb(0x472d7b)), 0.5))
    const got = colormapAt('viridis', LIGHT, 1 / 16)
    for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(expected[c], 12)
  })

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('balance (%s) is symmetric in lightness: |L(i) - L(255 - i)| <= 0.01', (_name, theme) => {
    const table = colormapTable('balance', theme)
    let worst = 0
    for (let i = 0; i < 128; i++) worst = Math.max(worst, Math.abs(lightness(table, i) - lightness(table, 255 - i)))
    expect(worst).toBeLessThanOrEqual(0.01)
  })

  it('balance has a neutral centre at L 0.92 in light and 0.30 in dark, blue below and red above', () => {
    const light = colormapTable('balance', LIGHT)
    const dark = colormapTable('balance', DARK)
    // The centre lies between entries 127 and 128.
    expect((lightness(light, 127) + lightness(light, 128)) / 2).toBeCloseTo(0.92, 2)
    expect((lightness(dark, 127) + lightness(dark, 128)) / 2).toBeCloseTo(0.3, 2)
    const [r0, , b0] = tableEntry(light, 0)
    const [r1, , b1] = tableEntry(light, 255)
    expect(b0).toBeGreaterThan(r0)
    expect(r1).toBeGreaterThan(b1)
  })
})

describe('normalise', () => {
  it('maps a sequential scale over [2, 6]: 4 is 0.5, the ends are 0 and 1, beyond is clamped', () => {
    const scale = { domain: { min: 2, max: 6 }, diverging: false }
    expect(normalise(4, scale)).toBe(0.5)
    expect(normalise(2, scale)).toBe(0)
    expect(normalise(6, scale)).toBe(1)
    expect(normalise(10, scale)).toBe(1)
    expect(normalise(-10, scale)).toBe(0)
  })

  it('centres a diverging scale on zero: over [-1, 3], 0 is 0.5, 3 is 1, -1 is 0.5 - 1/6', () => {
    const scale = { domain: { min: -1, max: 3 }, diverging: true }
    expect(normalise(0, scale)).toBe(0.5)
    expect(normalise(3, scale)).toBe(1)
    // 0.5 + (-1) / (2 * max(1, 3)), as a double: 0.33333333333333337.
    expect(normalise(-1, scale)).toBe(0.5 - 1 / 6)
  })

  it('maps a non-finite value to "no data": null, which colours as the no-data colour', () => {
    const scale = { domain: { min: 2, max: 6 }, diverging: false }
    expect(normalise(Number.NaN, scale)).toBeNull()
    expect(normalise(Number.POSITIVE_INFINITY, scale)).toBeNull()
    const noData = [0.1, 0.2, 0.3] as const
    const table = colormapTable('viridis', LIGHT)
    expect(colorOf(Number.NaN, scale, table, noData)).toBe(noData)
    expect(colorOf(2, scale, table, noData)).toEqual(tableEntry(table, 0))
  })

  it('the shader formula (GLSL text, interpreted) agrees with the CPU on 20 values', () => {
    expect(NORMALISE_GLSL_FUNCTION).toContain(NORMALISE_GLSL.sequential)
    expect(NORMALISE_GLSL_FUNCTION).toContain(NORMALISE_GLSL.diverging)
    const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
    const cases: [number, number, boolean][] = [
      [2, 6, false],
      [-1, 3, true],
      [-4.5, 0.25, false],
      [-7, 7, true],
    ]
    let checked = 0
    for (const [lo, hi, diverging] of cases) {
      for (let k = 0; k < 5; k++) {
        const v = lo - 1 + ((hi - lo + 2) * k) / 4
        const glsl = clamp01(evalGlsl(diverging ? NORMALISE_GLSL.diverging : NORMALISE_GLSL.sequential, { v, lo, hi }))
        expect([v, glsl]).toEqual([v, normalise(v, { domain: { min: lo, max: hi }, diverging })])
        checked++
      }
    }
    expect(checked).toBe(20)
  })
})

// A tiny interpreter for the GLSL arithmetic the formulas generate: float
// literals, the variables, + - * /, parentheses, abs() and max().
function evalGlsl(source: string, vars: Record<string, number>): number {
  const tokens = source.match(/\d+\.\d*(?:e[-+]?\d+)?|\d+(?:e[-+]?\d+)?|[A-Za-z_]\w*|[-+*/(),]/g) ?? []
  let i = 0
  const peek = () => tokens[i]
  const take = (t?: string) => {
    const got = tokens[i++]
    if (t !== undefined && got !== t) throw new Error(`expected ${t}, got ${got}`)
    return got
  }
  const expr = (): number => {
    let value = term()
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + term() : value - term()
    return value
  }
  const term = (): number => {
    let value = factor()
    while (peek() === '*' || peek() === '/') value = take() === '*' ? value * factor() : value / factor()
    return value
  }
  const factor = (): number => {
    const t = take()
    if (t === '(') {
      const value = expr()
      take(')')
      return value
    }
    if (t === '-') return -factor()
    if (/^\d/.test(t)) return Number(t)
    if (peek() === '(') {
      take('(')
      const args = [expr()]
      while (peek() === ',') {
        take(',')
        args.push(expr())
      }
      take(')')
      if (t === 'abs') return Math.abs(args[0])
      if (t === 'max') return Math.max(args[0], args[1])
      throw new Error(`unknown function ${t}`)
    }
    if (!(t in vars)) throw new Error(`unknown name ${t}`)
    return vars[t]
  }
  const value = expr()
  if (i !== tokens.length) throw new Error(`trailing tokens in ${source}`)
  return value
}

describe('colormapTable is made once per (map, theme)', () => {
  it('returns the same table for the same map and theme, and another for another theme', () => {
    expect(colormapTable('viridis', LIGHT)).toBe(colormapTable('viridis', LIGHT))
    expect(colormapTable('balance', LIGHT)).not.toBe(colormapTable('balance', DARK))
  })
})

