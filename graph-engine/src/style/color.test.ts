import { describe, expect, it } from 'vitest'
import { fromOklch, saturate, toOklch } from './color'

const SAMPLES = ['#17170f', '#fdf6ea', '#c65d22', '#4c7a4a', '#a34b3f', '#1f2a44', '#e2803f', '#0000ff', '#ff0000', '#00ff00', '#ffffff', '#000000', '#808080', '#123456']

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('saturation through OKLCH chroma', () => {
  it('is the identity at 1', () => {
    for (const hex of SAMPLES) expect(saturate(hex, 1), hex).toBe(hex)
  })

  // The round trip itself, not a short-circuit: every 8-bit colour comes back
  // as itself through OKLab.
  it('round-trips through OKLCH exactly at 8 bits', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 85) {
          const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
          expect(fromOklch(toOklch(hex)), hex).toBe(hex)
        }
      }
    }
  })

  it('gives greys of equal OKLCH lightness at 0', () => {
    for (const hex of SAMPLES) {
      const grey = saturate(hex, 0)
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(grey.slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${hex} -> ${grey}`).toBeLessThanOrEqual(1)
      expect(toOklch(grey).l, hex).toBeCloseTo(toOklch(hex).l, 2)
    }
  })

  it('keeps hue and lightness at 0.5 and 1.5', () => {
    for (const hex of ['#c65d22', '#4c7a4a', '#a34b3f', '#1f2a44']) {
      const base = toOklch(hex)
      for (const s of [0.5, 1.5]) {
        const out = toOklch(saturate(hex, s))
        expect(out.l, `${hex} x${s}`).toBeCloseTo(base.l, 2)
        expect(hueDistance(out.h, base.h), `${hex} x${s}`).toBeLessThan(2)
      }
      expect(toOklch(saturate(hex, 0.5)).c).toBeLessThan(base.c)
      expect(toOklch(saturate(hex, 1.5)).c).toBeGreaterThan(base.c)
    }
  })

  // One colour checked by hand: #c65d22, the light theme's accent, is
  // OKLCH(0.5988, 0.1507, 45.96°) (computed independently from the OKLab
  // reference matrices). Half saturation halves the chroma.
  it('matches a hand-checked colour', () => {
    const accent = toOklch('#c65d22')
    expect(accent.l).toBeCloseTo(0.5988, 3)
    expect(accent.c).toBeCloseTo(0.1507, 3)
    expect(accent.h).toBeCloseTo(45.96, 1)
    expect(toOklch(saturate('#c65d22', 0.5)).c).toBeCloseTo(0.1507 / 2, 2)
  })

  it('stays inside the sRGB gamut when pushed', () => {
    for (const hex of SAMPLES) expect(saturate(hex, 1.5)).toMatch(/^#[0-9a-f]{6}$/)
  })
})
