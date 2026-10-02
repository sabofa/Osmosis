import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { makeCurve } from './curve'
import { chamferDist, segmentPlanes, stepValue } from './planes'
import { paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { buildPlanMap } from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS

function planesOf(params: PaintParams = P, withTable = false) {
  const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
  const g = sphereGBuffer(400, 300, { view, params, table: withTable ? { z: -1, mark: 1 } : undefined })
  const scene = withTable ? sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })]) : sceneOf([sphereMesh()])
  const fc = makeFrameCtx(scene, view, g, params)
  const plan = buildPlanMap(fc)
  const curve = makeCurve(params)
  const map = segmentPlanes(fc, plan, curve)
  return { g, fc, plan, map, curve }
}

describe('planes', () => {
  it('breaks a sphere into more than 20 planes, none under planeMinPx', () => {
    const { g, map } = planesOf()
    expect(map.planes.length).toBeGreaterThan(20)
    // planeMinPx is in CSS px²; the G-buffer pixel is scale² of them: 70 / 4 = 17.5 pixels
    const min = 70 / (g.scale * g.scale)
    for (const p of map.planes) expect(p.area).toBeGreaterThanOrEqual(min)
    // without the merge, there are small pieces: that is what planeMinPx removes
    const raw = planesOf(resolvePaintParams({ edges: { planeMinPx: 0 } }))
    expect(raw.map.planes.length).toBeGreaterThan(map.planes.length)
    expect(Math.min(...raw.map.planes.map((p) => p.area))).toBeLessThan(min)
    // and a far larger minimum merges far more
    const big = planesOf(resolvePaintParams({ edges: { planeMinPx: 4000 } }))
    expect(big.map.planes.length).toBeLessThan(map.planes.length)
    for (const p of big.map.planes) expect(p.area).toBeGreaterThanOrEqual(1000)
  })

  it('partitions the figure: every filled pixel is in exactly one plane, and the statistics add up', () => {
    const { g, plan, map } = planesOf()
    let filled = 0
    const area = new Array<number>(map.planes.length).fill(0)
    const su = new Array<number>(map.planes.length).fill(0)
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] < 0) {
        expect(map.plane[i]).toBe(-1)
        continue
      }
      expect(map.plane[i]).toBeGreaterThanOrEqual(0)
      area[map.plane[i]]++
      su[map.plane[i]] += plan.u[i]
      filled++
    }
    expect(filled).toBeGreaterThan(4000)
    for (const p of map.planes) {
      expect(p.area).toBe(area[p.id])
      expect(p.u).toBeCloseTo(su[p.id] / area[p.id], 4)
      expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 5)
      // the centroid is inside the bounding box
      expect(p.cx).toBeGreaterThanOrEqual(p.x0)
      expect(p.cx).toBeLessThanOrEqual(p.x1)
      expect(p.cy).toBeGreaterThanOrEqual(p.y0)
      expect(p.cy).toBeLessThanOrEqual(p.y1)
    }
  })

  it('cuts by normal cell and by zone: each unmerged plane holds one zone, a wider cell makes fewer planes', () => {
    const raw = planesOf(resolvePaintParams({ edges: { planeMinPx: 0 } }))
    const { g, plan, map } = raw
    const zoneOf = new Map<number, number>()
    let mixed = 0
    for (let i = 0; i < g.width * g.height; i++) {
      const id = map.plane[i]
      if (id < 0) continue
      const z = zoneOf.get(id)
      if (z === undefined) zoneOf.set(id, plan.zone[i])
      else if (z !== plan.zone[i]) mixed++
    }
    expect(mixed).toBe(0)
    const coarse = planesOf(resolvePaintParams({ edges: { planeMinPx: 0, planeCellDeg: 60 } }))
    expect(coarse.map.planes.length).toBeLessThan(raw.map.planes.length / 2)
  })

  it('gives the figure a smooth hue and chroma step per plane, and the table none', () => {
    const { map, curve } = planesOf(P, true)
    let figure = 0
    for (const p of map.planes) {
      if (p.ground) {
        expect(p.hOff).toBe(0)
        expect(p.cOff).toBe(0)
        continue
      }
      figure++
      const [h, c] = curve.planeStep(p.nx, p.ny, p.nz)
      expect(p.hOff).toBeCloseTo(h, 9)
      expect(p.cOff).toBeCloseTo(c, 9)
    }
    expect(figure).toBeGreaterThan(20)
  })

  it('splits the shadow on the table into bands by distance from the figure', () => {
    const { map, g, plan } = planesOf(P, true)
    const cast = map.planes.filter((p) => p.ground && p.cast)
    const lit = map.planes.filter((p) => p.ground && !p.cast)
    expect(cast.length).toBeGreaterThanOrEqual(2)
    expect(lit.length).toBe(1)
    // the nearer band is darker on average (the plateau is the same, but there is no gradient: equal)
    for (const p of cast) expect(p.u).toBeCloseTo(0.32, 4)
    expect(lit[0].u).toBeCloseTo(plan.uCanvas, 4)
    // distance from the figure is 0 on the sphere and grows across the table
    let onSphere = 0
    let maxD = 0
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] === 0) {
        expect(map.dObj[i]).toBe(0)
        onSphere++
      } else if (g.mark[i] === 1) maxD = Math.max(maxD, map.dObj[i])
    }
    expect(onSphere).toBeGreaterThan(4000)
    expect(maxD).toBeGreaterThan(40)
  })

  it('measures distance with a chamfer: exact along the axes, 1.414 per diagonal step', () => {
    const w = 15
    const h = 15
    const mask = new Uint8Array(w * h)
    mask[7 * w + 7] = 1
    const d = chamferDist(mask, w, h)
    expect(d[7 * w + 7]).toBe(0)
    expect(d[7 * w + 12]).toBeCloseTo(5, 5) // five steps across
    expect(d[10 * w + 10]).toBeCloseTo(3 * 1.414, 5) // three diagonal steps
    expect(d[11 * w + 10]).toBeCloseTo(3 * 1.414 + 1, 5) // (3, 4): three diagonals and a step
  })

  it('keeps a plane’s own gradient at planeGradient of the stroke’s: mean + 0.45·(u − mean)', () => {
    const { map } = planesOf()
    const p = map.planes[0]
    expect(stepValue(map, p.id, p.u + 0.2, 0.45)).toBeCloseTo(p.u + 0.09, 9)
    expect(stepValue(map, p.id, p.u - 0.1, 0.45)).toBeCloseTo(p.u - 0.045, 9)
    expect(stepValue(map, p.id, 0.77, 0)).toBeCloseTo(p.u, 9)
    expect(stepValue(map, p.id, 0.77, 1)).toBeCloseTo(0.77, 9)
    // off the figure the value is the stroke's own
    expect(stepValue(map, -1, 0.77, 0.45)).toBe(0.77)
  })

  it('is deterministic', () => {
    const a = planesOf()
    const b = planesOf()
    expect(Array.from(a.map.plane)).toEqual(Array.from(b.map.plane))
    expect(a.map.planes.map((p) => p.u)).toEqual(b.map.planes.map((p) => p.u))
  })
})
