import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../render/palette'
import { toOklch } from '../style/color'
import { MEDIA, type MediumSettings } from '../style/media'
import { PRESETS } from '../style/presets'
import { resolveStyle, type StyleLayer } from '../style/resolve'
import { defaultTheme, fromColours } from '../style/theme/adapter'
import { contrastRatio } from '../style/theme/contrast'
import type { ThemeInput } from '../style/theme/types'
import type { Style } from '../style/tokens'
import { cssColor, figureTheme } from './document'
import { figureMedium, figureMediumSettings, type FigureMedium } from './medium'

// The figure's side of a medium: which colour a role is drawn in, on which surface, and what the
// palette a figure is resolved against is made of.

const styleOf = (layer: StyleLayer): Style => resolveStyle([layer])

// The medium as the pen has it: built on the palette the figure is drawn with, which is the medium's
// own (render.ts hands the pen the palette `figureMedium(...).palette()` made), so a colour the pen is
// given for a role is that palette's slot, and anything else is an author's.
const forPen = (style: Style, host: Palette, theme?: ThemeInput, settings?: MediumSettings): FigureMedium => {
  const first = figureMedium(style, host, theme, settings)!
  return figureMedium(style, first.palette(), theme, settings)!
}

describe('the clean medium', () => {
  it('is none: its colours are the host’s palette, exactly as before', () => {
    expect(figureMedium(styleOf({}), LIGHT_PALETTE)).toBeNull()
    expect(figureMedium(styleOf({ preset: 'clean' }), DARK_PALETTE)).toBeNull()
    // A look in the clean medium (a pencil line on the clean look) is still the host's colours.
    expect(figureMedium(styleOf({ line: { type: 'pencil' } }), LIGHT_PALETTE)).toBeNull()
  })
})

describe('a figure’s medium', () => {
  const INK = styleOf({ preset: 'ink' })

  it('is drawn in the default theme of the palette’s mode when no theme is given', () => {
    const light = figureMedium(INK, LIGHT_PALETTE)!
    const dark = figureMedium(INK, DARK_PALETTE)!
    expect(light.surface).toBe(defaultTheme('light').colours.paper)
    expect(dark.surface).toBe(defaultTheme('dark').colours.paper)
    expect(figureMedium(INK, DARK_PALETTE, defaultTheme('dark'))!.palette()).toEqual(dark.palette())
  })

  it('is drawn in the theme it is given, whatever the palette says', () => {
    const theme = fromColours({ colours: { surface: '#e8efe3', paper: '#e8efe3', ink: '#14281a' } })
    expect(figureMedium(INK, DARK_PALETTE, theme)!.surface).toBe('#e8efe3')
    expect(figureMedium(INK, LIGHT_PALETTE, theme)!.surface).toBe('#e8efe3')
  })

  it('colours a role as its medium does, at the medium’s opacity', () => {
    const theme = defaultTheme('light')
    const medium = forPen(styleOf({ preset: 'blackboard' }), LIGHT_PALETTE, theme)
    const slots = figureTheme(medium.palette())
    for (const [role, slot] of [['line', slots.ink], ['label', slots.ink], ['point', slots.point], ['fill', slots.region]] as const) {
      const expected = MEDIA.chalk.colour(theme, { key: role }, {})
      expect(medium.paint(slot, role), role).toEqual({ hex: expected.hex, opacity: expected.opacity })
    }
  })

  it('tells a role’s own colour from an author’s, and fits the author’s like any other base', () => {
    const theme = defaultTheme('light')
    const medium = forPen(styleOf({ preset: 'blackboard' }), LIGHT_PALETTE, theme)
    const slots = figureTheme(medium.palette())
    const red = '#c8392c'
    const own = medium.paint(red, 'line')
    expect(own).toEqual({ hex: MEDIA.chalk.colour(theme, { key: 'line', colour: red }, {}).hex, opacity: MEDIA.chalk.colour(theme, { key: 'line' }, {}).opacity })
    expect(own.hex).not.toBe(medium.paint(slots.ink, 'line').hex)
    expect(toOklch(own.hex).l).toBeGreaterThanOrEqual(0.79)
  })

  it('lets what is not a colour pass through, and the page’s own colour be the surface', () => {
    const medium = forPen(styleOf({ preset: 'blackboard' }), LIGHT_PALETTE)
    expect(medium.paint('none', 'line')).toEqual({ hex: 'none', opacity: 1 })
    expect(medium.paint('url(#paper)', 'fill')).toEqual({ hex: 'url(#paper)', opacity: 1 })
    expect(medium.paint(figureTheme(medium.palette()).background, 'givens')).toEqual({ hex: medium.surface, opacity: 1 })
  })

  it('draws a board on the theme’s board, the same in either mode', () => {
    for (const board of ['blackboard', 'greenboard', 'whiteboard'] as const) {
      const style = styleOf({ preset: board })
      expect(figureMedium(style, LIGHT_PALETTE)!.surface).toBe(defaultTheme('light').boards[board])
      expect(figureMedium(style, DARK_PALETTE)!.surface).toBe(figureMedium(style, LIGHT_PALETTE)!.surface)
      expect(figureMedium(style, DARK_PALETTE)!.palette()).toEqual(figureMedium(style, LIGHT_PALETTE)!.palette())
    }
  })

  it('draws a paper medium on the board or the tint the style lays, and fits to it', () => {
    const onBoard = figureMedium(styleOf({ preset: 'colouredPencil', paper: { type: 'blackboard' } }), LIGHT_PALETTE)!
    expect(onBoard.surface).toBe(defaultTheme('light').boards.blackboard)
    const line = cssColor(onBoard.palette().axis)
    expect(contrastRatio(line, onBoard.surface)).toBeGreaterThanOrEqual(3)
    expect(toOklch(line).l).toBeGreaterThan(0.6)
    const tinted = figureMedium(styleOf({ preset: 'colouredPencil', paper: { tint: '#1d1d2b' } }), LIGHT_PALETTE)!
    expect(tinted.surface).toBe('#1d1d2b')
    expect(contrastRatio(cssColor(tinted.palette().axis), '#1d1d2b')).toBeGreaterThanOrEqual(3)
  })

  it('starts from the ink the style names', () => {
    const grey = forPen(styleOf({ preset: 'colouredPencil', colour: { ink: '#808080' } }), LIGHT_PALETTE)
    const plain = forPen(styleOf({ preset: 'colouredPencil' }), LIGHT_PALETTE)
    const ink = figureTheme(plain.palette()).ink
    expect(grey.paint(ink, 'line').hex).not.toBe(plain.paint(ink, 'line').hex)
    // Only the ink: points and fills keep their own colours.
    const slots = figureTheme(plain.palette())
    expect(grey.paint(slots.point, 'point')).toEqual(plain.paint(slots.point, 'point'))
    expect(grey.paint(slots.region, 'fill')).toEqual(plain.paint(slots.region, 'fill'))
  })

  it('applies the style’s saturation to what it draws, and leaves a saturation of 1 exact', () => {
    const style = styleOf({ preset: 'marker' })
    const plain = forPen({ ...style, colour: { ...style.colour, saturation: 1 } }, LIGHT_PALETTE)
    const grey = forPen({ ...style, colour: { ...style.colour, saturation: 0 } }, LIGHT_PALETTE)
    expect(toOklch(plain.paint(figureTheme(plain.palette()).point, 'point').hex).c).toBeGreaterThan(0.05)
    expect(toOklch(grey.paint(figureTheme(grey.palette()).point, 'point').hex).c).toBeLessThan(0.01)
  })

  it('makes the palette of the medium’s role colours on its surface', () => {
    const theme = defaultTheme('dark')
    const medium = figureMedium(styleOf({ preset: 'pencil' }), DARK_PALETTE, theme)!
    const palette = medium.palette()
    const hex = (role: Parameters<typeof MEDIA.graphite.colour>[1]['key']) => MEDIA.graphite.colour(theme, { key: role }, {}).hex
    expect(cssColor(palette.background)).toBe(medium.surface)
    expect(cssColor(palette.axis)).toBe(hex('line'))
    expect(cssColor(palette.point)).toBe(hex('point'))
    expect(cssColor(palette.region)).toBe(hex('fill'))
    expect(cssColor(palette.muted)).toBe(hex('auxiliary'))
    expect(cssColor(palette.curve)).toBe(hex('highlight'))
  })

  it('reads the medium’s settings from the stack, and every medium has the defaults when none is set', () => {
    const layer: StyleLayer = { preset: 'blackboard', set: { 'media.chalk.chroma': 0.5 } }
    expect(figureMediumSettings(styleOf(layer), [layer])).toEqual({ chroma: 0.5 })
    expect(figureMediumSettings(styleOf({ preset: 'ink' }), [{ preset: 'ink' }])).toEqual({ chroma: 0.9, contrast: 7, edge: 0.15 })
    // The stack's layers, as renderFigure gives them: the host's base style, then the figure's.
    const base: StyleLayer = { set: { 'media.chalk.chroma': 0.7 } }
    const figure: StyleLayer = { preset: 'blackboard' }
    expect(figureMediumSettings(resolveStyle([base, figure]), [base, figure])).toEqual({ chroma: 0.7 })
    expect(figureMediumSettings(resolveStyle([]), [])).toEqual({})
    // A medium's settings change its colour.
    const low = figureMedium(styleOf(layer), LIGHT_PALETTE, undefined, { chroma: 0.5 })!
    const high = figureMedium(styleOf(layer), LIGHT_PALETTE, undefined, { chroma: 0.7 })!
    expect(low.palette().point).not.toBe(high.palette().point)
  })

  it('has a look for every preset that is not clean', () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const medium = figureMedium(styleOf({ preset: name }), LIGHT_PALETTE)
      expect(medium === null, name).toBe(name === 'clean')
    }
  })
})
