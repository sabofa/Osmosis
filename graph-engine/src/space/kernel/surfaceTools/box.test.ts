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
  }
}

const RECT = { x: { min: -5, max: 5 }, y: { min: -5, max: 5 } }

describe('toolBox: the one box estimate every surface tool calls (the seam for the two-pass kernel)', () => {
  it('is the only box estimate box.ts exports', () => {
    expect(Object.keys(box).filter((k) => /Box$/.test(k))).toEqual(['toolBox'])
  })

  it('takes an authored @bounds3d z as written', () => {
    expect(box.toolBox(context('@bounds3d: z [-2, 6]'), RECT, (x, y) => x * x + y * y).z).toEqual({ min: -2, max: 6 })
  })

  it("otherwise rounds the target's range out as the frame does: x^2 - y^2 - 3 spans [-28, 22], step 5, so [-30, 25]", () => {
    expect(box.toolBox(context(''), RECT, (x, y) => x * x - y * y - 3)).toEqual({ x: RECT.x, y: RECT.y, z: { min: -30, max: 25 } })
  })

  it('gives a three-variable target (null) the region an implicit surface samples: [-5, 5], whatever the x/y domain', () => {
    // A flat two-variable estimate over [-2, 2]^2 would widen to [-2, 2].
    const small = { x: { min: -2, max: 2 }, y: { min: -2, max: 2 } }
    expect(box.toolBox(context('@bounds3d: x [-2, 2], y [-2, 2]'), small, null).z).toEqual({ min: -5, max: 5 })
  })
})
