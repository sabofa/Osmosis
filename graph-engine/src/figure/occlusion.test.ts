import { describe, expect, it } from 'vitest'
import { hidesPoint, occlusionCandidates, segmentSpans, type Span } from './occlusion'
import { faceNormal, ISOMETRIC_CAMERA, type Vec3 } from './project3d'
import { buildSolid } from './solids'

// S6 — the glass rule for construction segments, against polyhedra.
//
// Everything here is in the INTERNAL y-up frame, where the isometric camera
// looks from (1,1,1). The 8-by-5-by-6 prism spans x in [-4, 4], y in
// [-2.5, 2.5], z in [-3, 3]; its three front faces are +x, +y, +z, and its
// one hidden corner is (-4,-2.5,-3), which labelOrder names A.

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
    // FG joins the +x and +y faces, both in front. AB joins -y and -z, both
    // turned away.
    expectSpans(spans(NAMED.F, NAMED.G), [[0, 1, false]])
    expectSpans(spans(NAMED.A, NAMED.B), [[0, 1, true]])
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

  it('refuses a round solid rather than drawing its occlusion wrong', () => {
    const sphere = buildSolid({ kind: 'sphere', radius: 2 })
    expect(() => segmentSpans(v(-5, 0, 0), v(5, 0, 0), [sphere], camera)).toThrow(/sphere/)
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
