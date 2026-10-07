import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../render/palette'
import { fromOklch, toOklch } from '../style/color'
import { resolveFigureSettings } from '../style/resolve'
import { boardSettingsOf, themeWithBoardSettings } from '../style/layers'
import { defaultTheme, fromColours } from '../style/theme/adapter'
import type { ThemeInput } from '../style/theme/types'
import { BOARD_BASES, deriveBoards } from '../style/theme/derive'
import { renderFigure } from './render'

const LINE = ['@mode: figure', 'A = (0, 0)', 'B = (4, 0)', 'segment: A-B'].join('\n')
const draw = (head: string, palette: Palette = LIGHT_PALETTE, theme?: ThemeInput): string => {
  const parsed = parseSpec(`${head}\n${LINE}`)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, palette, undefined, theme).svg
}
const paperOf = (svg: string) => /<g data-layer="paper"><rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)![1]

describe('deriveBoards options', () => {
  // An accent far from every board's hue, so the tilt has something to do.
  const accent = fromOklch({ l: 0.65, c: 0.15, h: 60 })
  it('with no options, or empty ones, is byte-identical', () => {
    expect(deriveBoards(accent, {})).toEqual(deriveBoards(accent))
    expect(deriveBoards(accent, { tilt: 0.5, chromaCap: { ...Object.fromEntries(Object.entries(BOARD_BASES).map(([k, v]) => [k, v.maxChroma])) } })).toEqual(deriveBoards(accent))
  })
  it('tilt 0 gives the untilted base hue', () => {
    const boards = deriveBoards(accent, { tilt: 0 })
    for (const name of ['blackboard', 'greenboard', 'whiteboard'] as const) expect(toOklch(boards[name]).h).toBeCloseTo(BOARD_BASES[name].h, -1)
    expect(deriveBoards(accent, { tilt: 0 }).greenboard).not.toBe(deriveBoards(accent).blackboard)
  })
  it('a smaller chroma cap lowers the chroma', () => {
    const low = deriveBoards(accent, { chromaCap: { greenboard: 0.02 } })
    expect(toOklch(low.greenboard).c).toBeLessThan(toOklch(deriveBoards(accent).greenboard).c)
    expect(low.blackboard).toBe(deriveBoards(accent).blackboard)
  })
  it('stays continuous in the accent', () => {
    const { h } = toOklch(accent)
    for (let d = 0; d < 360; d += 7) {
      const near = (hue: number) => deriveBoards(fromHue(hue), { tilt: 0.8, chromaCap: { blackboard: 0.02 } })
      const x = near(h + d)
      const y = near(h + d + 0.2)
      for (const name of ['blackboard', 'greenboard', 'whiteboard'] as const) expect(Math.abs(toOklch(x[name]).l - toOklch(y[name]).l)).toBeLessThan(0.01)
    }
  })
})

const fromHue = (h: number) => fromOklch({ l: 0.6, c: 0.15, h: ((h % 360) + 360) % 360 }) as never

describe('boardSettingsOf and themeWithBoardSettings', () => {
  const settingsOf = (head: string) => {
    const parsed = parseSpec(`${head}\n${LINE}`)
    return boardSettingsOf(resolveFigureSettings([parsed.config.style], undefined, 'figure2d'))
  }
  it('reads the defaults from the registry', () => {
    const board = settingsOf('')
    expect(board.tilt).toBe(0.5)
    expect(board.chromaCap.greenboard).toBe(BOARD_BASES.greenboard.maxChroma)
  })
  it('returns the same theme object when the settings are the defaults', () => {
    const theme = defaultTheme('light')
    expect(themeWithBoardSettings(theme, settingsOf(''))).toBe(theme)
  })
  it('re-derives the boards, and the key, when they are not', () => {
    const theme = defaultTheme('light')
    const next = themeWithBoardSettings(theme, settingsOf('@style-set: board.tilt 0'))
    expect(next).not.toBe(theme)
    expect(next.boards).toEqual(deriveBoards(theme.boardColours.accent, { tilt: 0 }))
    expect(next.key).not.toBe(theme.key)
  })
})

const orange = '#e07020'
describe('board settings through a figure', () => {
  it('board.tilt changes the greenboard in the SVG', () => {
    const theme = fromColours({ colours: { accent: orange } })
    const flat = paperOf(draw('@style: greenboard\n@style-set: board.tilt 0', LIGHT_PALETTE, theme))
    expect(flat).not.toBe(paperOf(draw('@style: greenboard', LIGHT_PALETTE, theme)))
    expect(flat).toBe(deriveBoards(theme.boardColours.accent, { tilt: 0 }).greenboard)
  })
  it('a chroma cap changes it too', () => {
    expect(paperOf(draw('@style: greenboard\n@style-set: board.greenboard.chromaCap 0.01'))).not.toBe(paperOf(draw('@style: greenboard')))
  })
  it('default settings leave the board as the theme derived it', () => {
    expect(paperOf(draw('@style: blackboard'))).toBe(defaultTheme('light').boards.blackboard)
  })
  it('light and dark hosts give a byte-equal board', () => {
    const head = '@style: blackboard\n@style-set: board.tilt 0.9'
    expect(paperOf(draw(head, DARK_PALETTE))).toBe(paperOf(draw(head, LIGHT_PALETTE)))
  })
})
