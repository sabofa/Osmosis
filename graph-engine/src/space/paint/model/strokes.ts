// Strokes (spec §3.7, M9): a stroke's path is WALKED on the surface along its
// direction for `length` CSS px, projected, curved by `curvature`, and
// resampled to PATH_POINTS points. Width is shaped by pressure (a loaded
// start, then a taper over the last 30%) and by foreshortening, so a stroke on
// a surface turning away really narrows. Colour is the lighting curve plus the
// brush-load mix, converted to linear sRGB. Depth is the view depth at the start.
//
// The walk keeps to the VISIBLE surface by reading the G-buffer: each step goes
// along the tangent plane, is projected, and its world point is slid along the
// view ray onto the depth the G-buffer holds there; the normal for the next
// step is the G-buffer's. A stroke ends where the surface does (the mesh or the
// depth changes), where it is stopped by a plane edge (edges.stopAt), and
// bleeds across a softer one for 60% of what is left (edges.bleedAt).
//
// A StrokeDraft is a stroke before it is mixed and packed; packStrokes() puts
// the drafts in painting order (the layers of LAYER_ORDER, back to front by
// depth within a layer), gives each load its mix, and fills the StrokeBatch.

import type { PaintParams } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type Oklab, type ParticleSet, type Role, type StrokeBatch } from '../types'
import { oklabToLinear } from './colour'
import type { Curve } from './curve'
import type { EdgeMap } from './edges'
import { clamp, smooth } from './math'
import { LoadMixer } from './mix'
import type { ParticleSide } from './particles'
import type { PlaneMap } from './planes'
import type { DraftColour, RecipeEnv } from './recipe'
import type { PlanMap } from './value'
import { Z_CAST } from './zones'
import { pxPerUnit, projectedLength, type FrameCtx, type Visible } from './view'

export interface StrokeDraft {
  // Index into ROLES.
  role: number
  // CSS px, y down: PATH_POINTS points, and a width at each.
  path: Float32Array
  width: Float32Array
  depth: number
  // The colour before the mix (fitted OKLab), and the value it was made at.
  lab: Oklab
  // What the colour is made of, so it can be made again when a colour parameter
  // changes (recipe.ts); null for a colour that is not made from the curve.
  colour?: DraftColour | null
  u: number
  // The path in world space (3 per path point) and the world normal at the anchor, for re-projecting the stroke in
  // another view without the model (StrokeBatch.worldPath, worldNormal). Left out of a hand-made draft: zeros.
  world?: Float32Array
  normal?: readonly number[]
  // The layer to paint in, when it is not the role's own (a line seen through a veil is painted before the
  // glaze, so the veil tints it; the role stays `line`, which is what shapes the brush).
  layer?: number
  // The surface cell of the start, and where the stroke sits on screen, for the mix's loads.
  cell: number
  mx: number
  my: number
  colormapped: boolean
  alpha: number
  load: number
  impasto: number
  bristles: number
  bristleVar: number
  dry: number
  wet: number
  endSoft: number
  // Index into EDGE_CLASSES of the governing edge, 255 if none.
  edge: number
  seed: number
  // The stroke's personal jitter for the mix: two standard-normal draws from its own stream.
  jit0: number
  jit1: number
  // Creation order, the final tie-break of the sort.
  order: number
}

// Everything the role builders read for one frame.
export interface PaintCtx {
  fc: FrameCtx
  set: ParticleSet
  side: ParticleSide
  plan: PlanMap
  planes: PlaneMap
  edges: EdgeMap
  curve: Curve
  vis: Visible
  // The local colour of bare table (the canvas through the inverse of the curve).
  groundLocal: Oklab
  // Mean local colour of the visible particles of each plane, and of each mesh (OKLab, 3 each).
  planeColour: Float32Array
  planeHasColour: Uint8Array
  markColour: Float32Array
  // Scumble is allowed here (a wide, gentle transition), per G-buffer pixel.
  scumbleOk: Uint8Array
  drafts: StrokeDraft[]
  nextOrder: number
  // What a colour recipe reads from the parameters of the moment (the curve, the ground's colour).
  env: RecipeEnv
  // The analysis stride: the G-buffer the analysis ran on is every stride-th pixel of the one the renderer read back.
  stride: number
}

// ---- the walk ----

const STEPS = 4
const MAXW = 2 * STEPS + 1

export interface Walk {
  n: number
  x: Float64Array
  y: Float64Array
  depth: Float64Array
  // The foreshortening of the stroke's width at each point (1 = across the view).
  fore: Float64Array
  // The world point each screen point is the projection of (the step in the tangent plane, not snapped to the surface).
  wx: Float64Array
  wy: Float64Array
  wz: Float64Array
  // Why each end stopped: 0 ran its length, 1 stopped at an edge, 2 left the surface, 3 bled.
  endA: number
  endB: number
}

const newWalk = (): Walk => ({
  n: 0,
  x: new Float64Array(MAXW),
  y: new Float64Array(MAXW),
  depth: new Float64Array(MAXW),
  fore: new Float64Array(MAXW),
  wx: new Float64Array(MAXW),
  wy: new Float64Array(MAXW),
  wz: new Float64Array(MAXW),
  endA: 0,
  endB: 0,
})

export type DirMode = 'iso' | 'transport' | 'fixed'

export interface WalkSpec {
  mark: number
  // A veil: not in the G-buffer; it ends where something opaque stands in front, or past its border.
  translucent: boolean
  // The start: world position, screen position, view depth and normal.
  px: number
  py: number
  pz: number
  sx: number
  sy: number
  depth: number
  nx: number
  ny: number
  nz: number
  // The start direction (any vector; it is projected into the tangent plane).
  dx: number
  dy: number
  dz: number
  mode: DirMode
  // For 'fixed': the world direction every step follows (projected into the tangent plane).
  fixed?: [number, number, number]
  // For 'iso': a rotation of the field about the normal, radians.
  rot: number
  // Length in CSS px at the start's scale, and the total bend, radians.
  lengthPx: number
  bend: number
  // Stop where the plan value falls below this (form strokes stop below the core); -1 off.
  stopBelow: number
  // The plane the stroke belongs to, for the edge rules; -1 off.
  planeId: number
  // Stay where the table is in shadow.
  castOnly: boolean
  // For a veil: is this world point inside the sheet?
  inside?: (x: number, y: number, z: number) => boolean
}

interface Half {
  n: number
  sx: Float64Array
  sy: Float64Array
  depth: Float64Array
  fore: Float64Array
  wx: Float64Array
  wy: Float64Array
  wz: Float64Array
  end: number
}
const newHalf = (): Half => ({
  n: 0,
  sx: new Float64Array(STEPS),
  sy: new Float64Array(STEPS),
  depth: new Float64Array(STEPS),
  fore: new Float64Array(STEPS),
  wx: new Float64Array(STEPS),
  wy: new Float64Array(STEPS),
  wz: new Float64Array(STEPS),
  end: 0,
})

const W = newWalk()
const FWD = newHalf()
const BWD = newHalf()

// Walk one half of a stroke from the start, in direction `sign`. (The hot loop
// of the model: scalar arithmetic, no allocation, the projection inlined.)
function walkHalf(an: PaintCtx, s: WalkSpec, sign: number, halfWorld: number, ppu0: number, out: Half): void {
  const fc = an.fc
  const g = fc.g
  const view = fc.view
  const L = view.lightDir
  const params = fc.params
  const vp = fc.vp
  const ortho = fc.ortho
  const eye = view.eye
  const vd = view.viewDir
  const W = fc.W
  const H = fc.H
  const scale = fc.scale
  const gw = g.width
  const gh = g.height
  const fadeLo = params.particles.fadeLo
  const epsBase = scale / ppu0
  const ds = halfWorld / STEPS
  const bendStep = (s.bend / (2 * STEPS)) * sign
  const cb = Math.cos(bendStep)
  const sb = Math.sin(bendStep)
  const cr = Math.cos(s.rot)
  const sr = Math.sin(s.rot)
  let px = s.px, py = s.py, pz = s.pz
  let nx = s.nx, ny = s.ny, nz = s.nz
  // the start direction in the tangent plane
  const k0 = s.dx * nx + s.dy * ny + s.dz * nz
  let dx = s.dx - nx * k0, dy = s.dy - ny * k0, dz = s.dz - nz * k0
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dl < 1e-9) {
    out.n = 0
    out.end = 2
    return
  }
  dx = (dx / dl) * sign
  dy = (dy / dl) * sign
  dz = (dz / dl) * sign
  const stopAt = params.edges.stopAt
  const bleedAt = params.edges.bleedAt
  const planeId = s.planeId
  // after a stroke crosses a softer edge it goes on for 60% of the steps it had left, to the fraction of a step
  // (it was floored to whole steps, which of a stroke of 4 left it 0 or 1)
  let bleedLeft = 0
  let bled = false
  out.n = 0
  out.end = 0
  for (let k = 1; k <= STEPS; k++) {
    let stepLen = ds
    if (bled) {
      if (bleedLeft <= 1e-9) return
      stepLen = ds * Math.min(1, bleedLeft)
      bleedLeft -= 1
    }
    // 1. the direction here
    let ex = dx, ey = dy, ez = dz
    if (s.mode === 'iso') {
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
        // rotate about n by rot
        const kx = ny * cz - nz * cy
        const ky = nz * cx - nx * cz
        const kz = nx * cy - ny * cx
        ex = cx * cr + kx * sr
        ey = cy * cr + ky * sr
        ez = cz * cr + kz * sr
      }
    } else if (s.mode === 'fixed' && s.fixed) {
      let fx = s.fixed[0], fy = s.fixed[1], fz = s.fixed[2]
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
    // 3. the step, projected
    const qx = px + dx * stepLen
    const qy = py + dy * stepLen
    const qz = pz + dz * stepLen
    const cw = vp[3] * qx + vp[7] * qy + vp[11] * qz + vp[15]
    if (cw <= 1e-9) {
      out.end = 2
      return
    }
    const sx = ((((vp[0] * qx + vp[4] * qy + vp[8] * qz + vp[12]) / cw) + 1) / 2) * W
    const sy = ((1 - (vp[1] * qx + vp[5] * qy + vp[9] * qz + vp[13]) / cw) / 2) * H
    let depth = (qx - eye[0]) * vd[0] + (qy - eye[1]) * vd[1] + (qz - eye[2]) * vd[2]
    // the unit vector toward the eye
    let vx: number, vy: number, vz: number
    if (ortho) {
      vx = -vd[0]
      vy = -vd[1]
      vz = -vd[2]
    } else {
      vx = eye[0] - qx
      vy = eye[1] - qy
      vz = eye[2] - qz
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
      vx /= vl
      vy /= vl
      vz /= vl
    }
    let wx = qx, wy = qy, wz = qz
    let nnx = nx, nny = ny, nnz = nz
    const gx = Math.floor(sx / scale)
    const gy = Math.floor(sy / scale)
    const gi = gx < 0 || gy < 0 || gx >= gw || gy >= gh ? -1 : gy * gw + gx
    if (s.translucent) {
      if (gi >= 0 && g.depth[gi] < depth - epsBase * 2) {
        out.end = 2
        return
      }
      if (s.inside && !s.inside(qx, qy, qz)) {
        out.end = 2
        return
      }
    } else {
      if (gi < 0 || g.mark[gi] !== s.mark) {
        out.end = 2
        return
      }
      const f = Math.abs(nx * vx + ny * vy + nz * vz)
      const slope = Math.sqrt(Math.max(0, 1 - f * f)) / Math.max(f, 0.1)
      const gd = g.depth[gi]
      if (Math.abs(gd - depth) > epsBase * (1.5 + 1.5 * slope)) {
        out.end = 2
        return
      }
      // fade-out at the limb: a stroke does not run to where it cannot be seen
      const gnx = g.normal[3 * gi], gny = g.normal[3 * gi + 1], gnz = g.normal[3 * gi + 2]
      if (Math.abs(gnx * vx + gny * vy + gnz * vz) < fadeLo) {
        out.end = 2
        return
      }
      // 4. the stops
      if (s.castOnly && an.plan.zone[gi] !== Z_CAST) {
        out.end = 1
        return
      }
      if (s.stopBelow >= 0 && an.plan.u[gi] < s.stopBelow) {
        out.end = 1
        return
      }
      if (planeId >= 0) {
        const label = an.planes.plane[gi]
        if (label >= 0 && label !== planeId) {
          const h = an.edges.adjHard(planeId, label)
          if (h !== undefined) {
            if (h >= stopAt) {
              out.end = 1
              return
            }
            if (h >= bleedAt && !bled) {
              bled = true
              bleedLeft = 0.6 * (STEPS - k)
              out.end = 3
            }
          }
        }
      }
      // 5. onto the surface: along the view ray to the depth the G-buffer holds, and its normal
      if (ortho) {
        const dd = gd - depth
        wx += vd[0] * dd
        wy += vd[1] * dd
        wz += vd[2] * dd
      } else {
        const kk = gd / Math.max(1e-9, depth)
        wx = eye[0] + (qx - eye[0]) * kk
        wy = eye[1] + (qy - eye[1]) * kk
        wz = eye[2] + (qz - eye[2]) * kk
      }
      depth = gd
      nnx = gnx
      nny = gny
      nnz = gnz
      if (nnx * nx + nny * ny + nnz * nz < 0) {
        nnx = -nnx
        nny = -nny
        nnz = -nnz
      }
      const nl = Math.sqrt(nnx * nnx + nny * nny + nnz * nnz)
      if (nl > 1e-6) {
        nnx /= nl
        nny /= nl
        nnz /= nl
      } else {
        nnx = nx
        nny = ny
        nnz = nz
      }
    }
    // the point: its screen position is the projection of the step (smooth), its world point is on the surface
    const idx = out.n++
    out.sx[idx] = sx
    out.sy[idx] = sy
    out.depth[idx] = depth
    out.wx[idx] = qx
    out.wy[idx] = qy
    out.wz[idx] = qz
    // foreshortening of the width: the lateral direction n × d, projected
    let bx = nny * dz - nnz * dy
    let by = nnz * dx - nnx * dz
    let bz = nnx * dy - nny * dx
    const bl = Math.sqrt(bx * bx + by * by + bz * bz)
    if (bl > 1e-9) {
      bx /= bl
      by /= bl
      bz /= bl
      out.fore[idx] = projectedLength(fc, wx, wy, wz, bx, by, bz) / ppu0
    } else out.fore[idx] = 0
    px = wx
    py = wy
    pz = wz
    nx = nnx
    ny = nny
    nz = nnz
  }
}

// Walk a stroke both ways from its start. Returns the walk (a shared scratch:
// use it before the next call).
export function walkStroke(an: PaintCtx, s: WalkSpec): Walk {
  const fc = an.fc
  const ppu0 = pxPerUnit(fc, s.px, s.py, s.pz)
  const halfWorld = (0.5 * s.lengthPx) / ppu0
  walkHalf(an, s, +1, halfWorld, ppu0, FWD)
  walkHalf(an, s, -1, halfWorld, ppu0, BWD)
  // the start's own foreshortening
  let bx = s.ny * s.dz - s.nz * s.dy
  let by = s.nz * s.dx - s.nx * s.dz
  let bz = s.nx * s.dy - s.ny * s.dx
  const bl = Math.hypot(bx, by, bz)
  const f0 = bl > 1e-9 ? projectedLength(fc, s.px, s.py, s.pz, bx / bl, by / bl, bz / bl) / ppu0 : 1
  let n = 0
  for (let k = BWD.n - 1; k >= 0; k--) {
    W.x[n] = BWD.sx[k]
    W.y[n] = BWD.sy[k]
    W.depth[n] = BWD.depth[k]
    W.fore[n] = BWD.fore[k]
    W.wx[n] = BWD.wx[k]
    W.wy[n] = BWD.wy[k]
    W.wz[n] = BWD.wz[k]
    n++
  }
  W.x[n] = s.sx
  W.y[n] = s.sy
  W.depth[n] = s.depth
  W.fore[n] = f0
  W.wx[n] = s.px
  W.wy[n] = s.py
  W.wz[n] = s.pz
  n++
  for (let k = 0; k < FWD.n; k++) {
    W.x[n] = FWD.sx[k]
    W.y[n] = FWD.sy[k]
    W.depth[n] = FWD.depth[k]
    W.fore[n] = FWD.fore[k]
    W.wx[n] = FWD.wx[k]
    W.wy[n] = FWD.wy[k]
    W.wz[n] = FWD.wz[k]
    n++
  }
  W.n = n
  W.endA = BWD.end
  W.endB = FWD.end
  return W
}

// ---- turning a walk into a path ----

// The pressure along a stroke, t in 0..1: a loaded start that settles, then a taper over the last 30%.
export function pressure(t: number): number {
  return (1 + 0.15 * Math.exp(-((t / 0.15) ** 2))) * (1 - 0.55 * smooth(0.7, 1, t))
}

// The pressure at each of the PATH_POINTS path points (it is the same for every stroke).
const PRESSURE = Array.from({ length: PATH_POINTS }, (_, k) => pressure(k / (PATH_POINTS - 1)))
const CUM = new Float64Array(MAXW)

// Resample the walk to PATH_POINTS points at equal arc length, with the width
// at each: baseWidth · pressure · foreshortening, interpolated.
export function pathFromWalk(w: Walk, baseWidth: number, reverse: boolean, path: Float32Array, width: Float32Array, world?: Float32Array): number {
  const n = w.n
  // cumulative arc length
  let total = 0
  CUM[0] = 0
  for (let i = 1; i < n; i++) {
    const dx = w.x[i] - w.x[i - 1]
    const dy = w.y[i] - w.y[i - 1]
    total += Math.sqrt(dx * dx + dy * dy)
    CUM[i] = total
  }
  if (n < 2 || total < 1e-6) return 0
  let mean = 0
  let seg = 1
  for (let q = 0; q < PATH_POINTS; q++) {
    // q runs along the stroke in its own direction (the pressure follows q); a reversed stroke reads the walk from its far end
    const k = reverse ? PATH_POINTS - 1 - q : q
    const s = (k / (PATH_POINTS - 1)) * total
    while (seg < n - 1 && CUM[seg] < s) seg++
    while (seg > 1 && CUM[seg - 1] >= s) seg--
    const span = CUM[seg] - CUM[seg - 1]
    const f = span > 0 ? Math.min(1, Math.max(0, (s - CUM[seg - 1]) / span)) : 0
    path[2 * q] = w.x[seg - 1] + (w.x[seg] - w.x[seg - 1]) * f
    path[2 * q + 1] = w.y[seg - 1] + (w.y[seg] - w.y[seg - 1]) * f
    const fore = w.fore[seg - 1] + (w.fore[seg] - w.fore[seg - 1]) * f
    if (world) {
      world[3 * q] = w.wx[seg - 1] + (w.wx[seg] - w.wx[seg - 1]) * f
      world[3 * q + 1] = w.wy[seg - 1] + (w.wy[seg] - w.wy[seg - 1]) * f
      world[3 * q + 2] = w.wz[seg - 1] + (w.wz[seg] - w.wz[seg - 1]) * f
    }
    width[q] = Math.max(0.35, baseWidth * PRESSURE[q] * fore)
    mean += width[q]
  }
  return mean / PATH_POINTS
}

// ---- packing ----

const ROLE_INDEX: Record<Role, number> = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<Role, number>
export const roleIndex = (r: Role): number => ROLE_INDEX[r]
const LAYER_OF_ROLE = ROLES.map((r) => LAYER_ORDER.indexOf(r))
// Where a line seen through a veil goes: after the block-in and the form, before the glaze, so the glaze (a veil's own strokes) lies over it.
export const BEHIND_VEIL_LAYER = LAYER_ORDER.indexOf('scumble')

// Painting order: layer by layer, back to front by depth (the larger the
// distance the earlier), then creation order; every load's mix in that order.
export function packStrokes(drafts: StrokeDraft[], params: PaintParams): { batch: StrokeBatch; loads: number; byRole: Record<Role, number> } {
  const layerOf = (d: StrokeDraft): number => d.layer ?? LAYER_OF_ROLE[d.role]
  drafts.sort((a, b) => layerOf(a) - layerOf(b) || b.depth - a.depth || a.order - b.order)
  const count = drafts.length
  const batch: StrokeBatch = {
    count,
    role: new Uint8Array(count),
    layer: new Uint8Array(count),
    path: new Float32Array(2 * PATH_POINTS * count),
    width: new Float32Array(PATH_POINTS * count),
    depth: new Float32Array(count),
    colour: new Float32Array(3 * count),
    alpha: new Float32Array(count),
    load: new Float32Array(count),
    impasto: new Float32Array(count),
    bristles: new Float32Array(count),
    bristleVar: new Float32Array(count),
    dry: new Float32Array(count),
    wet: new Float32Array(count),
    endSoft: new Float32Array(count),
    edge: new Uint8Array(count),
    seed: new Uint32Array(count),
    worldPath: new Float32Array(3 * PATH_POINTS * count),
    worldNormal: new Float32Array(3 * count),
  }
  const mixer = new LoadMixer(params)
  const byRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
  for (let i = 0; i < count; i++) {
    const d = drafts[i]
    const role = ROLES[d.role]
    byRole[role]++
    const mixed = mixer.mix({ role, cell: d.cell, u: d.u, x: d.mx, y: d.my, lab: d.lab, colormapped: d.colormapped, seed: d.seed, jit0: d.jit0, jit1: d.jit1 })
    const lin = oklabToLinear(mixed.lab)
    batch.role[i] = d.role
    batch.layer[i] = layerOf(d)
    batch.path.set(d.path, 2 * PATH_POINTS * i)
    batch.width.set(d.width, PATH_POINTS * i)
    batch.depth[i] = d.depth
    batch.colour[3 * i] = lin[0]
    batch.colour[3 * i + 1] = lin[1]
    batch.colour[3 * i + 2] = lin[2]
    batch.alpha[i] = d.alpha
    batch.load[i] = d.load
    batch.impasto[i] = d.impasto
    batch.bristles[i] = d.bristles
    batch.bristleVar[i] = d.bristleVar
    batch.dry[i] = d.dry
    batch.wet[i] = d.wet
    batch.endSoft[i] = d.endSoft
    batch.edge[i] = d.edge
    batch.seed[i] = d.seed
    if (d.world) batch.worldPath.set(d.world, 3 * PATH_POINTS * i)
    if (d.normal) {
      batch.worldNormal[3 * i] = d.normal[0]
      batch.worldNormal[3 * i + 1] = d.normal[1]
      batch.worldNormal[3 * i + 2] = d.normal[2]
    }
  }
  return { batch, loads: mixer.loads, byRole }
}

// A path of PATH_POINTS points at equal arc length along the polyline
// (xs[0..n), ys[0..n)), every one exactly ON the polyline, with a width at
// each: baseWidth · pressure(t) when `taper`, else baseWidth. `reverse` runs it
// the other way. Returns the polyline's length.
export function polylinePath(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
  baseWidth: number,
  taper: boolean,
  reverse: boolean,
  path: Float32Array,
  width: Float32Array,
  // The world points of the polyline's vertices (and where to write the path's world points): each path point's
  // world point is on the 3D polyline at the same place its screen point is on the screen one.
  world?: Float32Array,
  ws?: ArrayLike<readonly number[]>,
): number {
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
  const total = cum[n - 1]
  for (let k = 0; k < PATH_POINTS; k++) {
    const t = k / (PATH_POINTS - 1)
    const s = (reverse ? 1 - t : t) * total
    let seg = 1
    while (seg < n - 1 && cum[seg] < s) seg++
    const span = cum[seg] - cum[seg - 1]
    const f = span > 0 ? clamp((s - cum[seg - 1]) / span, 0, 1) : 0
    path[2 * k] = xs[seg - 1] + (xs[seg] - xs[seg - 1]) * f
    path[2 * k + 1] = ys[seg - 1] + (ys[seg] - ys[seg - 1]) * f
    if (world && ws) {
      for (let c = 0; c < 3; c++) world[3 * k + c] = ws[seg - 1][c] + (ws[seg][c] - ws[seg - 1][c]) * f
    }
    width[k] = taper ? Math.max(0.35, baseWidth * pressure(t)) : baseWidth
  }
  return total
}
