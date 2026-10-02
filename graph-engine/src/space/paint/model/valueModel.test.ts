import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { compileCurves } from './respond'
import { makeGBuffer, paintView, planeGBuffer, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { buildPlanMap, modelValue, newZoneSample, rawLitValue, Z_LIGHT, zoneSample } from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const noAo = resolvePaintParams({ environment: { occlusion: 0 } })

// A view straight on (az 0, el 0): right is +y, up is +z, back is +x, so a
// view-space normal (a, b, c) is the world normal (c, a, b).
// (The key light is a fixed one, not the default, so that the creased test pixels stay below the clip at v = 1, where the
// occlusion would be partly lost.)
const FLAT_VIEW = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100, lightAzimuth: 35, lightElevation: 40 })
const SPHERE_SCENE = sceneOf([sphereMesh()])
const TABLE_SCENE = sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })])

describe('the model’s own value (spec §11)', () => {
  it('equals the renderer’s raw lit value bit for bit under the default curves, with occlusion off', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: noAo, table: { z: -1, mark: 1 } })
    const plan = buildPlanMap(makeFrameCtx(TABLE_SCENE, view, g, noAo))
    let checked = 0
    let differing = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) {
        expect(plan.value[i]).toBe(-1)
        continue
      }
      checked++
      // the renderer's formula on the very (Float32) normal the model reads, stored as Float32
      const n = [g.normal[3 * i], g.normal[3 * i + 1], g.normal[3 * i + 2]]
      if (plan.value[i] !== Math.fround(rawLitValue(noAo, n, view.lightDir, g.shadow[i] === 1))) differing++
    }
    expect(checked).toBeGreaterThan(5000)
    expect(differing).toBe(0)
    // and the formula itself, in doubles: the same expression as rawLitValue
    const curves = compileCurves(noAo)
    const len = Math.hypot(0.3, 0.4, 0.8660254037844386)
    const n = [0.3 / len, -0.4 / len, 0.8660254037844386 / len]
    const L = view.lightDir
    const nl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2]
    for (const shadow of [false, true]) {
      expect(modelValue(noAo, curves, nl, shadow, n[2], 0)).toBe(rawLitValue(noAo, n, L, shadow))
    }
  })

  it('applies the light response curve to N·L before intensity and shadow', () => {
    // a flat response of 0.5: every lit point gets 0.5 whatever its N·L; a shadowed one gets none of it
    const half = resolvePaintParams({ environment: { occlusion: 0 }, curves: { lightResponse: [[0, 0.5], [1, 0.5]] } })
    const curves = compileCurves(half)
    // up-facing: 0.5 + ambient 0.18 + sky 0.12 = 0.80, even at N·L = 0
    expect(modelValue(half, curves, 0, false, 1, 0)).toBeCloseTo(0.8, 12)
    expect(modelValue(half, curves, 0.9, false, 1, 0)).toBeCloseTo(0.8, 12)
    expect(modelValue(half, curves, 0.9, true, 1, 0)).toBeCloseTo(0.3, 12)
    // intensity scales the response: 1.2 x 0.5 + 0.30 = 0.90
    const bright = resolvePaintParams({ environment: { occlusion: 0 }, light: { intensity: 1.2 }, curves: { lightResponse: [[0, 0.5], [1, 0.5]] } })
    expect(modelValue(bright, compileCurves(bright), 0.5, false, 1, 0)).toBeCloseTo(0.6 + 0.3, 12)
    // a negative N·L reads as zero
    expect(modelValue(P, compileCurves(P), -0.7, false, 0, 0)).toBeCloseTo(0.18, 12)
    // a sloped response is read between its points: [0,0],[1,0.5] halves a Lambert of 0.8 to 0.4
    const slope = resolvePaintParams({ environment: { occlusion: 0 }, curves: { lightResponse: [[0, 0], [1, 0.5]] } })
    expect(modelValue(slope, compileCurves(slope), 0.8, false, 0, 0)).toBeCloseTo(0.4 + 0.18, 6)
  })

  it('applies the value curve last, so it shifts where the zones start', () => {
    // v = raw / 2: the core | half-tone boundary (v = 0.37) moves to raw 0.74
    const squash = resolvePaintParams({ environment: { occlusion: 0 }, curves: { value: [[0, 0], [1, 0.5]] } })
    const curves = compileCurves(squash)
    // raw 0.74 = 0.44 lit + 0.30 up-facing ambient: v = 0.37, half on half weight
    const v = modelValue(squash, curves, 0.44, false, 1, 0)
    expect(v).toBeCloseTo(0.37, 6)
    const s = zoneSample(squash, v, 0, false, newZoneSample())
    expect(s.w[1]).toBeCloseTo(0.5, 5)
    expect(s.w[2]).toBeCloseTo(0.5, 5)
    expect(s.u).toBeCloseTo(0.38, 5)
    // under the identity curve a raw value of 0.97 (0.67 lit + the ambient 0.30) is deep in the light
    const id = zoneSample(noAo, modelValue(noAo, compileCurves(noAo), 0.67, false, 1, 0), 0, false, newZoneSample())
    expect(id.zone).toBe(Z_LIGHT)
    // and over a whole sphere the lights vanish: v never reaches 0.5, and the light zone starts at 0.93
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: noAo })
    // (a plan map's arrays are scratch: read each before the next is built)
    const base = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, noAo))
    let rawMax = 0
    for (let i = 0; i < g.width * g.height; i++) if (g.mark[i] >= 0) rawMax = Math.max(rawMax, base.value[i])
    const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, squash))
    let light = 0
    let maxV = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      if (plan.zone[i] === Z_LIGHT) light++
      maxV = Math.max(maxV, plan.value[i])
    }
    expect(light).toBe(0)
    expect(maxV).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(maxV).toBeCloseTo(rawMax / 2, 5)
  })

  it('darkens a creased pixel by occlusion·ao, and leaves a tilted plane alone', () => {
    // a V-shaped valley down the middle of the screen: depth = 20 - |X| (X in world units, 100 px each)
    const valley = (params: PaintParams) => {
      const g = makeGBuffer(FLAT_VIEW, 2, (x, y) => {
        if (x < 40 || x >= 360 || y < 40 || y >= 260) return null
        const X = (x - 200) / 100
        const nv = X >= 0 ? [-0.7071, 0, 0.7071] : [0.7071, 0, 0.7071]
        return { depth: 20 - Math.abs(X), normal: [nv[2], nv[0], nv[1]], value: 0.5, mark: 0 }
      })
      const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, FLAT_VIEW, g, params))
      // copies: the next call reuses the arrays
      return { ao: Float32Array.from(plan.ao), value: Float32Array.from(plan.value) }
    }
    const withAo = valley(resolvePaintParams({ environment: { occlusion: 0.35, occlusionRadiusPx: 14 } }))
    const without = valley(noAo)
    const at = (gx: number, gy = 75) => gy * 200 + gx
    // right at the crease (x = 200 CSS px, G pixel 100) the valley walls close in: heavily occluded
    expect(withAo.ao[at(100)]).toBeGreaterThan(0.2)
    expect(withAo.ao[at(99)]).toBeGreaterThan(0.2)
    // 20 G px (40 CSS px) from the crease every sample is on the same wall: nothing
    expect(withAo.ao[at(60)]).toBe(0)
    expect(withAo.ao[at(140)]).toBe(0)
    // the value drops by occlusion · ao (identity curves); occlusion 0 changes nothing
    const d = without.value[at(100)] - withAo.value[at(100)]
    expect(d).toBeCloseTo(0.35 * withAo.ao[at(100)], 5)
    expect(d).toBeGreaterThan(0.07)
    expect(without.value[at(60)]).toBe(withAo.value[at(60)])
    expect(Math.max(...without.ao)).toBe(0)
    // a plane tilted 40 degrees has no occlusion anywhere: its extension is its own surface
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
    const tilt: [number, number, number] = [Math.sin(0.7), 0, Math.cos(0.7)]
    const g = planeGBuffer(400, 300, { view, normal: tilt, point: [0, 0, 0], extent: 1.2 })
    const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, resolvePaintParams({ environment: { occlusion: 0.5 } })))
    let filled = 0
    let maxAo = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      filled++
      maxAo = Math.max(maxAo, plan.ao[i])
    }
    expect(filled).toBeGreaterThan(5000)
    expect(maxAo).toBeLessThan(1e-3)
  })

  it('lets only a near occluder darken: a step far in front of a surface is a different object, not a crease', () => {
    // a wall at depth 20 with a second wall on its right half, `step` units nearer (both facing the camera);
    // occlusion radius 14 CSS px = 0.14 world units at 100 px per unit, so the range ends at 2 x 0.14 = 0.28
    const stepped = (step: number) => {
      const g = makeGBuffer(FLAT_VIEW, 2, (x, y) => {
        if (x < 40 || x >= 360 || y < 40 || y >= 260) return null
        return { depth: x < 200 ? 20 : 20 - step, normal: [1, 0, 0], value: 0.5, mark: 0 }
      })
      const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, FLAT_VIEW, g, resolvePaintParams({ environment: { occlusion: 0.35, occlusionRadiusPx: 14 } })))
      return Float32Array.from(plan.ao)
    }
    const at = (gx: number, gy = 75) => gy * 200 + gx
    // a step of 0.1 (inside the range, past the 0.35 x 0.14 = 0.049 full-effect depth): the pixel beside it is occluded
    const near = stepped(0.1)
    expect(near[at(99)]).toBeGreaterThan(0.2)
    // a step of 10 is nothing like a crease: the wall beside it is not darkened at all, not even by one sample
    const far = stepped(10)
    for (let gx = 40; gx < 100; gx++) expect(far[at(gx)]).toBe(0)
    // and a surface in front is never darkened by what lies behind it
    for (let gx = 100; gx < 160; gx++) expect(near[at(gx)]).toBe(0)
  })

  it('occludes the table near a sphere that stands on it, and not far from it', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 70 })
    const g = sphereGBuffer(400, 300, { view, params: noAo, table: { z: -1, mark: 1 } })
    const plan = buildPlanMap(makeFrameCtx(TABLE_SCENE, view, g, resolvePaintParams({ environment: { occlusion: 0.35 } })))
    let nearMax = 0
    let farMax = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] !== 1) continue
      // distance on screen to the sphere's rim, in CSS px (the sphere sits at the screen centre, radius 70)
      const x = ((i % g.width) + 0.5) * g.scale
      const y = (Math.floor(i / g.width) + 0.5) * g.scale
      const dist = Math.hypot(x - 200, y - 150) - 70
      if (dist < 10) nearMax = Math.max(nearMax, plan.ao[i])
      if (dist > 60) farMax = Math.max(farMax, plan.ao[i])
    }
    expect(nearMax).toBeGreaterThan(0.05)
    expect(farMax).toBe(0)
  })

  it('is deterministic: the seeded kernel gives the same occlusion every time, another seed another kernel', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 70 })
    const g = sphereGBuffer(400, 300, { view, params: noAo, table: { z: -1, mark: 1 } })
    const run = (params: PaintParams) => Array.from(buildPlanMap(makeFrameCtx(TABLE_SCENE, view, g, params)).ao)
    const a = run(resolvePaintParams({ environment: { occlusion: 0.35 } }))
    expect(run(resolvePaintParams({ environment: { occlusion: 0.35 } }))).toEqual(a)
    expect(run(resolvePaintParams({ environment: { occlusion: 0.35 }, seed: 9 }))).not.toEqual(a)
  })
})
