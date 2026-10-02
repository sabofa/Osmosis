import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { ZONES } from '../types'
import { paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import {
  ambientShare,
  bounceWeight,
  BOUNCE_DIR,
  buildPlanMap,
  canvasValue,
  newZoneSample,
  rawLitValue,
  terminatorValue,
  Z_CAST,
  Z_CORE,
  Z_HALF,
  Z_LIGHT,
  Z_REFLECTED,
  zoneSample,
} from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const sample = (raw: number, b = 0, cast = false, params = P) => zoneSample(params, raw, b, cast, newZoneSample())

describe('value plan', () => {
  // Defaults: soft 0.07, half-tone 0.52..0.72, light 0.85..0.94, core 0.24, reflected 0.34..0.48, cast 0.32.
  // The core | half-tone boundary is centred at halfLo − soft/2 = 0.485 and spans 0.45..0.52.
  // The half-tone | light boundary is centred at (halfHi + lightLo)/2 = 0.785 and spans 0.75..0.82.
  it('holds a plateau in the core: 0.24 across the whole shadow side', () => {
    for (const raw of [0.18, 0.25, 0.4, 0.449]) {
      const s = sample(raw)
      expect(s.u).toBeCloseTo(0.24, 9)
      expect(s.zone).toBe(Z_CORE)
      expect(ZONES[s.zone]).toBe('core')
    }
  })

  it('ramps the half-tone from 0.52 to 0.72 over raw u 0.52..0.72', () => {
    expect(sample(0.52).u).toBeCloseTo(0.52, 9)
    // raw 0.60: 0.52 + 0.20·(0.08/0.20) = 0.60
    expect(sample(0.6).u).toBeCloseTo(0.6, 9)
    expect(sample(0.6).zone).toBe(Z_HALF)
    expect(sample(0.72).u).toBeCloseTo(0.72, 9)
    expect(sample(0.74).u).toBeCloseTo(0.72, 9) // clamped at the top of the ramp, still half
    expect(sample(0.74).zone).toBe(Z_HALF)
  })

  it('ramps the light from 0.85 to 0.94 over raw u 0.85..1', () => {
    expect(sample(0.85).u).toBeCloseTo(0.85, 9)
    // raw 0.95: 0.85 + 0.09·(0.10/0.15) = 0.91
    expect(sample(0.95).u).toBeCloseTo(0.91, 9)
    expect(sample(1).u).toBeCloseTo(0.94, 9)
    expect(sample(0.95).zone).toBe(Z_LIGHT)
  })

  it('steps between zones across a soft boundary of width value.soft', () => {
    // core | half: at 0.485 the two weigh half each: 0.5·0.52 + 0.5·0.24 = 0.38
    const mid = sample(0.485)
    expect(mid.w[1]).toBeCloseTo(0.5, 9)
    expect(mid.w[2]).toBeCloseTo(0.5, 9)
    expect(mid.u).toBeCloseTo(0.38, 9)
    expect(mid.trans).toBeCloseTo(0.5, 9)
    // the boundary is exactly 0.07 wide: fully core at 0.45, fully half at 0.52
    expect(sample(0.45).w[2]).toBeCloseTo(1, 9)
    expect(sample(0.52).w[1]).toBeCloseTo(1, 9)
    expect(sample(0.5).w[1]).toBeGreaterThan(0.5)
    expect(sample(0.47).w[1]).toBeLessThan(0.5)
    // half | light: at 0.785 each weighs half, between the half-tone's top (0.72) and the light's bottom (0.85)
    const hl = sample(0.785)
    expect(hl.w[0]).toBeCloseTo(0.5, 9)
    expect(hl.w[1]).toBeCloseTo(0.5, 9)
    expect(hl.u).toBeCloseTo(0.5 * 0.85 + 0.5 * 0.72, 9)
    expect(sample(0.75).w[1]).toBeCloseTo(1, 9)
    expect(sample(0.82).w[0]).toBeCloseTo(1, 9)
    // a wider soft widens the boundary: 0.14 puts 0.45 at only a quarter-ish through
    const wide = resolvePaintParams({ value: { soft: 0.14 } })
    expect(sample(0.45, 0, false, wide).w[1]).toBeGreaterThan(0.1)
    expect(sample(0.45).w[1]).toBeCloseTo(0, 9)
  })

  it('weights always sum to one', () => {
    for (let raw = 0; raw <= 1; raw += 0.01) {
      for (const b of [0, 0.15, 0.6]) {
        const w = sample(raw, b).w
        expect(w[0] + w[1] + w[2] + w[3] + w[4]).toBeCloseTo(1, 9)
      }
    }
  })

  it('puts reflected light in the shadow side: 0.34..0.48 by the bounce weight', () => {
    // a strong bounce (b = 0.5) is wholly reflected light at 0.48
    const strong = sample(0.2, 0.5)
    expect(strong.zone).toBe(Z_REFLECTED)
    expect(strong.u).toBeCloseTo(0.48, 9)
    // b = 0.15 is half-way up the reflected smoothstep: 0.5·0.24 + 0.5·(0.34 + 0.14·0.3) = 0.311
    const mid = sample(0.2, 0.15)
    expect(mid.w[3]).toBeCloseTo(0.5, 9)
    expect(mid.u).toBeCloseTo(0.5 * 0.24 + 0.5 * 0.382, 9)
    // b = 0.1 is the bottom of the smoothstep: still the core plateau
    expect(sample(0.2, 0.1).u).toBeCloseTo(0.24, 9)
    // reflected light only lives on the shadow side: a lit surface ignores the bounce
    expect(sample(0.95, 0.6).w[3]).toBeCloseTo(0, 9)
  })

  it('holds a plateau for the cast shadow: 0.32', () => {
    const s = sample(0.3, 0, true)
    expect(s.zone).toBe(Z_CAST)
    expect(s.u).toBeCloseTo(0.32, 9)
    expect(s.w[4]).toBe(1)
    // the plateaus are sliders
    const moved = resolvePaintParams({ value: { corePlateau: 0.1, castPlateau: 0.2 } })
    expect(sample(0.2, 0, false, moved).u).toBeCloseTo(0.1, 9)
    expect(sample(0.2, 0, true, moved).u).toBeCloseTo(0.2, 9)
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
    expect(b).toBeCloseTo(0.85, 9)
    // facing up, the bounce is nothing
    expect(bounceWeight(P, 0, 0, 1, 0)).toBe(0)
    // a surface the key already lights gets no reflected light: smooth(0, 0.3, key) = 1 at 0.3
    expect(bounceWeight(P, BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2], 0.3)).toBeCloseTo(0, 9)
    // no bounce light, no reflected light
    expect(bounceWeight(resolvePaintParams({ light: { bounce: 0 } }), BOUNCE_DIR[0], BOUNCE_DIR[1], BOUNCE_DIR[2], 0)).toBe(0)
  })

  it('plans a sphere on a table: light, half-tone, core and reflected on the sphere, cast and canvas on the table', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view, table: { z: -1, mark: 1 } })
    const fc = makeFrameCtx(sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })]), view, g, P)
    const plan = buildPlanMap(fc)
    const counts = new Map<string, number>()
    let emptyOk = true
    let lo = 1
    let hi = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) {
        emptyOk = emptyOk && plan.zone[i] === 255
        continue
      }
      const key = `${g.mark[i]}:${ZONES[plan.zone[i]]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      lo = Math.min(lo, plan.u[i])
      hi = Math.max(hi, plan.u[i])
    }
    expect(emptyOk).toBe(true)
    // every plan value lies in the plan's range: the core plateau up to the top of the light ramp
    expect(lo).toBeGreaterThanOrEqual(0.24 - 1e-6)
    expect(hi).toBeLessThanOrEqual(0.94 + 1e-6)
    // the sphere has the four zones of a lit sphere
    for (const z of ['light', 'half', 'core']) expect(counts.get(`0:${z}`) ?? 0, z).toBeGreaterThan(50)
    // the table is canvas in the light and cast shadow where the sphere shades it
    expect(counts.get('1:cast') ?? 0).toBeGreaterThan(200)
    expect(counts.get('1:light') ?? 0).toBeGreaterThan(1000)
    // a lit table pixel reads as canvas
    let canvasBad = 0
    let castBad = 0
    let sawCanvas = false
    let sawCast = false
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] === 1 && g.shadow[i] === 0) {
        if (Math.abs(plan.u[i] - plan.uCanvas) > 1e-6) canvasBad++
        sawCanvas = true
      }
      if (g.mark[i] === 1 && g.shadow[i] === 1) {
        if (Math.abs(plan.u[i] - 0.32) > 1e-6 || plan.zone[i] !== Z_CAST) castBad++
        sawCast = true
      }
    }
    expect(sawCanvas && sawCast).toBe(true)
    expect(canvasBad).toBe(0)
    expect(castBad).toBe(0)
    // and the brightest point of the sphere (facing the light) is in the light ramp
    let top = -1
    for (let i = 0; i < g.width * g.height; i++) if (g.mark[i] === 0 && (top < 0 || g.value[i] > g.value[top])) top = i
    expect(plan.zone[top]).toBe(Z_LIGHT)
    expect(plan.u[top]).toBeGreaterThan(0.85)
    expect(plan.lightW[top]).toBeCloseTo(1, 6)
    expect(plan.shadowW[top]).toBeCloseTo(0, 6)
  })

  it('gives scumble its test: the value gradient per CSS px, small across a wide transition', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 })
    const g = sphereGBuffer(400, 300, { view })
    const plan = buildPlanMap(makeFrameCtx(sceneOf([sphereMesh()]), view, g, P))
    // inside the sphere the raw value changes by under 0.03 per CSS px; beside the rim the gradient is flagged
    let inside = 0
    let rim = 0
    let steep = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      if (plan.grad[i] === 999) rim++
      else {
        inside++
        if (plan.grad[i] >= 0.05) steep++
      }
    }
    expect(steep).toBe(0)
    expect(inside).toBeGreaterThan(1000)
    expect(rim).toBeGreaterThan(20)
  })

  it('puts the terminator at the centre of the core | half-tone boundary: halfLo - soft/2', () => {
    expect(terminatorValue(P)).toBeCloseTo(0.485, 9)
    expect(terminatorValue(resolvePaintParams({ value: { halfLo: 0.6, soft: 0.1 } }))).toBeCloseTo(0.55, 9)
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
