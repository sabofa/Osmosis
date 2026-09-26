import { describe, expect, it } from 'vitest'
import { authorPlane, authorToWorld, worldToAuthor } from './authorFrame'
import { length3, scale3, sub3 } from './construct3d'
import { sectionOf, type SectionPiece } from './crossSection'
import { hullOf } from './hull'
import { canonicalPlane } from './plane'
import { cameraFor, DEFAULT_CAMERA, type Vec3 } from './project3d'
import { sectionOutline } from './sectionVisibility'
import { cylinderSilhouetteAngles } from './silhouette'
import { buildSolid } from './solids'

// Q6 — an in-place section's outline is drawn visible or hidden by where it
// lies on the solid. Every expectation is derived by hand from which way the
// standard camera looks: from author azimuth 30 degrees and elevation 25, its
// direction (cos 25 cos 30, cos 25 sin 30, sin 25) has every component
// positive, so the +X, +Y and +Z faces face it and the -X, -Y and -Z faces
// turn away.

const authorKey = (p: Vec3) => {
  const a = worldToAuthor(p)
  return [a.x, a.y, a.z].map((c) => Math.round(c * 1e9) / 1e9 + 0).join(',')
}

function segmentKey(piece: SectionPiece): string {
  if (piece.kind !== 'segment') throw new Error('expected a segment')
  return [authorKey(piece.a), authorKey(piece.b)].sort().join(' to ')
}

function at(piece: Extract<SectionPiece, { kind: 'arc' }>, t: number): Vec3 {
  return {
    x: piece.center.x + piece.u.x * Math.cos(t) + piece.v.x * Math.sin(t),
    y: piece.center.y + piece.u.y * Math.cos(t) + piece.v.y * Math.sin(t),
    z: piece.center.z + piece.u.z * Math.cos(t) + piece.v.z * Math.sin(t),
  }
}

describe('the outline of a polyhedron cut (Q6)', () => {
  it('dashes exactly the two edges of the box cut z = 1 that lie on its back faces', () => {
    // The 8 (width, Y) by 5 (height, Z) by 6 (depth, X) prism: X in [-3, 3],
    // Y in [-4, 4]. At z = 1 the section's four sides lie on the four side
    // faces; the ones on X = -3 and Y = -4 face away.
    const box = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
    const plane = authorPlane('z', 1)
    const outline = sectionOutline(box, sectionOf(box, plane, 'S'), plane, DEFAULT_CAMERA)
    expect(outline).toHaveLength(4)
    const hidden = outline.filter((o) => o.hidden).map((o) => segmentKey(o.piece)).sort()
    expect(hidden).toEqual(['-3,-4,1 to -3,4,1', '-3,-4,1 to 3,-4,1'])
  })

  it('draws each edge of the cube’s central hexagon as its face is drawn', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const corners = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 1, z: 1 },
    ].map(authorToWorld)
    const cube = buildSolid({ kind: 'hull', shape: 'hull', polyhedron: hullOf(corners, names) })
    const n = authorToWorld({ x: 1, y: 1, z: 1 })
    const plane = canonicalPlane({ point: authorToWorld({ x: 0.5, y: 0.5, z: 0.5 }), normal: scale3(n, 1 / length3(n)) }, 'hexagon')
    const outline = sectionOutline(cube, sectionOf(cube, plane, 'K'), plane, DEFAULT_CAMERA)
    // Each side lies on the face its two midpoints share: x = 1, z = 0, y = 1,
    // x = 0, z = 1, y = 0 in turn. The +X, +Y, +Z ones face the camera.
    const expected: Record<string, boolean> = {
      '1,0,0.5 to 1,0.5,0': false, // x = 1
      '0.5,1,0 to 1,0.5,0': true, // z = 0
      '0,1,0.5 to 0.5,1,0': false, // y = 1
      '0,0.5,1 to 0,1,0.5': true, // x = 0
      '0,0.5,1 to 0.5,0,1': false, // z = 1
      '0.5,0,1 to 1,0,0.5': true, // y = 0
    }
    expect(outline).toHaveLength(6)
    for (const { piece, hidden } of outline) expect(hidden).toBe(expected[segmentKey(piece)])
  })
})

describe('the outline of a round-solid cut (Q6)', () => {
  it('splits a horizontal cut of a cylinder into a front arc and a dashed back arc, at the silhouette angles', () => {
    const cylinder = buildSolid({ kind: 'cylinder', radius: 3, height: 8 })
    const plane = authorPlane('z', 1)
    for (const camera of [DEFAULT_CAMERA, cameraFor('isometric')]) {
      const outline = sectionOutline(cylinder, sectionOf(cylinder, plane, 'C'), plane, camera)
      expect(outline).toHaveLength(2)
      expect(outline.filter((o) => o.hidden)).toHaveLength(1)
      // Every split is where the radial direction is perpendicular to the view:
      // cylinderSilhouetteAngles, modulo a turn.
      const silhouette = cylinderSilhouetteAngles(camera)!
      const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      for (const { piece } of outline) {
        if (piece.kind !== 'arc') throw new Error('expected arcs')
        for (const end of [piece.from, piece.to]) {
          expect(silhouette.some((s) => Math.abs(turn(s) - turn(end)) < 1e-9 || Math.abs(Math.abs(turn(s) - turn(end)) - 2 * Math.PI) < 1e-9)).toBe(true)
        }
      }
      // The visible arc is the one whose middle faces the camera.
      for (const { piece, hidden } of outline) {
        if (piece.kind !== 'arc') continue
        const middle = sub3(at(piece, (piece.from + piece.to) / 2), piece.center)
        expect(middle.x * camera.direction.x + middle.z * camera.direction.z > 0).toBe(!hidden)
      }
    }
  })

  it('splits an oblique circle of a sphere where (p - c) . d = 0', () => {
    // x - z = 3 sqrt 2 is 3 from the centre of the sphere of radius 5: a
    // circle of radius 4 about (3/sqrt 2, 0, -3/sqrt 2). With n = (1, 0, -1)/
    // sqrt 2, d . n = (cos25 cos30 - sin25)/sqrt 2 = 0.256, so the circle's
    // own centre is 3(0.256) = 0.77 toward the viewer while its radius swings
    // the facing by 4 sqrt(1 - 0.256^2) = 3.87: it crosses the silhouette.
    const sphere = buildSolid({ kind: 'sphere', radius: 5 })
    const n = authorToWorld({ x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 })
    const plane = canonicalPlane({ point: scale3(n, 3), normal: n }, 'x - z = 3 sqrt 2')
    const outline = sectionOutline(sphere, sectionOf(sphere, plane, 'S'), plane, DEFAULT_CAMERA)
    expect(outline).toHaveLength(2)
    const d = DEFAULT_CAMERA.direction
    const facing = (p: Vec3) => p.x * d.x + p.y * d.y + p.z * d.z
    for (const { piece, hidden } of outline) {
      if (piece.kind !== 'arc') throw new Error('expected arcs')
      expect(Math.abs(facing(at(piece, piece.from)))).toBeLessThan(1e-9)
      expect(Math.abs(facing(at(piece, piece.to)))).toBeLessThan(1e-9)
      expect(facing(at(piece, (piece.from + piece.to) / 2)) > 0).toBe(!hidden)
    }
  })

  it('dashes the log wedge’s chord on the base, and splits its arc at the silhouette', () => {
    // The base faces -Z, away from a camera above it. In the cylinder's own
    // angle the arc runs over theta in [0, pi]; the silhouette is where
    // cos(theta) d.x + sin(theta) d.z = 0 with internal d = (0.453, 0.423,
    // 0.785): theta = 150 degrees. Before it the side faces the viewer.
    const cylinder = buildSolid({ kind: 'cylinder', radius: 3, height: 10 })
    const n = authorToWorld({ x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 })
    const plane = canonicalPlane({ point: authorToWorld({ x: 0, y: 0, z: -5 }), normal: n }, 'x - z = 5')
    const outline = sectionOutline(cylinder, sectionOf(cylinder, plane, 'C'), plane, DEFAULT_CAMERA)
    const chords = outline.filter((o) => o.piece.kind === 'segment')
    expect(chords).toHaveLength(1)
    expect(chords[0].hidden).toBe(true)
    const arcs = outline.filter((o) => o.piece.kind === 'arc')
    expect(arcs).toHaveLength(2)
    const d = DEFAULT_CAMERA.direction
    const silhouette = Math.atan2(-d.x, d.z) + Math.PI // 150 degrees
    expect((silhouette * 180) / Math.PI).toBeCloseTo(150, 0)
    for (const { piece, hidden } of arcs) {
      if (piece.kind !== 'arc') continue
      const [lo, hi] = [Math.min(piece.from, piece.to), Math.max(piece.from, piece.to)]
      // The visible arc is the longer one, [0, 150]; the hidden one [150, 180].
      expect(hidden).toBe(hi - lo < Math.PI / 2)
      const middle = at(piece, (lo + hi) / 2)
      expect(middle.x * d.x + middle.z * d.z > 0).toBe(!hidden)
    }
  })
})

// ---------------------------------------------------------------------------
// Fix round 1 — rings under the front, side and top views
// ---------------------------------------------------------------------------
//
// A cut square to the axis of an upright round solid is a ring about the
// axis, drawn with radius vectors u = r (internal x) and v = r (internal z)
// (planeRadii for internal y), so its angle is the cylinder angle t. The
// front view looks along internal +z: the side's facing along the ring is
// r sin t, zero at t = 0 and t = pi — exactly at the ring's own start —
// visible on (0, pi). The side view looks along internal +x: r cos t, zero at
// pi/2 and 3pi/2, hidden on (pi/2, 3pi/2). A cone's side leans, but at its
// widest point the lean is along y, which neither view sees: the same
// angles. A sphere's facing is (p - c) . d: the same again.

describe('rings under the front, side and top views (Q6, fix round 1)', () => {
  const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const same = (a: number, b: number) => Math.abs(turn(a) - turn(b)) < 1e-9 || Math.abs(Math.abs(turn(a) - turn(b)) - 2 * Math.PI) < 1e-9

  const RINGS: [string, ReturnType<typeof buildSolid>, number][] = [
    ['cylinder radius 3, height 8, cut at z = 1', buildSolid({ kind: 'cylinder', radius: 3, height: 8 }), 1],
    ['cone radius 3, height 4, cut at z = 0', buildSolid({ kind: 'cone', radius: 3, height: 4 }), 0],
    ['sphere radius 5, cut at z = 3', buildSolid({ kind: 'sphere', radius: 5 }), 3],
  ]

  for (const [name, body, height] of RINGS) {
    const plane = authorPlane('z', height)
    const outline = (view: 'front' | 'side' | 'top') => sectionOutline(body, sectionOf(body, plane, 'K'), plane, cameraFor(view))

    for (const [view, zeros, visibleMiddle] of [
      ['front', [0, Math.PI], Math.PI / 2],
      ['side', [Math.PI / 2, (3 * Math.PI) / 2], 0],
    ] as const) {
      it(`splits the ${name} under the ${view} view at ${zeros.map((z) => `${z / Math.PI}pi`).join(' and ')}`, () => {
        const pieces = outline(view)
        expect(pieces).toHaveLength(2)
        expect(pieces.filter((p) => p.hidden)).toHaveLength(1)
        for (const { piece, hidden } of pieces) {
          if (piece.kind !== 'arc') throw new Error('expected arcs')
          for (const end of [piece.from, piece.to]) expect(zeros.some((z) => same(z, end))).toBe(true)
          // The visible arc is the one through the hand-derived visible middle.
          const middle = (piece.from + piece.to) / 2
          expect(!hidden).toBe(same(middle, visibleMiddle))
        }
      })
    }
  }

  it('draws the cone’s and the sphere’s rings whole and visible from the top, and the cylinder’s hidden under its top', () => {
    // From above, a cone's side faces up everywhere below its apex, and the
    // sphere's circle at z = 3 is on its upper half: one visible piece each.
    // A cylinder's side is exactly edge-on from above, and its top cap covers
    // the ring: one hidden piece (drawn under the rim, which is the outline).
    for (const [body, height, hidden] of [
      [RINGS[1][1], 0, false],
      [RINGS[2][1], 3, false],
      [RINGS[0][1], 1, true],
    ] as const) {
      const plane = authorPlane('z', height)
      const pieces = sectionOutline(body, sectionOf(body, plane, 'K'), plane, cameraFor('top'))
      expect(pieces).toHaveLength(1)
      expect(pieces[0].hidden).toBe(hidden)
    }
  })
})

// ---------------------------------------------------------------------------
// Fix round 1 — a polyhedron cut under the front, side and top views
// ---------------------------------------------------------------------------
//
// The 8 (Y) by 5 (Z) by 6 (X) box cut at z = 1. The front view looks along
// author +X: the X = 3 face faces it, X = -3 turns away, and the Y = +-4
// faces are edge-on — not facing (projectSolid's strict rule), so their
// sides are hidden, and they run along X, the view direction, so each is
// seen end-on as a point. The side view is the same turned to author +Y. The
// top view looks down author Z: every side face is edge-on and the top face
// covers the whole cut, so all four sides are hidden.

describe('a polyhedron cut under the front, side and top views (Q6, fix round 1)', () => {
  const box = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
  const plane = authorPlane('z', 1)
  const hiddenSides = (view: 'front' | 'side' | 'top') =>
    sectionOutline(box, sectionOf(box, plane, 'S'), plane, cameraFor(view))
      .filter((o) => o.hidden)
      .map((o) => segmentKey(o.piece))
      .sort()

  it('front: only the side on X = 3 is visible', () => {
    expect(hiddenSides('front')).toEqual(['-3,-4,1 to -3,4,1', '-3,-4,1 to 3,-4,1', '-3,4,1 to 3,4,1'])
  })

  it('side: only the side on Y = 4 is visible', () => {
    expect(hiddenSides('side')).toEqual(['-3,-4,1 to -3,4,1', '-3,-4,1 to 3,-4,1', '3,-4,1 to 3,4,1'])
  })

  it('top: all four sides are hidden under the top face', () => {
    expect(hiddenSides('top')).toHaveLength(4)
  })
})
