import { describe, expect, it } from 'vitest'
import { cameraFor, type ProjectedArc, type ProjectedEdge, type ProjectedSegment, type Vec3 } from './project3d'
import {
  coneOutline,
  cylinderOutline,
  ellipseAt,
  ellipseTangentAt,
  frustumOutline,
  IDENTITY_PLACEMENT,
  localCamera,
  placementAlong,
  projectCircle,
  sphereOutline,
  toWorld,
  type ProjectedCircle,
} from './silhouette'
import { buildSolid, solidOutline } from './solids'
import { authorToWorld } from './authorFrame'
import { buildSolidFigure } from './solidScope'
import { parseSpec } from '../parser/parseSpec'
import { evalExpr } from '../parser/evalExpr'
import type { Expr } from '../parser/types'

// Every assertion here is against the geometry, not the markup. A silhouette
// that emits four elements and two arcs is still wrong if its lines are not
// tangent to its ellipses, and "it drew something" would not notice.

const ISO = cameraFor('isometric')

function arcs(edges: ProjectedEdge[]): ProjectedArc[] {
  return edges.filter((e): e is ProjectedArc => e.kind === 'arc')
}

function segments(edges: ProjectedEdge[]): ProjectedSegment[] {
  return edges.filter((e): e is ProjectedSegment => e.kind === 'segment')
}

// How far a point is from an ellipse, measured by walking the parameter.
// Coarse on purpose: it is only used to confirm a point IS on the curve, and
// a search is a weaker claim than the closed-form ones below.
function onEllipse(circle: ProjectedCircle, p: { x: number; y: number }): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < 20000; i++) {
    const q = ellipseAt(circle, (2 * Math.PI * i) / 20000)
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y))
  }
  return best
}

describe('a circle in space, projected', () => {
  it('keeps a circle facing the camera a circle, at the camera scale', () => {
    // A circle in the plane perpendicular to the view direction projects
    // with no foreshortening at all.
    const camera = cameraFor('front')
    const circle = projectCircle(camera, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 3, z: 0 })
    expect(circle.rx).toBeCloseTo(3, 12)
    expect(circle.ry).toBeCloseTo(3, 12)
  })

  it('squashes a circle edge-on to a segment, not to a fat ellipse', () => {
    // The xz-plane circle seen from the front: its z radius points straight
    // at the camera, so it has no width on the page.
    const circle = projectCircle(cameraFor('front'), { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })
    expect(circle.rx).toBeCloseTo(3, 12)
    expect(circle.ry).toBeCloseTo(0, 12)
  })

  it('foreshortens the isometric view of a horizontal circle by exactly 1/sqrt(3)', () => {
    // Under the isometric camera the xz-plane is tilted by the angle whose
    // sine is 1/sqrt(3), so a circle of radius r draws as an ellipse with
    // semi-axes r*scale and r*scale/sqrt(3).
    const circle = projectCircle(ISO, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })
    expect(circle.rx).toBeCloseTo(3 * ISO.scale, 12)
    expect(circle.ry).toBeCloseTo((3 * ISO.scale) / Math.sqrt(3), 12)
  })

  it('draws the circle angle it is handed, not some other point of the ellipse', () => {
    const circle = projectCircle(ISO, { x: 0, y: 1, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })
    for (const angle of [0, 0.7, Math.PI, 4.2]) {
      const direct = ISO.project({ x: 3 * Math.cos(angle), y: 1, z: 3 * Math.sin(angle) })
      const drawn = ellipseAt(circle, angle)
      expect(drawn.x).toBeCloseTo(direct.x, 12)
      expect(drawn.y).toBeCloseTo(direct.y, 12)
    }
  })
})

describe('the cylinder silhouette', () => {
  const RADIUS = 3
  const HEIGHT = 8
  const edges = cylinderOutline(RADIUS, HEIGHT, ISO)

  it('is two lines and four arcs — never a sampled polyline', () => {
    expect(segments(edges)).toHaveLength(2)
    expect(arcs(edges)).toHaveLength(4)
  })

  it('draws its silhouette lines GENUINELY tangent to both rims', () => {
    const top = projectCircle(ISO, { x: 0, y: HEIGHT / 2, z: 0 }, { x: RADIUS, y: 0, z: 0 }, { x: 0, y: 0, z: RADIUS })
    const bottom = projectCircle(ISO, { x: 0, y: -HEIGHT / 2, z: 0 }, { x: RADIUS, y: 0, z: 0 }, { x: 0, y: 0, z: RADIUS })
    for (const line of segments(edges)) {
      const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      // Each endpoint lies ON its rim...
      expect(onEllipse(top, line.a)).toBeLessThan(1e-3)
      expect(onEllipse(bottom, line.b)).toBeLessThan(1e-3)
      // ...and the rim's own tangent there is parallel to the line, which is
      // what "tangent" means and what touching alone would not prove.
      for (const [circle, point] of [
        [top, line.a],
        [bottom, line.b],
      ] as const) {
        const angle = angleOf(circle, point)
        const tangent = ellipseTangentAt(circle, angle)
        expect(Math.abs(tangent.x * direction.y - tangent.y * direction.x)).toBeLessThan(1e-6)
      }
    }
  })

  it('runs its silhouette lines parallel to the projected axis', () => {
    const axis = { x: ISO.project({ x: 0, y: 1, z: 0 }).x, y: ISO.project({ x: 0, y: 1, z: 0 }).y }
    for (const line of segments(edges)) {
      const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      expect(Math.abs(direction.x * axis.y - direction.y * axis.x)).toBeLessThan(1e-9)
    }
  })

  it('puts the two silhouette lines exactly a diameter apart, on opposite sides', () => {
    const [first, second] = segments(edges)
    const midFirst = { x: (first.a.x + first.b.x) / 2, y: (first.a.y + first.b.y) / 2 }
    const midSecond = { x: (second.a.x + second.b.x) / 2, y: (second.a.y + second.b.y) / 2 }
    // The two touch circles are antipodal on the rim, so the midpoints are a
    // projected diameter apart — which under the isometric camera is
    // 2r * scale * the foreshortening along that direction.
    expect(Math.hypot(midFirst.x - midSecond.x, midFirst.y - midSecond.y)).toBeGreaterThan(0)
    const centre = ISO.project({ x: 0, y: 0, z: 0 })
    expect(midFirst.x + midSecond.x).toBeCloseTo(2 * centre.x, 9)
    expect(midFirst.y + midSecond.y).toBeCloseTo(2 * centre.y, 9)
  })

  it('dashes the BACK half of the far rim and nothing else', () => {
    const hidden = edges.filter((e) => e.hidden)
    expect(hidden.map((e) => (e.kind === 'arc' ? e.object : 'segment'))).toEqual(['rim-far-back'])
  })

  // A camera from below and to one side. Built rather than named, because the
  // near rim of a cylinder under every named viewpoint is the top one, and a
  // test that only ever sees that case cannot tell "the nearer rim" from "the
  // top rim".
  const FROM_BELOW = {
    name: 'isometric' as const,
    direction: { x: 1 / Math.sqrt(3), y: -1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
    right: { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 },
    up: { x: 1 / Math.sqrt(6), y: 2 / Math.sqrt(6), z: 1 / Math.sqrt(6) },
    scale: Math.sqrt(6) / 2,
    project: (p: { x: number; y: number; z: number }) => ({
      x: (Math.sqrt(6) / 2) * (p.x * Math.SQRT1_2 - p.z * Math.SQRT1_2),
      y: (Math.sqrt(6) / 2) * ((p.x + 2 * p.y + p.z) / Math.sqrt(6)),
    }),
  }

  for (const [name, camera] of [
    ['from above', ISO],
    ['from above, standard', cameraFor('standard')],
    ['from below', FROM_BELOW],
  ] as const) {
    it(`dashes the half of the far rim that bulges toward the near one, ${name}`, () => {
      // Naming the dashed arc "rim-far-back" proves nothing on its own — the
      // name is assigned by position. This pins WHICH half is dashed,
      // geometrically: the hidden half is the one behind the body, so it
      // bulges from the far rim's centre TOWARD the near rim. Swap the two
      // halves and this fails, though every count and name stays the same.
      const drawn = cylinderOutline(RADIUS, HEIGHT, camera)
      const far = arcs(drawn).filter((a) => a.object.startsWith('rim-far'))
      const near = arcs(drawn).find((a) => a.object.startsWith('rim-near'))
      expect(far).toHaveLength(2)
      expect(near).toBeDefined()
      const toward = { x: near!.center.x - far[0].center.x, y: near!.center.y - far[0].center.y }
      for (const arc of far) {
        const mid = ellipseAt({ ...arc, parameter: (t) => t }, (arc.startAngle + arc.endAngle) / 2)
        const bulge = (mid.x - arc.center.x) * toward.x + (mid.y - arc.center.y) * toward.y
        if (arc.hidden) expect(bulge).toBeGreaterThan(0)
        else expect(bulge).toBeLessThan(0)
      }
    })

    it(`leaves the rim NEARER the camera whole, ${name}`, () => {
      // Which rim is complete is decided by depth along the view direction,
      // not by which is on top. Pin it against that definition.
      const drawn = cylinderOutline(RADIUS, HEIGHT, camera)
      const nearer =
        camera.direction.y >= 0 ? { x: 0, y: HEIGHT / 2, z: 0 } : { x: 0, y: -HEIGHT / 2, z: 0 }
      const expected = camera.project(nearer)
      for (const arc of arcs(drawn).filter((a) => a.object.startsWith('rim-near'))) {
        expect(arc.center.x).toBeCloseTo(expected.x, 12)
        expect(arc.center.y).toBeCloseTo(expected.y, 12)
        expect(arc.hidden).toBe(false)
      }
      expect(arcs(drawn).filter((a) => a.hidden)).toHaveLength(1)
    })
  }

  it('puts the far rim BELOW the near one, for a camera above the middle', () => {
    // The isometric camera looks down, so the top rim is the near one and
    // the bottom rim is the one with a hidden half.
    const back = arcs(edges).find((a) => a.object === 'rim-far-back')
    const near = arcs(edges).find((a) => a.object === 'rim-near-0')
    expect(back).toBeDefined()
    expect(near).toBeDefined()
    expect(back!.center.y).toBeLessThan(near!.center.y)
  })

  it('collapses to a single rim when the camera looks straight down the axis', () => {
    const top = cylinderOutline(RADIUS, HEIGHT, cameraFor('top'))
    expect(segments(top)).toHaveLength(0)
    expect(arcs(top)).toHaveLength(2)
    // Seen end on, a cylinder is a circle: both semi-axes equal.
    for (const arc of arcs(top)) {
      expect(arc.rx).toBeCloseTo(RADIUS, 12)
      expect(arc.ry).toBeCloseTo(RADIUS, 12)
    }
  })

  it('hides nothing when the axis is square to the view, because it is a rectangle', () => {
    const front = cylinderOutline(RADIUS, HEIGHT, cameraFor('front'))
    expect(front.filter((e) => e.hidden)).toHaveLength(0)
    // Both rims are edge-on, so every arc has collapsed to a straight line.
    for (const arc of arcs(front)) expect(arc.ry).toBeCloseTo(0, 12)
  })

  it('is deterministic: the same edges, in the same order, every time', () => {
    expect(JSON.stringify(cylinderOutline(RADIUS, HEIGHT, ISO))).toBe(JSON.stringify(edges))
  })
})

// The circle angle at which a projected circle passes through `p`, found by
// the same search `onEllipse` uses. Only called on points already confirmed
// to be on the curve.
function angleOf(circle: ProjectedCircle, p: { x: number; y: number }): number {
  const distance = (angle: number) => {
    const q = ellipseAt(circle, angle)
    return Math.hypot(q.x - p.x, q.y - p.y)
  }
  const steps = 20000
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps
    const d = distance(angle)
    if (d < bestDistance) {
      bestDistance = d
      best = angle
    }
  }
  // Refine to machine precision, so a tangency assertion measures the
  // GEOMETRY and not the step size of the search that found the point.
  let low = best - (2 * Math.PI) / steps
  let high = best + (2 * Math.PI) / steps
  for (let i = 0; i < 200; i++) {
    const a = low + (high - low) / 3
    const b = high - (high - low) / 3
    if (distance(a) < distance(b)) high = b
    else low = a
  }
  return (low + high) / 2
}

describe('the cone silhouette', () => {
  const RADIUS = 3
  const HEIGHT = 7
  const edges = coneOutline(RADIUS, HEIGHT, ISO)

  it('is two lines and two arcs', () => {
    expect(segments(edges)).toHaveLength(2)
    expect(arcs(edges)).toHaveLength(2)
  })

  it('runs both lines through the apex', () => {
    const apex = ISO.project({ x: 0, y: HEIGHT / 2, z: 0 })
    for (const line of segments(edges)) {
      expect(line.a.x).toBeCloseTo(apex.x, 12)
      expect(line.a.y).toBeCloseTo(apex.y, 12)
    }
  })

  it('makes both lines GENUINELY tangent to the base ellipse', () => {
    const base = projectCircle(ISO, { x: 0, y: -HEIGHT / 2, z: 0 }, { x: RADIUS, y: 0, z: 0 }, { x: 0, y: 0, z: RADIUS })
    for (const line of segments(edges)) {
      expect(onEllipse(base, line.b)).toBeLessThan(1e-3)
      const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      const tangent = ellipseTangentAt(base, angleOf(base, line.b))
      expect(Math.abs(tangent.x * direction.y - tangent.y * direction.x)).toBeLessThan(1e-5)
    }
  })

  it('touches the base exactly once per line, which is the whole claim', () => {
    // A line that merely crosses the ellipse would cut it twice. Sample the
    // signed area against the curve and confirm it never changes sign.
    const base = projectCircle(ISO, { x: 0, y: -HEIGHT / 2, z: 0 }, { x: RADIUS, y: 0, z: 0 }, { x: 0, y: 0, z: RADIUS })
    for (const line of segments(edges)) {
      const side = (p: { x: number; y: number }) =>
        (line.b.x - line.a.x) * (p.y - line.a.y) - (line.b.y - line.a.y) * (p.x - line.a.x)
      let positive = 0
      let negative = 0
      for (let i = 0; i < 2000; i++) {
        const s = side(ellipseAt(base, (2 * Math.PI * i) / 2000))
        if (s > 1e-9) positive++
        if (s < -1e-9) negative++
      }
      expect(positive === 0 || negative === 0).toBe(true)
    }
  })

  it('dashes exactly one of the two base arcs, the one behind the body', () => {
    const hidden = arcs(edges).filter((a) => a.hidden)
    expect(hidden).toHaveLength(1)
    // The visible half is the one nearer the camera: its arc midpoint is
    // below the centre of the base on the page, where the near side of a
    // downward-looking view puts it.
    const visible = arcs(edges).find((a) => !a.hidden)
    expect(visible).toBeDefined()
    expect(ellipseAt({ ...visible!, parameter: (t) => t }, (visible!.startAngle + visible!.endAngle) / 2).y).toBeLessThan(
      visible!.center.y
    )
  })

  it('shows its whole base when the camera is below it', () => {
    // From underneath, the base disc faces the viewer and no part of the rim
    // is behind the cone.
    const below = coneOutline(RADIUS, HEIGHT, {
      ...cameraFor('top'),
      direction: { x: 0.3, y: -0.9, z: 0.3 },
    })
    expect(below.filter((e) => e.hidden)).toHaveLength(0)
  })
})

describe('the sphere silhouette', () => {
  it('is a circle of the radius asked for, times the camera scale', () => {
    const edges = sphereOutline(4, ISO)
    expect(segments(edges)).toHaveLength(0)
    expect(arcs(edges)).toHaveLength(2)
    for (const arc of arcs(edges)) {
      expect(arc.rx).toBeCloseTo(4 * ISO.scale, 12)
      expect(arc.ry).toBeCloseTo(4 * ISO.scale, 12)
      expect(arc.hidden).toBe(false)
    }
  })

  it('is the same circle from every named viewpoint', () => {
    // A sphere has no orientation, so its outline cannot depend on one.
    for (const name of ['standard', 'isometric', 'front', 'top', 'side'] as const) {
      const camera = cameraFor(name)
      for (const arc of arcs(sphereOutline(4, camera))) expect(arc.rx).toBeCloseTo(4 * camera.scale, 12)
    }
  })
})

// ---------------------------------------------------------------------------
// P1 — placements and the local camera (phase 7)
// ---------------------------------------------------------------------------

const STANDARD = cameraFor('standard')

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

describe('the local camera (P1)', () => {
  // An axis in no special direction, off the origin.
  const TILTED = placementAlong({ x: 1, y: -2, z: 0.5 }, { x: 1, y: 2, z: 3 })

  it('keeps direction, right and up orthonormal and right-handed for a tilted axis', () => {
    const local = localCamera(STANDARD, TILTED)
    expect(local).not.toBe(STANDARD)
    for (const v of [local.direction, local.right, local.up]) expect(dot(v, v)).toBeCloseTo(1, 12)
    expect(dot(local.direction, local.right)).toBeCloseTo(0, 12)
    expect(dot(local.direction, local.up)).toBeCloseTo(0, 12)
    expect(dot(local.right, local.up)).toBeCloseTo(0, 12)
    const handed = cross(local.right, local.up)
    expect(handed.x).toBeCloseTo(local.direction.x, 12)
    expect(handed.y).toBeCloseTo(local.direction.y, 12)
    expect(handed.z).toBeCloseTo(local.direction.z, 12)
    // Its frame is the placement's: local y is the axis, normalised.
    const axis = TILTED.frame.axis
    const n = Math.hypot(1, 2, 3)
    expect(axis.x * n).toBeCloseTo(1, 12)
    expect(axis.y * n).toBeCloseTo(2, 12)
    expect(axis.z * n).toBeCloseTo(3, 12)
  })

  it('projects a local point exactly where the world camera projects the placed point', () => {
    const local = localCamera(STANDARD, TILTED)
    for (const p of [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: -1, z: 2 },
      { x: -0.5, y: 7, z: 1.25 },
    ]) {
      // origin + x u + y axis + z w, written out by hand from the frame.
      const { u, axis, w } = TILTED.frame
      const world = {
        x: TILTED.origin.x + p.x * u.x + p.y * axis.x + p.z * w.x,
        y: TILTED.origin.y + p.x * u.y + p.y * axis.y + p.z * w.y,
        z: TILTED.origin.z + p.x * u.z + p.y * axis.z + p.z * w.z,
      }
      expect(local.project(p).x).toBeCloseTo(STANDARD.project(world).x, 12)
      expect(local.project(p).y).toBeCloseTo(STANDARD.project(world).y, 12)
      const placed = toWorld(TILTED, p)
      expect(placed.x).toBeCloseTo(world.x, 12)
      expect(placed.y).toBeCloseTo(world.y, 12)
      expect(placed.z).toBeCloseTo(world.z, 12)
    }
  })

  it('uses the world camera ITSELF for an identity placement, so no byte can move', () => {
    expect(localCamera(STANDARD, IDENTITY_PLACEMENT)).toBe(STANDARD)
    // A vertical axis at the origin IS the identity: the frame rule gives
    // exactly (x, y, z) for it.
    expect(localCamera(ISO, placementAlong({ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }))).toBe(ISO)
  })

  // At the origin, and off it: off it, the local camera's projection is
  // affine, and a radius VECTOR must go through its linear part.
  for (const origin of [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: -1, z: 3 },
  ]) {
    it(`draws a cylinder along author X at ${JSON.stringify(origin)} with its silhouette lines GENUINELY tangent to both projected rims`, () => {
      // Author X is internal +z. The rims are the circles of radius 3 about
      // origin + (0, 0, +-4) in planes square to z, built here from the WORLD
      // geometry alone — the local camera appears nowhere in the expectation.
      const body = buildSolid({ kind: 'cylinder', radius: 3, height: 8 }, placementAlong(origin, { x: 0, y: 0, z: 1 }))
      const edges = solidOutline(body, STANDARD)
      const rims = [4, -4].map((z) =>
        projectCircle(STANDARD, { x: origin.x, y: origin.y, z: origin.z + z }, { x: 3, y: 0, z: 0 }, { x: 0, y: 3, z: 0 })
      )
      // Every drawn rim arc lies ON one of the two world rims — ends and middle.
      // (A radius vector projected with the placement's translation in it
      // would draw a different ellipse, and the lines alone would not notice.)
      expect(arcs(edges)).toHaveLength(4)
      for (const arc of arcs(edges)) {
        const drawn = { ...arc, parameter: (t: number) => t }
        for (const t of [arc.startAngle, (arc.startAngle + arc.endAngle) / 2, arc.endAngle]) {
          const point = ellipseAt(drawn, t)
          expect(Math.min(onEllipse(rims[0], point), onEllipse(rims[1], point))).toBeLessThan(1e-3)
        }
      }
      const lines = segments(edges)
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
        // One endpoint on each rim: a line along the body, not across a rim.
        const onFirst = [line.a, line.b].map((point) => onEllipse(rims[0], point) < 1e-3)
        expect(onFirst[0]).not.toBe(onFirst[1])
        for (const point of [line.a, line.b]) {
          const circle = onEllipse(rims[0], point) < onEllipse(rims[1], point) ? rims[0] : rims[1]
          expect(onEllipse(circle, point)).toBeLessThan(1e-3)
          const tangent = ellipseTangentAt(circle, angleOf(circle, point))
          expect(Math.abs(tangent.x * direction.y - tangent.y * direction.x)).toBeLessThan(1e-6)
        }
      }
    })
  }
})

// ---------------------------------------------------------------------------
// P2 — the frustum
// ---------------------------------------------------------------------------

describe('the frustum silhouette', () => {
  // Radius 6, top 3, height 4: base rim at y = -2, top rim at y = +2, and
  // the virtual apex where the generators meet, 4 * 6 / (6 - 3) = 8 above
  // the base, at y = 6.
  const edges = frustumOutline(6, 3, 4, STANDARD)
  const base = projectCircle(STANDARD, { x: 0, y: -2, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 6 })
  const top = projectCircle(STANDARD, { x: 0, y: 2, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })

  it('is two lines and four arcs', () => {
    expect(segments(edges)).toHaveLength(2)
    expect(arcs(edges)).toHaveLength(4)
  })

  it('runs both silhouette lines through the projected virtual apex', () => {
    const apex = STANDARD.project({ x: 0, y: 6, z: 0 })
    for (const line of segments(edges)) {
      const along = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      const toApex = { x: apex.x - line.a.x, y: apex.y - line.a.y }
      expect(Math.abs(along.x * toApex.y - along.y * toApex.x) / Math.hypot(along.x, along.y)).toBeLessThan(1e-9)
    }
  })

  it('makes both lines GENUINELY tangent to both rims', () => {
    for (const line of segments(edges)) {
      const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      for (const [circle, point] of [
        [base, line.a],
        [top, line.b],
      ] as const) {
        expect(onEllipse(circle, point)).toBeLessThan(1e-3)
        const tangent = ellipseTangentAt(circle, angleOf(circle, point))
        expect(Math.abs(tangent.x * direction.y - tangent.y * direction.x)).toBeLessThan(1e-6)
      }
    }
  })

  it('dashes the back half of the base rim, draws its front half, and draws the whole top rim', () => {
    const baseArcs = arcs(edges).filter((a) => a.object.startsWith('base'))
    const topArcs = arcs(edges).filter((a) => a.object.startsWith('top'))
    expect(baseArcs).toHaveLength(2)
    expect(topArcs).toHaveLength(2)
    expect(baseArcs.filter((a) => a.hidden)).toHaveLength(1)
    expect(topArcs.filter((a) => a.hidden)).toHaveLength(0)
    // Which half, geometrically: the camera looks down, so the back half of
    // the base rim is the one ABOVE its centre on the page.
    for (const arc of baseArcs) {
      const mid = ellipseAt({ ...arc, parameter: (t) => t }, (arc.startAngle + arc.endAngle) / 2)
      if (arc.hidden) expect(mid.y).toBeGreaterThan(arc.center.y)
      else expect(mid.y).toBeLessThan(arc.center.y)
    }
  })

  it('draws a frustum wider at the top as the same solid with its axis reversed, byte for byte', () => {
    const wide = solidOutline(buildSolid({ kind: 'frustum', radius: 3, top: 6, height: 4 }), STANDARD)
    const reversed = frustumOutline(6, 3, 4, localCamera(STANDARD, placementAlong({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })))
    expect(JSON.stringify(wide)).toBe(JSON.stringify(reversed))
    // ...which is not the frustum the right way up: its wide rim is on top.
    expect(JSON.stringify(wide)).not.toBe(JSON.stringify(edges))
    const wideRim = arcs(wide).find((a) => a.object === 'base-0')
    expect(wideRim!.center.y).toBeCloseTo(STANDARD.project({ x: 0, y: 2, z: 0 }).y, 12)
  })
})

// ---------------------------------------------------------------------------
// P6 — round solids placed by named points
// ---------------------------------------------------------------------------

describe('round solids placed by named points', () => {
  const value = (e: Expr) => evalExpr(e, {}, 'radians', {})
  function solidOf(spec: string, name: string) {
    const parsed = parseSpec(`@mode: figure\n${spec}`)
    expect(parsed.errors).toEqual([])
    const scope = buildSolidFigure(parsed.statements, value)
    expect(scope.errors).toEqual([])
    return scope.solids.get(name)!
  }

  it('draws a sphere on a centre M as a circle about M’s projection', () => {
    const edges = solidOutline(solidOf('M = (1, 2, 3)\nS = solid sphere center M radius 5', 'S'), STANDARD)
    const centre = STANDARD.project(authorToWorld({ x: 1, y: 2, z: 3 }))
    expect(arcs(edges)).toHaveLength(2)
    for (const arc of arcs(edges)) {
      expect(arc.center.x).toBeCloseTo(centre.x, 12)
      expect(arc.center.y).toBeCloseTo(centre.y, 12)
      expect(arc.rx).toBeCloseTo(5, 12)
      expect(arc.ry).toBeCloseTo(5, 12)
    }
  })

  it('draws a cylinder from A to B as a horizontal cylinder along author X, tangent to both rims', () => {
    // A = (0,0,0), B = (6,0,0): the rims are circles of radius 3 about A and
    // B, square to author X — spanned by author Y and Z, internal x and y.
    // Built from the named points alone.
    const edges = solidOutline(solidOf('A = (0, 0, 0)\nB = (6, 0, 0)\nC = solid cylinder from A to B radius 3', 'C'), STANDARD)
    const rims = [authorToWorld({ x: 0, y: 0, z: 0 }), authorToWorld({ x: 6, y: 0, z: 0 })].map((centre) =>
      projectCircle(STANDARD, centre, { x: 3, y: 0, z: 0 }, { x: 0, y: 3, z: 0 })
    )
    const lines = segments(edges)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
      // Parallel to the projected axis, author X...
      const axis = STANDARD.project(authorToWorld({ x: 1, y: 0, z: 0 }))
      expect(Math.abs(direction.x * axis.y - direction.y * axis.x)).toBeLessThan(1e-9)
      // ...one end on each rim, and tangent there.
      for (const point of [line.a, line.b]) {
        const circle = onEllipse(rims[0], point) < onEllipse(rims[1], point) ? rims[0] : rims[1]
        expect(onEllipse(circle, point)).toBeLessThan(1e-3)
        const tangent = ellipseTangentAt(circle, angleOf(circle, point))
        expect(Math.abs(tangent.x * direction.y - tangent.y * direction.x)).toBeLessThan(1e-6)
      }
    }
  })

  it('draws a cone on an apex V and a base centre O with both silhouette lines through V', () => {
    // Tilted toward author Y, and not so near the view that the camera looks
    // inside the cone's half-angle (where it has no silhouette at all).
    const edges = solidOutline(solidOf('V = (0, 4, 2)\nO = (0, 0, -1)\nK = solid cone apex V base O radius 3', 'K'), STANDARD)
    const apex = STANDARD.project(authorToWorld({ x: 0, y: 4, z: 2 }))
    const lines = segments(edges)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line.a.x).toBeCloseTo(apex.x, 12)
      expect(line.a.y).toBeCloseTo(apex.y, 12)
    }
  })

  it('draws a frustum from O to P as the frustum outline under the same placement', () => {
    const body = solidOf('O = (0, 0, 0)\nP = (4, 0, 0)\nF = solid frustum from O radius 6 to P radius 3', 'F')
    const placement = placementAlong(authorToWorld({ x: 2, y: 0, z: 0 }), authorToWorld({ x: 1, y: 0, z: 0 }))
    expect(JSON.stringify(solidOutline(body, STANDARD))).toBe(JSON.stringify(frustumOutline(6, 3, 4, localCamera(STANDARD, placement))))
  })
})
