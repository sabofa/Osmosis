import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { ZONES } from '../types'
import { compileCurves } from './respond'
import { paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import {
  ambientShare,
  bounceAmount,
  bounceWeight,
  BOUNCE_DIR,
  buildPlanMap,
  CAST_FADE,
  canvasValue,
  CONTACT_FULL,
  FAM_SHADOW,
  halfToneLowest,
  newZoneSample,
  planSample,
  rawLitValue,
  reflectedMax,
  Z_CAST,
  Z_CORE,
  Z_HALF,
  Z_LIGHT,
  Z_REFLECTED,
} from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS

type V3 = readonly [number, number, number]
const UP: V3 = [0, 0, 1]
const SIDE: V3 = [1, 0, 0]
const TABLE: V3 = [BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2]]

// The plan at N·L = nl for a normal n (the renderer flags every N·L <= 0 as shadow; `cast` flags the key light's
// occlusion on a surface facing it). ao: the occlusion 0..1.
function plan(params: PaintParams, nl: number, opts: { n?: V3; cast?: boolean; ao?: number } = {}) {
  const n = opts.n ?? SIDE
  return planSample(params, compileCurves(params), nl, opts.cast === true || nl <= 0, n[0], n[1], n[2], opts.ao ?? 0, newZoneSample())
}

// Round numbers for hand values: the half-tone ramp rises over N·L 0..0.5, the turn to light is 0.4..0.6, the
// terminator edge is ±0.05, the core runs to -0.2 and the lift to reflected light to -0.4. No fill light, so the
// bounce amount is whatever a test chooses (the ambient slider alone sets it: 0.18 is 0.25, 1 is the cap).
const R = resolvePaintParams({
  value: { lightTurn: 0.5, lightSoftness: 0.2, terminatorSoftness: 0.1, coreWidth: 0.2, reflectedSoftness: 0.2 },
  light: { ambient: 0, sky: 0, bounce: 0 },
})
const RF = resolvePaintParams(
  { value: { lightTurn: 0.5, lightSoftness: 0.2, terminatorSoftness: 0.1, coreWidth: 0.2, reflectedSoftness: 0.2 }, light: { ambient: 0.18, sky: 0, bounce: 0 } },
)

describe('the value plan: two families, divided by the terminator', () => {
  it('has the shadow family below the half-tones by construction: the ceiling is core + share of the gap', () => {
    // 0.24 + 0.4 · (0.52 − 0.24) = 0.352: the darkest the reflected light gets
    expect(reflectedMax(P)).toBeCloseTo(0.352, 12)
    expect(halfToneLowest(P)).toBe(0.52)
    // a share of 0 is the core itself, 0.9 nearly the half-tone, and the share is held to 0.9
    expect(reflectedMax(resolvePaintParams({ value: { reflectedShare: 0 } }))).toBeCloseTo(0.24, 12)
    expect(reflectedMax(resolvePaintParams({ value: { reflectedShare: 0.9 } }))).toBeCloseTo(0.24 + 0.9 * 0.28, 12)
    expect(reflectedMax(resolvePaintParams({ value: { reflectedShare: 5 } }))).toBeCloseTo(0.24 + 0.9 * 0.28, 12)
  })

  it('keeps every shadow-family value darker than every half-tone, over a grid of N·L, bounce, sky, ambient and occlusion', () => {
    const normals: V3[] = [UP, SIDE, TABLE, [0, 0, -1], [0.6, 0, 0.8], [0, -0.7071, -0.7071]]
    for (const share of [0, 0.4, 0.9]) {
      for (const occlusion of [0, 0.35, 1]) {
        for (const bounce of [0, 0.1, 1]) {
          for (const sky of [0, 0.12, 1]) {
            for (const ambient of [0, 0.18, 1]) {
              const params = resolvePaintParams({
                value: { reflectedShare: share },
                environment: { occlusion },
                light: { bounce, sky, ambient },
              })
              const ts = params.value.terminatorSoftness
              const ceiling = reflectedMax(params)
              const floor = halfToneLowest(params)
              let maxShadow = -1
              let minLight = 2
              for (const n of normals) {
                for (const ao of [0, 0.3, 1]) {
                  for (let k = -20; k <= 20; k++) {
                    const nl = k / 20
                    // the form shadow, past the soft edge of the terminator (the renderer flags it shadow)
                    if (nl <= -ts / 2) maxShadow = Math.max(maxShadow, plan(params, nl, { n, ao }).u)
                    // the cast shadow: the key light occluded on a surface facing it, past the edge and its fade
                    if (nl >= ts / 2 + CAST_FADE) maxShadow = Math.max(maxShadow, plan(params, nl, { n, ao, cast: true }).u)
                    // the light family: facing the key light, not in cast shadow
                    if (nl >= ts / 2) minLight = Math.min(minLight, plan(params, nl, { n, ao }).u)
                  }
                }
              }
              const ctx = `share ${share}, occlusion ${occlusion}, bounce ${bounce}, sky ${sky}, ambient ${ambient}`
              expect(maxShadow, ctx).toBeLessThanOrEqual(ceiling + 1e-12)
              expect(minLight, ctx).toBeGreaterThanOrEqual(floor - 1e-12)
              // with a margin: the gap between the core and the darkest half-tone, less the share the bounce may take
              expect(minLight - maxShadow, ctx).toBeGreaterThanOrEqual((1 - share) * (floor - params.value.corePlateau) - 1e-12)
            }
          }
        }
      }
    }
  })

  it('never lets the bounce, the sky or the ambient lift the reflected light past reflectedMax, at their slider maxima', () => {
    const maxed = resolvePaintParams({ light: { bounce: 1, sky: 1, ambient: 1 }, environment: { occlusion: 0 } })
    const ceiling = reflectedMax(maxed)
    for (const n of [UP, SIDE, TABLE, [0, 0, -1] as V3, [0.3, 0.3, 0.9055] as V3]) {
      let top = 0
      for (let k = -100; k <= -5; k++) top = Math.max(top, plan(maxed, k / 100, { n }).u)
      expect(top).toBeLessThanOrEqual(ceiling + 1e-12)
    }
    // and they do lift it all the way: a normal facing the table at the slider maxima reaches the cap exactly
    expect(plan(maxed, -0.9, { n: TABLE }).u).toBeCloseTo(ceiling, 12)
    expect(bounceAmount(maxed, TABLE[0], TABLE[1], TABLE[2])).toBe(1)
    // the cap is the plan's, whatever the sliders: a different share moves it
    const high = resolvePaintParams({ light: { bounce: 1, sky: 1, ambient: 1 }, value: { reflectedShare: 0.9 } })
    expect(plan(high, -0.9, { n: TABLE }).u).toBeCloseTo(0.24 + 0.9 * 0.28, 12)
  })

  it('puts the darkest value of a lit sphere in the core band, between the terminator and -coreWidth, not on the far side', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view })
    const map = buildPlanMap(makeFrameCtx(sceneOf([sphereMesh()]), view, g, P))
    const { coreWidth, terminatorSoftness: ts, reflectedSoftness: rs, corePlateau } = P.value
    let low = -1
    let farLowest = 2
    let filled = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      filled++
      if (low < 0 || map.u[i] < map.u[low]) low = i
      // the far side of the sphere: past the core and the soft lift to the reflected light
      if (map.nl[i] < -(coreWidth + rs)) farLowest = Math.min(farLowest, map.u[i])
    }
    expect(filled).toBeGreaterThan(5000)
    expect(map.u[low]).toBeCloseTo(corePlateau, 6)
    expect(map.nl[low]).toBeLessThanOrEqual(0)
    expect(map.nl[low]).toBeGreaterThanOrEqual(-coreWidth)
    // every pixel at the plateau lies inside the core band (the edge of the terminator and the lift are its ends)
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0 || Math.abs(map.u[i] - corePlateau) > 1e-6) continue
      expect(map.nl[i]).toBeLessThanOrEqual(ts / 2)
      expect(map.nl[i]).toBeGreaterThanOrEqual(-(coreWidth + rs))
    }
    // the far side is lighter than the core: the reflected light lifts it
    expect(farLowest).toBeGreaterThan(corePlateau + 0.02)
  })

  it('holds the light family: the half-tone from halfLo at the terminator, the soft turn to light, the light to the highlight', () => {
    const at = (nl: number) => plan(R, nl).u
    // half-tone ramp, over N·L 0..0.5 (a smoothstep): a quarter of the way up is 0.52 + 0.2·S(0.5) = 0.62
    expect(at(0.25)).toBeCloseTo(0.62, 12)
    // the turn to light is centred on lightTurn: half-way between halfHi and lightLo, 0.72 + 0.065
    expect(at(0.5)).toBeCloseTo(0.785, 12)
    // past the turn the light ramp runs to the highlight: at 0.75 it is half-way, 0.72 + 0.13 + 0.09·0.5
    expect(at(0.75)).toBeCloseTo(0.895, 12)
    expect(at(1)).toBeCloseTo(0.94, 12)
    // a half-tone is never lighter than the light beside it, and the family only rises toward the light
    let prev = -1
    for (let k = 0; k <= 200; k++) {
      const u = at(k / 200)
      expect(u).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = u
    }
    // the half-tone's darkest value, just past the terminator, is halfLo
    expect(at(0.05)).toBeCloseTo(0.52 + 0.2 * 0.028, 12)
  })

  it('holds the core as a plateau from the terminator to -coreWidth, and the reflected light beyond it', () => {
    // no bounce at all (amount 0): the whole form shadow is the core plateau
    for (const nl of [-0.06, -0.15, -0.2, -0.3, -0.5, -1]) expect(plan(R, nl).u).toBeCloseTo(0.24, 12)
    // the ambient alone (amount 0.25): the core holds to -0.2, then lifts 0.25 of the way over 0.2 of N·L
    for (const nl of [-0.06, -0.12, -0.2]) expect(plan(RF, nl).u).toBeCloseTo(0.24, 12)
    // half-way up the lift (-0.3: S(0.5) = 0.5): 0.24 + (0.352 − 0.24)·0.25·0.5
    expect(plan(RF, -0.3).u).toBeCloseTo(0.24 + 0.112 * 0.25 * 0.5, 12)
    // all the way (-0.4 and beyond): 0.24 + 0.112·0.25
    expect(plan(RF, -0.4).u).toBeCloseTo(0.24 + 0.112 * 0.25, 12)
    expect(plan(RF, -1).u).toBeCloseTo(0.24 + 0.112 * 0.25, 12)
    // facing the table the amount is 1 (0.85 bounce + 0.25 ambient, capped): the lift reaches reflectedMax
    const facing = resolvePaintParams({ value: R.value, light: { ambient: 0.18, sky: 0, bounce: 0.1 } })
    expect(plan(facing, -0.4, { n: TABLE }).u).toBeCloseTo(0.352, 12)
    // the plateau is a slider, and moves the cap with it
    const moved = resolvePaintParams({ value: { ...R.value, corePlateau: 0.1 }, light: { ambient: 0.18, sky: 0, bounce: 0.1 } })
    expect(plan(moved, -0.1).u).toBeCloseTo(0.1, 12)
    expect(plan(moved, -0.4, { n: TABLE }).u).toBeCloseTo(0.1 + 0.4 * 0.42, 12)
  })

  it('makes the terminator an edge centred on N·L = 0, terminatorSoftness wide', () => {
    // the middle of the edge: half core, half the darkest half-tone
    expect(plan(R, 0).u).toBeCloseTo((0.24 + 0.52) / 2, 12)
    // its ends are ±softness/2: the core before, the half-tone after
    expect(plan(R, -0.05).u).toBeCloseTo(0.24, 12)
    expect(plan(R, 0.05).u).toBeCloseTo(0.52 + 0.2 * 0.028, 12)
    // a wider edge is a wider gradation: softness 0.3 spans ±0.15, and N·L = 0.075 is three quarters in, S(0.75) = 0.84375
    const wide = resolvePaintParams({ value: { ...R.value, terminatorSoftness: 0.3 }, light: { ambient: 0, sky: 0, bounce: 0 } })
    expect(plan(wide, 0.075).u).toBeCloseTo(0.24 * (1 - 0.84375) + (0.52 + 0.2 * (3 * 0.15 ** 2 - 2 * 0.15 ** 3)) * 0.84375, 9)
    // zero softness is not a division by zero
    expect(Number.isFinite(plan(resolvePaintParams({ value: { terminatorSoftness: 0 } }), 0).u)).toBe(true)
  })

  it('makes every transition smooth: the slope is continuous across the turn to light, the terminator and the lift to reflected light', () => {
    const h = 0.0005
    const bounce = resolvePaintParams({ light: { ambient: 1, sky: 0, bounce: 0.1 } })
    const u = (nl: number) => plan(bounce, nl, { n: TABLE }).u
    const regions: [string, number, number, number][] = [
      ['the turn to light', P.value.lightTurn - P.value.lightSoftness / 2, P.value.lightTurn + P.value.lightSoftness / 2, P.value.lightLo - P.value.halfHi],
      ['the terminator', -P.value.terminatorSoftness / 2, P.value.terminatorSoftness / 2, P.value.halfLo - P.value.corePlateau],
      ['the lift to reflected light', -(P.value.coreWidth + P.value.reflectedSoftness), -P.value.coreWidth, reflectedMax(P) - P.value.corePlateau],
    ]
    for (const [name, a, b, amp] of regions) {
      const w = b - a
      // the slopes across the whole width and a little beyond it
      let maxSlope = 0
      let maxStep = 0
      let prevSlope = Number.NaN
      for (let nl = a - 0.05; nl < b + 0.05; nl += h) {
        const slope = (u(nl + h) - u(nl)) / h
        maxSlope = Math.max(maxSlope, Math.abs(slope))
        if (!Number.isNaN(prevSlope)) maxStep = Math.max(maxStep, Math.abs(slope - prevSlope))
        prevSlope = slope
      }
      // a real gradation: it goes somewhere, and the slope never takes a corner: between two steps of h it moves
      // by a few percent of its peak (a smoothstep: 4h/w of it), where a clamped ramp, with a corner at each end,
      // moves it by all of it at once
      expect(maxSlope, name).toBeGreaterThan(0.9 * (amp / w))
      expect(maxStep, name).toBeLessThanOrEqual(0.1 * maxSlope)
    }
  })

  it('makes the terminator crisper than the turn to light and the lift to reflected light', () => {
    // the width over which each transition does its work: where its slope is above half its own steepest
    const bounce = resolvePaintParams({ light: { ambient: 1, sky: 0, bounce: 0.1 } })
    const u = (nl: number) => plan(bounce, nl, { n: TABLE }).u
    const widthOf = (from: number, to: number) => {
      const h = 0.001
      const slopes: number[] = []
      for (let nl = from; nl < to; nl += h) slopes.push(Math.abs(u(nl + h) - u(nl)) / h)
      const peak = Math.max(...slopes)
      return slopes.filter((s) => s >= 0.5 * peak).length * h
    }
    const terminator = widthOf(-0.1, 0.1)
    const turn = widthOf(0.2, 1)
    const lift = widthOf(-1, -0.15)
    expect(terminator).toBeGreaterThan(0.02)
    expect(terminator).toBeLessThan(0.5 * turn)
    expect(terminator).toBeLessThan(0.5 * lift)
    // and the parameters say so: the terminator is the narrowest of the three, by a wide margin
    expect(P.value.terminatorSoftness).toBeLessThan(0.25 * P.value.lightSoftness)
    expect(P.value.terminatorSoftness).toBeLessThan(0.35 * P.value.reflectedSoftness)
    // "clearly defined": the edge is done within ± its width, the whole drop from half-tone to core
    const drop = plan(P, P.value.terminatorSoftness).u - plan(P, -P.value.terminatorSoftness).u
    expect(drop).toBeGreaterThan(0.9 * (P.value.halfLo - P.value.corePlateau))
  })

  it('widens the turn to light and the lift to reflected light with their softness sliders', () => {
    const wider = resolvePaintParams({ value: { ...R.value, lightSoftness: 0.6 }, light: R.light })
    // at N·L 0.3 (0.2 below the turn): outside the 0.2-wide turn it is all half-tone, inside the 0.6-wide one it has begun
    expect(plan(R, 0.3).u).toBeCloseTo(0.52 + 0.2 * (3 * 0.36 - 2 * 0.216), 12)
    expect(plan(wider, 0.3).u).toBeGreaterThan(plan(R, 0.3).u + 0.005)
    const soft = resolvePaintParams({ value: { ...RF.value, reflectedSoftness: 0.8 }, light: RF.light })
    expect(plan(soft, -0.4).u).toBeLessThan(plan(RF, -0.4).u - 0.005)
  })

  it('takes the cast shadow to castContact at an occlusion, castPlateau away from it, and never past reflectedMax', () => {
    const cast = (params: PaintParams, ao: number) => plan(params, 0.6, { n: UP, cast: true, ao })
    // far from a contact: the plateau
    expect(cast(P, 0).u).toBeCloseTo(0.32, 12)
    expect(cast(P, 0).zone).toBe(Z_CAST)
    expect(cast(P, 0).w[4]).toBe(1)
    // at the contact (occlusion 0.35 · ao 0.4 is past the CONTACT_FULL that makes it fully dark): castContact
    expect(cast(P, 0.4).u).toBeCloseTo(0.2, 12)
    // in between it is darker the closer: occlusion 0.35 · ao 0.1 = 0.035 of CONTACT_FULL
    expect(cast(P, 0.1).u).toBeCloseTo(0.32 + (0.2 - 0.32) * ((0.35 * 0.1) / CONTACT_FULL), 12)
    let prev = 1
    for (let ao = 0; ao <= 0.5; ao += 0.02) {
      const u = cast(P, ao).u
      expect(u).toBeLessThanOrEqual(prev + 1e-12)
      prev = u
    }
    // the occlusion slider off: no contact darkening
    expect(cast(resolvePaintParams({ environment: { occlusion: 0 } }), 0.9).u).toBeCloseTo(0.32, 12)
    // a plateau set above the reflected light is held to it: the cast shadow is shadow
    const high = resolvePaintParams({ value: { castPlateau: 0.9, castContact: 0.8 } })
    expect(cast(high, 0).u).toBeCloseTo(reflectedMax(high), 12)
    expect(cast(high, 1).u).toBeCloseTo(reflectedMax(high), 12)
    // the plateaus are sliders
    expect(cast(resolvePaintParams({ value: { castPlateau: 0.28 } }), 0).u).toBeCloseTo(0.28, 12)
    expect(cast(resolvePaintParams({ value: { castContact: 0.1 } }), 1).u).toBeCloseTo(0.1, 12)
  })

  it('keeps the form shadow off the cast shadow: the renderer flags N·L <= 0, and the flag counts for something only past N·L 0', () => {
    // on the shadow side of the terminator the shadow flag changes nothing: it is the form's
    for (const nl of [-0.2, -0.04, 0]) expect(plan(P, nl, { cast: true }).u).toBeCloseTo(plan(P, nl, { cast: false }).u, 12)
    // past the fade it is the cast shadow, wholly
    expect(plan(P, CAST_FADE, { n: UP, cast: true }).u).toBeCloseTo(0.32, 12)
    expect(plan(P, CAST_FADE / 2, { n: UP, cast: true }).u).toBeGreaterThan(0.32)
    expect(plan(P, CAST_FADE / 2, { n: UP, cast: true }).u).toBeLessThan(plan(P, CAST_FADE / 2, { n: UP, cast: false }).u)
  })

  it('never softens a cast shadow with the terminator’s band: the gate is N·L 0 whatever the softness, and a ground has no terminator at all', () => {
    const curves = (p: PaintParams) => compileCurves(p)
    const at = (p: PaintParams, nl: number, shadow: boolean, ground: boolean) => planSample(p, curves(p), nl, shadow, 0, 0, 1, 0, newZoneSample(), ground)
    // (a figure's pixel flagged as shadow at N·L 0.2: past the fade, so the cast plateau, at every softness, and nowhere near a half-tone)
    for (const ts of [0.02, 0.1, 0.3, 0.6, 1]) {
      const p = resolvePaintParams({ value: { terminatorSoftness: ts } })
      const lit = at(p, 0.2, false, false)
      const cast = at(p, 0.2, true, false)
      expect(cast.u, `softness ${ts}`).toBeCloseTo(0.32, 12)
      expect(cast.fam, `softness ${ts}`).toBe(FAM_SHADOW)
      expect(cast.w[4], `softness ${ts}`).toBe(1)
      expect(lit.u, `softness ${ts}`).toBeGreaterThan(0.45)
      // a ground, flagged: wholly cast at ANY N·L (a flat table's N·L is the light's own elevation), even a graze, even the light under the horizon
      for (const nl of [-0.3, 0, 0.02, 0.087, 0.174, 0.6]) {
        const g = at(p, nl, true, true)
        expect(g.u, `softness ${ts}, ground N·L ${nl}`).toBeCloseTo(0.32, 12)
        expect(g.fam).toBe(FAM_SHADOW)
        expect(g.w[4]).toBe(1)
      }
    }
  })

  it('takes the bounce away from the form shadow at a contact: the occlusion blocks the reflected light', () => {
    const open = plan(P, -0.5, { n: TABLE, ao: 0 }).u
    const shut = plan(P, -0.5, { n: TABLE, ao: 0.5 }).u
    expect(open).toBeGreaterThan(P.value.corePlateau + 0.05)
    expect(shut).toBeCloseTo(P.value.corePlateau, 12)
    // but the key light's side is not darkened by it: a crease the light reaches is lit
    expect(plan(P, 0.4, { n: UP, ao: 1 }).u).toBeCloseTo(plan(P, 0.4, { n: UP, ao: 0 }).u, 12)
  })

  it('weighs the zones: they sum to one, and the dominant one names the pixel', () => {
    for (let nl = -1; nl <= 1; nl += 0.01) {
      for (const n of [UP, SIDE, TABLE]) {
        for (const cast of [false, true]) {
          const s = plan(P, nl, { n, cast })
          expect(s.w[0] + s.w[1] + s.w[2] + s.w[3] + s.w[4]).toBeCloseTo(1, 9)
          for (const w of s.w) expect(w).toBeGreaterThanOrEqual(-1e-12)
          expect(s.trans).toBeCloseTo(1 - s.w[s.zone], 12)
        }
      }
    }
    expect(plan(P, 0.95, { n: UP }).zone).toBe(Z_LIGHT)
    expect(plan(P, 0.25, { n: UP }).zone).toBe(Z_HALF)
    expect(plan(P, -0.1, { n: SIDE }).zone).toBe(Z_CORE)
    expect(plan(P, -0.6, { n: TABLE }).zone).toBe(Z_REFLECTED)
    expect(ZONES[plan(P, -0.6, { n: TABLE }).zone]).toBe('reflected')
    // beside the terminator the pixel is on the edge between two zones
    expect(plan(P, 0, { n: UP }).trans).toBeGreaterThan(0.4)
  })

  it('reports how much of the reflected range the form shadow has taken (the colour reads it), and none elsewhere', () => {
    expect(plan(P, -0.9, { n: TABLE }).lift).toBeGreaterThan(0.9)
    expect(plan(P, -0.1, { n: TABLE }).lift).toBe(0)
    expect(plan(P, 0.5, { n: TABLE }).lift).toBe(0)
    expect(plan(P, 0.6, { n: UP, cast: true }).lift).toBe(0)
  })

  it('applies the light response and the intensity to the light family only, and the value curve to the finished plan', () => {
    // a response squashing N·L to a half: the half-tone has barely begun at N·L = 1
    const dim = resolvePaintParams({ curves: { lightResponse: [[0, 0], [1, 0.5]] } })
    expect(plan(dim, 1).u).toBeCloseTo(plan(P, 0.5).u, 6)
    // the form shadow is not the light's: unchanged
    expect(plan(dim, -0.5, { n: TABLE }).u).toBeCloseTo(plan(P, -0.5, { n: TABLE }).u, 12)
    // the intensity scales N·L the same way
    expect(plan(resolvePaintParams({ light: { intensity: 0.5 } }), 1).u).toBeCloseTo(plan(P, 0.5).u, 12)
    // the value curve is applied last: a curve halving every value halves them all, and keeps the families in order
    const half = resolvePaintParams({ curves: { value: [[0, 0], [1, 0.5]] } })
    for (const nl of [-0.8, -0.1, 0.3, 1]) expect(plan(half, nl, { n: TABLE }).u).toBeCloseTo(0.5 * plan(P, nl, { n: TABLE }).u, 6)
  })

  it('computes the raw lit value as the contract says', () => {
    const up: [number, number, number] = [0, 0, 1]
    // facing the light: 1 + ambient + sky clamps to 1
    expect(rawLitValue(P, up, up, false)).toBe(1)
    // bare terminator facing up in the shade (shadowed table): 0.18 + 0.12 = 0.30
    expect(rawLitValue(P, up, up, true)).toBeCloseTo(0.3, 9)
    // facing down, away from the light: 0.18 + 0.10 bounce = 0.28
    expect(rawLitValue(P, [0, 0, -1], up, false)).toBeCloseTo(0.28, 9)
    // Lambert 0.5 (light 60 degrees off the normal): 0.5 + ambient 0.18 + sky 0.12 = 0.80
    const l: [number, number, number] = [Math.sin(Math.PI / 3), 0, 0.5]
    expect(rawLitValue(P, [0, 0, 1], l, false)).toBeCloseTo(0.8, 9)
  })

  it('reads lit canvas as a value that follows the canvas tone', () => {
    expect(canvasValue(P)).toBeCloseTo(0.7, 9)
    // a dark canvas (L 0.25) is a dark value: 0.70 + 0.8·(0.25 − 0.93)
    expect(canvasValue(resolvePaintParams({ canvas: { tone: [0.25, 0, 0] } }))).toBeCloseTo(0.156, 9)
  })

  it('weighs the bounce toward the table and away from the key', () => {
    // a normal along the bounce direction, unlit
    const b = bounceWeight(P, BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2], 0)
    expect(b).toBeCloseTo(0.85, 3)
    // facing up, the bounce is nothing
    expect(bounceWeight(P, 0, 0, 1, 0)).toBe(0)
    // a surface the key already lights gets no reflected light: smooth(0, 0.3, key) = 1 at 0.3
    expect(bounceWeight(P, BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2], 0.3)).toBeCloseTo(0, 9)
    // no bounce light, no reflected light
    expect(bounceWeight(resolvePaintParams({ light: { bounce: 0 } }), BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2], 0)).toBe(0)
  })

  it('takes the amount of reflected light from the bounce, the sky and the ambient, 0..1', () => {
    // the ambient alone (0.18 is its default): a quarter
    expect(bounceAmount(resolvePaintParams({ light: { bounce: 0, sky: 0 } }), 1, 0, 0)).toBeCloseTo(0.25, 12)
    // the sky lights an up-facing normal and not a down-facing one: 0.25 + 0.4
    expect(bounceAmount(resolvePaintParams({ light: { bounce: 0 } }), 0, 0, 1)).toBeCloseTo(0.65, 12)
    expect(bounceAmount(resolvePaintParams({ light: { bounce: 0 } }), 0, 0, -1)).toBeCloseTo(0.25, 12)
    // the table lights what faces it: capped at 1
    expect(bounceAmount(P, TABLE[0], TABLE[1], TABLE[2])).toBe(1)
    // nothing: 0
    expect(bounceAmount(resolvePaintParams({ light: { bounce: 0, sky: 0, ambient: 0 } }), TABLE[0], TABLE[1], TABLE[2])).toBe(0)
  })

  it('plans a sphere on a table: light, half-tone, core and reflected on the sphere, cast and canvas on the table', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view, table: { z: -1, mark: 1 } })
    const fc = makeFrameCtx(sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })]), view, g, P)
    const map = buildPlanMap(fc)
    const counts = new Map<string, number>()
    let emptyOk = true
    let lo = 1
    let hi = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) {
        emptyOk = emptyOk && map.zone[i] === 255 && map.value[i] === -1
        continue
      }
      const key = `${g.mark[i]}:${ZONES[map.zone[i]]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      lo = Math.min(lo, map.u[i])
      hi = Math.max(hi, map.u[i])
      // the debug value is the plan value
      expect(map.value[i]).toBe(map.u[i])
    }
    expect(emptyOk).toBe(true)
    // every plan value lies in the plan's range: the darkest contact up to the top of the light ramp
    expect(lo).toBeGreaterThanOrEqual(0.2 - 1e-6)
    expect(hi).toBeLessThanOrEqual(0.94 + 1e-6)
    // the sphere has the zones of a lit sphere
    for (const z of ['light', 'half', 'core']) expect(counts.get(`0:${z}`) ?? 0, z).toBeGreaterThan(50)
    // the table is canvas in the light and cast shadow where the sphere shades it
    expect(counts.get('1:cast') ?? 0).toBeGreaterThan(200)
    expect(counts.get('1:light') ?? 0).toBeGreaterThan(1000)
    // a lit table pixel reads as canvas; a cast pixel is between the contact value and the plateau (valueModel.test.ts: the occlusion)
    let canvasBad = 0
    let castBad = 0
    let sawCanvas = false
    let sawCast = false
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] === 1 && g.shadow[i] === 0) {
        if (Math.abs(map.u[i] - map.uCanvas) > 1e-6) canvasBad++
        sawCanvas = true
      }
      if (g.mark[i] === 1 && g.shadow[i] === 1) {
        if (map.u[i] > 0.32 + 1e-6 || map.u[i] < 0.2 - 1e-6 || map.zone[i] !== Z_CAST) castBad++
        sawCast = true
      }
    }
    expect(sawCanvas && sawCast).toBe(true)
    expect(canvasBad).toBe(0)
    expect(castBad).toBe(0)
    // and the brightest point of the sphere (facing the light) is in the light ramp
    let top = -1
    for (let i = 0; i < g.width * g.height; i++) if (g.mark[i] === 0 && (top < 0 || map.key[i] > map.key[top])) top = i
    expect(map.zone[top]).toBe(Z_LIGHT)
    expect(map.u[top]).toBeGreaterThan(0.85)
    expect(map.lightW[top]).toBeCloseTo(1, 6)
    expect(map.shadowW[top]).toBeCloseTo(0, 6)
  })

  it('puts the terminator where N·L = 0 on a sphere: the shadow family is the side turned from the key light', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view })
    const map = buildPlanMap(makeFrameCtx(sceneOf([sphereMesh()]), view, g, P))
    const ts = P.value.terminatorSoftness
    let lit = 0
    let shaded = 0
    let wrong = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      if (map.nl[i] >= ts / 2) {
        lit++
        // the light family: no pixel there is darker than the darkest half-tone
        if (map.u[i] < halfToneLowest(P) - 1e-6 || map.zone[i] === Z_CORE) wrong++
      } else if (map.nl[i] <= -ts / 2) {
        shaded++
        // the shadow family: nothing there reaches the half-tones
        if (map.u[i] > reflectedMax(P) + 1e-6 || map.zone[i] === Z_LIGHT || map.zone[i] === Z_HALF) wrong++
      }
    }
    expect(lit).toBeGreaterThan(1000)
    expect(shaded).toBeGreaterThan(300)
    expect(wrong).toBe(0)
  })

  it('gives scumble its test: the value gradient per CSS px, gentler across the wide turns than at the terminator', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view })
    const map = buildPlanMap(makeFrameCtx(sceneOf([sphereMesh()]), view, g, P))
    // beside the rim the gradient is flagged; inside the sphere the terminator is the steepest place, and the turn
    // to light (the widest) one of the gentlest
    let inside = 0
    let rim = 0
    let atTerminator = 0
    let atTurn = 0
    let nTerm = 0
    let nTurn = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      if (map.grad[i] === 999) {
        rim++
        continue
      }
      inside++
      if (Math.abs(map.nl[i]) < P.value.terminatorSoftness / 2) {
        atTerminator += map.grad[i]
        nTerm++
      } else if (Math.abs(map.nl[i] - P.value.lightTurn) < P.value.lightSoftness / 4) {
        atTurn += map.grad[i]
        nTurn++
      }
    }
    expect(inside).toBeGreaterThan(1000)
    expect(rim).toBeGreaterThan(20)
    expect(nTerm).toBeGreaterThan(10)
    expect(nTurn).toBeGreaterThan(50)
    expect(atTerminator / nTerm).toBeGreaterThan(2 * (atTurn / nTurn))
    // and the turn to light is gentle enough for scumble at the default threshold (0.004 per px) somewhere on it
    expect(atTurn / nTurn).toBeLessThan(0.01)
  })

  it('shares the light between key and environment: ambient terms over the value', () => {
    // an up-facing point of value 0.6: (0.18 + 0.12)/0.6 = 0.5
    expect(ambientShare(P, 1, 0.6)).toBeCloseTo(0.5, 9)
    // a down-facing one takes the bounce instead: (0.18 + 0.10)/0.4 = 0.7
    expect(ambientShare(P, -1, 0.4)).toBeCloseTo(0.7, 9)
    // all environment, never more than all
    expect(ambientShare(P, 1, 0.2)).toBe(1)
    expect(ambientShare(P, 1, 0)).toBe(0)
    // facing the horizon neither sky nor bounce: just the ambient, 0.18/0.9
    expect(ambientShare(P, 0, 0.9)).toBeCloseTo(0.2, 9)
  })
})
