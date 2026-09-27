import { describe, expect, it } from 'vitest'
import type { ArrowMark, LineMark, PointMark, SpaceScene } from '../../scene/types'
import { kernelOf, labelText, markAt, sceneOf, vertexOf, vertices } from '../../testing/kernel'
import { curveFrame } from './frames'

const HELIX = 'r(t) = <cos(t), sin(t), t>'
const S2 = Math.SQRT1_2

function clean(spec: string): SpaceScene {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  return scene
}

function close(actual: readonly number[], expected: readonly number[], digits = 12) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i], digits))
}

describe('curveFrame', () => {
  it('the helix <cos t, sin t, t> at t = 0: T, N, B and kappa', () => {
    // r' = (-sin 0, cos 0, 1) = (0, 1, 1), so T = (0, 1, 1)/sqrt 2;
    // r'' = (-cos 0, -sin 0, 0) = (-1, 0, 0); r''.T = 0, so N = (-1, 0, 0);
    // B = T x N = (1/sqrt2 * 0 - 1/sqrt2 * 0, 1/sqrt2 * (-1) - 0 * 0, 0 * 0 - 1/sqrt2 * (-1)) = (0, -1, 1)/sqrt 2;
    // kappa = |r' x r''| / |r'|^3 = |(0, -1, 1)| / (sqrt 2)^3 = sqrt 2 / (2 sqrt 2) = 1/2.
    const f = curveFrame([0, 1, 1], [-1, 0, 0])
    close(f.T, [0, S2, S2], 15)
    close(f.N!, [-1, 0, 0], 15)
    close(f.B!, [0, -S2, S2], 15)
    expect(f.kappa).toBeCloseTo(0.5, 15)
  })

  it('removes the tangential part of r\'\' from N: <t, t^2, 0> at t = 1', () => {
    // r' = (1, 2, 0), r'' = (0, 2, 0). T = (1, 2, 0)/sqrt 5; r''.T = 4/sqrt 5;
    // r'' - (r''.T) T = (0, 2, 0) - (4/5)(1, 2, 0) = (-4/5, 2/5, 0), of length 2/sqrt 5,
    // so N = (-4/5, 2/5, 0) * sqrt 5 / 2 = (-2, 1, 0)/sqrt 5. (r''/|r''| = (0, 1, 0) is wrong.)
    // kappa = |(1, 2, 0) x (0, 2, 0)| / 5^(3/2) = 2 / (5 sqrt 5).
    const f = curveFrame([1, 2, 0], [0, 2, 0])
    const s5 = Math.sqrt(5)
    close(f.N!, [-2 / s5, 1 / s5, 0], 15)
    close(f.B!, [0, 0, 1], 15)
    expect(f.kappa).toBeCloseTo(2 / (5 * s5), 15)
  })

  it('a straight line has kappa = 0 and no N or B', () => {
    const f = curveFrame([1, 2, 3], [0, 0, 0])
    expect(f.kappa).toBe(0)
    expect(f.N).toBeNull()
    expect(f.B).toBeNull()
  })
})

describe('frame:', () => {
  it('draws T, N and B from r(t) as arrows of length 0.18 x the largest box span, labelled, with the point', () => {
    const scene = clean(`${HELIX}\nframe: r at t = 0`)
    const arrows = markAt(scene, 's2') as ArrowMark
    const L = 0.18 * 10
    expect(vertices(arrows.tails)).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ])
    const [T, N, B] = vertices(arrows.vectors)
    close(T, [0, S2 * L, S2 * L])
    close(N, [-L, 0, 0])
    close(B, [0, -S2 * L, S2 * L])
    expect([...(markAt(scene, 's2.point') as PointMark).positions]).toEqual([1, 0, 0])
    expect(labelText(scene)).toEqual(['T', 'N', 'B'])
    close(scene.labels[1].position, [1 - L, 0, 0])
  })

  it("draws N without the tangential part of r'' on <t, t^2, 0> at t = 1: N = (-2, 1, 0)/sqrt 5", () => {
    const scene = clean('r(t) = <t, t^2, 0>\nframe: r at t = 1')
    const [, N] = vertices((markAt(scene, 's2') as ArrowMark).vectors)
    close(N, [(-2 / Math.sqrt(5)) * 1.8, (1 / Math.sqrt(5)) * 1.8, 0])
  })

  it('scales with @bounds3d, and takes an inline curve with its own parameter', () => {
    const scene = clean('@bounds3d: x [-1, 1], y [-1, 1], z [-1, 1]\nframe: <cos(s), sin(s), s> at s = 0')
    const [, N] = vertices((markAt(scene, 's2') as ArrowMark).vectors)
    close(N, [-0.36, 0, 0])
  })

  it('follows a parameter', () => {
    const kernel = kernelOf(`@param a = 0 range [0, 3]\n${HELIX}\nframe: r at t = a`)
    kernel.setValue('a', Math.PI / 2)
    close([...(markAt(kernel.scene(), 's3.point') as PointMark).positions], [0, 1, Math.PI / 2])
  })

  it('on a line (kappa = 0) draws T and reports N and B undefined', () => {
    const scene = sceneOf('r(t) = <t, 2t, 3t>\nframe: r at t = 1')
    expect(scene.errors).toEqual([{ line: 2, message: 'The curvature is zero at t = 1; N and B are undefined' }])
    const arrows = markAt(scene, 's2') as ArrowMark
    expect(arrows.vectors.length).toBe(3)
    const s14 = Math.sqrt(14)
    close([...arrows.vectors], [1, 2, 3].map((c) => (c / s14) * 1.8))
    expect(labelText(scene)).toEqual(['T'])
  })

  it("refuses r'(t) = 0: the curve has no tangent there", () => {
    expect(sceneOf('r(t) = <t^2, t^3, 0>\nframe: r at t = 0').errors).toEqual([{ line: 2, message: "r′(0) = 0: the curve has no tangent there" }])
  })

  it('refuses a name that is not a curve', () => {
    expect(sceneOf('frame: q at t = 1').errors[0].message).toMatch(/"q" is not a curve — define it with "q\(t\) = <cos\(t\), sin\(t\), t>"/)
    expect(sceneOf('u = <1, 2, 3>\nframe: u at t = 1').errors[0].message).toMatch(/"u" is a vector, not a curve/)
    expect(sceneOf('F(x, y, z) = <x, y, z>\nframe: F at t = 1').errors[0].message).toMatch(/"F" is a function of \(x, y, z\), not a curve/)
  })
})

describe('osculating:', () => {
  it('the helix at t = 0: radius 2, centre r + N/kappa = (-1, 0, 0), in the plane of T and N', () => {
    const scene = clean(`${HELIX}\nosculating: r at t = 0`)
    const circle = markAt(scene, 's2') as LineMark
    expect(circle.positions.length / 3).toBe(257)
    // it starts and ends at r(0)
    close(vertexOf(circle.positions, 0), [1, 0, 0], 15)
    expect(vertexOf(circle.positions, 256)).toEqual(vertexOf(circle.positions, 0))
    for (const [x, y, z] of vertices(circle.positions)) {
      expect(Math.hypot(x + 1, y, z)).toBeCloseTo(2, 12)
      // (p - c) . B = 0, B = (0, -1, 1)/sqrt 2
      expect((-y + z) * S2).toBeCloseTo(0, 12)
    }
    const centre = markAt(scene, 's2.centre') as PointMark
    close([...centre.positions], [-1, 0, 0], 15)
    expect(centre.style.shape).toBe('ring')
    expect([...(markAt(scene, 's2.point') as PointMark).positions]).toEqual([1, 0, 0])
    expect(labelText(scene)).toEqual(['κ = 0.5', 'radius = 2'])
  })

  it('refuses kappa = 0', () => {
    expect(sceneOf('r(t) = <t, 2t, 3t>\nosculating: r at t = 1').errors).toEqual([
      { line: 2, message: 'The curvature is zero at t = 1 — there is no osculating circle' },
    ])
  })
})

describe('motion:', () => {
  it('draws v = r\' and a = r\'\' at true length from r(t)', () => {
    const scene = clean(`${HELIX}\nmotion: r at t = 0`)
    const arrows = markAt(scene, 's2') as ArrowMark
    expect(vertices(arrows.tails)).toEqual([
      [1, 0, 0],
      [1, 0, 0],
    ])
    close([...arrows.vectors], [0, 1, 1, -1, 0, 0], 15)
    expect(labelText(scene)).toEqual(['v', 'a', '|v| = 1.414', 'a_T = 0', '|a_N| = 1'])
  })

  it('with components: a_T = 0 draws nothing, a_N = (-1, 0, 0) is a dashed arrow', () => {
    const scene = clean(`${HELIX}\nmotion: r at t = 0 components`)
    const shafts = markAt(scene, 's2.components') as LineMark
    expect(shafts.style.dash).not.toBeNull()
    expect([...shafts.starts]).toEqual([0])
    close([...shafts.positions], [1, 0, 0, 0, 0, 0], 15)
    const heads = markAt(scene, 's2.componentHeads') as ArrowMark
    close([...heads.vectors], [-1, 0, 0], 15)
    expect(heads.style.shaftWidth).toBe(0)
  })

  it('on a non-unit-speed curve both components draw: <t, t^2, 0> at t = 1', () => {
    // v = (1, 2, 0), a = (0, 2, 0); T = (1, 2, 0)/sqrt 5, a.T = 4/sqrt 5,
    // a_T = (4/5)(1, 2, 0) = (0.8, 1.6, 0), a_N = (-0.8, 0.4, 0), |a_N| = 0.8944
    const scene = clean('r(t) = <t, t^2, 0>\nmotion: r at t = 1 components')
    const heads = markAt(scene, 's2.componentHeads') as ArrowMark
    close([...heads.vectors], [0.8, 1.6, 0, -0.8, 0.4, 0], 14)
    expect(labelText(scene)).toEqual(expect.arrayContaining(['|v| = 2.236', 'a_T = 1.789', '|a_N| = 0.8944']))
  })
})
