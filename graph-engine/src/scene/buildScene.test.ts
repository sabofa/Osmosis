import { describe, expect, it } from 'vitest'
import { integrandEvaluations } from '../math/binders'
import { parseSpec } from '../parser/parseSpec'
import { COARSE, CORE, FULL } from '../plot/sample/tuning'
import { buildScene } from './buildScene'
import { chainPoints } from './chains'
import type { SceneObject, Vec2 } from './types'

const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

// Every vertex of a curve's chains, in order.
function vertices(curve: Extract<SceneObject, { kind: 'curve' }>): Vec2[] {
  return curve.chains.flatMap(chainPoints)
}

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
    expect(vertices(curve).length).toBeGreaterThan(10)
  })

  it('resolves a named function referenced before its own definition line', () => {
    // k(x) is used on the line above where it's defined — the grammar is
    // explicitly order-independent for definitions (see parser/types.ts).
    const { scene } = build('y = k(x)\nk(x) = x^2 + 1')
    expect(scene.errors).toEqual([])
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    // y = k(2) = 5
    const p = vertices(curve).find((pt) => Math.abs(pt.x - 2) < 0.1)
    expect(p?.y).toBeCloseTo(5, 0)
  })

  it('resolves a self-composed function (k(k(x)))', () => {
    const { scene } = build('k(x) = x^2\ny = k(k(x))')
    expect(scene.errors).toEqual([])
  })

  it('compiles an animatedPoint path through the kernel, so a path that names a function still resolves on every frame', () => {
    const { scene } = build('k(t) = cos(t) * 2\nanimate: (k(t), sin(t)*2) for t in [0, 6.283]')
    expect(scene.errors).toEqual([])
    const anim = scene.objects.find((o) => o.kind === 'animatedPoint')
    expect(anim).toBeDefined()
    if (anim?.kind !== 'animatedPoint') throw new Error('unreachable')
    // The renderer calls these every frame: the closures carry the definition of k.
    expect(anim.fx(1)).toBeCloseTo(Math.cos(1) * 2, 14)
    expect(anim.fy(1)).toBeCloseTo(Math.sin(1) * 2, 14)
    expect([anim.from, anim.to]).toEqual([0, 6.283])
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
    const p = curves[0].kind === 'curve' ? vertices(curves[0]).find((pt) => Math.abs(pt.x - 2) < 0.1) : undefined
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
    // Closed loop: one closed chain, whose last vertex joins the first by
    // `closed` rather than by repeating it.
    expect(curve.id).toEqual({ statement: 0, object: 'curve' })
    expect(curve.chains).toHaveLength(1)
    expect(curve.chains[0].closed).toBe(true)
    const points = vertices(curve)
    expect(points[points.length - 1]).not.toEqual(points[0])
    // Every sampled point sits exactly `radius` from the center.
    for (const p of points) {
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
    const region = scene.objects.find((o) => o.kind === 'triangles')
    if (region?.kind !== 'triangles') throw new Error('unreachable')
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
    const region = scene.objects.find((o) => o.kind === 'triangles')
    if (region?.kind !== 'triangles') throw new Error('unreachable')
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
      const pts = vertices(c)
      const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2
      const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2
      return { cx, cy, r: Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) }
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
  return scene.objects.flatMap((o) => (o.kind === 'curve' ? vertices(o) : []))
}

// Each chain of each curve, as its own list of x values.
function chainXs(scene: SceneOfResult) {
  return scene.objects.flatMap((o) => (o.kind === 'curve' ? o.chains.map((chain) => chainPoints(chain).map((pt) => pt.x)) : []))
}

function marksOf(scene: SceneOfResult) {
  return scene.objects.filter((o): o is Extract<SceneObject, { kind: 'mark' }> => o.kind === 'mark')
}

function regionTriangles(scene: SceneOfResult) {
  return scene.objects.flatMap((o) => (o.kind === 'triangles' ? o.triangles : []))
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
    // v1 sampled on a fixed grid, so its vertices sat exactly on -4, 1 and 4 (and it kept y = 16 at -4, off the screen). The
    // adaptive sampler puts vertices where the curve needs them and drops what is off screen, so the curve is read between
    // the two vertices that hold x (a flat chord is within a quarter of a pixel), at x = -2 where x^2 is still in view.
    const at = (x: number) => {
      const after = points.findIndex((pt) => pt.x >= x)
      const [a, b] = [points[after - 1], points[after]]
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
    }
    expect(at(-2)).toBeCloseTo(4, 1)
    expect(at(1)).toBeCloseTo(3, 1)
    expect(at(4)).toBe(5)
  })

  it('a two-interval if domain does not bridge its gap', () => {
    const scene = sceneOf('y = 1 if x < -1 or x > 1')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.length).toBe(1)
    const pieces = chainXs(scene)
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) for (const x of piece) expect(Math.abs(x)).toBeGreaterThanOrEqual(1)
    // Each chain stays on its own side of the gap.
    expect(Math.max(...pieces[0])).toBeLessThan(0)
    expect(Math.min(...pieces[1])).toBeGreaterThan(0)
    // and the gap is marked: each piece ends in an open mark at its edge, -1 and 1, where the strict < and > leave them out
    expect(marksOf(scene).map((m) => [Math.round(m.at.x), m.fill])).toEqual([
      [-1, 'open'],
      [1, 'open'],
    ])
  })

  it('an if clause takes not, !=, and, or and chains on the independent variable', () => {
    const negated = sceneOf('y = x if not x > 2 or x > 5')
    const pieces = chainXs(negated)
    expect(pieces).toHaveLength(2)
    expect(Math.max(...pieces[0])).toBeLessThanOrEqual(2)
    // P2 runs a piece to its edge, which is at 5 itself (an open end there says the curve does not take it); v1 stopped a sample short of it
    expect(Math.min(...pieces[1])).toBeGreaterThanOrEqual(5)
    expect(Math.min(...pieces[1])).toBeLessThan(5.1)
    expect(marksOf(negated).filter((m) => Math.abs(m.at.x - 5) < 1e-9).map((m) => m.fill)).toEqual(['open'])

    // v1 split `x != 0` into two chains with no vertex at 0 (a break at the first sample outside). P2 finds a point
    // missing from an otherwise continuous curve to be a hole: one chain through (0, 0), an open mark on it, and no break.
    const apart = sceneOf('y = x if x != 0')
    expect(chainXs(apart)).toHaveLength(1)
    expect(marksOf(apart)).toEqual([expect.objectContaining({ role: 'hole', fill: 'open', at: { x: expect.closeTo(0, 12), y: expect.closeTo(0, 12) } })])

    const chained = sceneOf('y = x if -3 <= x < 3 and x != 0')
    expect(chained.errors).toEqual([])
    const points = curvePoints(chained)
    expect(points.length).toBeGreaterThan(10)
    // the curve runs to its edges, -3 (filled) and 3 (open), and nothing lies outside them
    for (const pt of points) {
      expect(pt.x).toBeGreaterThanOrEqual(-3)
      expect(pt.x).toBeLessThanOrEqual(3)
    }
    expect(marksOf(chained).map((m) => [Math.round(m.at.x), m.role, m.fill]).sort()).toEqual([
      [-3, 'endpoint', 'filled'],
      [0, 'hole', 'open'],
      [3, 'endpoint', 'open'],
    ])
  })

  it('an old-shape if clause draws as it always did', () => {
    const left = curvePoints(sceneOf('y = x^2 if x <= 1'))
    expect(Math.max(...left.map((pt) => pt.x))).toBeLessThanOrEqual(1)
    const mid = curvePoints(sceneOf('y = x^2 if -2 < x <= 2'))
    // P2 draws a piece to its edge, which is -2 itself (and says it is open there, as the < does, with a mark); v1 stopped a sample short
    expect(Math.min(...mid.map((pt) => pt.x))).toBeGreaterThanOrEqual(-2)
    expect(Math.min(...mid.map((pt) => pt.x))).toBeLessThan(-1.9)
    expect(Math.max(...mid.map((pt) => pt.x))).toBeLessThanOrEqual(2)
  })

  it('an if clause on x = f(y) tests y', () => {
    const scene = sceneOf('x = y^2 if y > 0')
    expect(scene.errors).toEqual([])
    const points = curvePoints(scene)
    expect(points.length).toBeGreaterThan(10)
    // the curve runs to y = 0 itself, open there (> excludes it), where v1 stopped a sample short of it
    for (const pt of points) expect(pt.y).toBeGreaterThanOrEqual(0)
    expect(marksOf(scene).map((m) => [m.at.y, m.fill])).toEqual([[expect.closeTo(0, 12), 'open']])
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
      const pieces = chainXs(scene)
      // the first piece runs to its edge at limit(1) = 2 (open there: `<`), where v1 stopped a sample short of it
      expect(Math.max(...pieces[0]), clause).toBeLessThanOrEqual(2)
      expect(Math.max(...pieces[0]), clause).toBeGreaterThan(1.9)
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

  it('a field samples the overscan, so its ticks reach beyond the view on every side', () => {
    const scene = sceneOf('field: dy/dx = x + y')
    const mids = segmentPairs(scene).map(([from, to]) => ({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }))
    const spanX = 20
    const spanY = 12
    expect(Math.min(...mids.map((m) => m.x))).toBeLessThan(-10 - 0.2 * spanX)
    expect(Math.max(...mids.map((m) => m.x))).toBeGreaterThan(10 + 0.2 * spanX)
    expect(Math.min(...mids.map((m) => m.y))).toBeLessThan(-6 - 0.2 * spanY)
    expect(Math.max(...mids.map((m) => m.y))).toBeGreaterThan(6 + 0.2 * spanY)
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
    expect(line.id).toEqual({ statement: 1, object: 'tangent' })
    expect(line.chains).toHaveLength(1)
    const [first, last] = chainPoints(line.chains[0])
    expect(line.chains[0].param).toEqual(Float64Array.from([-10, 10]))
    // y = 1 + 2(x - 1) at the window's left and right edges.
    expect(first.y).toBeCloseTo(1 + 2 * (-10 - 1), 4)
    expect(last.y).toBeCloseTo(1 + 2 * (10 - 1), 4)
  })

  it('a statement that does not compile feeds no feature points: its body, its new-shape if clause, or its old-shape one', () => {
    // y = 2 - x alone has a root at (2, 0) and a y-intercept at (0, 2). The
    // broken line would add a root and a y-intercept at the origin and an
    // intersection at (1, 1) if it were still used.
    const baseline = sceneOf('@points: roots, intersections\ny = 2 - x')
    const baselineKinds = baseline.objects.flatMap((o) => (o.kind === 'point' && o.feature ? [o.feature] : [])).sort()
    expect(baselineKinds).toEqual(['x-intercept', 'y-intercept'])
    const cases: [string, string][] = [
      // the new shape: a condition on the dependent variable
      ['y = x if y > 0', 'Unknown variable "y"'],
      // the body
      ['y = sinn(x)', 'Unknown function "sinn"'],
      // the old shape (x < c): an unknown name in the bound, which would otherwise mark (1, 0) and (0, -1)
      ['y = x - 1 if x < k', 'Unknown variable "k"'],
      ['y = x - 1 if 0 <= x < k', 'Unknown variable "k"'],
    ]
    for (const [broken, message] of cases) {
      const scene = sceneOf(`@points: roots, intersections\n${broken}\ny = 2 - x`)
      expect(scene.errors, broken).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining(message) })])
      const kinds = scene.objects.flatMap((o) => (o.kind === 'point' && o.feature ? [o.feature] : [])).sort()
      expect(kinds, broken).toEqual(baselineKinds)
    }
  })

  it('a statement whose old-shape if clause compiles still feeds its feature points', () => {
    // y = x - 1 if x < 5 is defined where it is read: its root (1, 0) is marked
    const scene = sceneOf('@points: roots\ny = x - 1 if x < 5')
    expect(scene.errors).toEqual([])
    expect(scene.objects.filter((o) => o.kind === 'point' && o.feature === 'x-intercept')).toHaveLength(1)
  })

  // The animate: path is compiled by the kernel when the scene is built and the renderer
  // calls the closures on every frame, so the whole language works in it and a mistake
  // is reported on its line, not swallowed per frame.
  function animatedOf(spec: string) {
    const scene = sceneOf(spec)
    expect(scene.errors, spec).toEqual([])
    const anim = scene.objects.find((o) => o.kind === 'animatedPoint')
    if (anim?.kind !== 'animatedPoint') throw new Error(`no animated point for ${spec}`)
    return anim
  }

  it('animate: (t!, |t|) for t in [0, 3] builds with no error, and its closures evaluate', () => {
    const anim = animatedOf('animate: (t!, |t|) for t in [0, 3]')
    expect([anim.param, anim.from, anim.to]).toEqual(['t', 0, 3])
    // 3! = 6 and 0! = 1 exactly; 2.5! = gamma(3.5) = 15 sqrt(pi) / 8
    expect(anim.fx(3)).toBeCloseTo(6, 12)
    expect(anim.fx(0)).toBeCloseTo(1, 12)
    expect(anim.fx(2.5)).toBeCloseTo((15 * Math.sqrt(Math.PI)) / 8, 12)
    expect(anim.fy(2.5)).toBe(2.5)
    expect(anim.fy(-2)).toBe(2)
  })

  it('animate: takes sums, piecewise, primes, multi-parameter functions and @params', () => {
    // sum(k = 1 to 3, k t) = 6 t
    expect(animatedOf('animate: (sum(k = 1 to 3, k t), t) for t in [0, 1]').fx(2)).toBe(12)
    // a piecewise definition takes the right branch at each t
    const piecewise = animatedOf('f(x) = {x < 1: x, 5}\nanimate: (f(t), t) for t in [0, 2]')
    expect([piecewise.fx(0.5), piecewise.fx(1.5)]).toEqual([0.5, 5])
    // f'(t) for f(x) = x^3 - 3x is 3t^2 - 3
    expect(animatedOf("f(x) = x^3 - 3x\nanimate: (f'(t), t) for t in [0, 2]").fx(2)).toBeCloseTo(9, 12)
    // g(x, a) = a sin(x), called with two arguments
    expect(animatedOf('g(x, a) = a sin(x)\nanimate: (g(t, 2), t) for t in [0, 1]').fx(1)).toBeCloseTo(2 * Math.sin(1), 14)
    // a @param is read at build, and so is the angle unit
    expect(animatedOf('@param a = 3 range [0, 5]\nanimate: (a t, t) for t in [0, 1]').fx(2)).toBe(6)
    expect(animatedOf('@angle: degrees\nanimate: (sin(t), t) for t in [0, 90]').fx(30)).toBeCloseTo(0.5, 14)
  })

  it('animate: with a typo reports it on its line and adds no point', () => {
    const scene = sceneOf('y = x\nanimate: (sinn(t), t) for t in [0, 1]')
    expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('Unknown function "sinn"') })])
    expect(scene.objects.some((o) => o.kind === 'animatedPoint')).toBe(false)
    // in the second coordinate, and a name no one defined, too
    expect(sceneOf('animate: (t, sinn(t)) for t in [0, 1]').errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('Unknown function "sinn"') })])
    expect(sceneOf('animate: (t, w) for t in [0, 1]').errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('Unknown variable "w"') })])
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

// calc P2 task 1: the scene contract. The sampler is still the uniform one, but
// it speaks chains with parameters, typed breaks, guide lines and identities.
describe('the plot contract (calc P2)', () => {
  it('gives a curve its identity, and each chain the parameter at every vertex', () => {
    const scene = sceneOf('y = 0.5x\ny = x^2')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves.map((c) => (c.kind === 'curve' ? c.id : null))).toEqual([
      { statement: 0, object: 'curve' },
      { statement: 1, object: 'curve' },
    ])
    const first = curves[0]
    if (first.kind !== 'curve') throw new Error('unreachable')
    expect(first.breaks).toEqual([])
    const chain = first.chains[0]
    // For y = f(x) the parameter is x itself.
    for (let i = 0; i < chain.param.length; i++) expect(chain.xy[2 * i]).toBe(chain.param[i])
  })

  it('records the parameter of a parametric curve at each vertex', () => {
    const parametric = sceneOf('(cos(t), sin(t)) for t in [0, 6]')
    const curve = parametric.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.chains).toHaveLength(1)
    expect(curve.chains[0].param[0]).toBe(0)
    expect(curve.chains[0].param[curve.chains[0].param.length - 1]).toBeCloseTo(6, 12)
  })

  // The parameter is theta as the statement writes it, not the radians the
  // vertex is plotted at: in degrees, a quarter turn is 90, and the vertex there
  // sits on the y axis.
  it("records a polar curve's parameter as theta in the statement's own angle unit", () => {
    const polar = sceneOf('@angle: degrees\nr = 2 for theta in [0, 90]')
    expect(polar.errors).toEqual([])
    const curve = polar.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.chains).toHaveLength(1)
    const { param, xy } = curve.chains[0]
    const last = param.length - 1
    expect(param[0]).toBe(0)
    expect(param[last]).toBeCloseTo(90, 12)
    expect(xy[2 * last]).toBeCloseTo(0, 9)
    expect(xy[2 * last + 1]).toBeCloseTo(2, 9)
  })

  // v1 recorded an out-of-domain split as an edge break at the first sample outside the domain (and split `x != 0` in two that
  // way). P2 types each interruption it finds at the parameter it located, to the edge itself: a domain edge is an edge break
  // with an end mark, and a point cut out of a continuous curve is a hole (see "an if clause takes not, !=, ...").
  it('records an out-of-domain split as an edge break at the edge itself, with its end mark', () => {
    const scene = sceneOf('y = x if x > 1')
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.chains).toHaveLength(1)
    expect(curve.breaks).toEqual([{ at: expect.closeTo(1, 12), kind: 'edge' }])
    // (an exact mark's y is the limit read a few locator tolerances from the edge: right to 1e-11)
    expect(marksOf(scene)).toEqual([expect.objectContaining({ role: 'endpoint', fill: 'open', at: { x: expect.closeTo(1, 12), y: expect.closeTo(1, 9) } })])
  })

  it('records a blow-up split as a pole break, and draws an unclipped asymptote guide at it', () => {
    // v1 broke the chain by a window-relative jump rule, at the midpoint of the two samples a blow-up fell between (a pole at
    // 0.025 between samples 0.05 apart); P2 breaks at the certified pole itself (spec "What is wrong today").
    const scene = sceneOf('y = 1 / (x - 0.025)')
    expect(scene.errors).toEqual([])
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.chains).toHaveLength(2)
    expect(curve.breaks).toHaveLength(1)
    expect(curve.breaks[0].kind).toBe('pole')
    expect(curve.breaks[0].at).toBeCloseTo(0.025, 9)

    const guides = scene.objects.filter((o) => o.kind === 'line')
    expect(guides).toHaveLength(1)
    const guide = guides[0]
    if (guide.kind !== 'line') throw new Error('unreachable')
    expect(guide.id).toEqual({ statement: 0, object: 'asymptote.0' })
    expect(guide.role).toBe('asymptote')
    expect(guide.extent).toBe('infinite')
    expect(guide.through.x).toBeCloseTo(0.025, 9)
    expect(guide.direction).toEqual({ x: 0, y: 1 })
    expect(scene.objects.some((o) => o.kind === 'segments')).toBe(false)
  })

  it('draws no asymptote guide when @asymptotes is off, but still records the break', () => {
    const scene = sceneOf('@asymptotes: off\ny = 1 / (x - 0.025)')
    expect(scene.objects.some((o) => o.kind === 'line')).toBe(false)
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('unreachable')
    expect(curve.breaks.map((b) => b.kind)).toEqual(['pole'])
  })

  it("draws a scatter's regression as a two-vertex curve across the view", () => {
    const scene = sceneOf('scatter: (1, 2), (2, 4), (3, 6)')
    const curves = scene.objects.filter((o) => o.kind === 'curve')
    expect(curves).toHaveLength(1)
    const line = curves[0]
    if (line.kind !== 'curve') throw new Error('expected the regression line')
    expect(line.id).toEqual({ statement: 0, object: 'regression' })
    expect(line.breaks).toEqual([])
    expect(line.chains).toHaveLength(1)
    expect(line.chains[0].param).toEqual(Float64Array.from([-10, 10]))
    // y = 2x, at the window's left and right edges.
    const [first, last] = chainPoints(line.chains[0])
    expect(first.y).toBeCloseTo(-20, 9)
    expect(last.y).toBeCloseTo(20, 9)
    // The line is a curve, not a guide: nothing is left for the renderer to clip.
    expect(scene.objects.some((o) => o.kind === 'line')).toBe(false)
  })

  it("names a construction circle's curve by its bound name, else by its place among the statement's circles", () => {
    const named = sceneOf('A = (0, 0)\nO = circle A, 2')
    const bound = named.objects.find((o) => o.kind === 'curve')
    if (bound?.kind !== 'curve') throw new Error('unreachable')
    expect(bound.id).toEqual({ statement: 1, object: 'O' })
    const anonymous = sceneOf('@angle: degrees\ntriangle ABC: angle A = 90, AB = 4, AC = 3\nincircle of ABC')
    const unbound = anonymous.objects.find((o) => o.kind === 'curve')
    if (unbound?.kind !== 'curve') throw new Error('unreachable')
    expect(unbound.id).toEqual({ statement: 1, object: 'circle.0' })
  })
})

// calc P2 task 7: the 2D plot path goes through the adaptive sampler (plot/sample/curve.ts), pixel-aware.
describe('the adaptive sampler in the scene (calc P2)', () => {
  type CurveObject = Extract<SceneObject, { kind: 'curve' }>
  const curvesOf = (scene: SceneOfResult) => scene.objects.filter((o): o is CurveObject => o.kind === 'curve')
  const guidesOf = (scene: SceneOfResult) => scene.objects.filter((o) => o.kind === 'line' && o.role === 'asymptote')
  const view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }
  const sceneWith = (spec: string, options?: Parameters<typeof buildScene>[5], b = view) => {
    const parsed = parseSpec(spec)
    return buildScene(parsed.statements, b, parsed.config, 140, parsed.statementLines, options)
  }

  it('y = tan(x) is one curve with a typed break and a guide line at each pole', () => {
    const scene = sceneOf('y = tan(x)')
    expect(scene.errors).toEqual([])
    const curves = curvesOf(scene)
    expect(curves).toHaveLength(1)
    const poles = curves[0].breaks.filter((b) => b.kind === 'pole').map((b) => b.at)
    // ±π/2 … ±7π/2 are in [-10, 10]; the sampled range carries the overscan, which holds a pair more
    for (const k of [-7, -5, -3, -1, 1, 3, 5, 7]) expect(poles).toContainEqual(expect.closeTo((k * Math.PI) / 2, 9))
    const guides = guidesOf(scene)
    expect(guides).toHaveLength(poles.length)
    for (const g of guides) if (g.kind === 'line') expect(g.direction).toEqual({ x: 0, y: 1 })
  })

  it('y = (x^2 - 1)/(x - 1) has an open hole mark at (1, 2), and no break in its chain', () => {
    const scene = sceneOf('y = (x^2 - 1)/(x - 1)')
    expect(scene.errors).toEqual([])
    const holes = marksOf(scene).filter((m) => m.role === 'hole')
    expect(holes).toEqual([expect.objectContaining({ fill: 'open', at: { x: expect.closeTo(1, 12), y: expect.closeTo(2, 6) } })])
    expect(curvesOf(scene)[0].chains).toHaveLength(1)
    expect(curvesOf(scene)[0].breaks).toEqual([])
  })

  it('y = 2 if 0 < x <= 3 has an open end at 0 and a filled one at 3', () => {
    const scene = sceneOf('y = 2 if 0 < x <= 3')
    expect(scene.errors).toEqual([])
    expect(marksOf(scene).map((m) => [Math.round(m.at.x), m.role, m.fill])).toEqual([
      [0, 'endpoint', 'open'],
      [3, 'endpoint', 'filled'],
    ])
  })

  it('the same clause in the old shape (a range with its own operators) ends the same way', () => {
    // the parser gives `0 < x <= 3` the old Condition (a range), and buildScene hands the sampler a condition Expr
    const parsed = parseSpec('y = 2 if 0 < x <= 3')
    const first = parsed.statements[0]
    if (first.kind !== 'explicit') throw new Error('unreachable')
    expect(first.condition?.kind).toBe('range')
    const lessThan = marksOf(sceneOf('y = x^2 if x < 1'))
    expect(lessThan.map((m) => [m.at.x, m.fill])).toEqual([[expect.closeTo(1, 12), 'open']])
    const atLeast = marksOf(sceneOf('y = x^2 if x >= 1'))
    expect(atLeast.map((m) => [m.at.x, m.fill])).toEqual([[expect.closeTo(1, 12), 'filled']])
  })

  it('reports what the sampler evaluated, summed over the curves', () => {
    const one = sceneOf('y = x^2')
    expect(one.stats?.points).toBeGreaterThan(0)
    expect(one.stats?.intervals).toBeGreaterThan(0)
    const two = sceneOf('y = x^2\ny = tan(x)')
    const tan = sceneOf('y = tan(x)')
    expect(two.stats).toEqual({ points: one.stats!.points + tan.stats!.points, intervals: one.stats!.intervals + tan.stats!.intervals })
    // no curve, no work
    expect(sceneOf('A = (1, 2)').stats).toEqual({ points: 0, intervals: 0 })
  })

  it("quality 'coarse' uses fewer evaluations than 'full' on y = sin(1/x)", () => {
    const full = sceneWith('y = sin(1/x)', { quality: 'full' })
    const coarse = sceneWith('y = sin(1/x)', { quality: 'coarse' })
    expect(full.errors).toEqual([])
    expect(coarse.errors).toEqual([])
    expect(coarse.stats!.points).toBeLessThan(full.stats!.points)
  })

  it('gives the sampler the viewport in pixels: 4 px a sample, so a wider canvas takes more samples', () => {
    const narrow = sceneWith('y = x^2', { widthPx: 400, heightPx: 240 })
    const wide = sceneWith('y = x^2', { widthPx: 1600, heightPx: 960 })
    expect(wide.stats!.points).toBeGreaterThan(narrow.stats!.points * 2)
    // the default is 800 px wide, with the height the bounds' aspect gives
    const byDefault = sceneWith('y = x^2')
    const explicit = sceneWith('y = x^2', { widthPx: 800, heightPx: 480 })
    expect(byDefault.stats).toEqual(explicit.stats)
    expect(vertices(curvesOf(byDefault)[0])).toEqual(vertices(curvesOf(explicit)[0]))
  })

  describe('polar', () => {
    it("closes on itself under @angle: degrees — the default range is a full turn in the current unit", () => {
      const scene = sceneOf('@angle: degrees\nr = 1 + cos(theta)')
      expect(scene.errors).toEqual([])
      const curve = curvesOf(scene)[0]
      expect(curve.chains).toHaveLength(1)
      const chain = curve.chains[0]
      const pts = chainPoints(chain)
      const first = pts[0]
      const last = pts[pts.length - 1]
      // 40 px per unit in sceneOf's view (800 px over 20 units): half a pixel is 0.0125
      expect(Math.hypot(last.x - first.x, last.y - first.y) * 40).toBeLessThanOrEqual(0.5)
      expect(chain.param[0]).toBe(0)
      expect(chain.param[chain.param.length - 1]).toBeCloseTo(360, 9)
      // a cardioid: r runs from 2 at theta = 0 to 0 at 180 degrees
      expect(Math.min(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(0.05)
      expect(Math.max(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeCloseTo(2, 2)
    })
    it('and in radians the full turn is 2 pi, as it was', () => {
      const chain = curvesOf(sceneOf('r = 1 + cos(theta)'))[0].chains[0]
      expect(chain.param[0]).toBe(0)
      expect(chain.param[chain.param.length - 1]).toBeCloseTo(2 * Math.PI, 12)
    })
    it('a range the author wrote is theirs, in the unit they work in', () => {
      const chain = curvesOf(sceneOf('@angle: degrees\nr = 2 for theta in [0, 180]'))[0].chains[0]
      expect(chain.param[chain.param.length - 1]).toBeCloseTo(180, 9)
      const radians = curvesOf(sceneOf('r = 2 for theta in [0, 2*pi]'))[0].chains[0]
      expect(radians.param[radians.param.length - 1]).toBeCloseTo(2 * Math.PI, 12)
    })
    it('a reversed range draws the same curve as the forward one', () => {
      const forward = chainPoints(curvesOf(sceneOf('r = 2 for theta in [0, 3]'))[0].chains[0])
      const reversed = chainPoints(curvesOf(sceneOf('r = 2 for theta in [3, 0]'))[0].chains[0])
      expect(reversed).toEqual(forward)
    })
    it('a range with nothing in it is an error on its line, not a quiet blank or a false "undefined"', () => {
      const scene = sceneOf('y = x\nr = 2 for theta in [1, 1]')
      expect(scene.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('range') })])
      expect(scene.errors[0].message).not.toMatch(/undefined everywhere/)
    })
    // fix round 1: a slider that brings the range to nothing is a position of the slider, not a mistake in the text
    it('an empty range that comes from a @param draws nothing and says nothing, and draws again off zero', () => {
      // (the last reads a only through a function)
      for (const spec of ['r = 2 for theta in [0, a]', '(t, t) for t in [0, a]', '(t, t) for t in [0, 2 * a]', 'k(u) = u + a\n(t, t) for t in [0, k(0)]']) {
        const empty = sceneOf(`@param a = 0 range [0, 6]\n${spec}`)
        expect(empty.errors, spec).toEqual([])
        expect(curvesOf(empty).flatMap((c) => c.chains), spec).toEqual([])
        const drawn = sceneOf(`@param a = 3 range [0, 6]\n${spec}`)
        expect(curvesOf(drawn).flatMap((c) => c.chains).length, spec).toBeGreaterThan(0)
      }
    })
    it('a literal empty range stays an error, and so does one from a constant that is not a @param', () => {
      for (const spec of ['(t, t) for t in [2, 2]', 'a = 0\n(t, t) for t in [0, a]']) {
        expect(sceneOf(spec).errors, spec).toEqual([expect.objectContaining({ message: expect.stringContaining('empty') })])
      }
    })
    it('a range that is not a number from a @param is still an error (a slider cannot make a number of it)', () => {
      expect(sceneOf('@param a = 0 range [0, 6]\n(t, t) for t in [0, 1/a]').errors).toEqual([expect.objectContaining({ message: expect.stringContaining('not a number') })])
    })
  })

  // fix round 1: "in view" is the picture's range, not the overscan the sampler also looks at
  it('says "undefined everywhere in view" of a curve that exists only in the overscan, and nothing of one that is defined and off screen', () => {
    // sceneOf's view is x from -10 to 10: sqrt(x - 12) starts at 12, in the 25 % overscan (to 12.5) and not in view
    const outside = sceneOf('y = sqrt(x - 12)')
    expect(outside.errors).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('undefined everywhere in view') })])
    expect(sceneOf('y = sqrt(x - 9)').errors).toEqual([])
    expect(sceneOf('y = x + 100').errors).toEqual([])
    // and the same on the other axis (y from -6 to 6, overscan to 7.5)
    expect(sceneOf('x = sqrt(y - 6.5)').errors).toEqual([expect.objectContaining({ message: expect.stringContaining('undefined everywhere in view') })])
    expect(sceneOf('x = sqrt(y - 5)').errors).toEqual([])
  })

  // fix round 1: a viewport that is not a number of pixels is not "undefined everywhere in view"
  describe('the viewport', () => {
    it('is clamped to finite numbers of at least a pixel: a canvas that is not displayed reports 0', () => {
      for (const [widthPx, heightPx] of [[0, 0], [-5, -5], [Number.NaN, Number.NaN], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], [0.2, 0.2]]) {
        const scene = sceneWith('y = x^2\ny = sin(x)', { widthPx, heightPx })
        expect(scene.errors, `${widthPx} x ${heightPx}`).toEqual([])
        expect(curvesOf(scene).map((c) => c.chains.length), `${widthPx} x ${heightPx}`).toEqual([1, 1])
        expect(Number.isFinite(scene.stats!.points)).toBe(true)
      }
    })
    it('a width that is not a number is the default one, and so is a height', () => {
      const byDefault = sceneWith('y = x^2')
      expect(sceneWith('y = x^2', { widthPx: Number.NaN }).stats).toEqual(byDefault.stats)
      expect(sceneWith('y = x^2', { widthPx: 800, heightPx: Number.NaN }).stats).toEqual(byDefault.stats)
    })
    it('a bounds of no height still gives the sampler a pixel to work in', () => {
      const scene = sceneWith('y = 1', undefined, { xMin: -10, xMax: 10, yMin: 5, yMax: 5.00001 })
      expect(scene.errors).toEqual([])
    })
  })

  // fix round 1 (S1): the Taylor example's sum has a slope past 16:1 where it leaves the view, and the twin cannot certify it
  // there; it was broken into 25 chains by jump breaks, at every floor interval of its steep stretches.
  describe("the Taylor example's sum curve", () => {
    const spec = '@param n = 3 range [0, 12] step 1 integer\ny = sin(x)\ny = sum(k = 0 to n, (-1)^k x^(2k+1)/(2k+1)!) color: red'
    const redOf = (scene: SceneOfResult) => curvesOf(scene).find((c) => c.color === 'red')!
    it('is not broken where its slope passes 16', () => {
      // x - x^3/6 + x^5/120 - x^7/5040 falls from -5.3 at x = 5 to -20.7 at x = 6: a slope of 15 to 30 across the bottom of
      // this view, which does not hold the origin
      const scene = sceneWith(spec, undefined, { xMin: 3, xMax: 8, yMin: -30, yMax: 5 })
      expect(scene.errors).toEqual([])
      const red = redOf(scene)
      expect(red.chains).toHaveLength(1)
      expect(red.breaks.filter((b) => b.kind === 'jump')).toEqual([])
      const ys = chainPoints(red.chains[0]).map((p) => p.y)
      expect(Math.min(...ys)).toBeLessThan(-29)
    })
    it('in the default view has no break where it is steep, and at most the one at the origin', () => {
      // The twin's enclosure of a box that starts at 0 is unbounded for this sum (x to the power 2k + 1 with k bound), so the
      // floor interval right of the origin is not joined, whatever its gaps: one jump break of 0.09 px there, which the twin
      // keeps (an enclosure with an infinite bound is where a pole may sit). Nowhere else.
      const scene = sceneWith(spec, undefined, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 })
      const red = redOf(scene)
      const jumps = red.breaks.filter((b) => b.kind === 'jump')
      expect(jumps.length).toBeLessThanOrEqual(1)
      for (const b of jumps) expect(Math.abs(b.at)).toBeLessThan(0.01)
      expect(red.chains.length).toBeLessThanOrEqual(2)
    })
  })

  describe('the budget note', () => {
    const NOTE = 'drawn coarsely: this curve needs more detail than its drawing budget allows'
    // a budget of 700 holds y = x (601 points, 301 intervals) and not y = sin(3x) (1201 and 901)
    const TINY = { points: 700, intervals: 700 }
    it('a curve that hits its cap still draws, and the scene says so on the curve\'s line', () => {
      const scene = sceneWith('y = x\ny = sin(3x)', { budget: TINY })
      expect(scene.errors).toEqual([{ line: 2, message: NOTE }])
      expect(curvesOf(scene)[1].chains.length).toBeGreaterThan(0)
    })
    it('names the line of each capped curve, and only those', () => {
      const scene = sceneWith('y = 2\ny = sin(3x)\ny = x\ny = sin(3x) + 1', { budget: TINY })
      expect(scene.errors.map((e) => e.line)).toEqual([2, 4])
    })
    it('a curve that fits says nothing', () => {
      expect(sceneOf('y = sin(3x)\ny = tan(x)').errors).toEqual([])
    })
    it('is not raised for a coarse pass: the settled pass is the one that says whether the curve fits', () => {
      const scene = sceneWith('y = sin(3x)', { budget: TINY, quality: 'coarse' })
      expect(scene.errors).toEqual([])
      expect(curvesOf(scene)[0].chains.length).toBeGreaterThan(0)
    })

    // fix round 1 (I1): an integral's twin certifies nothing, so at the cap nothing is connected and nothing is drawn. A note that
    // said "drawn coarsely" over a blank would be a false one, and none at all a silent blank.
    const NOT_DRAWN = 'not drawn: this curve needs more detail than its drawing budget allows'
    it('a capped curve that drew no chain and no band says "not drawn", at any quality, where nothing could be certified', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = sceneWith('y = integral(t = 0 to x, 2t)', { budget: { points: 50, intervals: 50 }, quality })
        expect(scene.errors, quality).toEqual([{ line: 1, message: NOT_DRAWN }])
        expect(curvesOf(scene)[0].chains, quality).toEqual([])
      }
    })
    it('and says it on the right line, and for that curve only', () => {
      // a budget of 50 caps every curve: the two the twin can certify are drawn from their start grid (coarsely), the integral has nothing
      const scene = sceneWith('y = x\ny = integral(t = 0 to x, 2t)\ny = 2', { budget: { points: 50, intervals: 50 } })
      expect(scene.errors).toEqual([
        { line: 1, message: NOTE },
        { line: 2, message: NOT_DRAWN },
        { line: 3, message: NOTE },
      ])
    })
    it('says nothing of a capped curve that is not in view: the cap hid nothing', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = sceneWith('y = integral(t = 0 to x, 2t) + 1000', { budget: { points: 50, intervals: 50 }, quality })
        expect(scene.errors, quality).toEqual([])
      }
    })
    it('"drawn coarsely" is for a curve that drew something, and only at full quality', () => {
      const full = sceneWith('y = sin(3x)', { budget: TINY })
      expect(full.errors).toEqual([{ line: 1, message: NOTE }])
      expect(sceneWith('y = sin(3x)', { budget: TINY, quality: 'coarse' }).errors).toEqual([])
    })
    it('an integral with the real budget is drawn, with no note, at both qualities', () => {
      const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
      for (const spec of ['y = integral(t = 0 to x, 2t)', 'y = integral(t = 0 to x, 20)', 'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)']) {
        for (const quality of ['full', 'coarse'] as const) {
          const scene = sceneWith(spec, { quality, widthPx: 800, heightPx: 800 }, view)
          expect(scene.errors, `${spec} ${quality}`).toEqual([])
          expect(curvesOf(scene).at(-1)!.chains.length, `${spec} ${quality}`).toBeGreaterThan(0)
        }
      }
    })
    // 40 cos(t) integrates to a curve that climbs 9000 px in the box; every leaf of the floor test is under a pixel (rule 1), so
    // it does not fit its budget at FULL: it is drawn from the left as far as the budget goes, and the line says so
    it('a steep integral that does not fit its budget is drawn as far as it goes, and says "drawn coarsely" at FULL only', () => {
      const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
      const spec = 'y = integral(t = 0 to x, 40 cos(t))'
      const full = sceneWith(spec, { quality: 'full', widthPx: 800, heightPx: 800 }, view)
      expect(full.errors).toEqual([{ line: 1, message: NOTE }])
      expect(curvesOf(full)[0].chains.length).toBeGreaterThan(0)
      const coarse = sceneWith(spec, { quality: 'coarse', widthPx: 800, heightPx: 800 }, view)
      expect(coarse.errors).toEqual([])
      expect(curvesOf(coarse)[0].chains.length).toBeGreaterThan(0)
    })
  })

  // calc P2 final review, I4 (rule 2): a curve that is in view and not drawn says why, whatever the cause. The budget and steepness
  // notes covered the cap path; y = floor(1000 x) at FULL drew nothing and said nothing, y = {x = 1: 5} was silent, and
  // y = {x = 1.05: 5} said "undefined everywhere in view" when the start grid missed the point and nothing when it hit it.
  describe('a blank says why', () => {
    const CERTIFY = 'not drawn: this curve could not be certified anywhere in view'
    const NOT_DRAWN_BUDGET = 'not drawn: this curve needs more detail than its drawing budget allows'
    const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    const build = (spec: string, quality: 'full' | 'coarse' = 'full', bounds = view, budget?: { points: number; intervals: number }) => sceneWith(spec, { quality, widthPx: 800, heightPx: 800, budget }, bounds)
    const marks = (scene: SceneOfResult) => scene.objects.filter((o) => o.kind === 'mark')
    it('a staircase whose treads are a hundredth of a pixel wide says nothing could be certified, at FULL and COARSE', () => {
      for (const [spec, quality] of [['y = floor(1000x)', 'full'], ['y = floor(1000x)', 'coarse'], ['y = floor(5000x)', 'full'], ['y = floor(500x)', 'coarse']] as const) {
        const scene = build(spec, quality)
        expect(scene.errors, `${spec} ${quality}`).toEqual([{ line: 1, message: CERTIFY }])
        expect(curvesOf(scene)[0].chains, `${spec} ${quality}`).toEqual([])
      }
    })
    it('a curve defined at one point is that point: a filled value mark, defined, no note, wherever the grid falls', () => {
      for (const spec of ['y = {x = 1: 5}', 'y = {x = 1.05: 5}']) {
        for (const off of [0, 0.013, 0.037, 0.25, 0.37, 1.11]) {
          const scene = build(spec, 'full', { ...view, xMin: view.xMin + off, xMax: view.xMax + off })
          const point = Number(spec.match(/= ([\d.]+):/)![1])
          expect(scene.errors, `${spec}, panned ${off}`).toEqual([])
          expect(marks(scene), `${spec}, panned ${off}`).toEqual([expect.objectContaining({ role: 'value', fill: 'filled', at: { x: point, y: 5 } })])
        }
      }
    })
    it('and the point off screen is a defined curve out of view, with no note', () => {
      const scene = build('y = {x = 1.05: 5}', 'full', { xMin: 3, xMax: 13, yMin: -10, yMax: 10 })
      expect(scene.errors).toEqual([])
    })
    it('a curve that is not there at all still says it is undefined everywhere in view', () => {
      expect(build('y = sqrt(-1 - x^2)').errors).toEqual([expect.objectContaining({ message: expect.stringContaining('undefined everywhere in view') })])
    })
    it('a capped curve whose chain is only in the overscan is "not drawn", not "drawn coarsely": only drawing in view counts', () => {
      // 40 cos(t) integrates to 40 sin(x): the budget is spent before the chain, which starts at the left of the overscan, reaches the view
      const scene = build('y = integral(t = 0 to x, 40 cos(t))', 'full', view, { points: 4000, intervals: 4000 })
      expect(curvesOf(scene)[0].chains.length).toBeGreaterThan(0)
      expect(scene.errors).toEqual([{ line: 1, message: NOT_DRAWN_BUDGET }])
    })
    it('an ordinary curve has no note: smooth, a pole, a hole, a jump, an edge, an oscillation, an integral', () => {
      for (const spec of ['y = x^2', 'y = sin(x)', 'y = tan(x)', 'y = 1/x', 'y = (x^2 - 1)/(x - 1)', 'y = floor(x)', 'y = ln(x)', 'y = sqrt(x)', 'y = sin(500x)', 'y = integral(t = 0 to x, sin(t))', 'r = 1 + cos(theta)', '(cos(t), sin(2t)) for t in [0, 6.3]', 'y = x + 100', 'y = {x = 1: 5} + x - x']) {
        for (const quality of ['full', 'coarse'] as const) expect(build(spec, quality).errors, `${spec} ${quality}`).toEqual([])
      }
    })
  })

  // calc P2 final review, I5: the budget counts what an evaluation costs. One point of y = integral(t = 0 to x, 5000 cos(100t)) is a
  // quadrature of about 23000 integrand evaluations, and the settled view took 533 s with the budget unspent. The integrand
  // evaluations are counted (math/binders.ts integrandEvaluations), the sampler charges them to its budget, and the curve caps.
  describe('what an integral costs', () => {
    const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    const NOT_DRAWN_BUDGET = 'not drawn: this curve needs more detail than its drawing budget allows'
    it.each(['full', 'coarse'] as const)('y = integral(t = 0 to x, 5000 cos(100t)) at %s stays within its budget, in integrand evaluations, and says so', (quality) => {
      const parsed = parseSpec('y = integral(t = 0 to x, 5000 cos(100t))')
      const before = integrandEvaluations()
      const scene = buildScene(parsed.statements, view, parsed.config, undefined, parsed.statementLines, { widthPx: 800, heightPx: 800, quality })
      const inner = integrandEvaluations() - before
      const budget = quality === 'full' ? FULL.budget.points : COARSE.budget.points
      // the budget is points, a point is innerPerPoint inner evaluations, and the start grid (drawn whatever the budget says) and
      // the one evaluation that finds the budget spent are over it by a few percent
      expect(inner, `${quality}: ${inner} integrand evaluations`).toBeLessThanOrEqual(budget * CORE.innerPerPoint * 1.25)
      expect(scene.stats!.points).toBeLessThanOrEqual(budget * 1.25)
      expect(scene.errors).toEqual([{ line: 1, message: NOT_DRAWN_BUDGET }])
    }, 60_000)
    it('and one that drew something before the cap says "drawn coarsely": 40 cos(t) at FULL, in a budget it exhausts', () => {
      const scene = sceneWith('y = integral(t = 0 to x, 40 cos(t))', { quality: 'full', widthPx: 800, heightPx: 800 }, view)
      expect(scene.errors).toEqual([{ line: 1, message: 'drawn coarsely: this curve needs more detail than its drawing budget allows' }])
    })
    it('the integrals the corpus draws are charged what they were: a point of each is under 100 integrand evaluations on average', () => {
      for (const spec of ['y = integral(t = 0 to x, sin(t))', 'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)', 'y = integral(t = 0 to x, 2t)']) {
        const parsed = parseSpec(spec)
        const before = integrandEvaluations()
        const scene = buildScene(parsed.statements, view, parsed.config, undefined, parsed.statementLines, { widthPx: 800, heightPx: 800, quality: 'full' })
        expect((integrandEvaluations() - before) / scene.stats!.points, spec).toBeLessThan(CORE.innerPerPoint)
        expect(scene.errors, spec).toEqual([])
      }
    })
  })

  // fix round 3 (rule 2): a smooth curve steeper than 1024:1 on screen is lifted at every floor interval (its leaves of 1/1024 px are
  // still a pixel), and drew nothing, with no message
  describe('the steepness note', () => {
    const STEEP = 'too steep to draw here: the curve rises faster than the sampler can certify'
    const view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    const build = (spec: string, quality: 'full' | 'coarse') => sceneWith(spec, { quality, widthPx: 800, heightPx: 800 }, view)
    it('y = integral(t = 0 to x, 2000) says it is too steep, at FULL and at COARSE (where nothing drew)', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = build('y = integral(t = 0 to x, 2000)', quality)
        expect(scene.errors, quality).toEqual([{ line: 1, message: STEEP }])
        expect(curvesOf(scene)[0].chains, quality).toEqual([])
      }
    })
    it('names its own line, and nothing else gets it', () => {
      const scene = build('y = x\ny = integral(t = 0 to x, 2000)\ny = sin(x)', 'full')
      expect(scene.errors).toEqual([{ line: 2, message: STEEP }])
    })
    it('a curve that is steep in places and drawn elsewhere has it at FULL, and not at COARSE, where something drew', () => {
      // 2000x on the left, x on the right
      const spec = 'y = {x < 0: integral(t = 0 to x, 2000), x}'
      const full = build(spec, 'full')
      expect(full.errors).toEqual([{ line: 1, message: STEEP }])
      expect(curvesOf(full)[0].chains.length).toBeGreaterThan(0)
      const coarse = build(spec, 'coarse')
      expect(coarse.errors).toEqual([])
      expect(curvesOf(coarse)[0].chains.length).toBeGreaterThan(0)
    })
    // residual round R3: "something drew" is something in the picture. A chain only in the overscan (the line y = x from 10.5, where
    // the view ends at 10) is not drawing, and the steepness it hides was not announced at COARSE.
    it('a steep stretch in view with a chain only in the overscan says "too steep" at COARSE too', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = build('y = {x < 10.5: integral(t = 0 to x, 2000), x}', quality)
        expect(scene.errors, quality).toEqual([{ line: 1, message: STEEP }])
        expect(curvesOf(scene)[0].chains.length, quality).toBeGreaterThan(0)
      }
    })
    it('a steep integral that draws (a slope of 200 or 1000) has no note, at either quality', () => {
      for (const slope of [200, 1000]) {
        for (const quality of ['full', 'coarse'] as const) {
          const scene = build(`y = integral(t = 0 to x, ${slope})`, quality)
          expect(scene.errors, `${slope} ${quality}`).toEqual([])
          expect(curvesOf(scene)[0].chains.length, `${slope} ${quality}`).toBeGreaterThan(0)
        }
      }
    })
    it('a real jump the walk did not find is a break and not "too steep"', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = build('y = 200 (x - 5) - 0.05 floor(50 x)', quality)
        expect(scene.errors.map((e) => e.message), quality).not.toContain(STEEP)
        expect(curvesOf(scene)[0].breaks.some((b) => b.kind === 'jump'), quality).toBe(true)
      }
    })
    it('a steep stretch that is not in view is not announced', () => {
      for (const quality of ['full', 'coarse'] as const) expect(build('y = integral(t = 0 to x, 2000) - 24000', quality).errors, quality).toEqual([])
    })

    // fix round 4. The sampler kept the first 64 places it lifted a steep curve at, and looked for one in view afterwards: the left
    // overscan (x from -15 to -10) held all 64 before x reached the view, and a curve of slope 3000 that is broken at 5466 places in view
    // had no note. It is decided in view as each place is recorded.
    it('y = integral(t = 0 to x, 0) + 60 sin(50 x), slope 3000, says it is too steep at FULL: the overscan fills no list before the view', () => {
      const scene = build('y = integral(t = 0 to x, 0) + 60 sin(50 x)', 'full')
      expect(scene.errors).toContainEqual({ line: 1, message: STEEP })
      expect(curvesOf(scene)[0].chains).toEqual([])
      expect(curvesOf(scene)[0].breaks.filter((b) => b.kind === 'jump').length).toBeGreaterThan(64)
    })
    // the natural form of that curve, in a view of +-1: in the view of +-10 an integral of cos(50 t) costs about 6 ms a point and the
    // curve five minutes at FULL (the same note, measured once: 5466 jump breaks, no chain, tooSteep)
    it('y = integral(t = 0 to x, 3000 cos(50 t)) says it is too steep at FULL', () => {
      const small = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }
      const scene = sceneWith('y = integral(t = 0 to x, 3000 cos(50 t))', { quality: 'full', widthPx: 800, heightPx: 800 }, small)
      expect(scene.errors).toContainEqual({ line: 1, message: STEEP })
      expect(curvesOf(scene)[0].chains).toEqual([])
    }, 60000)
    it('a steep stretch in the overscan stays silent while the same slope in view is announced: 2000 - 24000, and 2000', () => {
      expect(build('y = integral(t = 0 to x, 2000) - 24000', 'full').errors).toEqual([])
      expect(build('y = integral(t = 0 to x, 2000)', 'full').errors).toEqual([{ line: 1, message: STEEP }])
    })

    // fix round 4 (rule 2, a false note): a real jump on a slope the sampler can certify is a break and not "too steep". A jump of J px
    // riding a slope that climbs a px in a leaf halves its gap to (J + a)/(J + 2a), which is 0.75 or under for 1 to 2 px jumps on slopes
    // of 512 to 1024, where the old test (0.75) called it steepness. It is steepShrink now.
    it('y = 800 (x - 5) + 0.03 floor(50 x), 1.2 px jumps on a slope of 800, breaks and says nothing about steepness', () => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = build('y = 800 (x - 5) + 0.03 floor(50 x)', quality)
        expect(scene.errors.map((e) => e.message), quality).not.toContain(STEEP)
        const f = (x: number) => 800 * (x - 5) + 0.03 * Math.floor(50 * x)
        expect(curvesOf(scene)[0].breaks.filter((b) => b.kind === 'jump' && Math.abs(f(b.at)) <= 10).length, quality).toBeGreaterThan(0)
      }
    })
    it.each([[600, 0.0275], [800, 0.0375], [1000, 0.03], [1000, 0.0375]])('a jump of %s-slope curve by %s units (1.1 to 1.5 px) is not too steep', (slope, jump) => {
      for (const quality of ['full', 'coarse'] as const) {
        const scene = build(`y = ${slope} (x - 5) + ${jump} floor(50 x)`, quality)
        expect(scene.errors.map((e) => e.message), `${slope} ${jump} ${quality}`).not.toContain(STEEP)
      }
    })
  })

  describe('a curve never blanks silently (rule 2)', () => {
    it('y = sqrt(sin(350x)) draws, where it used to burn its budget finding zeros and draw nothing', () => {
      const scene = sceneOf('y = sqrt(sin(350x))')
      const drawn = curvesOf(scene).flatMap((c) => c.chains).length + scene.objects.filter((o) => o.kind === 'band').length
      expect(drawn).toBeGreaterThan(0)
      // a fit that did not hold would say so, in a message and not in a blank
      expect(scene.errors.every((e) => e.message === 'drawn coarsely: this curve needs more detail than its drawing budget allows')).toBe(true)
    })
  })
})

describe('implicit curves and regions through the quadtree', () => {
  const BUDGET = 'drawn coarsely: this curve needs more detail than its drawing budget allows'
  const UNDEFINED_CURVE = 'this curve is undefined everywhere in view'
  type Region = Extract<SceneObject, { kind: 'region' }>
  type Curve = Extract<SceneObject, { kind: 'curve' }>

  const regionOf = (scene: ReturnType<typeof build>['scene']): Region => {
    const r = scene.objects.find((o): o is Region => o.kind === 'region')
    if (!r) throw new Error('no region object')
    return r
  }
  // the even-odd area of nested rings (a ring's direction means nothing): rings sorted by area, alternately added and
  // subtracted, which is exact for the nested-ring cases under test
  const evenOddArea = (region: Region): number => {
    const areas = region.outline
      .map((chain) => {
        const pts = chainPoints(chain)
        let a = 0
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]
          const q = pts[(i + 1) % pts.length]
          a += p.x * q.y - q.x * p.y
        }
        return Math.abs(a) / 2
      })
      .sort((a, b) => b - a)
    return areas.reduce((sum, a, i) => sum + (i % 2 === 0 ? a : -a), 0)
  }

  it('an annulus is a region of area 3 pi, with dashed boundary curves', () => {
    const { scene } = build('1 < x^2+y^2 < 4')
    expect(scene.errors).toEqual([])
    const area = evenOddArea(regionOf(scene))
    expect(Math.abs(area - 3 * Math.PI) / (3 * Math.PI)).toBeLessThan(0.005)
    const boundary = scene.objects.filter((o): o is Curve => o.kind === 'curve' && o.id.object.startsWith('boundary.'))
    expect(boundary.length).toBeGreaterThan(0)
    for (const c of boundary) expect(c.dashed).toBe(true)
  })

  it('a region with a where clause is clipped to it', () => {
    const { scene } = build('x^2 + y^2 < 1 if x > 0')
    expect(scene.errors).toEqual([])
    const area = evenOddArea(regionOf(scene))
    expect(Math.abs(area - Math.PI / 2) / (Math.PI / 2)).toBeLessThan(0.01)
  })

  it('an implicit curve with a where clause is a curve that stops at the clause', () => {
    const { scene } = build('x^2 + y^2 = 4 if y > 0')
    expect(scene.errors).toEqual([])
    const curves = scene.objects.filter((o): o is Curve => o.kind === 'curve')
    expect(curves.length).toBeGreaterThan(0)
    const pts = curves.flatMap(vertices)
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(-1e-6)
    expect(pts.some((p) => Math.abs(p.x - 2) < 0.05 && Math.abs(p.y) < 0.05)).toBe(true)
    expect(pts.some((p) => Math.abs(p.x + 2) < 0.05 && Math.abs(p.y) < 0.05)).toBe(true)
  })

  it('a circle draws with no errors and counts its work', () => {
    const { scene } = build('x^2 + y^2 = 4')
    expect(scene.errors).toEqual([])
    expect(scene.stats?.points ?? 0).toBeGreaterThan(0)
  })

  describe('notes', () => {
    const sceneWith = (spec: string, options: Parameters<typeof buildScene>[5]) => {
      const parsed = parseSpec(spec)
      return buildScene(parsed.statements, bounds, parsed.config, 140, parsed.statementLines, options)
    }
    // holds the first levels of the quadtree of a disc and not the rest, and still draws in view
    const TINY = { points: 1600, intervals: 1600 }

    it('a region forced to its cap says "drawn coarsely" at FULL', () => {
      const scene = sceneWith('x^2 + y^2 < 25', { quality: 'full', budget: TINY })
      expect(scene.errors).toEqual([{ line: 1, message: BUDGET }])
    })
    it('and says nothing at COARSE', () => {
      const scene = sceneWith('x^2 + y^2 < 25', { quality: 'coarse', budget: TINY })
      expect(scene.errors).toEqual([])
    })
    it('an implicit curve undefined everywhere in view is an error', () => {
      const parsed = parseSpec('sqrt(-1-x^2) = y')
      const scene = buildScene(parsed.statements, bounds, parsed.config)
      expect(scene.errors.map((e) => e.message)).toEqual([UNDEFINED_CURVE])
    })
  })
})
