import { describe, expect, it } from 'vitest'
import { frameDeltas, percentile, summariseDeltas, summariseFrames, sumByName, type TraceEvent } from './handling-probe-stats'

describe('percentile', () => {
  it('interpolates and clamps', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([0, 10], 0.25)).toBe(2.5)
    expect(percentile([7], 0.99)).toBe(7)
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([1, 2], 5)).toBe(2)
  })
})

describe('frame summary', () => {
  it('takes deltas from timestamps', () => {
    expect(frameDeltas([0, 16, 40])).toEqual([16, 24])
    expect(frameDeltas([5])).toEqual([])
  })
  it('counts slow frames and fps', () => {
    const s = summariseDeltas([10, 10, 10, 25, 60, 10, 10, 10, 10, 10])
    expect(s.frames).toBe(10)
    expect(s.max).toBe(60)
    expect(s.over10).toBe(2)
    expect(s.over20).toBe(2)
    expect(s.over50).toBe(1)
    expect(s.p50).toBe(10)
    expect(s.fps).toBeCloseTo(10 / 0.165, 3)
  })
  it('is zeros for nothing', () => {
    expect(summariseFrames([]).frames).toBe(0)
    expect(summariseFrames([1]).max).toBe(0)
  })
})

describe('sumByName', () => {
  it('sums complete events in the window', () => {
    const e = (name: string, ts: number, dur: number): TraceEvent => ({ name, ph: 'X', ts, dur, tid: 1, pid: 1 })
    const m = sumByName([e('Paint', 0, 2000), e('Paint', 5000, 1000), e('Paint', 99999, 1000), e('Layout', 10, 500)], 0, 10000)
    expect(m.get('Paint')).toEqual({ ms: 3, count: 2 })
    expect(m.get('Layout')?.ms).toBeCloseTo(0.5)
  })
})
