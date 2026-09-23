import { rectangularPrism, type Solid3D, type Vec3 } from './project3d'

// The solid vocabulary: what an author can ask for, where it sits, and what
// its dimensions are called.
//
// ---------------------------------------------------------------------------
// H1 — every primitive states its placement
// ---------------------------------------------------------------------------
//
// Constraints fix a solid's **shape**, not where it sits. A solved triangle
// needed a placement convention for exactly this reason (first vertex at the
// origin, second on +x, third above), and without one for solids
// "deterministic" quietly stops being true.
//
// **The convention, for every primitive in this module:**
//
//  1. The solid is centred on the origin.
//  2. Its axis of symmetry is the **y-axis**, so the solid spans
//     `-h/2 <= y <= h/2` and the drawing's vertical direction is the solid's
//     own height — which is what makes a height dimension readable off the
//     page under the isometric camera.
//  3. Every cross-section perpendicular to that axis is centred on the axis,
//     so a base, a mid-section and a top all share a centre.
//  4. Rotation about the axis is pinned too, and the base's **first vertex
//     faces the viewer**. In the xz-plane the default isometric camera looks
//     along (1,0,1)/sqrt(2), so that is 45 degrees from +x — the direction
//     `BASE_START_ANGLE` names. A rectangular base stays **axis-aligned**
//     (width along x, depth along z) and simply starts at its (+x, +z)
//     corner; a regular polygonal base puts a vertex there outright.
//
//     The rule is not decoration. Under the isometric camera a face is
//     exactly edge-on when its outward normal turns 104.5 degrees off the
//     view, and a tetrahedron whose first base vertex sits on +x lands one
//     of its three faces within a degree of that — half its edges dashed,
//     and a classification that a rounding error could flip. Starting the
//     base at the viewer puts every lateral face as far from edge-on as the
//     shape allows, which is both the conventional drawing and the stable
//     one.
//
// A sphere has no axis, so only (1) applies to it.
//
// Rule 1 is `rectangularPrism`'s existing convention, extended rather than
// replaced: a prism built here is bit-for-bit the prism phase 2 built.

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export type SolidSpec =
  | { kind: 'prism'; width: number; height: number; depth: number }
  | { kind: 'pyramid'; base: number; height: number }
  | { kind: 'tetrahedron'; edge: number }

// The primitive names an author can write, in the order an error message
// should list them.
export const SOLID_PRIMITIVES = ['prism', 'pyramid', 'tetrahedron'] as const

export type SolidPrimitiveName = (typeof SOLID_PRIMITIVES)[number]

// A built solid.
//
// **H2 — two representations behind one interface.** Polyhedra carry
// vertices-and-faces and are drawn by the convex hidden-edge rule; curved
// primitives (task 4) carry their parameters and emit an analytic silhouette
// instead. `polyhedron` is null for the second kind, and no caller may assume
// a solid has vertices.
export interface SolidBody {
  spec: SolidSpec
  polyhedron: Solid3D | null
  // The vertex indices in the order an author's `vertices ABCD` names apply.
  // Separate from the solid's own vertex order because `rectangularPrism`'s
  // is a binary count over (x, y, z) — the order its faces were written
  // against, and the order the byte-identical requirement pins — while the
  // order a *problem* names a prism's vertices in is "base, then top, so A
  // sits under E". Empty for a solid with no vertices to name.
  labelOrder: number[]
}

export function buildSolid(spec: SolidSpec): SolidBody {
  switch (spec.kind) {
    case 'prism':
      return {
        spec,
        polyhedron: rectangularPrism(spec.width, spec.height, spec.depth),
        // rectangularPrism's vertices are (-x,-y,-z), (x,-y,-z), (x,y,-z),
        // (-x,y,-z) then the same four at +z. The base (y = -h/2) is
        // therefore 0, 1, 5, 4 and the top 3, 2, 6, 7 — matched position for
        // position, so A is under E.
        labelOrder: [0, 1, 5, 4, 3, 2, 6, 7],
      }
    case 'pyramid':
      return { spec, polyhedron: squarePyramid(spec.base, spec.height), labelOrder: [0, 1, 2, 3, 4] }
    case 'tetrahedron':
      return { spec, polyhedron: regularTetrahedron(spec.edge), labelOrder: [0, 1, 2, 3] }
  }
}

// ---------------------------------------------------------------------------
// Polyhedra
// ---------------------------------------------------------------------------

// Rule 4's angle: the default camera's view direction projected onto a base
// plane perpendicular to the axis, which is (1, 0, 1)/sqrt(2) — 45 degrees
// round from +x. A rectangular base's (+x, +z) corner is this same direction.
export const BASE_START_ANGLE = Math.PI / 4

// A pyramid on a square base, base at y = -h/2 and apex at (0, h/2, 0).
//
// The base is wound so its outward normal is -y (it is the bottom face), and
// each lateral face is the base edge **reversed** plus the apex, which is what
// winds it counter-clockwise seen from outside.
export function squarePyramid(base: number, height: number): Solid3D {
  const b = base / 2
  const y = height / 2
  const vertices: Vec3[] = [
    { x: b, y: -y, z: b },
    { x: -b, y: -y, z: b },
    { x: -b, y: -y, z: -b },
    { x: b, y: -y, z: -b },
    { x: 0, y: y, z: 0 },
  ]
  const faces = [[0, 1, 2, 3], ...lateralFaces(4, 4)]
  return { vertices, faces }
}

// The regular tetrahedron of the given edge length: an equilateral base with
// its circumradius e/sqrt(3), the apex e*sqrt(2/3) above it, and the whole
// thing dropped so the base sits at -h/2.
export function regularTetrahedron(edge: number): Solid3D {
  const radius = edge / Math.sqrt(3)
  const height = edge * Math.sqrt(2 / 3)
  const y = height / 2
  const vertices: Vec3[] = []
  for (let i = 0; i < 3; i++) {
    // First vertex toward the viewer (rule 4), then round the base.
    const angle = BASE_START_ANGLE + (2 * Math.PI * i) / 3
    vertices.push({ x: radius * Math.cos(angle), y: -y, z: radius * Math.sin(angle) })
  }
  vertices.push({ x: 0, y, z: 0 })
  const faces = [[0, 1, 2], ...lateralFaces(3, 3)]
  return { vertices, faces }
}

// The faces joining an n-gon base (vertices 0..n-1, wound so its normal is
// -y) to an apex. Each is `[j, i, apex]` for base edge i -> j: the base edge
// reversed, which flips the winding from "seen from below" to "seen from
// outside the side of the solid".
function lateralFaces(n: number, apex: number): number[][] {
  const faces: number[][] = []
  for (let i = 0; i < n; i++) faces.push([(i + 1) % n, i, apex])
  return faces
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

// What `label: S height` can name, and what it measures to.
//
// Read off the SPEC, never off the drawing: a projected edge's length is a
// fact about the camera, and printing it would put a number on the figure
// that contradicts the solid the author asked for. This is the same
// commitment "label: AB" makes in 2D, where the drawing IS the geometry;
// here the two differ and the geometry wins.
export function solidDimensions(spec: SolidSpec): Record<string, number> {
  switch (spec.kind) {
    case 'prism':
      return { width: spec.width, height: spec.height, depth: spec.depth }
    case 'pyramid':
      return { base: spec.base, height: spec.height }
    case 'tetrahedron':
      return { edge: spec.edge }
  }
}
