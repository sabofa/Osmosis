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
// theme leaves out comes from the default theme for the mode (defaults.ts), or
// is derived from the colours it did give (derive.ts). There is no "no theme":
// resolveTheme({ mode }) IS defaultTheme(mode).

import {
  DEFAULT_DARK_GOOD_BAD,
  DEFAULT_DARK_TOKENS,
  DEFAULT_LIGHT_GOOD_BAD,
  DEFAULT_LIGHT_TOKENS,
  type DefaultTokens,
} from './defaults'
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
// preset would override), as a ThemeSource's colours.
function coloursOfTokens(tokens: DefaultTokens): Pick<ThemeColours, 'surface' | 'ink' | 'muted' | 'line' | 'lineStrong' | 'accent' | 'accentWash'> {
  const hex = (name: keyof DefaultTokens): Hex => normaliseHex(tokens[name]) ?? tokens[name]
  return {
    surface: hex('--surface'),
    ink: hex('--ink'),
    muted: hex('--muted'),
    line: hex('--line'),
    lineStrong: hex('--line-strong'),
    accent: hex('--accent'),
    accentWash: hex('--accent-wash'),
  }
}

// The default theme's colours for a mode, which fill whatever a source leaves
// out: the app's default tokens, with good and bad from the built-in palette
// (the tokens have none).
function defaultColours(mode: Mode): Omit<ThemeColours, 'paper' | 'series'> {
  const tokens = mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
  const goodBad = mode === 'dark' ? DEFAULT_DARK_GOOD_BAD : DEFAULT_LIGHT_GOOD_BAD
  return { ...coloursOfTokens(tokens), good: goodBad.good, bad: goodBad.bad }
}

export function resolveTheme(source: ThemeSource = {}): ThemeInput {
  const mode: Mode = source.mode === 'dark' ? 'dark' : 'light'
  const fallback = defaultColours(mode)
  const given = givenColours(source.colours)

  const surface = given.surface ?? fallback.surface
  const accent = given.accent ?? fallback.accent
  const good = given.good ?? fallback.good
  const bad = given.bad ?? fallback.bad

  // The series derives from the accent and the surface, with good and bad in
  // their nearest slots (fitted to 3:1 there; the theme's good and bad
  // themselves stay as given). An explicit series then wins slot by slot.
  const derived = deriveSeries({ accent, surface, mode, good, bad })
  const explicit = givenSeries(source.colours?.series)
  const series = derived.map((hex, n) => explicit[n] ?? hex)

  const colours: ThemeColours = {
    surface,
    paper: given.paper ?? surface,
    ink: given.ink ?? fallback.ink,
    muted: given.muted ?? fallback.muted,
    line: given.line ?? fallback.line,
    lineStrong: given.lineStrong ?? fallback.lineStrong,
    accent,
    // The default wash is the default accent laid on the default surface; with either one
    // changed it no longer is, so it is derived (accent 85% toward the surface) instead.
    accentWash:
      given.accentWash ?? (accent === fallback.accent && surface === fallback.surface ? fallback.accentWash : deriveAccentWash(accent, surface)),
    good,
    bad,
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
    // The styles are copied and frozen, so changing the source afterwards cannot change the
    // theme under its own key. They must be plain data (structuredClone).
    styles: source.styles === undefined ? undefined : deepFreeze(structuredClone(source.styles)),
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

// The default Osmosis theme for a mode: the app's default light or dark tokens,
// with good and bad from the built-in palette (defaults.ts). There is no "no
// theme": a caller that has none (a node test, a contact sheet, an old caller)
// gets this, and so does a source that says nothing (`resolveTheme({ mode })`
// is this, field for field). It is a constant, so what it draws is deterministic.
//
// Built once per mode and shared, so it is frozen: a caller that wants a
// variation resolves its own theme (resolveTheme / fromColours).
export function defaultTheme(mode: Mode): ThemeInput {
  const which: Mode = mode === 'dark' ? 'dark' : 'light'
  const cached = DEFAULT_THEMES[which]
  if (cached !== undefined) return cached
  const theme = deepFreeze(resolveTheme({ mode: which }))
  DEFAULT_THEMES[which] = theme
  return theme
}
