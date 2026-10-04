import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../../render/palette'
import { fromOklch, toOklch } from '../color'
import { randomFor, type Random } from '../random'
import { defaultTheme, fromColours, fromOsmosisTheme, resolveTheme } from './adapter'
import { contrastRatio, fitLightness, relativeLuminance } from './contrast'
import { DEFAULT_DARK_GOOD_BAD, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_GOOD_BAD, DEFAULT_LIGHT_TOKENS, DEFAULT_TOKEN_NAMES } from './defaults'
import { GOLDEN_ANGLE, deriveBoards, deriveSeries, mixOklab, shortestAngle } from './derive'
import { BOARD_NAMES, COLOUR_KEYS, SERIES_COUNT, type Hex, type ThemeColours, type ThemeInput, type ThemeSource } from './types'

const HEX = /^#[0-9a-f]{6}$/

const hueDistance = (a: number, b: number) => Math.abs(shortestAngle(a, b))
const slotHue = (accent: Hex, n: number) => (toOklch(accent).h + n * GOLDEN_ANGLE) % 360

// Distance between two colours in OKLab, and each 0-255 channel of a hex.
function deltaE(a: Hex, b: Hex): number {
  const lab = (hex: Hex) => {
    const { l, c, h } = toOklch(hex)
    const angle = (h * Math.PI) / 180
    return [l, c * Math.cos(angle), c * Math.sin(angle)]
  }
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
const channelsOf = (hex: Hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
// A vivid accent of a given hue (and chroma), as hex.
const accentAt = (h: number, c = 0.15): Hex => fromOklch({ l: 0.6, c, h })

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

  it('refuses a step that is not above 0, which would never end', () => {
    for (const step of [0, -0.01, NaN]) {
      expect(() => fitLightness({ l: 0.5, c: 0.1, h: 30 }, '#ffffff', { step, target: 30 }), String(step)).toThrow(RangeError)
    }
    expect(fitLightness({ l: 0.9, c: 0.1, h: 30 }, '#ffffff', { step: 0.05 })).toMatch(HEX)
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

  it("starts the series from the default theme's accent hue when the accent has no hue (chroma under 0.02)", () => {
    for (const [mode, surface, defaultAccent] of [
      ['light', '#ffffff', DEFAULT_LIGHT_TOKENS['--accent']],
      ['dark', '#201e15', DEFAULT_DARK_TOKENS['--accent']],
    ] as const) {
      const grey = deriveSeries({ accent: '#808080', surface, mode })
      const black = deriveSeries({ accent: '#000000', surface, mode })
      const near = deriveSeries({ accent: accentAt(200, 0.015), surface, mode })
      expect(black, mode).toEqual(grey)
      expect(near, mode).toEqual(grey)
      grey.forEach((hex, n) => {
        expect(hueDistance(toOklch(hex).h, slotHue(defaultAccent, n)), `${mode} slot ${n}`).toBeLessThan(4)
      })
      // With chroma, the accent's own hue again.
      const tinted = deriveSeries({ accent: accentAt(200, 0.05), surface, mode })
      expect(hueDistance(toOklch(tinted[0]).h, 200), mode).toBeLessThan(4)
    }
  })

  it('keeps the slots unique when good and bad are the same colour', () => {
    const good = '#4c7a4a'
    const series = deriveSeries({ accent: '#c65d22', surface: '#ffffff', mode: 'light', good, bad: good })
    expect(new Set(series).size).toBe(SERIES_COUNT)
    expect(series.filter((hex) => hex === good)).toHaveLength(1)
    // Through the adapter, too (a theme whose bad is its good).
    const resolved = resolveTheme({ colours: { good, bad: good } })
    expect(new Set(resolved.colours.series).size).toBe(SERIES_COUNT)
    expect(resolved.colours.bad).toBe(good)
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
    // A Palette has no wash. This palette's surface is not the default theme's, so the wash is
    // derived (the default wash needs the default accent AND the default surface; see below).
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

  it('resolves a source with only a mode to the default theme for that mode, field by field', () => {
    for (const mode of ['light', 'dark'] as const) {
      const resolved = resolveTheme({ mode })
      const fallback = defaultTheme(mode)
      expectComplete(resolved)
      expect(resolved.mode).toBe(fallback.mode)
      for (const name of COLOUR_KEYS) expect(resolved.colours[name], `${mode} ${name}`).toBe(fallback.colours[name])
      expect(resolved.colours.series, `${mode} series`).toEqual(fallback.colours.series)
      expect(resolved.boards, `${mode} boards`).toEqual(fallback.boards)
      expect(resolved.media).toEqual(fallback.media)
      expect(resolved.lettering).toEqual(fallback.lettering)
      expect(resolved.styles).toBe(fallback.styles)
      expect(resolved.key, `${mode} key`).toBe(fallback.key)
      expect(resolved).toEqual(fallback)
    }
    expect(resolveTheme({}).mode).toBe('light')
    expect(resolveTheme({})).toEqual(defaultTheme('light'))
    // The app's tokens, not the graph engine's own palette.
    expect(resolveTheme({ mode: 'light' }).colours).toMatchObject({ surface: '#ffffff', muted: '#6b6b5f', accentWash: '#faf1e9', good: '#4c7a4a', bad: '#a34b3f' })
    expect(resolveTheme({ mode: 'dark' }).colours).toMatchObject({ surface: '#201e15', muted: '#a19d8c', accentWash: '#2c2113', good: '#6fa06c', bad: '#c76a5c' })
  })

  it('fills a partial source from the default theme, one missing field at a time', () => {
    const light = defaultTheme('light').colours
    const set = resolveTheme({ mode: 'light', colours: { ink: '#000033' } }).colours
    expect(set.ink).toBe('#000033')
    for (const name of COLOUR_KEYS) if (name !== 'ink') expect(set[name], name).toBe(light[name])
    // Saying the default out loud changes nothing.
    expect(resolveTheme({ mode: 'light', colours: { surface: light.surface, accent: light.accent, good: light.good } })).toEqual(defaultTheme('light'))
  })

  it('gives the default wash only to the default accent on the default surface, a derived one otherwise', () => {
    const light = defaultTheme('light').colours
    const dark = defaultTheme('dark').colours
    expect(light.accentWash).toBe('#faf1e9')
    // Both default, said out loud or not: the default wash.
    expect(resolveTheme({ mode: 'light', colours: { accent: light.accent, surface: light.surface } }).colours.accentWash).toBe(light.accentWash)
    // Another accent, on the default surface.
    expect(resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8' } }).colours.accentWash).toBe(mixOklab('#3b6ea8', light.surface, 0.85))
    // The default accent on another surface: a dark surface must not keep the light default's pale wash.
    const onDark = resolveTheme({ mode: 'light', colours: { surface: '#101010' } }).colours
    expect(onDark.accent).toBe(light.accent)
    expect(onDark.accentWash).toBe(mixOklab(light.accent, '#101010', 0.85))
    expect(onDark.accentWash).not.toBe(light.accentWash)
    expect(resolveTheme({ mode: 'dark', colours: { surface: '#f0f0f0' } }).colours.accentWash).toBe(mixOklab(dark.accent, '#f0f0f0', 0.85))
    // Another accent on another surface, and an explicit wash.
    expect(resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8', surface: '#f0f0f0' } }).colours.accentWash).toBe(mixOklab('#3b6ea8', '#f0f0f0', 0.85))
    expect(resolveTheme({ mode: 'light', colours: { accent: '#3b6ea8', accentWash: '#eeeeff' } }).colours.accentWash).toBe('#eeeeff')
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

  it('are, in the default theme, the same in light and dark to within 2 units a channel', () => {
    const light = defaultTheme('light').boards
    const dark = defaultTheme('dark').boards
    for (const name of BOARD_NAMES) {
      const a = channelsOf(light[name])
      const b = channelsOf(dark[name])
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i]), `${name} ${light[name]} vs ${dark[name]}`).toBeLessThanOrEqual(2)
    }
  })

  it('do not flip when the accent passes the hue opposite a board (a 2 degree move is a small step)', () => {
    // The default accents sit about 180 degrees from the blackboard's 230.
    const a = deriveBoards(accentAt(48))
    const b = deriveBoards(accentAt(50))
    for (const name of BOARD_NAMES) expect(deltaE(a[name], b[name]), name).toBeLessThan(0.005)
    // All the way round in 2 degree steps: no step is a jump (a flip is about 0.017 on the blackboard).
    let previous = deriveBoards(accentAt(0))
    for (let h = 2; h <= 360; h += 2) {
      const current = deriveBoards(accentAt(h % 360))
      for (const name of BOARD_NAMES) expect(deltaE(previous[name], current[name]), `${name} at accent hue ${h}`).toBeLessThan(0.008)
      previous = current
    }
  })

  it('are untilted for an accent with no chroma, whatever hue float residue gives it', () => {
    const untilted = { blackboard: '#21282b', greenboard: '#1c3d2c', whiteboard: '#f3f5f8' }
    expect(deriveBoards('#808080')).toEqual(untilted)
    expect(deriveBoards('#000000')).toEqual(untilted)
    expect(deriveBoards('#ffffff')).toEqual(untilted)
    expect(resolveTheme({ colours: { accent: '#808080' } }).boards).toEqual(untilted)
    expect(resolveTheme({ colours: { accent: '#000000' } }).boards).toEqual(untilted)
  })

  it('fade the tilt in smoothly with the accent chroma, 0 under 0.02 and whole by 0.04', () => {
    const grey = deriveBoards('#808080')
    // Under 0.02 there is no tilt (only the small chroma boost, which is within rounding).
    for (const name of BOARD_NAMES) expect(deltaE(deriveBoards(accentAt(100, 0.015))[name], grey[name]), name).toBeLessThan(0.005)
    // Well above, the board has taken its tilt.
    expect(deltaE(deriveBoards(accentAt(100, 0.08)).greenboard, grey.greenboard)).toBeGreaterThan(0.01)
    // No jump anywhere along the way.
    let previous = deriveBoards(accentAt(100, 0))
    for (let c = 0.002; c <= 0.08; c += 0.002) {
      const current = deriveBoards(accentAt(100, c))
      for (const name of BOARD_NAMES) expect(deltaE(previous[name], current[name]), `${name} at chroma ${c.toFixed(3)}`).toBeLessThan(0.006)
      previous = current
    }
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
    const theme = resolveTheme({ colours: { surface: '#fdf6ea', accent, good, bad } })
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
    const series = resolveTheme({ colours: { surface: '#fdf6ea', accent, good, bad } }).colours.series
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

  it('fit a good or bad that falls short of 3:1 in lightness only, and leave one that passes alone', () => {
    const surface = '#1b161f'
    const bad = '#a8404f' // 2.97:1 on this surface
    const good = '#6fbf8a' // plenty
    expect(contrastRatio(bad, surface)).toBeLessThan(3)
    expect(contrastRatio(good, surface)).toBeGreaterThanOrEqual(3)
    const series = deriveSeries({ accent: '#c48ad6', surface, mode: 'dark', good, bad })
    expect(series).toContain(good)
    expect(series).not.toContain(bad)
    const fitted = series.filter((hex) => hueDistance(toOklch(hex).h, toOklch(bad).h) < 5 && hex !== good)
    expect(fitted.length).toBeGreaterThan(0)
    const slot = fitted.find((hex) => contrastRatio(hex, surface) >= 3)
    expect(slot, 'a slot of the bad hue that meets 3:1').toBeDefined()
    expect(toOklch(slot!).l).toBeGreaterThan(toOklch(bad).l)
    expect(toOklch(slot!).c).toBeGreaterThan(toOklch(bad).c * 0.8)
    for (const hex of series) expect(contrastRatio(hex, surface)).toBeGreaterThanOrEqual(3)
  })

  // The four built-in themes' tokens for each mode (web/src/lib/builtinThemes.ts), in the
  // order surface, accent, ink, muted, line, lineStrong, with the --good and --bad their
  // custom CSS sets (the same in both modes).
  const BUILTIN_THEMES: Record<string, { good: Hex; bad: Hex; light: Hex[]; dark: Hex[] }> = {
    Slate: { good: '#3f7d5a', bad: '#b0473f', light: ['#ffffff', '#3b6ea8', '#161a21', '#5f6672', '#dfe3e9', '#c3c9d3'], dark: ['#1a1e24', '#7fa8dc', '#e7ebf1', '#98a1ad', '#2a3038', '#3c444f'] },
    Forest: { good: '#2f7a4f', bad: '#a6553c', light: ['#fbfcf8', '#2f7a4f', '#141a13', '#5d6b5c', '#d8e0d2', '#b8c6b0'], dark: ['#161f18', '#6fbf8a', '#e6efe6', '#92a394', '#25332a', '#36473c'] },
    Ember: { good: '#6e7f3c', bad: '#b3411f', light: ['#fffaf3', '#b3411f', '#1c1410', '#75655a', '#e6d9c8', '#cdb9a2'], dark: ['#16110d', '#ff8a3d', '#f6ece0', '#a89583', '#2b2119', '#443426'] },
    Plum: { good: '#4c7a6a', bad: '#a8404f', light: ['#ffffff', '#7a3e8f', '#1a1420', '#6a6072', '#e2dbe8', '#c8bcd2'], dark: ['#1b161f', '#c48ad6', '#efe8f3', '#a396ac', '#2e2535', '#443749'] },
  }
  const num = (hex: Hex) => parseInt(hex.slice(1), 16)

  it('keep 3:1 for the built-in themes in both modes, the Plum dark and Slate dark ones included', () => {
    for (const [name, theme] of Object.entries(BUILTIN_THEMES)) {
      for (const mode of ['light', 'dark'] as const) {
        const [surface, accent, ink, muted, line, lineStrong] = theme[mode]
        const resolved = fromOsmosisTheme(
          { background: num(surface), curve: num(accent), segment: num(theme.good), point: num(theme.bad), axis: num(ink), grid: num(line), gridStrong: num(lineStrong), muted: num(muted) },
          mode,
          { id: 'builtin:' + name.toLowerCase() },
        )
        for (const [slot, hex] of resolved.colours.series.entries()) {
          expect(contrastRatio(hex, surface), `${name} ${mode} slot ${slot} ${hex} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
        // The theme's own good and bad stay exactly as it gave them; only the series slot is fitted.
        expect(resolved.colours.good, `${name} ${mode} good`).toBe(theme.good)
        expect(resolved.colours.bad, `${name} ${mode} bad`).toBe(theme.bad)
      }
    }
    // Plum dark (2.97:1 before) and Slate dark (3.04:1), by name.
    const plum = fromOsmosisTheme({ background: num('#1b161f'), curve: num('#c48ad6'), segment: num('#4c7a6a'), point: num('#a8404f'), axis: num('#efe8f3'), grid: num('#2e2535'), gridStrong: num('#443749'), muted: num('#a396ac') }, 'dark')
    const slate = fromOsmosisTheme({ background: num('#1a1e24'), curve: num('#7fa8dc'), segment: num('#3f7d5a'), point: num('#b0473f'), axis: num('#e7ebf1'), grid: num('#2a3038'), gridStrong: num('#3c444f'), muted: num('#98a1ad') }, 'dark')
    for (const hex of plum.colours.series) expect(contrastRatio(hex, '#1b161f')).toBeGreaterThanOrEqual(3)
    for (const hex of slate.colours.series) expect(contrastRatio(hex, '#1a1e24')).toBeGreaterThanOrEqual(3)
    expect(plum.colours.series).not.toContain('#a8404f')
    // Slate dark's bad was 3.04:1 already, so it keeps its slot as given; Plum dark's was fitted.
    expect(slate.colours.series).toContain('#b0473f')
    expect(plum.colours.bad).toBe('#a8404f')
    expect(slate.colours.bad).toBe('#b0473f')
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
    expect(theme.styles).toEqual(styles)
    expect(resolveTheme({}).styles).toBeUndefined()
    expect(resolveTheme({}).lettering).toEqual({ family: null })
    expect(resolveTheme({}).media).toEqual({})
  })

  it('copies and freezes the styles, so changing the source afterwards changes neither the theme nor its key', () => {
    const styles = { all: { seed: 3, tint: ['a', 'b'] }, graph2d: { medium: 'ink' } }
    const theme = resolveTheme({ styles })
    const snapshot = JSON.stringify(theme.styles)
    const key = theme.key
    styles.all.seed = 99
    styles.all.tint.push('c')
    styles.graph2d.medium = 'chalk'
    expect(JSON.stringify(theme.styles)).toBe(snapshot)
    expect(theme.key).toBe(key)
    expect(theme.styles).not.toBe(styles)
    expect(Object.isFrozen(theme.styles)).toBe(true)
    expect(Object.isFrozen((theme.styles as typeof styles).all.tint)).toBe(true)
    // The same source, mutated, is a different theme with a different key.
    expect(resolveTheme({ styles }).key).not.toBe(key)
    // Through the preset hook as well.
    const hooked = fromOsmosisTheme(LIGHT_PALETTE, 'light', { id: 'builtin:x' }, () => styles)
    const hookedKey = hooked.key
    styles.all.seed = 7
    expect(hooked.key).toBe(hookedKey)
    expect((hooked.styles as typeof styles).all.seed).toBe(99)
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

  it('keeps its good and bad equal to those of the built-in palettes of render/palette.ts', () => {
    const hexOf = (value: number) => '#' + value.toString(16).padStart(6, '0')
    const goodBad = (palette: Palette) => ({ good: hexOf(palette.segment), bad: hexOf(palette.point) })
    expect({ ...DEFAULT_LIGHT_GOOD_BAD }).toEqual(goodBad(LIGHT_PALETTE))
    expect({ ...DEFAULT_DARK_GOOD_BAD }).toEqual(goodBad(DARK_PALETTE))
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
