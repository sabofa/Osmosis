import { afterEach, describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from './index'
import { POINT } from './primitives'
import { registerBuilder } from './registry'

// Counts the point builder's builds: registered over the real one for each
// test, and the real one put back after.
let builds = 0
function countPointBuilds(): void {
  builds = 0
  registerBuilder('point', {
    ...POINT,
    prepare: (statement, context) => {
      const prepared = POINT.prepare(statement, context)
      return {
        reads: prepared.reads,
        build: () => {
          builds++
          return prepared.build()
        },
      }
    },
  })
}

afterEach(() => {
  registerBuilder('point', POINT)
})

function kernel() {
  const parsed = parseSpec('@param a = 0 range [-3, 3]\n@param b = 0 range [-3, 3]\nP = (a, b, a^2 + b^2)\nQ = (1, 1, 1)')
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

describe('SpaceKernel.setValues', () => {
  it('rebuilds a statement that reads two changed bindings once, not once per binding', () => {
    countPointBuilds()
    const k = kernel()
    // P and Q each built once.
    expect(builds).toBe(2)
    const scene = k.setValues(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
    )
    // Only P reads a or b: one rebuild.
    expect(builds).toBe(3)
    const p = scene.marks.find((m) => m.kind === 'points' && m.source.line === 3)!
    expect(p.kind === 'points' && Array.from(p.positions)).toEqual([1, 2, 5])
    expect([k.values().get('a'), k.values().get('b')]).toEqual([1, 2])
  })

  it('clamps and ignores as setValue does, and returns the same scene when nothing changes', () => {
    countPointBuilds()
    const k = kernel()
    const before = k.scene()
    expect(k.setValues(new Map([['a', 0]]))).toBe(before)
    expect(k.setValues(new Map([['nope', 1]]))).toBe(before)
    expect(k.setValues(new Map([['a', Number.NaN]]))).toBe(before)
    expect(builds).toBe(2)
    k.setValues(new Map([['a', 9]]))
    expect(k.values().get('a')).toBe(3)
  })
})
