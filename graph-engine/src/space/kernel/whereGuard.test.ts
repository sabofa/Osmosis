// Item 1 of space's side of the calc track's math and parser extensions: an "if"
// clause the old shape cannot say rides on `where` (calc P1, parser/types.ts),
// which a 3D scene does not read yet. Every expected number is worked by hand
// in a comment beside it.

import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import type { Statement } from '../../parser/types'
import type { LineMark } from '../scene/types'
import { markNamed, sceneOf } from './integrals/testing'

function statementsOf(spec: string): Statement[] {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return parsed.statements
}

const WHERE_REFUSED = "this condition isn't supported in a 3D scene yet"

describe('an "if" clause that rides on where is refused in a 3D scene (item 1)', () => {
  it('premise: the shared parser puts and/or/!=, other-variable and implicit conditions on where, and an old-shape clause on condition', () => {
    const where = (spec: string) => (statementsOf(spec)[0] as { where?: unknown }).where
    expect(where('y = x^2 if x > 0 and x < 1')).toBeDefined()
    expect(where('x = y^2 if y > 0 or y < -1')).toBeDefined()
    expect(where('y = x^2 if x != 2')).toBeDefined()
    expect(where('y = x^2 if y > 1')).toBeDefined()
    expect(where('x^2 + y^2 = 1 if x > 0')).toBeDefined()
    expect(where('x^2 + y^2 < 4 if x > 0')).toBeDefined()
    expect(where('0 < x^2 + y^2 < 4 if x > 0')).toBeDefined()
    const old = statementsOf('y = x^2 if 0 < x < 1')[0] as { where?: unknown; condition: { kind: string } | null }
    expect(old.where).toBeUndefined()
    expect(old.condition?.kind).toBe('range')
  })

  it('y = x^2 if x > 0 and x < 1 is an error on its line, and draws nothing', () => {
    const scene = sceneOf('A = (0, 0, 1)\ny = x^2 if x > 0 and x < 1')
    expect(scene.errors).toEqual([{ line: 2, message: WHERE_REFUSED }])
    expect(scene.marks.map((m) => m.kind)).toEqual(['points'])
  })

  it('so is x = f(y) with an or, a != and a condition on the other variable', () => {
    for (const line of ['x = y^2 if y > 0 or y < -1', 'y = x^2 if x != 2', 'y = x^2 if y > 1']) {
      const scene = sceneOf(`A = (0, 0, 1)\n${line}`)
      expect(scene.errors, line).toEqual([{ line: 2, message: WHERE_REFUSED }])
      expect(scene.marks.map((m) => m.kind), line).toEqual(['points'])
    }
  })

  it('a lifted implicit curve with an if clause is refused, and without one it still draws', () => {
    const refused = sceneOf('A = (0, 0, 1)\nx^2 + y^2 = 1 if x > 0')
    expect(refused.errors).toEqual([{ line: 2, message: WHERE_REFUSED }])
    expect(refused.marks.map((m) => m.kind)).toEqual(['points'])
    const plain = sceneOf('x^2 + y^2 = 1')
    expect(plain.errors).toEqual([])
    expect(plain.marks.map((m) => m.kind)).toEqual(['lines'])
  })

  it('a region line with an if clause is an error on its line and draws nothing (no 3D builder takes one)', () => {
    for (const line of ['x^2 + y^2 < 4 if x > 0', '0 < x^2 + y^2 < 4 if x > 0']) {
      const scene = sceneOf(`A = (0, 0, 1)\n${line}`)
      expect(scene.errors, line).toHaveLength(1)
      expect(scene.errors[0].line).toBe(2)
      expect(scene.marks.map((m) => m.kind), line).toEqual(['points'])
    }
  })

  it('a refused statement does not blank the scene: the rest still builds', () => {
    const scene = sceneOf('y = x^2 if x > 0 and x < 1\nz = x + y for x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([{ line: 1, message: WHERE_REFUSED }])
    expect(scene.marks.map((m) => m.kind)).toEqual(['mesh'])
  })

  it('an old-shape y = x^2 if 0 < x < 1 lifts as it always did: the samples strictly inside (0, 1), on z = 0', () => {
    const scene = sceneOf('y = x^2 if 0 < x < 1')
    expect(scene.errors).toEqual([])
    const line = markNamed(scene, 's1', 'lines') as LineMark
    // x runs over the box's [-5, 5] in 512 steps: t_i = -5 + 10 i / 512. t_256 = 0
    // is excluded (strict), 257 is the first inside and 307 the last (t_307 =
    // 0.99609, t_308 = 1.01563): 51 points in one run.
    const expected: number[] = []
    for (let i = 257; i <= 307; i++) {
      const t = -5 + (10 * i) / 512
      expected.push(t, t * t, 0)
    }
    expect([...line.starts]).toEqual([0])
    expect(line.positions.length).toBe(expected.length)
    for (let k = 0; k < expected.length; k++) expect(line.positions[k]).toBeCloseTo(expected[k], 12)
  })
})
