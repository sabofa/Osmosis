// A frame's strokes in another view, without the model (the Paint Lab's orbit).
//
// The model decides what to paint and how: which strokes, their colours, roles, widths and edges. That
// takes tens of milliseconds, and an orbit asks for a picture every sixteen. But where a stroke lies on
// the screen is only a projection of where it lies on the surface, and the batch keeps that: worldPath, the
// stroke's path in world space before it was projected. Re-projecting it through the new view's viewProj
// puts the same stroke on the same bit of surface, so the paint rides the object while the camera moves
// and every stroke stays. The model runs once more when the camera stops, and the picture eases to the
// frame that run makes.
//
//   path    the world path through the new viewProj (CSS px, y down, as the model projects);
//   depth   the view depth of the path's first point, so the renderer's back-to-front order within a
//           layer follows the new view;
//   alpha   a stroke whose anchor turns from the viewer fades out over the model's own fade band
//           (particles.fadeLo..fadeHi of |n·v|): its alpha is scaled by the new fade over the one it
//           was made with, never up. A stroke with no normal (a line, an edge) does not fade; one
//           with a point behind the eye is hidden. An edge stroke is the outline of the view it was made for,
//           and the camera moving does not move the outline with it: the caller says how much of it is left
//           (`edgeFade`, 1 to 0 as its base ages, liveOrbit.ts edgeFade) and its alpha is scaled by that.
//
// A stroke made on the screen alone repeats its anchor for every world point (an arrowhead's barbs, a
// point's dab): it is moved with its anchor, rigidly, and not turned. A stroke with no world path (all
// zero) is left as it was. Everything else (colours, widths, roles, layers, edges) is the batch's own.
// The result shares those arrays with the batch; path, depth and alpha are new (or, given a `scratch`, the ones it keeps for
// this batch, written afresh: they are the batch's of the last call, so a frame that is to outlive the next call is copied).

import type { PaintParams } from './params'
import type { Scratch } from './scratch'
import { PATH_POINTS, ROLES, type PaintView, type StrokeBatch } from './types'

const EDGE = ROLES.indexOf('edge')

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const isOrtho = (v: PaintView): boolean => v.viewProj[3] === 0 && v.viewProj[7] === 0 && v.viewProj[11] === 0

// The unit vector from a world point toward the eye.
function toEye(v: PaintView, ortho: boolean, x: number, y: number, z: number, out: number[]): void {
  if (ortho) {
    out[0] = -v.viewDir[0]
    out[1] = -v.viewDir[1]
    out[2] = -v.viewDir[2]
    return
  }
  const dx = v.eye[0] - x
  const dy = v.eye[1] - y
  const dz = v.eye[2] - z
  const l = Math.hypot(dx, dy, dz) || 1
  out[0] = dx / l
  out[1] = dy / l
  out[2] = dz / l
}

export function reprojectStrokes(batch: StrokeBatch, from: PaintView, to: PaintView, params: PaintParams, edgeFade = 1, scratch?: Scratch): StrokeBatch {
  const n = batch.count
  const P = PATH_POINTS
  const path = scratch ? scratch.array('path', Float32Array, 2 * P * n) : new Float32Array(2 * P * n)
  const depth = scratch ? scratch.array('depth', Float32Array, n) : new Float32Array(n)
  const alpha = scratch ? scratch.array('alpha', Float32Array, n) : new Float32Array(n)
  const m = to.viewProj
  const f = from.viewProj
  const toOrtho = isOrtho(to)
  const fromOrtho = isOrtho(from)
  const lo = params.particles.fadeLo
  const hi = params.particles.fadeHi
  const world = batch.worldPath
  const normal = batch.worldNormal
  const ve = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const w0 = 3 * P * i
    const p0 = 2 * P * i
    depth[i] = batch.depth[i]
    // what the stroke is made with: an edge's is as much as its base has left of it
    const made = batch.role[i] === EDGE ? batch.alpha[i] * edgeFade : batch.alpha[i]
    alpha[i] = made
    // no world path: the stroke as it was
    let any = false
    let rigid = true
    for (let c = 0; c < 3 * P; c++) {
      const v = world[w0 + c]
      if (v !== 0) any = true
      if (c >= 3 && Math.abs(v - world[w0 + (c % 3)]) > 1e-6 * (1 + Math.abs(v))) rigid = false
    }
    if (!any) {
      for (let c = 0; c < 2 * P; c++) path[p0 + c] = batch.path[p0 + c]
      continue
    }
    const ax = world[w0]
    const ay = world[w0 + 1]
    const az = world[w0 + 2]
    let hidden = false
    // the anchor's screen position in the new view, and in the old one for a rigid stroke
    let shiftX = 0
    let shiftY = 0
    if (rigid) {
      const wn = m[3] * ax + m[7] * ay + m[11] * az + m[15]
      const wo = f[3] * ax + f[7] * ay + f[11] * az + f[15]
      if (wn <= 1e-9 || wo <= 1e-9) hidden = true
      else {
        const nx = (((m[0] * ax + m[4] * ay + m[8] * az + m[12]) / wn + 1) / 2) * to.width
        const ny = ((1 - (m[1] * ax + m[5] * ay + m[9] * az + m[13]) / wn) / 2) * to.height
        const ox = (((f[0] * ax + f[4] * ay + f[8] * az + f[12]) / wo + 1) / 2) * from.width
        const oy = ((1 - (f[1] * ax + f[5] * ay + f[9] * az + f[13]) / wo) / 2) * from.height
        shiftX = nx - ox
        shiftY = ny - oy
      }
      for (let q = 0; q < P; q++) {
        path[p0 + 2 * q] = batch.path[p0 + 2 * q] + shiftX
        path[p0 + 2 * q + 1] = batch.path[p0 + 2 * q + 1] + shiftY
      }
    } else {
      for (let q = 0; q < P; q++) {
        const x = world[w0 + 3 * q]
        const y = world[w0 + 3 * q + 1]
        const z = world[w0 + 3 * q + 2]
        const w = m[3] * x + m[7] * y + m[11] * z + m[15]
        if (w <= 1e-9) {
          hidden = true
          path[p0 + 2 * q] = batch.path[p0 + 2 * q]
          path[p0 + 2 * q + 1] = batch.path[p0 + 2 * q + 1]
          continue
        }
        path[p0 + 2 * q] = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * to.width
        path[p0 + 2 * q + 1] = ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * to.height
      }
    }
    depth[i] = (ax - to.eye[0]) * to.viewDir[0] + (ay - to.eye[1]) * to.viewDir[1] + (az - to.eye[2]) * to.viewDir[2]
    if (hidden) {
      alpha[i] = 0
      continue
    }
    // a stroke whose anchor turns away from the viewer fades out
    const nx = normal[3 * i]
    const ny = normal[3 * i + 1]
    const nz = normal[3 * i + 2]
    if (nx !== 0 || ny !== 0 || nz !== 0) {
      toEye(from, fromOrtho, ax, ay, az, ve)
      const was = smooth(lo, hi, nx * ve[0] + ny * ve[1] + nz * ve[2])
      toEye(to, toOrtho, ax, ay, az, ve)
      const now = smooth(lo, hi, nx * ve[0] + ny * ve[1] + nz * ve[2])
      alpha[i] = made * Math.min(1, now / Math.max(was, 1e-3))
    }
  }
  return { ...batch, path, depth, alpha }
}
