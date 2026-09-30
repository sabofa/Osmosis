import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig, type SpaceConfig } from '../config'
import type { Box3 } from '../scene/types'
import { flatAxes, flatFloor, resolveBox } from './bounds'

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

  it('V1: a flat z (degenerate, with non-degenerate x and y) gets a thin box, s = 0.05 x the larger x/y span, unrounded', () => {
    // x, y spans of 4: s = 0.05 * 4 = 0.2, centred on the data's z (0).
    const box = resolveBox(config(), extent([-2, 2], [0, 4], [0, 0]))
    expect(box.z).toEqual({ min: -0.2, max: 0.2 })
  })

  it('V1: the thin box centres on the data value, not 0', () => {
    const box = resolveBox(config(), extent([-2, 2], [0, 4], [3, 3]))
    expect(box.z).toEqual({ min: 2.8, max: 3.2 })
  })

  it('V1: a lone region: (its z never enters the extent — the empty sentinel, not a degenerate point) also gets a thin box, centred at 0', () => {
    // Matches kernel/index.ts extentOf's EMPTY sentinel: x, y are real, z is
    // the box pass's "nothing" range (min +Infinity, max -Infinity).
    const box = resolveBox(config(), extent([-1, 1], [0, 1], [Infinity, -Infinity]))
    // Larger of x (2) and y (1) is 2: s = 0.05 * 2 = 0.1, centred at 0 (no data to centre on).
    expect(box.z).toEqual({ min: -0.1, max: 0.1 })
  })

  it('V1: an authored @bounds3d z always wins over the flat rule', () => {
    const box = resolveBox(config({ z: { min: -1, max: 1 } }), extent([-2, 2], [0, 4], [0, 0]))
    expect(box.z).toEqual({ min: -1, max: 1 })
  })

  it('V1: the flat rule is symmetric — a degenerate x with non-degenerate y, z also gets a thin box', () => {
    const box = resolveBox(config(), extent([5, 5], [-2, 2], [0, 8]))
    // Larger of y (4) and z (8) is 8: s = 0.05 * 8 = 0.4.
    expect(box.x).toEqual({ min: 4.6, max: 5.4 })
  })

  it('widens an all-degenerate extent by 1 on each axis, then rounds (not V1: no other axis is non-degenerate)', () => {
    const box = resolveBox(config(), extent([3, 3], [3, 3], [3, 3]))
    // [2, 4] with niceStep(2, 8) = 0.2 is already on the ladder.
    expect(box).toEqual(extent([2, 4], [2, 4], [2, 4]))
  })

  it('does not widen a degenerate axis when the box has no data on the other axes either', () => {
    // Only z has data (a point moving along z); x and y are both absent, so
    // they default to [-5, 5] rather than being read as "non-degenerate".
    const box = resolveBox(config(), { x: { min: Infinity, max: -Infinity }, y: { min: Infinity, max: -Infinity }, z: { min: 3, max: 3 } })
    expect(box.z).toEqual({ min: 2, max: 4 })
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

describe('flatAxes (V1)', () => {
  it('flags z alone when only z is degenerate', () => {
    expect(flatAxes(config(), extent([-2, 2], [0, 4], [0, 0]))).toEqual({ x: false, y: false, z: true })
  })

  it('flags nothing when an axis is authored, even if its data is degenerate', () => {
    expect(flatAxes(config({ z: { min: -1, max: 1 } }), extent([-2, 2], [0, 4], [0, 0]))).toEqual({ x: false, y: false, z: false })
  })

  it('flags nothing when every axis is degenerate (a single point)', () => {
    expect(flatAxes(config(), extent([3, 3], [3, 3], [3, 3]))).toEqual({ x: false, y: false, z: false })
  })

  it('flags nothing with no data at all', () => {
    expect(flatAxes(config(), null)).toEqual({ x: false, y: false, z: false })
  })

  it('flags z when z is wholly absent (the region z sentinel) but x and y are real', () => {
    expect(flatAxes(config(), extent([-1, 1], [0, 1], [Infinity, -Infinity]))).toEqual({ x: false, y: false, z: true })
  })

  it('flags every degenerate axis when more than one is thin: y and z degenerate, x is not', () => {
    expect(flatAxes(config(), extent([-4, 4], [1, 1], [2, 2]))).toEqual({ x: false, y: true, z: true })
  })
})

// S6 fix round 1, I1: a box-dependent statement not yet built (a sphere, a
// plane) is invisible to `extent`, so flatAxes must be told separately which
// axes it will occupy once built, or it carves a sliver from geometry that
// is not flat.
describe('flatAxes and resolveBox with a box-spanning statement (I1)', () => {
  it("the sphere case: x^2+y^2+z^2=4 plus two points at z=0 no longer gets a sliver z box", () => {
    // Two points at z = 0, e.g. (±2, 0, 0): the extent alone reads z as
    // degenerate, exactly as it would without the sphere. The sphere (an
    // implicit surface) is a 'box'-stage statement, so it spans every axis.
    const spanning = { x: true, y: true, z: true }
    const points = extent([-2, 2], [-2, 2], [0, 0])
    expect(flatAxes(config(), points, spanning)).toEqual({ x: false, y: false, z: false })
    const box = resolveBox(config(), points, spanning)
    expect(box.z).toEqual({ min: -2, max: 2 })
  })

  it('the plane case: x + y + z = 3 with two intercept points at z = 0 does not become a z sliver', () => {
    // (3, 0, 0) and (0, 3, 0): both at z = 0 (degenerate), x and y span 3.
    // The plane is 'box'-stage, so z is box-spanning even though nothing
    // built so far has put real data on it.
    const spanning = { x: true, y: true, z: true }
    const points = extent([0, 3], [0, 3], [0, 0])
    expect(flatAxes(config(), points, spanning)).toEqual({ x: false, y: false, z: false })
    const box = resolveBox(config(), points, spanning)
    // Not a sliver: z gets a real span, symmetric about the data (0).
    expect(box.z.max - box.z.min).toBeGreaterThan(1)
    expect(box.z.min).toBeCloseTo(-box.z.max, 12)
  })

  it('a lone region is still flat: nothing box-spanning sits on its z', () => {
    // Same shape as the existing "z is wholly absent" case, but explicit
    // about the new parameter: a region is 'z'-stage, not 'box'-stage, so it
    // never marks an axis box-spanning.
    const notSpanning = { x: false, y: false, z: false }
    const region = extent([-1, 1], [0, 1], [Infinity, -Infinity])
    expect(flatAxes(config(), region, notSpanning)).toEqual({ x: false, y: false, z: true })
    const box = resolveBox(config(), region, notSpanning)
    expect(box.z).toEqual({ min: -0.1, max: 0.1 })
  })
})

// S6 fix round 1, M1: a flat axis's tick sits at "the data's z" — the box's
// centre, resolveBox's v — except when there is no data there at all (raw
// is null), where a lone region's own shading sits on the box's floor
// instead (kernel/integrals/common.ts floorHeight), not its centre.
describe('flatFloor (S6 fix round 1, M1)', () => {
  it('is false wherever there is real data, even a degenerate point: the centre already is that data', () => {
    // z degenerate at 3 (two points both at z = 3, say): raw.z is {3, 3},
    // not null, so the box's centre (resolveBox's v = 3) is where that data
    // actually is.
    expect(flatFloor(config(), extent([-2, 2], [0, 4], [3, 3]))).toEqual({ x: false, y: false, z: false })
  })

  it('is true for an axis with no data at all: the region z sentinel', () => {
    expect(flatFloor(config(), extent([-1, 1], [0, 1], [Infinity, -Infinity]))).toEqual({ x: false, y: false, z: true })
  })

  it('is false wherever the axis is authored: an authored range always wins outright, floor or not', () => {
    expect(flatFloor(config({ z: { min: -1, max: 1 } }), extent([-1, 1], [0, 1], [Infinity, -Infinity]))).toEqual({
      x: false,
      y: false,
      z: false,
    })
  })

  it('is false with no extent at all: nothing drawn, nothing to anchor to a floor', () => {
    expect(flatFloor(config(), null)).toEqual({ x: false, y: false, z: false })
  })
})
