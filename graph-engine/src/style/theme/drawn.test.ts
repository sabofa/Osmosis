import { describe, expect, it } from 'vitest'
import { fromOklch, toOklch } from '../color'
import { blendOver, contrastRatio, drawnContrast, fitLightness } from './contrast'

describe('blendOver: one stroke of a colour at an opacity over its surface', () => {
  it('is each 8-bit sRGB channel, opacity x colour + (1 - opacity) x surface, rounded', () => {
    expect(blendOver('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(blendOver('#ff0000', '#ffffff', 0.5)).toBe('#ff8080')
    expect(blendOver('#102030', '#fefefe', 0.85)).toBe('#' + [0x10, 0x20, 0x30].map((c) => Math.round(0.85 * c + 0.15 * 0xfe).toString(16).padStart(2, '0')).join(''))
    expect(blendOver('#ABCDEF', '#000000', 0.25)).toBe(blendOver('#abcdef', '#000000', 0.25))
    expect(blendOver('#abc', '#fff', 0.5)).toBe(blendOver('#aabbcc', '#ffffff', 0.5))
  })

  it('is the colour itself at opacity 1 (and above), and the surface at 0 (and below)', () => {
    expect(blendOver('#3b6ea8', '#ffffff')).toBe('#3b6ea8')
    expect(blendOver('#3b6ea8', '#ffffff', 1)).toBe('#3b6ea8')
    expect(blendOver('#3b6ea8', '#ffffff', 7)).toBe('#3b6ea8')
    expect(blendOver('#3b6ea8', '#fdf6ea', 0)).toBe('#fdf6ea')
    expect(blendOver('#3b6ea8', '#fdf6ea', -1)).toBe('#fdf6ea')
  })
})

describe('drawnContrast', () => {
  it('is the contrast of the blended stroke with the surface, never more than the solid colour has', () => {
    expect(drawnContrast('#000000', '#ffffff', 1)).toBeCloseTo(21, 10)
    expect(drawnContrast('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(drawnContrast('#000000', '#ffffff', 0.5)).toBeCloseTo(contrastRatio('#808080', '#ffffff'), 10)
    for (const opacity of [0.95, 0.85, 0.5, 0.1]) {
      expect(drawnContrast('#336699', '#ffffff', opacity)).toBeLessThanOrEqual(contrastRatio('#336699', '#ffffff'))
    }
    expect(drawnContrast('#336699', '#ffffff', 0)).toBe(1)
  })
})

describe('fitLightness at an opacity', () => {
  const colour = { l: 0.6, c: 0.1, h: 40 }

  it('measures the floor on the drawn stroke: the colour that comes back keeps the target blended', () => {
    for (const opacity of [0.95, 0.85, 0.8, 0.7]) {
      for (const surface of ['#ffffff', '#fdf6ea', '#201e15']) {
        const hex = fitLightness(colour, surface, { target: 4.5, opacity })
        expect(drawnContrast(hex, surface, opacity), `${surface} at ${opacity}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('goes further from the surface than a solid fit does, and stops at the first lightness that passes', () => {
    const solid = fitLightness(colour, '#ffffff', { target: 4.5 })
    const drawn = fitLightness(colour, '#ffffff', { target: 4.5, opacity: 0.85 })
    expect(toOklch(drawn).l).toBeLessThan(toOklch(solid).l)
    // It stopped at the first lightness that passes: a little lighter does not.
    const lighter = fromOklch({ ...colour, l: toOklch(drawn).l + 0.02 })
    expect(drawnContrast(lighter, '#ffffff', 0.85)).toBeLessThan(4.5)
  })

  it('is the old fit when the opacity is 1, given or not', () => {
    for (const surface of ['#ffffff', '#201e15', '#8a8a8a']) {
      const plain = fitLightness(colour, surface, { target: 4.5 })
      expect(fitLightness(colour, surface, { target: 4.5, opacity: 1 })).toBe(plain)
    }
  })

  it('returns the best contrast there is where the drawn stroke cannot reach it, and never throws', () => {
    // On a mid-grey surface at opacity 0.5 nothing keeps 4.5:1 drawn.
    const hex = fitLightness(colour, '#8a8a8a', { target: 4.5, opacity: 0.5 })
    expect(drawnContrast(hex, '#8a8a8a', 0.5)).toBeLessThan(4.5)
    expect(drawnContrast(hex, '#8a8a8a', 0.5)).toBeCloseTo(Math.max(drawnContrast('#000000', '#8a8a8a', 0.5), drawnContrast('#ffffff', '#8a8a8a', 0.5)), 6)
  })

  it('refuses an opacity that is 0, negative, above 1 or not a number', () => {
    for (const opacity of [0, -0.5, 1.5, Number.NaN]) expect(() => fitLightness(colour, '#ffffff', { opacity })).toThrow(RangeError)
  })
})
