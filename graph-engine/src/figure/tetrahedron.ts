import { GEOM_EPS } from '../scene/geometry/types'
import { authorToWorld, worldToAuthor } from './authorFrame'
import { formatMeasure } from './measure'
import { DEFAULT_CAMERA, type Vec3 } from './project3d'
import { BASE_TURN } from './solids'

// P4 — the tetrahedron from its six edges, placed like the regular one.
//
// A competition tetrahedron is given by its edges (AIME 2024 I: AB = CD =
// sqrt 41, AC = BD = sqrt 80, AD = BC = sqrt 89), not by coordinates. The
// edges fix its shape up to a reflection; the reflection and the placement
// are fixed by a stated convention — the D5 analogue — so "deterministic"
// stays true:
//
//  - the base ABC lies in a horizontal plane, wound counter-clockwise seen
//    from above, and D is ABOVE it (that choice is the reflection);
//  - the base's centroid is on the vertical axis through the origin;
//  - the base sits at author z = -h/2 and D at +h/2, h being D's height
//    above the base plane — so the solid is centred vertically as every
//    primitive is (H1);
//  - A sits, seen from the base centroid, at the default camera's azimuth
//    plus BASE_TURN — exactly where `tetrahedron edge e` puts its A, fixed
//    against the DEFAULT camera and never the active view (V2).
//
// So six equal edges e give every lettered vertex exactly where
// `tetrahedron edge e vertices ABCD` puts it: the same convention, not a
// similar one.
//
// **Closed form, and a legible refusal when the edges cannot close.** Each
// face must satisfy the strict triangle inequality, and the Cayley-Menger
// determinant (288 V^2) must be positive. Six edges can pass every face's
// inequality and still not close into a solid (AB = AC = AD = BC = BD = 1,
// CD = 1.99): that is what the determinant catches, and without it the
// height below is the square root of a negative number.

export interface SixEdges {
  AB: number
  AC: number
  AD: number
  BC: number
  BD: number
  CD: number
}

// The four vertices, INTERNAL frame, in the order A, B, C, D. `names` are
// the author's four letters, for messages.
export function tetrahedronFromEdges(edges: SixEdges, names: readonly [string, string, string, string]): Vec3[] {
  const [a, b, c, d] = names
  const faces: [string, number, number, number][] = [
    [`${a}${b}${c}`, edges.AB, edges.BC, edges.AC],
    [`${a}${b}${d}`, edges.AB, edges.BD, edges.AD],
    [`${a}${c}${d}`, edges.AC, edges.CD, edges.AD],
    [`${b}${c}${d}`, edges.BC, edges.CD, edges.BD],
  ]
  for (const [face, p, q, r] of faces) {
    const longest = Math.max(p, q, r)
    const others = p + q + r - longest
    if (longest >= others - GEOM_EPS * Math.max(1, longest)) {
      throw new Error(
        `The face ${face} cannot close: its longest side, ${formatMeasure(longest)}, is not shorter than the other two together (${formatMeasure(others)})`
      )
    }
  }

  // Cayley-Menger, expanded for a tetrahedron: 288 V^2.
  const cm = cayleyMenger(edges)
  const scale = Math.max(1, edges.AB, edges.AC, edges.AD, edges.BC, edges.BD, edges.CD) ** 6
  if (cm <= GEOM_EPS * scale) {
    throw new Error(
      Math.abs(cm) <= GEOM_EPS * scale
        ? `These six edges close only into a flat figure: ${a}${b}${c}${d} would have no volume`
        : `These six edges cannot close into a tetrahedron ${a}${b}${c}${d}: every face is a triangle, but the four faces do not fit together`
    )
  }

  // The base in its own plane, (u, v): A at the origin, B along +u, C on
  // the +v side — counter-clockwise, seen from +w (up).
  const ab2 = edges.AB ** 2
  const ac2 = edges.AC ** 2
  const ad2 = edges.AD ** 2
  const cu = (ab2 + ac2 - edges.BC ** 2) / (2 * edges.AB)
  const cv = Math.sqrt(ac2 - cu * cu)
  // D over the base: its foot (du, dv) from the distances to A, B and C, and
  // its height from the volume, h = 3V / area(ABC) = sqrt(cm / 288) * 3 /
  // (AB * cv / 2). Taking h from the determinant rather than from
  // AD^2 - du^2 - dv^2 is what makes the check above the whole story.
  const du = (ab2 + ad2 - edges.BD ** 2) / (2 * edges.AB)
  const dv = (ac2 + ad2 - edges.CD ** 2 - 2 * cu * du) / (2 * cv)
  const height = (3 * Math.sqrt(cm / 288)) / ((edges.AB * cv) / 2)

  // Centre the base on the vertical axis, then turn it so A sits at the
  // default camera's azimuth + BASE_TURN from the base centroid.
  const gu = (edges.AB + cu) / 3
  const gv = cv / 3
  // The default camera's author azimuth, through the one frame converter.
  const camera = worldToAuthor(DEFAULT_CAMERA.direction)
  const target = Math.atan2(camera.y, camera.x) + BASE_TURN
  const turn = target - Math.atan2(-gv, -gu)
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const place = (u: number, v: number, z: number): Vec3 => {
    const x = u - gu
    const y = v - gv
    return authorToWorld({ x: x * cos - y * sin, y: x * sin + y * cos, z })
  }
  return [place(0, 0, -height / 2), place(edges.AB, 0, -height / 2), place(cu, cv, -height / 2), place(du, dv, height / 2)]
}

// 288 V^2 for a tetrahedron with these edges: the Cayley-Menger
// determinant, expanded. Positive exactly when the edges close into a solid.
export function cayleyMenger(edges: SixEdges): number {
  const [ab, ac, ad, bc, bd, cd] = [edges.AB, edges.AC, edges.AD, edges.BC, edges.BD, edges.CD].map((x) => x * x)
  const rows = [
    [0, 1, 1, 1, 1],
    [1, 0, ab, ac, ad],
    [1, ab, 0, bc, bd],
    [1, ac, bc, 0, cd],
    [1, ad, bd, cd, 0],
  ]
  return determinant(rows)
}

// A small determinant by cofactor expansion along the first row. Five by
// five, exact arithmetic in the sense that matters: a fixed sequence of
// products and sums, no pivoting and no iteration.
function determinant(m: number[][]): number {
  if (m.length === 1) return m[0][0]
  let total = 0
  for (let j = 0; j < m.length; j++) {
    if (m[0][j] === 0) continue
    const minor = m.slice(1).map((row) => row.filter((_, k) => k !== j))
    total += (j % 2 === 0 ? 1 : -1) * m[0][j] * determinant(minor)
  }
  return total
}
