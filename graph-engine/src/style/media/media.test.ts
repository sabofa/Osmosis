import { describe, expect, it } from 'vitest'
import { fromOklch, toOklch } from '../color'
import { randomFor, type Random } from '../random'
import { defaultTheme, resolveTheme } from '../theme/adapter'
import { contrastRatio } from '../theme/contrast'
import { MEDIUM_NAMES, ROLE_KEYS, SERIES_COUNT, type Hex, type MediumName, type ThemeInput, type ThemeSource } from '../theme/types'
import { MEDIA, defaultMediumSettings, mediumOf } from './index'
import type { Role } from './types'

const HEX = /^#[0-9a-f]{6}$/
const BOARD_MEDIA: MediumName[] = ['chalk', 'whiteboard']
const PAPER_MEDIA: MediumName[] = ['clean', 'ink', 'graphite', 'colouredPencil', 'marker']
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

// The most contrast anything can have with a surface: black or white.
const bestContrast = (surface: Hex) => Math.max(contrastRatio('#000000', surface), contrastRatio('#ffffff', surface))

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
// series slot, then the role's own source. A board medium takes the board's own neutral
// for the roles that default to ink or muted (the page's ink flips with the mode), which is
// a base with no chroma: reported as c = 0 here.
function baseChroma(theme: ThemeInput, name: MediumName, role: Role): number {
  const given = role.colour ?? theme.media[name]?.[role.key] ?? (role.slot !== undefined ? theme.colours.series[role.slot % SERIES_COUNT] : undefined)
  if (given !== undefined) return toOklch(given).c
  if (['line', 'hidden', 'label', 'measure', 'caption', 'givens', 'auxiliary'].includes(role.key)) {
    return BOARD_MEDIA.includes(name) ? 0 : toOklch(role.key === 'auxiliary' ? theme.colours.muted : theme.colours.ink).c
  }
  return toOklch(role.key === 'point' ? theme.colours.bad : theme.colours.accent).c
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

  it('is the theme ink for lines, hidden lines, labels, measures, captions and givens', () => {
    for (const name of PAPER_MEDIA) {
      const expected = MEDIA[name].colour(theme, { key: 'line', colour: colours.ink }, defaultMediumSettings(name))
      for (const key of ['line', 'hidden', 'label', 'measure', 'caption', 'givens'] as const) {
        expect(MEDIA[name].colour(theme, { key }, defaultMediumSettings(name)), `${name} ${key}`).toEqual(expected)
      }
    }
  })

  it('is the theme muted for auxiliary lines, bad for points, and the accent for highlight, focus, fill, region and shading', () => {
    for (const name of PAPER_MEDIA) {
      const settings = defaultMediumSettings(name)
      const of = (colour: Hex) => MEDIA[name].colour(theme, { key: 'line', colour }, settings)
      expect(MEDIA[name].colour(theme, { key: 'auxiliary' }, settings), name).toEqual(of(colours.muted))
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

            // The contrast floor: met, or the best there is where nothing can meet it.
            const ratio = contrastRatio(out.hex, surface)
            expect(ratio >= floor || ratio >= bestContrast(surface) - 1e-6, `${tag}: ${ratio.toFixed(2)}:1 on ${surface}`).toBe(true)

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
                  (l) => contrastRatio(fromOklch({ l, c: oklch.c, h: oklch.h }), surface) >= floor,
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
          if (contrastRatio(aimed, surface) >= FLOOR[name]!) expect(toOklch(out.hex).l, `${name} ${n} ${own}`).toBeCloseTo(base.l, 2)
        }
      }
    }
  })

  it('coloured pencil holds the colour a little light: L moves 0.05 toward the paper unless the floor needs it back', () => {
    const theme = defaultTheme('light')
    const base = toOklch(theme.colours.accent)
    const out = toOklch(MEDIA.colouredPencil.colour(theme, { key: 'highlight' }, defaultMediumSettings('colouredPencil')).hex)
    expect(contrastRatio(fromOklch({ ...base, l: base.l + 0.05 }), theme.colours.paper)).toBeGreaterThan(3)
    expect(out.l).toBeCloseTo(base.l + 0.05, 2)
    expect(out.c).toBeLessThan(base.c)
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
      const hex = MEDIA.marker.colour(theme, { key }, {}).hex
      expect(contrastRatio(hex, '#8a8a8a'), key).toBeGreaterThanOrEqual(3)
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
      expect(ratio, key).toBeCloseTo(bestContrast('#8a8a8a'), 5)
    }
  })

  it('chalk on a light board a theme gave (an explicit board colour) still reads: 4.5:1, off the chalk range', () => {
    const theme = resolveTheme({ boards: { blackboard: '#808080' } })
    for (const key of ['line', 'auxiliary', 'highlight'] as const) {
      const hex = MEDIA.chalk.colour(theme, { key }, {}).hex
      expect(contrastRatio(hex, '#808080'), key).toBeGreaterThanOrEqual(4.5)
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
        const { hex } = MEDIA.chalk.colour(theme, role, {})
        expect(contrastRatio(hex, theme.boards.greenboard), `${n} ${JSON.stringify(role)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
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
          const out = MEDIA[name].colour(theme, { key: 'label', colour }, defaultMediumSettings(name)).hex
          expect(contrastRatio(out, surface), `${name} ${mode} ${colour}`).toBeGreaterThanOrEqual(FLOOR[name]!)
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

// Read by eye from the first green run: the default theme, per medium, for line, auxiliary, point, highlight and series 0.
const PIN: Record<'light' | 'dark', Record<MediumName, string[]>> = {
  light: {
    clean: ['#17170f', '#6b6b5f', '#a34b3f', '#c65d22', '#b54e0a'],
    ink: ['#171710', '#57574d', '#8e4136', '#933c00', '#933c00'],
    graphite: ['#17170f', '#6b6b5f', '#756663', '#7f716a', '#7c6e68'],
    colouredPencil: ['#22231c', '#797970', '#a96156', '#ca754c', '#ba673d'],
    marker: ['#56564c', '#6b6b5f', '#a34b3f', '#c65d22', '#b54e0a'],
    chalk: ['#eeeeee', '#bebebe', '#e8ada3', '#efac8c', '#efac8d'],
    whiteboard: ['#3a3a3a', '#6e6e6e', '#a34b3f', '#b54e0a', '#b54e0a'],
  },
  dark: {
    clean: ['#f2efe2', '#a19d8c', '#c76a5c', '#e2803f', '#f59151'],
    ink: ['#f2efe3', '#ada99a', '#ea9384', '#ed935c', '#ef955d'],
    graphite: ['#f2efe2', '#a09d8f', '#948482', '#a89a92', '#b9aba3'],
    colouredPencil: ['#e1ded4', '#918e80', '#ac6357', '#c57848', '#d78958'],
    marker: ['#928f83', '#938f7f', '#c76a5c', '#d2722f', '#d2722f'],
    chalk: ['#eeeeee', '#bebebe', '#e9ada2', '#ebae8a', '#ebae8a'],
    whiteboard: ['#3a3a3a', '#6e6e6e', '#ad5346', '#b05400', '#b05400'],
  },
}
