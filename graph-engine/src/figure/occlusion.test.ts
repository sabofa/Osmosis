import { describe, expect, it } from 'vitest'
import { hidesPoint, occlusionCandidates, segmentSpans, type Span } from './occlusion'
import { faceNormal, ISOMETRIC_CAMERA, type Vec3 } from './project3d'
import { placementAlong } from './silhouette'
import { buildSolid } from './solids'

// S6 — the glass rule for construction segments, against polyhedra.
//
// Everything here is in the INTERNAL y-up frame, where the isometric camera
// looks from (1,1,1). The 8-by-5-by-6 prism spans x in [-4, 4], y in
// [-2.5, 2.5], z in [-3, 3]; its three front faces are +x, +y, +z, and its
// one hidden corner is (-4,-2.5,-3), which textbook lettering names D.

const camera = ISOMETRIC_CAMERA
const PRISM = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

// The prism's vertices by the letters "vertices ABCDEFGH" gives them.
const NAMED = Object.fromEntries(
  'ABCDEFGH'.split('').map((name, i) => [name, PRISM.polyhedron!.vertices[PRISM.labelOrder[i]]])
) as Record<string, Vec3>

function spans(a: Vec3, b: Vec3): Span[] {
  return segmentSpans(a, b, [PRISM], camera)
}

function expectSpans(actual: Span[], expected: [number, number, boolean][]): void {
  expect(actual.map((s) => s.hidden)).toEqual(expected.map((e) => e[2]))
  actual.forEach((span, i) => {
    expect(span.from).toBeCloseTo(expected[i][0], 12)
    expect(span.to).toBeCloseTo(expected[i][1], 12)
  })
}

describe('the ray test (hidesPoint)', () => {
  it('hides a point inside the solid and one behind it, not one in front', () => {
    expect(hidesPoint(PRISM, v(0, 0, 0), camera)).toBe(true)
    expect(hidesPoint(PRISM, v(-5, -3.5, -4), camera)).toBe(true)
    expect(hidesPoint(PRISM, v(5, 3.5, 4), camera)).toBe(false)
  })

  it('shows a point on a front face and hides one on a back face', () => {
    expect(hidesPoint(PRISM, v(0, 0, 3), camera)).toBe(false)
    expect(hidesPoint(PRISM, v(0, 0, -3), camera)).toBe(true)
  })
})

describe('segments against a prism', () => {
  it('draws the space diagonal A-G as one hidden span', () => {
    expectSpans(spans(NAMED.A, NAMED.G), [[0, 1, true]])
  })

  it('draws a diagonal of a front face as one visible span', () => {
    // EFGH is the top (+y), a front face under the isometric camera.
    expectSpans(spans(NAMED.E, NAMED.G), [[0, 1, false]])
    // BCGF is the +x face, also in front.
    expectSpans(spans(NAMED.B, NAMED.G), [[0, 1, false]])
  })

  it('draws a diagonal of a back face as one hidden span', () => {
    // ABCD is the bottom (-y), turned away from the camera.
    expectSpans(spans(NAMED.B, NAMED.D), [[0, 1, true]])
  })

  it('draws a segment through the prism visible, hidden, visible — split where it enters and where it leaves the shadow', () => {
    // Straight down the internal z-axis from (0,0,6) to (0,0,-12): z = 6 - 18u.
    //
    // It ENTERS the prism through the +z face (a front face) at z = 3, so
    // u = 1/6: on the face it is visible, just inside it is hidden. That
    // split is a FACE-PLANE candidate.
    //
    // It leaves the prism through the back face at z = -3 but stays hidden:
    // the ray toward the viewer from (0,0,z0) is (t, t, z0 + t), and it is
    // inside the prism for some t > 0 exactly when -3 - z0 < 2.5 (the y
    // bound caps t at 2.5). So it is hidden down to z0 = -5.5, where the ray
    // grazes the silhouette edge y = 2.5, z = -3 (EF) at (2.5, 2.5, -3).
    // u = 11.5/18 = 23/36. That split is a SILHOUETTE-PLANE candidate.
    expectSpans(spans(v(0, 0, 6), v(0, 0, -12)), [
      [0, 1 / 6, false],
      [1 / 6, 23 / 36, true],
      [23 / 36, 1, false],
    ])
  })

  it('splits a segment wholly behind the prism at the projected silhouette', () => {
    // y = 0, z = -4 (behind the back face), x from -10 to 10. The ray
    // (x + t, t, -4 + t) is inside for t in (1, 2.5) intersected with
    // (-4 - x, 4 - x): nonempty exactly when -6.5 < x < 3. Those are where
    // the ray grazes the silhouette edges EH (x = -4, y = 2.5) and BF
    // (x = 4, z = -3), and NOT where the segment passes the faces x = +-4.
    // u = (x + 10) / 20.
    expectSpans(spans(v(-10, 0, -4), v(10, 0, -4)), [
      [0, 3.5 / 20, false],
      [3.5 / 20, 13 / 20, true],
      [13 / 20, 1, false],
    ])
  })

  it('draws a segment clear of the prism as one visible span', () => {
    expectSpans(spans(v(10, 10, 10), v(12, 0, 10)), [[0, 1, false]])
  })

  it('shows a segment along a visible edge and hides one along a hidden edge', () => {
    // Textbook lettering (phase 6b): D is the hidden corner, and A sits in
    // FRONT of it along internal z, which is author X (E, not A, is the one
    // above). FG joins the +x and +y faces, both in front; DA joins -x and
    // -y, both turned away.
    expect(NAMED.D).toEqual({ x: -4, y: -2.5, z: -3 })
    expect(NAMED.A).toEqual({ x: -4, y: -2.5, z: 3 })
    expectSpans(spans(NAMED.F, NAMED.G), [[0, 1, false]])
    expectSpans(spans(NAMED.D, NAMED.A), [[0, 1, true]])
  })

  it('judges a segment lying ACROSS an oblique face by the face, not by rounding', () => {
    // A tetrahedron's faces are oblique, so a point on one is on it only to
    // rounding. Every median of every face — vertex to the midpoint of the
    // opposite edge — is visible on a front face and hidden on a back face.
    // Without the solid's rounding-sized margin, four front medians of the
    // edge-0.7 tetrahedron come out dashed.
    const tetra = buildSolid({ kind: 'tetrahedron', edge: 0.7 })
    const solid = tetra.polyhedron!
    let checked = 0
    solid.faces.forEach((face, f) => {
      const n = faceNormal(solid, f)
      const front = n.x + n.y + n.z > 0
      const corners = face.map((i) => solid.vertices[i])
      for (let i = 0; i < 3; i++) {
        const [a, b, c] = [corners[i], corners[(i + 1) % 3], corners[(i + 2) % 3]]
        const m = v((b.x + c.x) / 2, (b.y + c.y) / 2, (b.z + c.z) / 2)
        expectSpans(segmentSpans(a, m, [tetra], camera), [[0, 1, !front]])
        checked++
      }
    })
    expect(checked).toBe(12)
  })

  it('lists every candidate as a parameter strictly inside the segment', () => {
    for (const u of occlusionCandidates(PRISM, v(0, 0, 6), v(0, 0, -12), camera)) {
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('hides a point behind ANY solid in the figure, splitting at every solid it needs', () => {
    // The prism, and a column 2 by 16 by 2 through it (glass: they do not
    // occlude each other, but both occlude a construction line). The
    // segment x = -2, z = -2, y from -20 to 20 runs behind both.
    //
    // Prism: the ray (-2 + t, y + t, -2 + t) is inside for some t > 0 when
    // -7.5 < y < 2.5. Column: x and z confine t to (1, 3) and y to
    // (-8 - y, 8 - y), so -11 < y < 7 — a strictly larger interval, whose
    // ends are the column's silhouette, not the prism's.
    // u = (y + 20) / 40.
    const column = buildSolid({ kind: 'prism', width: 2, height: 16, depth: 2 })
    const result = segmentSpans(v(-2, -20, -2), v(-2, 20, -2), [PRISM, column], camera)
    expectSpans(result, [
      [0, 9 / 40, false],
      [9 / 40, 27 / 40, true],
      [27 / 40, 1, false],
    ])
    for (let i = 1; i < result.length; i++) expect(result[i].from).toBe(result[i - 1].to)
  })
})

// ---------------------------------------------------------------------------
// Round solids (Task 5)
// ---------------------------------------------------------------------------

// Directions for building segments by hand. d is the isometric camera's
// view direction (toward the viewer); e1 and e2 complete an orthonormal
// frame with it, so a point's projection is its (e1, e2) coordinates.
const d = camera.direction
const e1 = v(1 / Math.SQRT2, 0, -1 / Math.SQRT2)
const e2 = v(-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6))
const combo = (...terms: [number, Vec3][]): Vec3 =>
  terms.reduce((acc, [k, w]) => v(acc.x + k * w.x, acc.y + k * w.y, acc.z + k * w.z), v(0, 0, 0))

// The horizontal unit vector toward the viewer, (1, 0, 1)/sqrt(2): the
// direction d leans along, seen from above.
const toward = v(1 / Math.SQRT2, 0, 1 / Math.SQRT2)

describe('segments against a sphere', () => {
  const sphere = buildSolid({ kind: 'sphere', radius: 5 })
  const round = (a: Vec3, b: Vec3) => segmentSpans(a, b, [sphere], camera)

  it('hides the whole radius from the centre to the front pole', () => {
    // The centre is inside, and every point short of the pole is too: the
    // ray toward the viewer from inside the ball is inside it at first. The
    // pole itself is a single point, so nothing is visible beyond the
    // surface — the segment ends there. One hidden span.
    expectSpans(round(v(0, 0, 0), combo([5, d])), [[0, 1, true]])
  })

  it('hides a diameter perpendicular to the view', () => {
    expectSpans(round(combo([-5, e1]), combo([5, e1])), [[0, 1, true]])
  })

  it('shows a segment passing in front', () => {
    expectSpans(round(combo([10, d], [-8, e1]), combo([10, d], [8, e1])), [[0, 1, false]])
  })

  it('hides a segment passing behind exactly where its projection is inside the outline', () => {
    // -10 d + s e1 for s in [-8, 8]. Its projection is s e1, inside the
    // outline circle for |s| < 5: the view-direction cylinder of radius 5.
    // u = (s + 8) / 16.
    expectSpans(round(combo([-10, d], [-8, e1]), combo([-10, d], [8, e1])), [
      [0, 3 / 16, false],
      [3 / 16, 13 / 16, true],
      [13 / 16, 1, false],
    ])
  })

  it('does not split a segment whose rays only graze the sphere', () => {
    // -10 d + 5 e2 + s e1: its projection touches the outline at s = 0 and
    // nowhere crosses it. The view cylinder's quadratic has a double root.
    const a = combo([-10, d], [5, e2], [-8, e1])
    const b = combo([-10, d], [5, e2], [8, e1])
    expectSpans(round(a, b), [[0, 1, false]])
    // ...and the double root is yielded ONCE, at the graze (u = 1/2): the
    // contract the outcome above cannot pin on its own, since the open,
    // margined ray test would call the graze visible with no candidate there.
    const atGraze = occlusionCandidates(sphere, a, b, camera).filter((u) => Math.abs(u - 0.5) < 1e-9)
    expect(atGraze).toHaveLength(1)
  })
})

describe('segments against a cylinder', () => {
  // Radius 3, height 8: x^2 + z^2 < 9, -4 < y < 4.
  const cylinder = buildSolid({ kind: 'cylinder', radius: 3, height: 8 })
  const round = (a: Vec3, b: Vec3) => segmentSpans(a, b, [cylinder], camera)

  it('hides the axis', () => {
    expectSpans(round(v(0, -4, 0), v(0, 4, 0)), [[0, 1, true]])
  })

  it('shows the front generator, on the surface facing the viewer', () => {
    const front = combo([3, toward])
    expectSpans(round(v(front.x, -4, front.z), v(front.x, 4, front.z)), [[0, 1, false]])
  })

  it('splits a segment behind the cylinder at the silhouette lines', () => {
    // s e1 - 6 toward + (0, y0, 0), s in [-6, 6]. The ray moves toward the
    // axis at sqrt(2/3) per unit and climbs at 1/sqrt(3), so it crosses the
    // axis plane at t = 6 sqrt(3/2), having climbed 3 sqrt(2). With
    // y0 = -3 sqrt(2) it is inside the disk at mid-height, well clear of
    // both rims, exactly when |s| < 3: split at the silhouette lines, where
    // the plane through each line and d is e1 . x = +-3. u = (s + 6) / 12.
    const y0 = -3 * Math.SQRT2
    expectSpans(round(combo([-6, e1], [-6, toward], [y0, v(0, 1, 0)]), combo([6, e1], [-6, toward], [y0, v(0, 1, 0)])), [
      [0, 0.25, false],
      [0.25, 0.75, true],
      [0.75, 1, false],
    ])
  })

  it('splits a segment behind it at rim height where the swept rim bounds the shadow', () => {
    // The same line raised so its rays cross the axis plane at y = 4 + 2,
    // above the top rim: y1 = 6 - 3 sqrt(2). A ray reaches the top rim's
    // plane y = 4 at xz = s e1 - 2 sqrt(2) toward, inside the rim exactly
    // when s^2 + 8 < 9: |s| < 1. That is the top rim swept along d — an
    // elliptic cylinder — and NOT the silhouette lines at |s| = 3.
    // u = (s + 6) / 12.
    const y1 = 6 - 3 * Math.SQRT2
    expectSpans(round(combo([-6, e1], [-6, toward], [y1, v(0, 1, 0)]), combo([6, e1], [-6, toward], [y1, v(0, 1, 0)])), [
      [0, 5 / 12, false],
      [5 / 12, 7 / 12, true],
      [7 / 12, 1, false],
    ])
  })
})

describe('segments against a cone', () => {
  // Radius 3, height 8: base at y = -4, apex (0, 4, 0).
  const cone = buildSolid({ kind: 'cone', radius: 3, height: 8 })
  const round = (a: Vec3, b: Vec3) => segmentSpans(a, b, [cone], camera)

  it('hides the axis', () => {
    expectSpans(round(v(0, -4, 0), v(0, 4, 0)), [[0, 1, true]])
  })

  it('splits a segment behind the cone near the apex at the silhouette lines', () => {
    // (a0 toward) + s e1 + y0 up with a0 = -6, y0 = 2 - 3 sqrt(2): the rays
    // cross the axis plane at y = 2, where the cone is 0.75 across.
    //
    // A generator at base angle phi (from `toward`) is a silhouette where
    // the surface normal (8 cos phi, 8 sin phi, 3) is square to d:
    // cos phi = -3 / (8 sqrt 2), sin phi = +-sqrt(119/128). The plane through
    // it and d, through the apex, meets this line at
    //   s = +-6 (a0/sqrt2 - y0 + 4) / sqrt(238) = +-12 / sqrt(238).
    // No other candidate falls on the segment. u = (s + 3) / 6.
    const y0 = 2 - 3 * Math.SQRT2
    const s = 12 / Math.sqrt(238)
    const at = (k: number) => combo([-6, toward], [k, e1], [y0, v(0, 1, 0)])
    expectSpans(round(at(-3), at(3)), [
      [0, (3 - s) / 6, false],
      [(3 - s) / 6, (3 + s) / 6, true],
      [(3 + s) / 6, 1, false],
    ])
  })

  it('splits a segment behind the base at the swept base rim', () => {
    // (a0 toward) + s e1 + (-6) up, below the base, with a0 = 2 - 2 sqrt(2):
    // each ray reaches the base plane y = -4 at xz = 2 toward + s e1, on the
    // near side of the rim, inside it exactly when 4 + s^2 < 9: |s| < sqrt 5.
    // Beyond that the ray passes in front of the base and moves away from
    // the axis, so it never enters. u = (s + 3) / 6.
    const a0 = 2 - 2 * Math.SQRT2
    const at = (k: number) => combo([a0, toward], [k, e1], [-6, v(0, 1, 0)])
    const r = Math.sqrt(5)
    expectSpans(round(at(-3), at(3)), [
      [0, (3 - r) / 6, false],
      [(3 - r) / 6, (3 + r) / 6, true],
      [(3 + r) / 6, 1, false],
    ])
  })
})

// ---------------------------------------------------------------------------
// P1 — a round solid on a tilted axis, occluding in its own frame (phase 7)
// ---------------------------------------------------------------------------

describe('segments against a cylinder whose axis runs along author X', () => {
  // Author X is internal +z: x^2 + y^2 < 9, -4 < z < 4.
  const tilted = buildSolid({ kind: 'cylinder', radius: 3, height: 8 }, placementAlong(v(0, 0, 0), v(0, 0, 1)))
  const round = (a: Vec3, b: Vec3) => segmentSpans(a, b, [tilted], camera)
  // The cyclic map (x, y, z) -> (z, x, y) is a rotation that fixes the
  // isometric view direction (1,1,1) and carries +y to +z — the vertical
  // cylinder above onto this one. A segment carried by it therefore meets
  // this cylinder exactly where the original met the vertical one, and the
  // hand computation there ("splits a segment behind the cylinder at the
  // silhouette lines": |s| < 3, u = (s + 6) / 12) carries over unchanged.
  const turn = (p: Vec3): Vec3 => v(p.z, p.x, p.y)

  it('hides the axis, which runs along author X', () => {
    expectSpans(round(v(0, 0, -4), v(0, 0, 4)), [[0, 1, true]])
  })

  it('splits a segment behind it at the silhouette planes, u = 1/4 and 3/4', () => {
    const y0 = -3 * Math.SQRT2
    const a = turn(combo([-6, e1], [-6, toward], [y0, v(0, 1, 0)]))
    const b = turn(combo([6, e1], [-6, toward], [y0, v(0, 1, 0)]))
    expectSpans(round(a, b), [
      [0, 0.25, false],
      [0.25, 0.75, true],
      [0.75, 1, false],
    ])
  })
})

describe('segments against a frustum', () => {
  // Radius 6, top 3, height 4: base rim radius 6 at y = -2, top rim radius 3
  // at y = +2; the solid's radius at height y is 3 + (3/4)(2 - y).
  const frustum = buildSolid({ kind: 'frustum', radius: 6, top: 3, height: 4 })
  const round = (a: Vec3, b: Vec3) => segmentSpans(a, b, [frustum], camera)

  it('hides the axis', () => {
    expectSpans(round(v(0, -2, 0), v(0, 2, 0)), [[0, 1, true]])
  })

  it('splits a segment behind it at the height of the top rim where the swept TOP rim bounds the shadow', () => {
    // (-6 toward) + s e1 + y0 up, s in [-6, 6]. Toward the viewer a ray moves
    // sqrt(2/3) along `toward` per unit and climbs 1/sqrt(3): it climbs
    // 1/sqrt(2) per unit it travels toward the viewer. With
    // y0 = 4 - 3 sqrt(2) it reaches the top plane y = 2 at
    // xz = -2 sqrt(2) toward + s e1, inside the top rim exactly when
    // 8 + s^2 < 9: |s| < 1. Short of that plane the ray is lower and further
    // back, where it is |c| = 2 sqrt(2) + e from the axis while the solid is
    // only 3 + (3/4) e / sqrt(2) across: it gains distance faster than the
    // solid widens, so it never enters below. Past it, it is above the
    // solid. Hidden exactly for |s| < 1 — the top rim swept along d, which
    // is neither a silhouette plane nor the base rim. u = (s + 6) / 12.
    const y0 = 4 - 3 * Math.SQRT2
    const at = (s: number) => combo([-6, toward], [s, e1], [y0, v(0, 1, 0)])
    expectSpans(round(at(-6), at(6)), [
      [0, 5 / 12, false],
      [5 / 12, 7 / 12, true],
      [7 / 12, 1, false],
    ])
  })
})
