import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { PATH_POINTS, ROLES, type GBuffer, type PaintView } from '../types'
import { labToLch, lchToLab } from './colour'
import { contourRuns, DECAL_SLOPE, edgeStrokes, segmentRun } from './contours'
import type { EdgeRun } from './edges'
import { buildContext } from './index'
import { buildParticles } from './particles'
import { flatColours, graphMesh, makeGBuffer, meshGBuffer, paintView, quadMesh, sceneOf, sphereGBuffer, sphereMesh } from './testing'
import type { SpaceScene } from '../../scene/types'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.7, 0.05, 150), 2: lchToLab(0.5, 0.1, 250) })

function contextOf(scene: SpaceScene, view: PaintView, g: GBuffer, params: PaintParams = P) {
  return buildContext(scene, buildParticles(scene, COLOURS, params), view, g, params)
}

const points = (run: EdgeRun, scale: number): [number, number][] => {
  const out: [number, number][] = []
  for (let i = 0; i < run.h.length; i++) out.push([run.pts[2 * i] * scale, run.pts[2 * i + 1] * scale])
  return out
}

describe('mesh contours (spec §3.6, M7)', () => {
  it('finds the silhouette of a sphere as the zero crossings of n·v: a circle of the sphere’s radius', () => {
    const scene = sceneOf([sphereMesh({ radius: 1, nu: 64, nv: 48 })])
    const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120 })
    const g = sphereGBuffer(640, 480, { view })
    const an = contextOf(scene, view, g)
    const runs = contourRuns(an)
    expect(runs.length).toBeGreaterThan(0)
    const bins = new Set<number>()
    let samples = 0
    let worst = 0
    for (const run of runs) {
      expect(run.type).toBe('silhouette')
      expect(run.mark).toBe(0)
      for (const [x, y] of points(run, g.scale)) {
        samples++
        // the silhouette of the unit sphere on screen: radius 120 about the centre, within the mesh's chord error
        worst = Math.max(worst, Math.abs(Math.hypot(x - 320, y - 240) - 120))
        bins.add(Math.floor(((Math.atan2(y - 240, x - 320) + Math.PI) / (2 * Math.PI)) * 72))
      }
    }
    expect(samples).toBeGreaterThan(300)
    // nothing inside the figure: no seam, no pole (coincident vertices are merged), nothing but the rim
    expect(worst).toBeLessThan(2.5)
    // and the rim is covered all the way round (at least 90% of the 5-degree bins)
    expect(bins.size).toBeGreaterThan(64)
  })

  it('finds the border of an open mesh, and the creases inside one', () => {
    // a square facing the camera: its border is a 240 px square
    const quad = quadMesh({ origin: [0, -1, -1], e1: [0, 2, 0], e2: [0, 0, 2], index: 0 })
    const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 0, zoom: 120 })
    const g = meshGBuffer(640, 480, [{ mesh: quad, mark: 0 }], { view })
    const q = contextOf(sceneOf([quad]), view, g)
    const runs = contourRuns(q)
    expect(runs.length).toBeGreaterThanOrEqual(4)
    const onSquare = (x: number, y: number) => Math.min(Math.abs(Math.abs(x - 320) - 120) + (Math.abs(y - 240) <= 121 ? 0 : 99), Math.abs(Math.abs(y - 240) - 120) + (Math.abs(x - 320) <= 121 ? 0 : 99))
    let off = 0
    let total = 0
    const sides = new Set<string>()
    for (const run of runs) {
      for (const [x, y] of points(run, g.scale)) {
        total++
        if (onSquare(x, y) > 2.5) off++
        sides.add(Math.abs(x - 320) > Math.abs(y - 240) ? (x < 320 ? 'left' : 'right') : y < 240 ? 'top' : 'bottom')
      }
    }
    expect(total).toBeGreaterThan(200)
    expect(off / total).toBeLessThan(0.02)
    expect(sides.size).toBe(4)

    // a fold: z = |x| over [-1, 1]²: a crease down the middle where the faces meet at 90 degrees
    const fold = graphMesh((x) => Math.abs(x), { half: 1, n: 8, index: 0 })
    const view2 = paintView({ width: 640, height: 480, azimuth: 20, elevation: 40, zoom: 140 })
    const g2 = meshGBuffer(640, 480, [{ mesh: fold, mark: 0 }], { view: view2 })
    const f = contextOf(sceneOf([fold]), view2, g2)
    const creaseRuns = contourRuns(f)
    // the fold line x = 0, z = 0 from y = -1 to 1, projected
    const a = projectPoint(f, [0, -1, 0])
    const b = projectPoint(f, [0, 1, 0])
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let near = 0
    for (const run of creaseRuns) {
      for (const [x, y] of points(run, g2.scale)) {
        const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (len * len)
        const d = Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1])))
        if (t > 0.02 && t < 0.98 && d < 2.5) near++
      }
    }
    // one sample every 2 px along most of the 280-ish px crease
    expect(near).toBeGreaterThan(len / 2 / 2)
  })

  it('drops the part of a contour a nearer surface hides', () => {
    // two squares one behind the other: the back one's border is hidden where the front one covers it
    const back = quadMesh({ origin: [-1, -1.2, -0.6], e1: [0, 2.4, 0], e2: [0, 0, 1.2], index: 0 })
    const front = quadMesh({ origin: [1, -0.5, -0.9], e1: [0, 1, 0], e2: [0, 0, 1.6], index: 1 })
    const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 0, zoom: 120 })
    const g = meshGBuffer(640, 480, [{ mesh: back, mark: 0 }, { mesh: front, mark: 1 }], { view })
    const an = contextOf(sceneOf([back, front]), view, g)
    const runs = contourRuns(an).filter((r) => r.mark === 0)
    expect(runs.length).toBeGreaterThan(0)
    // the front square covers x from 260 to 380 px (y ∈ [-0.5, 0.5]) and z from -0.9 to 0.7: the back's top and bottom edges
    // (z = 0.6 and z = -0.6, at y = 240 - 72 and 240 + 72) pass behind it between those columns
    let hidden = 0
    for (const run of runs) for (const [x, y] of points(run, g.scale)) if (x > 266 && x < 374 && (Math.abs(y - 168) < 3 || Math.abs(y - 312) < 3)) hidden++
    expect(hidden).toBe(0)
    // but they are there to the left and right of it
    let seen = 0
    for (const run of runs) for (const [x, y] of points(run, g.scale)) if ((x < 250 || x > 390) && (Math.abs(y - 168) < 3 || Math.abs(y - 312) < 3)) seen++
    expect(seen).toBeGreaterThan(40)
  })

  it('drops the part of a contour the same mesh hides: the far border behind a ridge', () => {
    // a wall of height 1 across a square sheet, seen from a low camera on the +x side: the sheet's far border
    // (x = -1) is behind the wall, whose own pixels are the SAME mesh, only nearer. The near border (x = 1) shows.
    const ridge = graphMesh((x) => Math.exp(-((x / 0.2) ** 2)), { half: 1, n: 60, index: 0 })
    const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 10, zoom: 150 })
    const g = meshGBuffer(640, 480, [{ mesh: ridge, mark: 0 }], { view })
    const an = contextOf(sceneOf([ridge]), view, g)
    const runs = contourRuns(an)
    const near = (a: number[], b: number[]) => {
      let n = 0
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (const run of runs) {
        for (const [x, y] of points(run, g.scale)) {
          const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (len * len)
          const d = Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1])))
          if (t > 0.05 && t < 0.95 && d < 3) n++
        }
      }
      return n
    }
    const farA = projectPoint(an, [-1, -1, 0])
    const farB = projectPoint(an, [-1, 1, 0])
    const nearA = projectPoint(an, [1, -1, 0])
    const nearB = projectPoint(an, [1, 1, 0])
    // the far border lies under the ridge's top on screen, and it is not drawn
    expect(farA[1]).toBeGreaterThan(projectPoint(an, [0, -1, 1])[1])
    expect(near(farA, farB)).toBe(0)
    // the near border is, one sample every 2 px along about 300 px
    expect(near(nearA, nearB)).toBeGreaterThan(80)
  })
})

function projectPoint(an: ReturnType<typeof contextOf>, p: number[]): [number, number] {
  const m = an.fc.vp
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
  const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
  return [((cx / w + 1) / 2) * an.fc.W, ((1 - cy / w) / 2) * an.fc.H]
}

describe('segmenting a contour by a hash of surface position', () => {
  const high = (n: number) => new Uint32Array(n).fill(0xffffffff)

  it('cuts at the maximum length when no hash falls, at a class change, and at a low hash once the stretch is long enough', () => {
    const same = new Uint8Array(100).fill(3)
    // no low hash: cut every 45 samples; the last stretch of 10 joins its neighbour
    expect(segmentRun(same, high(100), 45)).toEqual([[0, 44, 3], [45, 99, 3]])
    // a low hash at sample 30 (4 / 2^32 under 0.12) cuts there: stretches of 30 and 70 samples (the 70 then cut at 45 + 30)
    const keys = high(100)
    keys[30] = 4
    expect(segmentRun(same, keys, 45)).toEqual([[0, 29, 3], [30, 74, 3], [75, 99, 3]])
    // a low hash too soon (sample 10, under minSeg 20) is ignored
    const early = high(100)
    early[10] = 4
    expect(segmentRun(same, early, 45)).toEqual([[0, 44, 3], [45, 99, 3]])
    // a hash just over the threshold does not cut: 0.12 · 2^32 = 515,396,075
    const edge = high(100)
    edge[30] = 515396076
    expect(segmentRun(same, edge, 45)).toEqual([[0, 44, 3], [45, 99, 3]])
    edge[30] = 515396074
    expect(segmentRun(same, edge, 45)[0]).toEqual([0, 29, 3])
    // a change of class always cuts
    const mixed = Uint8Array.from([...new Array(30).fill(3), ...new Array(30).fill(1)])
    expect(segmentRun(mixed, high(60), 45)).toEqual([[0, 29, 3], [30, 59, 1]])
    // and the cuts depend on the surface position (the keys), not on where the run happens to start
    const shifted = segmentRun(same.slice(0, 80), keys.slice(0, 80), 45)
    expect(shifted[0]).toEqual([0, 29, 3])
  })
})

describe('edge strokes (spec §3.7 role 7)', () => {
  // a straight vertical edge at G column 100, from row 40 to row 79 (40 samples, one G pixel = 2 CSS px apart)
  const view = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100 })
  const toWorld = (n: number[]) => [n[2], n[0], n[1]]
  const g = makeGBuffer(view, 2, (x, y) => (x < 80 || x >= 320 || y < 60 || y >= 240 ? null : { depth: 20, normal: toWorld(x < 200 ? [-0.5, 0, 0.866] : [0.9, 0, 0.436]), value: 0, mark: 0 }))
  const scene = sceneOf([sphereMesh()])
  const noOcclusion = resolvePaintParams({ environment: { occlusion: 0 } })
  const an = () => contextOf(scene, view, g, noOcclusion)

  const run = (cls: number, contrast: number, uA = 0.9, uB = 0.3): EdgeRun => {
    const n = 40
    const pts = new Float32Array(2 * n)
    const nrm = new Float32Array(2 * n)
    for (let i = 0; i < n; i++) {
      pts[2 * i] = 100
      pts[2 * i + 1] = 40 + i
      nrm[2 * i] = -1 // inward: toward the left face
      nrm[2 * i + 1] = 0
    }
    return { a: 0, b: 1, type: 'internal', pts, nrm, h: new Float32Array(n).fill(0.5), cls: new Uint8Array(n).fill(cls), keys: new Uint32Array(n).map((_, i) => 0xffff0000 + i), uA, uB, contrast, mark: 0 }
  }

  const strokes = (cls: number, params?: PaintParams, contrast = 0.6) => {
    const ctx = params ? contextOf(scene, view, g, params) : an()
    edgeStrokes(ctx, [run(cls, contrast)])
    return ctx.drafts
  }

  it('lays a crisp loaded line along a HARD edge, a little thinner along a FIRM one', () => {
    const hard = strokes(3)
    expect(hard.length).toBe(1)
    const h = hard[0]
    expect(ROLES[h.role]).toBe('edge')
    expect(h.alpha).toBe(1)
    expect(h.edge).toBe(3)
    expect(h.wet).toBe(0) // a hard edge picks up nothing
    expect(h.endSoft).toBe(0)
    // along the edge: x = 200 CSS px (give or take the ±1 px of hand), from y = 80 to 158
    expect(Math.abs(h.path[0] - 200)).toBeLessThan(1.01)
    expect(h.path[1]).toBeCloseTo(80, 3)
    expect(h.path[2 * (PATH_POINTS - 1) + 1]).toBeCloseTo(158, 3)
    // 4 px x 0.7, loaded start x 1.15 and ±12%
    expect(h.width[0]).toBeGreaterThan(4 * 0.7 * 1.15 * 0.87)
    expect(h.width[0]).toBeLessThan(4 * 0.7 * 1.15 * 1.13)
    const firm = strokes(2)
    expect(firm.length).toBe(1)
    expect(firm[0].alpha).toBe(0.85)
    expect(firm[0].width[0]).toBeLessThan(h.width[0])
    expect(firm[0].wet).toBeCloseTo(0.2 * 0.6, 6)
    // darker than the darker side: the value 0.12 under the lower side (0.3), through the curve
    const lab = labToLch(h.lab)
    const dark = lchToLab(0.56, 0.14, 38)
    expect(lab[0]).toBeLessThan(dark[0])
  })

  it('drags a wide stroke along a SOFT edge, with short pulls from the lighter side into the darker', () => {
    const soft = strokes(1)
    // a shaft and the pulls: one per 34 CSS px of the 78 px edge
    const pulls = soft.slice(1)
    expect(soft.length).toBe(1 + Math.max(1, Math.round((39 * 2) / 34)))
    expect(soft[0].alpha).toBe(0.8)
    expect(soft[0].width[3]).toBeGreaterThan(4 * 2.6 * 0.85)
    expect(soft[0].endSoft).toBeCloseTo(0.625, 6)
    expect(soft[0].wet).toBeGreaterThanOrEqual(0.22 - 1e-9)
    for (const p of pulls) {
      expect(p.alpha).toBe(0.75)
      // across the edge: the pull is more horizontal than vertical, and runs from the lighter (left, uA 0.9) toward the darker (right)
      const dx = p.path[14] - p.path[0]
      const dy = p.path[15] - p.path[1]
      expect(Math.abs(dx)).toBeGreaterThan(Math.abs(dy) * 1.8)
      expect(dx).toBeGreaterThan(0)
      // short: the role's length (30) x 22/30 = 22 px, ±20%
      expect(Math.hypot(dx, dy)).toBeGreaterThan(22 * 0.8 - 1)
      expect(Math.hypot(dx, dy)).toBeLessThan(22 * 1.2 + 1)
    }
  })

  it('bridges both sides across a LOST edge with a few strokes, and leaves an edge below the contrast threshold alone', () => {
    const lost = strokes(0)
    expect(lost.length).toBe(Math.max(1, Math.round((39 * 2) / 42)))
    for (const l of lost) {
      expect(l.alpha).toBe(0.6)
      expect(l.edge).toBe(0)
      expect(l.wet).toBeGreaterThanOrEqual(0.32 - 1e-9)
      expect(Math.hypot(l.path[14] - l.path[0], l.path[15] - l.path[1])).toBeGreaterThan(20)
    }
    // no visible transition (contrast under detect.edgeMinContrast): no stroke at all
    expect(strokes(3, undefined, 0.04).length).toBe(0)
    expect(strokes(3, resolvePaintParams({ environment: { occlusion: 0 }, detect: { edgeMinContrast: 0.5 } }), 0.4).length).toBe(0)
    expect(strokes(3, resolvePaintParams({ environment: { occlusion: 0 }, detect: { edgeMinContrast: 0.5 } }), 0.6).length).toBe(1)
    // the role's density thins them, by a seeded draw
    expect(strokes(3, resolvePaintParams({ environment: { occlusion: 0 }, roles: { edge: { density: 0 } } })).length).toBe(0)
  })

  // The world points of an edge's path are what the camera's movement re-projects: each at the depth of the surface under
  // IT (the nearest of its own 3 x 3 G-buffer pixels), so the decal follows the relief it was traced on. One depth for
  // the whole path (the nearest of all) lifted every point on a farther part of the surface off it, and the re-projected
  // frame then hid or clipped those edges the moment the camera moved.
  describe('the world path of an edge stroke', () => {
    const viewDepth = (w: Float32Array, q: number) => (w[3 * q] - view.eye[0]) * view.viewDir[0] + (w[3 * q + 1] - view.eye[1]) * view.viewDir[1] + (w[3 * q + 2] - view.eye[2]) * view.viewDir[2]
    // the same face, its depth growing down the screen by 0.01 a CSS px (a surface tilted away at the bottom)
    const tilted = (from = 60) => makeGBuffer(view, 2, (x, y) => (x < 80 || x >= 320 || y < from || y >= 240 ? null : { depth: 20 + 0.01 * y, normal: toWorld([-0.5, 0, 0.866]), value: 0, mark: 0 }))
    const draft = (g: GBuffer) => {
      const ctx = contextOf(scene, view, g, noOcclusion)
      edgeStrokes(ctx, [run(3, 0.6)])
      return ctx.drafts[0]
    }

    it('puts each point at the nearest depth of its own 3 x 3 G-buffer pixels: here the row above it, a hand-computed 0.01 x 2 CSS px nearer than its own', () => {
      const g = tilted()
      const d = draft(g)
      expect(d.world).toBeDefined()
      const seen: number[] = []
      for (let q = 0; q < PATH_POINTS; q++) {
        const gy = Math.floor(d.path[2 * q + 1] / 2)
        // the pixel row gy - 1 is the nearest of rows gy - 1 .. gy + 1; its centre is at CSS y (gy - 1 + 0.5) x 2
        const expected = 20 + 0.01 * ((gy - 1 + 0.5) * 2)
        expect(viewDepth(d.world!, q), `point ${q}`).toBeCloseTo(expected, 3)
        seen.push(viewDepth(d.world!, q))
      }
      // the path runs 78 px down the surface: a decal of one depth would have all eight the same
      expect(seen[PATH_POINTS - 1] - seen[0]).toBeGreaterThan(0.5)
      for (let q = 1; q < PATH_POINTS; q++) expect(seen[q]).toBeGreaterThan(seen[q - 1])
    })

    it('does not follow an occlusion boundary: across a jump of 5 in depth the decal is anchored to the nearer side and may change by DECAL_SLOPE a step', () => {
      // a face at depth 20 down to CSS y 120, and the surface behind it at 25 from there (a pull from a figure into the table)
      const jump = makeGBuffer(view, 2, (x, y) => (x < 80 || x >= 320 || y < 60 || y >= 240 ? null : { depth: y < 120 ? 20 : 25, normal: toWorld([-0.5, 0, 0.866]), value: 0, mark: 0 }))
      const d = draft(jump)
      const depths = Array.from({ length: PATH_POINTS }, (_, q) => viewDepth(d.world!, q))
      expect(DECAL_SLOPE).toBe(2)
      // the path is 78 px long in 7 steps; the view is orthographic at 100 px a unit: a step of 11.14 px is 0.1114 of a unit,
      // so the depth may change by 2 x 0.1114 = 0.2229 a step. Points 0 .. 3 lie on the face (CSS y 80 .. 113), the rest in front of the jump.
      const step = (DECAL_SLOPE * (78 / 7)) / 100
      for (let q = 0; q < 4; q++) expect(depths[q], `point ${q}`).toBeCloseTo(20, 3)
      for (let q = 4; q < PATH_POINTS; q++) expect(depths[q], `point ${q}`).toBeCloseTo(20 + (q - 3) * step, 3)
      // and never the 5 the far surface is at
      expect(Math.max(...depths)).toBeLessThan(21)
    })

    it('gives a point with no surface of its own within a pixel the nearest depth of the path, and a path with none the mean depth of what is drawn', () => {
      // nothing is drawn above CSS y 120: the first points of the path (CSS y 80 ...) have no surface within a pixel
      const d = draft(tilted(120))
      const own: number[] = []
      for (let q = 0; q < PATH_POINTS; q++) own.push(viewDepth(d.world!, q))
      const nearest = Math.min(...own)
      // the path's points are at CSS y 80 + 78 q / 7: the first with a surface within a pixel is q = 4 (y 124.6, G row 62, so
      // its rows 61 .. 63), whose nearest row is 61: CSS y 123, depth 21.23
      expect(nearest).toBeCloseTo(20 + 0.01 * 123, 3)
      // the points before it (q 0 .. 3, CSS y under 116) all take that
      let before = 0
      for (let q = 0; q < PATH_POINTS; q++) {
        if (d.path[2 * q + 1] < 116) {
          before++
          expect(own[q], `point ${q}`).toBeCloseTo(nearest, 3)
        }
      }
      expect(before).toBe(4)
      // an edge with no surface anywhere near it: the mean depth of what is drawn (a face far to the right of the edge)
      const far = makeGBuffer(view, 2, (x, y) => (x < 300 || x >= 320 || y < 60 || y >= 240 ? null : { depth: 25, normal: toWorld([-0.5, 0, 0.866]), value: 0, mark: 0 }))
      const lost = draft(far)
      for (let q = 0; q < PATH_POINTS; q++) expect(viewDepth(lost.world!, q), `point ${q}`).toBeCloseTo(25, 3)
    })
  })

  it('takes a silhouette’s outer colour from the canvas, and an internal edge’s from the plane across', () => {
    const sil = an()
    const r = run(1, 0.6)
    r.type = 'silhouette'
    r.b = -1
    edgeStrokes(sil, [r])
    // the soft shaft is a mix of the figure's colour and the canvas tone (L 0.93): lighter than the inner side alone
    const innerOnly = an()
    const r2 = run(1, 0.6)
    edgeStrokes(innerOnly, [r2])
    expect(sil.drafts[0].lab[0]).toBeGreaterThan(innerOnly.drafts[0].lab[0] - 0.2)
    expect(Number.isFinite(sil.drafts[0].lab[0])).toBe(true)
  })
})
