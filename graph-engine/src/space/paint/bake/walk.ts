// The baked walk (the baked painting, spec §14; plan Task 3): a stroke's path walked on the REFINED SURFACE, in the world, once.
//
// The per-frame model (model/strokes.ts walkHalf) walks a stroke on the visible surface by reading the G-buffer: each step goes along the
// tangent plane, is projected, and is slid along the view ray onto the depth the G-buffer holds there. The bake has the surface itself
// (bake/surface.ts), so each step goes along the tangent plane and is SNAPPED to the surface: `snapNear` walks across the triangle adjacency from
// the triangle the stroke is on to the one the stepped point lies over (a step is a few triangles long), where `locate`'s BVH would ask the whole
// mesh. The ruling was `locate` with a reach of 4 steps; the BVH is still what answers when the walk runs out of iterations, and `locate` at the
// bake's start. The next normal is the surface's at the hit, for the stroke's side. A step that had to be moved by half a step or more has left
// the surface (an open border): the walk ends there, it does not slide along the border.
//
// WHAT STAYS. The direction field (n × L round the light, a fixed direction on the table, the transported parameter direction), the bend, the
// stops: a stroke that leaves its mark or runs off an open border ends there; one on the table stays where the shadow falls (castOnly); a form
// stroke stops where the plan value falls under the terminator's middle (stopBelow); a plane boundary with adjHard >= stopAt stops it, and one
// >= bleedAt lets it bleed on for 0.6 of the steps it had left.
//
// WHAT GOES. The limb and the depth jump (they are the view's: the frame's |n·v| fade and the renderer's depth pre-pass do that).
//
// THE LENGTH is the longest any view the bake serves can ask for (strokes.ts bakeLengthFactor); the walk takes BAKE_PATH_POINTS / 2 steps each way
// and the whole walk is resampled to BAKE_PATH_POINTS points at equal arc length, each ON the surface.

import type { DirMode } from '../model/strokes'
import { Z_CAST } from '../model/value'
import { newPlanAt, planAt, type PlanAt, type WorldPlan } from './plan'
import { closestOnTriangle, locate, normalOf, pointOf, type RefinedSurface, type SurfacePoint } from './surface'
import { BAKE_PATH_POINTS } from './types'

// Steps each way from the start, and the points a walk can have (the start, and a point per step each way).
export const WALK_STEPS = BAKE_PATH_POINTS / 2
const MAXW = 2 * WALK_STEPS + 1
// A walk stops when the snap moves the point more than this share of the step (the step has left the surface: an open border, a fold).
export const LEAVE_SHARE = 0.5
// The walk across triangles gives up (and the BVH is asked) after this many triangles (a step is a few triangles long).
const WALK_ITERATIONS = 96
// The reach of the snap, in steps (the ruling: 4 × the step; a point beyond is not on the surface).
export const SNAP_REACH_STEPS = 4

// What a walk reads of the world, per mark and side.
export interface WalkSide {
  mark: number
  s: RefinedSurface
  // The side whose normal the stroke follows: +1 or -1 (a closed opaque mesh's outside is +1).
  side: 1 | -1
  plan: WorldPlan
  // The plane of each refined triangle on this side (null: none, a veil), and the mean hardness between two planes.
  planeOf: Int32Array | null
  adjHard: (a: number, b: number) => number
  stopAt: number
  bleedAt: number
  // The world light, unit.
  light: readonly number[]
}

export interface WalkSpec {
  // The start: a point of the surface (its triangle and barycentric weights), its world position and the side's unit normal there.
  hit: SurfacePoint
  px: number
  py: number
  pz: number
  nx: number
  ny: number
  nz: number
  // The start direction (any vector; projected into the tangent plane).
  dx: number
  dy: number
  dz: number
  mode: DirMode
  // For 'fixed': the world direction every step follows (projected into the tangent plane).
  fixed?: readonly number[]
  // For 'iso': a rotation of the field about the normal, radians.
  rot: number
  // The whole walk's length, world units, and its total bend, radians.
  length: number
  bend: number
  // Stop where the plan value falls below this (a form stroke at the terminator); -1 off.
  stopBelow: number
  // The plane the stroke belongs to, for the edge rules; -1 off.
  planeId: number
  // Stay where the table is in shadow.
  castOnly: boolean
}

export interface Walked {
  // The points, in walk order (the backward end first, the start at `start`, the forward end last).
  n: number
  start: number
  x: Float64Array
  y: Float64Array
  z: Float64Array
  tri: Int32Array
  b1: Float64Array
  b2: Float64Array
  // Why each end stopped: 0 ran its length, 1 stopped at an edge, 2 left the surface, 3 bled.
  endA: number
  endB: number
}

const newWalked = (): Walked => ({
  n: 0, start: 0,
  x: new Float64Array(MAXW), y: new Float64Array(MAXW), z: new Float64Array(MAXW),
  tri: new Int32Array(MAXW), b1: new Float64Array(MAXW), b2: new Float64Array(MAXW),
  endA: 0, endB: 0,
})

interface Half {
  n: number
  x: Float64Array
  y: Float64Array
  z: Float64Array
  tri: Int32Array
  b1: Float64Array
  b2: Float64Array
  end: number
}
const newHalf = (): Half => ({
  n: 0, x: new Float64Array(WALK_STEPS), y: new Float64Array(WALK_STEPS), z: new Float64Array(WALK_STEPS),
  tri: new Int32Array(WALK_STEPS), b1: new Float64Array(WALK_STEPS), b2: new Float64Array(WALK_STEPS), end: 0,
})

const W = newWalked()
const FWD = newHalf()
const BWD = newHalf()
const HIT: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
const NRM = new Float64Array(3)
const AT: PlanAt = newPlanAt()
const CLOSEST = { b1: 0, b2: 0, d2: 0 }
// The world position of the point the last `snapNear` found (so a caller need not ask `pointOf` again).
const SNAP = new Float64Array(3)

// ---- snapping ----

// The point of the surface under (x, y, z), found by WALKING across the triangle adjacency from the triangle `hint`: in each triangle the point's
// projection on the triangle's plane has barycentric weights; where all are non-negative the projection is the snap, and where one is negative the
// walk crosses the edge opposite that vertex (a step is a few triangles long, and a smooth surface's nearest point is under the point). Where the
// walk would turn back to the triangle it came from (a point beyond a convex crease: its nearest point is on the edge), or reaches an open border,
// it takes the nearest point of the triangle it is in (the edge, or the border); the BVH (`locate`) answers only when the walk runs out of
// iterations or meets a degenerate triangle. The normal asked for (nx, ny, nz) is in the mesh's own orientation (locate's tie-break).
// FALSE only when `locate` finds nothing within `reach`; `out.dist` is the distance from the point to the one found.
export function snapNear(
  s: RefinedSurface, hint: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, reach: number, out: SurfacePoint,
): boolean {
  const pos = s.positions
  const idx = s.indices
  const adj = s.adj
  if (hint >= 0) {
    let cur = hint
    let prev = -1
    for (let it = 0; it < WALK_ITERATIONS; it++) {
      const ia = 3 * idx[3 * cur]
      const ib = 3 * idx[3 * cur + 1]
      const ic = 3 * idx[3 * cur + 2]
      const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2]
      const e1x = pos[ib] - ax, e1y = pos[ib + 1] - ay, e1z = pos[ib + 2] - az
      const e2x = pos[ic] - ax, e2y = pos[ic + 1] - ay, e2z = pos[ic + 2] - az
      const wx = x - ax, wy = y - ay, wz = z - az
      const d00 = e1x * e1x + e1y * e1y + e1z * e1z
      const d01 = e1x * e2x + e1y * e2y + e1z * e2z
      const d11 = e2x * e2x + e2y * e2y + e2z * e2z
      const d20 = wx * e1x + wy * e1y + wz * e1z
      const d21 = wx * e2x + wy * e2y + wz * e2z
      const den = d00 * d11 - d01 * d01
      if (!(den > 1e-30 * (d00 + d11) * (d00 + d11))) break
      const v = (d11 * d20 - d01 * d21) / den
      const w = (d00 * d21 - d01 * d20) / den
      const u0 = 1 - v - w
      // the most negative weight: cross the edge opposite its vertex
      let e = -1
      let worst = -1e-9
      if (u0 < worst) {
        worst = u0
        e = 1 // opposite vertex 0: the edge (1, 2) is slot 1
      }
      if (v < worst) {
        worst = v
        e = 2 // opposite vertex 1: the edge (2, 0) is slot 2
      }
      if (w < worst) {
        e = 0 // opposite vertex 2: the edge (0, 1) is slot 0
      }
      if (e < 0) {
        out.tri = cur
        out.b1 = v < 0 ? 0 : v
        out.b2 = w < 0 ? 0 : w
        const px = ax + out.b1 * e1x + out.b2 * e2x - x
        const py = ay + out.b1 * e1y + out.b2 * e2y - y
        const pz = az + out.b1 * e1z + out.b2 * e2z - z
        out.dist = Math.sqrt(px * px + py * py + pz * pz)
        SNAP[0] = px + x
        SNAP[1] = py + y
        SNAP[2] = pz + z
        return true
      }
      const u = adj[3 * cur + e]
      if (u < 0 || u === prev) {
        // the nearest point of this triangle: on its edge (a convex crease, or the border)
        closestOnTriangle(x, y, z, pos[ia], pos[ia + 1], pos[ia + 2], pos[ib], pos[ib + 1], pos[ib + 2], pos[ic], pos[ic + 1], pos[ic + 2], CLOSEST)
        out.tri = cur
        out.b1 = CLOSEST.b1
        out.b2 = CLOSEST.b2
        out.dist = Math.sqrt(CLOSEST.d2)
        const w0 = 1 - CLOSEST.b1 - CLOSEST.b2
        SNAP[0] = w0 * pos[ia] + CLOSEST.b1 * pos[ib] + CLOSEST.b2 * pos[ic]
        SNAP[1] = w0 * pos[ia + 1] + CLOSEST.b1 * pos[ib + 1] + CLOSEST.b2 * pos[ic + 1]
        SNAP[2] = w0 * pos[ia + 2] + CLOSEST.b1 * pos[ib + 2] + CLOSEST.b2 * pos[ic + 2]
        return true
      }
      prev = cur
      cur = u
    }
  }
  if (!locate(s, x, y, z, nx, ny, nz, reach, out)) return false
  pointOf(s, out, SNAP)
  return true
}

// ---- one half ----

// Walk one half of a stroke from the start, in direction `sign` (the model's walkHalf, on the surface).
function walkHalf(w: WalkSide, sp: WalkSpec, sign: number, half: number, out: Half): void {
  const s = w.s
  const L = w.light
  const ds = half / WALK_STEPS
  const bendStep = (sp.bend / (2 * WALK_STEPS)) * sign
  const cb = Math.cos(bendStep)
  const sb = Math.sin(bendStep)
  const cr = Math.cos(sp.rot)
  const sr = Math.sin(sp.rot)
  const o = w.side * s.orient
  let px = sp.px, py = sp.py, pz = sp.pz
  let nx = sp.nx, ny = sp.ny, nz = sp.nz
  let hint = sp.hit.tri
  // the start direction in the tangent plane
  const k0 = sp.dx * nx + sp.dy * ny + sp.dz * nz
  let dx = sp.dx - nx * k0, dy = sp.dy - ny * k0, dz = sp.dz - nz * k0
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
  out.n = 0
  out.end = 0
  if (dl < 1e-9) {
    out.end = 2
    return
  }
  dx = (dx / dl) * sign
  dy = (dy / dl) * sign
  dz = (dz / dl) * sign
  const planeId = sp.planeId
  let bleedLeft = 0
  let bled = false
  const reach = SNAP_REACH_STEPS * ds
  for (let k = 1; k <= WALK_STEPS; k++) {
    let stepLen = ds
    if (bled) {
      if (bleedLeft <= 1e-9) return
      stepLen = ds * Math.min(1, bleedLeft)
      bleedLeft -= 1
    }
    // 1. the direction here
    let ex = dx, ey = dy, ez = dz
    if (sp.mode === 'iso') {
      // round the light: n × L, kept continuous with the last step, then rotated about n
      let cx = ny * L[2] - nz * L[1]
      let cy = nz * L[0] - nx * L[2]
      let cz = nx * L[1] - ny * L[0]
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz)
      if (cl > 0.12) {
        cx /= cl
        cy /= cl
        cz /= cl
        if (cx * dx + cy * dy + cz * dz < 0) {
          cx = -cx
          cy = -cy
          cz = -cz
        }
        const kx = ny * cz - nz * cy
        const ky = nz * cx - nx * cz
        const kz = nx * cy - ny * cx
        ex = cx * cr + kx * sr
        ey = cy * cr + ky * sr
        ez = cz * cr + kz * sr
      }
    } else if (sp.mode === 'fixed' && sp.fixed) {
      let fx = sp.fixed[0], fy = sp.fixed[1], fz = sp.fixed[2]
      const kf = fx * nx + fy * ny + fz * nz
      fx -= nx * kf
      fy -= ny * kf
      fz -= nz * kf
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (fl > 1e-6) {
        fx /= fl
        fy /= fl
        fz /= fl
        if (fx * dx + fy * dy + fz * dz < 0) {
          fx = -fx
          fy = -fy
          fz = -fz
        }
        ex = fx
        ey = fy
        ez = fz
      }
    }
    // keep it in the tangent plane, unit
    const ke = ex * nx + ey * ny + ez * nz
    ex -= nx * ke
    ey -= ny * ke
    ez -= nz * ke
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez)
    if (el < 1e-9) {
      out.end = 2
      return
    }
    ex /= el
    ey /= el
    ez /= el
    // 2. the bend: rotate about the normal
    const kx = ny * ez - nz * ey
    const ky = nz * ex - nx * ez
    const kz = nx * ey - ny * ex
    dx = ex * cb + kx * sb
    dy = ey * cb + ky * sb
    dz = ez * cb + kz * sb
    // 3. the step in the tangent plane, snapped to the surface (the mesh's own orientation of the normal for the tie-break)
    const qx = px + dx * stepLen
    const qy = py + dy * stepLen
    const qz = pz + dz * stepLen
    if (!snapNear(s, hint, qx, qy, qz, o * nx, o * ny, o * nz, reach, HIT)) {
      out.end = 2
      return
    }
    // (a step that had to be moved by half a step or more is a step off the surface: a border, or a fold)
    if ((HIT.dist ?? 0) > LEAVE_SHARE * stepLen) {
      out.end = 2
      return
    }
    // 4. the stops, at the point the surface gives
    if (sp.castOnly || sp.stopBelow >= 0) {
      planAt(w.plan, w.mark, w.side, HIT, AT)
      if (sp.castOnly && AT.zone !== Z_CAST) {
        out.end = 1
        return
      }
      if (sp.stopBelow >= 0 && AT.u < sp.stopBelow) {
        out.end = 1
        return
      }
    }
    if (planeId >= 0 && w.planeOf) {
      const label = w.planeOf[HIT.tri]
      if (label >= 0 && label !== planeId) {
        const h = w.adjHard(planeId, label)
        if (h > 0) {
          if (h >= w.stopAt) {
            out.end = 1
            return
          }
          if (h >= w.bleedAt && !bled) {
            bled = true
            bleedLeft = 0.6 * (WALK_STEPS - k)
            out.end = 3
          }
        }
      }
    }
    // 5. the point (on the surface) and its normal, the next step's
    const idx = out.n++
    px = SNAP[0]
    py = SNAP[1]
    pz = SNAP[2]
    out.x[idx] = px
    out.y[idx] = py
    out.z[idx] = pz
    out.tri[idx] = HIT.tri
    out.b1[idx] = HIT.b1
    out.b2[idx] = HIT.b2
    hint = HIT.tri
    if (k < WALK_STEPS) {
      normalOf(s, HIT, w.side, NRM)
      nx = NRM[0]
      ny = NRM[1]
      nz = NRM[2]
    }
  }
}

// Walk a stroke both ways from its start. Returns the walk (a shared scratch: use it before the next call).
export function walkStroke(w: WalkSide, sp: WalkSpec): Walked {
  const half = 0.5 * sp.length
  walkHalf(w, sp, +1, half, FWD)
  walkHalf(w, sp, -1, half, BWD)
  let n = 0
  for (let k = BWD.n - 1; k >= 0; k--) {
    W.x[n] = BWD.x[k]
    W.y[n] = BWD.y[k]
    W.z[n] = BWD.z[k]
    W.tri[n] = BWD.tri[k]
    W.b1[n] = BWD.b1[k]
    W.b2[n] = BWD.b2[k]
    n++
  }
  W.start = n
  W.x[n] = sp.px
  W.y[n] = sp.py
  W.z[n] = sp.pz
  W.tri[n] = sp.hit.tri
  W.b1[n] = sp.hit.b1
  W.b2[n] = sp.hit.b2
  n++
  for (let k = 0; k < FWD.n; k++) {
    W.x[n] = FWD.x[k]
    W.y[n] = FWD.y[k]
    W.z[n] = FWD.z[k]
    W.tri[n] = FWD.tri[k]
    W.b1[n] = FWD.b1[k]
    W.b2[n] = FWD.b2[k]
    n++
  }
  W.n = n
  W.endA = BWD.end
  W.endB = FWD.end
  return W
}

// ---- resampling ----

// The 16 points of the last resample as surface points (so a caller can read the plan or the edge field along the path).
export const PATH_HITS: SurfacePoint[] = Array.from({ length: BAKE_PATH_POINTS }, () => ({ tri: 0, b1: 0, b2: 0 }))

export interface PathMeta {
  // The arc length of the resampled path (the chords of its points), world units.
  length: number
  // The start's arc fraction along the path, 0..1, in the path's own direction.
  anchor: number
}
const META: PathMeta = { length: 0, anchor: 0 }
const CUM = new Float64Array(MAXW)
const TMP = new Float64Array(3)

// Resample a walk to BAKE_PATH_POINTS points at equal arc length, each on the surface (the interpolated point is snapped back), with the side's
// normal at each: written to `path` and `normal` (3 per point) from `offset`. `reverse` runs the path from the walk's far end. Null when the walk
// has no length (fewer than 3 points, or all one point). The result is the shared META (use it before the next call).
export function resampleWalk(w: WalkSide, walk: Walked, reverse: boolean, path: Float32Array, normal: Float32Array, offset: number): PathMeta | null {
  const n = walk.n
  if (n < 3) return null
  const s = w.s
  CUM[0] = 0
  for (let i = 1; i < n; i++) CUM[i] = CUM[i - 1] + Math.hypot(walk.x[i] - walk.x[i - 1], walk.y[i] - walk.y[i - 1], walk.z[i] - walk.z[i - 1])
  const total = CUM[n - 1]
  if (!(total > 1e-12)) return null
  const step = total / (BAKE_PATH_POINTS - 1)
  let seg = 1
  for (let q = 0; q < BAKE_PATH_POINTS; q++) {
    const k = reverse ? BAKE_PATH_POINTS - 1 - q : q
    const at = k * step
    while (seg < n - 1 && CUM[seg] < at) seg++
    while (seg > 1 && CUM[seg - 1] >= at) seg--
    const span = CUM[seg] - CUM[seg - 1]
    const f = span > 0 ? Math.min(1, Math.max(0, (at - CUM[seg - 1]) / span)) : 0
    const x = walk.x[seg - 1] + (walk.x[seg] - walk.x[seg - 1]) * f
    const y = walk.y[seg - 1] + (walk.y[seg] - walk.y[seg - 1]) * f
    const z = walk.z[seg - 1] + (walk.z[seg] - walk.z[seg - 1]) * f
    const near = f < 0.5 ? seg - 1 : seg
    const hit = PATH_HITS[q]
    // (the chord point is within a sagitta of the surface: snap it to the surface, among the triangles of the walk's own neighbours)
    if (snapNear(s, walk.tri[near], x, y, z, 0, 0, 0, Math.max(span, step), hit)) {
      path[offset + 3 * q] = SNAP[0]
      path[offset + 3 * q + 1] = SNAP[1]
      path[offset + 3 * q + 2] = SNAP[2]
    } else {
      hit.tri = walk.tri[near]
      hit.b1 = walk.b1[near]
      hit.b2 = walk.b2[near]
      pointOf(s, hit, TMP)
      path[offset + 3 * q] = TMP[0]
      path[offset + 3 * q + 1] = TMP[1]
      path[offset + 3 * q + 2] = TMP[2]
    }
    normalOf(s, hit, w.side, TMP)
    normal[offset + 3 * q] = TMP[0]
    normal[offset + 3 * q + 1] = TMP[1]
    normal[offset + 3 * q + 2] = TMP[2]
  }
  // the path's own arc length, and the start's place along it
  let len = 0
  for (let q = 1; q < BAKE_PATH_POINTS; q++) {
    len += Math.hypot(
      path[offset + 3 * q] - path[offset + 3 * q - 3], path[offset + 3 * q + 1] - path[offset + 3 * q - 2], path[offset + 3 * q + 2] - path[offset + 3 * q - 1],
    )
  }
  const frac = CUM[walk.start] / total
  META.length = len
  META.anchor = reverse ? 1 - frac : frac
  return META
}
