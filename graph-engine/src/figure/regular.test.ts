import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { worldToAuthor } from './authorFrame'
import { DEFAULT_CAMERA, faceNormal, ISOMETRIC_CAMERA, projectSolid, type Vec3 } from './project3d'
import { placementMargin, regularRotation, type RegularShape } from './regular'
import { renderFigure } from './render'
import { bodyDimensionSegment, buildSolid, solidDimensions, type SolidSpec } from './solids'

// P5 — one placement rule and one lettering rule for regular bases and the
// octahedron, plus the cube, the rectangle pyramid and the pyramidal frustum.

const DEG = 180 / Math.PI
// The default camera's author azimuth: 30 degrees.
const CAMERA_AZIMUTH = 30

function render(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function authorVertices(spec: SolidSpec): Vec3[] {
  return buildSolid(spec).polyhedron!.vertices.map(worldToAuthor)
}

function azimuth(p: Vec3): number {
  return Math.atan2(p.y, p.x) * DEG
}

describe('the cube is the box', () => {
  it('draws "cube edge 4" byte for byte as "prism 4 by 4 by 4", with and without vertices', () => {
    for (const tail of ['', ' vertices ABCDEFGH']) {
      const cube = render(`@mode: figure\nS = solid cube edge 4${tail}\nlabel: S edge = 4`)
      const box = render(`@mode: figure\nS = solid prism 4 by 4 by 4${tail}\nlabel: S width = 4`)
      expect(cube.errors).toEqual([])
      expect(cube.svg.replace('S edge', 'S width')).toBe(box.svg)
    }
    const cube = render('@mode: figure\nsolid: cube edge 4')
    expect(cube.svg).toBe(render('@mode: figure\nsolid: prism 4 by 4 by 4').svg)
  })
})

// ---------------------------------------------------------------------------
// The placement rule
// ---------------------------------------------------------------------------

// The rule's objective, computed here from the BUILT solid — its own faces
// and its own lettered base corners — rather than from regular.ts's search.
function achievedMargin(spec: SolidSpec, baseCorners: number): number {
  const solid = buildSolid(spec).polyhedron!
  const d = DEFAULT_CAMERA.direction
  let least = Infinity
  for (let f = 0; f < solid.faces.length; f++) {
    const n = faceNormal(solid, f)
    const along = Math.abs(n.x * d.x + n.y * d.y + n.z * d.z) / Math.hypot(n.x, n.y, n.z)
    least = Math.min(least, Math.asin(Math.min(1, along)) * DEG)
  }
  for (const corner of solid.vertices.slice(0, baseCorners).map(worldToAuthor)) {
    const m = (((azimuth(corner) - CAMERA_AZIMUTH) % 180) + 180) % 180
    least = Math.min(least, m, 180 - m)
  }
  return least
}

// [shape, recorded rotation, recorded margin]
const RECORDED: [RegularShape, number, number][] = [
  [{ kind: 'regularPrism', sides: 3, side: 4, height: 5 }, 16, 14.0],
  [{ kind: 'regularPrism', sides: 5, side: 4, height: 5 }, 3, 8.151],
  [{ kind: 'regularPrism', sides: 6, side: 12, height: 5 }, 0, 25.0],
  [{ kind: 'regularPrism', sides: 8, side: 4, height: 5 }, 19, 10.41],
  [{ kind: 'regularPyramid', sides: 3, side: 4, height: 6 }, 13, 16.264],
  [{ kind: 'regularPyramid', sides: 5, side: 4, height: 6 }, 8, 13.515],
  [{ kind: 'regularPyramid', sides: 6, side: 4, height: 6 }, 0, 10.436],
  [{ kind: 'octahedron', edge: 6 }, 75, 14.123],
]

describe('P5 — the rotation that maximises the least margin', () => {
  for (const [shape, rotation, margin] of RECORDED) {
    const corners = shape.kind === 'octahedron' ? 4 : shape.sides
    const label = `${shape.kind}${shape.kind === 'octahedron' ? '' : ` ${shape.sides}`}`

    it(`chooses ${rotation} degrees for ${label}`, () => {
      expect(regularRotation(shape)).toBe(rotation)
    })

    it(`is the best integer rotation in one period for ${label}, ties to the smallest`, () => {
      const best = placementMargin(shape, rotation)
      for (let r = 0; r < 360 / corners; r++) {
        if (r < rotation) expect(placementMargin(shape, r)).toBeLessThan(best - 1e-9)
        else expect(placementMargin(shape, r)).toBeLessThanOrEqual(best + 1e-9)
      }
    })

    it(`keeps every face of the built ${label} at least ${margin} degrees from edge-on under the default camera`, () => {
      expect(achievedMargin(shape, corners)).toBeGreaterThanOrEqual(margin - 1e-3)
    })
  }

  it("draws every regular pyramid's apex-to-centre segment clear of every lateral edge", () => {
    // The angle at the projected apex between the axis and each lateral
    // edge: the rule keeps it at least 6 degrees for all three (6.05,
    // 10.66, 16.16), and the rectangle pyramid's is 9.53.
    const shapes: Extract<SolidSpec, { kind: 'regularPyramid' | 'rectanglePyramid' }>[] = [
      { kind: 'regularPyramid', sides: 3, side: 4, height: 6 },
      { kind: 'regularPyramid', sides: 5, side: 4, height: 6 },
      { kind: 'regularPyramid', sides: 6, side: 4, height: 6 },
      { kind: 'rectanglePyramid', width: 6, depth: 4, height: 9 },
    ]
    for (const spec of shapes) {
      const solid = buildSolid(spec).polyhedron!
      const apex = DEFAULT_CAMERA.project(solid.vertices[solid.vertices.length - 1])
      const centre = DEFAULT_CAMERA.project({ x: 0, y: -spec.height / 2, z: 0 })
      const axis = Math.atan2(centre.y - apex.y, centre.x - apex.x)
      for (const corner of solid.vertices.slice(0, -1).map((v) => DEFAULT_CAMERA.project(v))) {
        let gap = Math.abs(Math.atan2(corner.y - apex.y, corner.x - apex.x) - axis) * DEG
        gap = Math.min(gap, 360 - gap)
        expect(gap).toBeGreaterThan(6)
      }
    }
  })

  it('reports, for information only, what it would pick for the pinned tetrahedron and square pyramid', () => {
    // Both have sat at 45 degrees absolute (camera azimuth + 15) since phase
    // 6b, and stay there. The rule would pick 12 (mod 120) for the regular
    // tetrahedron of edge 6 and 14 (mod 90) for the square pyramid of base
    // 6 and height 9, each about three degrees of margin better than 45.
    const tetrahedron: RegularShape = { kind: 'regularPyramid', sides: 3, side: 6, height: 6 * Math.sqrt(2 / 3) }
    const square: RegularShape = { kind: 'regularPyramid', sides: 4, side: 6, height: 9 }
    expect(regularRotation(tetrahedron)).toBe(12)
    expect(placementMargin(tetrahedron, 12)).toBeCloseTo(18, 3)
    expect(placementMargin(tetrahedron, 45)).toBeCloseTo(15, 3)
    expect(regularRotation(square)).toBe(14)
    expect(placementMargin(square, 14)).toBeCloseTo(16, 3)
    expect(placementMargin(square, 45)).toBeCloseTo(15, 3)
    // ...and the pinned solids are untouched: the tetrahedron's A is still
    // at author azimuth 45.
    const pinned = buildSolid({ kind: 'tetrahedron', edge: 6 })
    expect(azimuth(worldToAuthor(pinned.polyhedron!.vertices[pinned.labelOrder[0]]))).toBeCloseTo(45, 9)
  })
})

// ---------------------------------------------------------------------------
// The lettering rule, and the solids themselves
// ---------------------------------------------------------------------------

describe('P5 lettering, on the hexagonal prism', () => {
  const HEX: SolidSpec = { kind: 'regularPrism', sides: 6, side: 12, height: 8 }
  const v = authorVertices(HEX)
  const [A, B] = v

  it('makes AB the front-most base edge: its outward normal points nearest the camera', () => {
    // Each base edge's outward normal is the azimuth of its midpoint.
    const gaps = [0, 1, 2, 3, 4, 5].map((i) => {
      const p = v[i]
      const q = v[(i + 1) % 6]
      const g = Math.abs(azimuth({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: 0 }) - CAMERA_AZIMUTH)
      return Math.min(g, 360 - g)
    })
    expect(Math.min(...gaps)).toBe(gaps[0])
  })

  it('puts A at the LEFT end of that edge as the viewer sees it', () => {
    // The viewer's right is azimuth 30 + 90 = 120: B lies that way of A.
    const right = { x: Math.cos((120 * Math.PI) / 180), y: Math.sin((120 * Math.PI) / 180) }
    expect((B.x - A.x) * right.x + (B.y - A.y) * right.y).toBeGreaterThan(0)
  })

  it('runs A to F counter-clockwise seen from above', () => {
    for (let i = 0; i < 6; i++) {
      const p = v[i]
      const q = v[(i + 1) % 6]
      expect(p.x * q.y - p.y * q.x).toBeGreaterThan(0)
      expect(p.z).toBeCloseTo(-4, 12)
    }
  })

  it('puts G over A, and the top over the base corner for corner', () => {
    for (let i = 0; i < 6; i++) {
      expect(v[6 + i].x).toBeCloseTo(v[i].x, 12)
      expect(v[6 + i].y).toBeCloseTo(v[i].y, 12)
      expect(v[6 + i].z).toBeCloseTo(4, 12)
    }
  })

  it('measures AB = 12 and the long diagonals AD = BE = 24, true length', () => {
    // The plan expected AD not to be axis-parallel. Under P5's rotation for
    // n = 6 (0 degrees) the front edge's normal points exactly at the
    // camera's azimuth, A sits at azimuth 0 and AD runs along author X. So
    // the proof of TRUE against projected rests on BE as well, which is
    // along neither axis, and which the camera is checked to foreshorten
    // (handoff lesson: never an axis-parallel segment as the sole proof).
    const spec =
      '@mode: figure\nS = solid prism regular 6 side 12, height 8 vertices ABCDEFGHIJKL\n' +
      'label: AB = 12\nlabel: AD = 24\nlabel: BE = 24\nlabel: S side = 12\nlabel: S height = 8'
    expect(render(spec).errors).toEqual([])
    const [B, E] = [v[1], v[4]]
    expect(Math.abs(E.x - B.x)).toBeGreaterThan(1)
    expect(Math.abs(E.y - B.y)).toBeGreaterThan(1)
    const solid = buildSolid(HEX).polyhedron!
    const [pb, pe] = [DEFAULT_CAMERA.project(solid.vertices[1]), DEFAULT_CAMERA.project(solid.vertices[4])]
    expect(Math.abs(Math.hypot(pe.x - pb.x, pe.y - pb.y) - 24)).toBeGreaterThan(1)
    expect(render(`${spec}\nlabel: BE = 23`).errors).toHaveLength(1)
  })
})

describe('the octahedron', () => {
  const OCT: SolidSpec = { kind: 'octahedron', edge: 6 }

  it('has eight triangular faces', () => {
    const solid = buildSolid(OCT).polyhedron!
    expect(solid.faces).toHaveLength(8)
    for (const face of solid.faces) expect(face).toHaveLength(3)
  })

  it('puts opposite vertices 6 sqrt 2 apart: across the equator and apex to apex', () => {
    const v = authorVertices(OCT)
    const distance = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    expect(distance(v[0], v[2])).toBeCloseTo(6 * Math.SQRT2, 12)
    expect(distance(v[1], v[3])).toBeCloseTo(6 * Math.SQRT2, 12)
    // E the top apex, F the bottom.
    expect(v[4].z).toBeCloseTo(3 * Math.SQRT2, 12)
    expect(v[5].z).toBeCloseTo(-3 * Math.SQRT2, 12)
    expect(distance(v[4], v[5])).toBeCloseTo(6 * Math.SQRT2, 12)
  })

  it('letters its equator by the rule, counter-clockwise from the front edge', () => {
    const v = authorVertices(OCT)
    for (let i = 0; i < 4; i++) expect(v[i].x * v[(i + 1) % 4].y - v[i].y * v[(i + 1) % 4].x).toBeGreaterThan(0)
    expect(render('@mode: figure\nO = solid octahedron edge 6 vertices ABCDEF\nlabel: O edge = 6\nlabel: AC = 8.48528137423857\nlabel: EF = 8.48528137423857').errors).toEqual([])
  })
})

describe('the rectangle pyramid', () => {
  it('runs its width along Y, its depth along X and its height along Z, lettered like the box', () => {
    const v = authorVertices({ kind: 'rectanglePyramid', width: 6, depth: 4, height: 9 })
    const expected = [
      [2, -3, -4.5],
      [2, 3, -4.5],
      [-2, 3, -4.5],
      [-2, -3, -4.5],
      [0, 0, 4.5],
    ]
    v.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i][0], 12)
      expect(p.y).toBeCloseTo(expected[i][1], 12)
      expect(p.z).toBeCloseTo(expected[i][2], 12)
    })
  })
})

describe('the pyramidal frustum', () => {
  const FRUSTUM: SolidSpec = { kind: 'regularFrustum', sides: 4, side: 6, top: 3, height: 4 }

  it('puts its top concentric with its base and turned with it: each top corner on the ray to its base corner', () => {
    const v = authorVertices(FRUSTUM)
    for (let i = 0; i < 4; i++) {
      expect(v[4 + i].x).toBeCloseTo(v[i].x / 2, 12)
      expect(v[4 + i].y).toBeCloseTo(v[i].y / 2, 12)
      expect(v[4 + i].z).toBeCloseTo(2, 12)
      expect(v[i].z).toBeCloseTo(-2, 12)
    }
  })

  it('has trapezoids for lateral faces — six quads in all, none split', () => {
    const solid = buildSolid(FRUSTUM).polyhedron!
    expect(solid.faces).toHaveLength(6)
    for (const face of solid.faces) expect(face).toHaveLength(4)
  })

  it('refuses a top equal to its side, and a top of 0, pointing at the prism and the pyramid', () => {
    const errors = (spec: string) => render(`@mode: figure\n${spec}`).errors.map((e) => e.message)
    expect(errors('F = solid frustum regular 4 side 6, top 6, height 4')).toEqual([expect.stringMatching(/is a prism — write "prism regular 4 side 6, height 4"/)])
    expect(errors('F = solid frustum regular 4 side 6, top 0, height 4')).toEqual([expect.stringMatching(/is a pyramid — write "pyramid regular 4 side 6, height 4"/)])
  })
})

// ---------------------------------------------------------------------------
// Named dimensions (P6's table)
// ---------------------------------------------------------------------------

describe('every named dimension of the new solids', () => {
  const CASES: [string, SolidSpec, Record<string, number>][] = [
    ['cube edge 4', { kind: 'cube', edge: 4 }, { edge: 4 }],
    ['prism regular 6 side 12, height 5', { kind: 'regularPrism', sides: 6, side: 12, height: 5 }, { side: 12, height: 5 }],
    ['pyramid regular 5 side 4, height 6', { kind: 'regularPyramid', sides: 5, side: 4, height: 6 }, { side: 4, height: 6 }],
    ['pyramid rectangle 6 by 4, height 9', { kind: 'rectanglePyramid', width: 6, depth: 4, height: 9 }, { width: 6, depth: 4, height: 9 }],
    ['octahedron edge 6', { kind: 'octahedron', edge: 6 }, { edge: 6 }],
    ['frustum regular 4 side 6, top 3, height 4', { kind: 'regularFrustum', sides: 4, side: 6, top: 3, height: 4 }, { side: 6, top: 3, height: 4 }],
  ]

  for (const [text, spec, dims] of CASES) {
    it(`resolves and asserts ${Object.keys(dims).join(', ')} on "${text}", under standard and isometric`, () => {
      expect(solidDimensions(spec)).toEqual(dims)
      const labels = Object.entries(dims)
        .map(([name, value]) => `label: S ${name} = ${value}`)
        .join('\n')
      for (const view of ['', '@view: isometric\n']) {
        expect(render(`@mode: figure\n${view}S = solid ${text}\n${labels}`).errors).toEqual([])
      }
      const wrong = Object.keys(dims)[0]
      expect(render(`@mode: figure\nS = solid ${text}\nlabel: S ${wrong} = 99`).errors).toHaveLength(1)
    })

    it(`hangs each edge dimension of "${text}" off a drawn front edge, the same one under both views`, () => {
      const body = buildSolid(spec)
      const solid = body.polyhedron!
      const key = (p: Vec3) => [p.x, p.y, p.z].map((c) => c.toFixed(9)).join(',')
      for (const dimension of Object.keys(dims)) {
        const segment = bodyDimensionSegment(body, dimension)!
        const ends = [key(segment[0]), key(segment[1])].sort().join(' ')
        // An axis dimension (a pyramid's or frustum's height) joins no two
        // vertices; every other one is an edge, and a drawn one.
        const onEdge = (camera: typeof DEFAULT_CAMERA) =>
          projectSolid(solid, camera).find((e) => [key(solid.vertices[e.vertices[0]]), key(solid.vertices[e.vertices[1]])].sort().join(' ') === ends)
        const standard = onEdge(DEFAULT_CAMERA)
        const isometric = onEdge(ISOMETRIC_CAMERA)
        if (dimension === 'height' && spec.kind !== 'regularPrism') {
          expect(standard).toBeUndefined()
          continue
        }
        expect(standard?.hidden).toBe(false)
        expect(isometric?.hidden).toBe(false)
        // Fixed against the default camera, never the active view: nothing
        // about it depends on a camera at all.
        expect(bodyDimensionSegment(body, dimension)).toEqual(segment)
      }
    })
  }
})
