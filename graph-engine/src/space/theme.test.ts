import { describe, expect, it } from 'vitest'
import { resolveColor } from '../parser/colors'
import { DARK_PALETTE, LIGHT_PALETTE } from '../render/palette'
import { hexToRgb, resolveSpaceColor, spaceColors } from './theme'

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
