import { describe, expect, it } from 'vitest'
import { formatTicks } from './labels'

const range = (start: number, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => start + i * step)

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
function parse(label: string): number {
  const s = label
    .replace('−', '-')
    .replace(/×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/, (_, e: string) =>
      'e' + e.replace('⁻', '-').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(SUP.indexOf(c))),
    )
  return Number(s)
}

describe('formatTicks', () => {
  const cases: [string, number[], number, string[]][] = [
    ['step 0.2', range(0, 0.2, 6), 0.2, ['0', '0.2', '0.4', '0.6', '0.8', '1']],
    ['step 0.25', range(0, 0.25, 5), 0.25, ['0', '0.25', '0.5', '0.75', '1']],
    ['step 5', range(0, 5, 4), 5, ['0', '5', '10', '15']],
    ['step 50', range(0, 50, 5), 50, ['0', '50', '100', '150', '200']],
    ['negatives', [-1, -0.5, 0, 0.5], 0.5, ['−1', '−0.5', '0', '0.5']],
    ['negative zero', [-0, 1], 1, ['0', '1']],
    ['float noise', [0.1, 0.2, 0.1 + 0.2, 0.4], 0.1, ['0.1', '0.2', '0.3', '0.4']],
    ['step 1e-5 near 1', range(1.00001, 1e-5, 3), 1e-5, ['1.00001', '1.00002', '1.00003']],
    ['large magnitudes', [1e5, 2e5, 3e5], 1e5, ['1×10⁵', '2×10⁵', '3×10⁵']],
    ['tiny steps', range(0, 1e-6, 6), 1e-6, ['0', '1×10⁻⁶', '2×10⁻⁶', '3×10⁻⁶', '4×10⁻⁶', '5×10⁻⁶']],
    ['negative sci', [-3e5, -2e5], 1e5, ['−3×10⁵', '−2×10⁵']],
    ['empty', [], 1, []],
    ['NaN passes through', [NaN, 1], 1, ['NaN', '1']],
  ]
  it.each(cases)('%s', (_name, values, step, expected) => {
    expect(formatTicks(values, step)).toEqual(expected)
  })

  it('tells apart a 1e-8 window around 1000', () => {
    const labels = formatTicks(range(1000, 2e-9, 5), 2e-9)
    expect(new Set(labels).size).toBe(5)
    for (const l of labels) expect(l).toMatch(/×10³$/)
  })

  it('property: neighbours differ and labels parse back (200 seeded cases)', () => {
    const rnd = mulberry32(12345)
    for (let i = 0; i < 200; i++) {
      const step = 10 ** (rnd() * 20 - 10) * (1 + rnd())
      const start = Math.round((rnd() - 0.5) * 2000) * step
      const count = 2 + Math.floor(rnd() * 9)
      const values = range(start, step, count)
      const labels = formatTicks(values, step)
      expect(labels).toHaveLength(count)
      for (let k = 0; k < count; k++) {
        if (k > 0) expect(labels[k]).not.toBe(labels[k - 1])
        expect(labels[k]).not.toContain('-')
        expect(Math.abs(parse(labels[k]!) - values[k]!)).toBeLessThanOrEqual(step / 100)
      }
    }
  })
})
