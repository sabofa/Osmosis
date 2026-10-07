import type { Palette } from '../render/palette'
import { saturate, toOklch } from '../style/color'
import { boardSettingsOf, mediumSettingsOf, themeWithBoardSettings, type ThemeStyles } from '../style/layers'
import { MEDIA, type MediumColour, type MediumSettings } from '../style/media'
import { resolveFigureSettings, type FigureGraphType, type StyleLayer } from '../style/resolve'
import { defaultTheme } from '../style/theme/adapter'
import { normaliseHex } from '../style/theme/contrast'
import { BOARD_NAMES, type BoardName, type Hex, type MediumName, type RoleKey, type ThemeInput } from '../style/theme/types'
import type { Style } from '../style/tokens'
import { cssColor, figureTheme } from './document'

// The medium in a figure: every colour a figure draws comes from the style's medium.
//
// A figure that is not clean draws in a medium (style/media/): ink, graphite, coloured pencil,
// marker, chalk or a whiteboard marker. The medium turns the theme and a ROLE (a line, an
// auxiliary line, a point, a label, a fill, the shading of a fill, the givens table, an author's
// own colour) into the colour it draws that role in, fitted to its own range and to its surface,
// and says the opacity one stroke of it is laid at. This module is the figure's side of that: it
// builds the theme the medium is given, and answers the pen's questions about a colour.
//
// There is no "no theme". A figure drawn without one (a node test, a contact sheet, an old
// caller) is drawn in the DEFAULT theme for its mode, `defaultTheme(mode)`, where the mode is the
// HOST's: dark when the host palette's background is dark (`mediumTheme`). It is never the mode of
// the surface the figure is drawn on, which a style may change (a board, a tint): a figure with no
// theme is byte for byte the figure with `defaultTheme(mode)`. That replaces the light/dark palette a
// styled figure used to fall back on to suit its paper; the clean medium keeps today's path, which is
// the host's own palette (see styledPen.ts).
//
// A board (blackboard, greenboard, whiteboard) never reads the mode: what is drawn on it is the
// same in light and in dark, the author's colours included.

// The role each colour of the pen is asked for in, and the palette slot a figure draws that
// role in when its author said nothing: a figure draws everything in the ink, except points and
// fills, which have a colour of their own. A colour that is not the slot's is an author's own.
const SLOT: Record<RoleKey, 'ink' | 'point' | 'region'> = {
  line: 'ink',
  hidden: 'ink',
  auxiliary: 'ink',
  label: 'ink',
  measure: 'ink',
  caption: 'ink',
  givens: 'ink',
  point: 'point',
  highlight: 'region',
  focus: 'region',
  fill: 'region',
  region: 'region',
  shading: 'region',
}

// A colour as the pen writes it: '#rrggbb' and the opacity it is laid at.
export interface MediumPaint {
  hex: string
  opacity: number
}

export interface FigureMedium {
  readonly name: MediumName
  // The colour of the page as drawn: the paper, or the board.
  readonly surface: Hex
  // The colour a role is drawn in, and the opacity of one stroke of it. `value` is the colour the
  // figure asked for: the role's own (the palette's slot for it) or an author's. Anything that is
  // not a '#rrggbb' colour (none, a pattern) passes through. The style's saturation is applied.
  paint(value: string, role: RoleKey): MediumPaint
  // The palette a figure is drawn against: the medium's colour for each role, its surface as the
  // background (render.ts resolves an author's named colours and the defaults against it).
  palette(): Palette
}

const HEX = /^#[0-9a-f]{6}$/

const numberOf = (hex: Hex): number => Number.parseInt(hex.slice(1), 16)

// Dark when the background is dark: the threshold the figure's own paper test has always used.
function isDark(background: number): boolean {
  return toOklch(cssColor(background)).l < 0.6
}

// The board a paper type names, if it does.
const boardOf = (type: string): BoardName | undefined => BOARD_NAMES.find((name) => name === type)

// The theme a figure's colours come from: the one given, else the default theme of the HOST's mode
// (dark when the host palette's background is dark). The one place the fallback is made, and render.ts
// makes it once from the host's own palette, so that every later reader sees the same theme.
export function mediumTheme(palette: Palette, theme?: ThemeInput): ThemeInput {
  return theme ?? defaultTheme(isDark(palette.background) ? 'dark' : 'light')
}

// The colour a style lays its paper in when it is not the theme's own: the tint the style names, else
// the theme's board when the paper is one (blackboard, greenboard, whiteboard); null for a paper that
// follows the theme. A board paper takes `theme.boards[type]` whatever the medium, the clean medium
// included, and the same in light and in dark.
export function paperColour(style: Style, palette: Palette, theme?: ThemeInput): Hex | null {
  const tint = normaliseHex(style.paper.tint === 'theme' ? null : style.paper.tint)
  if (tint !== null) return tint
  const board = boardOf(style.paper.type)
  return board === undefined ? null : mediumTheme(palette, theme).boards[board]
}

// Which side of the lightness scale a page is on.
const isDarkPage = (surface: Hex): boolean => toOklch(surface).l < 0.6

// The theme a PAPER medium is fitted in. It fits to the paper it is drawn on (the theme's paper, a
// tint the style asks for, or a board: ink on a blackboard is chalk-light, not unreadable), and takes
// its ink and its muted from the side of the lightness scale that PAPER is on. A theme's own ink and
// muted are the ones that read on the theme's own paper: on a page of the other side (a dark tint under
// a light theme, a blackboard under one, a light tint under a dark theme) they are the wrong ones, and
// fitting both to the page pushes them to the same colour. So there the ink and muted are the theme's
// light-mode ones (`boardColours`) for a light page, and the default dark theme's for a dark one (a
// theme's dark mode is not known to a light-mode theme, until the theming overhaul supplies both). A
// dark theme that gave no light colours has `boardColours` that are its own DARK ones (the interim
// fallback of the adapter), and then the light page takes the default light theme's, or the ink and the
// muted would be the dark theme's light ones on a light page and collapse again. The coloured roles
// (accent, bad, series, an author's own) are fitted by lightness from where they are, and need nothing.
function fittedTheme(theme: ThemeInput, surface: Hex): ThemeInput {
  const dark = isDarkPage(surface)
  const own =
    (theme.mode === 'dark') === dark
      ? theme.colours
      : dark
        ? defaultTheme('dark').colours
        : isDarkPage(theme.boardColours.paper)
          ? defaultTheme('light').colours
          : theme.boardColours
  if (surface === theme.colours.paper && own === theme.colours) return theme
  return { ...theme, colours: { ...theme.colours, paper: surface, ink: own.ink, muted: own.muted } }
}

// The theme a BOARD medium (chalk, the whiteboard marker) is fitted in. It is fitted to its own board, which is
// the page it is drawn on in its own looks; laid on another page (chalk on a whiteboard paper or a light tint, the
// marker on a blackboard or a dark tint) it is fitted to THAT page, as a paper medium is: its board is the page.
// It keeps its own range of lightness where the floor allows, and the media take the page's neutrals when the
// page is on the other side of the lightness scale from the board (style/media/fit.ts, `neutralsFor`). On
// its own board nothing changes, and a board is the same in light and in dark (the page is a board or a
// tint, never read from the mode).
function boardFittedTheme(theme: ThemeInput, board: BoardName, surface: Hex): ThemeInput {
  return theme.boards[board] === surface ? theme : { ...theme, boards: { ...theme.boards, [board]: surface } }
}

// The figure's medium, or null for the clean medium, whose colours are the host's palette
// exactly (the pen's own path).
//
// `palette` is the one the figure is drawn with: its slots tell the role's own colour from an
// author's, and with no theme given its background decides the mode (so it must be the HOST's palette
// then: render.ts resolves the theme from the host palette first and passes it, so the medium's own
// palette, whose background is the surface, never decides). `settings` are the medium's settings
// (`figureMediumSettings`); missing ones take the medium's defaults.
export function figureMedium(style: Style, palette: Palette, theme?: ThemeInput, settings: MediumSettings = {}): FigureMedium | null {
  const name = style.colour.medium
  if (name === 'clean') return null
  const medium = MEDIA[name]
  const given = mediumTheme(palette, theme)

  // What the page is: a tint the style gives, else the board the paper is, else the medium's own surface.
  const surface = paperColour(style, palette, given) ?? medium.surfaceColour(given)
  const fitted = medium.surface === 'paper' ? fittedTheme(given, surface) : boardFittedTheme(given, medium.surface, surface)

  const slots = figureTheme(palette)
  const saturation = style.colour.saturation
  const ink = style.colour.ink === 'theme' ? undefined : (normaliseHex(style.colour.ink) ?? undefined)
  const sat = (hex: Hex): Hex => (saturation === 1 ? hex : saturate(hex, saturation))

  const cache = new Map<string, MediumColour>()
  const colour = (role: RoleKey, own?: Hex): MediumColour => {
    const key = `${role}|${own ?? ''}`
    let found = cache.get(key)
    if (found === undefined) {
      found = medium.colour(fitted, own === undefined ? { key: role } : { key: role, colour: own }, settings)
      cache.set(key, found)
    }
    return found
  }

  return {
    name,
    surface,
    paint(value, role) {
      if (!HEX.test(value)) return { hex: value, opacity: 1 }
      // The page's own colour (the givens table's box) is the surface itself.
      if (value === slots.background) return { hex: sat(surface), opacity: 1 }
      const slot = SLOT[role]
      // The role's own colour is the medium's for the role (an ink the style names is its base);
      // anything else is an author's, and is fitted like every other base colour.
      const own = value === slots[slot] ? (slot === 'ink' ? ink : undefined) : value
      const drawn = colour(role, own)
      return { hex: sat(drawn.hex), opacity: drawn.opacity }
    },
    palette() {
      const line = numberOf(colour('line').hex)
      const auxiliary = numberOf(colour('auxiliary').hex)
      return {
        background: numberOf(surface),
        curve: numberOf(colour('highlight').hex),
        segment: line,
        point: numberOf(colour('point').hex),
        region: numberOf(colour('fill').hex),
        axis: line,
        grid: auxiliary,
        gridStrong: auxiliary,
        hover: numberOf(colour('focus').hex),
        muted: auxiliary,
      }
    },
  }
}

// The settings of the style's medium (media.<name>.<key>) as the layers resolve them: the same
// stack resolveStyle reads (a theme's style set included), so a "@style-set: media.chalk.chroma 0.5"
// in a figure, a document or a theme reaches the pen.
export function figureMediumSettings(
  style: Style,
  layers: readonly (StyleLayer | null | undefined)[],
  themeStyles?: ThemeStyles,
  graphType?: FigureGraphType
): MediumSettings {
  return mediumSettingsOf(resolveFigureSettings(layers, themeStyles, graphType), style.colour.medium)
}

// The theme with its boards drawn from the board settings (board.tilt, board.<name>.chromaCap) as the layers
// resolve them: the theme itself, the same object, at the defaults.
export function figureBoardTheme(
  theme: ThemeInput,
  layers: readonly (StyleLayer | null | undefined)[],
  themeStyles?: ThemeStyles,
  graphType?: FigureGraphType
): ThemeInput {
  return themeWithBoardSettings(theme, boardSettingsOf(resolveFigureSettings(layers, themeStyles, graphType)))
}
