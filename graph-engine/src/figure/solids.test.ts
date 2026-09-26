import { describe, expect, it } from 'vitest'
import { cameraFor, faceNormal, projectSolid } from './project3d'
import { buildSolid, solidDimensions, solidDimensionSegment, type SolidSpec } from './solids'

const COS30 = Math.sqrt(3) / 2

// Every assertion here is against a hand-computed coordinate, never against
// "an element exists": a solid whose vertices are in the wrong place still
// draws twelve lines.

describe('the placement convention (H1)', () => {
  // Constraints fix a solid's SHAPE, not where it sits. The convention is:
  // centred on the origin, axis of symmetry along +y, spanning -h/2..h/2,
  // with every cross-section perpendicular to that axis centred on it.
  it('centres a prism on the origin, as rectangularPrism already did', () => {
    const v = requirePolyhedron(buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })).vertices
    expect(Math.min(...v.map((p) => p.x))).toBeCloseTo(-4, 12)
    expect(Math.max(...v.map((p) => p.x))).toBeCloseTo(4, 12)
    expect(Math.min(...v.map((p) => p.y))).toBeCloseTo(-2.5, 12)
    expect(Math.max(...v.map((p) => p.y))).toBeCloseTo(2.5, 12)
    expect(Math.min(...v.map((p) => p.z))).toBeCloseTo(-3, 12)
    expect(Math.max(...v.map((p) => p.z))).toBeCloseTo(3, 12)
  })

  it('puts a square pyramid base at -h/2 and its apex at +h/2, both on the axis', () => {
    const v = requirePolyhedron(buildSolid({ kind: 'pyramid', base: 6, height: 9 })).vertices
    expect(v).toHaveLength(5)
    for (const p of v.slice(0, 4)) expect(p.y).toBeCloseTo(-4.5, 12)
    expect(v[4]).toEqual({ x: 0, y: 4.5, z: 0 })
    // The base is axis-aligned: width along x, depth along z, centred.
    expect(
      v
        .slice(0, 4)
        .map((p) => p.x)
        .sort((a, b) => a - b)
    ).toEqual([-3, -3, 3, 3])
    expect(
      v
        .slice(0, 4)
        .map((p) => p.z)
        .sort((a, b) => a - b)
    ).toEqual([-3, -3, 3, 3])
  })

  it('places a regular tetrahedron with its first base vertex facing the viewer', () => {
    const v = requirePolyhedron(buildSolid({ kind: 'tetrahedron', edge: 5 })).vertices
    const R = 5 / Math.sqrt(3)
    const h = 5 * Math.sqrt(2 / 3)
    // Rule 4: 45 degrees round from +x, the camera's own direction projected
    // onto the base plane.
    expect(v[0].x).toBeCloseTo(R / Math.sqrt(2), 12)
    expect(v[0].z).toBeCloseTo(R / Math.sqrt(2), 12)
    expect(v[0].y).toBeCloseTo(-h / 2, 12)
    expect(v[3]).toEqual({ x: 0, y: h / 2, z: 0 })
    const d = (a: number, b: number) => Math.hypot(v[a].x - v[b].x, v[a].y - v[b].y, v[a].z - v[b].z)
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ]) {
      expect(d(a, b)).toBeCloseTo(5, 12)
    }
  })
})

function requirePolyhedron(body: ReturnType<typeof buildSolid>) {
  if (!body.polyhedron) throw new Error('expected a polyhedron')
  return body.polyhedron
}

describe('face winding', () => {
  // The outward normal is what makes hidden-edge classification possible at
  // all, so every face of every primitive has to wind counter-clockwise as
  // seen from outside. The test: each face normal points away from the
  // origin the solid is centred on.
  const specs: SolidSpec[] = [
    { kind: 'prism', width: 4, height: 3, depth: 2 },
    { kind: 'pyramid', base: 6, height: 9 },
    { kind: 'tetrahedron', edge: 5 },
  ]
  for (const spec of specs) {
    it(`points every ${spec.kind} face outward`, () => {
      const solid = requirePolyhedron(buildSolid(spec))
      for (let f = 0; f < solid.faces.length; f++) {
        const n = faceNormal(solid, f)
        const face = solid.faces[f]
        const p = face.reduce(
          (acc, i) => ({
            x: acc.x + solid.vertices[i].x / face.length,
            y: acc.y + solid.vertices[i].y / face.length,
            z: acc.z + solid.vertices[i].z / face.length,
          }),
          { x: 0, y: 0, z: 0 }
        )
        expect(n.x * p.x + n.y * p.y + n.z * p.z).toBeGreaterThan(0)
      }
    })
  }
})

describe('projected vertices under the default camera', () => {
  it('sends a prism near corner to its hand-computed place', () => {
    const body = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
    const camera = cameraFor('isometric')
    // The near corner is (+4, +2.5, +3): u = (x - z)cos30, v = y - (x + z)/2.
    const p = camera.project({ x: 4, y: 2.5, z: 3 })
    expect(p.x).toBeCloseTo(COS30, 12)
    expect(p.y).toBeCloseTo(-1, 12)
    const drawn = projectSolid(requirePolyhedron(body), camera)
    expect(drawn).toHaveLength(12)
    expect(drawn.filter((e) => e.hidden)).toHaveLength(3)
  })

  it('draws a tetrahedron as six edges, dashing only the far base edge', () => {
    const body = requirePolyhedron(buildSolid({ kind: 'tetrahedron', edge: 5 }))
    const edges = projectSolid(body, cameraFor('isometric'))
    expect(edges).toHaveLength(6)
    const hidden = edges.filter((e) => e.hidden)
    // Two of the three lateral faces face the camera, so the only edge with
    // no front-facing face on either side is the base edge between the two
    // vertices away from the viewer — vertices 1 and 2.
    expect(hidden).toHaveLength(1)
    expect([...hidden[0].vertices].sort()).toEqual([1, 2])
  })

  it('draws a square pyramid as eight edges, hiding the three at the far base corner', () => {
    const body = requirePolyhedron(buildSolid({ kind: 'pyramid', base: 6, height: 9 }))
    const edges = projectSolid(body, cameraFor('isometric'))
    expect(edges).toHaveLength(8)
    const hidden = edges.filter((e) => e.hidden)
    expect(hidden).toHaveLength(3)
    // The far base corner is the one with x and z both negative.
    const far = body.vertices.findIndex((v) => v.x < 0 && v.z < 0)
    for (const edge of hidden) expect(edge.vertices).toContain(far)
  })
})

describe('named viewpoints', () => {
  it('keeps the isometric camera bit-for-bit what it was', () => {
    const camera = cameraFor('isometric')
    const p = camera.project({ x: 2, y: -3, z: 5 })
    expect(p.x).toBe((2 - 5) * COS30)
    expect(p.y).toBe(-3 - (2 + 5) / 2)
  })

  it('looks straight down -z from the front, so x and y are the page', () => {
    expect(cameraFor('front').project({ x: 2, y: -3, z: 5 })).toEqual({ x: 2, y: -3 })
  })

  it('looks down -y from the top, with +z going DOWN the page', () => {
    expect(cameraFor('top').project({ x: 2, y: -3, z: 5 })).toEqual({ x: 2, y: -5 })
  })

  it('looks along -x from the side, with +z going LEFT', () => {
    expect(cameraFor('side').project({ x: 2, y: -3, z: 5 })).toEqual({ x: -5, y: -3 })
  })

  it('gives every viewpoint a right-handed (right, up, direction) frame at one uniform scale', () => {
    for (const name of ['isometric', 'front', 'top', 'side'] as const) {
      const c = cameraFor(name)
      const cross = {
        x: c.right.y * c.up.z - c.right.z * c.up.y,
        y: c.right.z * c.up.x - c.right.x * c.up.z,
        z: c.right.x * c.up.y - c.right.y * c.up.x,
      }
      expect(cross.x).toBeCloseTo(c.direction.x, 12)
      expect(cross.y).toBeCloseTo(c.direction.y, 12)
      expect(cross.z).toBeCloseTo(c.direction.z, 12)
      // right/up are unit vectors and the projection applies ONE uniform
      // scale to both. That is what makes a projected circle an ellipse with
      // computable axes rather than an unknown conic, so it is a property of
      // the camera contract and not an accident of these four.
      expect(Math.hypot(c.right.x, c.right.y, c.right.z)).toBeCloseTo(1, 12)
      expect(Math.hypot(c.up.x, c.up.y, c.up.z)).toBeCloseTo(1, 12)
      const probe = { x: 1.7, y: -0.4, z: 2.3 }
      const q = c.project(probe)
      const dotRight = probe.x * c.right.x + probe.y * c.right.y + probe.z * c.right.z
      const dotUp = probe.x * c.up.x + probe.y * c.up.y + probe.z * c.up.z
      expect(q.x).toBeCloseTo(c.scale * dotRight, 12)
      expect(q.y).toBeCloseTo(c.scale * dotUp, 12)
    }
  })
})

describe('the dimensions a solid can be labelled with', () => {
  it('names a prism three and a tetrahedron one', () => {
    expect(Object.keys(solidDimensions({ kind: 'prism', width: 8, height: 5, depth: 6 }))).toEqual([
      'width',
      'height',
      'depth',
    ])
    expect(Object.keys(solidDimensions({ kind: 'tetrahedron', edge: 5 }))).toEqual(['edge'])
  })

  it('reports the value the author asked for', () => {
    expect(solidDimensions({ kind: 'prism', width: 8, height: 5, depth: 6 }).width).toBe(8)
    expect(solidDimensions({ kind: 'pyramid', base: 6, height: 9 }).height).toBe(9)
  })
})

describe('vertex labelling order', () => {
  it('walks a prism base then its top, so A sits under E', () => {
    const body = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
    const v = requirePolyhedron(body).vertices
    expect(body.labelOrder).toHaveLength(8)
    for (let i = 0; i < 4; i++) {
      expect(v[body.labelOrder[i]].y).toBeCloseTo(-2.5, 12)
      expect(v[body.labelOrder[i + 4]].y).toBeCloseTo(2.5, 12)
      // The top vertex sits directly above the base vertex of the same
      // position in the cycle, which is what "A under E" means.
      expect(v[body.labelOrder[i + 4]].x).toBeCloseTo(v[body.labelOrder[i]].x, 12)
      expect(v[body.labelOrder[i + 4]].z).toBeCloseTo(v[body.labelOrder[i]].z, 12)
    }
  })

  it('walks a tetrahedron base then its apex', () => {
    const body = buildSolid({ kind: 'tetrahedron', edge: 5 })
    expect(body.labelOrder).toEqual([0, 1, 2, 3])
  })
})

describe('the edge a dimension attaches to', () => {
  it('hangs a prism width off its front-bottom edge, running along x', () => {
    const seg = solidDimensionSegment({ kind: 'prism', width: 8, height: 5, depth: 6 }, 'width')
    expect(seg).toEqual([
      { x: -4, y: -2.5, z: 3 },
      { x: 4, y: -2.5, z: 3 },
    ])
  })

  it('hangs a prism height off its front-right vertical edge', () => {
    expect(solidDimensionSegment({ kind: 'prism', width: 8, height: 5, depth: 6 }, 'height')).toEqual([
      { x: 4, y: -2.5, z: 3 },
      { x: 4, y: 2.5, z: 3 },
    ])
  })

  it('hangs a prism depth off its bottom-right edge, running along z', () => {
    expect(solidDimensionSegment({ kind: 'prism', width: 8, height: 5, depth: 6 }, 'depth')).toEqual([
      { x: 4, y: -2.5, z: -3 },
      { x: 4, y: -2.5, z: 3 },
    ])
  })

  it('hangs a pyramid height off the AXIS, which is no edge of the solid', () => {
    expect(solidDimensionSegment({ kind: 'pyramid', base: 6, height: 9 }, 'height')).toEqual([
      { x: 0, y: -4.5, z: 0 },
      { x: 0, y: 4.5, z: 0 },
    ])
  })

  it('hangs a tetrahedron edge off the base edge between its first two vertices', () => {
    const body = buildSolid({ kind: 'tetrahedron', edge: 5 })
    const solid = requirePolyhedron(body)
    expect(solidDimensionSegment(body.spec, 'edge')).toEqual([solid.vertices[0], solid.vertices[1]])
  })

  it('knows nothing about a dimension the primitive does not have', () => {
    expect(solidDimensionSegment({ kind: 'tetrahedron', edge: 5 }, 'height')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// H4 — the invariant the hidden-edge rule rests on
// ---------------------------------------------------------------------------

// The visibility rule is "an edge is hidden when every face meeting it turns
// away from the camera". That is correct for a CONVEX polyhedron and wrong for
// a non-convex one, where a front-facing face can still be occluded by another
// part of the same solid.
//
// The plan called for a runtime guard rejecting non-convex solids. There is
// nothing to reject: `SOLID_PRIMITIVES` is the only way to make a solid from a
// spec, and every entry is convex by construction, so the guard would be a
// branch no input can reach — the kind of dead code this project has deleted
// before rather than kept.
//
// What is worth pinning is the invariant itself, because it is what keeps the
// visibility rule sound as primitives are added. A convex polyhedron is one
// where every vertex lies on the inner side of every face plane; if a future
// primitive breaks that, this fails and names it.
describe('every polyhedral primitive is convex (H4)', () => {
  const CASES: SolidSpec[] = [
    { kind: 'prism', width: 8, height: 5, depth: 6 },
    { kind: 'prism', width: 1, height: 12, depth: 1 },
    { kind: 'pyramid', base: 6, height: 9 },
    { kind: 'pyramid', base: 10, height: 2 },
    { kind: 'tetrahedron', edge: 5 },
  ]

  for (const spec of CASES) {
    it(`holds for ${JSON.stringify(spec)}`, () => {
      const body = buildSolid(spec)
      const solid = body.polyhedron
      expect(solid).not.toBeNull()
      if (!solid) return

      for (let f = 0; f < solid.faces.length; f++) {
        const n = faceNormal(solid, f)
        const onFace = solid.vertices[solid.faces[f][0]]
        for (let v = 0; v < solid.vertices.length; v++) {
          const p = solid.vertices[v]
          // Signed distance from the face plane along its OUTWARD normal. A
          // convex solid has every vertex at or behind every face.
          const d = (p.x - onFace.x) * n.x + (p.y - onFace.y) * n.y + (p.z - onFace.z) * n.z
          expect(d).toBeLessThan(1e-9)
        }
      }
    })
  }

  it('the check can actually fail — a dented cube is rejected', () => {
    // Guards against the test passing because the distance rule is vacuous.
    // This is a cube with one vertex pushed inward through the far face, so it
    // is genuinely non-convex while still being a closed, well-wound solid.
    const dented = {
      vertices: [
        { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
        { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -0.2, y: 0.2, z: -2 },
      ],
      faces: [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]],
    }
    let violated = false
    for (let f = 0; f < dented.faces.length; f++) {
      const n = faceNormal(dented, f)
      const onFace = dented.vertices[dented.faces[f][0]]
      for (const p of dented.vertices) {
        const d = (p.x - onFace.x) * n.x + (p.y - onFace.y) * n.y + (p.z - onFace.z) * n.z
        if (d > 1e-9) violated = true
      }
    }
    expect(violated).toBe(true)
  })
})
