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
//
// Board media (chalk, whiteboard) must look the same in light and in dark, coloured
// roles included, so a theme also carries `boardColours`: its colours in LIGHT mode,
// which the boards derive from and the board media fit every role from. See
// `resolveBoardColours` for where they come from in dark mode.

import {
  BUILTIN_LIGHT,
  DEFAULT_DARK_GOOD_BAD,
  DEFAULT_DARK_TOKENS,
  DEFAULT_LIGHT_GOOD_BAD,
  DEFAULT_LIGHT_TOKENS,
  type BuiltinThemeId,
  type DefaultTokens,
} from './defaults'
import { BUILTIN_THEME_STYLES } from './builtinStyles'
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

// The style set of a built-in theme preset, by preset id: BUILTIN_THEME_STYLES
// (builtinStyles.ts). An empty set, and a preset that is not a built-in, bring no styles
// (undefined), so a theme with nothing to say keeps the key it has always had.
export type StylesFor = (presetId: string) => unknown

// A `StylesFor` that reads a table of style sets by preset id (the built-in one, below; a test's own).
export function stylesFromTable(table: Readonly<Record<string, unknown>>): StylesFor {
  return (presetId) => {
    if (!Object.prototype.hasOwnProperty.call(table, presetId)) return undefined
    const styles = table[presetId]
    return typeof styles === 'object' && styles !== null && Object.keys(styles).length === 0 ? undefined : styles
  }
}

export const stylesForPreset: StylesFor = stylesFromTable(BUILTIN_THEME_STYLES)

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

// The colours of one mode, resolved: whatever `source` gives, the rest from the default theme
// for the mode or derived from what was given.
function resolveColours(source: Partial<ThemeColours> | undefined, mode: Mode): ThemeColours {
  const fallback = defaultColours(mode)
  const given = givenColours(source)

  const surface = given.surface ?? fallback.surface
  const accent = given.accent ?? fallback.accent
  const good = given.good ?? fallback.good
  const bad = given.bad ?? fallback.bad

  // The series derives from the accent and the surface, with good and bad in
  // their nearest slots (fitted to 3:1 there; the theme's good and bad
  // themselves stay as given). An explicit series then wins slot by slot.
  const derived = deriveSeries({ accent, surface, mode, good, bad })
  const explicit = givenSeries(source?.series)
  const series = derived.map((hex, n) => explicit[n] ?? hex)

  return {
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
}

const copyColours = (colours: ThemeColours): ThemeColours => ({ ...colours, series: [...colours.series] })

// A colour set says something when it names at least one colour (an empty one is "none given").
function saysSomething(colours: Partial<ThemeColours> | undefined | null): colours is Partial<ThemeColours> {
  if (colours === undefined || colours === null || typeof colours !== 'object') return false
  return Object.keys(givenColours(colours)).length > 0 || givenSeries(colours.series).length > 0
}

// Whether `colours` are the default theme's in dark mode: each colour the app's default dark
// tokens carry (surface, ink, muted, line, lineStrong, accent, accentWash) is the token itself,
// and so are good and bad (the dark defaults, which is what the app's CSS sets). The series is
// not compared: a theme may give its own, which the default branch then keeps (see
// `resolveBoardColours`).
function isDefaultDark(colours: ThemeColours): boolean {
  const defaults = defaultColours('dark')
  return (['surface', 'ink', 'muted', 'line', 'lineStrong', 'accent', 'accentWash', 'good', 'bad'] as const).every((name) => colours[name] === defaults[name])
}

// The light mode of a built-in theme, as a colour set: its light tokens and its good and bad.
// The accent wash is left out, so it is derived exactly as `fromOsmosisTheme` derives it for the
// theme's light mode (a Palette carries no wash): the set is then the very one the theme resolves
// to in light mode.
function builtinLightColours(presetId: string): Partial<ThemeColours> | undefined {
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_LIGHT, presetId)) return undefined
  const { tokens, good, bad } = BUILTIN_LIGHT[presetId as BuiltinThemeId]
  const { accentWash: _wash, ...rest } = coloursOfTokens(tokens)
  return { ...rest, good: normaliseHex(good) ?? good, bad: normaliseHex(bad) ?? bad }
}

// The colours board media fit from: the theme's light mode, in either mode.
//   light mode  the theme's own colours.
//   dark mode   1. the source's `lightColours`, resolved as a light theme (what they leave out
//                  comes from the default light theme, or is derived);
//               2. else, if the theme is the default theme (its colours are the default dark
//                  tokens, good and bad included), the default theme's light colours, with the
//                  series the source gave, if it gave one;
//               3. else `colours` itself: a custom theme with no light colours given. That is
//                  INTERIM, until the theming overhaul supplies both modes: such a theme's boards
//                  and board media follow its dark colours.
// (`fromOsmosisTheme` turns a built-in theme's preset id into `lightColours`, which is 1.)
function resolveBoardColours(source: ThemeSource, mode: Mode, colours: ThemeColours): ThemeColours {
  if (mode === 'light') return copyColours(colours)
  if (saysSomething(source.lightColours)) return resolveColours(source.lightColours, 'light')
  if (isDefaultDark(colours)) return resolveColours({ series: source.colours?.series }, 'light')
  return copyColours(colours)
}

export function resolveTheme(source: ThemeSource = {}): ThemeInput {
  const mode: Mode = source.mode === 'dark' ? 'dark' : 'light'
  const colours = resolveColours(source.colours, mode)
  const boardColours = resolveBoardColours(source, mode, colours)

  // Boards depend on the board colours' accent alone (the light mode's: they do not change with
  // the mode); an explicit board wins, board by board.
  const derivedBoards = deriveBoards(boardColours.accent)
  const boards = {} as Record<BoardName, Hex>
  for (const name of BOARD_NAMES) boards[name] = normaliseHex(source.boards?.[name]) ?? derivedBoards[name]

  const family = source.lettering?.family
  const resolved: Omit<ThemeInput, 'key'> = {
    mode,
    colours,
    boardColours,
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
// A built-in preset (builtin:slate, forest, ember, plum) also brings its light
// colours (`lightColours`); the default theme needs none (see resolveBoardColours).
export function fromOsmosisTheme(
  palette: PaletteLike,
  mode: Mode,
  preset?: { id: string } | null,
  stylesFor: StylesFor = stylesForPreset,
): ThemeInput {
  return resolveTheme({
    mode,
    colours: coloursOfPalette(palette),
    // A built-in theme's light mode is known, so its boards and board media do not change with the mode.
    lightColours: preset ? builtinLightColours(preset.id) : undefined,
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
