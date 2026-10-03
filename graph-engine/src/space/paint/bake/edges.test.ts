import { describe, expect, it, vi } from 'vitest'
import { type PaintParams } from '../params'
import { clamp } from '../model/math'
import { edgeClassOf } from '../model/edges'
import { lineMark, pointMark, quadMesh, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import { buildWorldEdges, edgeClassAlong, EDGE_STEP_PX, type WorldEdgeRun, type WorldEdges } from './edges'
import { buildWorldPlan } from './plan'
import { buildWorldPlanes } from './planes'
import { locate, type SurfacePoint } from './surface'
import { at, bake, bakeFigure, boxMesh, bytes, classes, framing, FRONT, LIGHT, meanH, P, PX, runsOf, SPHERE_SCENE } from './edgesFixture'

// A plan over a refined surface is heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 120_000 })

const STEP = EDGE_STEP_PX * PX
const CELL = 12 * PX // a refined cell of the plan, away from the boundaries
const BASE = bake(SPHERE_SCENE, LIGHT)

describe('the terminator of a sphere under the lab’s light', () => {
  const { plan, planes, edges } = BASE
  const term = runsOf(edges, 'terminator')

  it('is one closed loop of samples every 2 px, N·L within half the softness (and a hair) at every sample, on the sphere, side 0, kind 0', () => {
    expect(term.length).toBe(1)
    const r = term[0]
    const n = r.h.length
    expect(r.closed).toBe(true)
    expect(r.mark).toBe(0)
    expect(r.side).toBe(0)
    expect(r.kind).toBe(0)
    expect(n).toBeGreaterThan(400) // a great circle of 2π at 2 px a step: 471
    // the last sample is one step before the first
    const gap = Math.hypot(r.pts[0] - r.pts[3 * (n - 1)], r.pts[1] - r.pts[3 * (n - 1) + 1], r.pts[2] - r.pts[3 * (n - 1) + 2])
    expect(gap).toBeLessThan(1.2 * STEP)
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(r.pts[3 * i] - r.pts[3 * i - 3], r.pts[3 * i + 1] - r.pts[3 * i - 2], r.pts[3 * i + 2] - r.pts[3 * i - 1])
      expect(d, `step ${i}`).toBeLessThan(1.2 * STEP)
      expect(d, `step ${i}`).toBeGreaterThan(0.7 * STEP)
    }
    const ts = P.value.terminatorSoftness
    for (let i = 0; i < n; i++) {
      const p = at(plan, 0, r, i)
      expect(Math.abs(p.nl), `sample ${i}`).toBeLessThanOrEqual(ts / 2 + 0.03)
      // on the surface of the sphere to the chord of a refined triangle
      expect(Math.abs(Math.hypot(r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2]) - 1)).toBeLessThan(0.01)
    }
    // every field is as long as the run
    expect(r.nrm.length).toBe(3 * n)
    expect(r.across.length).toBe(3 * n)
    for (const a of [r.keys, r.planeA, r.planeB, r.uA, r.uB, r.h, r.cls]) expect(a.length).toBe(n)
  })

  it('has the side’s outward unit normal, and `across` a unit vector in the tangent plane from the lit side A to the shadow side B', () => {
    const r = term[0]
    for (let i = 0; i < r.h.length; i++) {
      const px = r.pts[3 * i]
      const py = r.pts[3 * i + 1]
      const pz = r.pts[3 * i + 2]
      const len = Math.hypot(px, py, pz)
      const n = [r.nrm[3 * i], r.nrm[3 * i + 1], r.nrm[3 * i + 2]]
      const a = [r.across[3 * i], r.across[3 * i + 1], r.across[3 * i + 2]]
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5)
      expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 5)
      expect((n[0] * px + n[1] * py + n[2] * pz) / len).toBeGreaterThan(0.99) // outward: side +1 of a closed mesh is its outside
      expect(Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2])).toBeLessThan(1e-4)
      // from the light toward the dark
      expect(a[0] * LIGHT[0] + a[1] * LIGHT[1] + a[2] * LIGHT[2]).toBeLessThan(0)
      expect(r.uA[i]).toBeGreaterThan(r.uB[i])
      // the planes on its two sides are those of the light family and of the form shadow
      expect(planes.planes[r.planeA[i]].fam).toBe(0)
      expect(planes.planes[r.planeB[i]].fam).toBe(1)
    }
    expect(r.contrast).toBeGreaterThan(0.15)
  })

  it('has a key per sample that is the model’s position hash: the same cell (a seventh of a unit), the same key, and nearly every cell its own', () => {
    const r = term[0]
    const cell = (i: number) => `${Math.round(r.pts[3 * i] * 7)},${Math.round(r.pts[3 * i + 1] * 7)},${Math.round(r.pts[3 * i + 2] * 7)}`
    const byCell = new Map<string, number>()
    for (let i = 0; i < r.h.length; i++) {
      const key = byCell.get(cell(i))
      if (key === undefined) byCell.set(cell(i), r.keys[i])
      else expect(r.keys[i]).toBe(key)
    }
    expect(byCell.size).toBeGreaterThan(30)
    // (the model's 32-bit hash of three small integers: a few cells may share a key)
    expect(new Set(byCell.values()).size).toBeGreaterThan(0.9 * byCell.size)
  })
})

describe('the planes’ boundaries', () => {
  const { planes, edges } = BASE
  const runs = runsOf(edges, 'plane')

  it('are runs of the same mesh and side between two planes of ONE family, never between families (the iso lines are the edge there), kind 0, A the lower plane', () => {
    expect(runs.length).toBeGreaterThan(20)
    for (const r of runs) {
      expect(r.kind).toBe(0)
      expect(r.side).toBe(0)
      expect(r.mark).toBe(0)
      for (let i = 0; i < r.h.length; i++) {
        expect(r.planeA[i]).toBe(r.planeA[0])
        expect(r.planeB[i]).toBe(r.planeB[0])
      }
      const a = planes.planes[r.planeA[0]]
      const b = planes.planes[r.planeB[0]]
      expect(r.planeA[0]).toBeLessThan(r.planeB[0])
      expect(a.fam).toBe(b.fam)
      expect(a.mark).toBe(b.mark)
      expect(a.side).toBe(b.side)
      expect(a.ground).toBe(false)
    }
    // at least a few between planes of the light family and a few of the shadow family
    expect(runs.some((r) => planes.planes[r.planeA[0]].fam === 0)).toBe(true)
    expect(runs.some((r) => planes.planes[r.planeA[0]].fam === 1)).toBe(true)
  })

  it('are smooth, samples every 2 px, at least 8 of them, on the surface, with `across` from A toward B', () => {
    let agree = 0
    let total = 0
    for (const r of runs) {
      expect(r.h.length).toBeGreaterThanOrEqual(8)
      const a = planes.planes[r.planeA[0]]
      const b = planes.planes[r.planeB[0]]
      for (let i = 0; i < r.h.length; i++) {
        expect(Math.abs(Math.hypot(r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2]) - 1)).toBeLessThan(0.01)
        if (i % 4 !== 0) continue
        // (the centre of B is across from the centre of A: the two planes are cells of a sphere, so the straight line between them is a fair guide)
        const d = (b.cx - a.cx) * r.across[3 * i] + (b.cy - a.cy) * r.across[3 * i + 1] + (b.cz - a.cz) * r.across[3 * i + 2]
        total++
        if (d > 0) agree++
      }
      for (let i = 1; i < r.h.length; i++) {
        const d = Math.hypot(r.pts[3 * i] - r.pts[3 * i - 3], r.pts[3 * i + 1] - r.pts[3 * i - 2], r.pts[3 * i + 2] - r.pts[3 * i - 1])
        expect(d).toBeLessThan(1.3 * STEP)
      }
    }
    expect(agree / total).toBeGreaterThan(0.85)
  })
})

describe('the terminator goes soft with the terminator’s softness', () => {
  // ts 1.0: the same sphere and light, the terminator a wide ramp
  const soft: PaintParams = { ...P, value: { ...P.value, terminatorSoftness: 1 } }
  const wide = bake(SPHERE_SCENE, LIGHT, soft)

  it('is soft or lost at every sample at ts 1.0 (the edge is scaled by a fifth), and the default’s is harder: the mean score is at least four times higher', () => {
    const base = runsOf(BASE.edges, 'terminator')
    const soft1 = runsOf(wide.edges, 'terminator')
    expect(soft1.length).toBe(1)
    const h1 = classes(soft1)
    expect(h1[2] + h1[3], `ts 1.0 classes lost/soft/firm/hard ${h1.join('/')}`).toBe(0)
    expect(h1[0]).toBe(soft1[0].h.length) // (a fifth of at most 0.9 is under the lost threshold)
    const h0 = classes(base)
    // the default: lost and soft, with the soft ones where the contrast is (the numbers are in the task report)
    expect(h0[1]).toBeGreaterThan(20)
    expect(meanH(base)).toBeGreaterThan(4 * meanH(soft1))
  })

  it('scales by terminatorEdgeScale: the same sample’s score at 0.2 is half of its score at 0.1 (the scale is 0.1 / ts), the noise and the terms being the same', () => {
    const half: PaintParams = { ...P, value: { ...P.value, terminatorSoftness: 0.2 } }
    const mid = bake(SPHERE_SCENE, LIGHT, half)
    // (the plan differs a little with the softness, so compare means: a half, within 25%)
    const ratio = meanH(runsOf(mid.edges, 'terminator')) / meanH(runsOf(BASE.edges, 'terminator'))
    expect(ratio).toBeGreaterThan(0.35)
    expect(ratio).toBeLessThan(0.7)
  })
})

describe('a pole and a seam on the terminator', () => {
  it('has one closed loop where the terminator passes through the poles (a light on the horizon) and across the longitude seam', () => {
    const scene = sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 })])
    const { edges } = bake(scene, worldLight(30, 0))
    const t = runsOf(edges, 'terminator')
    expect(t.length).toBe(1)
    expect(t[0].closed).toBe(true)
    expect(t[0].h.length).toBeGreaterThan(400)
  })
})

describe('the cast shadow on the table', () => {
  // a sphere on the table, the light 40 degrees up
  const L = worldLight(30, 40)
  const sphereOnTable = bake(SPHERE_SCENE, L)

  it('has a shadow run on the table, kind 2, every sample within two refined cells of the analytic outline of the sphere’s shadow', () => {
    const runs = runsOf(sphereOnTable.edges, 'shadow').filter((r) => r.mark === 1)
    expect(runs.length).toBeGreaterThanOrEqual(1)
    let samples = 0
    let worst = 0
    for (const r of runs) {
      expect(r.kind).toBe(2)
      expect(r.side).toBe(1)
      for (let i = 0; i < r.h.length; i++) {
        samples++
        // the table's side +1 faces up, on the plane z = -1
        expect(Math.abs(r.pts[3 * i + 2] + 1)).toBeLessThan(1e-9)
        // the shadow of the unit sphere at the origin is the cylinder of radius 1 about the line along the light: the distance from the point to that line
        const px = r.pts[3 * i]
        const py = r.pts[3 * i + 1]
        const pz = r.pts[3 * i + 2]
        const cx = py * L[2] - pz * L[1]
        const cy = pz * L[0] - px * L[2]
        const cz = px * L[1] - py * L[0]
        worst = Math.max(worst, Math.abs(Math.hypot(cx, cy, cz) - 1))
      }
    }
    expect(samples).toBeGreaterThan(300)
    expect(worst).toBeLessThan(2 * CELL)
    // and it closes round the shadow
    expect(runs.some((r) => r.closed)).toBe(true)
  })

  it('has the lit table on the A side, the shadow on the B side', () => {
    const r = runsOf(sphereOnTable.edges, 'shadow').filter((x) => x.mark === 1)[0]
    for (let i = 0; i < r.h.length; i += 3) {
      expect(r.uA[i]).toBeGreaterThan(r.uB[i])
      // across points into the shadow: away from the light's horizontal direction, ±
      expect(sphereOnTable.planes.planes[r.planeA[i]].cast).toBe(false)
      expect(sphereOnTable.planes.planes[r.planeB[i]].cast).toBe(true)
    }
  })

  it('has the edge softer the farther it is from what casts it: a tall thin box casts a long shadow, and the samples whose occluder is in the top third of the distances are softer than those in the bottom third', () => {
    const scene = sceneOf([boxMesh([-0.1, -0.1, -1], [0.1, 0.1, 1.5], 0), tableMesh({ z: -1, half: 3, index: 1 })])
    const box = bake(scene, L)
    const rows: [number, number][] = []
    for (const r of runsOf(box.edges, 'shadow').filter((x) => x.mark === 1)) {
      expect(r.kind).toBe(2)
      for (let i = 0; i < r.h.length; i++) rows.push([at(box.plan, 1, r, i).shadowDist / PX, r.h[i]])
    }
    rows.sort((a, b) => a[0] - b[0])
    expect(rows.length).toBeGreaterThan(300)
    const third = Math.floor(rows.length / 3)
    const mean = (a: [number, number][]) => a.reduce((s, x) => s + x[1], 0) / a.length
    const near = mean(rows.slice(0, third))
    const far = mean(rows.slice(-third))
    expect(rows[0][0]).toBeLessThan(40) // at the box's foot the occluder is at hand
    expect(rows[rows.length - 1][0]).toBeGreaterThan(300) // and the tip of its shadow is 300 px from it
    expect(far).toBeLessThan(near)
    // the occluder-distance term is part of it: without it (wShadowDist 0) the gap is smaller
    const noX: PaintParams = { ...P, edges: { ...P.edges, wShadowDist: 0 } }
    const edges0 = buildWorldEdges(box.plan, box.planes, noX, scene, FRONT)
    const rows0: [number, number][] = []
    for (const r of runsOf(edges0, 'shadow').filter((x) => x.mark === 1)) for (let i = 0; i < r.h.length; i++) rows0.push([at(box.plan, 1, r, i).shadowDist / PX, r.h[i]])
    rows0.sort((a, b) => a[0] - b[0])
    const gap0 = mean(rows0.slice(0, third)) - mean(rows0.slice(-third))
    expect(near - far - gap0).toBeGreaterThan(0.05)
  })
})

describe('creases and borders', () => {
  it('has a border run per side of an open sheet, split at its corners: kind 1, A the sheet, B beyond it, the canvas', () => {
    const sheet = quadMesh({ origin: [-1, -1, 0.2], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, index: 0 })
    const { plan, edges } = bake(sceneOf([sheet]), [0.3, 0.2, 0.9])
    const borders = runsOf(edges, 'border')
    expect(borders.length).toBe(8) // four edges, two sides
    expect(edges.runs.every((r) => r.type === 'border')).toBe(true)
    expect(borders.filter((r) => r.side === 1).length).toBe(4)
    expect(borders.filter((r) => r.side === -1).length).toBe(4)
    for (const r of borders) {
      expect(r.kind).toBe(1)
      expect(r.closed).toBe(false)
      expect(r.h.length).toBeGreaterThan(100) // a side of 2 units is 300 px: 150 samples
      for (let i = 0; i < r.h.length; i += 5) {
        // on the border of the sheet: one of its four edges
        const x = r.pts[3 * i]
        const y = r.pts[3 * i + 1]
        expect(Math.min(Math.abs(Math.abs(x) - 1), Math.abs(Math.abs(y) - 1))).toBeLessThan(1e-6)
        // `across` points away from the sheet, B beyond: the canvas
        const out = r.across[3 * i] * x + r.across[3 * i + 1] * y
        expect(out).toBeGreaterThan(0.5)
        expect(r.uB[i]).toBeCloseTo(plan.uCanvas, 6)
        expect(r.planeB[i]).toBe(-1)
      }
      // the side's own normal
      expect(Math.sign(r.nrm[2])).toBe(r.side)
    }
    // the lit side against the canvas is a lighter edge than... the dark side: the contrast is where the hardness is
    const lit = borders.filter((r) => r.side === 1)
    const dark = borders.filter((r) => r.side === -1)
    expect(dark[0].contrast).toBeGreaterThan(lit[0].contrast)
    expect(meanH(dark)).toBeGreaterThan(meanH(lit))
  })

  it('has the creases of a closed flat-shaded box: kind 1, side 0, 12 edges, none of them a border, each with the contrast of the two faces', () => {
    const { edges } = bake(sceneOf([boxMesh([-1, -1, -1], [1, 1, 1], 0)]), worldLight(30, 40))
    const creases = runsOf(edges, 'crease')
    expect(creases.length).toBe(12)
    expect(runsOf(edges, 'border').length).toBe(0)
    for (const r of creases) {
      expect(r.kind).toBe(1)
      expect(r.side).toBe(0)
      expect(r.h.length).toBeGreaterThan(140)
    }
    // the normal at a crease is the bisector of its two faces: a unit vector with two non-zero components
    const r = creases[0]
    const n = [r.nrm[3 * 20], r.nrm[3 * 20 + 1], r.nrm[3 * 20 + 2]].map(Math.abs)
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5)
    expect(n.filter((v) => v > 0.1).length).toBe(2)
    // some of them are between a lit face and a dark one, and have a contrast, and some are between two faces of one value
    expect(creases.some((c) => c.contrast > 0.3)).toBe(true)
    expect(creases.some((c) => c.contrast < 0.1)).toBe(true)
    expect(Math.max(...creases.map((c) => meanH(creases.filter((x) => x === c))))).toBeGreaterThan(0.46)
  })

  it('has no run for a veil (the model’s contours skip it too)', () => {
    const veil = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, opacity: 0.4, index: 0 })
    const closedVeil = sphereMesh({ radius: 1, opacity: 0.4, nu: 24, nv: 16, index: 1 })
    const { edges } = bake(sceneOf([veil, closedVeil]), [0.1, 0.05, 1])
    expect(edges.runs.length).toBe(0)
    expect(edges.field[0]).toEqual([])
    expect(edges.field[1]).toEqual([])
    expect(Array.from(edges.focal).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('a scene with nothing to paint on', () => {
  it('has no planes, no runs, empty fields and no focal points, and reads the interior fallback from the field', () => {
    const scene = sceneOf([lineMark([[0, 0, 0], [1, 1, 1]], { index: 0 }), pointMark([[0, 0, 0]], { index: 1 })])
    const { plan, planes, edges } = bake(scene, LIGHT)
    expect(planes.planes.length).toBe(0)
    expect(planes.planeOf).toEqual([[null, null], [null, null]])
    expect(edges.runs.length).toBe(0)
    expect(edges.field).toEqual([[], []])
    expect(edges.adjHard(0, 1)).toBe(0)
    expect(Array.from(edges.focal).every((v) => Number.isNaN(v))).toBe(true)
    expect(edgeClassAlong(edges, plan, 0, 1, [{ tri: 0, b1: 0, b2: 0 }], 1, 0)).toBe(edgeClassOf(0.78, P))
  })
})

describe('the focal points: the AUTHORED view’s, fixed in the world', () => {
  const sphereOnly = bake(sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 })]), LIGHT)
  const keyOf = (f: Float64Array, k: number) => f[4 * k] * LIGHT[0] + f[4 * k + 1] * LIGHT[1] + f[4 * k + 2] * LIGHT[2]
  const dirOf = (az: number, el: number) => worldLight(az, el)

  it('are the model’s two: the terminator nearest the authored eye (s1) and the brightest (s2), 8 numbers per mark, none for the table', () => {
    const f = BASE.edges.focal
    expect(f.length).toBe(8 * 2)
    const eye = dirOf(20, 25) // FRONT's eye direction
    for (let k = 0; k < 2; k++) {
      expect(Math.hypot(f[4 * k], f[4 * k + 1], f[4 * k + 2])).toBeCloseTo(1, 1)
    }
    // s1: on the terminator's plateau (N·L of about 0.26 to 0.3 where the model's score peaks: smooth(0.1, 0.26, key)·(1 - smooth(0.3, 0.5, key))), on the
    // side the authored eye sees, and nearest it
    expect(keyOf(f, 0)).toBeGreaterThan(0.24)
    expect(keyOf(f, 0)).toBeLessThan(0.32)
    expect(f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]).toBeGreaterThan(0.85)
    // s2: the brightest, facing the light
    expect(keyOf(f, 1)).toBeGreaterThan(0.98)
    for (let k = 8; k < 16; k++) expect(Number.isNaN(f[k])).toBe(true)
  })

  it('moves with the authored eye, along the terminator: another eye, another s1, on the same plateau and facing that eye', () => {
    const e2 = framing(100, 15)
    const f1 = BASE.edges.focal
    const f2 = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, e2).focal
    const moved = Math.hypot(f1[0] - f2[0], f1[1] - f2[1], f1[2] - f2[2])
    expect(moved).toBeGreaterThan(0.5)
    expect(keyOf(f2, 0)).toBeGreaterThan(0.24)
    expect(keyOf(f2, 0)).toBeLessThan(0.32)
    const d = dirOf(100, 15)
    expect(f2[0] * d[0] + f2[1] * d[1] + f2[2] * d[2]).toBeGreaterThan(0.7)
    // an eye on the other side of the sphere sees the other side of the terminator
    const f3 = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, framing(-120, 20)).focal
    expect(f3[0] * f1[0] + f3[1] * f1[1] + f3[2] * f1[2]).toBeLessThan(0.5)
    // (the highlight is the light's, wherever the eye is)
    expect(keyOf(f3, 1)).toBeGreaterThan(0.95)
  })

  // Whether the authored view sees the side a run's sample is on (its normal toward the eye).
  const seenBy = (a: ReturnType<typeof framing>, r: WorldEdgeRun, i: number): boolean => {
    let tx = -a.viewDir[0]
    let ty = -a.viewDir[1]
    let tz = -a.viewDir[2]
    if (!a.ortho) {
      tx = a.eye[0] - r.pts[3 * i]
      ty = a.eye[1] - r.pts[3 * i + 1]
      tz = a.eye[2] - r.pts[3 * i + 2]
    }
    return r.nrm[3 * i] * tx + r.nrm[3 * i + 1] * ty + r.nrm[3 * i + 2] * tz > 0
  }
  // The mean hardness of the terminator samples the authored view sees and of those it does not.
  const seenMeans = (e: WorldEdges, a: ReturnType<typeof framing>): { seen: number; unseen: number } => {
    const s = [0, 0]
    const n = [0, 0]
    for (const r of runsOf(e, 'terminator')) for (let i = 0; i < r.h.length; i++) {
      const k = seenBy(a, r, i) ? 0 : 1
      s[k] += r.h[i]
      n[k]++
    }
    return { seen: s[0] / n[0], unseen: s[1] / n[1] }
  }

  it('makes the terminator firmer where the authored eye looks at it: soft within R of s1, and the samples the authored view sees are harder than those it does not (the focal point and the depth term)', () => {
    const t = runsOf(BASE.edges, 'terminator')[0]
    const f = BASE.edges.focal
    const R = f[3]
    let near = 0
    let nearSoft = 0
    for (let i = 0; i < t.h.length; i++) {
      const d = Math.hypot(t.pts[3 * i] - f[0], t.pts[3 * i + 1] - f[1], t.pts[3 * i + 2] - f[2])
      if (d >= R) continue
      near++
      if (t.cls[i] >= 1) nearSoft++
    }
    expect(near).toBeGreaterThan(40)
    expect(nearSoft).toBeGreaterThanOrEqual(0.9 * near)
    const m = seenMeans(BASE.edges, FRONT)
    expect(m.seen).toBeGreaterThan(1.4 * m.unseen)
    // a smooth sphere's terminator is soft: soft where the eye looks, lost elsewhere, a few firm accents at most (the histogram is in the task report)
    const h = classes([t])
    expect(h[1]).toBeGreaterThan(0.2 * t.h.length)
    expect(h[2] + h[3]).toBeLessThan(0.1 * t.h.length)
    // the focal point alone (no depth term): the same stretch soft and nothing else, the far side all lost
    const flat = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, FRONT, { authoredDepth: false })
    const tf = runsOf(flat, 'terminator')[0]
    let farSoft = 0
    for (let i = 0; i < tf.h.length; i++) {
      if (Math.hypot(tf.pts[3 * i] - f[0], tf.pts[3 * i + 1] - f[1], tf.pts[3 * i + 2] - f[2]) > 2 * R && tf.cls[i] >= 1) farSoft++
    }
    expect(farSoft).toBe(0)
    expect(classes([tf])[2] + classes([tf])[3]).toBe(0)
    expect(meanH([t])).toBeGreaterThan(meanH([tf])) // the depth term only makes the terminator harder (it is added)
  })

  it('has firm samples on the torus (a turning form), the authored view’s depth term on by default: 67 of 1,534 on the lab’s torus, none without it, and the samples the view sees are harder', () => {
    const b = bakeFigure('torus')
    const h = classes(runsOf(b.edges, 'terminator'))
    expect(h[2] + h[3]).toBeGreaterThan(20)
    const off = buildWorldEdges(b.plan, b.planes, P, b.scene, b.authored, { authoredDepth: false })
    expect(classes(runsOf(off, 'terminator'))[2] + classes(runsOf(off, 'terminator'))[3]).toBe(0)
    const m = seenMeans(b.edges, b.authored)
    expect(m.seen).toBeGreaterThan(1.2 * m.unseen)
    // the depth term is the model's: nearer to the authored eye is harder, so it is the near stretch of the terminator that is firm
    const firmSeen = runsOf(b.edges, 'terminator').reduce((n, r) => n + Array.from(r.cls).filter((c, i) => c >= 2 && seenBy(b.authored, r, i)).length, 0)
    expect(firmSeen).toBe(h[2] + h[3])
  })

  it('keeps the edges.wDepth slider meaningful: the depth weight at 0 is the term taken out, and a higher weight makes the terminator harder where it is nearer the authored eye', () => {
    const noDepth: PaintParams = { ...P, edges: { ...P.edges, wDepth: [0, 0, 0] } }
    const w0 = buildWorldEdges(BASE.plan, BASE.planes, noDepth, BASE.scene, FRONT)
    const off = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, FRONT, { authoredDepth: false })
    expect(w0.runs.length).toBe(off.runs.length)
    w0.runs.forEach((r, k) => {
      expect(bytes(r.h), `run ${k}`).toBe(bytes(off.runs[k].h))
    })
    const more: PaintParams = { ...P, edges: { ...P.edges, wDepth: [0.4, 0.4, 0.4] } }
    const w4 = buildWorldEdges(BASE.plan, BASE.planes, more, BASE.scene, FRONT)
    const m1 = seenMeans(BASE.edges, FRONT)
    const m4 = seenMeans(w4, FRONT)
    expect(m4.seen - m1.seen).toBeGreaterThan(0.04)
    expect(meanH(runsOf(BASE.edges, 'terminator'))).toBeGreaterThan(meanH(runsOf(w0, 'terminator')))
  })

  it('has R = 0.55·√(A/π) with A the area the authored view sees: 0.55 on a unit sphere (within 5%) for an orthographic eye or a distant one, less for a near perspective eye', () => {
    const R = (a: ReturnType<typeof framing>) => buildWorldEdges(sphereOnly.plan, sphereOnly.planes, P, sphereOnly.scene, a).focal[3]
    expect(Math.abs(R(framing(20, 25, 8, true)) / 0.55 - 1)).toBeLessThan(0.05)
    expect(Math.abs(R(framing(20, 25, 30)) / 0.55 - 1)).toBeLessThan(0.05)
    expect(Math.abs(R(framing(200, -40, 100)) / 0.55 - 1)).toBeLessThan(0.05)
    // (a perspective eye sees less of the sphere's cosines: the lab's authored distance is about 3.9 radii)
    expect(R(framing(20, 25, 3.86))).toBeLessThan(R(framing(20, 25, 30)))
    expect(R(framing(20, 25, 3.86))).toBeGreaterThan(0.4)
  })

  it('is the only thing the framing changes: the plan, the planes and every run’s geometry, values and planes are those of any other framing, the hardness is not', () => {
    const other = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, framing(150, 60))
    expect(other.runs.length).toBe(BASE.edges.runs.length)
    let hardnessDiffers = false
    BASE.edges.runs.forEach((r, k) => {
      const q = other.runs[k]
      for (const key of ['pts', 'nrm', 'across', 'keys', 'planeA', 'planeB', 'uA', 'uB'] as const) expect(bytes(q[key]), `run ${k} ${key}`).toBe(bytes(r[key]))
      if (bytes(q.h) !== bytes(r.h)) hardnessDiffers = true
    })
    expect(hardnessDiffers).toBe(true)
    // no other function takes a view: the plan, the planes and the edge-class reader
    expect(buildWorldPlan.length).toBe(4) // scene, light, params, reference world per px (options is optional)
    expect(buildWorldPlanes.length).toBe(5) // plan, particles, colours, curve, params
    expect(edgeClassAlong.length).toBe(7)
  })
})

describe('the adjacency of planes', () => {
  const { planes, edges } = BASE

  it('is the mean hardness of the samples between two planes, symmetric', () => {
    const sums = new Map<string, { s: number; n: number }>()
    for (const r of edges.runs) {
      if (r.kind === 1) continue
      for (let i = 0; i < r.h.length; i++) {
        const a = r.planeA[i]
        const b = r.planeB[i]
        if (a < 0 || b < 0 || a === b) continue
        const key = `${Math.min(a, b)},${Math.max(a, b)}`
        const e = sums.get(key) ?? { s: 0, n: 0 }
        e.s += r.h[i]
        e.n++
        sums.set(key, e)
      }
    }
    expect(sums.size).toBeGreaterThan(40)
    let positive = 0
    for (const [key, e] of sums) {
      const [a, b] = key.split(',').map(Number)
      expect(edges.adjHard(a, b)).toBeCloseTo(e.s / e.n, 6)
      expect(edges.adjHard(b, a)).toBe(edges.adjHard(a, b))
      expect(edges.adjHard(a, b)).toBeGreaterThanOrEqual(0)
      if (edges.adjHard(a, b) > 0) positive++
    }
    // (an edge can score 0: the noise under a score of nothing)
    expect(positive).toBeGreaterThan(0.5 * sums.size)
  })

  it('is 0 for planes that never meet: opposite sides of the sphere, a plane and itself, the sphere’s and the table’s, none', () => {
    const sphere = planes.planes.filter((p) => p.mark === 0)
    const a = sphere[0]
    const far = sphere.reduce((best, p) => (p.nx * a.nx + p.ny * a.ny + p.nz * a.nz < best.nx * a.nx + best.ny * a.ny + best.nz * a.nz ? p : best))
    expect(far.nx * a.nx + far.ny * a.ny + far.nz * a.nz).toBeLessThan(-0.5)
    expect(edges.adjHard(a.id, far.id)).toBe(0)
    expect(edges.adjHard(far.id, a.id)).toBe(0)
    expect(edges.adjHard(a.id, a.id)).toBe(0)
    const table = planes.planes.find((p) => p.mark === 1)!
    expect(edges.adjHard(a.id, table.id)).toBe(0)
    expect(edges.adjHard(a.id, -1)).toBe(0)
    expect(edges.adjHard(-1, -1)).toBe(0)
    expect(edges.adjHard(a.id, 99999)).toBe(0)
  })
})

describe('the edge field', () => {
  const { plan, edges } = BASE
  const s = plan.surfaces[0]!
  const reach = P.detect.edgeReachPx * PX

  // the runs the field was seeded from: those whose contrast reaches the minimum
  const seeds = edges.runs.filter((r) => r.mark === 0 && r.contrast >= P.detect.edgeMinContrast)

  it('has the world distance to the nearest edge sample within the reach of 20 px, and Infinity, hardness 0 and class 255 beyond it', () => {
    expect(edges.reach).toBeCloseTo(reach, 12)
    const f = edges.field[0][0]
    expect(edges.field[0].length).toBe(1) // a closed opaque mesh: side +1 only
    expect(edges.field[1].length).toBe(2) // the table: both sides
    const nv = s.positions.length / 3
    expect(f.dist.length).toBe(nv)
    expect(seeds.length).toBeGreaterThan(3)
    let finite = 0
    let infinite = 0
    for (let v = 0; v < nv; v++) {
      // the straight-line distance to the nearest sample of a seed run
      let best = Infinity
      for (const r of seeds) {
        for (let i = 0; i < r.h.length; i++) {
          const d = Math.hypot(s.positions[3 * v] - r.pts[3 * i], s.positions[3 * v + 1] - r.pts[3 * i + 1], s.positions[3 * v + 2] - r.pts[3 * i + 2])
          if (d < best) best = d
        }
      }
      if (Number.isFinite(f.dist[v])) {
        finite++
        // (along the surface's edges: never shorter than the straight line, and within the reach)
        expect(f.dist[v], `vertex ${v}`).toBeGreaterThanOrEqual(best - 1e-5)
        expect(f.dist[v]).toBeLessThanOrEqual(reach + 1e-9)
        expect(f.cls[v]).toBeLessThanOrEqual(3)
        expect(f.hard[v]).toBeGreaterThanOrEqual(0)
        expect(f.hard[v]).toBeLessThanOrEqual(1)
      } else {
        infinite++
        expect(f.cls[v]).toBe(255)
        expect(f.hard[v]).toBe(0)
        // a vertex that is well within the reach of a sample is found (the surface's edges are at most 1.5 times the straight line)
        expect(best, `vertex ${v}`).toBeGreaterThan(0.45 * reach)
      }
    }
    expect(finite).toBeGreaterThan(500)
    expect(infinite).toBeGreaterThan(500)
  })

  it('has at a seed sample’s own triangle the distance to the sample, and its hardness and class', () => {
    const f = edges.field[0][0]
    const r = seeds.find((x) => x.type === 'terminator')!
    const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    for (let i = 0; i < r.h.length; i += 40) {
      expect(locate(s, r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2], 0, 0, 0, 1e-6, p)).toBe(true)
      let nearest = Infinity
      for (let k = 0; k < 3; k++) {
        const v = s.indices[3 * p.tri + k]
        expect(f.dist[v]).toBeLessThan(0.3 * reach) // a cell is at most 12 px
        nearest = Math.min(nearest, f.dist[v])
      }
      expect(nearest).toBeLessThan(6 * PX)
    }
  })

  it('reads as the model’s strokeEdgeClass: the nearest edge’s class near an edge, the interior fallback 0.52 + 0.26·light − 0.28·shadow away from them', () => {
    const f = edges.field[0][0]
    const r = seeds.find((x) => x.type === 'terminator')!
    const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    // on a terminator sample: the class of the field there (the heaviest vertex's), whatever the light and the shadow
    let compared = 0
    for (let i = 0; i < r.h.length; i += 25) {
      expect(locate(s, r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2], 0, 0, 0, 1e-6, p)).toBe(true)
      const w = [1 - p.b1 - p.b2, p.b1, p.b2]
      const vs = [0, 1, 2].map((k) => s.indices[3 * p.tri + k])
      const heaviest = w.indexOf(Math.max(...w))
      const cls = edgeClassAlong(edges, plan, 0, 1, [p], 0.5, 0.5)
      expect(cls).toBe(f.cls[vs[heaviest]])
      expect(cls).toBeLessThanOrEqual(3)
      compared++
    }
    expect(compared).toBeGreaterThan(5)
    // a path of several points: the nearest of them counts
    const far: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    expect(locate(s, r.pts[0], r.pts[1], r.pts[2], 0, 0, 0, 1e-6, far)).toBe(true)
    expect(edgeClassAlong(edges, plan, 0, 1, [far, far, far], 0, 1)).toBe(edgeClassAlong(edges, plan, 0, 1, [far], 0.9, 0.1))
    // far from every edge: a vertex with no edge in reach, and the table far from the sphere
    let lone = -1
    for (let v = 0; v < f.dist.length; v++) {
      if (!Number.isFinite(f.dist[v])) {
        lone = v
        break
      }
    }
    expect(lone).toBeGreaterThanOrEqual(0)
    const tri = (() => {
      for (let t = 0; t < s.indices.length / 3; t++) for (let k = 0; k < 3; k++) if (s.indices[3 * t + k] === lone) return { tri: t, b1: k === 1 ? 1 : 0, b2: k === 2 ? 1 : 0 }
      return { tri: 0, b1: 0, b2: 0 }
    })()
    for (const [light, shadow] of [[1, 0], [0, 1], [0.5, 0.5], [-5, 5], [5, -5], [0.3, 0.8]]) {
      const interior = clamp(0.52 + 0.26 * light - 0.28 * shadow, 0.1, 0.9)
      expect(edgeClassAlong(edges, plan, 0, 1, [tri], light, shadow), `light ${light} shadow ${shadow}`).toBe(edgeClassOf(interior, P))
    }
    // the closed mesh has only side +1: side -1 reads it
    expect(edgeClassAlong(edges, plan, 0, -1, [tri], 1, 0)).toBe(edgeClassAlong(edges, plan, 0, 1, [tri], 1, 0))
  })
})

describe('what the edges read', () => {
  it('takes no view, no camera and no G-buffer: the plan, the planes, the params and the scene’s own meshes (for their creases)', () => {
    expect(buildWorldEdges.length).toBe(5) // plan, planes, params, scene, authored (options is optional)
    expect(buildWorldPlanes.length).toBe(5) // plan, particles, colours, curve, params
    expect(edgeClassAlong.length).toBe(7)
  })

  it('moves with the light: another light gives other terminator runs (and not the same samples)', () => {
    const other = bake(SPHERE_SCENE, worldLight(120, 25))
    const a = runsOf(BASE.edges, 'terminator')[0]
    const b = runsOf(other.edges, 'terminator')[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    // the terminator is the great circle ⟂ L: its samples have N·L = 0 for their own light only
    const dot = (r: WorldEdgeRun, L: number[], i: number) => r.pts[3 * i] * L[0] + r.pts[3 * i + 1] * L[1] + r.pts[3 * i + 2] * L[2]
    const Lb = worldLight(120, 25)
    let worstA = 0
    let worstB = 0
    for (let i = 0; i < a.h.length; i++) worstA = Math.max(worstA, Math.abs(dot(a, LIGHT, i)))
    for (let i = 0; i < b.h.length; i++) worstB = Math.max(worstB, Math.abs(dot(b, Lb, i)))
    expect(worstA).toBeLessThan(0.02)
    expect(worstB).toBeLessThan(0.02)
    let far = 0
    for (let i = 0; i < b.h.length; i++) far = Math.max(far, Math.abs(dot(b, LIGHT, i)))
    expect(far).toBeGreaterThan(0.3)
  })
})

describe('the sides’ values', () => {
  it('reads the planes’ means by default and the probes’ plan values on request: the probes see little of a smooth ramp (the plane boundaries have almost no contrast), the means the step', () => {
    const probes = buildWorldEdges(BASE.plan, BASE.planes, P, BASE.scene, FRONT, { sideValues: 'probes' })
    const planeRuns = (e: WorldEdges) => runsOf(e, 'plane')
    const meanContrast = (rs: WorldEdgeRun[]) => rs.reduce((s, r) => s + r.contrast * r.h.length, 0) / rs.reduce((s, r) => s + r.h.length, 0)
    expect(meanContrast(planeRuns(probes))).toBeLessThan(0.02)
    expect(meanContrast(planeRuns(BASE.edges))).toBeGreaterThan(0.03)
    expect(runsOf(probes, 'terminator')[0].contrast).toBeLessThan(runsOf(BASE.edges, 'terminator')[0].contrast)
    // a crease or a border reads its probes either way
    const sheet = quadMesh({ origin: [-1, -1, 0.2], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, index: 0 })
    const b = bake(sceneOf([sheet]), [0.3, 0.2, 0.9])
    const b2 = buildWorldEdges(b.plan, b.planes, P, b.scene, FRONT, { sideValues: 'probes' })
    expect(bytes(b2.runs[0].h)).toBe(bytes(b.edges.runs[0].h))
  })
})

describe('determinism', () => {
  it('gives byte-identical runs, planes and field on two bakes', () => {
    const again = bake(SPHERE_SCENE, LIGHT)
    expect(JSON.stringify(again.planes.planes)).toBe(JSON.stringify(BASE.planes.planes))
    expect(again.edges.runs.length).toBe(BASE.edges.runs.length)
    BASE.edges.runs.forEach((r, k) => {
      const q = again.edges.runs[k]
      expect([q.type, q.mark, q.side, q.kind, q.closed, q.contrast]).toEqual([r.type, r.mark, r.side, r.kind, r.closed, r.contrast])
      for (const key of ['pts', 'nrm', 'across', 'keys', 'planeA', 'planeB', 'uA', 'uB', 'h', 'cls'] as const) expect(bytes(q[key]), `run ${k} ${key}`).toBe(bytes(r[key]))
    })
    BASE.edges.field.forEach((sides, m) => {
      expect(again.edges.field[m].length).toBe(sides.length)
      sides.forEach((f, k) => {
        for (const key of ['dist', 'hard', 'cls'] as const) expect(bytes(again.edges.field[m][k][key]), `field ${m} ${k} ${key}`).toBe(bytes(f[key]))
      })
    })
    expect(bytes(again.edges.focal)).toBe(bytes(BASE.edges.focal))
  })
})
