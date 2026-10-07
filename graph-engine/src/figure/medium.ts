import type { Palette } from '../render/palette'
import { saturate, toOklch } from '../style/color'
import { mediumSettingsOf } from '../style/layers'
import { MEDIA, type MediumColour, type MediumSettings } from '../style/media'
import { resolveFigureSettings, type StyleLayer } from '../style/resolve'
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
// caller) is drawn in the DEFAULT theme for its mode, `defaultTheme(mode)`, where the mode is
// dark when the palette's background is dark. That replaces the light/dark palette a styled
// figure used to fall back on to suit its paper; the clean medium keeps today's path, which is
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

// The theme the medium is fitted in. A paper medium fits to the paper it is drawn on: the
// theme's paper, or the tint the style asks for, or the board the style's paper is (ink on a
// blackboard is chalk-light, not unreadable).
function fittedTheme(theme: ThemeInput, surface: Hex): ThemeInput {
  return surface === theme.colours.paper ? theme : { ...theme, colours: { ...theme.colours, paper: surface } }
}

// The figure's medium, or null for the clean medium, whose colours are the host's palette
// exactly (the pen's own path).
//
// `palette` is the one the figure is drawn with: it decides the mode when no theme is given, and
// its slots tell the role's own colour from an author's. `settings` are the medium's settings
// (`figureMediumSettings`); missing ones take the medium's defaults.
export function figureMedium(style: Style, palette: Palette, theme?: ThemeInput, settings: MediumSettings = {}): FigureMedium | null {
  const name = style.colour.medium
  if (name === 'clean') return null
  const medium = MEDIA[name]
  const given = theme ?? defaultTheme(isDark(palette.background) ? 'dark' : 'light')

  // What the page is: a tint the style gives, else the board the paper is, else the medium's own surface.
  const board = boardOf(style.paper.type)
  const surface = normaliseHex(style.paper.tint === 'theme' ? null : style.paper.tint) ?? (board !== undefined ? given.boards[board] : medium.surfaceColour(given))
  const fitted = medium.surface === 'paper' ? fittedTheme(given, surface) : given

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
// stack resolveStyle reads, so a "@style-set: media.chalk.chroma 0.5" reaches the pen.
export function figureMediumSettings(style: Style, layers: readonly (StyleLayer | null | undefined)[]): MediumSettings {
  return mediumSettingsOf(resolveFigureSettings(layers), style.colour.medium)
}
