import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import type { SpaceScene } from '../../scene/types'
import { buildParticles } from './particles'
import { flatColours, paintView, quadMesh, sceneOf, sphereGBuffer, sphereMesh, tableMesh, type ViewOpts } from './testing'
import { drawChance, drawnEntries, gIndex, groundMarks, makeFrameCtx, pxPerUnit, project, roleRank, slideToDepth, toEye, unproject, visibleParticles } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({})

function frame(scene: SpaceScene, opts: ViewOpts, params: PaintParams = P, gOpts: { table?: { z: number; mark: number } } = {}) {
  const view = paintView(opts)
  const g = sphereGBuffer(view.width, view.height, { view, params, ...gOpts })
  return { view, g, fc: makeFrameCtx(scene, view, g, params) }
}

describe('paint view', () => {
  const sphereScene = sceneOf([sphereMesh({ radius: 1 })])
  const set = buildParticles(sphereScene, COLOURS, P)

  it('projects with the contract matrices: the target to the centre, a unit right-step to `zoom` px', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
    const g = sphereGBuffer(400, 300, { view })
    const fc = makeFrameCtx(sceneOf([]), view, g, P)
    const out = [0, 0, 0]
    expect(project(fc, 0, 0, 0, out)).toBe(true)
    expect(out[0]).toBeCloseTo(200, 3)
    expect(out[1]).toBeCloseTo(150, 3)
    expect(out[2]).toBeCloseTo(20, 4) // the eye stands 20 units back
    // screen right at azimuth 30° is (-sin 30°, cos 30°, 0)
    project(fc, -0.5, Math.cos(Math.PI / 6), 0, out)
    expect(out[0]).toBeCloseTo(300, 3)
    expect(out[1]).toBeCloseTo(150, 3)
    expect(pxPerUnit(fc, 0, 0, 0)).toBeCloseTo(100, 3)
    // a perspective camera built to the same scale at the target agrees there, and nearer is bigger
    const pv = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100, perspective: true })
    const pfc = makeFrameCtx(sceneOf([]), pv, sphereGBuffer(400, 300, { view: pv }), P)
    expect(pfc.ortho).toBe(false)
    expect(fc.ortho).toBe(true)
    expect(pxPerUnit(pfc, 0, 0, 0)).toBeCloseTo(100, 2)
    const toward = pv.eye.map((e) => e * 0.1) as [number, number, number]
    expect(pxPerUnit(pfc, toward[0], toward[1], toward[2])).toBeGreaterThan(pxPerUnit(pfc, 0, 0, 0))
  })

  it('unprojects a pixel and a depth back to the world point, ortho and perspective', () => {
    for (const perspective of [false, true]) {
      const view = paintView({ width: 400, height: 300, azimuth: 70, elevation: 35, zoom: 90, perspective })
      const fc = makeFrameCtx(sceneOf([]), view, sphereGBuffer(400, 300, { view }), P)
      const out = [0, 0, 0]
      const q = [0, 0, 0]
      for (const p of [[0.3, -0.4, 0.7], [-1, 0.5, -0.2]]) {
        project(fc, p[0], p[1], p[2], out)
        unproject(fc, out[0], out[1], out[2], q)
        expect(q[0]).toBeCloseTo(p[0], 4)
        expect(q[1]).toBeCloseTo(p[1], 4)
        expect(q[2]).toBeCloseTo(p[2], 4)
        // sliding along the view ray lands on the same pixel at the new depth
        const moved = [p[0], p[1], p[2]]
        slideToDepth(fc, moved, out[2], out[2] + 0.5)
        const o2 = [0, 0, 0]
        project(fc, moved[0], moved[1], moved[2], o2)
        expect(o2[0]).toBeCloseTo(out[0], 3)
        expect(o2[1]).toBeCloseTo(out[1], 3)
        expect(o2[2]).toBeCloseTo(out[2] + 0.5, 3)
      }
    }
  })

  it('points the eye vector along -viewDir when orthographic, at the eye when perspective', () => {
    const v = [0, 0, 0]
    const ortho = paintView({ azimuth: 10, elevation: 20 })
    toEye(makeFrameCtx(sceneOf([]), ortho, sphereGBuffer(400, 300, { view: ortho }), P), 3, 1, 2, v)
    expect(v[0]).toBeCloseTo(-ortho.viewDir[0], 9)
    expect(v[2]).toBeCloseTo(-ortho.viewDir[2], 9)
    const persp = paintView({ azimuth: 10, elevation: 20, perspective: true })
    toEye(makeFrameCtx(sceneOf([]), persp, sphereGBuffer(400, 300, { view: persp }), P), 3, 1, 2, v)
    const d = [persp.eye[0] - 3, persp.eye[1] - 1, persp.eye[2] - 2]
    const l = Math.hypot(d[0], d[1], d[2])
    expect(v[0]).toBeCloseTo(d[0] / l, 9)
    expect(v[1]).toBeCloseTo(d[1] / l, 9)
  })

  it('finds the G-buffer pixel of a CSS position, and none outside', () => {
    const { fc } = frame(sphereScene, { width: 400, height: 300 })
    expect(gIndex(fc, 0, 0)).toBe(0)
    expect(gIndex(fc, 1.9, 1.9)).toBe(0)
    expect(gIndex(fc, 2, 0)).toBe(1)
    expect(gIndex(fc, 399, 299)).toBe(199 + 149 * 200)
    expect(gIndex(fc, -1, 5)).toBe(-1)
    expect(gIndex(fc, 400, 5)).toBe(-1)
  })

  it('treats a flat, horizontal, opaque mesh as bare table', () => {
    const scene = sceneOf([sphereMesh(), tableMesh({ z: -1 }), quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], opacity: 0.4 }), quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 0, 1] })])
    expect(Array.from(groundMarks(scene))).toEqual([0, 1, 0, 0])
  })

  it('selects only what the G-buffer shows: the near hemisphere of a sphere, and no table under it', () => {
    const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
    const both = buildParticles(scene, COLOURS, P)
    const { fc } = frame(scene, { width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 80 }, P, { table: { z: -1, mark: 1 } })
    const vis = visibleParticles(fc, both)
    expect(vis.count).toBeGreaterThan(500)
    const v = fc.view.viewDir
    let sphereCount = 0
    let tableCount = 0
    let hiddenPicked = 0
    for (let k = 0; k < vis.count; k++) {
      const i = vis.idx[k]
      const x = both.position[3 * i]
      const y = both.position[3 * i + 1]
      const z = both.position[3 * i + 2]
      if (both.mark[i] === 0) {
        sphereCount++
        // the near hemisphere only (a particle a hair behind the limb can pass, but never past 0.2 behind)
        if (x * -v[0] + y * -v[1] + z * -v[2] < -0.2) hiddenPicked++
      } else {
        tableCount++
        // a table particle behind the sphere on screen is hidden by it
        const o = [0, 0, 0]
        project(fc, x, y, z, o)
        const c = [0, 0, 0]
        project(fc, 0, 0, 0, c)
        if (Math.hypot(o[0] - c[0], o[1] - c[1]) < 0.9 * 80) hiddenPicked++
      }
      expect(vis.facing[k]).toBeGreaterThan(0)
    }
    expect(hiddenPicked).toBe(0)
    expect(sphereCount).toBeGreaterThan(300)
    expect(tableCount).toBeGreaterThan(300)
  })

  it('holds the screen density at the target: 90 strokes per 10,000 px� at two zooms', () => {
    // one view draws a random handful (a Poisson count); the mean over six views shows the rule
    for (const zoom of [60, 120]) {
      let sum = 0
      const azimuths = [0, 30, 60, 90, 120, 150]
      for (const azimuth of azimuths) {
        const { fc, g } = frame(sphereScene, { width: 400, height: 300, azimuth, elevation: 25, zoom })
        const drawn = drawnEntries(fc, visibleParticles(fc, set), set, 'block').length
        // the area the sphere covers on screen, from the G-buffer
        let covered = 0
        for (let i = 0; i < g.width * g.height; i++) if (g.mark[i] >= 0) covered += g.scale * g.scale
        sum += (drawn / covered) * 10000
      }
      const per10k = sum / azimuths.length
      expect(per10k, `zoom ${zoom}`).toBeGreaterThan(90 * 0.85)
      expect(per10k, `zoom ${zoom}`).toBeLessThan(90 * 1.15)
    }
  })

  it('follows the density sliders: target, role density, and the drag density', () => {
    const opts = { width: 800, height: 600, zoom: 150 }
    const base = frame(sphereScene, opts)
    const n = drawnEntries(base.fc, visibleParticles(base.fc, set), set, 'block').length
    expect(n).toBeGreaterThan(500)
    const count = (params: PaintParams, dragging = false) => {
      const view = paintView({ ...opts, dragging })
      const g = sphereGBuffer(800, 600, { view, params })
      const fc = makeFrameCtx(sphereScene, view, g, params)
      return drawnEntries(fc, visibleParticles(fc, set), set, 'block').length
    }
    const ratio = (x: number) => x / n
    expect(ratio(count(resolvePaintParams({ particles: { targetPer10kPx: 180 } })))).toBeGreaterThan(1.85)
    expect(ratio(count(resolvePaintParams({ particles: { targetPer10kPx: 180 } })))).toBeLessThan(2.05)
    expect(ratio(count(resolvePaintParams({ roles: { block: { density: 0.5 } } })))).toBeGreaterThan(0.44)
    expect(ratio(count(resolvePaintParams({ roles: { block: { density: 0.5 } } })))).toBeLessThan(0.56)
    // dragging drops to dragDensity
    const drag = resolvePaintParams({ particles: { dragDensity: 0.5 } })
    expect(ratio(count(drag, true))).toBeGreaterThan(0.44)
    expect(ratio(count(drag, true))).toBeLessThan(0.56)
    expect(ratio(count(drag, false))).toBeCloseTo(1, 9)
    // the chance is clamped to a probability
    expect(drawChance(base.fc, 1e9, 'block')).toBe(1)
    expect(drawChance(base.fc, 0, 'block')).toBe(0)
  })

  it('keeps at least 80% of the strokes between views 12� apart', () => {
    const select = (azimuth: number, elevation = 25) => {
      const { fc } = frame(sphereScene, { width: 800, height: 600, azimuth, elevation, zoom: 150 })
      const vis = visibleParticles(fc, set)
      return new Set(drawnEntries(fc, vis, set, 'block').map((k) => vis.idx[k]))
    }
    for (const az of [0, 30, 100, 200]) {
      const a = select(az)
      expect(a.size).toBeGreaterThan(500)
      for (const b of [select(az + 12), select(az, 37)]) {
        let kept = 0
        for (const i of a) if (b.has(i)) kept++
        expect(kept / a.size).toBeGreaterThanOrEqual(0.8)
      }
    }
    // rotating away and back gives the identical selection
    const a = select(30)
    const back = select(30)
    expect([...back].sort((x, y) => x - y)).toEqual([...a].sort((x, y) => x - y))
  })

  it('reads every visible particle at a pixel of its own mesh, even one that sits a hair outside its pixel at the rim', () => {
    // (a particle accepted through a neighbouring pixel must carry THAT pixel: an empty one has no value or plane)
    let viaNeighbour = 0
    for (const azimuth of [0, 30, 100]) {
      const { fc, g } = frame(sphereScene, { width: 400, height: 300, azimuth, elevation: 25, zoom: 100 })
      const vis = visibleParticles(fc, set)
      const out = [0, 0, 0]
      let wrong = 0
      for (let k = 0; k < vis.count; k++) {
        const i = vis.idx[k]
        if (g.mark[vis.gi[k]] !== set.mark[i]) wrong++
        project(fc, set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2], out)
        if (gIndex(fc, out[0], out[1]) !== vis.gi[k]) viaNeighbour++
      }
      expect(wrong).toBe(0)
    }
    // the case happens: some particles are read at a neighbour
    expect(viaNeighbour).toBeGreaterThan(0)
  })

  it('draws a different subset for each role, so strokes do not all share their anchors', () => {
    const { fc } = frame(sphereScene, { width: 400, height: 300, zoom: 100 })
    const vis = visibleParticles(fc, set)
    const block = new Set(drawnEntries(fc, vis, set, 'block'))
    const form = drawnEntries(fc, vis, set, 'form')
    let shared = 0
    for (const k of form) if (block.has(k)) shared++
    // independent subsets of about a third each would share about a third; the same subset would share all
    expect(shared / form.length).toBeLessThan(0.6)
    expect(roleRank(0.5, 'block')).not.toBeCloseTo(roleRank(0.5, 'form'), 3)
    for (const r of [0, 0.3, 0.999]) {
      expect(roleRank(r, 'dab')).toBeGreaterThanOrEqual(0)
      expect(roleRank(r, 'dab')).toBeLessThan(1)
    }
  })

  it('fades strokes out over |n·v| in fadeLo..fadeHi, and is whole face-on', () => {
    const { fc } = frame(sphereScene, { width: 400, height: 300, zoom: 100 })
    const vis = visibleParticles(fc, set)
    let faceOn = 0
    let limb = 0
    for (let k = 0; k < vis.count; k++) {
      const f = vis.facing[k]
      const expected = f <= 0.08 ? 0 : f >= 0.25 ? 1 : ((f - 0.08) / 0.17) ** 2 * (3 - (2 * (f - 0.08)) / 0.17)
      expect(vis.fade[k]).toBeCloseTo(expected, 5)
      // right at the limb a stroke is invisible, so no such particle is kept (one just behind it can pass the depth test)
      expect(vis.fade[k]).toBeGreaterThanOrEqual(0.02)
      if (f > 0.9) faceOn++
      if (f < 0.2) limb++
    }
    expect(faceOn).toBeGreaterThan(10)
    expect(limb).toBeGreaterThan(5)
  })

  it('shows a veil unless an opaque surface stands in front of it', () => {
    // camera along +x looking toward -x; the sphere sits at the origin; veils at x = 2 (in front) and x = -2 (behind)
    const front = quadMesh({ origin: [2, -0.5, -0.5], e1: [0, 1, 0], e2: [0, 0, 1], opacity: 0.4, index: 1 })
    const behind = quadMesh({ origin: [-2, -0.5, -0.5], e1: [0, 1, 0], e2: [0, 0, 1], opacity: 0.4, index: 2 })
    const scene = sceneOf([sphereMesh({ radius: 1 }), front, behind])
    const ps = buildParticles(scene, COLOURS, P)
    const { fc } = frame(scene, { width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100 })
    const vis = visibleParticles(fc, ps)
    const seen = [0, 0, 0]
    for (let k = 0; k < vis.count; k++) seen[ps.mark[vis.idx[k]]]++
    expect(seen[1]).toBeGreaterThan(50) // the veil in front is all there
    expect(seen[2]).toBe(0) // the one behind the sphere is hidden by it
    // the veil in front is seen from either side: its facing is |n·v|
    for (let k = 0; k < vis.count; k++) if (ps.mark[vis.idx[k]] === 1) expect(vis.facing[k]).toBeGreaterThan(0.99)
  })
})
