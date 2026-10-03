import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePaintParams } from '../params'
import { CAST_FADE, FAM_SHADOW } from './value'
import { breathe, LOCALS, madeTwoSpheres, spreadOf, underpaintSpread } from './valueFinalFixture'

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
    let castPixelsAbove = 0
    let castPixels = 0
    const params = resolvePaintParams({ ...overrides, seed: c.seed })
    for (const [name, local] of colours) {
      const m = madeTwoSpheres(params, local, c.nlAt, c.opts)
      const s = spreadOf(m, params)
      const u = underpaintSpread(m, params)
      cast += s.nCast
      // the plan: a pixel of the big sphere in the cast shadow (flagged, past the terminator and half the cast fade) in the shadow family is never
      // above the cap. Half the fade, where the cast shadow is still half formed: a plan that let the formed value through to the cap's foot (no
      // fade) would put pixels there above the cap.
      const { plan, fc } = m.an
      const ts = params.value.terminatorSoftness
      for (let i = 0; i < plan.width * plan.height; i++) {
        if (fc.g.mark[i] !== 0 || fc.g.shadow[i] !== 1 || plan.nl[i] < ts / 2 + CAST_FADE / 2) continue
        castPixels++
        if (plan.fam[i] === FAM_SHADOW && plan.u[i] > plan.capU + 1e-6) castPixelsAbove++
      }
      if (s.nShadow >= 5 && s.nLight >= 5 && s.minLight - s.maxShadow < margin) {
        margin = s.minLight - s.maxShadow
        at = `seed ${c.seed} N·L ${c.nlAt} ${name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
      }
      if (u.nShadow >= 50 && u.nLight >= 50) underMargin = Math.min(underMargin, u.minLight - u.maxShadow)
    }
    return { margin, underMargin, at, cast, castPixels, castPixelsAbove }
  }

  // the totals over the whole grid (2 seeds x 2 places x 2 views x 3 colours): the shadow is on the figure to be seen, in strokes and in pixels
  const total = { cast: 0, castPixels: 0 }

  describe.each(cases)('seed $seed, the shadow at N·L $nlAt, view $vi', (c) => {
    it('keeps the order in the strokes and the underpainting, by 0.05', () => {
      const r = run({}, c)
      total.cast += r.cast
      total.castPixels += r.castPixels
      expect(r.castPixelsAbove).toBe(0)
      expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
      expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
    })

    it('and with the brush-load mix at its maxima', () => {
      const r = run({ mix: { valueStep: 0.15, valueStepFraction: 1, strength: 2 } }, c)
      expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
      expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
    })
  })

  it('had a cast shadow on the figure to look at, in strokes and in pixels', () => {
    expect(total.cast, 'strokes in the cast shadow').toBeGreaterThan(100)
    expect(total.castPixels).toBeGreaterThan(2000)
  })
})
