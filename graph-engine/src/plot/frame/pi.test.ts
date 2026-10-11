import { describe, expect, it } from 'vitest'
import { piLabel, piStepFor } from './pi'
import { PI_LADDER } from './tuning'

const labels = (step: { num: number; den: number }, from: number, to: number) => {
  const out: string[] = []
  for (let k = from; k <= to; k++) out.push(piLabel(k, step))
  return out
}

describe('piLabel', () => {
  it('step pi/2, k = -3..5', () => {
    expect(labels({ num: 1, den: 2 }, -3, 5)).toEqual([
      '−3π/2', '−π', '−π/2', '0', 'π/2', 'π', '3π/2', '2π', '5π/2',
    ])
  })
  it('step pi/6, k = 0..7', () => {
    expect(labels({ num: 1, den: 6 }, 0, 7)).toEqual([
      '0', 'π/6', 'π/3', 'π/2', '2π/3', '5π/6', 'π', '7π/6',
    ])
  })
  it('step pi, k = -2..2', () => {
    expect(labels({ num: 1, den: 1 }, -2, 2)).toEqual(['−2π', '−π', '0', 'π', '2π'])
  })
  it('reduces fractions from a non-reduced step', () => {
    expect(labels({ num: 2, den: 4 }, 1, 3)).toEqual(['π/2', 'π', '3π/2'])
    expect(piLabel(3, { num: 5, den: 1 })).toBe('15π')
  })
  it('k = 0 is 0', () => {
    expect(piLabel(0, { num: 1, den: 12 })).toBe('0')
  })
})

describe('PI_LADDER / piStepFor', () => {
  it('is pinned and ascending', () => {
    expect(PI_LADDER.map((s) => `${s.num}/${s.den}`)).toEqual([
      '1/12', '1/6', '1/4', '1/2', '1/1', '2/1', '4/1', '5/1', '10/1', '20/1', '50/1', '100/1',
    ])
    for (let i = 1; i < PI_LADDER.length; i++) {
      expect(PI_LADDER[i].num / PI_LADDER[i].den).toBeGreaterThan(PI_LADDER[i - 1].num / PI_LADDER[i - 1].den)
    }
  })
  it('is monotone non-decreasing over spans 0.1..2000', () => {
    let prev = 0
    for (let i = 0; i < 200; i++) {
      const span = 0.1 * Math.pow(2000 / 0.1, i / 199)
      const s = piStepFor(span, 6)
      const v = s.num / s.den
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
  it('the pi family survives zoom: 3pi -> 6pi -> 12pi -> 24pi at target 6', () => {
    // rough = span/6 = pi/2, pi, 2pi, 4pi; each is a ladder rung exactly.
    const seq = [3, 6, 12, 24].map((m) => {
      const s = piStepFor(m * Math.PI, 6)
      return `${s.num}/${s.den}`
    })
    expect(seq).toEqual(['1/2', '1/1', '2/1', '4/1'])
  })
  it('clamps at both ends', () => {
    expect(piStepFor(1e-6, 6)).toEqual({ num: 1, den: 12 })
    expect(piStepFor(1e9, 6)).toEqual({ num: 100, den: 1 })
  })
})
