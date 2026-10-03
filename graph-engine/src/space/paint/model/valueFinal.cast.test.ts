import { describe, expect, it, vi } from 'vitest'
import { resolvePaintParams } from '../params'
import { CAST_FADE, FAM_SHADOW } from './value'
import { LOCALS, madeTwoSpheres, spreadOf, underpaintSpread } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 600_000 })

// A cast shadow ON a figure (a small sphere held in the key light over a big one), where the sphere on a table has none: the shadow map flags
// pixels with N·L > 0 as shadow, and what the plan, the strokes and the underpainting make of them is the shadow family's, never a half-tone's.

describe('a small sphere’s shadow falling on a big one', () => {
  const colours = [LOCALS[3], LOCALS[2], LOCALS[0]] as const // grey, dark blue, terracotta
  // the shadow falls where the big sphere's N·L is 0.15 (in the terminator's fade) and 0.4 (well into the light); the default light on the default
  // camera, and a light fixed in the world
  const spots = [0.15, 0.4]
  const views = [{ azimuth: 30, elevation: 25 }, { azimuth: 120, elevation: 10, light: [200, 10] as const }]

  const run = (overrides: object) => {
    let margin = Infinity
    let underMargin = Infinity
    let at = ''
    let cast = 0
    let castPixelsAbove = 0
    let castPixels = 0
    for (const seed of [1, 2]) {
      const params = resolvePaintParams({ ...overrides, seed })
      for (const nlAt of spots) {
        for (const opts of views) {
          for (const [name, local] of colours) {
            const m = madeTwoSpheres(params, local, nlAt, opts)
            const s = spreadOf(m, params)
            const u = underpaintSpread(m, params)
            cast += s.nCast
            // the plan: a pixel of the big sphere in the cast shadow (flagged, past the terminator) in the shadow family is never above the cap
            const { plan, fc } = m.an
            const ts = params.value.terminatorSoftness
            for (let i = 0; i < plan.width * plan.height; i++) {
              if (fc.g.mark[i] !== 0 || fc.g.shadow[i] !== 1 || plan.nl[i] < ts / 2 + CAST_FADE) continue
              castPixels++
              if (plan.fam[i] === FAM_SHADOW && plan.u[i] > plan.capU + 1e-6) castPixelsAbove++
            }
            if (s.nShadow >= 5 && s.nLight >= 5 && s.minLight - s.maxShadow < margin) {
              margin = s.minLight - s.maxShadow
              at = `seed ${seed} N·L ${nlAt} ${name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
            }
            if (u.nShadow >= 50 && u.nLight >= 50) underMargin = Math.min(underMargin, u.minLight - u.maxShadow)
          }
        }
      }
    }
    return { margin, underMargin, at, cast, castPixels, castPixelsAbove }
  }

  it('keeps the order in the strokes and the underpainting where the shadow lies on the figure (2 seeds x 2 places x 2 views x 3 colours), by 0.05', () => {
    const r = run({})
    // the shadow is on the figure to be seen: strokes and pixels stand in it
    expect(r.cast, 'strokes in the cast shadow').toBeGreaterThan(100)
    expect(r.castPixels).toBeGreaterThan(2000)
    expect(r.castPixelsAbove).toBe(0)
    expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
    expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
  })

  it('and with the brush-load mix at its maxima', () => {
    const r = run({ mix: { valueStep: 0.15, valueStepFraction: 1, strength: 2 } })
    expect(r.cast).toBeGreaterThan(100)
    expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
    expect(r.underMargin).toBeGreaterThanOrEqual(0.05)
  })
})
