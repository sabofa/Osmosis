import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import type { GBuffer, PaintView } from '../types'
import { behaviourOf, contoursOf, edgeClassOf, edgeHardness, extractEdges, resample, smoothClasses, strokeEdgeClass } from './edges'
import { segmentPlanes } from './planes'
import { makeCurve } from './curve'
import { makeGBuffer, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { buildPlanMap } from './value'
import { makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

// no noise along the edge and no occlusion: these constructed G-buffers have normals and depths that do not agree
const NO_NOISE = resolvePaintParams({ edges: { noise: 0 }, environment: { occlusion: 0 } })

function analyse(g: GBuffer, view: PaintView, params: PaintParams, table = false) {
  const scene = table ? sceneOf([sphereMesh(), tableMesh({ z: -1, index: 1 })]) : sceneOf([sphereMesh()])
  const fc = makeFrameCtx(scene, view, g, params)
  const plan = buildPlanMap(fc)
  const planes = segmentPlanes(fc, plan, makeCurve(params))
  const edges = extractEdges(fc, plan, planes)
  return { fc, plan, planes, edges }
}

// Two faces side by side in a block of the screen, camera straight on (az 0, el 0: a
// view-space normal (x, y, z) is the world normal (z, x, y)). The model lights them itself
// from their normals: the key light is up and to the left of the camera, so a face turned
// left (-0.5, 0, 0.866) is lit to 0.94 (plan value 0.905, the light) and one turned well to
// the right (0.9, 0, 0.436) is turned from the light entirely: ambient only, the core, 0.24.
const LIT_LEFT: [number, number, number] = [-0.5, 0, 0.866]
const CORE_RIGHT: [number, number, number] = [0.9, 0, 0.436]
const CORE_RIGHT_2: [number, number, number] = [0.95, 0, 0.312]

function twoFaces(left: [number, number, number], right: [number, number, number], params: PaintParams) {
  const view = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100 })
  const toWorld = (n: [number, number, number]) => [n[2], n[0], n[1]]
  const g = makeGBuffer(view, 2, (x, y) => {
    if (x < 80 || x >= 320 || y < 60 || y >= 240) return null
    return { depth: 20, normal: toWorld(x < 200 ? left : right), value: 0, mark: 0 }
  })
  return { view, g, ...analyse(g, view, params) }
}

describe('edge control', () => {
  it('quantises hardness into LOST / SOFT / FIRM / HARD at 0.24, 0.46 and 0.68', () => {
    const p = DEFAULT_PAINT_PARAMS
    expect([0, 0.2399, 0.24, 0.4599, 0.46, 0.6799, 0.68, 1].map((h) => edgeClassOf(h, p))).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    const moved = resolvePaintParams({ edges: { lostBelow: 0.1, softBelow: 0.2, firmBelow: 0.3 } })
    expect([0.05, 0.15, 0.25, 0.35].map((h) => edgeClassOf(h, moved))).toEqual([0, 1, 2, 3])
  })

  it('scores hardness as the weighted sum of the terms, with the shadow distance only for shadows', () => {
    const p = DEFAULT_PAINT_PARAMS
    const t = { c: 1, k: 1, f: 1, s: 1, d: 1, x: 1 }
    // internal: .32 + .22 + .26 + .10 + .10 = 1.00
    expect(edgeHardness('internal', t, p)).toBeCloseTo(1.0, 9)
    // silhouette: .52 + .08 + .14 + .08 + .18 = 1.00
    expect(edgeHardness('silhouette', t, p)).toBeCloseTo(1.0, 9)
    // shadow: .36 + .08 + .06 + .08 + .12 + .30 = 1.00
    expect(edgeHardness('shadow', t, p)).toBeCloseTo(1.0, 9)
    // a single term, hand-weighted
    expect(edgeHardness('internal', { c: 0.5, k: 0, f: 0, s: 0, d: 0, x: 1 }, p)).toBeCloseTo(0.16, 9)
    expect(edgeHardness('silhouette', { c: 0, k: 0, f: 1, s: 0, d: 0, x: 1 }, p)).toBeCloseTo(0.14, 9)
    expect(edgeHardness('shadow', { c: 0, k: 0, f: 0, s: 0, d: 0, x: 1 }, p)).toBeCloseTo(0.3, 9)
  })

  it('calls a sharp normal crease with high contrast HARD', () => {
    // a lit face (plan value 0.905) against one turned from the light (the core, 0.24): contrast 0.665
    const { edges, planes } = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE)
    const crease = edges.edges.filter((e) => e.type === 'internal')
    expect(crease.length).toBe(1)
    const e = crease[0]
    expect(e.contrast).toBeCloseTo(0.665, 2)
    expect(planes.planes[e.a].mark).toBe(0)
    // c = 1 (contrast 0.67 > 0.60), k = 1 (60° between the normals), d = 1 (flat in depth), s = 0.600:
    // H = .32 + .22 + .10 + .10·0.600 = 0.70 before the focal term
    expect(e.h.length).toBeGreaterThan(40)
    for (let i = 0; i < e.h.length; i++) {
      expect(e.h[i]).toBeGreaterThanOrEqual(0.699 - 1e-3)
      expect(e.cls[i]).toBe(3)
    }
    // the same on the plane-to-plane hardness the strokes read
    expect(edges.adjHard(e.a, e.b)).toBeGreaterThanOrEqual(0.699 - 1e-3)
    expect(edges.adjHard(e.b, e.a)).toBe(edges.adjHard(e.a, e.b))
  })

  it('calls two adjacent planes of equal value LOST: both turned from the light, in different planes', () => {
    const { edges } = twoFaces(CORE_RIGHT, CORE_RIGHT_2, NO_NOISE)
    const seam = edges.edges.filter((e) => e.type === 'internal')
    expect(seam.length).toBe(1)
    expect(seam[0].contrast).toBeCloseTo(0, 6)
    for (let i = 0; i < seam[0].h.length; i++) {
      expect(seam[0].h[i]).toBeLessThan(0.24)
      expect(seam[0].cls[i]).toBe(0)
    }
    // and an edge with no visible transition leaves no mark on the hardness field: the brush carries on across it
    expect(edges.adjHard(seam[0].a, seam[0].b)).toBeLessThan(0.24)
    let anyNear = false
    for (let i = 0; i < edges.dist.length; i++) if (edges.dist[i] < edges.reach) anyNear = true
    // (the outline of the block still counts: only the internal seam is excluded)
    expect(anyNear).toBe(true)
    const gx = 100
    expect(edges.dist[75 * 200 + gx]).toBeGreaterThan(edges.reach - 1) // mid-block, on the seam: nothing near
  })

  it('forces LOST where there is no value contrast, however sharply the form turns', () => {
    // two faces turned well from the light, 37 degrees apart, with the same up component, so the same value (the core):
    // the contrast is exactly 0. The curvature term is whole (37 degrees over a few px is far past 0.06 rad/px) and the
    // surface is flat in depth, so the weighted sum would be .22 + .10 = 0.32, SOFT. With nothing to see across the
    // seam it is held under the LOST line: lostBelow - 0.01 = 0.23.
    const n1: [number, number, number] = [0.8494, -0.4997, 0.1699]
    const n2: [number, number, number] = [0.5, -0.5, 0.7071]
    const { edges } = twoFaces(n1, n2, NO_NOISE)
    const seam = edges.edges.filter((e) => e.type === 'internal')
    expect(seam.length).toBe(1)
    expect(seam[0].contrast).toBeCloseTo(0, 6)
    expect(seam[0].h.length).toBeGreaterThan(40)
    for (let i = 0; i < seam[0].h.length; i++) {
      expect(seam[0].h[i]).toBeCloseTo(0.23, 6)
      expect(seam[0].cls[i]).toBe(0)
    }
    // the rule follows the parameter
    const moved = resolvePaintParams({ edges: { noise: 0, lostBelow: 0.3, softBelow: 0.5, firmBelow: 0.7 }, environment: { occlusion: 0 } })
    const m = twoFaces(n1, n2, moved).edges.edges.filter((e) => e.type === 'internal')[0]
    for (let i = 0; i < m.h.length; i++) expect(m.h[i]).toBeCloseTo(0.29, 6)
  })

  it('calls the terminator of a smooth sphere SOFT', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view })
    const { edges, planes } = analyse(g, view, NO_NOISE)
    // the boundary between the half-tone and the core shadow: internal edges between those zones
    const terminator = edges.edges.filter((e) => {
      if (e.type !== 'internal') return false
      const za = planes.planes[e.a].zone
      const zb = planes.planes[e.b].zone
      return (za === 1 && zb === 2) || (za === 2 && zb === 1)
    })
    expect(terminator.length).toBeGreaterThan(0)
    let n = 0
    let sum = 0
    let hard = 0
    let soft = 0
    for (const e of terminator) {
      for (let i = 0; i < e.h.length; i++) {
        n++
        sum += e.h[i]
        if (e.cls[i] === 3) hard++
        if (e.cls[i] === 1) soft++
      }
    }
    expect(n).toBeGreaterThan(30)
    const mean = sum / n
    expect(mean).toBeGreaterThan(0.24)
    expect(mean).toBeLessThan(0.46)
    expect(hard).toBe(0)
    expect(soft / n).toBeGreaterThan(0.5) // mostly SOFT: a smooth form does not turn hard
    // the form is smooth: no curvature term to speak of
    // and the crease above is harder than this terminator
    const crease = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE).edges.edges.find((e) => e.type === 'internal')!
    expect(Math.min(...crease.h)).toBeGreaterThan(mean)
  })

  it('makes a cast shadow harder near the occluder than far from it', () => {
    const view = paintView({ width: 800, height: 600, azimuth: 30, elevation: 25, zoom: 90 })
    const g = sphereGBuffer(800, 600, { view, table: { z: -1, mark: 1 } })
    const { edges, planes } = analyse(g, view, NO_NOISE, true)
    const shadow = edges.edges.filter((e) => e.type === 'shadow')
    expect(shadow.length).toBeGreaterThan(0)
    let nearSum = 0
    let nearN = 0
    let farSum = 0
    let farN = 0
    for (const e of shadow) {
      for (let i = 0; i < e.h.length; i++) {
        const gx = clampInt(Math.round(e.pts[2 * i]), 0, g.width - 1)
        const gy = clampInt(Math.round(e.pts[2 * i + 1]), 0, g.height - 1)
        const dCss = planes.dObj[gy * g.width + gx] * g.scale
        if (dCss < 30) {
          nearSum += e.h[i]
          nearN++
        } else if (dCss > 50) {
          farSum += e.h[i]
          farN++
        }
      }
    }
    expect(nearN).toBeGreaterThan(5)
    expect(farN).toBeGreaterThan(5)
    // the distance term is 0.30·(1 − smooth(8, 110 px)): +0.3 at the occluder, nothing past 110 px
    expect(nearSum / nearN - farSum / farN).toBeGreaterThan(0.15)
    // and it falls off monotonically with distance, in coarse bands
    const bands = [0, 0, 0, 0]
    const counts = [0, 0, 0, 0]
    for (const e of shadow) {
      for (let i = 0; i < e.h.length; i++) {
        const gx = clampInt(Math.round(e.pts[2 * i]), 0, g.width - 1)
        const gy = clampInt(Math.round(e.pts[2 * i + 1]), 0, g.height - 1)
        const dCss = planes.dObj[gy * g.width + gx] * g.scale
        const b = dCss < 25 ? 0 : dCss < 45 ? 1 : dCss < 65 ? 2 : 3
        bands[b] += e.h[i]
        counts[b]++
      }
    }
    const mean = bands.map((s, i) => (counts[i] ? s / counts[i] : NaN))
    for (let i = 1; i < 4; i++) if (!Number.isNaN(mean[i]) && !Number.isNaN(mean[i - 1])) expect(mean[i]).toBeLessThan(mean[i - 1] + 0.05)
  })

  it('finds the focal points: the terminator nearest the viewer and the brightest spot, R = 0.55·√(area/π)', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view })
    const { edges } = analyse(g, view, NO_NOISE)
    expect(edges.focal).not.toBeNull()
    let area = 0
    for (let i = 0; i < g.width * g.height; i++) if (g.mark[i] >= 0) area++
    expect(edges.focal!.R).toBeCloseTo(0.55 * Math.sqrt(area / Math.PI), 6)
    // both points lie on the sphere, in its upper-left half (the light is up and to the left)
    for (const [x, y] of edges.focal!.pts) {
      expect(g.mark[y * g.width + x]).toBe(0)
    }
  })

  it('reaches 20 CSS px from an edge, with the edge’s own hardness', () => {
    const { edges, g } = (() => {
      const r = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE)
      return { edges: r.edges, g: r.g }
    })()
    expect(edges.reach).toBeCloseTo(10, 9) // 20 CSS px at two CSS px per G pixel
    const e = edges.edges.find((x) => x.type === 'internal')!
    const mid = Math.floor(e.h.length / 2)
    const x = Math.round(e.pts[2 * mid])
    const y = Math.round(e.pts[2 * mid + 1])
    expect(edges.dist[y * g.width + x]).toBeLessThan(1)
    expect(edges.hard[y * g.width + x]).toBeCloseTo(e.h[mid], 5)
    // 12 G px (24 CSS px) from the seam: out of reach
    expect(edges.dist[y * g.width + x + 12]).toBeGreaterThan(edges.reach - 1e-6)
  })

  it('gives a stroke the class of the nearest edge, or 0.52 + 0.26·light − 0.28·shadow away from any', () => {
    const { fc, edges, g } = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE)
    // a path in CSS px right along the seam (x = 200)
    const xs = [198, 199, 200, 201, 202]
    const ys = [100, 110, 120, 130, 140]
    const near = strokeEdgeClass(fc, edges, xs, ys, 5, 1, 0)
    expect(near.nearEdge).toBe(true)
    expect(near.cls).toBe(3)
    // far from every edge: the interior rule
    const ax = [120, 121, 122]
    const ay = [100, 100, 100]
    // (the block's own outline is 40 CSS px to the left; the seam 80 away)
    const far = strokeEdgeClass(fc, edges, ax, ay, 3, 1, 0)
    expect(far.nearEdge).toBe(false)
    expect(far.hardness).toBeCloseTo(0.78, 9) // 0.52 + 0.26 - 0
    expect(far.cls).toBe(3)
    expect(strokeEdgeClass(fc, edges, ax, ay, 3, 0, 1).hardness).toBeCloseTo(0.24, 9)
    expect(strokeEdgeClass(fc, edges, ax, ay, 3, 0, 1).cls).toBe(1)
    expect(strokeEdgeClass(fc, edges, ax, ay, 3, 0.5, 0.2).hardness).toBeCloseTo(0.594, 9)
    expect(strokeEdgeClass(fc, edges, ax, ay, 3, 0.5, 0.2).cls).toBe(2)
    // clamped to 0.1..0.9
    expect(strokeEdgeClass(fc, edges, ax, ay, 3, 5, 0).hardness).toBeCloseTo(0.9, 9)
    expect(g.width).toBe(200)
  })

  it('changes the brush by class: hard is crisp and loaded, lost dissolves and picks up', () => {
    const [lost, soft, firm, hard] = [0, 1, 2, 3].map(behaviourOf)
    // HARD: no wet pickup, crisp ends, load x1.12, impasto x1.4
    expect(hard.wetMul).toBe(0)
    expect(hard.endSoft).toBe(0)
    expect(hard.loadMul).toBeCloseTo(1.12, 9)
    expect(hard.impastoMul).toBeCloseTo(1.4, 9)
    // FIRM: wet x0.6, impasto x1.15
    expect(firm.wetMul).toBeCloseTo(0.6, 9)
    expect(firm.impastoMul).toBeCloseTo(1.15, 9)
    // SOFT: wet at least 0.22, ends at 0.78, impasto x0.7, bristle variance x0.6
    expect(soft.wetMin).toBeCloseTo(0.22, 9)
    expect(soft.impastoMul).toBeCloseTo(0.7, 9)
    expect(soft.bristleVarMul).toBeCloseTo(0.6, 9)
    expect(soft.endSoft).toBeCloseTo((0.98 - 0.78) / 0.32, 9)
    // LOST: wet at least 0.32, ends at 0.66, impasto x0.5
    expect(lost.wetMin).toBeCloseTo(0.32, 9)
    expect(lost.impastoMul).toBeCloseTo(0.5, 9)
    expect(lost.endSoft).toBeCloseTo(1, 9)
    // the ends dissolve more the softer the edge
    expect(lost.endSoft).toBeGreaterThan(soft.endSoft)
    expect(soft.endSoft).toBeGreaterThan(firm.endSoft)
    expect(firm.endSoft).toBeGreaterThan(hard.endSoft)
  })
})

describe('edge smoothing', () => {
  it('takes the median class over 7 samples, so a lone sample does not flicker, and a run of four holds', () => {
    // a single HARD sample in a SOFT run is lost; the 7-sample window needs 4 to win
    const lone = smoothClasses(Uint8Array.from([1, 1, 1, 3, 1, 1, 1, 1, 1]))
    expect(Array.from(lone)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1])
    // a run of four HARD in a SOFT run holds (every window over it has four), a run of three is erased
    const four = smoothClasses(Uint8Array.from([1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1]))
    expect(Array.from(four)).toEqual([1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1])
    const three = smoothClasses(Uint8Array.from([1, 1, 1, 1, 3, 3, 3, 1, 1, 1, 1]))
    expect(Array.from(three)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    // the ends repeat their own sample: a whole HARD run stays HARD, and the first sample of [0, 3, 3, 3] has four
    // copies of itself in its window, so it keeps its class while the second sees the three HARD
    expect(Array.from(smoothClasses(Uint8Array.from([3, 3, 3, 3, 3, 3, 3])))).toEqual([3, 3, 3, 3, 3, 3, 3])
    expect(Array.from(smoothClasses(Uint8Array.from([0, 3, 3, 3])))).toEqual([0, 3, 3, 3])
    expect(smoothClasses(new Uint8Array(0)).length).toBe(0)
  })

  it('adds edges.noise of seeded value noise along an edge, bounded by the slider, and none at zero', () => {
    const noisy = twoFaces(LIT_LEFT, CORE_RIGHT, resolvePaintParams({ environment: { occlusion: 0 } })).edges.edges.find((e) => e.type === 'internal')!
    const quiet = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE).edges.edges.find((e) => e.type === 'internal')!
    expect(noisy.h.length).toBe(quiet.h.length)
    let maxDiff = 0
    let sum = 0
    for (let i = 0; i < noisy.h.length; i++) {
      const d = noisy.h[i] - quiet.h[i]
      maxDiff = Math.max(maxDiff, Math.abs(d))
      sum += Math.abs(d)
    }
    // the noise is in [-0.12, 0.12] (clamped with the score to 0..1), smooth along the edge, and really there
    expect(maxDiff).toBeLessThanOrEqual(0.12 + 1e-6)
    expect(maxDiff).toBeGreaterThan(0.02)
    expect(sum / noisy.h.length).toBeGreaterThan(0.01)
    let steepest = 0
    for (let i = 1; i < noisy.h.length; i++) steepest = Math.max(steepest, Math.abs(noisy.h[i] - noisy.h[i - 1] - (quiet.h[i] - quiet.h[i - 1])))
    expect(steepest).toBeLessThan(0.02) // a long, gentle waver, not jitter
  })
})

describe('edge geometry helpers', () => {
  it('chains a marching-squares circle into one closed loop of about the right length', () => {
    const w = 40
    const f = new Float32Array(w * w)
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) f[y * w + x] = Math.hypot(x - 20, y - 20) < 10 ? 1 : 0
    // blur once so the iso-line is smooth
    const loops = contoursOf(f, w, w, 0.5)
    expect(loops.length).toBe(1)
    expect(loops[0].closed).toBe(true)
    let len = 0
    const p = loops[0].pts
    for (let i = 0; i < p.length; i++) len += Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1])
    expect(len).toBeGreaterThan(2 * Math.PI * 10 * 0.95)
    expect(len).toBeLessThan(2 * Math.PI * 10 * 1.15)
  })

  it('leaves a contour that runs off the edge of the field open', () => {
    const w = 20
    const f = new Float32Array(w * w)
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) f[y * w + x] = x > 8 ? 1 : 0
    const loops = contoursOf(f, w, w, 0.5)
    expect(loops.length).toBe(1)
    expect(loops[0].closed).toBe(false)
    expect(loops[0].pts.length).toBe(w) // one crossing per row of cells, w - 1 cells, w points
  })

  it('resamples at equal arc length, keeping the end', () => {
    const out = resample([[0, 0], [10, 0], [10, 5]], 2)
    // points every 2 along 10 + 5 = 15: 0, 2, ... 14 and the end at 15 (more than 0.3·step from 14)
    expect(out.length).toBe(9)
    expect(out[1][0]).toBeCloseTo(2, 9)
    expect(out[5][0]).toBeCloseTo(10, 9)
    expect(out[6]).toEqual([10, 2]) // round the corner: 12 along is two up the second leg
    expect(out[out.length - 1]).toEqual([10, 5])
  })
})

describe('the hardness field', () => {
  // what is the nearest edge, how hard, how far: the definition, by brute force over every edge sample
  it('is, at every pixel, the nearest sample of a visible edge within edgeReachPx, and its hardness', () => {
    const { edges, fc } = twoFaces(LIT_LEFT, CORE_RIGHT, NO_NOISE)
    const g = fc.g
    const w = g.width
    const h = g.height
    const minContrast = NO_NOISE.detect.edgeMinContrast
    const reach = edges.reach
    expect(reach).toBeCloseTo(NO_NOISE.detect.edgeReachPx / g.scale, 9)
    let covered = 0
    const seen = new Set<number>()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // the nearest distance, and the hardness of every sample at that distance (a tie may be taken either way)
        let best = 99
        let hardnesses: number[] = []
        for (const e of edges.edges) {
          if (e.contrast < minContrast) continue
          for (let k = 0; k < e.h.length; k++) {
            const d = Math.hypot(x - Math.round(e.pts[2 * k]), y - Math.round(e.pts[2 * k + 1]))
            if (d >= reach) continue
            if (d < best - 1e-9) {
              best = d
              hardnesses = [e.h[k]]
            } else if (Math.abs(d - best) <= 1e-9) hardnesses.push(e.h[k])
          }
        }
        const i = y * w + x
        expect(edges.dist[i], `dist at ${x},${y}`).toBeCloseTo(Math.fround(best), 5)
        if (best === 99) expect(edges.hard[i], `hardness at ${x},${y}`).toBe(0)
        else {
          expect(hardnesses.map((v) => Math.fround(v)), `hardness at ${x},${y}`).toContain(edges.hard[i])
          covered++
          seen.add(Math.round(best * 10))
        }
      }
    }
    // the field is not trivial: a band round the boundary between the faces, with a range of distances
    expect(covered).toBeGreaterThan(200)
    expect(seen.size).toBeGreaterThan(8)
    expect(Math.max(...edges.dist.filter((d) => d < 99))).toBeLessThan(reach)
  })
})

function clampInt(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}
