import { describe, expect, it } from 'vitest'
import { EXAMPLES } from './examples'
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
