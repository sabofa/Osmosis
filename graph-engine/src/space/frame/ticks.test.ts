import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig } from '../config'
import { formatTick, frameAxes, niceStep, ticks } from './ticks'

const PI_HALF = { value: Math.PI / 2, pi: { num: 1, den: 2 } }

describe('niceStep (temporary, until frame/nice.ts lands with S1)', () => {
  it('picks the 1-2-5 ladder value nearest to span / target in log scale', () => {
    expect(niceStep(3, 8)).toBe(0.5) // 0.375: log distance to 0.5 is 0.125, to 0.2 is 0.273
    expect(niceStep(1, 8)).toBe(0.1)
    expect(niceStep(2, 8)).toBe(0.2)
    expect(niceStep(10, 8)).toBe(1)
    expect(niceStep(7, 8)).toBe(1)
    expect(niceStep(0.3, 8)).toBe(0.05)
    expect(niceStep(2 * Math.PI, 8)).toBe(1)
  })

  it('breaks a tie toward the larger step', () => {
    // sqrt(1 * 2) is equidistant from 1 and 2 in log scale.
    expect(niceStep(8 * Math.SQRT2, 8)).toBe(2)
  })
})

describe('ticks', () => {
  it('takes the axis scale, and only linear exists (SP5: log axes slot in later)', () => {
    expect(ticks({ min: 0, max: 1 }, 0.5, 'linear')).toEqual([0, 0.5, 1])
    // @ts-expect-error -- 'log' is not a scale yet; it must not compile.
    ticks({ min: 1, max: 100 }, 1, 'log')
    const axes = frameAxes(defaultSpaceConfig(), { x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, z: { min: 0, max: 1 } })
    expect([axes.x.scale, axes.y.scale, axes.z.scale]).toEqual(['linear', 'linear', 'linear'])
  })

  it('[0, 1] step 0.1 yields 11 values, the last exactly 1 (10 * 0.1, never accumulated)', () => {
    const t = ticks({ min: 0, max: 1 }, 0.1, 'linear')
    expect(t).toHaveLength(11)
    expect(t[10]).toBe(1)
    expect(t[3]).toBe(3 * 0.1)
  })

  it('[-pi, pi] step pi/2 yields 5 values', () => {
    expect(ticks({ min: -Math.PI, max: Math.PI }, Math.PI / 2, 'linear')).toHaveLength(5)
  })

  it('is inclusive within a 1e-9 relative tolerance and exclusive beyond it', () => {
    expect(ticks({ min: 0, max: 1 - 1e-12 }, 0.5, 'linear')).toEqual([0, 0.5, 1])
    expect(ticks({ min: 0, max: 0.99 }, 0.5, 'linear')).toEqual([0, 0.5])
  })
})

describe('formatTick', () => {
  it('takes its decimals from the step: 0.25 step 0.25 -> 0.25, 0.5 -> 0.50', () => {
    expect(formatTick(0.25, null, 0.25)).toBe('0.25')
    expect(formatTick(0.5, null, 0.25)).toBe('0.50')
    expect(formatTick(0.4, null, 0.2)).toBe('0.4')
    expect(formatTick(3 * 0.1, null, 0.1)).toBe('0.3')
  })

  it('prints integers for integer steps: 3 step 1 -> 3', () => {
    expect(formatTick(3, null, 1)).toBe('3')
    expect(formatTick(10, null, 5)).toBe('10')
  })

  it('uses U+2212 for minus: -2 -> −2', () => {
    expect(formatTick(-2, null, 1)).toBe('−2')
    expect(formatTick(-0.5, null, 0.25)).toBe('−0.50')
  })

  it('never prints a negative zero', () => {
    expect(formatTick(-1e-17, null, 0.25)).toBe('0.00')
  })

  it('prints pi multiples from an authored pi step, reduced by gcd, coefficient 1 omitted', () => {
    expect(formatTick(Math.PI / 2, PI_HALF, PI_HALF.value)).toBe('π/2')
    expect(formatTick(Math.PI, PI_HALF, PI_HALF.value)).toBe('π')
    expect(formatTick((3 * Math.PI) / 2, PI_HALF, PI_HALF.value)).toBe('3π/2')
    expect(formatTick(2 * Math.PI, PI_HALF, PI_HALF.value)).toBe('2π')
    expect(formatTick(-Math.PI, PI_HALF, PI_HALF.value)).toBe('−π')
    expect(formatTick(-Math.PI / 2, PI_HALF, PI_HALF.value)).toBe('−π/2')
    expect(formatTick(0, PI_HALF, PI_HALF.value)).toBe('0')
  })

  it('never infers pi: a step of pi/2 with no authored pi prints decimals', () => {
    expect(formatTick(Math.PI / 2, null, Math.PI / 2)).not.toContain('π')
  })

  it('prints m×10ⁿ for large and small steps: 200000 step 100000 -> 2×10⁵', () => {
    expect(formatTick(200000, null, 100000)).toBe('2×10⁵')
    expect(formatTick(1500000, null, 500000)).toBe('1.5×10⁶')
    expect(formatTick(-200000, null, 100000)).toBe('−2×10⁵')
    expect(formatTick(0.00015, null, 0.00005)).toBe('1.5×10⁻⁴')
    expect(formatTick(0, null, 100000)).toBe('0')
    // 1e4 is under the threshold: plain decimals.
    expect(formatTick(20000, null, 10000)).toBe('20000')
  })
})
