import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA, resolvePaintParams, type PaintParams } from '../params'
import { ROLES, type Oklab } from '../types'
import { linearToOklab } from './colour'
import { terminatorEdgeScale } from './edges'
import { compileCurves } from './respond'
import { buildUnderpaintField, FAM_BAND, underpaintImage } from './underpaint'
import { effectiveValues, newZoneSample, planSample, Z_CORE, Z_HALF, Z_LIGHT, Z_REFLECTED } from './value'
import { gIndex } from './view'
import { breathe, LOCALS, lightnessOf, made, spreadOf, underpaintSpread, GRID_VIEWS, type GridView } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room, and let the worker's event loop turn between them.
vi.setConfig({ testTimeout: 600_000 })
afterEach(breathe)

// A SOFT TERMINATOR (value.terminatorSoftness up to N·L 1: Ben's request, 2026-10-03). The plan turns from the shadow to the light across an
// edge that wide, and the brushwork turns as gently: the underpainting through its band and its ring, the edge strokes between a light plane and a
// form-shadow plane (scaled by 0.1 / terminatorSoftness, to no less than 0.2). At the default 0.1 nothing has changed.

const TERRACOTTA = LOCALS[0][1]
const GREY = LOCALS[3][1]
const VIEW = { azimuth: 30, elevation: 25 }
const withTs = (ts: number, over: Record<string, unknown> = {}): PaintParams => resolvePaintParams({ seed: 1, ...over, value: { terminatorSoftness: ts } })
// the plan alone: no brush-load mix, none of the curve's own deviation or the seeded one
const pure = (ts: number): PaintParams => resolvePaintParams({ seed: 1, mix: { strength: 0 }, curve: { devL: 0, devC: 0, devH: 0 }, value: { deviation: 0, terminatorSoftness: ts } })

describe('the terminator softness slider', () => {
  it('runs to N·L 1 (it ran to 0.4)', () => {
    const s = PARAM_SCHEMA.find((e) => e.path === 'value.terminatorSoftness')!
    expect([s.min, s.max]).toEqual([0, 1])
    expect(DEFAULT_PAINT_PARAMS.value.terminatorSoftness).toBe(0.1)
  })

  it('scales the edges of the terminator by 0.1 / softness, between 0.2 and 1: exactly 1 at the default and for any crisper terminator', () => {
    for (const ts of [0, 0.001, 0.02, 0.05, 0.1]) expect(terminatorEdgeScale(ts), `softness ${ts}`).toBe(1)
    expect(terminatorEdgeScale(0.2)).toBeCloseTo(0.5, 12)
    expect(terminatorEdgeScale(0.3)).toBeCloseTo(1 / 3, 12)
    for (const ts of [0.5, 0.6, 1]) expect(terminatorEdgeScale(ts), `softness ${ts}`).toBe(0.2)
  })
})

describe('the plan’s value gradient through the terminator', () => {
  // du/dN·L at the middle of the edge (N·L 0), where only the terminator's own blend climbs: the plan alone, a central difference
  const slopeAt = (ts: number, nl = 0): number => {
    const p = withTs(ts)
    const c = compileCurves(p)
    const u = (x: number) => planSample(p, c, x, x <= 0, 0, 0, 1, 0, newZoneSample()).u
    return (u(nl + 0.002) - u(nl - 0.002)) / 0.004
  }

  it('is 6 times gentler at 0.6 than at 0.1, and 10 times at 1.0 (the blend is as wide as the slider)', () => {
    const base = slopeAt(0.1)
    expect(base).toBeGreaterThan(3) // a steep edge at the default: the core to the half-tone in a tenth of N·L
    expect(base / slopeAt(0.6)).toBeGreaterThan(5.7)
    expect(base / slopeAt(0.6)).toBeLessThan(6.3)
    expect(base / slopeAt(1)).toBeGreaterThan(9.5)
    expect(base / slopeAt(1)).toBeLessThan(10.5)
  })

  it('is gentler through the whole band, not at its middle only: no steeper than 0.25 of the default’s steepest anywhere in the plan', () => {
    const steepest = (ts: number): number => {
      let worst = 0
      for (let nl = -1; nl < 1; nl += 0.005) worst = Math.max(worst, Math.abs(slopeAt(ts, nl)))
      return worst
    }
    expect(steepest(0.6)).toBeLessThan(0.25 * steepest(0.1))
    expect(steepest(1)).toBeLessThan(0.25 * steepest(0.1))
  })

  it('is as much gentler in the picture: the plan’s step between neighbouring pixels at the middle of the edge, 6 times smaller at 0.6 (a sphere of 120 px)', () => {
    const middle = (ts: number): number => {
      const m = made(withTs(ts), GREY, VIEW, false, [640, 480, 120])
      const { plan, fc } = m.an
      let sum = 0
      let n = 0
      for (let i = 0; i + 1 < plan.width * plan.height; i++) {
        if (fc.g.mark[i] !== 0 || fc.g.mark[i + 1] !== 0 || Math.abs(plan.nl[i]) > 0.02 || Math.abs(plan.nl[i + 1]) > 0.02) continue
        sum += Math.abs(plan.u[i + 1] - plan.u[i])
        n++
      }
      expect(n, `softness ${ts}`).toBeGreaterThan(50)
      return sum / n
    }
    const ratio = middle(0.1) / middle(0.6)
    expect(ratio).toBeGreaterThan(5.2)
    expect(ratio).toBeLessThan(6.8)
  })
})

// The edges of a frame by what they are between: the terminator's (a light-family plane and a form-shadow plane) and the others'.
function edgeClasses(ts: number) {
  const m = made(withTs(ts), TERRACOTTA, VIEW, false, [640, 480, 120])
  const lit = (z: number) => z === Z_LIGHT || z === Z_HALF
  const form = (z: number) => z === Z_CORE || z === Z_REFLECTED
  const term = [0, 0, 0, 0]
  const other = [0, 0, 0, 0]
  let hMax = 0
  let hSum = 0
  let nTerm = 0
  for (const e of m.an.edges.edges) {
    if (e.type !== 'internal') continue
    const za = m.an.planes.planes[e.a].zone
    const zb = m.an.planes.planes[e.b].zone
    const isTerm = (lit(za) && form(zb)) || (form(za) && lit(zb))
    for (let k = 0; k < e.cls.length; k++) {
      if (isTerm) {
        term[e.cls[k]]++
        nTerm++
        hMax = Math.max(hMax, e.h[k])
        hSum += e.h[k]
      } else other[e.cls[k]]++
    }
  }
  return { term, other, hMax, hMean: hSum / Math.max(1, nTerm), nTerm }
}

describe('the edges of the terminator', () => {
  it('are as they were at the default: soft and firm, none lost, none hard (the lab’s view of a terracotta sphere: 89 samples in 7 runs; all internal edges 471 lost, 429 soft, 93 firm)', () => {
    // (the numbers of 1c42b51, before the scale: it is exactly 1 at 0.1)
    const r = edgeClasses(0.1)
    expect(r.term).toEqual([0, 68, 21, 0])
    expect(r.other.map((n, k) => n + r.term[k])).toEqual([471, 429, 93, 0])
    expect(r.hMean).toBeCloseTo(0.403, 3)
  })

  it('go soft with the terminator: at 0.3 every one is soft or lost, at 0.6 and 1.0 every one is lost (the mean score a third, then a fifth, of the default’s)', () => {
    const base = edgeClasses(0.1)
    for (const ts of [0.3, 0.6, 1]) {
      const r = edgeClasses(ts)
      expect(r.nTerm, `softness ${ts}: samples of the terminator's edges`).toBeGreaterThan(50)
      expect(r.term[2] + r.term[3], `softness ${ts}: firm or hard samples`).toBe(0)
      expect(r.hMean, `softness ${ts}`).toBeLessThan(base.hMean * (ts === 0.3 ? 0.4 : 0.25))
      if (ts >= 0.5) {
        expect(r.term[0], `softness ${ts}`).toBe(r.nTerm)
        expect(r.hMax, `softness ${ts}`).toBeLessThan(0.24) // the lost class: below edges.lostBelow
      }
    }
  })

  it('leave the other edges of the figure as they were: a turn within one family, and a cast shadow’s edge, keep their firm samples at 0.6', () => {
    const r = edgeClasses(0.6)
    expect(r.other[2], 'firm samples of the edges that are not the terminator’s').toBeGreaterThan(30)
  })
})

// The underpainting through a wide band: the pixels inside the plan's soft edge are made at their own plan value, and a ring about them blends into
// the lattice. At 0.6 and 1.0 the band is a third and a half of the figure.
describe('the underpainting through a soft terminator', () => {
  const cases: [string, typeof VIEW | { azimuth: number; elevation: number; lightAzimuth: number; lightElevation: number }, number][] = [
    ['the lab’s view, radius 120', VIEW, 120],
    ['the steepest case (the camera at 200/2, the light 30/5), radius 60', { azimuth: 200, elevation: 2, lightAzimuth: 30, lightElevation: 5 }, 60],
    ['a high side light, radius 120', { azimuth: 0, elevation: 40, lightAzimuth: -60, lightElevation: 45 }, 120],
  ]
  for (const ts of [0.6, 1]) {
    for (const [label, opts, radius] of cases) {
      it(`turns as the plan does and has no seam (softness ${ts}; ${label}): within 0.02 of the plan’s value in the band, no step across the band’s edge or the ring’s steeper than the plan’s own by 0.04`, () => {
        const params = pure(ts)
        const m = made(params, GREY, opts, false, [640, 480, radius])
        const field = buildUnderpaintField(m.an, m.g)
        const under = underpaintImage(field, params, m.an.env)
        const valueAt = (i: number) => 0.62 + (linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2])[0] - 0.6) / 0.8
        const live = (i: number) => m.g.mark[i] === 0 && !Number.isNaN(under[3 * i])
        let band = 0
        let gap = 0
        let pairs = 0
        let seam = 0
        let steps = 0
        for (let y = 1; y < m.g.height; y++) {
          for (let x = 1; x < m.g.width; x++) {
            const i = y * m.g.width + x
            if (!live(i)) continue
            if (Math.abs(m.an.plan.nl[i]) < ts / 2) {
              band++
              gap = Math.max(gap, Math.abs(valueAt(i) - m.an.plan.u[i]))
            }
            for (const j of [i - 1, i - m.g.width]) {
              if (!live(j)) continue
              const excess = Math.abs(valueAt(i) - valueAt(j)) - Math.abs(m.an.plan.u[i] - m.an.plan.u[j])
              steps = Math.max(steps, excess)
              if ((field.ownerFam[i] === FAM_BAND) !== (field.ownerFam[j] === FAM_BAND)) {
                pairs++
                seam = Math.max(seam, excess)
              }
            }
          }
        }
        expect(band, 'the band has pixels of the figure in it').toBeGreaterThan(radius * (ts === 1 ? 12 : 8))
        expect(gap, 'the largest gap between the underpainting and the plan in the band').toBeLessThanOrEqual(0.02)
        expect(pairs, 'pairs of neighbours across the band’s edge').toBeGreaterThan(60)
        expect(seam, 'the step across the band’s edge, over the plan’s own').toBeLessThanOrEqual(0.04)
        expect(steps, 'a step anywhere in the underpainting, over the plan’s own').toBeLessThanOrEqual(0.04)
      })
    }
  }
})

// Outside the band the families keep their order: at 0.6 and 1.0 the shadow pixels and strokes are at N·L < -0.3 and -0.5 and the half-tones past
// 0.3 and 0.5. The views with a terminator of the grid, three colours and two seeds, the default mix and the maxima.
describe('the order of the families outside a soft terminator’s band', () => {
  const views: GridView[] = [GRID_VIEWS[0], GRID_VIEWS[2], GRID_VIEWS[3], GRID_VIEWS[4]]
  const colours = [LOCALS[0], LOCALS[2], LOCALS[3]] as [string, Oklab][]
  const maxima = { mix: { valueStep: 0.15, valueStepFraction: 1, strength: 2 } }
  for (const ts of [0.6, 1]) {
    for (const [mixName, over] of [['the default mix', {}], ['the mix at its maxima', maxima]] as [string, object][]) {
      it(`has every shadow stroke and pixel darker than every half-tone stroke and pixel, by 0.05 (softness ${ts}, ${mixName})`, () => {
        let stroke = Infinity
        let under = Infinity
        let nShadow = Infinity
        let nLight = Infinity
        let nUnderShadow = Infinity
        let nUnderLight = Infinity
        let at = ''
        for (const seed of [1, 2]) {
          const params = resolvePaintParams({ ...over, seed, value: { terminatorSoftness: ts } })
          for (const [name, local] of colours) {
            for (const v of views) {
              const m = made(params, local, v.opts, true)
              const s = spreadOf(m, params)
              const u = underpaintSpread(m, params)
              if (s.nShadow >= 1 && s.nLight >= 1) {
                nShadow = Math.min(nShadow, s.nShadow)
                nLight = Math.min(nLight, s.nLight)
                if (s.minLight - s.maxShadow < stroke) {
                  stroke = s.minLight - s.maxShadow
                  at = `seed ${seed}, ${name}, ${v.name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
                }
              }
              if (u.nShadow >= 30 && u.nLight >= 30) {
                nUnderShadow = Math.min(nUnderShadow, u.nShadow)
                nUnderLight = Math.min(nUnderLight, u.nLight)
                under = Math.min(under, u.minLight - u.maxShadow)
              }
            }
          }
        }
        // (the pixels and strokes of both families stand outside the band in some frames: the checks are made)
        expect(Number.isFinite(stroke) && Number.isFinite(under), 'frames with both families outside the band').toBe(true)
        expect(stroke, at).toBeGreaterThanOrEqual(0.05)
        expect(under).toBeGreaterThanOrEqual(0.05)
      })
    }
  }
})

// The strokes' own value across the terminator. A surface stroke is the plane's mean plus 0.45 of its own gradient, and two planes meet at the
// terminator with a step between their means: the underpainting followed the plan's soft edge, the strokes kept that step. Inside the band the
// stroke now follows the plan's own value (and the role's own lightening fades with it), the plane's step outside it, blending across.
describe('the strokes through a soft terminator', () => {
  const bin = (nl: number) => Math.max(0, Math.min(19, Math.floor((nl + 1) * 10)))
  // the step from the bin of N·L -0.1..0 to the bin 0..0.1: the plan's value (every pixel), and the surface strokes' value and lightness (the
  // strokes of the roles that lie on a surface, in the figure's own colour; at least 8 in each bin)
  const stepAcross = (ts: number, seed: number, v: GridView) => {
    const m = made(withTs(ts, { seed }), GREY, v.opts, false)
    const { plan, fc } = m.an
    const sumU = new Array<number>(20).fill(0)
    const sumL = new Array<number>(20).fill(0)
    const nS = new Array<number>(20).fill(0)
    const sumP = new Array<number>(20).fill(0)
    const nP = new Array<number>(20).fill(0)
    for (let i = 0; i < m.batch.count; i++) {
      const d = m.an.drafts[i]
      const role = ROLES[d.role]
      const own = d.colour?.a
      if (role === 'edge' || role === 'line' || !own || Array.isArray(own) || (own as { ground: boolean }).ground) continue
      const gi = gIndex(fc, d.mx, d.my)
      if (gi < 0 || fc.g.mark[gi] !== 0) continue
      const b = bin(plan.nl[gi])
      sumU[b] += d.u
      sumL[b] += lightnessOf(m.batch, i)
      nS[b]++
    }
    for (let i = 0; i < plan.width * plan.height; i++) {
      if (fc.g.mark[i] !== 0) continue
      const b = bin(plan.nl[i])
      sumP[b] += plan.u[i]
      nP[b]++
    }
    expect(Math.min(nS[9], nS[10]), `strokes in the two bins about N·L 0 (softness ${ts}, seed ${seed}, ${v.name})`).toBeGreaterThanOrEqual(8)
    return {
      plan: sumP[10] / nP[10] - sumP[9] / nP[9],
      strokeU: sumU[10] / nS[10] - sumU[9] / nS[9],
      strokeL: sumL[10] / nS[10] - sumL[9] / nS[9],
    }
  }

  for (const ts of [0.6, 1]) {
    for (const vi of [0, 2, 4]) {
      it(`steps across N·L 0 as the plan does, within 1.5 times its step, in value and in lightness (softness ${ts}; ${GRID_VIEWS[vi].name})`, () => {
        for (const seed of [1, 2]) {
          const r = stepAcross(ts, seed, GRID_VIEWS[vi])
          expect(r.plan, 'the plan has a step to follow').toBeGreaterThan(0.03)
          // (without the following the strokes' step is the planes': two times the plan's at 0.6, two and a half at 1.0)
          expect(r.strokeU, `seed ${seed}: the strokes' value`).toBeLessThanOrEqual(1.5 * r.plan)
          expect(r.strokeL, `seed ${seed}: the strokes' lightness`).toBeLessThanOrEqual(1.5 * r.plan)
          expect(r.strokeU, `seed ${seed}: a step, not a ramp reversed`).toBeGreaterThan(0)
        }
      })
    }
  }
})

// The core: a soft terminator softens the way into the core shadow, but the core stays the darkest band of the form shadow (the painter's rule).
// The reflected light's lift started at the core's own width from the terminator's CENTRE, so a wide edge (its foot at -ts/2) ran into the lift
// and the darkest value of the form shadow was 0.264 at 1.0 against the core's 0.240.
describe('the core shadow through a soft terminator', () => {
  for (const ts of [0.1, 0.3, 0.6, 1]) {
    it(`still reaches the core value in the form shadow (softness ${ts}): the darkest plan value on the shadow side is within 0.01 of it, in three views`, () => {
      for (const vi of [0, 2, 4]) {
        const params = withTs(ts)
        const m = made(params, GREY, GRID_VIEWS[vi].opts, false)
        const { plan, fc } = m.an
        const coreU = plan.curves.value(effectiveValues(params).corePlateau)
        let darkest = Infinity
        let side = 0
        for (let i = 0; i < plan.width * plan.height; i++) {
          if (fc.g.mark[i] !== 0 || plan.nl[i] >= 0) continue
          side++
          darkest = Math.min(darkest, plan.u[i])
        }
        expect(side, `${GRID_VIEWS[vi].name}: pixels of the form shadow`).toBeGreaterThan(500)
        expect(darkest, `${GRID_VIEWS[vi].name}: darkest ${darkest.toFixed(3)} against the core ${coreU.toFixed(3)}`).toBeLessThanOrEqual(coreU + 0.01)
        expect(darkest).toBeGreaterThanOrEqual(coreU - 1e-6)
      }
    })
  }

  it('keeps the core plateau from the edge’s foot out to the core’s width past it, at softness 1 (the lift starts there), and as it was at the default', () => {
    // the plan alone, along N·L, for an up-facing normal with a bounce amount (the lift is there): the core value from the edge's foot at -0.5
    // to -0.64 (it started at -0.2 and the edge's foot at -0.5 was past it, so the lift had begun)
    const at = (ts: number, nl: number) => {
      const p = withTs(ts)
      return planSample(p, compileCurves(p), nl, true, 0, 0, 1, 0, newZoneSample()).u
    }
    const core = compileCurves(withTs(1)).value(effectiveValues(withTs(1)).corePlateau)
    for (const nl of [-0.5, -0.55, -0.6, -0.64]) expect(at(1, nl), `N·L ${nl}`).toBeCloseTo(core, 9)
    expect(at(1, -0.9)).toBeGreaterThan(core + 0.02) // (and the reflected light is there past it)
    // at the default the lift starts the core's own width from the centre, as it always did
    expect(at(0.1, -0.2)).toBeCloseTo(core, 9)
    expect(at(0.1, -0.5)).toBeGreaterThan(core + 0.02)
  })
})
