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

describe('geometry constructions', () => {
  function points(scene: { objects: { kind: string }[] }) {
    return scene.objects.filter((o) => o.kind === 'point') as Extract<
      import('./types').SceneObject,
      { kind: 'point' }
    >[]
  }

  function pointNamed(scene: { objects: { kind: string }[] }, label: string) {
    const found = points(scene).find((p) => p.label === label)
    if (!found) throw new Error(`no point labelled "${label}" in the scene`)
    return found.position
  }

  it("authors the spec's motivating figure: a right triangle with the altitude to its hypotenuse", () => {
    // Unauthorable in v1: the foot of the altitude had to be solved by hand
    // before the segment could be typed.
    const { scene } = build(
      ['@angle: degrees', 'triangle ABC: angle A = 90, AB = 6, AC = 8', 'D = foot A to B-C', 'segment: A-D dashed', 'right-angle: A-D-B'].join('\n')
    )
    expect(scene.errors).toEqual([])
    // The right-angle mark lands on the constructed foot, which is only
    // possible because a constructed point joins the named-point table.
    const square = scene.objects.find((o) => o.kind === 'rightAngleMark')
    if (square?.kind !== 'rightAngleMark') throw new Error('no right-angle mark at the foot')
    expect(square.vertex.x).toBeCloseTo(3.84, 10)

    // D5 placement: A at the origin, B on the positive x-axis, C above.
    expect(pointNamed(scene, 'A')).toEqual({ x: 0, y: 0 })
    expect(pointNamed(scene, 'B').x).toBeCloseTo(6, 10)
    expect(pointNamed(scene, 'B').y).toBeCloseTo(0, 10)
    expect(pointNamed(scene, 'C').x).toBeCloseTo(0, 10)
    expect(pointNamed(scene, 'C').y).toBeCloseTo(8, 10)

    // The whole point of the figure: AD is 4.8.
    const d = pointNamed(scene, 'D')
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(4.8, 10)
    expect(d.x).toBeCloseTo(3.84, 10)
    expect(d.y).toBeCloseTo(2.88, 10)

    // ...drawn, and dashed, between A and D specifically.
    const dashed = scene.objects.find((o) => o.kind === 'segment' && o.dashed)
    if (dashed?.kind !== 'segment') throw new Error('the altitude was not drawn dashed')
    expect(dashed.from).toEqual({ x: 0, y: 0 })
    expect(dashed.to.x).toBeCloseTo(3.84, 10)

    // And D really is the foot: AD is perpendicular to BC.
    const b = pointNamed(scene, 'B')
    const c = pointNamed(scene, 'C')
    expect(d.x * (c.x - b.x) + d.y * (c.y - b.y)).toBeCloseTo(0, 8)
  })

  it('expresses a regular hexagon with no trigonometry typed by hand', () => {
    const { scene } = build(
      [
        '@angle: degrees',
        'O = (0, 0)',
        'A = (1, 0)',
        'B = rotate A about O by 60',
        'C = rotate B about O by 60',
        'D = rotate C about O by 60',
        'E = rotate D about O by 60',
        'F = rotate E about O by 60',
      ].join('\n')
    )
    expect(scene.errors).toEqual([])

    const vertices = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => pointNamed(scene, n))
    // Every vertex on the unit circle, and every edge the same length as the
    // radius — which is what makes it regular, and specifically a hexagon.
    for (let i = 0; i < 6; i++) {
      expect(Math.hypot(vertices[i].x, vertices[i].y)).toBeCloseTo(1, 10)
      const next = vertices[(i + 1) % 6]
      expect(Math.hypot(next.x - vertices[i].x, next.y - vertices[i].y)).toBeCloseTo(1, 10)
    }
    // Five turns of 60 degrees from (1,0) lands at 300 degrees, so a sixth
    // would close the loop back on A exactly.
    expect(vertices[5].x).toBeCloseTo(0.5, 10)
    expect(vertices[5].y).toBeCloseTo(-Math.sqrt(3) / 2, 10)
  })

  it('resolves a chain of constructions: parallel, perpendicular, and their crossing', () => {
    const { scene } = build(
      ['A = (1, 1)', 'B = (4, 5)', 'P = (5, 1)', 'm = line through P parallel to A-B', 'n = line through A perpendicular to A-B', 'X = intersect m, n'].join('\n')
    )
    expect(scene.errors).toEqual([])
    const x = pointNamed(scene, 'X')
    // m is P=(5,1) + t*(3,4)/5; n is A=(1,1) + s*(-4,3)/5. Equating the two
    // gives t = -2.4, so X = (5 - 1.44, 1 - 1.92) = (3.56, -0.92).
    expect(x.x).toBeCloseTo(3.56, 8)
    expect(x.y).toBeCloseTo(-0.92, 8)
    // Independently: X is the foot of the perpendicular from A onto m, so
    // |AX| is the distance between the two parallels, which is P's distance
    // from line AB — |(0.6,0.8) x (4,0)| = 3.2.
    expect(Math.hypot(x.x - 1, x.y - 1)).toBeCloseTo(3.2, 8)
  })

  it('keeps an infinite line unclipped in the scene, independent of the view bounds', () => {
    const spec = ['A = (1, 1)', 'B = (4, 5)', 'P = (5, 1)', 'm = line through P parallel to A-B'].join('\n')
    const parsed = parseSpec(spec)
    const wide = buildScene(parsed.statements, { xMin: -100, xMax: 100, yMin: -100, yMax: 100 }, parsed.config)
    const narrow = buildScene(parsed.statements, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, parsed.config)

    const wideLine = wide.objects.find((o) => o.kind === 'line')
    const narrowLine = narrow.objects.find((o) => o.kind === 'line')
    if (wideLine?.kind !== 'line' || narrowLine?.kind !== 'line') throw new Error('no construction line in the scene')
    // Same object under wildly different views: the clip is the renderer's
    // job (render/clipLine.ts), so panning and zooming reveal more of the
    // same line rather than dragging a stale stick around.
    expect(narrowLine).toEqual(wideLine)
    expect(wideLine.extent).toBe('infinite')
    expect(wideLine.through).toEqual({ x: 5, y: 1 })
  })

  it('draws an angle bisector as a ray, not a full line', () => {
    const { scene } = build(['A = (4, 5)', 'B = (1, 1)', 'C = (5, -2)', 'b = bisector of angle A-B-C'].join('\n'))
    expect(scene.errors).toEqual([])
    const ray = scene.objects.find((o) => o.kind === 'line')
    if (ray?.kind !== 'line') throw new Error('no bisector in the scene')
    expect(ray.extent).toBe('ray')
    expect(ray.through).toEqual({ x: 1, y: 1 })
  })

  it('binds two names to a two-point intersection, ordered by x then y', () => {
    const { scene } = build(['A = (0, 0)', 'P = (-3, 4)', 'Q = (4, 3)', 'O = circle A, 5', 'S, T = intersect O, line P-Q'].join('\n'))
    expect(scene.errors).toEqual([])
    expect(pointNamed(scene, 'S').x).toBeCloseTo(-3, 8)
    expect(pointNamed(scene, 'S').y).toBeCloseTo(4, 8)
    expect(pointNamed(scene, 'T').x).toBeCloseTo(4, 8)
    expect(pointNamed(scene, 'T').y).toBeCloseTo(3, 8)
  })

  it('rejects binding one name to a construction that found two points (D4)', () => {
    const { scene } = build(['A = (0, 0)', 'P = (-3, 4)', 'Q = (4, 3)', 'O = circle A, 5', 'S = intersect O, line P-Q'].join('\n'))
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].message).toMatch(/2 solutions/)
    expect(scene.errors[0].message).toMatch(/\bS\b/)
  })

  it('reports an undefined name legibly instead of drawing nothing quietly', () => {
    const { scene } = build(['A = (0, 0)', 'M = midpoint A-B'].join('\n'))
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].message).toMatch(/"B"/)
    expect(scene.errors[0].message).toMatch(/unknown/i)
  })

  it('errors rather than hanging when constructions refer to each other in a cycle', () => {
    // Constructions are definition-before-use, which makes a cycle
    // unrepresentable: the forward reference is what fails, by name, on the
    // first line of the loop. Nothing here can spin.
    const { scene } = build(['A = (0, 0)', 'B = (4, 0)', 'P = (1, 5)', 'X = intersect m, n', 'm = line through P parallel to A-B', 'n = line through X perpendicular to A-B'].join('\n'))
    expect(scene.errors.length).toBeGreaterThan(0)
    expect(scene.errors[0].message).toMatch(/"m"/)
    expect(scene.errors[0].message).toMatch(/unknown/i)
  })

  it('refuses to rebind a name, naming what it was already bound to', () => {
    const { scene } = build(['A = (0, 0)', 'B = (4, 2)', 'A = midpoint A-B'].join('\n'))
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].message).toMatch(/"A".*already/i)
  })

  it('draws an incircle and a circumcircle with their real radii', () => {
    const { scene } = build(['@angle: degrees', 'triangle ABC: angle A = 90, AB = 4, AC = 3', 'incircle of ABC', 'circumcircle of ABC'].join('\n'))
    expect(scene.errors).toEqual([])
    const curves = scene.objects.filter((o) => o.kind === 'curve') as Extract<import('./types').SceneObject, { kind: 'curve' }>[]
    expect(curves).toHaveLength(2)

    // 3-4-5: r = Area/s = 6/6 = 1 about (1,1); R = 2.5 about the hypotenuse
    // midpoint (2, 1.5).
    const radii = curves.map((c) => {
      const cx = (Math.min(...c.points.map((p) => p.x)) + Math.max(...c.points.map((p) => p.x))) / 2
      const cy = (Math.min(...c.points.map((p) => p.y)) + Math.max(...c.points.map((p) => p.y))) / 2
      return { cx, cy, r: Math.max(...c.points.map((p) => Math.hypot(p.x - cx, p.y - cy))) }
    })
    expect(radii[0].r).toBeCloseTo(1, 6)
    expect(radii[0].cx).toBeCloseTo(1, 6)
    expect(radii[0].cy).toBeCloseTo(1, 6)
    expect(radii[1].r).toBeCloseTo(2.5, 6)
    expect(radii[1].cx).toBeCloseTo(2, 6)
    expect(radii[1].cy).toBeCloseTo(1.5, 6)
  })

  it('makes a constructed point referenceable by the existing angle:/tick: marks', () => {
    const { scene } = build(['A = (0, 0)', 'B = (6, 8)', 'M = midpoint A-B', 'tick: A-M', 'angle: A-M-B'].join('\n'))
    expect(scene.errors).toEqual([])
    const tick = scene.objects.find((o) => o.kind === 'tickMark')
    if (tick?.kind !== 'tickMark') throw new Error('no tick mark')
    expect(tick.to).toEqual({ x: 3, y: 4 })
    const angle = scene.objects.find((o) => o.kind === 'angleMark')
    if (angle?.kind !== 'angleMark') throw new Error('no angle mark')
    expect(angle.vertex).toEqual({ x: 3, y: 4 })
  })

  it('hides a construction without unbinding it, like a hidden function definition', () => {
    const { scene } = build(['@hide: mid', 'A = (0, 0)', 'B = (6, 8)', 'M = midpoint A-B name: mid', 'tick: A-M'].join('\n'))
    expect(scene.errors).toEqual([])
    expect(points(scene).some((p) => p.label === 'M')).toBe(false)
    const tick = scene.objects.find((o) => o.kind === 'tickMark')
    if (tick?.kind !== 'tickMark') throw new Error('no tick mark')
    expect(tick.to).toEqual({ x: 3, y: 4 })
  })

  it('wires every derived-point construction to the right transform', () => {
    // A=(1,1), B=(9,3), C=(4,8). Each expected value hand-computed; the point
    // of testing these through the DSL is that a swapped argument (rotating
    // about the wrong centre, dilating from the wrong point) would be
    // invisible to the unit tests, which call the functions directly.
    const { scene } = build(
      [
        '@angle: degrees',
        'A = (1, 1)',
        'B = (9, 3)',
        'C = (4, 8)',
        'D = divide A-B at 2:3',
        'R = reflect C over A-B',
        'T = translate A by (3, -4)',
        'E = dilate B from A by 0.5',
        'K = rotate B about A by 90',
      ].join('\n')
    )
    expect(scene.errors).toEqual([])
    expect(pointNamed(scene, 'D')).toEqual({ x: 4.2, y: 1.8 })
    // Foot from C onto A-B is (93/17, 36/17), so the mirror is (118/17, -64/17).
    expect(pointNamed(scene, 'R').x).toBeCloseTo(118 / 17, 10)
    expect(pointNamed(scene, 'R').y).toBeCloseTo(-64 / 17, 10)
    expect(pointNamed(scene, 'T')).toEqual({ x: 4, y: -3 })
    expect(pointNamed(scene, 'E')).toEqual({ x: 5, y: 2 })
    // (8,2) turned a quarter turn counter-clockwise is (-2,8), about A.
    expect(pointNamed(scene, 'K').x).toBeCloseTo(-1, 10)
    expect(pointNamed(scene, 'K').y).toBeCloseTo(9, 10)
  })

  it('wires all four triangle centres, and keeps them distinct', () => {
    const { scene } = build(
      ['A = (1, 1)', 'B = (9, 3)', 'C = (4, 8)', 'G = centroid ABC', 'O = circumcenter ABC', 'H = orthocenter ABC', 'I = incenter ABC'].join('\n')
    )
    expect(scene.errors).toEqual([])
    const g = pointNamed(scene, 'G')
    const o = pointNamed(scene, 'O')
    const h = pointNamed(scene, 'H')
    const i = pointNamed(scene, 'I')

    expect(g.x).toBeCloseTo(14 / 3, 10)
    expect(o.x).toBeCloseTo(4.6, 10)
    expect(o.y).toBeCloseTo(3.6, 10)
    expect(h.x).toBeCloseTo(4.8, 10)
    expect(h.y).toBeCloseTo(4.8, 10)

    // The incentre is the one that is equidistant from the three sides. That
    // pins which function `incenter` is wired to, which four numbers close
    // together would not.
    const distToSide = (p: { x: number; y: number }, u: { x: number; y: number }, v: { x: number; y: number }) =>
      Math.abs((v.x - u.x) * (u.y - p.y) - (u.x - p.x) * (v.y - u.y)) / Math.hypot(v.x - u.x, v.y - u.y)
    const a = { x: 1, y: 1 }
    const b = { x: 9, y: 3 }
    const c = { x: 4, y: 8 }
    expect(distToSide(i, a, b)).toBeCloseTo(distToSide(i, b, c), 10)
    expect(distToSide(i, b, c)).toBeCloseTo(distToSide(i, c, a), 10)
    // ...and the centroid is not, so the two are genuinely different points.
    expect(Math.abs(distToSide(g, a, b) - distToSide(g, b, c))).toBeGreaterThan(0.1)
  })

  it('reports a triangle it cannot solve without losing the rest of the figure', () => {
    const { scene } = build(['@angle: degrees', 'A = (0, 0)', 'triangle PQR: PQ = 8, QR = 10, angle P = 40'].join('\n'))
    expect(scene.errors).toHaveLength(1)
    expect(scene.errors[0].message).toMatch(/SSA/)
    expect(scene.errors[0].message).toMatch(/circle/i)
    // The plain point statement still drew.
    expect(points(scene).some((p) => p.label === 'A')).toBe(true)
  })
})

describe('the circle vocabulary in graph mode', () => {
  // The plot renderer draws a circle as a 96-point sampled curve, which is
  // exactly what the figure renderer exists to avoid for an arc. Refusing
  // out loud beats drawing nothing: a missing arc is a figure missing the
  // piece the problem is about, with nothing on screen to say so.
  for (const statement of ['arc P-Q on O ccw', 'sector P-Q on O ccw', 'central angle P-Q on O ccw', 'inscribed angle P-Q-R on O']) {
    it(`says where "${statement}" draws instead of dropping it`, () => {
      const { scene } = build('@mode: graph\nC = (0, 0)\nO = circle C, 5\nP = (5, 0)\nQ = (0, 5)\nR = (-3, 4)\n' + statement)
      expect(scene.errors).toHaveLength(1)
      expect(scene.errors[0].message).toContain('@mode: figure')
    })
  }

  it('still draws the constructions that produce a line, which both renderers can hold', () => {
    const { scene } = build('@mode: graph\nC = (0, 0)\nO = circle C, 5\nP = (5, 0)\nQ = (0, 5)\nchord P-Q on O')
    expect(scene.errors).toEqual([])
    expect(scene.objects.some((o) => o.kind === 'segment')).toBe(true)
  })
})

describe('a plane in a figure in the plane (phase 8, fix round 1)', () => {
  it('says planes exist only in solid figures, for every form of plane', () => {
    const points = 'A = (1, 2)\nB = (3, 4)\nC = (5, 0)\ny = x\n'
    for (const [plane, tail] of [
      ['A-B-C', 'it needs three points in space'],
      ['x + y = 1', 'this construction is in the plane'],
      ['through A perpendicular to B-C', 'this construction is in the plane'],
      ['through A parallel to B-C-A', 'this construction is in the plane'],
    ]) {
      const { scene } = build(`${points}F = foot A to plane ${plane}`)
      expect(scene.errors.map((e) => e.message)).toEqual([expect.stringContaining(`"plane ${plane}" is a plane, and planes exist only in solid figures — ${tail}`)])
    }
  })
})

// calc P1: the 2D engine compiles through the shared kernel (math/compile), so
// the new syntax plots and every error names its own line.
function sceneOf(spec: string) {
  const parsed = parseSpec(spec)
  return buildScene(parsed.statements, { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }, parsed.config, 140, parsed.statementLines)
}

type SceneOfResult = ReturnType<typeof sceneOf>

function curvePoints(scene: SceneOfResult) {
  return scene.objects.flatMap((o) => (o.kind === 'curve' ? o.points : []))
}

function regionTriangles(scene: SceneOfResult) {
  return scene.objects.flatMap((o) => (o.kind === 'region' ? o.triangles : []))
}

function segmentPairs(scene: SceneOfResult) {
  return scene.objects.flatMap((o) => (o.kind === 'segments' ? o.pairs : []))
}

describe('the 2D engine on the kernel (calc P1)', () => {
  it('reports a typo as a compile error on its line, not a blank plot', () => {
    const scene = sceneOf('y = x\ny = sinn(x)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('Unknown function "sinn"') })])
  })

  it('names the line of an error in a polar, a parametric and an implicit statement', () => {
    const scene = sceneOf('y = x\nr = 1 + cosz(theta)\n(cos(q), sin(t)) for t in [0, 6]\nx^2 + w = 1')
    expect(scene.errors.map((e) => e.line)).toEqual([2, 3, 4])
  })

  it('x^(1/3) draws both halves', () => {
    const xs = curvePoints(sceneOf('y = x^(1/3)')).map((pt) => pt.x)
    expect(Math.min(...xs)).toBeLessThan(-9)
    expect(Math.max(...xs)).toBeGreaterThan(9)
  })

  it('a bound variable wins over a user constant of the same name', () => {
    const cardioid = curvePoints(sceneOf('theta = 1\nr = 1 + cos(theta)'))
    const radii = cardioid.map((pt) => Math.hypot(pt.x, pt.y))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1.5)
  })

  it('piecewise, sums, integrals, primes and multi-parameter functions plot', () => {
    for (const spec of [
      'f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}\ny = f(x)',
      '@param n = 4 range [0, 12] integer\ny = sum(k = 0 to n, (-1)^k x^(2k+1)/(2k+1)!)',
      'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)',
      "f(x) = x^3 - 3x\ny = f'(x)",
      'g(x, a) = a sin(x)\ny = g(x, 2)',
    ]) {
      const scene = sceneOf(spec)
      expect(scene.errors, spec).toEqual([])
      expect(curvePoints(scene).length, spec).toBeGreaterThan(10)
    }
  })

  it('a piecewise function takes the right branch at each x', () => {
    const points = curvePoints(sceneOf('f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}\ny = f(x)'))
    const at = (x: number) => points.find((pt) => Math.abs(pt.x - x) < 1e-9)?.y
    expect(at(-4)).toBeCloseTo(16, 9)
    expect(at(1)).toBeCloseTo(3, 9)
    expect(at(4)).toBe(5)
  })

  it('a two-interval if domain does not bridge its gap', () => {
    const scene = sceneOf('y = 1 if x < -1 or x > 1')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(2)
    for (const c of curves) if (c.kind === 'curve') for (const pt of c.points) expect(Math.abs(pt.x)).toBeGreaterThanOrEqual(1)
  })

  it('an if clause takes not, !=, and, or and chains on the independent variable', () => {
    const negated = sceneOf('y = x if not x > 2 or x > 5')
    const pieces = negated.objects.flatMap((o) => (o.kind === 'curve' ? [o.points.map((pt) => pt.x)] : []))
    expect(pieces).toHaveLength(2)
    expect(Math.max(...pieces[0])).toBeLessThanOrEqual(2)
    expect(Math.min(...pieces[1])).toBeGreaterThan(5)

    const apart = sceneOf('y = x if x != 0')
    expect(apart.objects.filter((o) => o.kind === 'curve')).toHaveLength(2)
    expect(curvePoints(apart).some((pt) => pt.x === 0)).toBe(false)

    const chained = sceneOf('y = x if -3 <= x < 3 and x != 0')
    expect(chained.errors).toEqual([])
    const points = curvePoints(chained)
    expect(points.length).toBeGreaterThan(10)
    for (const pt of points) {
      expect(pt.x).toBeGreaterThanOrEqual(-3)
      expect(pt.x).toBeLessThan(3)
      expect(pt.x).not.toBe(0)
    }
  })

  it('an old-shape if clause draws as it always did', () => {
    const left = curvePoints(sceneOf('y = x^2 if x <= 1'))
    expect(Math.max(...left.map((pt) => pt.x))).toBeLessThanOrEqual(1)
    const mid = curvePoints(sceneOf('y = x^2 if -2 < x <= 2'))
    expect(Math.min(...mid.map((pt) => pt.x))).toBeGreaterThan(-2)
    expect(Math.max(...mid.map((pt) => pt.x))).toBeLessThanOrEqual(2)
  })

  it('an if clause on x = f(y) tests y', () => {
    const scene = sceneOf('x = y^2 if y > 0')
    expect(scene.errors).toEqual([])
    const points = curvePoints(scene)
    expect(points.length).toBeGreaterThan(10)
    for (const pt of points) expect(pt.y).toBeGreaterThan(0)
  })

  it('an if clause on the dependent variable is a compile error on its line', () => {
    const scene = sceneOf('y = x\ny = x if y > 0')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('Unknown variable "y"') })])
  })

  it('an if clause may use a definition, a constant or a @param in its bounds', () => {
    // limit(1) = c + 1 = 2: the old shape (one bound), then the same bound
    // through the new condition language.
    for (const clause of ['x < limit(1)', 'x < limit(1) or x > 8']) {
      const scene = sceneOf(`@param c = 1 range [0, 5]\nlimit(u) = c + u\ny = x if ${clause}`)
      expect(scene.errors, clause).toEqual([])
      const pieces = scene.objects.flatMap((o) => (o.kind === 'curve' ? [o.points.map((pt) => pt.x)] : []))
      expect(Math.max(...pieces[0]), clause).toBeLessThan(2)
    }
  })

  it('a curve undefined across the whole view says so', () => {
    const scene = sceneOf('y = ln(-x^2 - 1)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
  })

  it('a polar curve undefined across its whole range says so', () => {
    const scene = sceneOf('r = ln(-1 - cos(theta)^2)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
  })

  it('a parametric curve undefined across its whole range says so', () => {
    const scene = sceneOf('(ln(-1 - t^2), t) for t in [0, 5]')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
  })

  it('an explicit curve whose domain excludes the whole view draws nothing and reports nothing', () => {
    const scene = sceneOf('y = x if x > 100')
    expect(scene.errors).toEqual([])
    expect(curvePoints(scene)).toEqual([])
  })

  it('an if clause on a region keeps the shading inside it', () => {
    const scene = sceneOf('x^2 + y^2 < 9 if y > 0')
    const tris = regionTriangles(scene)
    expect(tris.length).toBeGreaterThan(0)
    for (let i = 0; i < tris.length; i += 3) expect((tris[i].y + tris[i + 1].y + tris[i + 2].y) / 3).toBeGreaterThan(0)
  })

  it('an if clause on an implicit curve keeps the strokes inside it', () => {
    const scene = sceneOf('x^2 + y^2 = 9 if y > 0')
    const pairs = segmentPairs(scene)
    expect(pairs.length).toBeGreaterThan(10)
    for (const [from, to] of pairs) expect((from.y + to.y) / 2).toBeGreaterThan(0)
  })

  it('an if clause on a chained region keeps the shading and its edge inside it', () => {
    const scene = sceneOf('-2 < x < 4 if y >= 0 and x != 3')
    expect(scene.errors).toEqual([])
    const tris = regionTriangles(scene)
    expect(tris.length).toBeGreaterThan(0)
    for (let i = 0; i < tris.length; i += 3) expect((tris[i].y + tris[i + 1].y + tris[i + 2].y) / 3).toBeGreaterThanOrEqual(0)
    for (const [from, to] of segmentPairs(scene)) expect((from.y + to.y) / 2).toBeGreaterThanOrEqual(0)
  })

  it('a region with two conditions joined by and keeps only the corner they share', () => {
    const tris = regionTriangles(sceneOf('x^2 + y^2 < 9 if y > 0 and x > -1'))
    expect(tris.length).toBeGreaterThan(0)
    for (let i = 0; i < tris.length; i += 3) {
      expect((tris[i].y + tris[i + 1].y + tris[i + 2].y) / 3).toBeGreaterThan(0)
      expect((tris[i].x + tris[i + 1].x + tris[i + 2].x) / 3).toBeGreaterThan(-1)
    }
  })

  it('an if clause that names a missing variable on a region is a compile error on its line', () => {
    const scene = sceneOf('y = x\nx^2 + y^2 < 9 if z > 0')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('Unknown variable "z"') })])
  })

  it('a field tick at an undefined slope is skipped, not drawn with NaN vertices', () => {
    const scene = sceneOf('field: dy/dx = ln(x)')
    const pairs = segmentPairs(scene)
    expect(pairs.length).toBeGreaterThan(10)
    for (const [from, to] of pairs) for (const v of [from.x, from.y, to.x, to.y]) expect(Number.isFinite(v)).toBe(true)
  })

  it('a field tick at an infinite slope is still a vertical tick', () => {
    // x = 0 is a grid column for these bounds, where 1/x is infinite.
    const parsed = parseSpec('field: dy/dx = 1/x')
    const scene = buildScene(parsed.statements, { xMin: -9, xMax: 9, yMin: -9, yMax: 9 }, parsed.config)
    const vertical = segmentPairs(scene).filter(([from, to]) => Math.abs(from.x - to.x) < 1e-9 && Math.abs(from.x) < 1e-9)
    expect(vertical.length).toBeGreaterThan(10)
  })

  it('a construction that fails is reported on its own line', () => {
    const scene = sceneOf('A = (0, 0)\nB = (4, 0)\nM = midpoint A-Z\nN = midpoint A-B')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 3, message: expect.stringMatching(/"Z"/) })])
  })

  it('a tangent line through a defined function uses the kernel', () => {
    const scene = sceneOf('f(x) = x^2\ntangent: f(x) at x = 1')
    expect(scene.errors).toEqual([])
    const line = scene.objects.find((o) => o.kind === 'curve')
    if (line?.kind !== 'curve') throw new Error('expected the tangent line')
    // y = 1 + 2(x - 1) at the window's left and right edges.
    expect(line.points[0].y).toBeCloseTo(1 + 2 * (-10 - 1), 4)
    expect(line.points[1].y).toBeCloseTo(1 + 2 * (10 - 1), 4)
  })

  it('a statement that does not compile feeds no feature points, whether its body or its if clause is the fault', () => {
    // y = 2 - x alone has a root at (2, 0) and a y-intercept at (0, 2). The
    // broken line would add a root and a y-intercept at the origin and an
    // intersection at (1, 1) if it were still used.
    const baseline = sceneOf('@points: roots, intersections\ny = 2 - x')
    const baselineKinds = baseline.objects.flatMap((o) => (o.kind === 'point' && o.feature ? [o.feature] : [])).sort()
    expect(baselineKinds).toEqual(['x-intercept', 'y-intercept'])
    for (const broken of ['y = x if y > 0', 'y = sinn(x)']) {
      const scene = sceneOf(`@points: roots, intersections\n${broken}\ny = 2 - x`)
      expect(scene.errors, broken).toEqual([expect.objectContaining({ line: 2 })])
      const kinds = scene.objects.flatMap((o) => (o.kind === 'point' && o.feature ? [o.feature] : [])).sort()
      expect(kinds, broken).toEqual(baselineKinds)
    }
  })

  it('a definition clash is reported on its own line', () => {
    const scene = sceneOf('f(x) = x\nf(x) = x + 1\ny = f(x)')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('"f" is defined twice') })])
  })

  it('without statement lines an error still names line 0', () => {
    const parsed = parseSpec('y = sinn(x)')
    const scene = buildScene(parsed.statements, { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }, parsed.config)
    expect(scene.errors).toEqual([expect.objectContaining({ line: 0 })])
  })
})
