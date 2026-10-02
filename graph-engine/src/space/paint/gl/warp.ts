// Where a pixel of one view lies in another (fix round 1, B7): the arithmetic of the underpainting's reverse
// warp, in plain numbers, so it can be tested without a GPU. The shader (shaders/underpaint.ts, the WARP variant)
// does exactly this per pixel.
//
// The underpainting is an image of the last full frame's view: what the model painted for every pixel of a form,
// at G-buffer resolution. While the camera moves it has to move with the surface, not stay on the glass. The
// warp is done backwards, so there are no holes in what it fills: for each pixel of the NEW view the scene's
// depth there (the depth pass) says which surface point it shows; that point is projected into the OLD view to
// find where the image holds its colour, and the old depth there says whether the point was visible in the old
// view at all (a surface the old view could not see has no colour in the image: it gets the form's mean colour).

import { invert } from '../../camera/mat4'
import type { PaintView } from '../types'

// The inverse of a view's viewProj (column-major, Float64), or null for a singular matrix.
export function inverseViewProj(view: PaintView): Float64Array | null {
  return invert(new Float64Array(view.viewProj))
}

// The distance along the view direction from the eye to a world point (what the G-buffer and the depth pass hold).
export function viewDepth(view: PaintView, p: ArrayLike<number>): number {
  return (p[0] - view.eye[0]) * view.viewDir[0] + (p[1] - view.eye[1]) * view.viewDir[1] + (p[2] - view.eye[2]) * view.viewDir[2]
}

// The world point seen at CSS px (x, y) of `view` at view depth `depth`: the pixel's ray (the unprojection of
// its near and far points) at the parameter whose view depth is `depth`. Right for a perspective camera and an
// orthographic one alike, since the view depth is linear along any ray.
export function unprojectAtDepth(view: PaintView, inverse: Float64Array, x: number, y: number, depth: number): [number, number, number] {
  const nx = (x / view.width) * 2 - 1
  const ny = 1 - (y / view.height) * 2
  const at = (z: number): [number, number, number] => {
    const w = inverse[3] * nx + inverse[7] * ny + inverse[11] * z + inverse[15]
    return [
      (inverse[0] * nx + inverse[4] * ny + inverse[8] * z + inverse[12]) / w,
      (inverse[1] * nx + inverse[5] * ny + inverse[9] * z + inverse[13]) / w,
      (inverse[2] * nx + inverse[6] * ny + inverse[10] * z + inverse[14]) / w,
    ]
  }
  const near = at(-1)
  const far = at(1)
  const dn = viewDepth(view, near)
  const df = viewDepth(view, far)
  const s = df === dn ? 0 : (depth - dn) / (df - dn)
  return [near[0] + (far[0] - near[0]) * s, near[1] + (far[1] - near[1]) * s, near[2] + (far[2] - near[2]) * s]
}

// A world point in CSS px of `view`, and its view depth; null behind the eye.
export function projectToView(view: PaintView, p: ArrayLike<number>): { x: number; y: number; depth: number } | null {
  const m = view.viewProj
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  if (w <= 1e-9) return null
  const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
  const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
  return { x: ((cx / w + 1) / 2) * view.width, y: ((1 - cy / w) / 2) * view.height, depth: viewDepth(view, p) }
}

// Where the surface seen at CSS px (x, y) of `to`, at view depth `depthTo`, was in `from`: its CSS px there and
// its view depth there (what the old G-buffer's depth at that px must match for the point to have been visible).
export function sourceOf(
  from: PaintView,
  to: PaintView,
  inverseTo: Float64Array,
  x: number,
  y: number,
  depthTo: number,
): { x: number; y: number; depth: number } | null {
  return projectToView(from, unprojectAtDepth(to, inverseTo, x, y, depthTo))
}

// Was a point at old view depth `depth` visible in the frame whose G-buffer holds `oldDepth` there? It was when it
// lies within `tolerance` of that depth.
export const wasVisible = (depth: number, oldDepth: number, tolerance: number): boolean => Math.abs(depth - oldDepth) <= tolerance
