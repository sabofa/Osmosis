import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../../render/palette'
import { fromOklch, toOklch } from '../color'
import { randomFor, type Random } from '../random'
import { defaultTheme, fromColours, fromOsmosisTheme, resolveTheme } from './adapter'
import { contrastRatio, fitLightness, relativeLuminance } from './contrast'
import { BUILTIN_DARK_PALETTE, BUILTIN_LIGHT_PALETTE, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, DEFAULT_TOKEN_NAMES } from './defaults'
import { GOLDEN_ANGLE, deriveBoards, deriveSeries, mixOklab, shortestAngle } from './derive'
import { BOARD_NAMES, COLOUR_KEYS, SERIES_COUNT, type Hex, type ThemeColours, type ThemeInput, type ThemeSource } from './types'

const HEX = /^#[0-9a-f]{6}$/

const hueDistance = (a: number, b: number) => Math.abs(shortestAngle(a, b))
const slotHue = (accent: Hex, n: number) => (toOklch(accent).h + n * GOLDEN_ANGLE) % 360

// Uniform OKLCH draws, as the ruling asks: L 0.1-0.95, C 0-0.2, h 0-360.
function randomColour(random: Random): Hex {
  return fromOklch({ l: random.range(0.1, 0.95), c: random.range(0, 0.2), h: random.range(0, 360) })
}

function randomColours(n: number): Pick<ThemeColours, 'surface' | 'ink' | 'muted' | 'line' | 'lineStrong' | 'accent'> {
  const random = randomFor('style/theme/test', n)
  return {
    surface: randomColour(random),
    accent: randomColour(random),
    ink: randomColour(random),
    muted: randomColour(random),
    line: randomColour(random),
    lineStrong: randomColour(random),
  }
}

const RANDOM_THEMES = Array.from({ length: 20 }, (_, n) => randomColours(n))

// A grey of a given 0-255 level.
const grey = (level: number): Hex => '#' + level.toString(16).padStart(2, '0').repeat(3)

function expectComplete(theme: ThemeInput) {
  expect(['light', 'dark']).toContain(theme.mode)
  for (const name of COLOUR_KEYS) expect(theme.colours[name], name).toMatch(HEX)
  expect(theme.colours.series).toHaveLength(SERIES_COUNT)
  for (const hex of theme.colours.series) expect(hex).toMatch(HEX)
  for (const name of BOARD_NAMES) expect(theme.boards[name], name).toMatch(HEX)
  expect(theme.media).toBeTypeOf('object')
  expect(theme.lettering).toHaveProperty('family')
  expect(theme.key).toMatch(/^[0-9a-f]{8}$/)
}

describe('WCAG contrast', () => {
  it('is 21 for black on white, 1 for a colour on itself, and order does not matter', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10)
    expect(contrastRatio('#c65d22', '#c65d22')).toBe(1)
  })

  it('matches the published values of relative luminance and of a grey on white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2158605, 6)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 3)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('reads #rgb as #rrggbb', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 10)
  })
})

describe('fitLightness', () => {
  it('leaves a colour that already meets the target exactly where it is', () => {
    const colour = { l: 0.3, c: 0.1, h: 40 }
    expect(fitLightness(colour, '#ffffff')).toBe(fromOklch(colour))
  })

  it('moves lightness away from the surface until the target is met, and no further', () => {
    const start = { l: 0.8, c: 0.1, h: 120 }
    const onWhite = fitLightness(start, '#ffffff')
    expect(contrastRatio(onWhite, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(toOklch(onWhite).l).toBeLessThan(start.l)
    // One 0.01 step back toward the start would not have met the target.
    const oneStepBack = fromOklch({ ...start, l: toOklch(onWhite).l + 0.01 })
    expect(contrastRatio(oneStepBack, '#ffffff')).toBeLessThan(3 + 0.2)

    const onBlack = fitLightness({ l: 0.2, c: 0.1, h: 120 }, '#000000')
    expect(contrastRatio(onBlack, '#000000')).toBeGreaterThanOrEqual(3)
    expect(toOklch(onBlack).l).toBeGreaterThan(0.2)
  })

  it('goes the other way when the way away from the surface cannot reach the target', () => {
    // A light-mid surface with the start just above it: lightening can never
    // reach 3:1 (white tops out near 2.3:1), darkening can.
    const surface = fromOklch({ l: 0.72, c: 0, h: 0 })
    expect(contrastRatio('#ffffff', surface)).toBeLessThan(3)
    const fitted = fitLightness({ l: 0.75, c: 0.1, h: 200 }, surface)
    expect(contrastRatio(fitted, surface)).toBeGreaterThanOrEqual(3)
    expect(toOklch(fitted).l).toBeLessThan(0.72)
  })

  it('terminates without throwing when the target cannot be met, keeping the best value', () => {
    const surface = '#808080'
    const fitted = fitLightness({ l: 0.5, c: 0.1, h: 30 }, surface, { target: 30 })
    expect(fitted).toMatch(HEX)
    // Black is the best this surface allows (5.3:1 against white's 4.0:1).
    expect(fitted).toBe('#000000')
    expect(contrastRatio(fitted, surface)).toBeLessThan(30)
    // Started at an edge it still ends.
    expect(fitLightness({ l: 0, c: 0, h: 0 }, '#000000', { target: 30 })).toMatch(HEX)
    expect(fitLightness({ l: 1, c: 0, h: 0 }, '#ffffff', { target: 30 })).toMatch(HEX)
  })
})

describe('derivations', () => {
  it('shortestAngle is the signed way round, in [-180, 180)', () => {
    expect(shortestAngle(230, 30)).toBeCloseTo(160, 10)
    expect(shortestAngle(350, 10)).toBeCloseTo(20, 10)
    expect(shortestAngle(10, 350)).toBeCloseTo(-20, 10)
    expect(shortestAngle(90, 90)).toBe(0)
  })

  it('mixes in OKLab, 0 giving the first colour and 1 the second', () => {
    expect(mixOklab('#c65d22', '#fdf6ea', 0)).toBe('#c65d22')
    expect(mixOklab('#c65d22', '#fdf6ea', 1)).toBe('#fdf6ea')
    const mid = toOklch(mixOklab('#000000', '#ffffff', 0.5))
    expect(mid.l).toBeCloseTo(0.5, 2)
  })

  it('spaces the series hues from the accent by golden-angle steps', () => {
    for (const [accent, surface, mode] of [
      ['#c65d22', '#fdf6ea', 'light'],
      ['#e2803f', '#201e15', 'dark'],
      ['#3b6ea8', '#ffffff', 'light'],
    ] as const) {
      const series = deriveSeries({ accent, surface, mode })
      expect(series).toHaveLength(SERIES_COUNT)
      series.forEach((hex, n) => {
        const { c, h } = toOklch(hex)
        expect(c, `${accent} slot ${n} chroma`).toBeGreaterThan(0.04)
        expect(hueDistance(h, slotHue(accent, n)), `${accent} slot ${n} hue`).toBeLessThan(4)
      })
    }
  })

  it('starts lightness at 0.55 in light and 0.75 in dark when contrast is already enough', () => {
    const light = deriveSeries({ accent: '#c65d22', surface: '#fdf6ea', mode: 'light' })
    const dark = deriveSeries({ accent: '#c65d22', surface: '#201e15', mode: 'dark' })
    // OKLCH lightness is perceptual, so every slot sits at (about) the start value, whatever its hue.
    for (const hex of light) expect(toOklch(hex).l).toBeCloseTo(0.55, 2)
    for (const hex of dark) expect(toOklch(hex).l).toBeCloseTo(0.75, 2)
  })

  it('takes series chroma from the accent, held between 0.08 and 0.16', () => {
    const grey = deriveSeries({ accent: '#808080', surface: '#ffffff', mode: 'light' })
    for (const hex of grey) expect(toOklch(hex).c).toBeGreaterThan(0.06)
    const vivid = deriveSeries({ accent: '#ff0000', surface: '#ffffff', mode: 'light' })
    for (const hex of vivid) expect(toOklch(hex).c).toBeLessThan(0.17)
  })

  it('tilts each board toward the accent hue by half the angle, at most 20 degrees', () => {
    const accent = fromOklch({ l: 0.6, c: 0.15, h: 200 })
    const accentHue = toOklch(accent).h
    const boards = deriveBoards(accent)
    // Green board is chromatic enough to read the hue back (base hue 160).
    const green = toOklch(boards.greenboard)
    const expectedGreen = 160 + Math.min(40, Math.max(-40, shortestAngle(160, accentHue))) * 0.5
    expect(hueDistance(green.h, expectedGreen)).toBeLessThan(3)
    expect(green.l).toBeCloseTo(0.33, 1)
    // Blackboard: base hue 230, accent 200 -> 215.
    const black = toOklch(boards.blackboard)
    expect(hueDistance(black.h, 230 + shortestAngle(230, accentHue) * 0.5)).toBeLessThan(15)
    expect(black.l).toBeCloseTo(0.27, 1)
    expect(toOklch(boards.whiteboard).l).toBeCloseTo(0.97, 1)
  })

  it('adds chroma with the accent chroma and caps it per board', () => {
    const vivid = deriveBoards(fromOklch({ l: 0.6, c: 0.2, h: 160 }))
    expect(toOklch(vivid.blackboard).c).toBeLessThanOrEqual(0.03 + 0.003)
    expect(toOklch(vivid.greenboard).c).toBeLessThanOrEqual(0.07 + 0.003)
    expect(toOklch(vivid.whiteboard).c).toBeLessThanOrEqual(0.012 + 0.003)
    expect(toOklch(vivid.greenboard).c).toBeCloseTo(0.062, 2)
    const grey = deriveBoards('#808080')
    expect(toOklch(grey.greenboard).c).toBeCloseTo(0.05, 2)
    expect(toOklch(grey.blackboard).c).toBeCloseTo(0.012, 2)
  })
})

describe('the bare system', () => {
  it('resolves every field for the light palette, from its eight colours', () => {
    const theme = fromOsmosisTheme(LIGHT_PALETTE, 'light')
    expectComplete(theme)
    expect(theme.mode).toBe('light')
    expect(theme.colours).toMatchObject({
      surface: '#fdf6ea',
      paper: '#fdf6ea',
      ink: '#17170f',
      muted: '#6b6558',
      line: '#e4e2d4',
      lineStrong: '#c9c6b3',
      accent: '#c65d22',
      good: '#4c7a4a',
      bad: '#a34b3f',
    })
    expect(theme.colours.accentWash).toBe(mixOklab('#c65d22', '#fdf6ea', 0.85))
  })

  it('resolves every field for the dark palette', () => {
    const theme = fromOsmosisTheme(DARK_PALETTE, 'dark')
    expectComplete(theme)
    expect(theme.mode).toBe('dark')
    expect(theme.colours).toMatchObject({
      surface: '#201e15',
      ink: '#f2efe2',
      muted: '#a39d8c',
      line: '#34311e',
      lineStrong: '#4a4530',
      accent: '#e2803f',
      good: '#6fa06c',
      bad: '#c76a5c',
    })
  })

  it('puts the palette\'s good and bad into the series at their nearest hue slots', () => {
    const theme = fromOsmosisTheme(LIGHT_PALETTE, 'light')
    expect(theme.colours.series).toContain('#4c7a4a')
    expect(theme.colours.series).toContain('#a34b3f')
  })

  it('resolves a source with only a mode, using that mode\'s built-in palette', () => {
    const light = resolveTheme({ mode: 'light' })
    const dark = resolveTheme({ mode: 'dark' })
    expectComplete(light)
    expectComplete(dark)
    expect(light.colours).toMatchObject({ surface: '#fdf6ea', ink: '#17170f', accent: '#c65d22', good: '#4c7a4a', bad: '#a34b3f' })
    expect(dark.colours).toMatchObject({ surface: '#201e15', ink: '#f2efe2', accent: '#e2803f', good: '#6fa06c', bad: '#c76a5c' })
    expect(resolveTheme({}).mode).toBe('light')
    expect(resolveTheme({}).colours).toEqual(light.colours)
    // Nothing the theme did not say is invented: with no good or bad given,
    // the series is the pure derivation.
    expect(light.colours.series).toEqual(deriveSeries({ accent: '#c65d22', surface: '#fdf6ea', mode: 'light' }))
  })

  it('has fromColours as the same door as resolveTheme', () => {
    const source: ThemeSource = { mode: 'dark', colours: { accent: '#3b6ea8' }, boards: { blackboard: '#101820' } }
    expect(fromColours(source)).toEqual(resolveTheme(source))
  })
})

describe('boards', () => {
  it('are byte-equal in light and in dark for the same colours (20 seeded random themes)', () => {
    for (const [n, colours] of RANDOM_THEMES.entries()) {
      const light = resolveTheme({ mode: 'light', colours })
      const dark = resolveTheme({ mode: 'dark', colours })
      expect(JSON.stringify(dark.boards), `theme ${n}`).toBe(JSON.stringify(light.boards))
    }
  })

  it('are byte-equal in light and dark for the same colours from the bare palette accent', () => {
    const colours = { accent: '#3b6ea8' }
    expect(resolveTheme({ mode: 'dark', colours }).boards).toEqual(resolveTheme({ mode: 'light', colours }).boards)
  })

  it('follow the accent only: a different surface leaves them alone', () => {
    const a = resolveTheme({ colours: { accent: '#3b6ea8', surface: '#ffffff' } })
    const b = resolveTheme({ colours: { accent: '#3b6ea8', surface: '#101010' } })
    expect(b.boards).toEqual(a.boards)
  })

  it('take an explicit board over the derived one, one board at a time', () => {
    const base = resolveTheme({ colours: { accent: '#3b6ea8' } })
    const set = resolveTheme({ colours: { accent: '#3b6ea8' }, boards: { greenboard: '#00FF00' } })
    expect(set.boards.greenboard).toBe('#00ff00')
    expect(set.boards.blackboard).toBe(base.boards.blackboard)
    expect(set.boards.whiteboard).toBe(base.boards.whiteboard)
  })
})

describe('series', () => {
  it('keep 3:1 contrast against the surface, in both modes (20 seeded random themes)', () => {
    for (const [n, colours] of RANDOM_THEMES.entries()) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = resolveTheme({ mode, colours })
        expect(theme.colours.series).toHaveLength(SERIES_COUNT)
        for (const [slot, hex] of theme.colours.series.entries()) {
          expect(contrastRatio(hex, theme.colours.surface), `theme ${n} ${mode} slot ${slot} ${hex} on ${theme.colours.surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('keep 3:1 on every grey surface, mid-greys included, in both modes', () => {
    for (let level = 0; level <= 255; level += 5) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = resolveTheme({ mode, colours: { surface: grey(level) } })
        for (const hex of theme.colours.series) {
          expect(contrastRatio(hex, grey(level)), `${mode} grey ${level} ${hex}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('give good and bad their nearest hue slots, never the same slot', () => {
    const accent = '#c65d22'
    const base = deriveSeries({ accent, surface: '#fdf6ea', mode: 'light' })
    const good = fromOklch({ l: 0.5, c: 0.12, h: slotHue(accent, 3) + 12 })
    const bad = fromOklch({ l: 0.5, c: 0.12, h: slotHue(accent, 6) - 9 })
    const theme = resolveTheme({ colours: { accent, good, bad } })
    const series = theme.colours.series
    expect(series[3]).toBe(good)
    expect(series[6]).toBe(bad)
    expect(new Set(series).size).toBe(SERIES_COUNT)
    series.forEach((hex, n) => {
      if (n !== 3 && n !== 6) expect(hex, `slot ${n}`).toBe(base[n])
    })
  })

  it('give bad the next nearest slot when both pick the same one', () => {
    const accent = '#c65d22'
    const base = deriveSeries({ accent, surface: '#fdf6ea', mode: 'light' })
    // Both sit near slot 2; good is closer to it.
    const good = fromOklch({ l: 0.5, c: 0.12, h: slotHue(accent, 2) + 2 })
    const bad = fromOklch({ l: 0.5, c: 0.12, h: slotHue(accent, 2) - 6 })
    const badHue = toOklch(bad).h
    const ranked = Array.from({ length: SERIES_COUNT }, (_, n) => n)
      .sort((a, b) => hueDistance(badHue, slotHue(accent, a)) - hueDistance(badHue, slotHue(accent, b)))
    expect(ranked[0]).toBe(2)
    const next = ranked[1]
    const series = resolveTheme({ colours: { accent, good, bad } }).colours.series
    expect(series[2]).toBe(good)
    expect(series[next]).toBe(bad)
    expect(new Set(series).size).toBe(SERIES_COUNT)
    series.forEach((hex, n) => {
      if (n !== 2 && n !== next) expect(hex, `slot ${n}`).toBe(base[n])
    })
  })

  it('give good alone its nearest slot', () => {
    const accent = '#3b6ea8'
    const good = fromOklch({ l: 0.55, c: 0.12, h: slotHue(accent, 1) })
    const series = resolveTheme({ colours: { accent, good } }).colours.series
    expect(series.indexOf(good)).toBe(1)
    expect(series.filter((hex) => hex === good)).toHaveLength(1)
  })

  it('take an explicit series over the derived one, filling the rest and cutting to 8', () => {
    const base = resolveTheme({ colours: { accent: '#3b6ea8' } }).colours.series
    const three = resolveTheme({ colours: { accent: '#3b6ea8', series: ['#FF0000', '#0f0', '#0000ff'] } }).colours.series
    expect(three.slice(0, 3)).toEqual(['#ff0000', '#00ff00', '#0000ff'])
    expect(three.slice(3)).toEqual(base.slice(3))
    const twelve = Array.from({ length: 12 }, (_, i) => grey(i * 20))
    expect(resolveTheme({ colours: { series: twelve } }).colours.series).toEqual(twelve.slice(0, 8))
  })
})

describe('overrides', () => {
  const base = resolveTheme({ mode: 'light' })
  const slice = (theme: ThemeInput) => ({
    surface: theme.colours.surface,
    paper: theme.colours.paper,
    ink: theme.colours.ink,
    muted: theme.colours.muted,
    line: theme.colours.line,
    lineStrong: theme.colours.lineStrong,
    accent: theme.colours.accent,
    accentWash: theme.colours.accentWash,
    good: theme.colours.good,
    bad: theme.colours.bad,
    series: theme.colours.series,
    boards: theme.boards,
    media: theme.media,
    lettering: theme.lettering,
    styles: theme.styles,
    mode: theme.mode,
  })
  const changedBy = (source: ThemeSource) => {
    const before = slice(base)
    const after = slice(resolveTheme({ mode: 'light', ...source }))
    return (Object.keys(before) as (keyof typeof before)[]).filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
  }

  // Each field changes what it names and whatever is derived from it, and nothing else.
  const TABLE: [string, ThemeSource, string[]][] = [
    ['surface', { colours: { surface: '#8a8a8a' } }, ['surface', 'paper', 'accentWash', 'series']],
    ['paper', { colours: { paper: '#f0e0c0' } }, ['paper']],
    ['ink', { colours: { ink: '#000033' } }, ['ink']],
    ['muted', { colours: { muted: '#555555' } }, ['muted']],
    ['line', { colours: { line: '#cccccc' } }, ['line']],
    ['lineStrong', { colours: { lineStrong: '#999999' } }, ['lineStrong']],
    ['accent', { colours: { accent: '#3b6ea8' } }, ['accent', 'accentWash', 'series', 'boards']],
    ['accentWash', { colours: { accentWash: '#ffeedd' } }, ['accentWash']],
    ['good', { colours: { good: '#00aa44' } }, ['good', 'series']],
    ['bad', { colours: { bad: '#cc0022' } }, ['bad', 'series']],
    ['series', { colours: { series: ['#112233', '#445566'] } }, ['series']],
    ['boards', { boards: { blackboard: '#101820' } }, ['boards']],
    ['media', { media: { chalk: { line: '#ffffff' } } }, ['media']],
    ['lettering', { lettering: { family: 'Caveat' } }, ['lettering']],
    ['styles', { styles: { all: { seed: 3 } } }, ['styles']],
  ]

  for (const [name, source, expected] of TABLE) {
    it(`${name} changes ${expected.join(', ')} and leaves the rest`, () => {
      expect(changedBy(source).sort()).toEqual([...expected].sort())
    })
  }

  it('takes the accent through to the boards and the series but leaves ink', () => {
    const set = resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8' } })
    expect(set.colours.accent).toBe('#3b6ea8')
    expect(set.colours.ink).toBe(base.colours.ink)
    expect(set.colours.series).not.toEqual(base.colours.series)
    expect(set.boards).not.toEqual(base.boards)
  })

  it('passes media, lettering and styles through', () => {
    const styles = { all: { seed: 3 } }
    const theme = resolveTheme({ media: { chalk: { line: '#FFF', label: '#abcdef' }, ink: {} }, lettering: { family: 'Caveat' }, styles })
    expect(theme.media).toEqual({ chalk: { line: '#ffffff', label: '#abcdef' } })
    expect(theme.lettering).toEqual({ family: 'Caveat' })
    expect(theme.styles).toBe(styles)
    expect(resolveTheme({}).styles).toBeUndefined()
    expect(resolveTheme({}).lettering).toEqual({ family: null })
    expect(resolveTheme({}).media).toEqual({})
  })

  it('reads #rgb and upper case, and ignores what is not a colour as if it were missing', () => {
    const theme = resolveTheme({
      colours: { accent: '#F0A', ink: 'banana', muted: '' } as unknown as Partial<ThemeColours>,
      media: { nope: { line: '#fff' }, ink: { line: 'x', bogus: '#fff' } } as unknown as ThemeSource['media'],
      mode: 'sepia' as unknown as 'light',
    })
    expect(theme.mode).toBe('light')
    expect(theme.colours.accent).toBe('#ff00aa')
    expect(theme.colours.ink).toBe(base.colours.ink)
    expect(theme.colours.muted).toBe(base.colours.muted)
    expect(theme.media).toEqual({})
  })
})

describe('the hook for the built-in style sets', () => {
  it('passes no styles by default, and the preset id to a given hook', () => {
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light', { id: 'builtin:slate' }).styles).toBeUndefined()
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light', null).styles).toBeUndefined()
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light').styles).toBeUndefined()
    const seen: string[] = []
    const styles = fromOsmosisTheme(LIGHT_PALETTE, 'light', { id: 'builtin:slate' }, (id) => {
      seen.push(id)
      return { id }
    }).styles
    expect(seen).toEqual(['builtin:slate'])
    expect(styles).toEqual({ id: 'builtin:slate' })
    fromOsmosisTheme(LIGHT_PALETTE, 'light', null, (id) => {
      seen.push(id)
      return null
    })
    expect(seen).toEqual(['builtin:slate'])
  })
})

describe('key', () => {
  const FULL: ThemeSource = {
    mode: 'light',
    colours: {
      surface: '#fdf6ea',
      paper: '#fbf8f0',
      ink: '#17170f',
      muted: '#6b6558',
      line: '#e4e2d4',
      lineStrong: '#c9c6b3',
      accent: '#c65d22',
      accentWash: '#faf1e9',
      good: '#4c7a4a',
      bad: '#a34b3f',
      series: ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080'],
    },
    boards: { blackboard: '#222a2e', greenboard: '#2c4a38', whiteboard: '#f4f6f8' },
    media: { chalk: { line: '#eeeeee' } },
    lettering: { family: 'Caveat' },
    styles: { all: { seed: 3 } },
  }

  // One unit: the blue channel up by one, or down by one when it is at 255.
  const bump = (hex: Hex): Hex => {
    const blue = parseInt(hex.slice(5, 7), 16)
    return hex.slice(0, 5) + (blue === 255 ? blue - 1 : blue + 1).toString(16).padStart(2, '0')
  }

  it('is eight hex digits and stable across calls', () => {
    const a = resolveTheme(FULL).key
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(resolveTheme(FULL).key).toBe(a)
    expect(resolveTheme(JSON.parse(JSON.stringify(FULL))).key).toBe(a)
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light').key).toBe(fromOsmosisTheme(LIGHT_PALETTE, 'light').key)
    expect(fromOsmosisTheme(LIGHT_PALETTE, 'light').key).not.toBe(fromOsmosisTheme(DARK_PALETTE, 'dark').key)
  })

  it('changes when any one colour changes by one unit', () => {
    const base = resolveTheme(FULL).key
    const seen = new Set([base])
    const colours = FULL.colours as ThemeColours
    for (const name of COLOUR_KEYS) {
      const key = resolveTheme({ ...FULL, colours: { ...colours, [name]: bump(colours[name]) } }).key
      expect(key, name).not.toBe(base)
      seen.add(key)
    }
    for (let i = 0; i < SERIES_COUNT; i++) {
      const series = colours.series.map((hex, n) => (n === i ? bump(hex) : hex))
      const key = resolveTheme({ ...FULL, colours: { ...colours, series } }).key
      expect(key, `series ${i}`).not.toBe(base)
      seen.add(key)
    }
    for (const name of BOARD_NAMES) {
      const boards = { ...FULL.boards, [name]: bump(FULL.boards![name]!) }
      const key = resolveTheme({ ...FULL, boards }).key
      expect(key, name).not.toBe(base)
      seen.add(key)
    }
    const media = resolveTheme({ ...FULL, media: { chalk: { line: '#eeeeef' } } }).key
    expect(media).not.toBe(base)
    seen.add(media)
    // Every one of them different from every other.
    expect(seen.size).toBe(1 + COLOUR_KEYS.length + SERIES_COUNT + BOARD_NAMES.length + 1)
  })

  it('also covers the mode, the lettering and the styles, and ignores the order of object keys', () => {
    const base = resolveTheme(FULL).key
    expect(resolveTheme({ ...FULL, mode: 'dark' }).key).not.toBe(base)
    expect(resolveTheme({ ...FULL, lettering: { family: 'Kalam' } }).key).not.toBe(base)
    expect(resolveTheme({ ...FULL, styles: { all: { seed: 4 } } }).key).not.toBe(base)
    expect(resolveTheme({ ...FULL, styles: undefined }).key).not.toBe(base)
    const ab = resolveTheme({ ...FULL, styles: { a: 1, b: { c: 2, d: 3 } } }).key
    const ba = resolveTheme({ ...FULL, styles: { b: { d: 3, c: 2 }, a: 1 } }).key
    expect(ab).toBe(ba)
  })

  it('is the same for the same random theme, run twice (determinism)', () => {
    for (const colours of RANDOM_THEMES) {
      expect(resolveTheme({ mode: 'dark', colours }).key).toBe(resolveTheme({ mode: 'dark', colours }).key)
      expect(JSON.stringify(resolveTheme({ mode: 'dark', colours }))).toBe(JSON.stringify(resolveTheme({ mode: 'dark', colours })))
    }
  })
})

describe('the default theme', () => {
  it('resolves every field for each mode, and keeps its key across calls', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = defaultTheme(mode)
      expectComplete(theme)
      expect(theme.mode).toBe(mode)
      expect(defaultTheme(mode).key).toBe(theme.key)
      expect(defaultTheme(mode)).toBe(theme)
      expect(JSON.stringify(defaultTheme(mode))).toBe(JSON.stringify(theme))
      expect(theme.styles).toBeUndefined()
      expect(theme.lettering).toEqual({ family: null })
    }
    expect(defaultTheme('light').key).not.toBe(defaultTheme('dark').key)
  })

  it('is the default tokens of the app, with good and bad from the built-in palette', () => {
    const light = defaultTheme('light').colours
    expect(light).toMatchObject({
      surface: DEFAULT_LIGHT_TOKENS['--surface'],
      paper: DEFAULT_LIGHT_TOKENS['--surface'],
      ink: DEFAULT_LIGHT_TOKENS['--ink'],
      muted: DEFAULT_LIGHT_TOKENS['--muted'],
      line: DEFAULT_LIGHT_TOKENS['--line'],
      lineStrong: DEFAULT_LIGHT_TOKENS['--line-strong'],
      accent: DEFAULT_LIGHT_TOKENS['--accent'],
      accentWash: DEFAULT_LIGHT_TOKENS['--accent-wash'],
      good: '#4c7a4a',
      bad: '#a34b3f',
    })
    const dark = defaultTheme('dark').colours
    expect(dark).toMatchObject({
      surface: DEFAULT_DARK_TOKENS['--surface'],
      paper: DEFAULT_DARK_TOKENS['--surface'],
      ink: DEFAULT_DARK_TOKENS['--ink'],
      muted: DEFAULT_DARK_TOKENS['--muted'],
      line: DEFAULT_DARK_TOKENS['--line'],
      lineStrong: DEFAULT_DARK_TOKENS['--line-strong'],
      accent: DEFAULT_DARK_TOKENS['--accent'],
      accentWash: DEFAULT_DARK_TOKENS['--accent-wash'],
      good: '#6fa06c',
      bad: '#c76a5c',
    })
    // The values themselves, so a typo in a constant and its copy cannot hide together.
    expect(light.surface).toBe('#ffffff')
    expect(light.accent).toBe('#c65d22')
    expect(dark.surface).toBe('#201e15')
    expect(dark.accent).toBe('#e2803f')
  })

  it('keeps 3:1 contrast on every series colour, good and bad included', () => {
    for (const mode of ['light', 'dark'] as const) {
      const { colours } = defaultTheme(mode)
      for (const hex of colours.series) expect(contrastRatio(hex, colours.surface), `${mode} ${hex}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('is shared, so it is frozen; a variation is its own resolve', () => {
    const theme = defaultTheme('light')
    expect(Object.isFrozen(theme)).toBe(true)
    expect(Object.isFrozen(theme.colours.series)).toBe(true)
    expect(Object.isFrozen(theme.boards)).toBe(true)
    expect(() => {
      theme.colours.series.push('#000000')
    }).toThrow()
    const own = resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8' } })
    expect(Object.isFrozen(own)).toBe(false)
  })

  it('keeps its copies of the built-in palettes equal to render/palette.ts', () => {
    const slots = (palette: Palette) => ({
      background: palette.background,
      curve: palette.curve,
      segment: palette.segment,
      point: palette.point,
      axis: palette.axis,
      grid: palette.grid,
      gridStrong: palette.gridStrong,
      muted: palette.muted,
    })
    expect(BUILTIN_LIGHT_PALETTE).toEqual(slots(LIGHT_PALETTE))
    expect(BUILTIN_DARK_PALETTE).toEqual(slots(DARK_PALETTE))
  })

  it('matches web/src/lib/themeTokens.ts, so the copy cannot drift', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../../web/src/lib/themeTokens.ts', import.meta.url)), 'utf8')
    const tokensOf = (name: string): Record<string, string> => {
      const start = text.indexOf(`export const ${name}`)
      expect(start, `${name} found in themeTokens.ts`).toBeGreaterThanOrEqual(0)
      const open = text.indexOf('{', start)
      const close = text.indexOf('}', open)
      const out: Record<string, string> = {}
      for (const [, key, value] of text.slice(open, close).matchAll(/'(--[a-z-]+)'\s*:\s*'([^']*)'/g)) out[key] = value
      return out
    }
    const light = tokensOf('DEFAULT_LIGHT_TOKENS')
    const dark = tokensOf('DEFAULT_DARK_TOKENS')
    expect(Object.keys(light).sort()).toEqual([...DEFAULT_TOKEN_NAMES].sort())
    expect(Object.keys(dark).sort()).toEqual([...DEFAULT_TOKEN_NAMES].sort())
    expect({ ...DEFAULT_LIGHT_TOKENS }).toEqual(light)
    expect({ ...DEFAULT_DARK_TOKENS }).toEqual(dark)
  })
})
