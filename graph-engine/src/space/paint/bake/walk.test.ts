import { describe, expect, it, vi } from 'vitest'
import { quadMesh, flatColours } from '../model/testing'
import { terminatorValueOf } from '../model/roles'
import { Z_CAST } from '../model/value'
import { BAKE_PATH_POINTS } from './types'
import { bakeStats } from './index'
import { newPlanAt, planAt } from './plan'
import { refineSurface, locate, normalOf, pointOf, type SurfacePoint } from './surface'
import { snapNear, WALK_STEPS, walkStroke, resampleWalk, type WalkSide, type WalkSpec } from './walk'
import { fixture, flatSaddleScene, P, saddleColours, sphereColours, sphereScene, sparse, veilScene } from './bakeFixture'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

// The test sphere sits on a table and is painted at a light density (the lab's scale is the bench's).
const TS = P.value.terminatorSoftness
const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const SPHERE_PLAN = bakeStats(SPHERE.baked)!.plan
const SADDLE = fixture(flatSaddleScene(), saddleColours(), sparse(1200))
const VEILS = fixture(veilScene(), flatColours({ 0: [0.6, 0.05, 0.05], 1: [0.7, 0, 0] }), sparse(900))

// How far (world) the baked path points are from the refined surface of their own mark: the worst of all of them.
function worstOffSurface(f: ReturnType<typeof fixture>): { worst: number; checked: number; missed: number; size: number } {
  const { baked } = f
  const plan = bakeStats(baked)!.plan
  let worst = 0
  let size = 0
  for (const s of plan.surfaces) {
    if (!s) continue
    const b = s.bvh.bounds
    size = Math.max(size, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]))
  }
  const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  let checked = 0
  let missed = 0
  for (let i = 0; i < baked.count; i++) {
    const s = plan.surfaces[baked.mark[i]]!
    for (let q = 0; q < BAKE_PATH_POINTS; q++) {
      const o = 3 * (BAKE_PATH_POINTS * i + q)
      if (!locate(s, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 1e-3 * size, hit)) missed++
      else worst = Math.max(worst, hit.dist ?? 0)
      checked++
    }
  }
  return { worst, checked, missed, size }
}

describe('the baked walk: paths on the surface', () => {
  it('puts every path point of every surface stroke on the refined surface of its own mark (within 1e-5 of the scene size), on a sphere and a table, an open saddle and a veil', () => {
    for (const f of [SPHERE, SADDLE, VEILS]) {
      const { worst, checked, missed, size } = worstOffSurface(f)
      expect(checked).toBeGreaterThan(5000)
      expect(missed, `scene of size ${size}`).toBe(0)
      // (the points are stored as Float32: a rounding of 6e-8 of the coordinate)
      expect(worst, `scene of size ${size}`).toBeLessThanOrEqual(1e-5 * size)
    }
  })

  it('never crosses from one mark to another: a stroke of the sphere stays on the sphere (its facets, within their sagitta of radius 1) and one of the table on the table (z = -1)', () => {
    const { baked } = SPHERE
    let onSphere = 0
    let onTable = 0
    let rMin = Infinity
    let rMax = 0
    let zErr = 0
    for (let i = 0; i < baked.count; i++) {
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        if (baked.mark[i] === 0) {
          const r = Math.hypot(baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2])
          rMin = Math.min(rMin, r)
          rMax = Math.max(rMax, r)
          onSphere++
        } else {
          zErr = Math.max(zErr, Math.abs(baked.worldPath[o + 2] + 1))
          onTable++
        }
      }
    }
    expect(onSphere).toBeGreaterThan(1000)
    expect(onTable).toBeGreaterThan(1000)
    // (a 36 x 24 sphere: its facets lie inside the sphere by a sagitta of 0.4% and the quad's diagonal a hair more)
    expect(rMax).toBeLessThanOrEqual(1 + 1e-6)
    expect(rMin).toBeGreaterThanOrEqual(0.99)
    expect(zErr).toBeLessThanOrEqual(1e-6)
  })

  it('has the side’s unit normal at every path point, facing the way the stroke’s side faces (outward on the closed sphere, ±z on the table)', () => {
    const { baked } = SPHERE
    let unit = 0
    let facing = 1
    for (let i = 0; i < baked.count; i++) {
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        const nx = baked.worldNormal[o], ny = baked.worldNormal[o + 1], nz = baked.worldNormal[o + 2]
        unit = Math.max(unit, Math.abs(Math.hypot(nx, ny, nz) - 1))
        const f = baked.mark[i] === 0 ? nx * baked.worldPath[o] + ny * baked.worldPath[o + 1] + nz * baked.worldPath[o + 2] : nz * baked.side[i]
        facing = Math.min(facing, f)
      }
    }
    expect(unit).toBeLessThanOrEqual(1e-5)
    expect(facing).toBeGreaterThan(0.99)
  })

  it('spaces the path points at near-equal arc length on the sphere (the chords of most strokes within a few percent: a curl of the iso field shortens a chord), and its arc length is the chords’ sum', () => {
    const { baked } = SPHERE
    const spread: number[] = []
    let sumErr = 0
    let anchorOut = 0
    for (let i = 0; i < baked.count; i++) {
      if (baked.mark[i] !== 0) continue
      let mn = Infinity
      let mx = 0
      let sum = 0
      for (let q = 1; q < BAKE_PATH_POINTS; q++) {
        const a = 3 * (BAKE_PATH_POINTS * i + q - 1)
        const c = Math.hypot(baked.worldPath[a + 3] - baked.worldPath[a], baked.worldPath[a + 4] - baked.worldPath[a + 1], baked.worldPath[a + 5] - baked.worldPath[a + 2])
        mn = Math.min(mn, c)
        mx = Math.max(mx, c)
        sum += c
      }
      spread.push((mx - mn) / (sum / (BAKE_PATH_POINTS - 1)))
      sumErr = Math.max(sumErr, Math.abs(sum - baked.pathLength[i]))
      if (!(baked.anchor[i] >= 0 && baked.anchor[i] <= 1)) anchorOut++
    }
    spread.sort((a, b) => a - b)
    expect(spread.length).toBeGreaterThan(1000)
    expect(spread[Math.floor(spread.length / 2)]).toBeLessThanOrEqual(0.05)
    expect(spread[Math.floor(0.95 * spread.length)]).toBeLessThanOrEqual(0.2)
    expect(sumErr).toBeLessThanOrEqual(1e-4)
    expect(anchorOut).toBe(0)
  })

  it('stops a form stroke on the sphere at the terminator: it starts at the soft edge or on the lit side and never goes on into the shadow family (no point under N·L = -terminatorSoftness / 2), and some reach the terminator’s value', () => {
    const { baked } = SPHERE
    const stopBelow = terminatorValueOf(P, SPHERE_PLAN.curves)
    const s = SPHERE_PLAN.surfaces[0]!
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const at = newPlanAt()
    let forms = 0
    let lowestNl = Infinity
    let darkEnds = 0
    let missed = 0
    for (let i = 0; i < baked.count; i++) {
      if (baked.mark[i] !== 0 || baked.role[i] !== 1) continue
      forms++
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        if (!locate(s, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 1e-3, hit)) {
          missed++
          continue
        }
        planAt(SPHERE_PLAN, 0, 1, hit, at)
        lowestNl = Math.min(lowestNl, at.nl)
        // the dark end of a stroke that reaches the terminator: its value is within a step of the stop's
        if (q === (baked.anchor[i] < 0.5 ? BAKE_PATH_POINTS - 1 : 0) && at.u < stopBelow + 0.05) darkEnds++
      }
    }
    expect(missed).toBe(0)
    expect(forms).toBeGreaterThan(50)
    expect(lowestNl, `lowest N·L ${lowestNl.toFixed(4)}`).toBeGreaterThanOrEqual(-TS / 2)
    expect(darkEnds).toBeGreaterThan(0)
  })

  it('keeps a table stroke where the shadow falls (castOnly): the anchor of every block and glaze stroke of the table is in the cast zone', () => {
    const { baked } = SPHERE
    const s = SPHERE_PLAN.surfaces[1]!
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const at = newPlanAt()
    let n = 0
    let notCast = 0
    let otherRole = 0
    let missed = 0
    for (let i = 0; i < baked.count; i++) {
      if (baked.mark[i] !== 1) continue
      if (!(baked.role[i] === 0 || baked.role[i] === 3)) otherRole++ // block or glaze
      const q = Math.round(baked.anchor[i] * (BAKE_PATH_POINTS - 1))
      const o = 3 * (BAKE_PATH_POINTS * i + q)
      if (!locate(s, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 1e-3, hit)) {
        missed++
        continue
      }
      planAt(SPHERE_PLAN, 1, baked.side[i] === -1 ? -1 : 1, hit, at)
      if (at.zone !== Z_CAST) notCast++
      n++
    }
    expect(missed).toBe(0)
    expect(n).toBeGreaterThan(200)
    expect(otherRole).toBe(0)
    // (the anchor is near the particle; the vertex nearest decides the zone, so the edge of a shadow may be a hair off)
    expect(notCast).toBeLessThanOrEqual(0.05 * n)
  })

  it('walks a table stroke only inside the shadow, not just from it: the path points of the table’s blocks and glazes are in the cast zone (all but a few at the shadow’s own edge)', () => {
    const { baked } = SPHERE
    const s = SPHERE_PLAN.surfaces[1]!
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const at = newPlanAt()
    let points = 0
    let lit = 0
    let strokesWithLit = 0
    for (let i = 0; i < baked.count; i++) {
      // (the top of the table: the lit part of it is the part a stroke must not run onto; the underside is all shadow)
      if (baked.mark[i] !== 1 || baked.side[i] !== 1) continue
      let any = false
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        expect(locate(s, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 1e-3, hit)).toBe(true)
        planAt(SPHERE_PLAN, 1, 1, hit, at)
        points++
        if (at.zone !== Z_CAST) {
          lit++
          any = true
        }
      }
      if (any) strokesWithLit++
    }
    expect(points).toBeGreaterThan(500)
    // (a resampled point between two walked points of a shadow's curved edge, and the zone of the nearest vertex)
    expect(lit).toBeLessThanOrEqual(0.03 * points)
    expect(strokesWithLit).toBeLessThanOrEqual(0.1 * (points / BAKE_PATH_POINTS))
  })
})

describe('the walk itself', () => {
  // A unit square sheet in the plane z = 0, refined to 0.1 edges: the walk's border and its straight steps.
  const quad = refineSurface(quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], n: 4 }), 0, 0.1, 100_000)
  const side: WalkSide = {
    mark: 0, s: quad, side: 1, plan: null as never, planeOf: null, adjHard: () => -1, stopAt: 0.46, bleedAt: 0.24, light: [0, 0, 1],
  }
  const startAt = (x: number, y: number): SurfacePoint => {
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    expect(locate(quad, x, y, 0, 0, 0, 1, 1e-9, hit)).toBe(true)
    return hit
  }
  const spec = (hit: SurfacePoint, p: [number, number], d: [number, number, number], length: number, extra: Partial<WalkSpec> = {}): WalkSpec => ({
    hit, px: p[0], py: p[1], pz: 0, nx: 0, ny: 0, nz: 1, dx: d[0], dy: d[1], dz: d[2], mode: 'transport', rot: 0, length, bend: 0, stopBelow: -1, planeId: -1, castOnly: false, ...extra,
  })

  it('goes straight, in equal steps, WALK_STEPS each way from the start, when nothing stops it', () => {
    const w = walkStroke(side, spec(startAt(0.5, 0.5), [0.5, 0.5], [1, 0, 0], 0.4))
    expect(w.n).toBe(2 * WALK_STEPS + 1)
    expect(w.start).toBe(WALK_STEPS)
    for (let k = 0; k < w.n; k++) {
      expect(w.y[k]).toBeCloseTo(0.5, 9)
      expect(w.x[k]).toBeCloseTo(0.3 + (0.4 * k) / (w.n - 1), 9)
    }
    expect(w.endA).toBe(0)
    expect(w.endB).toBe(0)
  })

  it('ends where an open border does: a stroke walked off the sheet stops at the border with the end marked "left the surface", and never slides along it', () => {
    const w = walkStroke(side, spec(startAt(0.9, 0.5), [0.9, 0.5], [1, 0, 0], 0.8))
    // forward: 0.9 + 0.05 per step: the border is at 1, two steps off
    expect(w.endB).toBe(2)
    expect(w.endA).toBe(0)
    for (let k = 0; k < w.n; k++) {
      expect(w.x[k]).toBeLessThanOrEqual(1 + 1e-9)
      expect(w.x[k]).toBeGreaterThanOrEqual(0.5 - 1e-9)
    }
    expect(w.n).toBeLessThan(2 * WALK_STEPS + 1)
    // a stroke that leaves obliquely does not slide along the border either
    const o = walkStroke(side, spec(startAt(0.95, 0.5), [0.95, 0.5], [1, 1, 0], 0.8))
    for (let k = 0; k < o.n; k++) {
      expect(o.x[k]).toBeLessThanOrEqual(1 + 1e-9)
      expect(o.y[k]).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('stops at an edge of hardness 0 when stopAt is 0, and bleeds at one when bleedAt is 0, as the model’s `h !== undefined` does: -1 is no edge, 0 is an edge', () => {
    // the sheet's two halves are two planes, x < 0.5 and x >= 0.5
    const planeOf = new Int32Array(quad.indices.length / 3)
    for (let t = 0; t < planeOf.length; t++) {
      const a = quad.indices[3 * t]
      const b = quad.indices[3 * t + 1]
      const c = quad.indices[3 * t + 2]
      planeOf[t] = (quad.positions[3 * a] + quad.positions[3 * b] + quad.positions[3 * c]) / 3 < 0.5 ? 0 : 1
    }
    const run = (hardness: number, stopAt: number, bleedAt: number) => {
      const start = startAt(0.3, 0.5)
      return walkStroke({ ...side, planeOf, adjHard: () => hardness, stopAt, bleedAt }, spec(start, [0.3, 0.5], [1, 0, 0], 0.5, { planeId: 0 }))
    }
    // (the walk is a shared scratch: its numbers are read before the next walk)
    const none = run(-1, 0, 0)
    const noEdge = { n: none.n, end: none.endB }
    // no edge between the planes: nothing stops it, whatever stopAt is
    expect(noEdge).toEqual({ n: 2 * WALK_STEPS + 1, end: 0 })
    // an edge of hardness 0, stopAt 0: the walk ends at the plane boundary (the forward half, which crosses it)
    const hit = run(0, 0, 0)
    const stopped = { n: hit.n, end: hit.endB }
    expect(stopped.end).toBe(1)
    expect(stopped.n).toBeLessThan(2 * WALK_STEPS + 1)
    // an edge of hardness 0 under stopAt 1 and bleedAt 0: the walk goes on, bled (the forward half's end is marked 3)
    const through = run(0, 1, 0)
    const bled = { n: through.n, end: through.endB }
    expect(bled.end).toBe(3)
    expect(bled.n).toBeGreaterThan(stopped.n)
    // an edge of hardness 0 under both thresholds above 0 is no obstacle
    expect(run(0, 1, 0.5).endB).toBe(0)
  })

  it('bends by the angle it is given over its whole length (the model’s bend, a rotation about the normal)', () => {
    const w = walkStroke(side, spec(startAt(0.5, 0.5), [0.5, 0.5], [1, 0, 0], 0.4, { bend: 0.6 }))
    const dir = (a: number, b: number): number => Math.atan2(w.y[b] - w.y[a], w.x[b] - w.x[a])
    // the heading at the two ends differs by the bend, less the one step the two halves share at the start (the bend is turned a step before it is stepped)
    expect(Math.abs(dir(w.n - 2, w.n - 1) - dir(0, 1))).toBeCloseTo(0.6 * (1 - 1 / (2 * WALK_STEPS)), 1)
  })

  it('walks across a seam and over a pole as on a surface: every point of a walk over the sphere’s longitude seam, along its equator and across its pole is on the sphere', () => {
    const sphere = SPHERE_PLAN.surfaces[0]!
    const ws: WalkSide = { mark: 0, s: sphere, side: 1, plan: SPHERE_PLAN, planeOf: null, adjHard: () => -1, stopAt: 1, bleedAt: 1, light: SPHERE_PLAN.lightDir }
    for (const [p, d] of [[[-1, 0.02, 0], [0, -1, 0]], [[0.02, 0.1, 0.99], [1, 0, 0]], [[0, 0, 1], [1, 0, 0]]] as [number[], number[]][]) {
      const len = Math.hypot(p[0], p[1], p[2])
      const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
      expect(locate(sphere, p[0] / len, p[1] / len, p[2] / len, p[0], p[1], p[2], 0.02, hit)).toBe(true)
      const n = [0, 0, 0]
      normalOf(sphere, hit, 1, n)
      const at = [0, 0, 0]
      pointOf(sphere, hit, at)
      const w = walkStroke(ws, {
        hit, px: at[0], py: at[1], pz: at[2], nx: n[0], ny: n[1], nz: n[2], dx: d[0], dy: d[1], dz: d[2], mode: 'transport', rot: 0, length: 0.8, bend: 0,
        stopBelow: -1, planeId: -1, castOnly: false,
      })
      expect(w.n).toBe(2 * WALK_STEPS + 1)
      let off = 0
      const steps: number[] = []
      for (let k = 0; k < w.n; k++) {
        off = Math.max(off, Math.abs(Math.hypot(w.x[k], w.y[k], w.z[k]) - 1))
        if (k > 0) steps.push(Math.hypot(w.x[k] - w.x[k - 1], w.y[k] - w.y[k - 1], w.z[k] - w.z[k - 1]))
      }
      expect(off).toBeLessThanOrEqual(0.005)
      // and it is a walk of near-equal steps along the surface
      expect(Math.min(...steps)).toBeGreaterThan(0.04)
      expect(Math.max(...steps)).toBeLessThan(0.06)
    }
  })

  it('resamples a walk to BAKE_PATH_POINTS points from either end, with the start’s arc fraction mirrored', () => {
    const w = walkStroke(side, spec(startAt(0.5, 0.5), [0.5, 0.5], [1, 0, 0], 0.4))
    const path = new Float32Array(3 * BAKE_PATH_POINTS)
    const nrm = new Float32Array(3 * BAKE_PATH_POINTS)
    const fwd = resampleWalk(side, w, false, path, nrm, 0)!
    const fwdPath = Array.from(path)
    const meta = { length: fwd.length, anchor: fwd.anchor }
    expect(meta.length).toBeCloseTo(0.4, 6)
    expect(meta.anchor).toBeCloseTo(0.5, 6)
    for (let q = 0; q < BAKE_PATH_POINTS; q++) expect(path[3 * q]).toBeCloseTo(0.3 + (0.4 * q) / (BAKE_PATH_POINTS - 1), 6)
    const back = resampleWalk(side, w, true, path, nrm, 0)!
    expect(back.anchor).toBeCloseTo(0.5, 6)
    for (let q = 0; q < BAKE_PATH_POINTS; q++) expect(path[3 * q]).toBeCloseTo(fwdPath[3 * (BAKE_PATH_POINTS - 1 - q)], 6)
    for (let q = 0; q < BAKE_PATH_POINTS; q++) expect(nrm[3 * q + 2]).toBeCloseTo(1, 6)
  })

  it('gives no path to a walk of fewer than three points (a stroke that cannot go anywhere)', () => {
    // the walk goes straight along the sheet's normal: no direction in the tangent plane
    const w = walkStroke(side, spec(startAt(0.0, 0.5), [0, 0.5], [0, 0, 1], 0.4))
    expect(w.n).toBe(1)
    const path = new Float32Array(3 * BAKE_PATH_POINTS)
    const nrm = new Float32Array(3 * BAKE_PATH_POINTS)
    expect(resampleWalk(side, w, false, path, nrm, 0)).toBeNull()
  })

  it('snaps a point to the surface by walking across triangles, and agrees with the BVH’s nearest point wherever the surface lies under it', () => {
    const sphere = SPHERE_PLAN.surfaces[0]!
    const a: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const b: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const pa = [0, 0, 0]
    const pb = [0, 0, 0]
    let n = 0
    let worstPoint = 0
    let worstDist = 0
    for (let k = 0; k < 400; k++) {
      // a start on the sphere, and a point 0.02 .. 0.1 above the surface a few triangles away
      const t = (k * 2.399963) % (2 * Math.PI)
      const z = 1 - (2 * (k + 0.5)) / 400
      const r = Math.sqrt(1 - z * z)
      const p = [r * Math.cos(t), r * Math.sin(t), z]
      if (!locate(sphere, p[0], p[1], p[2], p[0], p[1], p[2], 0.02, a)) continue
      const start = a.tri
      const h = 1 + 0.02 + 0.08 * ((k % 7) / 6)
      const u = (k % 5) * 0.03
      const q = [p[0] + u * Math.sin(t), p[1] - u * Math.cos(t), p[2]]
      const ql = Math.hypot(q[0], q[1], q[2])
      const x = (q[0] / ql) * h, y = (q[1] / ql) * h, zz = (q[2] / ql) * h
      expect(snapNear(sphere, start, x, y, zz, 0, 0, 0, 1, b)).toBe(true)
      expect(locate(sphere, x, y, zz, 0, 0, 0, 1, a)).toBe(true)
      pointOf(sphere, a, pa)
      pointOf(sphere, b, pb)
      worstDist = Math.max(worstDist, Math.abs((b.dist ?? 0) - (a.dist ?? 0)))
      worstPoint = Math.max(worstPoint, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]))
      n++
    }
    expect(n).toBeGreaterThan(300)
    // (the two triangles of a quad of the sphere are not exactly coplanar, so the BVH's globally nearest point may be a hair off the one under the
    // point, on the next facet)
    expect(worstDist).toBeLessThanOrEqual(2e-3)
    expect(worstPoint).toBeLessThanOrEqual(2e-3)
  })
})
