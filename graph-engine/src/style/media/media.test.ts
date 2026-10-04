import { describe, expect, it } from 'vitest'
import { fromOklch, toOklch } from '../color'
import { randomFor, type Random } from '../random'
import { defaultTheme, fromOsmosisTheme, resolveTheme } from '../theme/adapter'
import { contrastRatio } from '../theme/contrast'
import { DEFAULT_DARK_GOOD_BAD, DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_GOOD_BAD, DEFAULT_LIGHT_TOKENS } from '../theme/defaults'
import { MEDIUM_NAMES, ROLE_KEYS, SERIES_COUNT, type Hex, type MediumName, type ThemeInput, type ThemeSource } from '../theme/types'
import { MEDIA, defaultMediumSettings, mediumOf } from './index'
import type { Role } from './types'

const HEX = /^#[0-9a-f]{6}$/
const BOARD_MEDIA: MediumName[] = ['chalk', 'whiteboard']
const PAPER_MEDIA: MediumName[] = ['clean', 'ink', 'graphite', 'colouredPencil', 'marker']
// The media that take their own neutrals for the roles that come from ink and muted.
const NEUTRAL_MEDIA: MediumName[] = ['marker', 'chalk', 'whiteboard']
const FITTED: MediumName[] = ['ink', 'graphite', 'colouredPencil', 'marker', 'chalk', 'whiteboard']

// ---------------------------------------------------------------------------
// The brief's table, written out again here, independently of the engines.
// ---------------------------------------------------------------------------

// The contrast each medium keeps against its own surface.
const FLOOR: Partial<Record<MediumName, number>> = { ink: 7, graphite: 4.5, colouredPencil: 3, marker: 3, chalk: 4.5, whiteboard: 4.5 }
// The OKLCH lightness range of the media that clamp it.
const RANGE: Partial<Record<MediumName, [number, number]> > = { marker: [0.45, 0.65], chalk: [0.8, 0.95], whiteboard: [0.35, 0.55] }
// The chroma a saturated medium lifts a coloured base to (a neutral base stays neutral).
const LIFT: Partial<Record<MediumName, number>> = { marker: 0.12, whiteboard: 0.1 }
// The tolerance the brief gives for L and C.
const TOLERANCE = 0.005

const surfaceOf = (theme: ThemeInput, name: MediumName): Hex =>
  name === 'chalk' ? theme.boards.blackboard : name === 'whiteboard' ? theme.boards.whiteboard : theme.colours.paper

// One stroke of a colour at an opacity, laid over its surface (each 8-bit sRGB channel blended and
// rounded): what is on the screen. Written out here, independently of the engines.
function blend(hex: Hex, surface: Hex, opacity: number): Hex {
  const channel = (colour: Hex, i: number) => parseInt(colour.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(opacity * channel(hex, i) + (1 - opacity) * channel(surface, i)).toString(16).padStart(2, '0')).join('')
}

// The contrast of a stroke as drawn: the blended colour against the surface.
const drawn = (colour: { hex: Hex; opacity: number }, surface: Hex) => contrastRatio(blend(colour.hex, surface, colour.opacity), surface)

// The most contrast a stroke at an opacity can have with a surface: black or white, drawn.
const bestDrawn = (surface: Hex, opacity: number) =>
  Math.max(drawn({ hex: '#000000', opacity }, surface), drawn({ hex: '#ffffff', opacity }, surface))

// Distance between two colours in OKLab.
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

// The most chroma the sRGB gamut holds at a lightness and hue, as measured on the real hex.
const gamutMax = (l: number, h: number) => toOklch(fromOklch({ l, c: 0.4, h })).c

// The lift of a saturated medium fades in with the base's own chroma: nothing at 0.02, all of it at 0.04.
function lifted(baseC: number, floor: number): number {
  const t = Math.min(1, Math.max(0, (baseC - 0.02) / 0.02))
  return Math.max(baseC, floor * t * t * (3 - 2 * t))
}

// The chroma a medium aims for from a base chroma, before the gamut says no.
function aimedChroma(name: MediumName, baseC: number): number {
  switch (name) {
    case 'ink':
      return baseC * 0.9
    case 'graphite':
      return Math.min(baseC, 0.02)
    case 'colouredPencil':
      return baseC * 0.8
    case 'marker':
      return lifted(baseC, LIFT.marker!)
    case 'chalk':
      return baseC * 0.6
    case 'whiteboard':
      return lifted(baseC, LIFT.whiteboard!)
    default:
      return baseC
  }
}

// The base colour of a role, as the brief says it: an author's own, a theme override, a
// series slot, then the role's own source. A board medium, and the marker, take their own
// neutral for the roles that default to ink or muted (the page's ink flips with the mode, and
// is far from a marker's range), which is a base with no chroma: reported as c = 0 here.
function baseChroma(theme: ThemeInput, name: MediumName, role: Role): number {
  // A board medium reads the theme's light-mode colours, a paper medium its own.
  const colours = BOARD_MEDIA.includes(name) ? theme.boardColours : theme.colours
  const given = role.colour ?? theme.media[name]?.[role.key] ?? (role.slot !== undefined ? colours.series[role.slot % SERIES_COUNT] : undefined)
  if (given !== undefined) return toOklch(given).c
  if (['line', 'hidden', 'label', 'measure', 'caption', 'givens', 'auxiliary'].includes(role.key)) {
    return NEUTRAL_MEDIA.includes(name) ? 0 : toOklch(role.key === 'auxiliary' ? colours.muted : colours.ink).c
  }
  return toOklch(role.key === 'point' ? colours.bad : colours.accent).c
}

// ---------------------------------------------------------------------------
// Seeded random themes (the same recipe as the theme adapter's tests).
// ---------------------------------------------------------------------------

function randomColour(random: Random): Hex {
  return fromOklch({ l: random.range(0.1, 0.95), c: random.range(0, 0.2), h: random.range(0, 360) })
}

// Every colour a role can be based on is given, so the two modes see the same colours.
function randomSource(n: number): Required<Pick<ThemeSource, 'colours'>> {
  const random = randomFor('style/media/test', n)
  return {
    colours: {
      accent: randomColour(random),
      ink: randomColour(random),
      surface: randomColour(random),
      muted: randomColour(random),
      good: randomColour(random),
      bad: randomColour(random),
      series: Array.from({ length: SERIES_COUNT }, () => randomColour(random)),
    },
  }
}

const SOURCES = Array.from({ length: 20 }, (_, n) => randomSource(n))
const themeOf = (n: number, mode: 'light' | 'dark') => resolveTheme({ mode, ...SOURCES[n] })

// Every role of a figure: the 13 keys, the 8 series slots, and authors' own colours.
const AUTHORS: Hex[] = ['#ff0000', '#1e90ff', '#ffff00', '#000000', '#ffffff', '#808080', '#8a2be2']
const ROLES: Role[] = [
  ...ROLE_KEYS.map((key): Role => ({ key })),
  ...Array.from({ length: SERIES_COUNT }, (_, slot): Role => ({ key: 'line', slot })),
  ...AUTHORS.map((colour): Role => ({ key: 'line', colour })),
]

describe('the media table', () => {
  it('has one medium per name, each knowing its own name', () => {
    expect(Object.keys(MEDIA).sort()).toEqual([...MEDIUM_NAMES].sort())
    for (const name of MEDIUM_NAMES) {
      expect(MEDIA[name].name).toBe(name)
      expect(mediumOf(name)).toBe(MEDIA[name])
    }
  })

  it('puts paper media on the paper and board media on their board', () => {
    const theme = defaultTheme('light')
    for (const name of PAPER_MEDIA) {
      expect(MEDIA[name].surface).toBe('paper')
      expect(MEDIA[name].surfaceColour(theme)).toBe(theme.colours.paper)
    }
    expect(MEDIA.chalk.surface).toBe('blackboard')
    expect(MEDIA.chalk.surfaceColour(theme)).toBe(theme.boards.blackboard)
    expect(MEDIA.whiteboard.surface).toBe('whiteboard')
    expect(MEDIA.whiteboard.surfaceColour(theme)).toBe(theme.boards.whiteboard)
    // The paper is its own colour: a theme that gives one gets it.
    const custom = resolveTheme({ colours: { surface: '#ffffff', paper: '#f0e6d2' } })
    expect(MEDIA.ink.surfaceColour(custom)).toBe('#f0e6d2')
  })

  it('has each medium overlap, opacity and grain as the table says', () => {
    const theme = defaultTheme('light')
    const role: Role = { key: 'line' }
    const table: Record<MediumName, { overlap: string; opacity: number; grain: object }> = {
      clean: { overlap: 'normal', opacity: 1, grain: { skips: 0, speckle: 0, streaks: 0, softEdge: 0 } },
      ink: { overlap: 'multiply', opacity: 1, grain: { skips: 0, speckle: 0, streaks: 0, softEdge: 0.15 } },
      graphite: { overlap: 'build', opacity: 0.85, grain: { skips: 0.5, speckle: 0.2, streaks: 0, softEdge: 0 } },
      colouredPencil: { overlap: 'build', opacity: 0.8, grain: { skips: 0.45, speckle: 0, streaks: 0, softEdge: 0 } },
      marker: { overlap: 'multiply', opacity: 0.9, grain: { skips: 0, speckle: 0, streaks: 0.4, softEdge: 0 } },
      chalk: { overlap: 'lighten', opacity: 0.9, grain: { skips: 0.4, speckle: 0.6, streaks: 0, softEdge: 0 } },
      whiteboard: { overlap: 'multiply', opacity: 0.95, grain: { skips: 0.3, speckle: 0, streaks: 0.35, softEdge: 0 } },
    }
    for (const name of MEDIUM_NAMES) {
      const medium = MEDIA[name]
      const settings = defaultMediumSettings(name)
      expect(medium.overlap, name).toBe(table[name].overlap)
      expect(medium.colour(theme, role, settings).opacity, name).toBe(table[name].opacity)
      expect(medium.grain(settings), name).toEqual(table[name].grain)
    }
  })

  it('gives the ink line no grain: skips, speckle and streaks are all 0, only the soft edge is not', () => {
    for (const edge of [0, 0.15, 0.5]) {
      const grain = MEDIA.ink.grain({ edge })
      expect(grain.skips).toBe(0)
      expect(grain.speckle).toBe(0)
      expect(grain.streaks).toBe(0)
      expect(grain.softEdge).toBe(edge)
    }
  })

  it('returns a fresh grain each time, so a caller cannot change the next one', () => {
    const first = MEDIA.graphite.grain(defaultMediumSettings('graphite'))
    first.skips = 0.99
    expect(MEDIA.graphite.grain(defaultMediumSettings('graphite')).skips).toBe(0.5)
  })
})

describe('the settings', () => {
  it('give every medium the keys it names, with defaults inside their ranges', () => {
    const keys: Record<MediumName, string[]> = {
      clean: [],
      ink: ['chroma', 'contrast', 'edge'],
      graphite: ['hint', 'grain'],
      colouredPencil: ['chroma'],
      marker: ['streaks'],
      chalk: ['chroma'],
      whiteboard: ['dry'],
    }
    for (const name of MEDIUM_NAMES) {
      const specs = MEDIA[name].settings
      expect(specs.map((s) => s.key).sort(), name).toEqual([...keys[name]].sort())
      const defaults = defaultMediumSettings(name)
      expect(Object.keys(defaults).sort(), name).toEqual(specs.map((s) => s.key).sort())
      for (const spec of specs) {
        expect(spec.label, `${name}.${spec.key}`).not.toBe('')
        expect(spec.min, `${name}.${spec.key}`).toBeLessThan(spec.max)
        expect(spec.step, `${name}.${spec.key}`).toBeGreaterThan(0)
        expect(spec.default, `${name}.${spec.key}`).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default, `${name}.${spec.key}`).toBeLessThanOrEqual(spec.max)
        expect(defaults[spec.key], `${name}.${spec.key}`).toBe(spec.default)
      }
    }
  })

  it('default to the brief: ink 0.9 / 7 / 0.15, graphite 0.02 / 0.2, pencil 0.8, marker 0.4, chalk 0.6 (0.5 to 0.7), whiteboard 0.3', () => {
    expect(defaultMediumSettings('ink')).toEqual({ chroma: 0.9, contrast: 7, edge: 0.15 })
    expect(defaultMediumSettings('graphite')).toEqual({ hint: 0.02, grain: 0.2 })
    expect(defaultMediumSettings('colouredPencil')).toEqual({ chroma: 0.8 })
    expect(defaultMediumSettings('marker')).toEqual({ streaks: 0.4 })
    expect(defaultMediumSettings('chalk')).toEqual({ chroma: 0.6 })
    expect(defaultMediumSettings('whiteboard')).toEqual({ dry: 0.3 })
    expect(defaultMediumSettings('clean')).toEqual({})
    const chroma = MEDIA.chalk.settings.find((s) => s.key === 'chroma')!
    expect([chroma.min, chroma.max]).toEqual([0.5, 0.7])
  })

  it('treat a missing setting as its default, and clamp one that is out of range', () => {
    const theme = defaultTheme('light')
    const role: Role = { key: 'line', colour: '#3b82f6' }
    for (const name of MEDIUM_NAMES) {
      const withDefaults = MEDIA[name].colour(theme, role, defaultMediumSettings(name))
      expect(MEDIA[name].colour(theme, role, {}), name).toEqual(withDefaults)
      expect(MEDIA[name].colour(theme, role, { nonsense: 3 }), name).toEqual(withDefaults)
      expect(MEDIA[name].colour(theme, role, { chroma: Number.NaN, contrast: Number.NaN, hint: Number.NaN }), name).toEqual(withDefaults)
    }
    const top = MEDIA.chalk.colour(theme, role, { chroma: 0.7 })
    expect(MEDIA.chalk.colour(theme, role, { chroma: 5 })).toEqual(top)
    const bottom = MEDIA.chalk.colour(theme, role, { chroma: 0.5 })
    expect(MEDIA.chalk.colour(theme, role, { chroma: -1 })).toEqual(bottom)
  })

  it('move the colour or the grain they name', () => {
    const theme = defaultTheme('light')
    const blue: Role = { key: 'line', colour: '#2f6fd0' }
    const c = (name: MediumName, settings: Record<string, number>, role = blue) => toOklch(MEDIA[name].colour(theme, role, settings).hex).c
    expect(c('ink', { chroma: 1 })).toBeGreaterThan(c('ink', { chroma: 0.5 }))
    expect(c('graphite', { hint: 0.04 })).toBeGreaterThan(c('graphite', { hint: 0 }))
    expect(c('graphite', { hint: 0 })).toBeLessThan(0.01)
    expect(c('colouredPencil', { chroma: 1 })).toBeGreaterThan(c('colouredPencil', { chroma: 0.4 }))
    expect(contrastRatio(MEDIA.ink.colour(theme, { key: 'line', colour: '#9aa0a6' }, { contrast: 12 }).hex, theme.colours.paper)).toBeGreaterThanOrEqual(12)
    expect(MEDIA.ink.grain({ edge: 0.4 }).softEdge).toBe(0.4)
    expect(MEDIA.graphite.grain({ grain: 0.7 }).speckle).toBe(0.7)
    expect(MEDIA.marker.grain({ streaks: 0.9 }).streaks).toBe(0.9)
    expect(MEDIA.whiteboard.grain({ dry: 0.8 }).skips).toBe(0.8)
    const accent: Role = { key: 'line', colour: '#e0508a' }
    expect(c('chalk', { chroma: 0.7 }, accent)).toBeGreaterThan(c('chalk', { chroma: 0.5 }, accent))
  })
})

describe('the base colour of a role', () => {
  const theme = resolveTheme({ mode: 'light', ...SOURCES[3] })
  const colours = theme.colours

  it('is the theme ink for lines, hidden lines, labels, measures, captions and givens (the marker has its own ink)', () => {
    for (const name of PAPER_MEDIA.filter((n) => n !== 'marker')) {
      const expected = MEDIA[name].colour(theme, { key: 'line', colour: colours.ink }, defaultMediumSettings(name))
      for (const key of ['line', 'hidden', 'label', 'measure', 'caption', 'givens'] as const) {
        expect(MEDIA[name].colour(theme, { key }, defaultMediumSettings(name)), `${name} ${key}`).toEqual(expected)
      }
    }
  })

  it('is the theme muted for auxiliary lines, bad for points, and the accent for highlight, focus, fill, region and shading (the marker has its own muted)', () => {
    for (const name of PAPER_MEDIA) {
      const settings = defaultMediumSettings(name)
      const of = (colour: Hex) => MEDIA[name].colour(theme, { key: 'line', colour }, settings)
      if (name !== 'marker') expect(MEDIA[name].colour(theme, { key: 'auxiliary' }, settings), name).toEqual(of(colours.muted))
      expect(MEDIA[name].colour(theme, { key: 'point' }, settings), name).toEqual(of(colours.bad))
      for (const key of ['highlight', 'focus', 'fill', 'region', 'shading'] as const) {
        expect(MEDIA[name].colour(theme, { key }, settings), `${name} ${key}`).toEqual(of(colours.accent))
      }
    }
  })

  it('is series[slot] when a slot is given (wrapping past the last), and the slot beats the role', () => {
    for (const name of MEDIUM_NAMES) {
      const settings = defaultMediumSettings(name)
      for (let slot = 0; slot < SERIES_COUNT; slot++) {
        const expected = MEDIA[name].colour(theme, { key: 'line', colour: colours.series[slot] }, settings)
        expect(MEDIA[name].colour(theme, { key: 'point', slot }, settings), `${name} ${slot}`).toEqual(expected)
        expect(MEDIA[name].colour(theme, { key: 'fill', slot: slot + SERIES_COUNT }, settings), `${name} ${slot} wrapped`).toEqual(expected)
      }
    }
    expect(MEDIA.clean.colour(theme, { key: 'point', slot: 2 }, {}).hex).toBe(colours.series[2])
    expect(MEDIA.clean.colour(theme, { key: 'point', slot: -1 }, {}).hex).toBe(colours.series[SERIES_COUNT - 1])
  })

  it('is overridden by theme.media for that medium and role, which beats the series', () => {
    const overridden = resolveTheme({ mode: 'light', ...SOURCES[3], media: { chalk: { line: '#00ff00' }, ink: { point: '#0000ff' } } })
    for (const name of MEDIUM_NAMES) {
      const settings = defaultMediumSettings(name)
      const override = overridden.media[name]
      const withSlot = MEDIA[name].colour(overridden, { key: 'line', slot: 1 }, settings)
      const plain = MEDIA[name].colour(theme, { key: 'line', slot: 1 }, settings)
      if (name === 'chalk') {
        expect(override!.line).toBe('#00ff00')
        expect(withSlot).toEqual(MEDIA.chalk.colour(theme, { key: 'line', colour: '#00ff00' }, settings))
        expect(withSlot).not.toEqual(plain)
        // Only that role: another role of the same medium is as before.
        expect(MEDIA.chalk.colour(overridden, { key: 'label' }, settings)).toEqual(MEDIA.chalk.colour(theme, { key: 'label' }, settings))
        expect(MEDIA.chalk.colour(overridden, { key: 'point' }, settings)).toEqual(MEDIA.chalk.colour(theme, { key: 'point' }, settings))
      } else if (name === 'ink') {
        expect(MEDIA.ink.colour(overridden, { key: 'point', slot: 4 }, settings)).toEqual(MEDIA.ink.colour(theme, { key: 'line', colour: '#0000ff' }, settings))
        expect(MEDIA.ink.colour(overridden, { key: 'line', slot: 1 }, settings)).toEqual(plain)
      } else {
        // A medium with no override is untouched.
        expect(withSlot, name).toEqual(plain)
      }
    }
  })

  it("is an author's own colour above everything else, and fitted like any other", () => {
    const overridden = resolveTheme({ mode: 'light', ...SOURCES[3], media: { chalk: { line: '#00ff00' } } })
    for (const name of MEDIUM_NAMES) {
      const settings = defaultMediumSettings(name)
      const expected = MEDIA[name].colour(theme, { key: 'line', colour: '#ff0000' }, settings)
      expect(MEDIA[name].colour(overridden, { key: 'line', slot: 2, colour: '#ff0000' }, settings), name).toEqual(expected)
    }
  })

  it("ignores an author's colour that is not a hex, and normalises #rgb and capitals", () => {
    const settings = defaultMediumSettings('clean')
    expect(MEDIA.clean.colour(theme, { key: 'line', colour: 'red' }, settings).hex).toBe(colours.ink)
    expect(MEDIA.clean.colour(theme, { key: 'line', colour: '#F00' }, settings).hex).toBe('#ff0000')
    expect(MEDIA.clean.colour(theme, { key: 'line', colour: '#1E90FF' }, settings).hex).toBe('#1e90ff')
  })
})

describe('clean', () => {
  it('is the identity: the base hex comes out exactly, at full opacity', () => {
    for (let n = 0; n < SOURCES.length; n++) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = themeOf(n, mode)
        for (const role of ROLES) {
          const base = role.colour ?? (role.slot !== undefined ? theme.colours.series[role.slot] : undefined)
          const out = MEDIA.clean.colour(theme, role, {})
          expect(out.opacity).toBe(1)
          if (base !== undefined) expect(out.hex).toBe(base)
          else expect(out.hex).toMatch(HEX)
        }
        expect(MEDIA.clean.colour(theme, { key: 'line' }, {}).hex).toBe(theme.colours.ink)
        expect(MEDIA.clean.colour(theme, { key: 'auxiliary' }, {}).hex).toBe(theme.colours.muted)
        expect(MEDIA.clean.colour(theme, { key: 'point' }, {}).hex).toBe(theme.colours.bad)
        expect(MEDIA.clean.colour(theme, { key: 'fill' }, {}).hex).toBe(theme.colours.accent)
      }
    }
  })

  it('has no grain and no settings', () => {
    expect(MEDIA.clean.grain({})).toEqual({ skips: 0, speckle: 0, streaks: 0, softEdge: 0 })
    expect(MEDIA.clean.settings).toHaveLength(0)
  })
})

describe('every fitted medium, on 20 seeded random themes in both modes, for every role', () => {
  for (const name of FITTED) {
    it(`${name} stays in its lightness and chroma ranges and keeps its contrast floor`, () => {
      const floor = FLOOR[name]!
      const range = RANGE[name]
      const settings = defaultMediumSettings(name)
      let outOfRange = 0
      for (let n = 0; n < SOURCES.length; n++) {
        for (const mode of ['light', 'dark'] as const) {
          const theme = themeOf(n, mode)
          const surface = surfaceOf(theme, name)
          for (const role of ROLES) {
            const tag = `${name} theme ${n} ${mode} ${JSON.stringify(role)}`
            const out = MEDIA[name].colour(theme, role, settings)
            expect(out.hex, tag).toMatch(HEX)
            expect(out.opacity, tag).toBeGreaterThan(0)
            expect(out.opacity, tag).toBeLessThanOrEqual(1)
            const oklch = toOklch(out.hex)

            // The contrast floor, for the stroke as drawn (at the medium's opacity, over its surface): met,
            // or the best there is where nothing can meet it.
            const ratio = drawn(out, surface)
            expect(ratio >= floor || ratio >= bestDrawn(surface, out.opacity) - 1e-6, `${tag}: ${ratio.toFixed(2)}:1 drawn on ${surface}`).toBe(true)

            // The chroma range: never more than the medium aims for (the gamut may take some away).
            const baseC = baseChroma(theme, name, role)
            expect(oklch.c, `${tag}: chroma ${oklch.c.toFixed(3)}`).toBeLessThanOrEqual(aimedChroma(name, baseC) + TOLERANCE)
            // A saturated medium lifts a coloured base to its floor, as far as the gamut at that lightness allows.
            const lift = LIFT[name]
            if (lift !== undefined && baseC >= 0.04) {
              expect(oklch.c, `${tag}: chroma ${oklch.c.toFixed(3)} below the lift`).toBeGreaterThanOrEqual(Math.min(lift, gamutMax(oklch.l, toOklch(out.hex).h)) - TOLERANCE)
            }
            // A neutral base stays neutral.
            if (lift !== undefined && baseC <= 0.02) expect(oklch.c, tag).toBeLessThanOrEqual(baseC + TOLERANCE)

            // The lightness range. Outside it only if nothing inside it meets the floor.
            if (range !== undefined) {
              const [lo, hi] = range
              if (oklch.l < lo - TOLERANCE || oklch.l > hi + TOLERANCE) {
                outOfRange++
                // Re-run the search the slow way, at the hue and chroma the engine fitted: no lightness inside the range meets the floor.
                const feasible = Array.from({ length: Math.round((hi - lo) / 0.0025) + 1 }, (_, k) => lo + k * 0.0025).some(
                  (l) => drawn({ hex: fromOklch({ l, c: oklch.c, h: oklch.h }), opacity: out.opacity }, surface) >= floor,
                )
                expect(feasible, `${tag}: L ${oklch.l.toFixed(3)} left [${lo}, ${hi}] though ${floor}:1 was reachable inside`).toBe(false)
              }
            }
          }
        }
      }
      // The random themes do hit a conflict somewhere for the media that have a range on paper, and never for chalk.
      if (name === 'chalk') expect(outOfRange).toBe(0)
    })
  }

  it('ink, graphite and pencil leave a colour alone when it already meets the floor, and only the chroma moves', () => {
    for (let n = 0; n < SOURCES.length; n++) {
      const theme = themeOf(n, 'light')
      for (const name of ['ink', 'graphite'] as const) {
        const surface = theme.colours.paper
        for (const role of ROLES) {
          const out = MEDIA[name].colour(theme, role, defaultMediumSettings(name))
          const own = role.colour ?? (role.slot !== undefined ? theme.colours.series[role.slot] : undefined)
          if (own === undefined) continue
          const base = toOklch(own)
          const aimed = fromOklch({ l: base.l, c: aimedChroma(name, base.c), h: base.h })
          if (drawn({ hex: aimed, opacity: out.opacity }, surface) >= FLOOR[name]!) expect(toOklch(out.hex).l, `${name} ${n} ${own}`).toBeCloseTo(base.l, 2)
        }
      }
    }
  })

  it('coloured pencil holds the colour a little light: L moves 0.05 toward the paper unless the floor needs it back', () => {
    const theme = defaultTheme('light')
    // A colour with room to spare for the 3:1 floor of a stroke at 0.8 (the ink): it moves the whole 0.05.
    const base = toOklch(theme.colours.ink)
    const out = toOklch(MEDIA.colouredPencil.colour(theme, { key: 'line' }, defaultMediumSettings('colouredPencil')).hex)
    expect(drawn({ hex: fromOklch({ ...base, l: base.l + 0.05 }), opacity: 0.8 }, theme.colours.paper)).toBeGreaterThan(3)
    expect(out.l).toBeCloseTo(base.l + 0.05, 2)
    // One with less room (the accent) is moved back by the floor: as drawn, it keeps 3:1.
    const accent = MEDIA.colouredPencil.colour(theme, { key: 'highlight' }, defaultMediumSettings('colouredPencil'))
    expect(toOklch(accent.hex).l).toBeLessThan(toOklch(theme.colours.accent).l + 0.05 - 0.005)
    expect(drawn(accent, theme.colours.paper)).toBeGreaterThanOrEqual(3)
    expect(toOklch(accent.hex).c).toBeLessThan(toOklch(theme.colours.accent).c)
    // On a dark paper the colour is held toward the paper too: a little darker, never past the paper itself.
    const dark = defaultTheme('dark')
    const lightInk = toOklch(dark.colours.ink)
    const darkOut = toOklch(MEDIA.colouredPencil.colour(dark, { key: 'line' }, defaultMediumSettings('colouredPencil')).hex)
    expect(darkOut.l).toBeCloseTo(lightInk.l - 0.05, 2)
  })
})

describe("when a medium's range and its contrast floor conflict, the floor wins", () => {
  it('a marker on a mid-grey paper leaves its lightness range to keep 3:1', () => {
    const theme = resolveTheme({ colours: { surface: '#8a8a8a' } })
    for (const key of ['line', 'auxiliary', 'highlight', 'point'] as const) {
      expect(drawn(MEDIA.marker.colour(theme, { key }, {}), '#8a8a8a'), key).toBeGreaterThanOrEqual(3)
    }
    const line = toOklch(MEDIA.marker.colour(theme, { key: 'line' }, {}).hex)
    expect(line.l).toBeLessThan(0.45 - TOLERANCE)
  })

  it('ink on a mid-grey paper cannot reach 7:1, so it takes the most contrast there is', () => {
    const theme = resolveTheme({ colours: { surface: '#8a8a8a' } })
    for (const key of ['line', 'auxiliary', 'highlight'] as const) {
      const hex = MEDIA.ink.colour(theme, { key }, {}).hex
      const ratio = contrastRatio(hex, '#8a8a8a')
      expect(ratio, key).toBeLessThan(7)
      expect(ratio, key).toBeCloseTo(bestDrawn('#8a8a8a', 1), 5)
    }
  })

  it('chalk on a light board a theme gave (an explicit board colour) still reads: 4.5:1, off the chalk range', () => {
    const theme = resolveTheme({ boards: { blackboard: '#808080' } })
    for (const key of ['line', 'auxiliary', 'highlight'] as const) {
      expect(drawn(MEDIA.chalk.colour(theme, { key }, {}), '#808080'), key).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a setting that asks for more than the paper can give (ink contrast 15 on a mid-grey paper) ends at black', () => {
    const theme = resolveTheme({ colours: { surface: '#8a8a8a' } })
    expect(MEDIA.ink.colour(theme, { key: 'line', colour: '#808080' }, { contrast: 15 }).hex).toBe('#000000')
  })
})

describe('board media look the same in light and dark', () => {
  it('give byte-equal colours when only the mode changes (20 random themes, every role)', () => {
    for (const name of BOARD_MEDIA) {
      const settings = defaultMediumSettings(name)
      for (let n = 0; n < SOURCES.length; n++) {
        const light = themeOf(n, 'light')
        const dark = themeOf(n, 'dark')
        const flipped = { ...light, mode: 'dark' as const }
        for (const role of ROLES) {
          const expected = MEDIA[name].colour(light, role, settings)
          expect(MEDIA[name].colour(dark, role, settings), `${name} ${n} ${JSON.stringify(role)}`).toEqual(expected)
          expect(MEDIA[name].colour(flipped, role, settings), `${name} ${n} flipped`).toEqual(expected)
        }
        expect(MEDIA[name].surfaceColour(dark)).toBe(MEDIA[name].surfaceColour(light))
      }
    }
  })

  it("draw the default theme's structural roles the same in light and dark: the page ink does not decide a board's chalk", () => {
    const light = defaultTheme('light')
    const dark = defaultTheme('dark')
    for (const name of BOARD_MEDIA) {
      const settings = defaultMediumSettings(name)
      for (const key of ['line', 'hidden', 'auxiliary', 'label', 'measure', 'caption', 'givens'] as const) {
        expect(MEDIA[name].colour(dark, { key }, settings), `${name} ${key}`).toEqual(MEDIA[name].colour(light, { key }, settings))
      }
    }
  })

  it('tell the structural lines from the auxiliary ones on the board, in light and in dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = defaultTheme(mode)
      for (const name of BOARD_MEDIA) {
        const line = MEDIA[name].colour(theme, { key: 'line' }, defaultMediumSettings(name)).hex
        const auxiliary = MEDIA[name].colour(theme, { key: 'auxiliary' }, defaultMediumSettings(name)).hex
        expect(line, `${name} ${mode}`).not.toBe(auxiliary)
      }
    }
    // Chalk: lines are the whitest chalk and auxiliary a step dimmer. Whiteboard: black marker, then grey.
    const theme = defaultTheme('light')
    const chalkLine = toOklch(MEDIA.chalk.colour(theme, { key: 'line' }, {}).hex).l
    const chalkAux = toOklch(MEDIA.chalk.colour(theme, { key: 'auxiliary' }, {}).hex).l
    expect(chalkLine).toBeGreaterThan(chalkAux)
    const boardLine = toOklch(MEDIA.whiteboard.colour(theme, { key: 'line' }, {}).hex).l
    const boardAux = toOklch(MEDIA.whiteboard.colour(theme, { key: 'auxiliary' }, {}).hex).l
    expect(boardLine).toBeLessThan(boardAux)
  })

  it('stay readable on the greenboard too: chalk keeps 4.5:1 against it', () => {
    for (let n = 0; n < SOURCES.length; n++) {
      const theme = themeOf(n, 'dark')
      for (const role of ROLES) {
        expect(drawn(MEDIA.chalk.colour(theme, role, {}), theme.boards.greenboard), `${n} ${JSON.stringify(role)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

// A palette of the eight colours a host reads for a theme, as `fromOsmosisTheme` takes them.
const numOf = (hex: Hex) => parseInt(hex.slice(1), 16)
function paletteOf(surface: Hex, accent: Hex, ink: Hex, muted: Hex, line: Hex, lineStrong: Hex, good: Hex, bad: Hex) {
  return { background: numOf(surface), curve: numOf(accent), segment: numOf(good), point: numOf(bad), axis: numOf(ink), grid: numOf(line), gridStrong: numOf(lineStrong), muted: numOf(muted) }
}

// The four built-in themes, in the order surface, accent, ink, muted, line, lineStrong, with the --good and
// --bad their custom CSS sets (web/src/lib/builtinThemes.ts; the same table as the adapter's tests).
const BUILTINS: Record<string, { good: Hex; bad: Hex; light: Hex[]; dark: Hex[] }> = {
  slate: { good: '#3f7d5a', bad: '#b0473f', light: ['#ffffff', '#3b6ea8', '#161a21', '#5f6672', '#dfe3e9', '#c3c9d3'], dark: ['#1a1e24', '#7fa8dc', '#e7ebf1', '#98a1ad', '#2a3038', '#3c444f'] },
  forest: { good: '#2f7a4f', bad: '#a6553c', light: ['#fbfcf8', '#2f7a4f', '#141a13', '#5d6b5c', '#d8e0d2', '#b8c6b0'], dark: ['#161f18', '#6fbf8a', '#e6efe6', '#92a394', '#25332a', '#36473c'] },
  ember: { good: '#6e7f3c', bad: '#b3411f', light: ['#fffaf3', '#b3411f', '#1c1410', '#75655a', '#e6d9c8', '#cdb9a2'], dark: ['#16110d', '#ff8a3d', '#f6ece0', '#a89583', '#2b2119', '#443426'] },
  plum: { good: '#4c7a6a', bad: '#a8404f', light: ['#ffffff', '#7a3e8f', '#1a1420', '#6a6072', '#e2dbe8', '#c8bcd2'], dark: ['#1b161f', '#c48ad6', '#efe8f3', '#a396ac', '#2e2535', '#443749'] },
}
const DEFAULT_TOKEN_PALETTE = (mode: 'light' | 'dark') => {
  const tokens = mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
  const goodBad = mode === 'dark' ? DEFAULT_DARK_GOOD_BAD : DEFAULT_LIGHT_GOOD_BAD
  return paletteOf(tokens['--surface'], tokens['--accent'], tokens['--ink'], tokens['--muted'], tokens['--line'], tokens['--line-strong'], goodBad.good, goodBad.bad)
}

// What a board medium draws, for every role, as one comparable thing.
function boardOutput(theme: ThemeInput, name: MediumName) {
  const settings = defaultMediumSettings(name)
  return { surface: MEDIA[name].surfaceColour(theme), roles: ROLES.map((role) => MEDIA[name].colour(theme, role, settings)) }
}

describe("board media draw the same in light and in dark, from the theme's light colours", () => {
  it('the default theme: chalk and whiteboard, every role, are byte-equal in light and dark', () => {
    for (const name of BOARD_MEDIA) {
      const light = boardOutput(defaultTheme('light'), name)
      expect(boardOutput(defaultTheme('dark'), name), name).toEqual(light)
      // Through the host's door, with the default tokens as a Palette: the same.
      expect(boardOutput(fromOsmosisTheme(DEFAULT_TOKEN_PALETTE('dark'), 'dark'), name), `${name} fromOsmosisTheme dark`).toEqual(boardOutput(fromOsmosisTheme(DEFAULT_TOKEN_PALETTE('light'), 'light'), name))
      expect(boardOutput(fromOsmosisTheme(DEFAULT_TOKEN_PALETTE('dark'), 'dark'), name), `${name} fromOsmosisTheme`).toEqual(light)
    }
    // The coloured roles in particular, which the page's own colours (accent, bad, series) used to move.
    for (const role of ROLES.filter((r) => r.slot !== undefined || r.key === 'point' || r.key === 'highlight')) {
      for (const name of BOARD_MEDIA) {
        expect(MEDIA[name].colour(defaultTheme('dark'), role, {}), `${name} ${JSON.stringify(role)}`).toEqual(MEDIA[name].colour(defaultTheme('light'), role, {}))
      }
    }
  })

  it('each built-in theme, through fromOsmosisTheme with its preset id: byte-equal in light and dark', () => {
    for (const [name, theme] of Object.entries(BUILTINS)) {
      const preset = { id: 'builtin:' + name }
      const light = fromOsmosisTheme(paletteOf(theme.light[0], theme.light[1], theme.light[2], theme.light[3], theme.light[4], theme.light[5], theme.good, theme.bad), 'light', preset)
      const dark = fromOsmosisTheme(paletteOf(theme.dark[0], theme.dark[1], theme.dark[2], theme.dark[3], theme.dark[4], theme.dark[5], theme.good, theme.bad), 'dark', preset)
      for (const medium of BOARD_MEDIA) expect(boardOutput(dark, medium), `${name} ${medium}`).toEqual(boardOutput(light, medium))
      // The paper media do change with the mode: the page is dark, the paper is its own.
      expect(MEDIA.ink.surfaceColour(dark)).not.toBe(MEDIA.ink.surfaceColour(light))
    }
  })

  it('a custom theme with lightColours given: byte-equal in light and dark (20 random themes)', () => {
    for (let n = 0; n < SOURCES.length; n++) {
      const dark = resolveTheme({ mode: 'dark', colours: SOURCES[n].colours, lightColours: randomSource(100 + n).colours })
      const light = resolveTheme({ mode: 'light', colours: randomSource(100 + n).colours })
      for (const name of BOARD_MEDIA) expect(boardOutput(dark, name), `${name} ${n}`).toEqual(boardOutput(light, name))
    }
  })

  it('a custom theme without lightColours falls back to its own colours (interim: until the theming overhaul supplies both modes)', () => {
    const colours = SOURCES[1].colours
    const dark = resolveTheme({ mode: 'dark', colours })
    // Fitted from its own colours...
    for (const name of BOARD_MEDIA) expect(boardOutput(dark, name), name).toEqual(boardOutput(resolveTheme({ mode: 'light', colours }), name))
    // ...so it does follow them: a theme whose light colours differ draws differently.
    const other = resolveTheme({ mode: 'light', colours: randomSource(101).colours })
    expect(MEDIA.chalk.colour(dark, { key: 'highlight' }, {})).not.toEqual(MEDIA.chalk.colour(other, { key: 'highlight' }, {}))
  })

  it('fit every role from boardColours, never colours; the paper media from colours, never boardColours', () => {
    const A = SOURCES[1].colours
    const B = randomSource(101).colours
    const C = randomSource(102).colours
    const base = resolveTheme({ mode: 'dark', colours: A, lightColours: B })
    const darkChanged = resolveTheme({ mode: 'dark', colours: C, lightColours: B })
    const lightChanged = resolveTheme({ mode: 'dark', colours: A, lightColours: C })
    for (const name of BOARD_MEDIA) {
      expect(boardOutput(darkChanged, name), `${name}: the dark colours do not matter`).toEqual(boardOutput(base, name))
      expect(boardOutput(lightChanged, name), `${name}: the light colours do`).not.toEqual(boardOutput(base, name))
    }
    const paperOutput = (theme: ThemeInput, name: MediumName) => ROLES.map((role) => MEDIA[name].colour(theme, role, defaultMediumSettings(name)))
    for (const name of PAPER_MEDIA) {
      expect(paperOutput(lightChanged, name), `${name}: the light colours do not matter`).toEqual(paperOutput(base, name))
      expect(paperOutput(darkChanged, name), `${name}: the dark colours do`).not.toEqual(paperOutput(base, name))
    }
  })

  it('a theme-media override and an own colour still win over the board colours', () => {
    const lightColours = randomSource(102).colours
    const theme = resolveTheme({ mode: 'dark', colours: SOURCES[2].colours, lightColours, media: { chalk: { line: '#00ff00' } } })
    const light = resolveTheme({ mode: 'light', colours: lightColours })
    const settings = defaultMediumSettings('chalk')
    expect(MEDIA.chalk.colour(theme, { key: 'line' }, settings)).toEqual(MEDIA.chalk.colour(theme, { key: 'label', colour: '#00ff00' }, settings))
    expect(MEDIA.chalk.colour(theme, { key: 'line', colour: '#ff0000' }, settings)).toEqual(MEDIA.chalk.colour(light, { key: 'line', colour: '#ff0000' }, settings))
    expect(MEDIA.chalk.colour(theme, { key: 'line', colour: '#ff0000' }, settings)).not.toEqual(MEDIA.chalk.colour(theme, { key: 'line' }, settings))
  })
})

describe("an author's own colour goes through the medium", () => {
  const light = defaultTheme('light')

  it('is fitted, never replaced: red on a blackboard is a pastel chalk red (light, dusty, still red)', () => {
    const red = toOklch('#ff0000')
    const chalk = MEDIA.chalk.colour(light, { key: 'line', colour: '#ff0000' }, {})
    const out = toOklch(chalk.hex)
    expect(chalk.hex).not.toBe('#ff0000')
    expect(out.l).toBeGreaterThanOrEqual(0.8 - TOLERANCE)
    expect(out.c).toBeLessThan(red.c)
    expect(out.c).toBeGreaterThan(0.06)
    expect(Math.abs(out.h - red.h)).toBeLessThan(10)
    // And the page theme makes no difference.
    expect(MEDIA.chalk.colour(defaultTheme('dark'), { key: 'line', colour: '#ff0000' }, {})).toEqual(chalk)
  })

  it('differs by author colour in every non-clean medium, and keeps the hue where the medium has chroma', () => {
    for (const name of FITTED) {
      const settings = defaultMediumSettings(name)
      const red = MEDIA[name].colour(light, { key: 'line', colour: '#ff0000' }, settings).hex
      const blue = MEDIA[name].colour(light, { key: 'line', colour: '#1e90ff' }, settings).hex
      const ink = MEDIA[name].colour(light, { key: 'line' }, settings).hex
      expect(red, name).not.toBe(blue)
      expect(red, name).not.toBe(ink)
      // A marker's own colour is already saturated and mid-toned: pure red is a fine marker red, and stays.
      if (name !== 'marker') expect(red, name).not.toBe('#ff0000')
      if (name !== 'graphite') {
        expect(Math.abs(toOklch(red).h - toOklch('#ff0000').h), `${name} red`).toBeLessThan(15)
        expect(Math.abs(toOklch(blue).h - toOklch('#1e90ff').h), `${name} blue`).toBeLessThan(15)
      }
    }
  })

  it('is clean only where the medium is clean: the exact colour', () => {
    expect(MEDIA.clean.colour(light, { key: 'line', colour: '#ff0000' }, {}).hex).toBe('#ff0000')
  })

  it('reads on every board and paper, even for white-on-white and black-on-black', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = defaultTheme(mode)
      for (const name of FITTED) {
        const surface = surfaceOf(theme, name)
        for (const colour of ['#ffffff', '#000000', '#808080', '#fefefe', '#010101']) {
          const out = MEDIA[name].colour(theme, { key: 'label', colour }, defaultMediumSettings(name))
          expect(drawn(out, surface), `${name} ${mode} ${colour}`).toBeGreaterThanOrEqual(FLOOR[name]!)
        }
      }
    }
  })
})

describe('colours a marker or whiteboard ink would not make up', () => {
  it('keep a near-black ink neutral: a black marker, not an olive one', () => {
    const light = defaultTheme('light')
    for (const name of ['marker', 'whiteboard'] as const) {
      for (const key of ['line', 'label', 'auxiliary'] as const) {
        const out = toOklch(MEDIA[name].colour(light, { key }, {}).hex)
        expect(out.c, `${name} ${key}`).toBeLessThan(0.03)
      }
    }
  })

  it('give a coloured role the medium chroma: a marker accent is vivid, a whiteboard point too', () => {
    const light = defaultTheme('light')
    expect(toOklch(MEDIA.marker.colour(light, { key: 'highlight' }, {}).hex).c).toBeGreaterThanOrEqual(0.12 - TOLERANCE)
    expect(toOklch(MEDIA.whiteboard.colour(light, { key: 'point' }, {}).hex).c).toBeGreaterThanOrEqual(0.1 - TOLERANCE)
  })
})

// The default theme and the four built-ins, in both modes, as a host gives them.
function probeThemes(): [string, ThemeInput][] {
  const themes: [string, ThemeInput][] = [
    ['default light', defaultTheme('light')],
    ['default dark', defaultTheme('dark')],
  ]
  for (const [name, b] of Object.entries(BUILTINS)) {
    for (const mode of ['light', 'dark'] as const) {
      const t = b[mode]
      themes.push([`${name} ${mode}`, fromOsmosisTheme(paletteOf(t[0], t[1], t[2], t[3], t[4], t[5], b.good, b.bad), mode, { id: 'builtin:' + name })])
    }
  }
  return themes
}

describe('what is seen, on the default theme and the four built-ins in both modes', () => {
  it('one stroke of every role, in every medium, as drawn (at its opacity over its surface), keeps the floor', () => {
    const cannot: string[] = []
    for (const [themeName, theme] of probeThemes()) {
      for (const name of FITTED) {
        const surface = surfaceOf(theme, name)
        for (const role of ROLES) {
          const out = MEDIA[name].colour(theme, role, defaultMediumSettings(name))
          const ratio = drawn(out, surface)
          const tag = `${themeName} ${name} ${JSON.stringify(role)} ${out.hex}@${out.opacity} on ${surface}: ${ratio.toFixed(2)}:1`
          if (ratio < FLOOR[name]!) {
            // Where nothing in gamut can, the best there is.
            cannot.push(tag)
            expect(ratio, tag).toBeGreaterThanOrEqual(bestDrawn(surface, out.opacity) - 1e-6)
          }
        }
      }
    }
    // None of these papers and boards is one no colour could read on.
    expect(cannot).toEqual([])
  })

  it('the solid colour is not what is measured: a stroke at 0.85 is paler than its hex, and the floor still holds', () => {
    // Graphite's #5d5d51 (the default light theme's auxiliary) is 6.6:1 solid but its drawn stroke has less.
    const theme = defaultTheme('light')
    const aux = MEDIA.graphite.colour(theme, { key: 'auxiliary' }, {})
    expect(contrastRatio(aux.hex, theme.colours.paper)).toBeGreaterThan(drawn(aux, theme.colours.paper))
    expect(drawn(aux, theme.colours.paper)).toBeGreaterThanOrEqual(4.5)
    // The undrawn colour of the theme's own muted (#6b6b5f) is only 5.2:1 solid: as drawn it is below 4.5, so the fit moved it.
    expect(drawn({ hex: theme.colours.muted, opacity: 0.85 }, theme.colours.paper)).toBeLessThan(4.5)
  })

  it('line and auxiliary differ by at least 0.05 (OKLab) in every medium', () => {
    for (const [themeName, theme] of probeThemes()) {
      for (const name of MEDIUM_NAMES) {
        const settings = defaultMediumSettings(name)
        const line = MEDIA[name].colour(theme, { key: 'line' }, settings).hex
        const auxiliary = MEDIA[name].colour(theme, { key: 'auxiliary' }, settings).hex
        expect(deltaE(line, auxiliary), `${themeName} ${name}: ${line} against ${auxiliary}`).toBeGreaterThanOrEqual(0.05)
      }
    }
  })

  it("the marker's ink is the end of its range farthest from the paper and its muted 0.10 nearer, neutral greys", () => {
    const light = defaultTheme('light')
    const dark = defaultTheme('dark')
    const l = (theme: ThemeInput, key: 'line' | 'auxiliary') => toOklch(MEDIA.marker.colour(theme, { key }, {}).hex)
    expect(l(light, 'line').l).toBeCloseTo(0.45, 2)
    expect(l(light, 'auxiliary').l).toBeCloseTo(0.55, 2)
    expect(l(dark, 'line').l).toBeCloseTo(0.65, 2)
    // On the default dark paper the muted marker keeps its floor, a little above 0.55 at most.
    expect(l(dark, 'auxiliary').l).toBeGreaterThanOrEqual(0.55 - TOLERANCE)
    expect(l(dark, 'auxiliary').l).toBeLessThan(0.65 - 0.05)
    for (const theme of [light, dark]) {
      for (const key of ['line', 'auxiliary'] as const) expect(l(theme, key).c, key).toBeLessThan(0.01)
    }
    // The theme's own ink and muted do not matter to it, and the paper does.
    const recoloured = resolveTheme({ mode: 'light', colours: { ink: '#aa2222', muted: '#22aa22' } })
    expect(MEDIA.marker.colour(recoloured, { key: 'line' }, {})).toEqual(MEDIA.marker.colour(light, { key: 'line' }, {}))
    expect(MEDIA.marker.colour(recoloured, { key: 'auxiliary' }, {})).toEqual(MEDIA.marker.colour(light, { key: 'auxiliary' }, {}))
    const darkPaper = resolveTheme({ mode: 'light', colours: { surface: '#101010' } })
    expect(toOklch(MEDIA.marker.colour(darkPaper, { key: 'line' }, {}).hex).l).toBeCloseTo(0.65, 2)
  })
})

describe('on the default theme', () => {
  it('colours every role in every medium, light and dark, deterministically, and leaves the (frozen) theme alone', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = defaultTheme(mode)
      const key = theme.key
      for (const name of MEDIUM_NAMES) {
        const settings = defaultMediumSettings(name)
        for (const role of ROLES) {
          const a = MEDIA[name].colour(theme, role, settings)
          const b = MEDIA[name].colour(theme, role, settings)
          expect(a).toEqual(b)
          expect(a.hex).toMatch(HEX)
        }
      }
      expect(theme.key).toBe(key)
      expect(Object.isFrozen(theme)).toBe(true)
    }
  })

  it('pins the colours a figure gets from each medium (line, auxiliary, point, highlight, series 0)', () => {
    const roles: Role[] = [{ key: 'line' }, { key: 'auxiliary' }, { key: 'point' }, { key: 'highlight' }, { key: 'point', slot: 0 }]
    for (const mode of ['light', 'dark'] as const) {
      const theme = defaultTheme(mode)
      const out = Object.fromEntries(MEDIUM_NAMES.map((name) => [name, roles.map((role) => MEDIA[name].colour(theme, role, defaultMediumSettings(name)).hex)]))
      expect(out, mode).toEqual(PIN[mode])
    }
  })
})

// Read by eye: the default theme, per medium, for line, auxiliary, point, highlight and series 0.
// Moved in fix round 1, when the contrast floor came to be measured on a stroke as drawn (blended at
// the medium's opacity over its surface) and the marker got its own neutrals: graphite's auxiliary,
// point, highlight and series 0 (darker, to keep 4.5:1 at 0.85); coloured pencil's point and highlight
// (3:1 at 0.8); the whiteboard's auxiliary, highlight and series 0 (4.5:1 at 0.95); the marker's line
// and auxiliary (its own neutral greys, 0.45 and 0.55 on a light paper, 0.65 and 0.55 on a dark one).
const PIN: Record<'light' | 'dark', Record<MediumName, string[]>> = {
  light: {
    clean: ['#17170f', '#6b6b5f', '#a34b3f', '#c65d22', '#b54e0a'],
    ink: ['#171710', '#57574d', '#8e4136', '#933c00', '#933c00'],
    graphite: ['#17170f', '#5d5d51', '#695a58', '#675a54', '#685a54'],
    colouredPencil: ['#22231c', '#797970', '#a96156', '#ba663d', '#ba673d'],
    marker: ['#555555', '#717171', '#a34b3f', '#c65d22', '#b54e0a'],
    chalk: ['#eeeeee', '#bebebe', '#e8ada3', '#efac8c', '#efac8d'],
    whiteboard: ['#3a3a3a', '#686868', '#a34b3f', '#b24b03', '#b24b03'],
  },
  dark: {
    clean: ['#f2efe2', '#a19d8c', '#c76a5c', '#e2803f', '#f59151'],
    ink: ['#f2efe3', '#ada99a', '#ea9384', '#ed935c', '#ef955d'],
    graphite: ['#f2efe2', '#a09d8f', '#a79694', '#a89a92', '#b9aba3'],
    colouredPencil: ['#e1ded4', '#918e80', '#b2695d', '#c57848', '#d78958'],
    marker: ['#8f8f8f', '#717171', '#c76a5c', '#d2722f', '#d2722f'],
    // The board media are the light default's: a board and what is drawn on it do not change with the mode.
    chalk: ['#eeeeee', '#bebebe', '#e8ada3', '#efac8c', '#efac8d'],
    whiteboard: ['#3a3a3a', '#686868', '#a34b3f', '#b24b03', '#b24b03'],
  },
}
