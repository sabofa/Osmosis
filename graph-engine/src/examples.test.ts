import { describe, expect, it } from 'vitest'
import { EXAMPLE_GROUPS, EXAMPLES } from './examples'
import { parseSpec } from './parser/parseSpec'
import { renderFigure } from './figure/render'
import { buildScene } from './scene/buildScene'
import { buildTable } from './scene/buildTable'
import { isThreeD, resolvePanels } from './scene/mode'
import { createSpaceKernel } from './space/kernel/index'
import { LIGHT_PALETTE } from './render/palette'
import { evalExpr } from './parser/evalExpr'
import { authorToWorld } from './figure/authorFrame'
import { toWorld } from './figure/silhouette'
import { buildSolidFigure } from './figure/solidScope'

// Every example is a button in the review harness, and a button that does not
// work is a defect the user meets on their first click. Three phases of
// geometry shipped with no example exposing any of it, and the engine was
// reported as broken because the features could not be found — so this file
// exists to make a dead example button impossible to ship.

const BOUNDS = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

describe('review harness examples', () => {
  it('has examples with unique labels', () => {
    const labels = EXAMPLES.map((e) => e.label)
    expect(labels.length).toBeGreaterThan(20)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // The harness shows one group at a time, so an example outside every group
  // is an example nobody can reach — the failure this file exists to prevent.
  it('puts every example in a known group, and leaves no group empty', () => {
    for (const example of EXAMPLES) expect(EXAMPLE_GROUPS, example.label).toContain(example.group)
    for (const group of EXAMPLE_GROUPS) expect(EXAMPLES.some((e) => e.group === group), group).toBe(true)
  })

  for (const example of EXAMPLES) {
    describe(example.label, () => {
      const parsed = parseSpec(example.spec)

      it('parses with no errors', () => {
        expect(parsed.errors.map((e) => `line ${e.line}: ${e.message}`)).toEqual([])
      })

      it('puts something on screen', () => {
        const panels = resolvePanels(parsed.statements, parsed.config)
        expect(panels.drawable !== null || panels.table).toBe(true)

        if (panels.table) {
          // A table panel with no rows would render an empty frame.
          const tables = buildTable(parsed.statements, parsed.config)
          expect(tables.length).toBeGreaterThan(0)
        }

        if (panels.drawable === 'figure') {
          const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
          expect(result.errors.map((e) => e.message)).toEqual([])
          // The paper rect is always emitted, so counting elements alone
          // would pass for an empty figure. Count only drawn content.
          const drawn = (result.svg.match(/<(circle|line|path|polyline|polygon|text)\b/g) ?? []).length
          expect(drawn).toBeGreaterThan(0)
        }

        if (panels.drawable === 'graph' && isThreeD(parsed.statements)) {
          // Space: the kernel builds it (track 3), with no errors and at
          // least one mark.
          const scene = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene()
          expect(scene.errors.map((e) => `line ${e.line}: ${e.message}`)).toEqual([])
          expect(scene.marks.length).toBeGreaterThan(0)
        } else if (panels.drawable === 'graph') {
          const scene = buildScene(parsed.statements, BOUNDS, parsed.config)
          expect(scene.errors.map((e) => e.message)).toEqual([])
          expect(scene.objects.length).toBeGreaterThan(0)
        }
      })
    })
  }
})

// The "Two cones and a sphere" example states its sphere's radius as a
// number, 15/sqrt(73), rather than constructing tangency (build step 9). A
// wrong number would draw a sphere that is not tangent, and nothing else
// would notice — so it is checked here, against the solids the example
// actually builds.
describe('the "Two cones and a sphere" example is tangent', () => {
  const example = EXAMPLES.find((e) => e.label === 'Two cones and a sphere')!
  const parsed = parseSpec(example.spec)
  const scope = buildSolidFigure(parsed.statements, (e) => evalExpr(e, {}, 'radians', {}))

  it('builds both cones and the sphere', () => {
    expect(scope.errors).toEqual([])
    expect([...scope.solids.keys()].sort()).toEqual(['K', 'L', 'S'])
  })

  for (const [cone, rimPoint] of [
    ['K', { x: -3, y: 3, z: 0 }],
    ['L', { x: 3, y: -3, z: 0 }],
  ] as const) {
    it(`puts the sphere at distance 15 / sqrt(73) from the generator of ${cone} through (${rimPoint.x}, ${rimPoint.y}, ${rimPoint.z})`, () => {
      const body = scope.solids.get(cone)!
      const sphere = scope.solids.get('S')!
      const h = body.spec.kind === 'cone' ? body.spec.height : NaN
      const apex = toWorld(body.placement, { x: 0, y: h / 2, z: 0 })
      const baseCentre = toWorld(body.placement, { x: 0, y: -h / 2, z: 0 })
      const rim = authorToWorld(rimPoint)
      // The point really is on this cone's base rim: radius 3 from the base
      // centre, square to the axis.
      const out = { x: rim.x - baseCentre.x, y: rim.y - baseCentre.y, z: rim.z - baseCentre.z }
      const axis = body.placement.frame.axis
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(3, 12)
      expect(out.x * axis.x + out.y * axis.y + out.z * axis.z).toBeCloseTo(0, 12)
      // Distance from the sphere's centre to the line apex -> rim.
      const d = { x: rim.x - apex.x, y: rim.y - apex.y, z: rim.z - apex.z }
      const c = sphere.placement.origin
      const w = { x: c.x - apex.x, y: c.y - apex.y, z: c.z - apex.z }
      const cross = { x: w.y * d.z - w.z * d.y, y: w.z * d.x - w.x * d.z, z: w.x * d.y - w.y * d.x }
      const distance = Math.hypot(cross.x, cross.y, cross.z) / Math.hypot(d.x, d.y, d.z)
      expect(distance).toBeCloseTo(15 / Math.sqrt(73), 12)
      expect(sphere.spec.kind === 'sphere' && sphere.spec.radius).toBeCloseTo(distance, 12)
    })
  }
})

// Phase 9's examples construct their spheres; the numbers they print are
// checked here against hand values, so an example cannot quietly draw a
// sphere that is not the one its comment promises.
describe('the phase 9 sphere examples', () => {
  const walkOf = (label: string) => {
    const parsed = parseSpec(EXAMPLES.find((e) => e.label === label)!.spec)
    return buildSolidFigure(parsed.statements, (e) => evalExpr(e, {}, 'radians', {}))
  }
  const radius = (scope: ReturnType<typeof walkOf>, name: string) => {
    const body = scope.solids.get(name)!
    return body.spec.kind === 'sphere' ? body.spec.radius : NaN
  }

  it('gives the AIME tetrahedron an insphere of radius 20 sqrt 21 / 63', () => {
    expect(radius(walkOf('AIME tetrahedron and its insphere'), 'I')).toBeCloseTo((20 * Math.sqrt(21)) / 63, 12)
  })

  it('puts the cube of edge 4 between spheres of radius 2 and 2 sqrt 3', () => {
    const scope = walkOf('Cube between two spheres')
    expect(radius(scope, 'I')).toBeCloseTo(2, 12)
    expect(radius(scope, 'O')).toBeCloseTo(2 * Math.sqrt(3), 12)
  })

  it('puts a sphere of radius 1.5 in the cone and of radius 2 in the frustum', () => {
    expect(radius(walkOf('Sphere in a cone'), 'I')).toBeCloseTo(1.5, 12)
    expect(radius(walkOf('Frustum with an insphere'), 'I')).toBeCloseTo(2, 12)
  })

  it('makes PQ, between the tangent spheres, the sum of their radii', () => {
    const scope = walkOf('Spheres by tangency')
    const [p, q] = [scope.points.get('P')!, scope.points.get('Q')!]
    const pq = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
    // P = (0, 0, 2) over z = 0: radius 2. PQ = |(4, 1, 1)| = sqrt 18.
    expect(radius(scope, 'S')).toBeCloseTo(2, 12)
    expect(pq).toBeCloseTo(Math.sqrt(18), 12)
    expect(radius(scope, 'S') + radius(scope, 'T')).toBeCloseTo(pq, 12)
    // U is centred 1 from Q, inside T, and internally tangent to it.
    expect(radius(scope, 'U')).toBeCloseTo(Math.sqrt(18) - 2 - 1, 12)
  })

  it("circumscribes the cone: 7/8 above its base, radius 25/8", () => {
    const scope = walkOf('Sphere in a cone')
    expect(radius(scope, 'O')).toBeCloseTo(25 / 8, 12)
    // Internal y is author z; the base is at z = -2.
    expect(scope.solids.get('O')!.placement.origin.y).toBeCloseTo(-2 + 7 / 8, 12)
  })

  it('puts the four points on a sphere of radius sqrt 3 about (1, 1, 1)', () => {
    const scope = walkOf('Sphere through four points')
    expect(radius(scope, 'O')).toBeCloseTo(Math.sqrt(3), 12)
    // (1, 1, 1) is fixed by the author-to-internal map.
    const m = scope.points.get('M')!
    for (const c of [m.x, m.y, m.z]) expect(c).toBeCloseTo(1, 12)
  })
})

// The adaptive-sampler examples (calc P2) each exist to show one thing, so each is checked to show it, in the view
// it asks for: a button whose picture has lost its hole, its open end or its band is a defect nobody would see.
describe('the adaptive sampler examples', () => {
  const sceneOf = (label: string) => {
    const parsed = parseSpec(EXAMPLES.find((e) => e.label === label)!.spec)
    return buildScene(parsed.statements, parsed.config.bounds ?? BOUNDS, parsed.config, undefined, parsed.statementLines)
  }
  const marksOf = (scene: ReturnType<typeof sceneOf>) => scene.objects.flatMap((o) => (o.kind === 'mark' ? [o] : []))

  it('"Holes, jumps and poles" has the open hole at (1, 2), the steps of floor with open and filled ends, and a guide at each pole', () => {
    const scene = sceneOf('Holes, jumps and poles')
    expect(scene.errors).toEqual([])
    const marks = marksOf(scene)
    expect(marks.some((m) => m.role === 'hole' && m.fill === 'open' && Math.abs(m.at.x - 1) < 1e-9 && Math.abs(m.at.y - 2) < 1e-6)).toBe(true)
    expect(marks.some((m) => m.role === 'endpoint' && m.fill === 'open')).toBe(true)
    expect(marks.some((m) => m.role === 'endpoint' && m.fill === 'filled')).toBe(true)
    // tan x has poles at pi/2 and 3 pi/2 on each side of 0 in the view (and more in the overscan)
    const guides = scene.objects.filter((o) => o.kind === 'line' && o.role === 'asymptote')
    expect(guides.length).toBeGreaterThanOrEqual(4)
  })

  it('"Piecewise ends" leaves the braces open at (0, 0) and filled at (0, 1), and 2 if 0 < x <= 3 open at 0 and filled at 3', () => {
    const scene = sceneOf('Piecewise ends')
    expect(scene.errors).toEqual([])
    const ends = marksOf(scene)
      .filter((m) => m.role === 'endpoint')
      .map((m) => `${Math.round(m.at.x)},${Math.round(m.at.y)} ${m.fill}`)
      .sort()
    expect(ends).toEqual(['0,0 open', '0,1 filled', '0,2 open', '3,2 filled'])
  })

  it('"Faster than a pixel" draws sin(1/x) near 0 as a band', () => {
    const scene = sceneOf('Faster than a pixel')
    expect(scene.errors).toEqual([])
    expect(scene.objects.some((o) => o.kind === 'band')).toBe(true)
  })

  it('"A polar pole" breaks r = 1/cos(theta) at pi/2 and 3 pi/2, and draws the line x = 1 between', () => {
    const scene = sceneOf('A polar pole')
    expect(scene.errors).toEqual([])
    const curve = scene.objects.find((o) => o.kind === 'curve')
    if (curve?.kind !== 'curve') throw new Error('no curve')
    expect(curve.breaks.filter((b) => b.kind === 'pole').map((b) => b.at)).toEqual([expect.closeTo(Math.PI / 2, 9), expect.closeTo((3 * Math.PI) / 2, 9)])
    // x = r cos(theta) = 1 on every vertex: a vertical line, with no chord from one pole's side to the other
    for (const chain of curve.chains) for (let i = 0; i < chain.param.length; i++) expect(chain.xy[2 * i]).toBeCloseTo(1, 9)
  })
})

// The Styles group exists to show the looks; an example there that drew
// clean would be a button that shows nothing it promises.
describe('the Styles examples', () => {
  const styles = EXAMPLES.filter((e) => e.group === 'Styles')

  it('are several, each pinned to a look', () => {
    expect(styles.length).toBeGreaterThanOrEqual(5)
    for (const example of styles) expect(example.spec, example.label).toMatch(/^@style: /m)
  })

  for (const example of styles) {
    it(`${example.label} draws styled, not clean`, () => {
      const parsed = parseSpec(example.spec)
      const styled = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
      const clean = renderFigure(parsed.statements, { ...parsed.config, style: {} }, LIGHT_PALETTE).svg
      expect(styled).not.toBe(clean)
      expect(styled).toMatch(/data-layer="paper"/)
    })
  }
})
