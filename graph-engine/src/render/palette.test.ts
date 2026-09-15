import { describe, it, expect } from 'vitest'
import { harmonize, rgbToHsl, LIGHT_PALETTE, DARK_PALETTE, type Palette } from './palette'
import { resolveColor } from '../parser/colors'

// A cool theme, nothing like the warm-paper default.
const SLATE_DARK: Palette = { ...DARK_PALETTE, background: 0x1a1e24, curve: 0x7fa8dc, axis: 0xe7ebf1 }
const SLATE_LIGHT: Palette = { ...LIGHT_PALETTE, background: 0xffffff, curve: 0x3b6ea8, axis: 0x161a21 }

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('harmonize', () => {
  it('keeps a named colour recognisable: hue within 15° of the original', () => {
    for (const name of ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']) {
      const original = resolveColor(name)
      for (const palette of [SLATE_DARK, SLATE_LIGHT, LIGHT_PALETTE, DARK_PALETTE]) {
        const out = harmonize(original, palette)
        expect(hueDistance(rgbToHsl(original)[0], rgbToHsl(out)[0]), `${name}`).toBeLessThanOrEqual(15)
      }
    }
  })

  it('lifts colours on a dark background and deepens them on a light one', () => {
    const orange = resolveColor('orange')
    const onDark = rgbToHsl(harmonize(orange, SLATE_DARK))[2]
    const onLight = rgbToHsl(harmonize(orange, SLATE_LIGHT))[2]
    expect(onDark).toBeGreaterThanOrEqual(0.55)
    expect(onLight).toBeLessThanOrEqual(0.5)
    expect(onDark).toBeGreaterThan(onLight)
  })

  it('maps black to the theme ink and gray to muted ink', () => {
    expect(harmonize(resolveColor('black'), SLATE_DARK)).toBe(SLATE_DARK.axis)
    expect(harmonize(resolveColor('black'), SLATE_LIGHT)).toBe(SLATE_LIGHT.axis)
    const gray = harmonize(resolveColor('gray'), SLATE_DARK)
    expect(gray).not.toBe(SLATE_DARK.axis)
    expect(gray).not.toBe(SLATE_DARK.background)
  })

  it('differs between themes, so the same spec is not literally the same pixels everywhere', () => {
    const blue = resolveColor('blue')
    expect(harmonize(blue, SLATE_DARK)).not.toBe(harmonize(blue, LIGHT_PALETTE))
  })
})
