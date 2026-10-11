// An arrowhead's shape (plan G9 "Arrows", revised in the S2 review). Pure,
// and the single source of the rule: the GLSL below is generated from the
// same constants, and both the arrowhead and the line (shaft) shaders embed
// it.
//
// - Within 12 degrees of the view direction, either way, the vector points
//   at or away from the viewer: a ring of headSize px, the textbook "vector
//   out of the page". The decision is by angle, not projected length, so a
//   zoomed-out vector field keeps its triangles.
// - Otherwise a triangle pointing along the projected direction, headSize px
//   long but never longer than 45% of the projected length, so a short
//   vector keeps a head that fits it.
// - A triangle that would be under 4 px long is drawn as a 4 px dot.

import type { Vec3 } from '../scene/types'

export const RING_MAX_DEGREES = 12
export const RING_COS = Math.cos((RING_MAX_DEGREES * Math.PI) / 180)
export const HEAD_MAX_FRACTION = 0.45
export const HEAD_MIN_PX = 4
export const DOT_DIAMETER_PX = 4

export interface ArrowHeadShape {
  kind: 'ring' | 'triangle' | 'dot'
  // CSS px: the triangle's length, the ring's diameter, or the dot's diameter.
  length: number
}

// `vector` in world (any length), `toEye` a unit world direction toward the
// eye at the tip, `projectedLength` and `headSize` in CSS px.
export function arrowHeadKind(vector: Vec3, toEye: Vec3, projectedLength: number, headSize: number): ArrowHeadShape {
  const n = Math.hypot(vector[0], vector[1], vector[2])
  if (!(n > 0)) return { kind: 'dot', length: DOT_DIAMETER_PX }
  const cos = Math.abs(vector[0] * toEye[0] + vector[1] * toEye[1] + vector[2] * toEye[2]) / n
  if (cos > RING_COS) return { kind: 'ring', length: headSize }
  const length = Math.min(headSize, HEAD_MAX_FRACTION * projectedLength)
  if (length < HEAD_MIN_PX) return { kind: 'dot', length: DOT_DIAMETER_PX }
  return { kind: 'triangle', length }
}

// GLSL: arrowHead(vectorWorld, toEye, projectedCss, headSizeCss, out lengthCss)
// returns 0 triangle, 1 ring, 2 dot, exactly as arrowHeadKind.
export const ARROW_HEAD_GLSL = /* glsl */ `
const float RING_COS = ${RING_COS.toFixed(9)};
const float HEAD_MAX_FRACTION = ${HEAD_MAX_FRACTION.toFixed(3)};
const float HEAD_MIN_PX = ${HEAD_MIN_PX.toFixed(1)};
const float DOT_DIAMETER_PX = ${DOT_DIAMETER_PX.toFixed(1)};
int arrowHead(vec3 v, vec3 toEye, float projected, float headSize, out float len) {
  float n = length(v);
  if (n <= 0.0) { len = DOT_DIAMETER_PX; return 2; }
  if (abs(dot(v / n, toEye)) > RING_COS) { len = headSize; return 1; }
  len = min(headSize, HEAD_MAX_FRACTION * projected);
  if (len < HEAD_MIN_PX) { len = DOT_DIAMETER_PX; return 2; }
  return 0;
}
`
