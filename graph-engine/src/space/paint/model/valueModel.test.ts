import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { compileCurves } from './respond'
import { makeGBuffer, paintView, planeGBuffer, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { buildPlanMap, newZoneSample, planSample, reflectedMax, Z_CAST } from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const noAo = resolvePaintParams({ environment: { occlusion: 0 } })

// A view straight on (az 0, el 0): right is +y, up is +z, back is +x, so a
// view-space normal (a, b, c) is the world normal (c, a, b).
const FLAT_VIEW = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100, lightAzimuth: 35, lightElevation: 40 })
const SPHERE_SCENE = sceneOf([sphereMesh()])
const TABLE_SCENE = sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })])

describe('the model’s own value (spec §11, §12)', () => {
  it('is the plan, not the renderer’s raw lit value: the shadow side does not follow the fill light', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: noAo, table: { z: -1, mark: 1 } })
    const plan = buildPlanMap(makeFrameCtx(TABLE_SCENE, view, g, noAo))
    const curves = compileCurves(noAo)
    let checked = 0
    let shadowSide = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) {
        expect(plan.value[i]).toBe(-1)
        continue
      }
      checked++
      // the plan value is planSample's at this pixel's own normal, on the very (Float32) numbers the model reads
      const n = [g.normal[3 * i], g.normal[3 * i + 1], g.normal[3 * i + 2]]
      const L = view.lightDir
      const nl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2]
      const isGround = g.mark[i] === 1 && g.shadow[i] === 0
      if (!isGround) {
        const s = planSample(noAo, curves, nl, g.shadow[i] === 1, n[0], n[1], n[2], 0, newZoneSample())
        expect(plan.value[i]).toBe(Math.fround(s.u))
      }
      // the renderer's raw value on the form shadow side is the fill light alone (ambient, sky, bounce): the plan
      // keeps those pixels in the shadow family, whatever the fill is
      if (g.mark[i] === 0 && nl < -P.value.terminatorSoftness) {
        shadowSide++
        expect(plan.value[i]).toBeLessThanOrEqual(reflectedMax(noAo) + 1e-6)
      }
    }
    expect(checked).toBeGreaterThan(5000)
    expect(shadowSide).toBeGreaterThan(300)
    // and with every light slider at its maximum the shadow side is still under the half-tones
    const flood = resolvePaintParams({ environment: { occlusion: 0 }, light: { ambient: 1, sky: 1, bounce: 1 } })
    const g2 = sphereGBuffer(400, 300, { view, params: flood })
    const map2 = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g2, flood))
    let seen = 0
    for (let i = 0; i < g2.width * g2.height; i++) {
      if (g2.mark[i] < 0 || map2.nl[i] > -P.value.terminatorSoftness / 2) continue
      seen++
      expect(map2.value[i]).toBeLessThanOrEqual(reflectedMax(flood) + 1e-6)
    }
    expect(seen).toBeGreaterThan(300)
  })

  it('applies the light response curve to the lit side: a response of zero leaves it at the darkest half-tone, and the shadow alone', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: noAo })
    // (a plan map's arrays are scratch: read each before the next is built)
    const base = Float32Array.from(buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, noAo)).value)
    const none = resolvePaintParams({ environment: { occlusion: 0 }, curves: { lightResponse: [[0, 0], [1, 0]] } })
    const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, none))
    let lit = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      if (plan.nl[i] > 0.1) {
        lit++
        expect(plan.value[i]).toBeCloseTo(none.value.halfLo, 5)
      } else if (plan.nl[i] < -0.1) {
        expect(plan.value[i]).toBe(base[i])
      }
    }
    expect(lit).toBeGreaterThan(1000)
  })

  it('applies the value curve last, to the finished plan: halved, every value is halved, and no pixel reaches a light', () => {
    const squash = resolvePaintParams({ environment: { occlusion: 0 }, curves: { value: [[0, 0], [1, 0.5]] } })
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: noAo })
    const base = Float32Array.from(buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, noAo)).value)
    const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, g, squash))
    let maxV = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) continue
      expect(plan.value[i]).toBeCloseTo(base[i] / 2, 5)
      maxV = Math.max(maxV, plan.value[i])
    }
    expect(maxV).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(maxV).toBeGreaterThan(0.4)
  })

  it('takes a cast shadow to its contact value at a crease, and leaves a crease the key light reaches lit', () => {
    // a V-shaped valley down the middle of the screen: depth = 20 - |X| (X in world units, 100 px each), every
    // normal facing the key light (so every pixel has N·L > 0); `cast` flags them occluded by the key light
    const valley = (params: PaintParams, cast: boolean) => {
      const g = makeGBuffer(FLAT_VIEW, 2, (x, y) => {
        if (x < 40 || x >= 360 || y < 40 || y >= 260) return null
        const X = (x - 200) / 100
        const nv = X >= 0 ? [-0.7071, 0, 0.7071] : [0.7071, 0, 0.7071]
        return { depth: 20 - Math.abs(X), normal: [nv[2], nv[0], nv[1]], value: 0.5, mark: 0, shadow: cast }
      })
      const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, FLAT_VIEW, g, params))
      // copies: the next call reuses the arrays
      return { u: Float32Array.from(plan.value), nl: Float32Array.from(plan.nl), ao: Float32Array.from(plan.ao), zone: Uint8Array.from(plan.zone) }
    }
    const at = (gx: number, gy = 75) => gy * 200 + gx
    const withAo = resolvePaintParams({ environment: { occlusion: 0.35, occlusionRadiusPx: 14 } })
    const cast = valley(withAo, true)
    // a facing normal, in the key light's occlusion: the cast shadow
    expect(cast.nl[at(100)]).toBeGreaterThan(0.3)
    expect(cast.zone[at(100)]).toBe(Z_CAST)
    expect(cast.zone[at(60)]).toBe(Z_CAST)
    // at the crease: the contact value; 40 CSS px from it every sample is on the same wall: the plateau
    expect(cast.ao[at(100)]).toBeGreaterThan(0.2)
    expect(cast.u[at(100)]).toBeCloseTo(withAo.value.castContact, 4)
    expect(cast.ao[at(60)]).toBe(0)
    expect(cast.u[at(60)]).toBeCloseTo(withAo.value.castPlateau, 5)
    expect(cast.u[at(140)]).toBeCloseTo(withAo.value.castPlateau, 5)
    // darkest at the contact and lighter the farther from it, never lighter than the plateau
    let prev = 0
    for (let gx = 100; gx >= 60; gx--) {
      expect(cast.u[at(gx)]).toBeGreaterThanOrEqual(prev - 1e-6)
      expect(cast.u[at(gx)]).toBeLessThanOrEqual(withAo.value.castPlateau + 1e-6)
      prev = cast.u[at(gx)]
    }
    // the occlusion slider off: no contact darkening
    const flat = valley(noAo, true)
    expect(Math.max(...flat.ao)).toBe(0)
    expect(flat.u[at(100)]).toBeCloseTo(noAo.value.castPlateau, 5)
    // and the same valley, lit (no cast): the light family is not darkened by the occlusion
    const lit = valley(withAo, false)
    expect(lit.u[at(100)]).toBeCloseTo(valley(noAo, false).u[at(100)], 6)
    expect(lit.u[at(100)]).toBeGreaterThan(noAo.value.halfLo)
  })

  it('computes occlusion from the depth: a creased pixel is occluded, a tilted plane is not', () => {
    // the same V-shaped valley, with the occlusion measured: at the crease the valley walls close in
    const g = makeGBuffer(FLAT_VIEW, 2, (x, y) => {
      if (x < 40 || x >= 360 || y < 40 || y >= 260) return null
      const X = (x - 200) / 100
      const nv = X >= 0 ? [-0.7071, 0, 0.7071] : [0.7071, 0, 0.7071]
      return { depth: 20 - Math.abs(X), normal: [nv[2], nv[0], nv[1]], value: 0.5, mark: 0 }
    })
    const ao = Float32Array.from(buildPlanMap(makeFrameCtx(SPHERE_SCENE, FLAT_VIEW, g, resolvePaintParams({ environment: { occlusion: 0.35, occlusionRadiusPx: 14 } }))).ao)
    const at = (gx: number, gy = 75) => gy * 200 + gx
    // right at the crease (x = 200 CSS px, G pixel 100) the valley walls close in: heavily occluded
    expect(ao[at(100)]).toBeGreaterThan(0.2)
    expect(ao[at(99)]).toBeGreaterThan(0.2)
    // 20 G px (40 CSS px) from the crease every sample is on the same wall: nothing
    expect(ao[at(60)]).toBe(0)
    expect(ao[at(140)]).toBe(0)
    // a plane tilted 40 degrees has no occlusion anywhere: its extension is its own surface
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
    const tilt: [number, number, number] = [Math.sin(0.7), 0, Math.cos(0.7)]
    const gp = planeGBuffer(400, 300, { view, normal: tilt, point: [0, 0, 0], extent: 1.2 })
    const plan = buildPlanMap(makeFrameCtx(SPHERE_SCENE, view, gp, resolvePaintParams({ environment: { occlusion: 0.5 } })))
    let filled = 0
    let maxAo = 0
    for (let i = 0; i < gp.width * gp.height; i++) {
      if (gp.mark[i] < 0) continue
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
