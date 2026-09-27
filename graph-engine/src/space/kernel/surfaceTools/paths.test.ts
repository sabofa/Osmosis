import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import { resolveBox } from '../../frame/bounds'
import type { SpaceScene } from '../../scene/types'
import { approachSide } from './paths'
import { expectClose, kernelOf, labelOf, lineOf, pointsOf, sceneOf, vertices } from './testing'

// The box the frame draws for a scene: what a reader sees stretch.
function frameZ(spec: string, scene: SpaceScene) {
  return resolveBox(parseSpec(spec).config.space, scene.extent).z
}

// f = xy / (x^2 + y^2) has no limit at the origin: 1/2 along y = x, 0 along
// y = 0 (OpenStax 4.2).
const F = 'x*y/(x^2 + y^2)'

describe('path: on xy/(x^2 + y^2) along (t, t) for t in [0, 1] toward (0, 0)', () => {
  // Beside its surface, which sizes the box (the box pass, J1), written after
  // the tool so the tool keeps line 1.
  const scene = sceneOf(`path: on ${F} along (t, t) for t in [0, 1] toward (0, 0)\nz = ${F}`)

  it('lifts the curve onto the surface: every vertex is (t, t, 1/2)', () => {
    expect(scene.errors).toEqual([])
    const curve = lineOf(scene, 's1')
    const points = vertices(curve.positions)
    // t = 0 is 0/0, dropped: 512 segments leave 512 vertices.
    expect(points).toHaveLength(512)
    for (const [i, [x, y, z]] of points.entries()) {
      expect(x).toBe(curve.params![i])
      expect(y).toBe(x)
      expect(Math.abs(z - 0.5)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('carries a pick with r and its symbolic derivative', () => {
    const pick = lineOf(scene, 's1').pick!
    expect(pick.param).toBe('t')
    expectClose(pick.r(0.5), [0.5, 0.5, 0.5])
    // d/dt (t, t, t^2 / (2 t^2)) = (1, 1, 0)
    expectClose(pick.dr(0.5), [1, 1, 0])
  })

  it('shadows it on the box floor, dashed: the range [-1/2, 1/2] rounds out to itself (step 0.1), so z = -1/2', () => {
    const shadow = lineOf(scene, 's1.shadow')
    expect(shadow.style.dash).not.toBeNull()
    for (const [x, y, z] of vertices(shadow.positions)) {
      expect(y).toBe(x)
      expect(z).toBe(-0.5)
    }
  })

  it('marks (0, 0) on the floor, and rings where the path is heading: f → ≈ 0.5', () => {
    expectClose(Array.from(pointsOf(scene, 's1.toward').positions), [0, 0, -0.5])
    const ring = pointsOf(scene, 's1.limit')
    expect(ring.style.shape).toBe('ring')
    expectClose(Array.from(ring.positions), [0, 0, 0.5])
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0.5')
  })
})

describe('the same surface along (t, 0)', () => {
  it('heads to 0, which is where the two paths disagree', () => {
    const scene = sceneOf(`path: on ${F} along (t, 0) for t in [0, 1] toward (0, 0)`)
    for (const [, , z] of vertices(lineOf(scene, 's1').positions)) expect(z).toBe(0)
    expectClose(Array.from(pointsOf(scene, 's1.limit').positions), [0, 0, 0])
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0')
  })

  it('approaches whichever end is nearer the target: x + y along (t, t), t in [0, 1], toward (1, 1) heads to 2, not to 0', () => {
    // The last approach is t = 1 - 1e-8, where x + y = 2 - 2e-8.
    const scene = sceneOf(`path: on x + y along (t, t) for t in [0, 1] toward (1, 1)`)
    expectClose(Array.from(pointsOf(scene, 's1.limit').positions), [1, 1, 2], 1e-7)
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 2')
  })
})

describe('the limit along a path: both sides, errors, and what is not a limit', () => {
  it('x + y along (t, t), t in [-1, 1], toward (0, 0): the target is inside the path, not at an end — f → ≈ 0 from both sides', () => {
    const scene = sceneOf('path: on x + y along (t, t) for t in [-1, 1] toward (0, 0)')
    expect(scene.errors).toEqual([])
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0')
    const ring = vertices(pointsOf(scene, 's1.limit').positions)
    expect(ring).toHaveLength(1)
    expect(Math.abs(ring[0][2])).toBeLessThanOrEqual(1e-7)
  })

  it('(1 - cos x)/x^2 along (t, 0): 1/2, though rounding makes the smallest step read 0', () => {
    // 1 - cos(1e-8) is 0 in doubles: the last approach value is 0, and the
    // estimate is where successive values agree best.
    const scene = sceneOf('path: on (1 - cos(x))/x^2 along (t, 0) for t in [0, 1] toward (0, 0)')
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ 0.5')
    expect(Math.abs(vertices(pointsOf(scene, 's1.limit').positions)[0][2] - 0.5)).toBeLessThanOrEqual(1e-6)
  })

  it('xy/(x^2 + y^2) along (t, |t|): -1/2 before the origin and 1/2 after it, so no limit along this path', () => {
    const scene = sceneOf('path: on x*y/(x^2 + y^2) along (t, abs(t)) for t in [-1, 1] toward (0, 0)')
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f → ≈ −0.5 before (0, 0) and ≈ 0.5 after it: no limit along this path')
    expect(vertices(pointsOf(scene, 's1.limit').positions).map((v) => v[2])).toEqual([-0.5, 0.5])
  })

  it('finds the parameter off the sample grid: (t, t^2) reaches (1/3, 1/9) at t = 1/3, where x + y → 4/9', () => {
    const scene = sceneOf('path: on x + y along (t, t^2) for t in [-1, 1] toward (1/3, 1/9)')
    expect(scene.errors).toEqual([])
    expect(labelOf(scene, 's1.readout').text).toMatch(/^along this path, f → ≈ 0\.4444/)
  })

  it('refuses a target the path does not reach, on its line, and still draws the path', () => {
    // (t, t + 1) for t in [0, 1] comes nearest (0, 0) at t = 0, at (0, 1).
    const scene = sceneOf('path: on x*y along (t, t + 1) for t in [0, 1] toward (0, 0)')
    expect(scene.errors).toEqual([{ line: 1, message: 'path: the path does not reach (0, 0): its nearest point is (0, 1), at t = 0' }])
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1', 's1.shadow'])
  })

  it('sin(1/x) along (t, 0) does not settle', () => {
    const scene = sceneOf('path: on sin(1/x) along (t, 0) for t in [0, 1] toward (0, 0)')
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f does not settle near (0, 0)')
    expect(scene.marks.some((m) => m.source.object === 's1.limit')).toBe(false)
  })

  it('cos(1/x)/x^2 swings in sign as it grows: it grows without bound, with no number', () => {
    // f at h = 1e-2 .. 1e-8: 8623, 562379, -9.5e7, -1.0e10, 9.4e11, -9.1e13,
    // -3.6e15 (it read ≈ 6×10⁵).
    const scene = sceneOf('path: on cos(1/x)/x^2 along (t, 0) for t in [0, 1] toward (0, 0)')
    expect(labelOf(scene, 's1.readout').text).toBe('f grows without bound along this path')
    expect(scene.marks.some((m) => m.source.object === 's1.limit')).toBe(false)
  })

  it('sin(1/x)/x swings and grows unevenly: it does not settle, with no number', () => {
    // f at h = 1e-2 .. 1e-8: -50.6, 827, -3056, 3574, ... (it read ≈ 0).
    const scene = sceneOf('path: on sin(1/x)/x along (t, 0) for t in [0, 1] toward (0, 0)')
    expect(labelOf(scene, 's1.readout').text).toBe('along this path, f does not settle near (0, 0)')
    expect(scene.marks.some((m) => m.source.object === 's1.limit')).toBe(false)
  })

  it('(1 - cos x)/x^2 - 1/2 → ≈ 0, though its rounding tail grows to 0.5', () => {
    expect(labelOf(sceneOf('path: on (1 - cos(x))/x^2 - 1/2 along (t, 0) for t in [0, 1] toward (0, 0)'), 's1.readout').text).toBe(
      'along this path, f → ≈ 0'
    )
  })
})

describe('a path through a pole (I3)', () => {
  const SURFACE = 'z = 1/(x^2 + y^2)'
  const SPEC = `${SURFACE}
path: on 1/(x^2 + y^2) along (t, t) for t in [0, 1] toward (0, 0)`

  it('reads "f grows without bound along this path", and draws no ring', () => {
    const scene = sceneOf(SPEC)
    expect(labelOf(scene, 's2.readout').text).toBe('f grows without bound along this path')
    expect(scene.marks.some((m) => m.source.object === 's2.limit')).toBe(false)
  })

  it('leaves the frame as the surface alone makes it: the curve is cut where it leaves the box', () => {
    const alone = frameZ(SURFACE, sceneOf(SURFACE))
    expect(frameZ(SPEC, sceneOf(SPEC))).toEqual(alone)
    for (const [, , z] of vertices(lineOf(sceneOf(SPEC), 's2').positions)) expect(z).toBeLessThanOrEqual(alone.max)
  })
})

describe('approachSide', () => {
  it('a constant is its own value, with no error', () => {
    expect(approachSide([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])).toEqual({ kind: 'value', value: 0.5, error: 0 })
  })

  it('takes the value where successive values differ least, not the last', () => {
    // differences 0.1, 0.001, 0.2, 0.3: the least is between the 2nd and 3rd
    expect(approachSide([1.1, 1.0, 1.001, 1.201, 1.501])).toEqual({ kind: 'value', value: 1.001, error: expect.closeTo(0.001, 12) })
  })

  it('|f| growing twofold at every step is unbounded whatever the sign: cos(1/x)/x^2 at h = 1e-2 .. 1e-8', () => {
    expect(approachSide([8623, 562379, -9.5e7, -1.0e10, 9.4e11, -9.1e13, -3.6e15])).toEqual({ kind: 'unbounded' })
  })

  it('a tail that grows only after shrinking is rounding, not divergence: (1 - cos x)/x^2 - 1/2 reads ≈ 0', () => {
    const side = approachSide([-4.2e-6, -4.2e-8, 1e-8, 1e-6, 1e-4, 0.02, -0.5])
    expect(side.kind).toBe('value')
  })

  it('differences that grow before one small one do not settle: 1, 2, 4, 8, 8.0001', () => {
    // differences 1, 2, 4, 0.0001: the smallest comes after growth
    expect(approachSide([1, 2, 4, 8, 8.0001])).toEqual({ kind: 'unsettled' })
  })

  it('growth of at least twofold, one sign, over each of the last three steps is unbounded; zeros are not', () => {
    expect(approachSide([1, 10, 100, 1000, 10000])).toEqual({ kind: 'unbounded' })
    expect(approachSide([-1, -10, -100, -1000])).toEqual({ kind: 'unbounded' })
    expect(approachSide([0, 0, 0, 0, 0])).toEqual({ kind: 'value', value: 0, error: 0 })
  })

  it('values whose differences never shrink below a tenth of the largest do not settle', () => {
    expect(approachSide([1, -1, 1, -1, 1])).toEqual({ kind: 'unsettled' })
  })

  it('fewer than three finite values is undefined', () => {
    expect(approachSide([Number.NaN, 1, Number.NaN, 2])).toEqual({ kind: 'undefined' })
  })
})

describe('path: on a defined f, with a parameter', () => {
  it('reads f(x, y), and rebuilds when the parameter moves', () => {
    const kernel = kernelOf(`@param k = 1 range [0, 2]
f(x, y) = x*y
path: on f along (t, k*t) for t in [0, 1]`)
    const at = (scene: ReturnType<typeof kernel.scene>) => vertices(lineOf(scene, 's3').positions)
    for (const [x, , z] of at(kernel.scene())) expect(Math.abs(z - x * x)).toBeLessThanOrEqual(1e-15)
    const moved = kernel.setValue('k', 2)
    expect(moved.errors).toEqual([])
    for (const [x, y, z] of at(moved)) {
      expect(y).toBe(2 * x)
      expect(Math.abs(z - 2 * x * x)).toBeLessThanOrEqual(1e-15)
    }
  })
})

describe('path: refusals', () => {
  it('refuses a target of three variables, on its line', () => {
    const scene = sceneOf(`z = x
path: on x*y*z along (t, t) for t in [0, 1]`)
    expect(scene.errors).toEqual([{ line: 2, message: 'path: needs a function of x and y, and this one reads z' }])
  })

  it('refuses a one-variable function by name', () => {
    const scene = sceneOf(`g(x) = x^2
path: on g along (t, t) for t in [0, 1]`)
    expect(scene.errors.map((e) => e.message)).toEqual(['"g" is a function of one variable — path: needs a function of x and y, e.g. "g(x, y) = …"'])
  })
})
