// The theme adapter: the ONLY code that reads Osmosis's theme.
//
// Everything else in the style engines reads the `ThemeInput` this produces,
// never CSS, never a Palette. There are three ways in:
//
//   fromOsmosisTheme(palette, mode, preset?)  today's bare system: the resolved
//       Palette (the app's eight CSS colours for the mode) and a theme preset.
//   fromColours(source)                        plain colours, for the labs and tests.
//   resolveTheme(source)                       the same door, by its real name.
//   defaultTheme(mode)                         the default Osmosis theme, for a caller that has none.
//
// After the theming overhaul a new reader fills the same ThemeSource and
// nothing downstream changes. Every field of a ThemeSource is optional: what a
// theme leaves out comes from the built-in palette for the mode (the colours)
// or is derived from the colours it did give (derive.ts).

import { BUILTIN_DARK_PALETTE, BUILTIN_LIGHT_PALETTE, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, type DefaultTokens } from './defaults'
import { normaliseHex } from './contrast'
import { deriveAccentWash, deriveBoards, deriveSeries, themeKey } from './derive'
import {
  BOARD_NAMES,
  COLOUR_KEYS,
  MEDIUM_NAMES,
  ROLE_KEYS,
  type BoardName,
  type ColourKey,
  type Hex,
  type MediumColours,
  type MediumName,
  type PaletteLike,
  type ThemeColours,
  type ThemeInput,
  type ThemeSource,
} from './types'

type Mode = 'light' | 'dark'

// The colours a Palette carries, as a ThemeSource's colours. surface = background,
// ink = axis, line = grid, lineStrong = gridStrong, accent = curve,
// good = segment, bad = point.
type PaletteColours = Pick<ThemeColours, 'surface' | 'ink' | 'muted' | 'line' | 'lineStrong' | 'accent' | 'good' | 'bad'>

function hexOfNumber(value: number): Hex {
  return '#' + (value & 0xffffff).toString(16).padStart(6, '0')
}

function coloursOfPalette(palette: PaletteLike): PaletteColours {
  return {
    surface: hexOfNumber(palette.background),
    ink: hexOfNumber(palette.axis),
    muted: hexOfNumber(palette.muted),
    line: hexOfNumber(palette.grid),
    lineStrong: hexOfNumber(palette.gridStrong),
    accent: hexOfNumber(palette.curve),
    good: hexOfNumber(palette.segment),
    bad: hexOfNumber(palette.point),
  }
}

// The style set of a built-in theme preset, by preset id. Task 4 fills this
// from BUILTIN_THEME_STYLES (style/theme/builtinStyles.ts); until then a preset
// brings no styles.
export type StylesFor = (presetId: string) => unknown
export const stylesForPreset: StylesFor = () => undefined

// The single colours a source gives, as '#rrggbb', leaving out anything that
// is not a colour (it is treated as missing, so a bad value never breaks a graph).
function givenColours(colours: ThemeSource['colours']): Partial<Omit<ThemeColours, 'series'>> {
  const out: Partial<Record<ColourKey, Hex>> = {}
  if (colours === undefined || colours === null) return out
  for (const name of COLOUR_KEYS) {
    const hex = normaliseHex(colours[name])
    if (hex !== null) out[name] = hex
  }
  return out
}

function givenSeries(series: ThemeColours['series'] | undefined): Hex[] {
  if (!Array.isArray(series)) return []
  return series.map(normaliseHex).filter((hex): hex is Hex => hex !== null)
}

function givenMedia(media: ThemeSource['media']): ThemeInput['media'] {
  const out: ThemeInput['media'] = {}
  if (media === undefined || media === null) return out
  for (const name of MEDIUM_NAMES) {
    const roles = media[name]
    if (roles === undefined || roles === null) continue
    const coloured: MediumColours = {}
    for (const role of ROLE_KEYS) {
      const hex = normaliseHex(roles[role])
      if (hex !== null) coloured[role] = hex
    }
    if (Object.keys(coloured).length > 0) out[name as MediumName] = coloured
  }
  return out
}

// The colours the app's default tokens carry (the --surface, --ink, ... a theme
// preset would override), as a ThemeSource's colours. The tokens have no good
// or bad: those come from the palette, as everywhere else.
function coloursOfTokens(tokens: DefaultTokens): Pick<ThemeColours, 'surface' | 'ink' | 'muted' | 'line' | 'lineStrong' | 'accent' | 'accentWash'> {
  return {
    surface: tokens['--surface'],
    ink: tokens['--ink'],
    muted: tokens['--muted'],
    line: tokens['--line'],
    lineStrong: tokens['--line-strong'],
    accent: tokens['--accent'],
    accentWash: tokens['--accent-wash'],
  }
}

export function resolveTheme(source: ThemeSource = {}): ThemeInput {
  const mode: Mode = source.mode === 'dark' ? 'dark' : 'light'
  const bare = coloursOfPalette(mode === 'dark' ? BUILTIN_DARK_PALETTE : BUILTIN_LIGHT_PALETTE)
  const given = givenColours(source.colours)

  const surface = given.surface ?? bare.surface
  const accent = given.accent ?? bare.accent

  // The series derives from the accent and the surface; good and bad enter it
  // only when the theme itself set them. An explicit series then wins slot by slot.
  const derived = deriveSeries({ accent, surface, mode, good: given.good, bad: given.bad })
  const explicit = givenSeries(source.colours?.series)
  const series = derived.map((hex, n) => explicit[n] ?? hex)

  const colours: ThemeColours = {
    surface,
    paper: given.paper ?? surface,
    ink: given.ink ?? bare.ink,
    muted: given.muted ?? bare.muted,
    line: given.line ?? bare.line,
    lineStrong: given.lineStrong ?? bare.lineStrong,
    accent,
    accentWash: given.accentWash ?? deriveAccentWash(accent, surface),
    good: given.good ?? bare.good,
    bad: given.bad ?? bare.bad,
    series,
  }

  // Boards depend on the accent alone; an explicit board wins, board by board.
  const derivedBoards = deriveBoards(accent)
  const boards = {} as Record<BoardName, Hex>
  for (const name of BOARD_NAMES) boards[name] = normaliseHex(source.boards?.[name]) ?? derivedBoards[name]

  const family = source.lettering?.family
  const resolved: Omit<ThemeInput, 'key'> = {
    mode,
    colours,
    boards,
    media: givenMedia(source.media),
    styles: source.styles,
    lettering: { family: typeof family === 'string' && family !== '' ? family : null },
  }
  return { ...resolved, key: themeKey(resolved) }
}

// The labs' and the tests' door: plain colours in, a complete theme out.
export function fromColours(source: ThemeSource): ThemeInput {
  return resolveTheme(source)
}

// Today's bare system: the app's eight colours for the mode, as the host
// resolves them into a Palette, plus the built-in style set of a theme preset.
// good and bad are passed on as the theme's own, so they sit in the series.
export function fromOsmosisTheme(
  palette: PaletteLike,
  mode: Mode,
  preset?: { id: string } | null,
  stylesFor: StylesFor = stylesForPreset,
): ThemeInput {
  return resolveTheme({
    mode,
    colours: coloursOfPalette(palette),
    styles: preset ? stylesFor(preset.id) : undefined,
  })
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

const DEFAULT_THEMES: Partial<Record<Mode, ThemeInput>> = {}

// The default Osmosis theme for a mode: the app's default light or dark tokens
// (defaults.ts), with good and bad from the built-in palette. There is no "no
// theme": a caller that has none (a node test, a contact sheet, an old caller)
// gets this. It is a constant, so what it draws is deterministic.
//
// Built once per mode and shared, so it is frozen: a caller that wants a
// variation resolves its own theme (resolveTheme / fromColours).
export function defaultTheme(mode: Mode): ThemeInput {
  const which: Mode = mode === 'dark' ? 'dark' : 'light'
  const cached = DEFAULT_THEMES[which]
  if (cached !== undefined) return cached
  const palette = coloursOfPalette(which === 'dark' ? BUILTIN_DARK_PALETTE : BUILTIN_LIGHT_PALETTE)
  const tokens = coloursOfTokens(which === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS)
  const theme = deepFreeze(resolveTheme({ mode: which, colours: { ...tokens, good: palette.good, bad: palette.bad } }))
  DEFAULT_THEMES[which] = theme
  return theme
}
