import { GEOM_EPS } from '../scene/geometry/types'
import { add3, angle3, cross3, dot3, length3, scale3, sub3, type Dihedral3 } from './construct3d'
import { hidesPoint } from './occlusion'
import type { Camera, ProjectedArc, Vec3 } from './project3d'
import { projectCircle } from './silhouette'
import type { SolidBody } from './solids'

// Marks on points in space (phase 10): angle arcs, right-angle squares and
// the dihedral's plane angle. Camera-free except where a mark is projected.
//
// **M1 — a mark lives in the angle's own plane in space, then projects.** An
// angle arc is a circle arc centred at the vertex in the plane of the three
// points; under the orthographic camera it is an elliptical arc, drawn by
// the one closed form every circle in space uses (`projectCircle`). A right
// angle's square is a square in space, drawn as the parallelogram it
// projects to. Sizes are fractions of the angle's shorter arm, in world
// units, so a mark is the same shape whatever the view. (Congruence ticks
// are the exception: they annotate the DRAWING, and are drawn in the picture
// plane by the 2D convention — see render.ts.)
//
// **M4 — visibility.** A mark is small, so it is drawn whole: entirely
// visible or entirely hidden, decided by ONE point — an arc's middle, a
// square's centre, a tick's point on its segment — against every solid by
// the glass rule's ray test (`hidesPoint`). It is a stated drawing
// convention, not a geometric answer: it never locates a split, and a mark
// straddling an outline is drawn by its middle. (A dihedral's construction
// SEGMENTS are not marks: they are split exactly, by `segmentSpans`.)

// M1 — the arc's radius, and the right-angle square's side, as fractions of
// the shorter arm.
export const SPACE_ARC_FRACTION = 0.2
export const SPACE_SQUARE_FRACTION = 0.15

// An angle's own frame in space: `u` the unit ray toward `from`, `v` the
// unit direction in the angle's plane square to `u` on the side of `to`, the
// true angle between the rays, and the shorter arm's length.
export interface AngleFrame {
  vertex: Vec3
  u: Vec3
  v: Vec3
  angle: number
  arm: number
}

// Degenerate angles are refused in the author's names: an arm of zero length
// (angle3's own message), or three points in a line, which lie on no one
// plane — a straight angle in space has no side to draw its arc on.
export function angleFrame(vertex: Vec3, from: Vec3, to: Vec3, names: { from: string; vertex: string; to: string }): AngleFrame {
  const angle = angle3(vertex, from, to, `angle ${names.from}${names.vertex}${names.to}`)
  const a = sub3(from, vertex)
  const b = sub3(to, vertex)
  const [la, lb] = [length3(a), length3(b)]
  const u = scale3(a, 1 / la)
  const w = sub3(b, scale3(u, dot3(b, u)))
  // |a x b| = |a||b| sin(angle): negligible against |a||b| is collinearity,
  // whatever the arms' lengths (planeThrough's test).
  if (length3(cross3(a, b)) <= GEOM_EPS * Math.max(1, la * lb)) {
    throw new Error(
      `${names.from}, ${names.vertex} and ${names.to} are collinear, so angle ${names.from}-${names.vertex}-${names.to} has no plane to draw its mark in`
    )
  }
  return { vertex, u, v: scale3(w, 1 / length3(w)), angle, arm: Math.min(la, lb) }
}

// The arc `center + u cos t + v sin t` for t in [0, sweep]: u and v are the
// frame's axes scaled to the radius, so t = 0 lies on the ray toward `from`
// and t = sweep on the ray toward `to`.
export interface SpaceArc {
  center: Vec3
  u: Vec3
  v: Vec3
  radius: number
  sweep: number
}

export function angleArc(frame: AngleFrame, radius = SPACE_ARC_FRACTION * frame.arm): SpaceArc {
  return { center: frame.vertex, u: scale3(frame.u, radius), v: scale3(frame.v, radius), radius, sweep: frame.angle }
}

export function arcPoint(arc: SpaceArc, t: number): Vec3 {
  return add3(arc.center, add3(scale3(arc.u, Math.cos(t)), scale3(arc.v, Math.sin(t))))
}

// The arc's middle: where M4 judges it, and where a label hangs (M7).
export function arcMiddle(arc: SpaceArc): Vec3 {
  return arcPoint(arc, arc.sweep / 2)
}

// The unit bisector of the angle, in space: the direction from the vertex
// through the arc's middle.
export function arcBisector(arc: SpaceArc): Vec3 {
  return scale3(sub3(arcMiddle(arc), arc.center), 1 / arc.radius)
}

// The arc through the camera: a piece of the ellipse its circle projects to,
// between the circle's own angles 0 and sweep.
export function projectArc(arc: SpaceArc, camera: Camera, object: string, hidden = false): ProjectedArc {
  const circle = projectCircle(camera, arc.center, arc.u, arc.v)
  return {
    kind: 'arc',
    center: circle.center,
    rx: circle.rx,
    ry: circle.ry,
    rotation: circle.rotation,
    startAngle: circle.parameter(0),
    endAngle: circle.parameter(arc.sweep),
    hidden,
    object,
  }
}

// M1 — the right angle's square in space: B, B + s u, B + s u + s v, B + s v,
// s = 0.15 x the shorter arm. Drawn as the three outer corners (the "L"),
// exactly as the plane draws its square: the two rays already draw the
// other two sides.
export function rightAngleCorners(frame: AngleFrame, side = SPACE_SQUARE_FRACTION * frame.arm): [Vec3, Vec3, Vec3, Vec3] {
  const su = scale3(frame.u, side)
  const sv = scale3(frame.v, side)
  return [frame.vertex, add3(frame.vertex, su), add3(frame.vertex, add3(su, sv)), add3(frame.vertex, sv)]
}

// M3 — a dihedral angle's mark: its PLANE angle, drawn at the edge's
// midpoint M. Two construction segments, M -> M + l u and M -> M + l v (u, v
// the unit directions square to the edge, into each half-plane —
// dihedral3's), and M1's arc between them (radius 0.2 l).
//
// l = 0.3 x the edge, **but never longer than either end point's distance
// from the edge's line** (a correction to the plan, which says 0.3 x the
// edge alone). Past that distance a segment runs beyond the point that
// defines its half-plane, out of the face it lies in: in the AIME 2016 I
// prism, 0.3 |BF| = 6.24 but A is only 6 from BF, so the segment toward A
// poked 0.24 out of the prism past its vertex A and drew a visible stub
// outside the solid. Capped, it ends exactly at A. Wherever 0.3 x the edge
// is short enough — the cube, the regular solids — nothing changes.
export const DIHEDRAL_SEGMENT_FRACTION = 0.3

export interface DihedralMark {
  mid: Vec3
  ends: [Vec3, Vec3]
  arc: SpaceArc
}

// Two half-planes that make one plane (180) or one half-plane (0) have no
// plane angle with a side to draw it on, and are refused by name.
export function dihedralMark(dihedral: Dihedral3, edgeLength: number, name = 'the dihedral'): DihedralMark {
  const segment = Math.min(DIHEDRAL_SEGMENT_FRACTION * edgeLength, ...dihedral.reach)
  const ends: [Vec3, Vec3] = [add3(dihedral.mid, scale3(dihedral.u, segment)), add3(dihedral.mid, scale3(dihedral.v, segment))]
  if (length3(cross3(dihedral.u, dihedral.v)) <= GEOM_EPS) {
    const degrees = dot3(dihedral.u, dihedral.v) < 0 ? 180 : 0
    throw new Error(`The half-planes of ${name} lie in one plane (it measures ${degrees}°), so it has no plane angle to draw`)
  }
  const arc = angleArc(angleFrame(dihedral.mid, ends[0], ends[1], { from: 'U', vertex: 'M', to: 'V' }))
  return { mid: dihedral.mid, ends, arc }
}

// M4 — whether a mark judged at `at` is hidden: the glass rule's ray test,
// against every solid.
export function markHidden(at: Vec3, solids: readonly SolidBody[], camera: Camera): boolean {
  return solids.some((body) => hidesPoint(body, at, camera))
}
