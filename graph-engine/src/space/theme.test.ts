import { describe, expect, it } from 'vitest'
import { resolveColor } from '../parser/colors'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { contrastRatio, hexToRgb, OPERAND_GREY_TOKEN, relativeLuminance, resolveSpaceColor, spaceColors } from './theme'

const slot = (n: number) => ({ author: null, slot: n })

describe('resolveSpaceColor', () => {
  it('slot 0 is the accent, palette.curve', () => {
    expect(resolveSpaceColor(slot(0), LIGHT_PALETTE, 'light')).toEqual(hexToRgb(LIGHT_PALETTE.curve))
    expect(resolveSpaceColor(slot(0), DARK_PALETTE, 'dark')).toEqual(hexToRgb(DARK_PALETTE.curve))
  })

  it('slot 3 in light is #8a4fa3 = (138, 79, 163) / 255', () => {
    expect(resolveSpaceColor(slot(3), LIGHT_PALETTE, 'light')).toEqual([138 / 255, 79 / 255, 163 / 255])
  })

  it('slot 3 in dark is #b98ad0', () => {
    expect(resolveSpaceColor(slot(3), DARK_PALETTE, 'dark')).toEqual([0xb9 / 255, 0x8a / 255, 0xd0 / 255])
  })

  it('slot 9 wraps to slot 2', () => {
    expect(resolveSpaceColor(slot(9), LIGHT_PALETTE, 'light')).toEqual(resolveSpaceColor(slot(2), LIGHT_PALETTE, 'light'))
    expect(resolveSpaceColor(slot(2), LIGHT_PALETTE, 'light')).toEqual(hexToRgb(0x4c7a4a))
  })

  it("author: 'purple' resolves to the parser's purple; hex is exact", () => {
    expect(resolveSpaceColor({ author: 'purple', slot: 1 }, LIGHT_PALETTE, 'light')).toEqual(hexToRgb(resolveColor('purple')))
    expect(resolveSpaceColor({ author: '#102030', slot: 1 }, LIGHT_PALETTE, 'light')).toEqual([0x10 / 255, 0x20 / 255, 0x30 / 255])
  })

  it('an author value the parser does not know falls back to the slot', () => {
    expect(resolveSpaceColor({ author: 'chartreuse-ish', slot: 3 }, LIGHT_PALETTE, 'light')).toEqual(hexToRgb(0x8a4fa3))
  })
})

describe('spaceColors', () => {
  it('draws the frame in axis, grid and gridStrong, and clears to background', () => {
    const c = spaceColors(LIGHT_PALETTE, 'light')
    expect(c.background).toEqual(hexToRgb(LIGHT_PALETTE.background))
    expect(c.axis).toEqual(hexToRgb(LIGHT_PALETTE.axis))
    expect(c.grid).toEqual(hexToRgb(LIGHT_PALETTE.grid))
    expect(c.gridStrong).toEqual(hexToRgb(LIGHT_PALETTE.gridStrong))
  })
})

describe('WCAG contrast (theme.ts relativeLuminance / contrastRatio)', () => {
  it('matches the published reference points: black/white is 21:1, and the formula is symmetric', () => {
    // https://www.w3.org/TR/WCAG21/#contrast-minimum — black and white is
    // the maximum possible ratio, exactly 21:1 by the formula's own algebra
    // ((1 + 0.05) / (0 + 0.05) = 21).
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 9)
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 6)
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 6)
  })

  it('OPERAND_GREY (S6 plan V7: project:, cross:) resolves through the theme, not the author-facing "gray", and clears 3:1 against the background in both themes with a healthier margin than the old fixed grey', () => {
    const spec = { author: OPERAND_GREY_TOKEN, slot: 0 }
    expect(resolveSpaceColor(spec, LIGHT_PALETTE, 'light')).toEqual(hexToRgb(LIGHT_PALETTE.muted))
    expect(resolveSpaceColor(spec, DARK_PALETTE, 'dark')).toEqual(hexToRgb(DARK_PALETTE.muted))
    expect(LIGHT_PALETTE.muted).not.toBe(resolveColor('gray'))
    const lightRatio = contrastRatio(hexToRgb(LIGHT_PALETTE.muted), hexToRgb(LIGHT_PALETTE.background))
    const darkRatio = contrastRatio(hexToRgb(DARK_PALETTE.muted), hexToRgb(DARK_PALETTE.background))
    expect(lightRatio).toBeGreaterThanOrEqual(3)
    expect(darkRatio).toBeGreaterThanOrEqual(3)
    // S6 fix round 1, I5: OPERAND_GREY used to be its own hard-coded hex
    // (0x6b6b63 light, 0xa8a89e dark), a second grey alongside the host's
    // own --muted token. It now resolves to palette.muted directly — the
    // very colour ui/SpaceView.css's --space-muted already uses for the
    // chrome's secondary text — so there is only ever one grey, both from
    // the theme. Hand values (WCAG relative luminance, srgb(c) the same
    // piecewise linearisation relativeLuminance uses, c <= 0.03928 ? c /
    // 12.92 : ((c + 0.055) / 1.055) ** 2.4):
    //   light: background 0xfdf6ea, muted 0x6b6558.
    //     srgb(0xfd/255) = 0.98225, srgb(0xf6/255) = 0.92158, srgb(0xea/255) = 0.82279
    //     srgb(0x6b/255) = 0.14703, srgb(0x65/255) = 0.13014, srgb(0x58/255) = 0.09759
    //     L(bg)    = 0.2126*0.98225 + 0.7152*0.92158 + 0.0722*0.82279 = 0.92734
    //     L(muted) = 0.2126*0.14703 + 0.7152*0.13014 + 0.0722*0.09759 = 0.13139
    //     ratio = (0.92734 + 0.05) / (0.13139 + 0.05) = 5.388
    //   dark: background 0x201e15, muted 0xa39d8c.
    //     srgb(0x20/255) = 0.01444, srgb(0x1e/255) = 0.01298, srgb(0x15/255) = 0.00750
    //     srgb(0xa3/255) = 0.36625, srgb(0x9d/255) = 0.33716, srgb(0x8c/255) = 0.26225
    //     L(bg)    = 0.2126*0.01444 + 0.7152*0.01298 + 0.0722*0.00750 = 0.01290
    //     L(muted) = 0.2126*0.36625 + 0.7152*0.33716 + 0.0722*0.26225 = 0.33793
    //     ratio = (0.33793 + 0.05) / (0.01290 + 0.05) = 6.167
    // Both clear the >= 5:1 margin V7 set out to give the token.
    expect(lightRatio).toBeGreaterThanOrEqual(5)
    expect(darkRatio).toBeGreaterThanOrEqual(5)
    // parser/colors.ts's "gray" (one fixed hex for every theme, since an
    // author who writes "color: gray" means it literally) already clears
    // 3:1 in both themes, computed the same way, but light sits close to
    // the line; the theme-aware token gives real margin in both.
    const oldGreyLight = contrastRatio(hexToRgb(resolveColor('gray')), hexToRgb(LIGHT_PALETTE.background))
    expect(oldGreyLight).toBeGreaterThanOrEqual(3)
    expect(oldGreyLight).toBeLessThan(3.5)
    expect(lightRatio).toBeGreaterThan(oldGreyLight)
  })
})
