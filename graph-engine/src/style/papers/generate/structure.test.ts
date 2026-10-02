import { describe, expect, it } from 'vitest'
import { BRIGHTNESS, composeOffsets, DRIFT, KNEE, softLimit } from './structure'

describe('the OKLab sensitivities', () => {
  it('turn a brightness change into mostly a lightness change', () => {
    // A 1% brighter sRGB tone is about 0.67% lighter in OKLab L at L = 0.887 (0.665 per unit),
    // with almost no change in a and a little more b: brighter warm cloth is a little more yellow.
    expect(BRIGHTNESS[0]).toBeCloseTo(0.6655, 3)
    expect(BRIGHTNESS[1]).toBeCloseTo(0.0014, 3)
    expect(BRIGHTNESS[2]).toBeCloseTo(0.0231, 3)
  })

  it('turn the warm/cool drift into a move toward red and yellow', () => {
    // Red up, blue down: a goes up and b goes up (yellower), and L rises a little with the red.
    expect(DRIFT[0]).toBeCloseTo(0.2455, 3)
    expect(DRIFT[1]).toBeCloseTo(0.0827, 3)
    expect(DRIFT[2]).toBeCloseTo(0.3688, 3)
  })
})

describe('composeOffsets', () => {
  const flat = (v: number, w = 1, h = 1) => ({ data: new Float32Array(w * h).fill(v), w, h })

  it('is the thread brightness factor times its share, times the brightness sensitivity', () => {
    // K = 1.1: 0.4 * 0.1 = 0.04 of a unit of brightness.
    const out = composeOffsets(2, new Float32Array([1, 1.1, 0.9, 1]), 0.4, [])
    expect(out.length).toBe(12)
    expect(out[0]).toBeCloseTo(0, 7) // K = 1: no change
    expect(out[3]).toBeCloseTo(0.04 * BRIGHTNESS[0], 6)
    expect(out[4]).toBeCloseTo(0.04 * BRIGHTNESS[1], 6)
    expect(out[5]).toBeCloseTo(0.04 * BRIGHTNESS[2], 6)
    expect(out[6]).toBeCloseTo(-0.04 * BRIGHTNESS[0], 6) // K = 0.9
  })

  it('adds each layer\'s field times its amount times its sensitivity, per channel', () => {
    // Field 2, amount 0.5, sensitivity (1, 2, 3): (1, 2, 3) on every texel; a second layer, field 4, amount 0.5,
    // sensitivity (0.1, 0, -0.1), adds (0.2, 0, -0.2). K is 1 everywhere, so the brightness factor adds nothing.
    const out = composeOffsets(2, new Float32Array(4).fill(1), 0.4, [
      { field: flat(2), amount: 0.5, sensitivity: [1, 2, 3] },
      { field: flat(4), amount: 0.5, sensitivity: [0.1, 0, -0.1] },
    ])
    for (let i = 0; i < 4; i++) {
      expect(out[i * 3]).toBeCloseTo(1.2, 6)
      expect(out[i * 3 + 1]).toBeCloseTo(2, 6)
      expect(out[i * 3 + 2]).toBeCloseTo(2.8, 6)
    }
  })

  it('takes at most two layers', () => {
    const layer = { field: flat(1), amount: 1, sensitivity: [1, 0, 0] as [number, number, number] }
    expect(() => composeOffsets(2, new Float32Array(4).fill(1), 0, [layer, layer])).not.toThrow()
    expect(() => composeOffsets(2, new Float32Array(4).fill(1), 0, [layer, layer, layer])).toThrow(RangeError)
  })

  it('resamples a coarse layer to the tile with wrapping bilinear weights', () => {
    // The 2x2 field [0 4; 8 12] on a 4x4 tile is [3 3 5 5; 3 3 5 5; 7 7 9 9; 7 7 9 9] (the weights are 3/4 and 1/4).
    const coarse = { data: new Float32Array([0, 4, 8, 12]), w: 2, h: 2 }
    const out = composeOffsets(4, new Float32Array(16).fill(1), 0, [{ field: coarse, amount: 1, sensitivity: [1, 0, 0] }])
    const expected = [3, 3, 5, 5, 3, 3, 5, 5, 7, 7, 9, 9, 7, 7, 9, 9]
    expected.forEach((v, i) => expect(out[i * 3]).toBeCloseTo(v, 6))
  })
})

describe('softLimit', () => {
  it('leaves a deviation under the knee exactly as it is', () => {
    for (const d of [0, 0.1, -0.2, KNEE, -KNEE]) expect(softLimit(d)).toBe(d)
  })

  it('bends a larger one toward 0.5 with a tanh that starts at slope 1', () => {
    // 0.35 + 0.15 * tanh((a - 0.35) / 0.15): a = 0.5 gives 0.35 + 0.15 * tanh(1) = 0.464239;
    // a = 0.64 gives 0.35 + 0.15 * tanh(1.93333) = 0.35 + 0.15 * 0.95900 = 0.49385. Odd, so the low side
    // mirrors the high.
    expect(softLimit(0.5)).toBeCloseTo(0.464239, 6)
    expect(softLimit(-0.64)).toBeCloseTo(-0.49385, 5)
    // No kink at the knee: just past it the slope is still 1.
    expect((softLimit(KNEE + 1e-4) - softLimit(KNEE)) / 1e-4).toBeCloseTo(1, 3)
  })

  it('never reaches 0.5, however large, and keeps the order', () => {
    expect(softLimit(10)).toBeLessThan(0.5 + 1e-12)
    expect(softLimit(10)).toBeGreaterThan(0.4999)
    expect(softLimit(-10)).toBeCloseTo(-softLimit(10), 12)
    let last = -1
    for (let d = -3; d <= 3; d += 0.01) {
      expect(softLimit(d)).toBeGreaterThanOrEqual(last)
      last = softLimit(d)
    }
  })
})
