import { describe, expect, it } from 'vitest'
import { authorToWorld, worldToAuthor } from './authorFrame'
import { cameraFor, DEFAULT_CAMERA, DEFAULT_VIEW, faceNormal, projectSolid, type Camera, type Vec3 } from './project3d'
import { BASE_START_ANGLE, baseStartAngle, buildSolid, solidDimensions, solidDimensionSegment, type SolidSpec } from './solids'

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

  it('places a regular tetrahedron with its first base vertex 15 degrees round from the default camera', () => {
    const v = requirePolyhedron(buildSolid({ kind: 'tetrahedron', edge: 5 })).vertices
    const R = 5 / Math.sqrt(3)
    const h = 5 * Math.sqrt(2 / 3)
    // Rule 4 (V2): the standard camera looks from author azimuth 30 degrees,
    // and the first vertex sits at 30 + 15 = 45 — author (R/sqrt2, R/sqrt2),
    // which is internal 45 degrees round from +x.
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
    for (const name of ['standard', 'isometric', 'front', 'top', 'side'] as const) {
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

  it('walks a tetrahedron base then its apex, the base counter-clockwise from above', () => {
    // Textbook lettering (phase 6b): A is the first base vertex (author
    // azimuth 45), then B at 165 and C at 285 — counter-clockwise seen from
    // above — which is the base built at vertex indices 0, 2, 1. D is the apex.
    const body = buildSolid({ kind: 'tetrahedron', edge: 5 })
    expect(body.labelOrder).toEqual([0, 2, 1, 3])
    const v = requirePolyhedron(body).vertices
    const azimuth = (i: number) => {
      const p = worldToAuthor(v[body.labelOrder[i]])
      return (((Math.atan2(p.y, p.x) / RAD) % 360) + 360) % 360
    }
    expect(azimuth(0)).toBeCloseTo(45, 9)
    expect(azimuth(1)).toBeCloseTo(165, 9)
    expect(azimuth(2)).toBeCloseTo(285, 9)
    expect(worldToAuthor(v[body.labelOrder[3]]).z).toBeGreaterThan(0)
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

// ---------------------------------------------------------------------------
// V1 / V2 — the standard default view, and placement fixed against it
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

// The smallest distance on the page between two of the given points.
function minimumGap(points: Vec3[], camera: Camera): number {
  const drawn = points.map((p) => camera.project(p))
  let least = Infinity
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) least = Math.min(least, Math.hypot(drawn[i].x - drawn[j].x, drawn[i].y - drawn[j].y))
  }
  return least
}

// How near the viewer the midpoint of a base edge is, along the view.
function edgeDepth(vertices: Vec3[], a: number, b: number, camera: Camera): number {
  const mid = { x: (vertices[a].x + vertices[b].x) / 2, y: (vertices[a].y + vertices[b].y) / 2, z: (vertices[a].z + vertices[b].z) / 2 }
  return dot3(mid, camera.direction)
}

const BASE_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
]

describe('the standard camera (V1)', () => {
  it('looks from author azimuth 30 and elevation 25, carried into the internal frame', () => {
    const c = cameraFor('standard')
    const expected = authorToWorld({ x: Math.cos(25 * RAD) * Math.cos(30 * RAD), y: Math.cos(25 * RAD) * Math.sin(30 * RAD), z: Math.sin(25 * RAD) })
    expect(c.direction.x).toBeCloseTo(expected.x, 12)
    expect(c.direction.y).toBeCloseTo(expected.y, 12)
    expect(c.direction.z).toBeCloseTo(expected.z, 12)
    expect(Math.hypot(c.direction.x, c.direction.y, c.direction.z)).toBeCloseTo(1, 12)
    expect(c.scale).toBe(1)
  })

  it('draws author Z page-up: its up is the projection of Z, and right x up = direction', () => {
    const c = cameraFor('standard')
    const z = authorToWorld({ x: 0, y: 0, z: 1 })
    const along = dot3(z, c.direction)
    const raw = sub3(z, { x: along * c.direction.x, y: along * c.direction.y, z: along * c.direction.z })
    const length = Math.hypot(raw.x, raw.y, raw.z)
    expect(c.up.x).toBeCloseTo(raw.x / length, 12)
    expect(c.up.y).toBeCloseTo(raw.y / length, 12)
    expect(c.up.z).toBeCloseTo(raw.z / length, 12)
    const handed = cross3(c.right, c.up)
    expect(handed.x).toBeCloseTo(c.direction.x, 12)
    expect(handed.y).toBeCloseTo(c.direction.y, 12)
    expect(handed.z).toBeCloseTo(c.direction.z, 12)
    // So a vertical edge draws vertical: author Z lands straight above the origin.
    const top = c.project(z)
    expect(top.x).toBeCloseTo(0, 12)
    expect(top.y).toBeGreaterThan(0)
  })

  it('is the default view and the default camera', () => {
    expect(DEFAULT_VIEW).toBe('standard')
    expect(DEFAULT_CAMERA).toBe(cameraFor('standard'))
  })

  it('draws the 8 corners of a unit cube at least 0.45 apart, where isometric does not', () => {
    const cube: Vec3[] = []
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push(authorToWorld({ x, y, z }))
    expect(minimumGap(cube, cameraFor('standard'))).toBeGreaterThan(0.45)
    // The same assertion fails under exact isometric: it looks along the
    // cube's space diagonal and draws (0,0,0) and (1,1,1) on one point.
    expect(minimumGap(cube, cameraFor('isometric'))).toBeLessThan(0.45)
    expect(minimumGap(cube, cameraFor('isometric'))).toBeCloseTo(0, 12)
  })
})

describe('a regular tetrahedron under the default camera', () => {
  const body = buildSolid({ kind: 'tetrahedron', edge: 6 })
  const solid = requirePolyhedron(body)
  const camera = DEFAULT_CAMERA

  it('keeps every face at least 20 degrees from edge-on', () => {
    for (let f = 0; f < solid.faces.length; f++) {
      const n = faceNormal(solid, f)
      const sine = Math.abs(dot3(n, camera.direction)) / Math.hypot(n.x, n.y, n.z)
      expect(Math.asin(sine) / RAD).toBeGreaterThan(20)
    }
  })

  it('draws the altitude at least 8 degrees away from every edge at the apex', () => {
    // The altitude runs from the apex (vertex 3) to the base centroid, which
    // is on the axis at the base's height.
    const apex = camera.project(solid.vertices[3])
    const foot = camera.project({ x: 0, y: solid.vertices[0].y, z: 0 })
    const altitude = { x: foot.x - apex.x, y: foot.y - apex.y }
    for (const i of [0, 1, 2]) {
      const end = camera.project(solid.vertices[i])
      const edge = { x: end.x - apex.x, y: end.y - apex.y }
      const angle = Math.abs(Math.atan2(altitude.x * edge.y - altitude.y * edge.x, altitude.x * edge.x + altitude.y * edge.y))
      expect(angle / RAD).toBeGreaterThan(8)
    }
  })

  it('dashes exactly one edge: the base edge farthest from the viewer', () => {
    const hidden = projectSolid(solid, camera).filter((e) => e.hidden)
    expect(hidden).toHaveLength(1)
    const back = BASE_EDGES.reduce((far, e) =>
      edgeDepth(solid.vertices, e[0], e[1], camera) < edgeDepth(solid.vertices, far[0], far[1], camera) ? e : far
    )
    expect([...hidden[0].vertices].sort()).toEqual([...back].sort())
    expect(hidden[0].vertices).not.toContain(3)
  })

  it('hangs its edge dimension off the front-most base edge', () => {
    const [a, b] = solidDimensionSegment(body.spec, 'edge')!
    const i = solid.vertices.findIndex((v) => v.x === a.x && v.y === a.y && v.z === a.z)
    const j = solid.vertices.findIndex((v) => v.x === b.x && v.y === b.y && v.z === b.z)
    const front = edgeDepth(solid.vertices, i, j, camera)
    for (const [p, q] of BASE_EDGES) {
      if ((p === i && q === j) || (p === j && q === i)) continue
      expect(front).toBeGreaterThan(edgeDepth(solid.vertices, p, q, camera))
    }
  })
})

describe('a box under the default camera', () => {
  const spec: SolidSpec = { kind: 'prism', width: 8, height: 5, depth: 6 }
  const solid = requirePolyhedron(buildSolid(spec))

  it('draws exactly three dashed edges, the ones meeting at the hidden corner', () => {
    const hidden = projectSolid(solid, DEFAULT_CAMERA).filter((e) => e.hidden)
    expect(hidden).toHaveLength(3)
    // The hidden corner is author (-X, -Y, -Z): internal (-,-,-).
    const corner = solid.vertices.findIndex((v) => v.x < 0 && v.y < 0 && v.z < 0)
    for (const edge of hidden) expect(edge.vertices).toContain(corner)
  })

  it('hangs all three dimensions off visible edges at the bottom corner nearest the viewer', () => {
    const bottom = solid.vertices.filter((v) => v.y < 0)
    const nearest = bottom.reduce((best, v) => (dot3(v, DEFAULT_CAMERA.direction) > dot3(best, DEFAULT_CAMERA.direction) ? v : best))
    const drawn = projectSolid(solid, DEFAULT_CAMERA)
    const key = (p: Vec3) => `${p.x},${p.y},${p.z}`
    for (const dimension of ['width', 'height', 'depth']) {
      const [a, b] = solidDimensionSegment(spec, dimension)!
      expect([key(a), key(b)]).toContain(key(nearest))
      const edge = drawn.find((e) => {
        const ends = e.vertices.map((i) => key(solid.vertices[i]))
        return ends.includes(key(a)) && ends.includes(key(b))
      })
      expect(edge?.hidden).toBe(false)
    }
  })
})

describe('placement is fixed against the default camera (V2)', () => {
  it('derives the base start angle from the DEFAULT camera, 15 degrees round', () => {
    expect(BASE_START_ANGLE).toBe(baseStartAngle(DEFAULT_CAMERA))
    // Author azimuth 30 + 15 = 45 degrees, which is internal 90 - 45 = 45.
    expect(BASE_START_ANGLE).toBeCloseTo(Math.PI / 4, 12)
    // Any other camera would put the vertex elsewhere, which is exactly why
    // the rule may not read the active one.
    expect(Math.abs(baseStartAngle(cameraFor('isometric')) - BASE_START_ANGLE)).toBeGreaterThan(0.1)
    expect(Math.abs(baseStartAngle(cameraFor('front')) - BASE_START_ANGLE)).toBeGreaterThan(0.1)
  })

  it('puts the first base vertex of a tetrahedron at author azimuth 45 degrees', () => {
    const v = requirePolyhedron(buildSolid({ kind: 'tetrahedron', edge: 6 })).vertices
    const first = worldToAuthor(v[0])
    expect(Math.atan2(first.y, first.x) / RAD).toBeCloseTo(45, 9)
  })
})

// ---------------------------------------------------------------------------
// V3 — textbook lettering
// ---------------------------------------------------------------------------

// A solid's vertices by the letters "vertices ABCD..." gives them, in the
// AUTHOR frame (z up), so every assertion reads the way a problem does.
function lettered(spec: SolidSpec): Record<string, Vec3> {
  const body = buildSolid(spec)
  const solid = requirePolyhedron(body)
  return Object.fromEntries(body.labelOrder.map((index, i) => ['ABCDEFGH'[i], worldToAuthor(solid.vertices[index])]))
}

// True when the points run counter-clockwise seen from above (from +Z): every
// turn from one to the next is a left turn in the author's XY-plane.
function counterClockwiseFromAbove(points: Vec3[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const c = points[(i + 2) % points.length]
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (turn <= 0) return false
  }
  return true
}

describe('textbook lettering (V3)', () => {
  const BOX: SolidSpec = { kind: 'prism', width: 8, height: 5, depth: 6 }

  it("puts a prism's A at the front-left bottom corner: largest X, smallest Y, at the bottom", () => {
    const at = lettered(BOX)
    expect(at.A).toEqual({ x: 3, y: -4, z: -2.5 })
  })

  it('runs A, B, C, D counter-clockwise seen from above', () => {
    const at = lettered(BOX)
    expect(counterClockwiseFromAbove([at.A, at.B, at.C, at.D])).toBe(true)
    // The check can fail: the same corners in phase 5's order run clockwise.
    expect(counterClockwiseFromAbove([at.D, at.C, at.B, at.A])).toBe(false)
    expect(at.B).toEqual({ x: 3, y: 4, z: -2.5 })
    expect(at.C).toEqual({ x: -3, y: 4, z: -2.5 })
    expect(at.D).toEqual({ x: -3, y: -4, z: -2.5 })
  })

  it('puts E directly above A, and E-H above A-D in order', () => {
    const at = lettered(BOX)
    expect(at.E).toEqual({ x: 3, y: -4, z: 2.5 })
    for (const [low, high] of ['AE', 'BF', 'CG', 'DH']) {
      expect(at[high].x).toBe(at[low].x)
      expect(at[high].y).toBe(at[low].y)
      expect(at[high].z).toBe(2.5)
    }
  })

  it('makes D the hidden corner under the default camera: its three edges are the dashed ones', () => {
    const body = buildSolid(BOX)
    const D = body.labelOrder[3]
    const hidden = projectSolid(requirePolyhedron(body), DEFAULT_CAMERA).filter((e) => e.hidden)
    expect(hidden).toHaveLength(3)
    for (const edge of hidden) expect(edge.vertices).toContain(D)
    // ...and the front face is ABFE: all four of its edges drawn solid.
    const letter = (i: number) => 'ABCDEFGH'[body.labelOrder.indexOf(i)]
    const drawn = projectSolid(requirePolyhedron(body), DEFAULT_CAMERA)
    for (const pair of ['AB', 'BF', 'FE', 'EA']) {
      const edge = drawn.find((e) => [letter(e.vertices[0]), letter(e.vertices[1])].sort().join('') === [...pair].sort().join(''))
      expect(edge?.hidden).toBe(false)
    }
  })

  it('draws the space diagonal A-G longer than any edge of the box', () => {
    const body = buildSolid(BOX)
    const solid = requirePolyhedron(body)
    const drawnLength = (p: Vec3, q: Vec3) => {
      const a = DEFAULT_CAMERA.project(p)
      const b = DEFAULT_CAMERA.project(q)
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const A = solid.vertices[body.labelOrder[0]]
    const G = solid.vertices[body.labelOrder[6]]
    const longestEdge = Math.max(...projectSolid(solid, DEFAULT_CAMERA).map((e) => Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y)))
    expect(drawnLength(A, G)).toBeGreaterThan(longestEdge)
  })

  it('letters a square pyramid the same way round, with its apex E', () => {
    const at = lettered({ kind: 'pyramid', base: 6, height: 9 })
    expect(at.A).toEqual({ x: 3, y: -3, z: -4.5 })
    expect(counterClockwiseFromAbove([at.A, at.B, at.C, at.D])).toBe(true)
    expect(at.E).toEqual({ x: 0, y: 0, z: 4.5 })
  })

  it('letters a tetrahedron from its first base vertex, counter-clockwise, with its apex D', () => {
    const body = buildSolid({ kind: 'tetrahedron', edge: 6 })
    expect(body.labelOrder[0]).toBe(0)
    const at = lettered({ kind: 'tetrahedron', edge: 6 })
    expect(counterClockwiseFromAbove([at.A, at.B, at.C])).toBe(true)
    expect(at.D.x).toBeCloseTo(0, 12)
    expect(at.D.y).toBeCloseTo(0, 12)
    expect(at.D.z).toBeCloseTo(Math.sqrt(6), 12)
  })
})
