import { describe, expect, it } from 'vitest'
import { chainOf } from '../../scene/chains'
import type { Vec2 } from '../../scene/types'
import { bridgeInside, DENSE, firstBridge } from './dense'

const PX = { x: 40, y: 40 }
const curve = (f: (x: number) => number) => (t: number): Vec2 => ({ x: t, y: f(t) })
const chainAlong = (f: (x: number) => number, ts: number[]) => chainOf(ts.map((t) => ({ x: t, y: f(t) })), ts)

describe('the dense-sample discontinuity check', () => {
  it('sees a jump inside a segment, and its size', () => {
    const size = bridgeInside(curve(Math.floor), 0.5, 1.5, PX)
    expect(size).toBeCloseTo(40, 6)
  })

  it('sees the riser of a staircase whose steps are a hair wide, which a polyline of the true curve cannot tell from the chord', () => {
    const f = (x: number) => Math.floor(1000 * x)
    const size = bridgeInside(curve(f), -0.0122, 0, PX, false, true)
    expect(size).toBeCloseTo(40, 6)
  })

  it('passes a smooth curve however steep: cube root at 0, a vertical tangent, 1000x and an edge that dives', () => {
    expect(bridgeInside(curve(Math.cbrt), -0.001, 0.001, PX)).toBe(0)
    expect(bridgeInside(curve((x) => 1000 * x), -1, 1, PX)).toBe(0)
    expect(bridgeInside(curve((x) => Math.sqrt(Math.max(0, 1 - x))), 0.9, 1, PX)).toBe(0)
    expect(bridgeInside(curve(Math.log), 1e-6, 2e-6, PX)).toBe(0)
  })

  it('passes an oscillation that the segment steps over: its gaps close when bisected', () => {
    expect(bridgeInside(curve((x) => Math.sin(500 * x)), 0, 0.2, PX)).toBe(0)
  })

  it('allows a jump under the allowance, which the sampler bridges on purpose, and not one over it', () => {
    const steps = (h: number) => (x: number) => (x < 0.5 ? 0 : h)
    expect(bridgeInside(curve(steps(DENSE.jumpPx / PX.y / 2)), 0, 1, PX)).toBe(0)
    expect(bridgeInside(curve(steps((3 * DENSE.jumpPx) / PX.y)), 0, 1, PX)).toBeGreaterThan(DENSE.jumpPx)
  })

  it('says undefined inside a segment is as far off as can be', () => {
    expect(bridgeInside(curve((x) => (x > 0.4 && x < 0.6 ? Number.NaN : x)), 0, 1, PX)).toBe(Number.POSITIVE_INFINITY)
  })

  it('does not ask an end that the segment does not own: a jump at the anchor is the break, not the bridge', () => {
    const f = Math.floor
    // [0.5, 1] ends at the jump at 1 (floor(1) is 1: the left limit is 0, and the point is the anchor's)
    expect(bridgeInside(curve(f), 0.5, 1, PX, false, false)).toBeCloseTo(40, 6)
    expect(bridgeInside(curve(f), 0.5, 1 - 1e-9, PX, false, true)).toBe(0)
  })

  it('finds the first bridging segment of a chain, and lists none for a chain that is on the curve', () => {
    const f = (x: number) => Math.floor(x) + 0.001 * x
    const good = chainAlong(f, [0.1, 0.3, 0.5, 0.9])
    expect(firstBridge([good], curve(f), PX, () => false).size).toBe(0)
    const bad = chainAlong(f, [0.1, 0.9, 1.1, 1.9, 2.1])
    const found = firstBridge([good, bad], curve(f), PX, () => false)
    expect(found.size).toBeGreaterThan(0)
    expect(found.from).toBe(0.9)
    expect(found.to).toBe(1.1)
  })

  it('checks a stride of the segments when it is told to, and every long one', () => {
    const f = (x: number) => 0.0001 * x
    const ts = Array.from({ length: 101 }, (_, i) => i * 0.01)
    const found = firstBridge([chainAlong(f, ts)], curve(f), PX, () => false, 10)
    expect(found.checked).toBe(10)
    const long = firstBridge([chainAlong(f, [0, 0.01, 0.02, 5])], curve(f), PX, () => false, 1)
    expect(long.checked).toBe(2)
  })
})
