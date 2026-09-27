import { describe, expect, it } from 'vitest'
import { resolveColor } from '../parser/colors'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { contrastRatio, hexToRgb, OPERAND_GREY, OPERAND_GREY_TOKEN, relativeLuminance, resolveSpaceColor, spaceColors } from './theme'

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
    expect(resolveSpaceColor(spec, LIGHT_PALETTE, 'light')).toEqual(hexToRgb(OPERAND_GREY.light))
    expect(resolveSpaceColor(spec, DARK_PALETTE, 'dark')).toEqual(hexToRgb(OPERAND_GREY.dark))
    expect(OPERAND_GREY.dark).not.toBe(resolveColor('gray'))
    const lightRatio = contrastRatio(hexToRgb(OPERAND_GREY.light), hexToRgb(LIGHT_PALETTE.background))
    const darkRatio = contrastRatio(hexToRgb(OPERAND_GREY.dark), hexToRgb(DARK_PALETTE.background))
    expect(lightRatio).toBeGreaterThanOrEqual(3)
    expect(darkRatio).toBeGreaterThanOrEqual(3)
    // parser/colors.ts's "gray" (0x888891, one fixed hex for every theme,
    // since an author who writes "color: gray" means it literally) already
    // clears 3:1 in both themes, computed the same way — 3.27:1 light,
    // 4.75:1 dark — but light sits close to the line; the theme-aware token
    // gives real margin in both (>= 5:1), which is the point of V7's fix:
    // architecture (a theme token, not a hardcoded name), not a bare pass.
    const oldGreyLight = contrastRatio(hexToRgb(resolveColor('gray')), hexToRgb(LIGHT_PALETTE.background))
    expect(oldGreyLight).toBeGreaterThanOrEqual(3)
    expect(oldGreyLight).toBeLessThan(3.5)
    expect(lightRatio).toBeGreaterThan(oldGreyLight)
  })
})
