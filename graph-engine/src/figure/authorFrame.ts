import type { PlaneAxis, SectionPlane } from './crossSection'
import type { Vec3 } from './project3d'

// S1 — one author frame, converted at one boundary.
//
// Authors of solid figures write coordinates and planes **z-up**: the
// calculus convention, and the frame a competition solution sets up. The
// solid-figure engine keeps its internal **y-up** frame, because every byte
// it has ever emitted depends on it (the isometric projection, H1's placement
// convention, the analytic silhouettes). The two meet here, and only here.
//
// The map is the cyclic permutation
//
//   author (X, Y, Z)  ->  internal (x, y, z) = (Y, Z, X)
//   internal (x, y, z) -> author (X, Y, Z) = (z, x, y)
//
// A cyclic permutation is a proper rotation (determinant +1, so no drawing is
// ever mirrored) and it fixes the (1, 1, 1) direction — so the isometric
// camera, which looks from internal (+,+,+), looks from the author's (+,+,+)
// too. That is the textbook drawing: X toward the viewer and left, Y to the
// right, Z up. A primitive's width therefore runs along Y, its depth along X
// and its height along Z.
//
// **Nothing downstream of the grammar boundary knows the author frame
// exists.** Construction maths, sections and projection all run internally.
// The only other callers are error messages that print a coordinate or a
// plane, which convert back so the author reads their own frame.
//
// This is the solid-figure engine's frame. The *space* renderer (track 3)
// shares the z-up author convention but none of this code.

// An axis as the author writes it, z up.
export type AuthorAxis = 'x' | 'y' | 'z'

export function authorToWorld(p: Vec3): Vec3 {
  return { x: p.y, y: p.z, z: p.x }
}

export function worldToAuthor(p: Vec3): Vec3 {
  return { x: p.z, y: p.x, z: p.y }
}

// The internal axis each author axis becomes, and back. X -> z, Y -> x,
// Z -> y: exactly `authorToWorld` read off the basis vectors.
const TO_WORLD_AXIS: Record<AuthorAxis, PlaneAxis> = { x: 'z', y: 'x', z: 'y' }
const TO_AUTHOR_AXIS: Record<PlaneAxis, AuthorAxis> = { x: 'y', y: 'z', z: 'x' }

// The author's axis-plane `<axis> = at`, as the internal section plane.
// "plane z = 1" is horizontal: internal y = 1.
export function authorPlane(axis: AuthorAxis, at: number): SectionPlane {
  return { kind: 'axis', axis: TO_WORLD_AXIS[axis], at }
}

// An internal plane written the way the author wrote it — "z = 1" — for an
// error message. The number is printed as given, exactly as phase 5 did. A
// plane written some other way (phase 8) is quoted as written: "A-B-C",
// "through O perpendicular to A-G".
export function describeAuthorPlane(plane: SectionPlane): string {
  if (plane.source !== undefined) return plane.source
  if (plane.kind === 'general') return 'the plane'
  return `${TO_AUTHOR_AXIS[plane.axis]} = ${plane.at}`
}
