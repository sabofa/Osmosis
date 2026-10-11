import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import type { BuildContext } from '../registry'
import * as box from './box'

function context(spec: string): BuildContext {
  const parsed = parseSpec(spec)
  return {
    scope: { functions: new Map(), params: { index: new Map(), values: new Float64Array(0) }, angle: 'radians' },
    config: parsed.config,
    line: 1,
    source: { line: 1, statement: null, object: 's1' },
    color: { author: null, slot: 0 },
    colorScaleId: null,
    named: new Map(),
  }
}

describe('clipToZ', () => {
  it('cuts a polyline exactly where it leaves the z range, interpolating the parameter', () => {
    // z runs 0, 2, 4 at t = 0, 1, 2; the range [1, 3] is entered at t = 0.5
    // and left at t = 1.5.
    const out = box.clipToZ([[0, 0, 0, 1, 0, 2, 2, 0, 4]], [[0, 1, 2]], { min: 1, max: 3 })
    expect(out).toEqual({ runs: [[0.5, 0, 1, 1, 0, 2, 1.5, 0, 3]], params: [[0.5, 1, 1.5]] })
  })

  it('splits a polyline that leaves and comes back into two', () => {
    const out = box.clipToZ([[0, 0, 0, 1, 0, 4, 2, 0, 0]], [[0, 1, 2]], { min: -1, max: 2 })
    expect(out).toEqual({ runs: [[0, 0, 0, 0.5, 0, 2], [1.5, 0, 2, 2, 0, 0]], params: [[0, 0.5], [1.5, 2]] })
  })
})

// Since the box pass (integration J1) a tool no longer estimates the box: the
// kernel resolves it from the other statements and hands it over. The
// estimate's own tests went with it; kernel/boxPass.test.ts has what replaced
// them.
describe('toolBox: the tool’s domain in x and y, the box the kernel resolved in z (J1)', () => {
  const resolved = { x: { min: -1, max: 2 }, y: { min: -1, max: 1 }, z: { min: -1, max: 4 } }

  it('is the only box box.ts exports: the rect’s x and y, context.box’s z', () => {
    expect(Object.keys(box).filter((k) => /Box$/.test(k))).toEqual(['toolBox'])
    const rect = { x: { min: 0, max: 1 }, y: { min: 0, max: 0.5 } }
    expect(box.toolBox({ ...context(''), box: resolved }, rect)).toEqual({ x: rect.x, y: rect.y, z: resolved.z })
  })

  it('refuses to guess: without the kernel’s box it throws, naming the line', () => {
    expect(() => box.toolBox(context(''), resolved)).toThrow("internal: line 1 needs the scene's box, and it was built without one")
  })
})
