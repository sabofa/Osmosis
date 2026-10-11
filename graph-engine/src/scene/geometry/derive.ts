import type { GraphConfig } from '../../parser/config'
import type { Vec2 } from '../types'
import { add, footOfPerpendicular, type GeometryLine, scale, sub } from './objects'

// Points derived from other points and lines. Every one of these is a closed
// form over Vec2 — no sampling, no iteration, no tolerance to tune.
//
// `foot` is the construction this whole phase exists for: "the altitude from
// A to the hypotenuse" was unauthorable in v1 because the author had to solve
// for the foot by hand before they could type the segment.

export type AngleMode = GraphConfig['angle']

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// The point dividing A-B in the ratio m:n, measured *from A*. So 2:3 sits two
// fifths of the way along, not three fifths — the convention every textbook
// uses and the one "divide A-B at 2:3" reads as.
//
// Both parts must be non-negative and not both zero. A negative part would be
// an external division, which is a different construction with a different
// picture; silently accepting one here would put the point outside the
// segment the author named.
export function divide(a: Vec2, b: Vec2, m: number, n: number): Vec2 {
  if (!(m >= 0) || !(n >= 0) || m + n === 0) {
    throw new Error(`A ratio must be two non-negative parts that are not both zero, got ${m}:${n}`)
  }
  return add(a, scale(sub(b, a), m / (m + n)))
}

// The foot of the perpendicular from p to the line. Measured against the
// underlying infinite line even when the object is a segment or a ray: see
// objects.ts for why that is deliberate.
export function foot(p: Vec2, l: GeometryLine): Vec2 {
  return footOfPerpendicular(p, l)
}

// The mirror image of p across the line: twice the foot, less p.
export function reflect(p: Vec2, l: GeometryLine): Vec2 {
  const f = footOfPerpendicular(p, l)
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y }
}

// Rotation about a centre, counter-clockwise for a positive angle. The angle
// is read in whichever unit the spec's "@angle" directive selected, the same
// as every other angle in the engine — an author who wrote "@angle: degrees"
// at the top of the spec should not have to switch units mid-figure.
export function rotate(p: Vec2, center: Vec2, angle: number, mode: AngleMode): Vec2 {
  const radians = mode === 'degrees' ? (angle * Math.PI) / 180 : angle
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const v = sub(p, center)
  return { x: center.x + v.x * cos - v.y * sin, y: center.y + v.x * sin + v.y * cos }
}

export function translate(p: Vec2, by: Vec2): Vec2 {
  return add(p, by)
}

// Scaling about a centre. A negative factor is allowed and means what it
// means geometrically — the image lands on the far side of the centre, so -1
// is a half-turn — rather than being rejected as nonsense.
export function dilate(p: Vec2, center: Vec2, factor: number): Vec2 {
  if (!Number.isFinite(factor)) throw new Error(`A dilation factor must be a finite number, got ${factor}`)
  return add(center, scale(sub(p, center), factor))
}
