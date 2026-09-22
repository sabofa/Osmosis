import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { evalExpr } from '../parser/evalExpr'
import { buildScene } from './buildScene'

const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

function build(spec: string) {
  const parsed = parseSpec(spec)
  return { parsed, scene: buildScene(parsed.statements, bounds, parsed.config) }
}

// Point-in-triangle test (barycentric sign method) used below to check the
// *actual* filled geometry of a chained region, not just that a region
// object was emitted — see the task's warning about tests that would pass
// even if the fill were wrong.
function sign(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
}

function pointInTriangle(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): boolean {
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function coveredByFill(triangles: { x: number; y: number }[], point: { x: number; y: number }): boolean {
  for (let i = 0; i < triangles.length; i += 3) {
    if (pointInTriangle(point, triangles[i], triangles[i + 1], triangles[i + 2])) return true
  }
  return false
}

describe('buildScene', () => {
  it('samples an explicit function into a curve', () => {
    const { scene } = build('y = x^2')
    const curve = scene.objects.find((o) => o.kind === 'curve')
    expect(curve).toBeDefined()
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.points.length).toBeGreaterThan(10)
  })

  it('resolves a named function referenced before its own definition line', () => {
    // k(x) is used on the line above where it's defined — the grammar is
    // explicitly order-independent for definitions (see parser/types.ts).
    const { scene } = build('y = k(x)\nk(x) = x^2 + 1')
    expect(scene.errors).toEqual([])
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    // y = k(2) = 5
    const p = curve.points.find((pt) => Math.abs(pt.x - 2) < 0.1)
    expect(p?.y).toBeCloseTo(5, 0)
  })

  it('resolves a self-composed function (k(k(x)))', () => {
    const { scene } = build('k(x) = x^2\ny = k(k(x))')
    expect(scene.errors).toEqual([])
  })

  it('carries the function table on an animatedPoint scene object so a path referencing a named function still resolves per-frame', () => {
    const { scene } = build('k(t) = cos(t) * 2\nanimate: (k(t), sin(t)*2) for t in [0, 6.283]')
    const anim = scene.objects.find((o) => o.kind === 'animatedPoint')
    expect(anim).toBeDefined()
    if (anim?.kind !== 'animatedPoint') throw new Error('unreachable')
    // The bug this guards against: SceneRenderer's per-frame evalExpr call
    // used to run without this table at all, so any function reference threw
    // "Unknown function" on every frame and the point never moved off (0,0).
    const x = evalExpr(anim.fx, { t: 1 }, 'radians', anim.functions)
    expect(x).toBeCloseTo(Math.cos(1) * 2)
  })

  it('collects a per-statement error without dropping the rest of the scene', () => {
    // The point's coordinates reference an unbound variable, which throws
    // during buildScene's one-off evalExpr call for that statement — caught
    // and recorded per-statement, not fatal to the whole build.
    const { scene } = build('y = x\nA = (undefinedvar, 2)')
    expect(scene.errors.length).toBe(1)
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(1)
  })

  it('applies a per-statement color override', () => {
    const { scene } = build('y = x^2 color: teal')
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.color).toBe('teal')
  })

  it('drops a named statement from the scene when @hide targets its name', () => {
    const { scene } = build('@hide: helper\ny = x^2 name: main\ny = x + 3 name: helper')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(1)
  })

  it('still keeps a hidden function usable when composed by name from another statement', () => {
    // Hiding only skips rendering the statement itself — collectFunctions
    // still sees it, so a hidden helper function stays callable elsewhere.
    const { scene } = build('@hide: k\nk(x) = x^2 name: k\ny = k(x) + 1')
    expect(scene.errors).toEqual([])
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(1)
    const p = curves[0].kind === 'curve' ? curves[0].points.find((pt) => Math.abs(pt.x - 2) < 0.1) : undefined
    expect(p?.y).toBeCloseTo(5, 0)
  })

  it('runs a linear regression on scatter points', () => {
    const { scene } = build('scatter: (1,2), (2,4), (3,6)')
    expect(scene.regression).not.toBeNull()
    expect(scene.regression?.slope).toBeCloseTo(2, 1)
  })

  it('labels a vector with its magnitude', () => {
    const { scene } = build('vector: (0,0) -> (3,4)')
    const ray = scene.objects.find((o) => o.kind === 'ray')
    if (ray?.kind !== 'ray') throw new Error('unreachable')
    expect(ray.label).toBe('|v| = 5')
  })

  it('samples a circle as a closed curve at the right center and radius', () => {
    const { scene } = build('circle: (2, 3), 5')
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    // Closed loop: last point coincides with the first.
    const first = curve.points[0]
    const last = curve.points[curve.points.length - 1]
    expect(first.x).toBeCloseTo(last.x, 5)
    expect(first.y).toBeCloseTo(last.y, 5)
    // Every sampled point sits exactly `radius` from the center.
    for (const p of curve.points) {
      expect(Math.hypot(p.x - 2, p.y - 3)).toBeCloseTo(5, 5)
    }
  })

  it('rejects a non-positive circle radius as a per-statement error, not a thrown exception', () => {
    const { scene } = build('circle: (0, 0), 0')
    expect(scene.errors.length).toBe(1)
    expect(scene.objects.length).toBe(0)
  })

  // `exact` means "this position is literal or analytically resolved", not
  // "this came from feature detection" (see types.ts). An author-typed point
  // is the most literal position there is — it used to report exact: false
  // while a bisected root reported true, which is backwards.
  it('marks an author-typed point as exact', () => {
    const { scene } = build('A = (2, 3)')
    const point = scene.objects.find((o) => o.kind === 'point')
    if (point?.kind !== 'point') throw new Error('unreachable')
    expect(point.position).toEqual({ x: 2, y: 3 })
    expect(point.exact).toBe(true)
  })

  it('points each polygon vertex label away from the polygon\'s own centroid', () => {
    // Right triangle with vertices at the origin, on the x-axis, and on the
    // y-axis — an angle:/right-angle: mark at A always sits toward positive
    // x/y (inside the triangle), so A's label should point toward negative
    // x/y (away from both other vertices) instead of the default up-right.
    const { scene } = build('polygon: A(0,0), B(4,0), C(0,3)')
    const points = scene.objects.filter((o) => o.kind === 'point')
    const a = points.find((p) => p.kind === 'point' && p.label === 'A')
    if (a?.kind !== 'point') throw new Error('unreachable')
    expect(a.labelDirection?.x).toBeLessThan(0)
    expect(a.labelDirection?.y).toBeLessThan(0)
  })

  // Regression test for a real bug: a polygon vertex's label offset is a
  // fixed *pixel* distance, which at a small-enough on-screen size (a
  // shrunk-down polygon at a zoomed-out view) becomes a world distance
  // bigger than the polygon itself — scattering labels away from their own
  // vertices, or bunching adjacent vertices' labels into each other, instead
  // of shrinking down along with the shape. maxLabelOffset caps that at the
  // scene-building layer (see SceneRenderer.ts for where it's applied).
  it('caps each polygon vertex label offset to a fraction of its own distance to the centroid', () => {
    const { scene } = build('polygon: A(0,0), B(4,0), C(0,3)')
    const points = scene.objects.filter((o) => o.kind === 'point')
    const a = points.find((p) => p.kind === 'point' && p.label === 'A')
    if (a?.kind !== 'point') throw new Error('unreachable')
    // Centroid is (4/3, 1), so A's distance to it is hypot(4/3, 1).
    const distanceToCentroid = Math.hypot(4 / 3, 1)
    expect(a.maxLabelOffset).toBeGreaterThan(0)
    expect(a.maxLabelOffset).toBeLessThan(distanceToCentroid)
  })

  it('builds a polygon as edges plus one labeled point per vertex, and registers vertices as named points', () => {
    const { scene } = build('polygon: A(0,0), B(4,0), C(2,3)\nangle: A-B-C label: test')
    expect(scene.errors).toEqual([])
    const segments = scene.objects.find((o) => o.kind === 'segments')
    if (segments?.kind !== 'segments') throw new Error('unreachable')
    expect(segments.pairs.length).toBe(3) // triangle: 3 edges, closing back to A

    const points = scene.objects.filter((o) => o.kind === 'point')
    expect(points.map((p) => (p.kind === 'point' ? p.label : null))).toEqual(['A', 'B', 'C'])

    const angle = scene.objects.find((o) => o.kind === 'angleMark')
    expect(angle).toBeDefined() // resolved A/B/C from the polygon's own vertices
  })

  it('resolves angle:/tick:/right-angle: against a plain named point defined anywhere in the spec', () => {
    // B is referenced before its own definition — same order-independence as functions.
    const { scene } = build('angle: A-B-C label: 60°\ntick: A-B\nright-angle: A-B-C\nA = (0, 0)\nB = (4, 0)\nC = (2, 3)')
    expect(scene.errors).toEqual([])
    expect(scene.objects.some((o) => o.kind === 'angleMark')).toBe(true)
    expect(scene.objects.some((o) => o.kind === 'tickMark')).toBe(true)
    expect(scene.objects.some((o) => o.kind === 'rightAngleMark')).toBe(true)
  })

  it('reports a per-statement error when angle: references an undefined point name', () => {
    const { scene } = build('A = (0, 0)\nB = (4, 0)\nangle: A-B-Z')
    expect(scene.errors.length).toBe(1)
    expect(scene.errors[0].message).toMatch(/Unknown point "Z"/)
    // The rest of the scene still builds despite the one bad statement.
    expect(scene.objects.some((o) => o.kind === 'point')).toBe(true)
  })
})

describe('chained inequality regions', () => {
  it('fills exactly the intersection band for "7 < x < 12" — a point inside is covered, one outside is not', () => {
    const { scene } = build('7 < x < 12')
    expect(scene.errors).toEqual([])
    const region = scene.objects.find((o) => o.kind === 'region')
    if (region?.kind !== 'region') throw new Error('unreachable')
    expect(region.triangles.length).toBeGreaterThan(0)
    // This would fail if the chain silently fell back to a single bound
    // (e.g. only "x < 12"), or to a union instead of an intersection,
    // because (3, 0) would then be wrongly covered too.
    expect(coveredByFill(region.triangles, { x: 9, y: 0 })).toBe(true)
    expect(coveredByFill(region.triangles, { x: 3, y: 0 })).toBe(false)
    expect(coveredByFill(region.triangles, { x: 0, y: 0 })).toBe(false)
  })

  it('fills an annulus for "1 <= x^2 + y^2 <= 4" — inside the ring is covered, the center and far outside are not', () => {
    const { scene } = build('1 <= x^2 + y^2 <= 4')
    const region = scene.objects.find((o) => o.kind === 'region')
    if (region?.kind !== 'region') throw new Error('unreachable')
    // Off-axis probe points, deliberately not on x=0/y=0: the inner circle
    // (radius 1) passes exactly through grid corners on the axes at this
    // spec's bounds/resolution, which makes marching squares emit
    // legitimate zero-area boundary triangles collinear with the axes —
    // a pre-existing artifact of the shared marching-squares tracer, not
    // something this chained-region feature introduces. Keeping the probes
    // off-axis avoids that artifact instead of masking it.
    // 1.5^2 + 0.5^2 = 2.5, inside the ring (1 <= r^2 <= 4).
    expect(coveredByFill(region.triangles, { x: 1.5, y: 0.5 })).toBe(true)
    // 0.3^2 + 0.2^2 = 0.13, inside the inner circle, excluded by the low bound.
    expect(coveredByFill(region.triangles, { x: 0.3, y: 0.2 })).toBe(false)
    // 5^2 + 3^2 = 34, well outside the ring, excluded by the high bound.
    expect(coveredByFill(region.triangles, { x: 5, y: 3 })).toBe(false)
  })

  it('draws a solid boundary for an inclusive chain and a dashed boundary for a strict chain', () => {
    const inclusive = build('-2 <= x <= 5').scene
    const inclusiveSegments = inclusive.objects.filter((o) => o.kind === 'segments')
    expect(inclusiveSegments.length).toBeGreaterThan(0)
    // This would fail if dashing were left at its old single-inequality
    // default (dashed = op === '<' || op === '>'), since "<=" chains would
    // then never come out solid.
    for (const seg of inclusiveSegments) {
      if (seg.kind !== 'segments') throw new Error('unreachable')
      expect(seg.dashed).toBe(false)
    }

    const strict = build('-2 < x < 5').scene
    const strictSegments = strict.objects.filter((o) => o.kind === 'segments')
    expect(strictSegments.length).toBeGreaterThan(0)
    for (const seg of strictSegments) {
      if (seg.kind !== 'segments') throw new Error('unreachable')
      expect(seg.dashed).toBe(true)
    }
  })

  it('dashes each edge of a mixed-strictness chain according to its own operator, not one uniform style', () => {
    const { scene } = build('-2 <= x < 5')
    const segmentObjs = scene.objects.filter((o): o is Extract<typeof scene.objects[number], { kind: 'segments' }> => o.kind === 'segments')
    const dashedGroups = segmentObjs.filter((o) => o.dashed === true)
    const solidGroups = segmentObjs.filter((o) => o.dashed === false)
    // This would fail under the "dashed if either bound is strict" fallback,
    // which would dash both edges instead of splitting them.
    expect(dashedGroups.length).toBeGreaterThan(0)
    expect(solidGroups.length).toBeGreaterThan(0)

    // The strict "< 5" edge should sit near x = 5; the inclusive "-2 <="
    // edge should sit near x = -2 — confirms the split tracks the right
    // edge, not just that some split happened.
    const dashedXs = dashedGroups.flatMap((o) => o.pairs.flatMap((p) => [p[0].x, p[1].x]))
    const solidXs = solidGroups.flatMap((o) => o.pairs.flatMap((p) => [p[0].x, p[1].x]))
    for (const x of dashedXs) expect(x).toBeCloseTo(5, 0)
    for (const x of solidXs) expect(x).toBeCloseTo(-2, 0)
  })
})

describe('feature points', () => {
  it('marks a parabola vertex as a local minimum at the true vertex', () => {
    const { scene } = build('@points: extrema\ny = x^2 - 2x - 1')
    const points = scene.objects.filter((o) => o.kind === 'point')
    expect(points).toHaveLength(1)
    if (points[0].kind !== 'point') throw new Error('unreachable')
    expect(points[0].feature).toBe('local-min')
    expect(points[0].position.x).toBeCloseTo(1, 4)
    expect(points[0].position.y).toBeCloseTo(-2, 4)
  })

  it('distinguishes roots from extrema instead of emitting identical dots', () => {
    const { scene } = build('@points: roots, extrema\ny = x^2 - 4')
    const features = scene.objects
      .filter((o) => o.kind === 'point')
      .map((o) => (o.kind === 'point' ? o.feature : null))
      .sort()
    expect(features).toEqual(['local-min', 'x-intercept', 'x-intercept', 'y-intercept'])
  })

  it('emits nothing when @points is absent', () => {
    const { scene } = build('y = x^2 - 4')
    expect(scene.objects.filter((o) => o.kind === 'point')).toHaveLength(0)
  })

  it('finds intersections between two statements', () => {
    const { scene } = build('@points: intersections\ny = x^2\ny = x + 2')
    const points = scene.objects.filter((o) => o.kind === 'point')
    expect(points).toHaveLength(2)
    if (points[0].kind !== 'point') throw new Error('unreachable')
    expect(points[0].feature).toBe('intersection')
  })

  // The v1 defect: a circle comes from marching squares, whose output is not
  // in path order, so scanning consecutive entries produced a scatter of
  // meaningless "vertices" all over the curve.
  it('does not scatter spurious extrema over an implicit circle', () => {
    const { scene } = build('@points: extrema\nx^2 + y^2 = 25')
    expect(scene.objects.filter((o) => o.kind === 'point').length).toBeLessThanOrEqual(2)
  })

  // The level the noise-firing inflection defect was actually seen at: the
  // unit test in featurePoints.test.ts pins explicitFeatures, but "@points:
  // all" is what an author types, and it is the expansion to every group
  // that put inflections on a statement nobody would ask them for. A
  // straight line came back with ~800 square markers along it.
  it('puts no inflections on a straight line under @points: all', () => {
    const { scene } = build('@points: all\ny = 2x + 1')
    const inflections = scene.objects.filter((o) => o.kind === 'point' && o.feature === 'inflection')
    expect(inflections).toEqual([])
  })

  it('labels coordinates when @point-labels is coords', () => {
    const { scene } = build('@points: extrema\n@point-labels: coords\ny = x^2 - 2x - 1')
    const point = scene.objects.find((o) => o.kind === 'point')
    if (point?.kind !== 'point') throw new Error('unreachable')
    expect(point.label).toMatch(/1/)
  })
})
