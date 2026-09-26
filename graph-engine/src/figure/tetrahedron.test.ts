import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { GEOM_EPS } from '../scene/geometry/types'
import { worldToAuthor } from './authorFrame'
import { renderFigure } from './render'
import { buildSolidFigure } from './solidScope'
import { buildSolid } from './solids'
import { cayleyMenger, tetrahedronFromEdges } from './tetrahedron'

// P4 — the tetrahedron from its six edges. Every expected value here is
// computed by hand from the edges, never read back from the builder.

const value = (e: Parameters<typeof evalExpr>[0]) => evalExpr(e, {}, 'radians', {})

function walk(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return buildSolidFigure(parsed.statements, value)
}

function errorsOf(spec: string): string[] {
  const parsed = parseSpec(spec)
  return [...parsed.errors.map((e) => e.message), ...renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).errors.map((e) => e.message)]
}

const AIME = 'T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)'

describe('six equal edges are the regular tetrahedron, placed the same (P4)', () => {
  it('puts every lettered vertex exactly where "tetrahedron edge 6 vertices ABCD" does', () => {
    const regular = buildSolid({ kind: 'tetrahedron', edge: 6 })
    const lettered = regular.labelOrder.map((i) => regular.polyhedron!.vertices[i])
    const built = tetrahedronFromEdges({ AB: 6, AC: 6, AD: 6, BC: 6, BD: 6, CD: 6 }, ['A', 'B', 'C', 'D'])
    built.forEach((p, i) => {
      expect(Math.abs(p.x - lettered[i].x)).toBeLessThan(GEOM_EPS)
      expect(Math.abs(p.y - lettered[i].y)).toBeLessThan(GEOM_EPS)
      expect(Math.abs(p.z - lettered[i].z)).toBeLessThan(GEOM_EPS)
    })
  })

  it('binds the same space points through the grammar as the regular form does', () => {
    const scope = walk(
      '@mode: figure\nT = solid tetrahedron ABCD with AB = 6, AC = 6, AD = 6, BC = 6, BD = 6, CD = 6\n' + 'S = solid tetrahedron edge 6 vertices PQRS'
    )
    expect(scope.errors).toEqual([])
    for (const [edgeName, regularName] of [
      ['A', 'P'],
      ['B', 'Q'],
      ['C', 'R'],
      ['D', 'S'],
    ]) {
      const p = scope.points.get(edgeName)!
      const q = scope.points.get(regularName)!
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(GEOM_EPS)
    }
  })

  it('gives the determinant 288 V^2 = 4 for the unit regular tetrahedron, V = sqrt(2)/12', () => {
    expect(cayleyMenger({ AB: 1, AC: 1, AD: 1, BC: 1, BD: 1, CD: 1 })).toBeCloseTo(288 * (2 / 144), 12)
  })
})

describe('the AIME 2024 I tetrahedron', () => {
  // AB = CD = sqrt 41, AC = BD = sqrt 80, AD = BC = sqrt 89.
  //
  // Hand computation, independent of the builder:
  //  - area(ABC) by Heron, in the squared form 16 K^2 = 2(a2 b2 + b2 c2 +
  //    c2 a2) - (a2^2 + b2^2 + c2^2) with (a2, b2, c2) = (41, 80, 89):
  //    2(3280 + 7120 + 3649) - (1681 + 6400 + 7921) = 28098 - 16002 =
  //    12096, so K^2 = 756 = 36 * 21 and K = 6 sqrt 21.
  //  - V for an isosceles tetrahedron (opposite edges equal):
  //    V^2 = (a2 + b2 - c2)(a2 - b2 + c2)(-a2 + b2 + c2) / 72
  //        = 32 * 50 * 128 / 72 = 25600 / 9, so V = 160 / 3.
  //  - the height of D over ABC is 3V / K = 160 / (6 sqrt 21) = 80 / (3 sqrt 21).
  const HEIGHT = 80 / (3 * Math.sqrt(21))
  const edges = [
    ['AB', Math.sqrt(41)],
    ['CD', Math.sqrt(41)],
    ['AC', Math.sqrt(80)],
    ['BD', Math.sqrt(80)],
    ['AD', Math.sqrt(89)],
    ['BC', Math.sqrt(89)],
  ] as const

  it('asserts all six edges, true length in space', () => {
    const labels = edges.map(([name, length]) => `label: ${name} = ${length}`).join('\n')
    expect(errorsOf(`@mode: figure\n${AIME}\n${labels}`)).toEqual([])
    // ...and a wrong one fails, so the assertions above can.
    expect(errorsOf(`@mode: figure\n${AIME}\nlabel: AB = 6.5`)).toHaveLength(1)
  })

  it('drops D to the height 3V / area(ABC) = 80 / (3 sqrt 21) above the base', () => {
    const spec = `@mode: figure\n${AIME}\nF = foot D to plane A-B-C\nlabel: DF = ${HEIGHT}`
    expect(errorsOf(spec)).toEqual([])
  })

  it('lays the base ABC horizontal, centred on the vertical axis, with D above at +h/2', () => {
    const scope = walk(`@mode: figure\n${AIME}`)
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n) => worldToAuthor(scope.points.get(n)!))
    expect(b.z).toBeCloseTo(a.z, 12)
    expect(c.z).toBeCloseTo(a.z, 12)
    expect(a.z).toBeCloseTo(-HEIGHT / 2, 12)
    expect(d.z).toBeCloseTo(HEIGHT / 2, 12)
    // The base centroid on the axis.
    expect((a.x + b.x + c.x) / 3).toBeCloseTo(0, 12)
    expect((a.y + b.y + c.y) / 3).toBeCloseTo(0, 12)
    // A at author azimuth 45 degrees from it (the default camera's 30, plus
    // 15), and B, C counter-clockwise from above: the z of AB x AC is up.
    expect((Math.atan2(a.y, a.x) * 180) / Math.PI).toBeCloseTo(45, 9)
    expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0)
  })

  it('gives the same output whatever order the edges come in, and either letter order', () => {
    const shuffled =
      'T = solid tetrahedron ABCD with BC = sqrt(89), DA = sqrt(89), BD = sqrt(80), CA = sqrt(80), DC = sqrt(41), BA = sqrt(41)'
    const render = (spec: string) => {
      const parsed = parseSpec(`@mode: figure\n${spec}\nsegment: A-C`)
      return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
    }
    expect(render(shuffled)).toBe(render(AIME))
  })
})

describe('what the six edges refuse', () => {
  it('refuses a face that fails the triangle inequality, naming the face', () => {
    const errors = errorsOf('@mode: figure\nT = solid tetrahedron ABCD with AB = 1, AC = 1, BC = 3, AD = 2, BD = 2, CD = 2')
    expect(errors).toEqual([expect.stringMatching(/^The face ABC cannot close/)])
  })

  it('refuses six edges whose faces all close but which cannot close into a solid', () => {
    // Faces ABC and ABD are equilateral, ACD and BCD have sides 1, 1, 1.99:
    // every face is a triangle, but CD = 1.99 is longer than the two
    // equilateral faces hinged on AB can ever reach (sqrt 3).
    const errors = errorsOf('@mode: figure\nT = solid tetrahedron ABCD with AB = 1, AC = 1, AD = 1, BC = 1, BD = 1, CD = 1.99')
    expect(errors).toEqual([expect.stringMatching(/These six edges cannot close into a tetrahedron ABCD/)])
  })

  it('refuses six edges that close only flat', () => {
    // A unit square and its diagonals: four points in one plane.
    const errors = errorsOf(`@mode: figure\nT = solid tetrahedron ABCD with AB = 1, BC = 1, CD = 1, AD = 1, AC = ${Math.SQRT2}, BD = ${Math.SQRT2}`)
    expect(errors).toEqual([expect.stringMatching(/close only into a flat figure/)])
  })

  it('refuses a missing pair, a repeated pair and a fifth letter, naming each', () => {
    expect(errorsOf('@mode: figure\nT = solid tetrahedron ABCD with AB = 1, AC = 1, AD = 1, BC = 1, BD = 1')).toEqual([
      expect.stringMatching(/needs all six; CD is missing/),
    ])
    expect(errorsOf('@mode: figure\nT = solid tetrahedron ABCD with AB = 1, BA = 1, AD = 1, BC = 1, BD = 1, CD = 1')).toEqual([
      expect.stringMatching(/The edge AB is given twice \("AB" and "BA"\)/),
    ])
    expect(errorsOf('@mode: figure\nT = solid tetrahedron ABCD with AB = 1, AE = 1, AD = 1, BC = 1, BD = 1, CD = 1')).toEqual([
      expect.stringMatching(/E is not one of the tetrahedron's vertices ABCD/),
    ])
  })

  it('refuses to rebind a vertex letter, and refuses a vertices clause', () => {
    expect(errorsOf(`@mode: figure\nA = (0, 0, 0)\n${AIME}`)).toEqual([expect.stringMatching(/"A" is already bound/)])
    expect(errorsOf(`@mode: figure\n${AIME} vertices PQRS`)).toEqual([expect.stringMatching(/"T" names its vertices ABCD already/)])
  })

  it('has no named dimensions', () => {
    expect(errorsOf(`@mode: figure\n${AIME}\nlabel: T edge`)).toEqual([expect.stringMatching(/"T" is built on named points.*"label: AB"/)])
  })
})
