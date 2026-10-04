import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fromOklch } from '../color'
import { randomFor } from '../random'
import { defaultTheme, fromColours, fromOsmosisTheme, resolveTheme } from './adapter'
import { BUILTIN_LIGHT, BUILTIN_THEME_IDS, DEFAULT_DARK_GOOD_BAD, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, type DefaultTokens } from './defaults'
import { deriveBoards } from './derive'
import { COLOUR_KEYS, SERIES_COUNT, type Hex, type PaletteLike, type ThemeColours } from './types'

const HEX = /^#[0-9a-f]{6}$/
const num = (hex: Hex) => parseInt(hex.slice(1), 16)

// A Palette of the eight colours a host reads for a theme, as the host resolves them.
function paletteOf(tokens: DefaultTokens, good: Hex, bad: Hex): PaletteLike {
  return {
    background: num(tokens['--surface']),
    curve: num(tokens['--accent']),
    segment: num(good),
    point: num(bad),
    axis: num(tokens['--ink']),
    grid: num(tokens['--line']),
    gridStrong: num(tokens['--line-strong']),
    muted: num(tokens['--muted']),
  }
}

function expectCompleteColours(colours: ThemeColours) {
  for (const name of COLOUR_KEYS) expect(colours[name], name).toMatch(HEX)
  expect(colours.series).toHaveLength(SERIES_COUNT)
  for (const hex of colours.series) expect(hex).toMatch(HEX)
}

// A theme's colours, vivid and varied, from a seed.
function randomColours(n: number): Partial<ThemeColours> {
  const random = randomFor('style/theme/boardColours', n)
  const pick = () => fromOklch({ l: random.range(0.1, 0.95), c: random.range(0.02, 0.2), h: random.range(0, 360) })
  return { surface: pick(), ink: pick(), muted: pick(), accent: pick(), good: pick(), bad: pick(), series: Array.from({ length: SERIES_COUNT }, pick) }
}

describe('boardColours: the colour set board media fit from, always the theme\'s light mode', () => {
  it('is the colours themselves in light mode (a copy, so changing one cannot change the other)', () => {
    for (const theme of [resolveTheme({ mode: 'light' }), resolveTheme({ mode: 'light', colours: randomColours(1) }), defaultTheme('light')]) {
      expectCompleteColours(theme.boardColours)
      expect(theme.boardColours).toEqual(theme.colours)
      expect(theme.boardColours).not.toBe(theme.colours)
      expect(theme.boardColours.series).not.toBe(theme.colours.series)
    }
  })

  it('ignores lightColours in light mode: the colours are the light ones', () => {
    const colours = randomColours(2)
    const without = resolveTheme({ mode: 'light', colours })
    const withLight = resolveTheme({ mode: 'light', colours, lightColours: randomColours(3) })
    expect(withLight.boardColours).toEqual(without.colours)
    expect(withLight.key).toBe(without.key)
  })

  describe('in dark mode', () => {
    it('is the source\'s lightColours, resolved as a light theme (1)', () => {
      for (let n = 0; n < 10; n++) {
        const dark = randomColours(2 * n)
        const light = randomColours(2 * n + 1)
        const theme = resolveTheme({ mode: 'dark', colours: dark, lightColours: light })
        expect(theme.boardColours).toEqual(resolveTheme({ mode: 'light', colours: light }).colours)
        // And the dark colours stay the dark ones.
        expect(theme.colours).toEqual(resolveTheme({ mode: 'dark', colours: dark }).colours)
        expectCompleteColours(theme.boardColours)
      }
    })

    it('takes what a partial lightColours leaves out from the default light theme, or derives it', () => {
      const theme = resolveTheme({ mode: 'dark', colours: randomColours(5), lightColours: { accent: '#3b6ea8' } })
      const light = defaultTheme('light').colours
      expect(theme.boardColours.accent).toBe('#3b6ea8')
      expect(theme.boardColours.ink).toBe(light.ink)
      expect(theme.boardColours.surface).toBe(light.surface)
      expect(theme.boardColours).toEqual(resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8' } }).colours)
    })

    it('ignores a lightColours that names no colour, or only bad ones, and falls back (3 or 4)', () => {
      const colours = randomColours(6)
      const plain = resolveTheme({ mode: 'dark', colours })
      for (const lightColours of [{}, { accent: 'red' }, { surface: '#12345' }, { series: [] }, null as never, undefined]) {
        const theme = resolveTheme({ mode: 'dark', colours, lightColours })
        expect(theme.boardColours, JSON.stringify(lightColours)).toEqual(plain.colours)
        expect(theme.key, JSON.stringify(lightColours)).toBe(plain.key)
      }
    })

    it('is the default theme\'s light colours for the default theme (2)', () => {
      for (const theme of [defaultTheme('dark'), resolveTheme({ mode: 'dark' }), fromColours({ mode: 'dark', colours: { ...tokensAsColours(DEFAULT_DARK_TOKENS) } })]) {
        expect(theme.boardColours).toEqual(defaultTheme('light').colours)
        expect(theme.colours).not.toEqual(defaultTheme('light').colours)
      }
      expect(Object.isFrozen(defaultTheme('dark').boardColours)).toBe(true)
      expect(Object.isFrozen(defaultTheme('dark').boardColours.series)).toBe(true)
    })

    it('is the default theme\'s light colours for the host\'s default theme (the default tokens, and the good and bad the app\'s CSS sets in dark)', () => {
      const theme = fromOsmosisTheme(paletteOf(DEFAULT_DARK_TOKENS, DEFAULT_DARK_GOOD_BAD.good, DEFAULT_DARK_GOOD_BAD.bad), 'dark')
      expect(theme.boardColours).toEqual(defaultTheme('light').colours)
      expect(theme.colours.good).toBe(DEFAULT_DARK_GOOD_BAD.good)
    })

    it('is not the default theme\'s when its good or its bad is its own: the boards and what is drawn on them follow its own colours', () => {
      const dark = tokensAsColours(DEFAULT_DARK_TOKENS)
      for (const own of [{ bad: '#00ffff' }, { good: '#ff00ff' }, { good: '#2e9e5b', bad: '#d94a3a' }]) {
        const theme = fromColours({ mode: 'dark', colours: { ...dark, ...own } })
        expect(theme.boardColours, JSON.stringify(own)).toEqual(theme.colours)
        expect(theme.boardColours, JSON.stringify(own)).not.toEqual(defaultTheme('light').colours)
        expect(theme.boards, JSON.stringify(own)).toEqual(deriveBoards(theme.colours.accent))
        // Through the host's door, too.
        const palette = paletteOf(DEFAULT_DARK_TOKENS, own.good ?? DEFAULT_DARK_GOOD_BAD.good, own.bad ?? DEFAULT_DARK_GOOD_BAD.bad)
        expect(fromOsmosisTheme(palette, 'dark').boardColours, `${JSON.stringify(own)} fromOsmosisTheme`).toEqual(fromOsmosisTheme(palette, 'dark').colours)
      }
      // The dark default itself still is the default.
      expect(fromColours({ mode: 'dark', colours: { ...dark, ...DEFAULT_DARK_GOOD_BAD } }).boardColours).toEqual(defaultTheme('light').colours)
    })

    it('keeps the series a default-tokens theme gives, in the default theme\'s light colours (the rest of them the default\'s)', () => {
      const dark = tokensAsColours(DEFAULT_DARK_TOKENS)
      const series = ['#ff0000', '#00aa00', '#0000ff', '#aa00aa', '#00aaaa', '#aaaa00', '#555555', '#ff8800']
      const theme = fromColours({ mode: 'dark', colours: { ...dark, series } })
      const plain = defaultTheme('light').colours
      expect(theme.boardColours.series).toEqual(series)
      expect(theme.boardColours).toEqual({ ...plain, series })
      expect(theme.boardColours).not.toEqual(plain)
      expect(theme.colours.series).toEqual(series)
      // The boards follow the light accent, as the default's do.
      expect(theme.boards).toEqual(defaultTheme('light').boards)
      // A series that names only some slots: those slots, the rest as the light default derives them.
      const some = fromColours({ mode: 'dark', colours: { ...dark, series: ['#ff0000', '#00aa00', '#0000ff'] } }).boardColours.series
      expect(some.slice(0, 3)).toEqual(['#ff0000', '#00aa00', '#0000ff'])
      expect(some.slice(3)).toEqual(plain.series.slice(3))
      // An empty or invalid series changes nothing, and the same series in light mode gives the same colours.
      expect(fromColours({ mode: 'dark', colours: { ...dark, series: [] } }).boardColours).toEqual(plain)
      expect(fromColours({ mode: 'dark', colours: { ...dark, series: ['red', 12 as never] } }).boardColours).toEqual(plain)
      expect(fromColours({ mode: 'dark', colours: { ...dark, series } }).boardColours.series).toEqual(fromColours({ mode: 'light', colours: { series } }).colours.series)
    })

    it('does not carry a series into a theme that is not the default: its own colours are its board colours', () => {
      const series = ['#ff0000', '#00aa00', '#0000ff', '#aa00aa', '#00aaaa', '#aaaa00', '#555555', '#ff8800']
      const theme = fromColours({ mode: 'dark', colours: { ...tokensAsColours(DEFAULT_DARK_TOKENS), bad: '#00ffff', series } })
      expect(theme.boardColours).toEqual(theme.colours)
    })

    it('is not the default theme\'s the moment one token differs', () => {
      const dark = tokensAsColours(DEFAULT_DARK_TOKENS)
      for (const name of ['surface', 'ink', 'muted', 'line', 'lineStrong', 'accent', 'accentWash', 'good', 'bad'] as const) {
        const changed = { ...dark, [name]: name === 'surface' ? '#202020' : '#abcdef' }
        const theme = fromColours({ mode: 'dark', colours: changed })
        expect(theme.boardColours, name).toEqual(theme.colours)
        expect(theme.boardColours, name).not.toEqual(defaultTheme('light').colours)
      }
    })

    it('is the colours themselves for a custom theme with no light colours: interim, until the theming overhaul supplies both modes (4)', () => {
      for (let n = 0; n < 5; n++) {
        const theme = resolveTheme({ mode: 'dark', colours: randomColours(n) })
        expect(theme.boardColours).toEqual(theme.colours)
        expect(theme.boardColours).not.toBe(theme.colours)
      }
    })

    it('is the light tokens of a built-in theme, by preset id, through fromOsmosisTheme (3): the colours the theme resolves to in light mode', () => {
      for (const id of BUILTIN_THEME_IDS) {
        const { tokens, good, bad } = BUILTIN_LIGHT[id]
        const darkTokens = darkTokensOf(id)
        const dark = fromOsmosisTheme(paletteOf(darkTokens, good, bad), 'dark', { id })
        const light = fromOsmosisTheme(paletteOf(tokens, good, bad), 'light', { id })
        expect(dark.boardColours, id).toEqual(light.colours)
        expect(dark.colours, id).not.toEqual(light.colours)
        expect(dark.boardColours.surface, id).toBe(tokens['--surface'])
        expect(dark.boardColours.accent, id).toBe(tokens['--accent'])
        expect(dark.boardColours.good, id).toBe(good)
        expectCompleteColours(dark.boardColours)
        // The key follows the board colours: the same dark colours with no preset have another one.
        expect(dark.key, id).not.toBe(fromOsmosisTheme(paletteOf(darkTokens, good, bad), 'dark').key)
      }
    })

    it('falls back for a preset that is not a built-in one', () => {
      const tokens = darkTokensOf('builtin:slate')
      for (const preset of [{ id: 'builtin:nonesuch' }, { id: 'user:12' }, { id: 'toString' }, { id: '__proto__' }, null, undefined]) {
        const theme = fromOsmosisTheme(paletteOf(tokens, '#3f7d5a', '#b0473f'), 'dark', preset)
        expect(theme.boardColours, JSON.stringify(preset)).toEqual(theme.colours)
      }
    })

    it('takes lightColours over a built-in theme\'s: the source\'s own light colours come first', () => {
      const theme = resolveTheme({ mode: 'dark', colours: randomColours(8), lightColours: { accent: '#123456' } })
      expect(theme.boardColours.accent).toBe('#123456')
    })
  })

  it('goes into the key: another light set, another key (and another dark set, with the same light one, too)', () => {
    const dark = randomColours(1)
    const a = resolveTheme({ mode: 'dark', colours: dark, lightColours: randomColours(2) })
    const b = resolveTheme({ mode: 'dark', colours: dark, lightColours: randomColours(3) })
    const c = resolveTheme({ mode: 'dark', colours: dark })
    const d = resolveTheme({ mode: 'dark', colours: randomColours(4), lightColours: randomColours(2) })
    expect(new Set([a.key, b.key, c.key, d.key]).size).toBe(4)
    expect(resolveTheme({ mode: 'dark', colours: dark, lightColours: randomColours(2) }).key).toBe(a.key)
    // One unit of one light colour.
    const light = randomColours(2)
    const bumped = { ...light, ink: bump(light.ink!) }
    expect(resolveTheme({ mode: 'dark', colours: dark, lightColours: bumped }).key).not.toBe(a.key)
  })
})

describe('the boards follow the board colours, so a board is the same in light and in dark', () => {
  it('are byte-equal in light and dark for the default theme', () => {
    expect(defaultTheme('dark').boards).toEqual(defaultTheme('light').boards)
    expect(JSON.stringify(defaultTheme('dark').boards)).toBe(JSON.stringify(defaultTheme('light').boards))
  })

  it('are byte-equal in light and dark for each built-in theme', () => {
    for (const id of BUILTIN_THEME_IDS) {
      const { tokens, good, bad } = BUILTIN_LIGHT[id]
      const dark = fromOsmosisTheme(paletteOf(darkTokensOf(id), good, bad), 'dark', { id })
      const light = fromOsmosisTheme(paletteOf(tokens, good, bad), 'light', { id })
      expect(JSON.stringify(dark.boards), id).toBe(JSON.stringify(light.boards))
    }
  })

  it('are byte-equal in light and dark for a custom theme with lightColours, and derive from the light accent', () => {
    for (let n = 0; n < 20; n++) {
      const dark = randomColours(2 * n)
      const light = randomColours(2 * n + 1)
      const darkTheme = resolveTheme({ mode: 'dark', colours: dark, lightColours: light })
      const lightTheme = resolveTheme({ mode: 'light', colours: light })
      expect(JSON.stringify(darkTheme.boards), String(n)).toBe(JSON.stringify(lightTheme.boards))
      expect(darkTheme.boards).toEqual(deriveBoards(lightTheme.colours.accent))
    }
  })

  it('stay as given when a source gives them, in both modes', () => {
    const boards = { blackboard: '#222a2e', greenboard: '#2c4a38', whiteboard: '#f4f6f8' }
    for (const mode of ['light', 'dark'] as const) {
      expect(resolveTheme({ mode, boards }).boards).toEqual(boards)
    }
  })
})

describe('the light tokens of the built-in themes match web/src/lib/builtinThemes.ts, so the copy cannot drift', () => {
  const text = readFileSync(fileURLToPath(new URL('../../../../web/src/lib/builtinThemes.ts', import.meta.url)), 'utf8')

  // The theme blocks, by id: from one `id: 'builtin:` to the next.
  const starts = [...text.matchAll(/id:\s*'(builtin:[a-z]+)'/g)].map((m) => ({ id: m[1], at: m.index! }))
  const blocks = Object.fromEntries(starts.map((s, n) => [s.id, text.slice(s.at, starts[n + 1]?.at ?? text.length)]))

  const tokensIn = (block: string, mode: 'light' | 'dark'): Record<string, string> => {
    const start = block.indexOf(`${mode}: {`)
    expect(start, `${mode} found`).toBeGreaterThanOrEqual(0)
    const open = block.indexOf('{', start)
    const close = block.indexOf('}', open)
    const out: Record<string, string> = {}
    for (const [, key, value] of block.slice(open, close).matchAll(/'(--[a-z-]+)'\s*:\s*'([^']*)'/g)) out[key] = value
    return out
  }

  it('finds the four built-in themes, in the copy and in the app', () => {
    expect(Object.keys(blocks).sort()).toEqual([...BUILTIN_THEME_IDS].sort())
    expect(Object.keys(BUILTIN_LIGHT).sort()).toEqual([...BUILTIN_THEME_IDS].sort())
  })

  for (const id of BUILTIN_THEME_IDS) {
    it(`${id}: the light tokens, --good and --bad are the app's`, () => {
      const block = blocks[id]
      expect({ ...BUILTIN_LIGHT[id].tokens }).toEqual(tokensIn(block, 'light'))
      expect(BUILTIN_LIGHT[id].good).toBe(/--good:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1])
      expect(BUILTIN_LIGHT[id].bad).toBe(/--bad:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1])
    })
  }

  it('has the same eight token names as the default tokens', () => {
    for (const id of BUILTIN_THEME_IDS) expect(Object.keys(BUILTIN_LIGHT[id].tokens).sort()).toEqual(Object.keys(DEFAULT_LIGHT_TOKENS).sort())
  })
})

// --- helpers --------------------------------------------------------------

// The seven colours a set of tokens carries, as a source's colours.
function tokensAsColours(tokens: DefaultTokens): Partial<ThemeColours> {
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

// A built-in theme's DARK tokens, read from the app's file (the copy only keeps the light ones).
function darkTokensOf(id: string): DefaultTokens {
  const text = readFileSync(fileURLToPath(new URL('../../../../web/src/lib/builtinThemes.ts', import.meta.url)), 'utf8')
  const block = text.slice(text.indexOf(`id: '${id}'`))
  const start = block.indexOf('dark: {')
  const open = block.indexOf('{', start)
  const close = block.indexOf('}', open)
  const out: Record<string, string> = {}
  for (const [, key, value] of block.slice(open, close).matchAll(/'(--[a-z-]+)'\s*:\s*'([^']*)'/g)) out[key] = value
  return out as unknown as DefaultTokens
}

// One unit: the blue channel up by one, or down by one when it is at 255.
function bump(hex: Hex): Hex {
  const blue = parseInt(hex.slice(5, 7), 16)
  return hex.slice(0, 5) + (blue === 255 ? blue - 1 : blue + 1).toString(16).padStart(2, '0')
}
