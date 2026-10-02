import { describe, expect, it } from 'vitest'
import { parseExprString } from '../../../parser/parseExpr'
import { parseSpec } from '../../../parser/parseSpec'
import type { Statement } from '../../../parser/types'
import { resolveBox } from '../../frame/bounds'
import type { LineMark } from '../../scene/types'
import type { BuildContext, BuildResult } from '../registry'
import { buildScope } from '../scope'
import type { ContourForm, Levels } from '../../grammar/keywords/geometryForms'
import type { SpaceStyle } from '../../grammar/types'
import { contourCurves, levelCurves, niceLevels } from './contours'
import { kernelOf, lineOf, sceneOf } from './testing'

const p = parseExprString

const NO_STYLE: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }

// contourCurves reads S4a's contour form (its plan, A2); these unit tests
// construct the form directly, and the last block goes through the grammar.
function contour(target: string, levels: Levels, options: { floor?: boolean; labels?: boolean; spec?: string; color?: string } = {}): BuildResult {
  const parsed = parseSpec(options.spec ?? '')
  expect(parsed.errors).toEqual([])
  const { scope } = buildScope(parsed.statements, parsed.statementLines, parsed.config.bindings, parsed.config.angle)
  const form: ContourForm = { form: 'contour', target: p(target), text: target, levels, floor: options.floor ?? false, labels: options.labels ?? false, style: NO_STYLE }
  const statement = { kind: 'space', form, color: options.color ?? null, statementName: null } as unknown as Statement
  const line = parsed.statementLines.length + 1
  const context: BuildContext = {
    scope,
    config: parsed.config,
    line,
    source: { line, statement: null, object: `s${line}` },
    color: { author: options.color ?? null, slot: 0 },
    colorScaleId: null,
    // With nothing else drawn, the box pass hands a tool @bounds3d, else
    // [-5, 5] on each axis (integration J1).
    box: resolveBox(parsed.config.space, null),
    named: new Map(),
  }
  return contourCurves.prepare(statement, context).build()
}

const list = (...values: string[]): Levels => ({ kind: 'list', values: values.map((v) => p(v)) })

function polylines(mark: LineMark): [number, number, number][][] {
  const out: [number, number, number][][] = []
  for (let k = 0; k < mark.starts.length; k++) {
    const end = k + 1 < mark.starts.length ? mark.starts[k + 1] : mark.positions.length / 3
    const line: [number, number, number][] = []
    for (let v = mark.starts[k]; v < end; v++) line.push([mark.positions[3 * v], mark.positions[3 * v + 1], mark.positions[3 * v + 2]])
    out.push(line)
  }
  return out
}

function byObject(result: BuildResult, object: string): LineMark {
  const mark = result.marks.find((m) => m.source.object === object)
  if (!mark || mark.kind !== 'lines') throw new Error(`no line mark ${object}`)
  return mark
}

describe('contourCurves: x^2 + y^2 at levels 1 and 4', () => {
  const result = contour('x^2 + y^2', list('1', '4'))

  it('draws one closed polyline per level, at z = 1 and z = 4 exactly', () => {
    expect(result.errors).toEqual([])
    expect(result.marks.map((m) => m.source.object)).toEqual(['s1.level0', 's1.level1'])
    for (const [object, c] of [
      ['s1.level0', 1],
      ['s1.level1', 4],
    ] as const) {
      const lines = polylines(byObject(result, object))
      expect(lines).toHaveLength(1)
      const [line] = lines
      expect(line.length).toBeGreaterThan(20)
      expect(line[0]).toEqual(line[line.length - 1])
      for (const v of line) expect(v[2]).toBe(c)
    }
  })

  it('puts every vertex on the circle of radius 1 or 2 within 1e-8 (bisection on the true f)', () => {
    // Linear interpolation on the 160-cell grid over [-5, 5]^2 (cell 1/16)
    // is off by ~1e-3 here; only the bisection reaches 1e-8.
    for (const [object, r] of [
      ['s1.level0', 1],
      ['s1.level1', 2],
    ] as const) {
      for (const [x, y] of polylines(byObject(result, object))[0]) expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThanOrEqual(1e-8)
    }
  })

  it('has no labels and no floor copies unless asked', () => {
    expect(result.labels).toEqual([])
  })
})

describe('contourCurves with floor', () => {
  it('adds a dashed 1 px copy of each level at the box floor', () => {
    // With nothing else drawn the box is [-5, 5]^3 (the box pass, J1), so
    // the floor is -5.
    const result = contour('x^2 + y^2 - 3', list('1', '6'), { floor: true })
    expect(result.marks.map((m) => m.source.object)).toEqual(['s1.level0', 's1.floor0', 's1.level1', 's1.floor1'])
    for (const [object, r] of [
      ['s1.floor0', 2],
      ['s1.floor1', 3],
    ] as const) {
      const mark = byObject(result, object)
      expect(mark.style.width).toBe(1)
      expect(mark.style.dash).not.toBeNull()
      for (const [x, y, z] of polylines(mark)[0]) {
        expect(z).toBe(-5)
        expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThanOrEqual(1e-8)
      }
    }
  })

  it('uses an authored @bounds3d z as the floor', () => {
    const result = contour('x^2 + y^2', list('1'), { floor: true, spec: '@bounds3d: z [-2, 6]' })
    for (const v of polylines(byObject(result, 's1.floor0'))[0]) expect(v[2]).toBe(-2)
  })
})

describe('contourCurves with labels', () => {
  it('puts one value label per level on its curve, at z = c', () => {
    const result = contour('x^2 + y^2', list('1', '4'), { labels: true })
    expect(result.labels.map((l) => [l.source.object, l.text])).toEqual([
      ['s1.label0', '1'],
      ['s1.label1', '4'],
    ])
    for (const [label, r, c] of [
      [result.labels[0], 1, 1],
      [result.labels[1], 2, 4],
    ] as const) {
      expect(Math.abs(Math.hypot(label.position[0], label.position[1]) - r)).toBeLessThanOrEqual(1e-8)
      expect(label.position[2]).toBe(c)
    }
  })
})

describe('contourCurves levels n', () => {
  it('levels 4 on x^2 - y^2 over [-2, 2]^2: range [-4, 4], niceStep(8, 4) = 2, strictly inside: -2, 0, 2', () => {
    const result = contour('x^2 - y^2', { kind: 'count', count: 4 }, { spec: '@bounds3d: x [-2, 2], y [-2, 2]' })
    expect(result.errors).toEqual([])
    const levels = result.marks.map((m) => (m.kind === 'lines' ? m.positions[2] : NaN))
    expect(levels).toEqual([-2, 0, 2])
    for (const mark of result.marks) {
      if (mark.kind !== 'lines') continue
      for (let v = 0; v < mark.positions.length / 3; v++) {
        const [x, y, z] = [mark.positions[3 * v], mark.positions[3 * v + 1], mark.positions[3 * v + 2]]
        expect(Math.abs(x * x - y * y - z)).toBeLessThanOrEqual(1e-8)
      }
    }
  })

  it('niceLevels keeps the correctly rounded multiples: (0, 1) at 10 is 0.1, 0.2, …, 0.9', () => {
    expect(niceLevels(-4, 4, 4)).toEqual([-2, 0, 2])
    expect(niceLevels(0, 1, 10)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    expect(niceLevels(1, 1, 5)).toEqual([])
  })
})

describe('contourCurves colours', () => {
  it("colours each level by its value on the spec's colormap: the ends of viridis at the ends of the height domain", () => {
    // @bounds3d z [-2, 2] is the height scale's domain: -2 is t = 0, 2 is t = 1.
    const result = contour('x + y', list('-2', '2'), { spec: '@bounds3d: z [-2, 2]' })
    expect(result.marks.map((m) => (m.kind === 'lines' ? m.style.color.author : null))).toEqual(['#440154', '#fde725'])
  })

  it('draws every level in the flat colour color: gives', () => {
    const result = contour('x + y', list('-2', '2'), { spec: '@bounds3d: z [-2, 2]', color: 'red' })
    expect(result.marks.map((m) => (m.kind === 'lines' ? m.style.color.author : null))).toEqual(['red', 'red'])
  })
})

describe('contourCurves refusals', () => {
  it('refuses a target of three variables (a level surface, S4a)', () => {
    expect(() => contour('x^2 + y^2 + z^2', list('1'))).toThrow(/function of x and y/)
  })
})

describe('levelCurves', () => {
  it('returns nothing for a level the function never takes', () => {
    expect(levelCurves((x, y) => x * x + y * y + 1, { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } }, 20)).toEqual([])
  })
})

// Integration J2: S4a's contour: grammar and dispatcher reach contourCurves
// for a target of two variables; three still draw level surfaces.
describe('contour: of two variables, through the grammar, draws level curves', () => {
  it('f(x, y) = x^2 + y^2, contour: f levels 1, 4: circles of radii 1 and 2 at z = 1 and z = 4, within 1e-8', () => {
    const scene = sceneOf('f(x, y) = x^2 + y^2\ncontour: f levels 1, 4')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => [m.source.object, m.kind])).toEqual([
      ['s2.level0', 'lines'],
      ['s2.level1', 'lines'],
    ])
    for (const [object, r, c] of [
      ['s2.level0', 1, 1],
      ['s2.level1', 2, 4],
    ] as const) {
      const lines = polylines(lineOf(scene, object))
      expect(lines).toHaveLength(1)
      for (const [x, y, z] of lines[0]) {
        expect(z).toBe(c)
        expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThanOrEqual(1e-8)
      }
    }
  })

  it('an inline expression without z has two variables: levels 4 of x^2 - y^2 on [-2, 2]^2 are -2, 0, 2', () => {
    // range [-4, 4]; niceStep(8, 4) = 2; strictly inside: -2, 0, 2.
    const scene = sceneOf('@bounds3d: x [-2, 2], y [-2, 2]\ncontour: x^2 - y^2 levels 4')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => (m.kind === 'lines' ? m.positions[2] : NaN))).toEqual([-2, 0, 2])
  })

  it('the contour example: levels 9 of x^2 - y^2 on [-2, 2]^2 are -3..3, each on the surface, on the floor z = -4, and labelled', () => {
    // range [-4, 4]; niceStep(8, 9) = 1; strictly inside: -3, -2, ..., 3.
    // The surface's box: z from f's range [-4, 4], rounded out by
    // niceStep(8, 8) = 1, so the floor is -4.
    const scene = sceneOf(`@bounds3d: x [-2, 2], y [-2, 2]
f(x, y) = x^2 - y^2
z = f(x, y) opacity: 0.5
contour: f levels 9 floor labels`)
    expect(scene.errors).toEqual([])
    const levels = [-3, -2, -1, 0, 1, 2, 3]
    levels.forEach((c, k) => {
      for (const [x, y, z] of polylines(lineOf(scene, `s4.level${k}`)).flat()) {
        expect(z).toBe(c)
        expect(Math.abs(x * x - y * y - c)).toBeLessThanOrEqual(1e-8)
      }
      const floor = lineOf(scene, `s4.floor${k}`)
      expect(floor.style.dash).not.toBeNull()
      for (const [, , z] of polylines(floor).flat()) expect(z).toBe(-4)
    })
    expect(scene.labels.map((l) => l.text)).toEqual(levels.map(String).map((t) => t.replace('-', '−')))
  })

  it('dashed dashes the level curves; opacity: is refused, since it applies to level surfaces', () => {
    const scene = sceneOf('contour: x^2 + y^2 levels 1, 4 dashed')
    expect(scene.errors).toEqual([])
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.level0', 's1.level1'])
    for (const object of ['s1.level0', 's1.level1']) expect(lineOf(scene, object).style.dash).not.toBeNull()
    expect(sceneOf('f(x, y) = x^2 + y^2\ncontour: f levels 1, 4 opacity: 0.5').errors).toEqual([
      { line: 2, message: 'opacity: applies to level surfaces of F(x, y, z), not to level curves — f has two variables' },
    ])
  })

  it('a one-variable function is still refused in S4a’s words', () => {
    expect(sceneOf('k(t) = t^2\ncontour: k levels 3').errors[0].message).toMatch(/k takes 1 variable/)
  })
})

// Fix round 1 (Important 2): a level that draws nothing says so on its line,
// in S4a's words for a level surface ("The level 100 of g does not meet the
// box"); f = x^2 + y^2 over [-5, 5]^2 ranges over [0, 50].
describe('contour: of two variables, levels that draw nothing', () => {
  const F = 'f(x, y) = x^2 + y^2'

  it('an authored level outside f’s range is an error on its line; the others still draw', () => {
    const lone = sceneOf(`${F}\ncontour: f level 100`)
    expect(lone.errors).toEqual([{ line: 2, message: 'The level 100 of f does not meet the domain' }])
    expect(lone.marks).toEqual([])
    const mixed = sceneOf(`${F}\ncontour: f levels 4, 100, -1`)
    expect(mixed.errors).toEqual([
      { line: 2, message: 'The level 100 of f does not meet the domain' },
      { line: 2, message: 'The level −1 of f does not meet the domain' },
    ])
    expect(mixed.marks.map((m) => m.source.object)).toEqual(['s2.level0'])
  })

  it('so is a level from a..b step s, and a level read from a parameter, until it moves inside', () => {
    expect(sceneOf(`${F}\ncontour: f levels 60..70 step 10`).errors).toEqual([
      { line: 2, message: 'The level 60 of f does not meet the domain' },
      { line: 2, message: 'The level 70 of f does not meet the domain' },
    ])
    const kernel = kernelOf(`@param c = 100 range [0, 200]\n${F}\ncontour: f level c`)
    expect(kernel.scene().errors).toEqual([{ line: 3, message: 'The level 100 of f does not meet the domain' }])
    const moved = kernel.setValue('c', 4)
    expect(moved.errors).toEqual([])
    for (const [x, y] of polylines(lineOf(moved, 's3.level0'))[0]) expect(Math.abs(Math.hypot(x, y) - 2)).toBeLessThanOrEqual(1e-8)
  })

  it('a constant target has no level curves: contour: a levels 1, a a parameter, says so', () => {
    expect(sceneOf('@param a = 1 range [0, 5]\ncontour: a levels 1').errors).toEqual([
      { line: 2, message: 'contour: a is constant over the domain — it has no level curves' },
    ])
    expect(sceneOf('@param a = 1 range [0, 5]\ncontour: a level 1').errors).toEqual([
      { line: 2, message: 'contour: a is constant over the domain — it has no level curves' },
    ])
  })

  it('an inverted range, levels 10..5 step 1, is refused as S4a refuses it, not as "no nice level"', () => {
    expect(sceneOf(`${F}\ncontour: f levels 10..5 step 1`).errors).toEqual([{ line: 2, message: '"levels a..b" needs a ≤ b, got 10..5' }])
    expect(sceneOf(`${F}\ncontour: f levels 1..5 step 0`).errors).toEqual([
      { line: 2, message: 'The step of "levels a..b step s" must be positive, got 0' },
    ])
  })

  it('a target with no finite value over the domain says so', () => {
    expect(sceneOf('contour: sqrt(-1 - x^2) levels 3').errors).toEqual([
      { line: 1, message: 'contour: sqrt(-1 - x^2) has no finite value over the domain' },
    ])
  })

  it('"levels n" with no nice value strictly inside the range asks for a list, as S4a does', () => {
    // x over [0.1, 0.9]: niceStep(0.8, 1) = 1, and no multiple of 1 lies in (0.1, 0.9).
    expect(sceneOf('@bounds3d: x [0.1, 0.9]\ncontour: x levels 1').errors).toEqual([
      { line: 2, message: 'contour: x has no nice level inside its range — list its levels' },
    ])
  })
})
