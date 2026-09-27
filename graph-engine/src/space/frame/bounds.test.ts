import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig, type SpaceConfig } from '../config'
import type { Box3 } from '../scene/types'
import { resolveBox } from './bounds'

function config(bounds: Partial<SpaceConfig['bounds']> = {}): SpaceConfig {
  const c = defaultSpaceConfig()
  return { ...c, bounds: { ...c.bounds, ...bounds } }
}

const extent = (x: [number, number], y: [number, number], z: [number, number]): Box3 => ({
  x: { min: x[0], max: x[1] },
  y: { min: y[0], max: y[1] },
  z: { min: z[0], max: z[1] },
})

describe('resolveBox', () => {
  it('rounds a data axis outward to niceStep(span, 8): x [-0.3, 2.7] -> [-0.5, 3] (step 0.5)', () => {
    const box = resolveBox(config(), extent([-0.3, 2.7], [0, 1], [0, 1]))
    expect(box.x).toEqual({ min: -0.5, max: 3 })
  })

  it('keeps an authored axis exactly, with no rounding', () => {
    const box = resolveBox(config({ x: { min: -3, max: 3 } }), extent([-0.3, 2.7], [0, 1], [0, 1]))
    expect(box.x).toEqual({ min: -3, max: 3 })
    const odd = resolveBox(config({ y: { min: -0.37, max: 1.13 } }), extent([0, 1], [0, 1], [0, 1]))
    expect(odd.y).toEqual({ min: -0.37, max: 1.13 })
  })

  it('gives [-5, 5] on every axis with no data', () => {
    expect(resolveBox(config(), null)).toEqual(extent([-5, 5], [-5, 5], [-5, 5]))
  })

  it('keeps an authored axis and defaults the rest when there is no data', () => {
    expect(resolveBox(config({ z: { min: 0, max: 10 } }), null)).toEqual(extent([-5, 5], [-5, 5], [0, 10]))
  })

  it('widens a degenerate z at 0 by half the largest other span: x, y spans of 4 give z [-2, 2]', () => {
    const box = resolveBox(config(), extent([-2, 2], [0, 4], [0, 0]))
    expect(box.z).toEqual({ min: -2, max: 2 })
  })

  it('widens an all-degenerate extent by 1 on each axis, then rounds', () => {
    const box = resolveBox(config(), extent([3, 3], [3, 3], [3, 3]))
    // [2, 4] with niceStep(2, 8) = 0.2 is already on the ladder.
    expect(box).toEqual(extent([2, 4], [2, 4], [2, 4]))
  })

  it('rounds out to an authored @ticks3d step: x pi/2 over [-2pi, 2pi] stays [-2pi, 2pi]', () => {
    const c = defaultSpaceConfig()
    const pi2 = { value: Math.PI / 2, pi: { num: 1, den: 2 } }
    const space: SpaceConfig = { ...c, ticks: { ...c.ticks, x: pi2 } }
    const box = resolveBox(space, extent([-2 * Math.PI, 2 * Math.PI], [-1, 1], [0, 1]))
    // -2pi / (pi/2) = -4 exactly, so the bound is already a multiple.
    expect(box.x).toEqual({ min: -2 * Math.PI, max: 2 * Math.PI })
    // Inside a multiple, it rounds out to the next one: [-7, 7] -> [-5pi/2, 5pi/2].
    const wider = resolveBox(space, extent([-7, 7], [-1, 1], [0, 1]))
    expect(wider.x.min).toBeCloseTo((-5 * Math.PI) / 2, 12)
    expect(wider.x.max).toBeCloseTo((5 * Math.PI) / 2, 12)
    // An axis with no authored step keeps the ladder: y [-1, 1] with niceStep(2, 8) = 0.2.
    expect(box.y).toEqual({ min: -1, max: 1 })
  })

  it('does not accumulate: an extent on multiples of 0.1 stays put', () => {
    // niceStep(0.9, 8) = 0.1; 0.3 / 0.1 is 2.9999999999999996 in doubles.
    const box = resolveBox(config(), extent([0.3, 1.2], [0, 1], [0, 1]))
    expect(box.x.min).toBeCloseTo(0.3, 12)
    expect(box.x.max).toBeCloseTo(1.2, 12)
  })
})
