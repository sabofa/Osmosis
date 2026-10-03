import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePaintParams } from '../params'
import { FAM_SHADOW } from './value'
import {
  breathe, castShare, CAST_MIDDLE, GRID_VIEWS, LOCALS, made, madeTwoSpheres, spreadOf, underpaintSpread, type CastShare,
} from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room, and keep each test to a few frames (a worker that
// is busy for too long in one synchronous stretch misses its reply to the runner and the run reports a timeout).
vi.setConfig({ testTimeout: 600_000 })
afterEach(breathe)

// A cast shadow ON a figure (a small sphere held in the key light over a big one), where the sphere on a table has none: the shadow map flags
// pixels with N·L > 0 as shadow, and what the plan, the strokes and the underpainting make of them is the shadow family's, never a half-tone's.

describe('a small sphere’s shadow falling on a big one', () => {
  const colours = [LOCALS[3], LOCALS[2], LOCALS[0]] as const // grey, dark blue, terracotta
  // the shadow falls where the big sphere's N·L is 0.15 (in the terminator's fade) and 0.4 (well into the light); the default light on the default
  // camera, and a light fixed in the world
  const views = [{ azimuth: 30, elevation: 25 }, { azimuth: 120, elevation: 10, light: [200, 10] as const }]
  const cases = [1, 2].flatMap((seed) => [0.15, 0.4].flatMap((nlAt) => views.map((opts, vi) => ({ seed, nlAt, opts, vi }))))

  const run = (overrides: object, c: (typeof cases)[number]) => {
    let margin = Infinity
    let underMargin = Infinity
    let at = ''
    let cast = 0
    let castPixelsBad = 0
    let castPixels = 0
    const params = resolvePaintParams({ ...overrides, seed: c.seed })
    for (const [name, local] of colours) {
      const m = madeTwoSpheres(params, local, c.nlAt, c.opts)
      const s = spreadOf(m, params)
      const u = underpaintSpread(m, params)
      cast += s.nCast
      // the plan: a pixel of the big sphere in the cast shadow (flagged, past the middle of the fade, where the cast weight is a half) is in the
      // shadow family and never above the cap, at any softness of the terminator. A plan that let the formed value through to the cap's foot (no
      // fade) would put pixels there above the cap.
      const { plan, fc } = m.an
      for (let i = 0; i < plan.width * plan.height; i++) {
        if (fc.g.mark[i] !== 0 || fc.g.shadow[i] !== 1 || plan.nl[i] < CAST_MIDDLE) continue
        castPixels++
        if (plan.fam[i] !== FAM_SHADOW || plan.u[i] > plan.capU + 1e-6) castPixelsBad++
      }
      if (s.nShadow >= 5 && s.nLight >= 5 && s.minLight - s.maxShadow < margin) {
        margin = s.minLight - s.maxShadow
        at = `seed ${c.seed} N·L ${c.nlAt} ${name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
      }
      if (u.nShadow >= 50 && u.nLight >= 50) underMargin = Math.min(underMargin, u.minLight - u.maxShadow)
    }
    return { margin, underMargin, at, cast, castPixels, castPixelsBad }
  }

  // the totals over the whole grid (2 seeds x 2 places x 2 views x 3 colours): the shadow is on the figure to be seen, in strokes and in pixels
  const total = { cast: 0, castPixels: 0, tests: 0 }
  const totalMax = { cast: 0, tests: 0 }

  describe.each(cases)('seed $seed, the shadow at N·L $nlAt, view $vi', (c) => {
    it('keeps the order in the strokes and the underpainting, by 0.05', () => {
      const r = run({}, c)
      total.cast += r.cast
      total.castPixels += r.castPixels
      total.tests++
      expect(r.castPixelsBad).toBe(0)
      expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
      expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
    })

    it('and with the brush-load mix at its maxima', () => {
      const r = run({ mix: { valueStep: 0.15, valueStepFraction: 1, strength: 2 } }, c)
      totalMax.cast += r.cast
      totalMax.tests++
      expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
      expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
    })
  })

  it('had a cast shadow on the figure to look at, in strokes and in pixels, in every frame of the grid above (the defaults, and the maxima)', () => {
    expect(total.tests, 'frames of the defaults').toBe(cases.length)
    expect(totalMax.tests, 'frames of the maxima').toBe(cases.length)
    expect(total.cast, 'strokes in the cast shadow').toBeGreaterThan(100)
    expect(totalMax.cast, 'strokes in the cast shadow, the mix at its maxima').toBeGreaterThan(100)
    expect(total.castPixels).toBeGreaterThan(2000)
  })

  // the same shadow under a soft terminator: it is the same shadow (a cast shadow is never softened by the terminator's band)
  describe.each([0.6, 1])('under a terminator softness of %s', (ts) => {
    it.each(views.map((opts, vi) => ({ opts, vi })))('keeps the order in the strokes and the underpainting, by 0.05: the shadow at N·L 0.15, view $vi', ({ opts }) => {
      const params = resolvePaintParams({ seed: 1, value: { terminatorSoftness: ts } })
      let strokes = 0
      for (const [name, local] of colours) {
        const m = madeTwoSpheres(params, local, 0.15, opts)
        const s = spreadOf(m, params)
        const u = underpaintSpread(m, params)
        strokes += s.nCast
        if (s.nShadow >= 5 && s.nLight >= 5) expect(s.minLight - s.maxShadow, `${name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`).toBeGreaterThanOrEqual(0.05)
        if (u.nShadow >= 50 && u.nLight >= 50) expect(u.minLight - u.maxShadow, name).toBeGreaterThanOrEqual(0.05)
      }
      expect(strokes, 'strokes in the cast shadow').toBeGreaterThan(10)
    })
  })
})

// A cast shadow is the shadow family's wherever it falls, whatever the softness of the terminator: the table's (a ground has no terminator, so
// every flagged pixel of it is cast) under a low sun, and a figure's own, past the graze where the flag is the terminator's. The cast weight used to
// start at half the softness, so a cast shadow on any surface with N·L under that took the terminator's blend and joined the half-tones: all the
// table's cast shadow at a light elevation of 10° under a softness of 0.6.
describe('a cast shadow under a wide terminator', () => {
  const share = (c: CastShare, what: 'figure' | 'ground' | 'all') => (c[what] === 0 ? NaN : c[`${what}Ok` as 'figureOk' | 'groundOk' | 'allOk'] / c[what])
  const GREY = LOCALS[3][1]

  describe.each([0.1, 0.6, 1])('softness %s', (ts) => {
    const params = resolvePaintParams({ seed: 1, value: { terminatorSoftness: ts } })

    it.each([
      ['the lab’s view (the table’s N·L 0.62)', GRID_VIEWS[0]],
      ['a light at 5° (N·L 0.087)', GRID_VIEWS[1]],
      ['a light at 10° (N·L 0.174)', GRID_VIEWS[3]],
    ] as const)('keeps the table’s cast shadow in the shadow family, under the cap: %s', (_, v) => {
      const c = castShare(made(params, GREY, v.opts, false))
      expect(c.ground, 'flagged pixels of the table').toBeGreaterThan(500)
      expect(share(c, 'ground'), `${c.groundOk} of ${c.ground}`).toBeGreaterThanOrEqual(0.95)
    })

    it.each([0.15, 0.4])('keeps a small sphere’s shadow on a big one in the shadow family, under the cap: N·L %s', (nlAt) => {
      let figure = 0
      let figureOk = 0
      let all = 0
      let allOk = 0
      for (const opts of [{ azimuth: 30, elevation: 25 }, { azimuth: 120, elevation: 10, light: [200, 10] as const }]) {
        const c = castShare(madeTwoSpheres(params, GREY, nlAt, opts))
        figure += c.figure
        figureOk += c.figureOk
        all += c.all
        allOk += c.allOk
      }
      expect(figure, 'flagged pixels of the big sphere past the graze').toBeGreaterThan(1000)
      // (at the default's 0.1 the first hundredths past the graze are still the terminator's: 97 in a hundred; under a wide edge a cast shadow is
      // the plan's wherever it is flagged past the graze, and the whole of it: a shadow-family pixel that was lighter than the cap, where the
      // light weight was under a half only by the edge's own blend, is 3 in a hundred of them)
      expect(figureOk / figure, `${figureOk} of ${figure}`).toBeGreaterThanOrEqual(ts >= 0.5 ? 0.99 : 0.95)
      // (every flagged pixel above the terminator, the graze included: the first hundredths of N·L, where the flag is the terminator's own and the
      // cast weight under a half, are most of what is left over; under the default's 0.1 it is 94 in a hundred, and less than that nowhere)
      expect(allOk / all, `${allOk} of ${all}`).toBeGreaterThanOrEqual(0.93)
    })
  })
})
