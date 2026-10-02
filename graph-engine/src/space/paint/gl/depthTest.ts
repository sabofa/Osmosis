// The stroke shader's depth test, in plain numbers (fix round 2, item 12): the TypeScript twin of sceneSlope, depthVisible
// and formVisible in shaders/stroke.ts, as warp.ts is the twin of the underpainting's warp. The shader builds its
// constants from this file, and the tests run these functions against the model's real strokes, so what the GLSL
// decides is checked in numbers and not only as text.
//
// What the test is for. While the camera moves the last full frame's strokes are re-projected, and some of them then
// lie where the surface they were painted on no longer is. The renderer draws the opaque meshes' view depth for the
// new view (shaders/depth.ts), and each stroke fragment is compared with it:
//   depthVisible  a stroke behind a surface is faded out, over a tolerance that grows with the surface's slope across
//                 the stroke (every role);
//   formVisible   an edge stroke is a decal, the screen path of a contour lifted onto the surface it followed. As the
//                 view turns, the decal can leave its form altogether (the form's surface is no longer under it, or a
//                 very different depth is). That is tested once per stroke, at its point nearest the viewer (anchorOf),
//                 and not at every fragment: a ribbon on a silhouette has half its fragments on the background side by
//                 construction, and the far side of the outline is not "behind" the form it outlines. And not at every
//                 point either: a mark may cross an occlusion boundary (a pull from the figure into the table behind
//                 it), and then part of it lies on no surface at all.

import { NO_SURFACE } from './depth'

// The most the surface may change in depth over one pixel, in biases, for the slope that widens the tolerance.
export const DEPTH_SLOPE_CAP = 8

// How far from an edge stroke's centreline the form is looked for, in CSS px. The model put each decal point at the
// nearest depth of its own 3 x 3 G-buffer pixels (GBUFFER_SCALE CSS px each, their depths at the pixel centres), and
// those samples lie at most this far from the point.
export const FORM_REACH = 3

// The scene's depth image, in the orientation the shader reads it: pixel (x, y) in backing px, GL's y up, NO_SURFACE
// where nothing opaque is drawn. `at` is only called with pixels inside the image.
export interface SceneDepthImage {
  width: number
  height: number
  at(x: number, y: number): number
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const texel = (depth: SceneDepthImage, x: number, y: number): number =>
  depth.at(Math.min(Math.max(x, 0), depth.width - 1), Math.min(Math.max(y, 0), depth.height - 1))

// The change of depth over a pixel at (x, y): the smaller of the two one-sided differences on each axis (so the far
// side of a silhouette is not mistaken for a slope), the larger of the two axes, and capped.
export function sceneSlope(depth: SceneDepthImage, x: number, y: number, bias: number): number {
  const zc = texel(depth, x, y)
  const zl = texel(depth, x - 1, y)
  const zr = texel(depth, x + 1, y)
  const zd = texel(depth, x, y - 1)
  const zu = texel(depth, x, y + 1)
  return Math.min(Math.max(Math.min(Math.abs(zc - zl), Math.abs(zr - zc)), Math.min(Math.abs(zc - zd), Math.abs(zu - zc))), DEPTH_SLOPE_CAP * bias)
}

// How much of a stroke is seen at pixel (x, y), whose view depth there is `vz` and half width `hw` CSS px: 1 in front
// of or on the surface, 0 well behind it. The tolerance is the bias plus the slope (per backing px) across the half
// width in backing px (at least 1.5), because the stroke's depth is its centreline's and its edges lie on a tilted
// surface at other depths.
export function depthVisible(depth: SceneDepthImage, x: number, y: number, vz: number, hw: number, bias: number, pixelRatio: number): number {
  const slope = sceneSlope(depth, x, y, bias)
  const tol = bias + slope * Math.max(hw * pixelRatio, 1.5)
  return 1 - sstep(tol, 2 * tol, vz - texel(depth, x, y))
}

// Where a CSS px position of the view lies in the depth image (GL's y up, so y is flipped), as continuous pixels.
export function glPixel(cssX: number, cssY: number, cssWidth: number, cssHeight: number, width: number, height: number): [number, number] {
  return [(cssX / cssWidth) * width, (1 - cssY / cssHeight) * height]
}

// The point of a decal that stands for it: the nearest the viewer, the first of equals (the shader's loop). `depths`
// are the view depths of its world points in the view being drawn.
export function anchorOf(depths: ArrayLike<number>): number {
  let kn = 0
  let zn = NO_SURFACE
  for (let k = 0; k < depths.length; k++) {
    if (depths[k] < zn) {
      zn = depths[k]
      kn = k
    }
  }
  return kn
}

// Has an edge decal left its form? `cssX, cssY` is its anchor point (on the screen) and `vz` the view depth of that
// point of the decal. A decal is on its form when some surface within FORM_REACH CSS px of the point lies at the decal's depth:
// the pixel under an outline is the background's, and the decal's own surface is a pixel or two away; a decal on the
// table beside a figure has the figure within reach, and the table at its own depth. The closest depth match is the
// form, and the decal stays while it is within the bias plus the slope there across that reach (a limb is steep, and the
// model's depth and this one are sampled at different pixels). It goes when no surface within reach is at its depth:
// it floats in front of a far surface, or lies over nothing.
export function formVisible(
  depth: SceneDepthImage,
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number,
  vz: number,
  pixelRatio: number,
  bias: number,
): number {
  const [cx, cy] = glPixel(cssX, cssY, cssWidth, cssHeight, depth.width, depth.height)
  let off = NO_SURFACE
  let mx = 0
  let my = 0
  for (let dy = -FORM_REACH; dy <= FORM_REACH; dy++) {
    for (let dx = -FORM_REACH; dx <= FORM_REACH; dx++) {
      const px = Math.min(Math.max(Math.floor(cx + dx * pixelRatio), 0), depth.width - 1)
      const py = Math.min(Math.max(Math.floor(cy + dy * pixelRatio), 0), depth.height - 1)
      const d = Math.abs(depth.at(px, py) - vz)
      if (d < off) {
        off = d
        mx = px
        my = py
      }
    }
  }
  const tol = bias + sceneSlope(depth, mx, my, bias) * FORM_REACH * pixelRatio
  return 1 - sstep(tol, 2 * tol, off)
}
