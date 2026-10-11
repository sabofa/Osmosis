import { describe, expect, it } from 'vitest'
import { logTicks } from './logTicks'

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.abs(b)
const majors = (t: ReturnType<typeof logTicks>) => t.filter((x) => x.kind === 'major')
const minors = (t: ReturnType<typeof logTicks>) => t.filter((x) => x.kind === 'minor')

describe('logTicks', () => {
  it('1..1e4 at 400 px/decade: five decades and 2-9 minors between', () => {
    const t = logTicks(1, 1e4, 400)
    expect(majors(t).map((x) => x.label)).toEqual(['1', '10', '10²', '10³', '10⁴'])
    expect(majors(t).map((x) => x.value)).toEqual([1, 10, 100, 1000, 10000])
    // 4 full decades of minors 2..9 (8 each); 10⁴ has none above it inside the range.
    expect(minors(t)).toHaveLength(32)
    expect(minors(t).every((x) => x.label === '')).toBe(true)
    expect(t.map((x) => x.value)).toEqual([...t.map((x) => x.value)].sort((a, b) => a - b))
  })

  it('1e-3..1e9 at 40 px/decade: 12 decades is not over the limit, so every decade, no minors', () => {
    const t = logTicks(1e-3, 1e9, 40)
    expect(minors(t)).toHaveLength(0)
    expect(t).toHaveLength(13)
    expect(t[0].label).toBe('10⁻³')
    expect(t[3].label).toBe('1')
    expect(t[4].label).toBe('10')
    expect(t[12].label).toBe('10⁹')
  })

  it('more than 12 decades: every k-th decade, minors off', () => {
    const t = logTicks(1e-10, 1e10, 400) // 20 decades, k = 2
    expect(minors(t)).toHaveLength(0)
    expect(t.map((x) => x.label)).toEqual([
      '10⁻¹⁰', '10⁻⁸', '10⁻⁶', '10⁻⁴', '10⁻²', '1', '10²', '10⁴', '10⁶', '10⁸', '10¹⁰',
    ])
    expect(logTicks(1e-20, 1e20, 400).length).toBeLessThanOrEqual(13)
  })

  it('3..8 inside one decade: minors get plain numeric labels', () => {
    const t = logTicks(3, 8, 400)
    expect(majors(t)).toHaveLength(0)
    expect(t.map((x) => x.label)).toEqual(['3', '4', '5', '6', '7', '8'])
    expect(t.every((x) => x.kind === 'minor')).toBe(true)
  })

  it('small values label without float noise', () => {
    expect(logTicks(0.03, 0.08, 400).map((x) => x.label)).toEqual(['0.03', '0.04', '0.05', '0.06', '0.07', '0.08'])
  })

  it('0.5..50: majors 1 and 10 plus unlabelled minors', () => {
    const t = logTicks(0.5, 50, 400)
    expect(majors(t).map((x) => x.value)).toEqual([1, 10])
    expect(minors(t).map((x) => x.value)).toEqual([
      0.5, 0.6, 0.7, 0.8, 0.9, 2, 3, 4, 5, 6, 7, 8, 9, 20, 30, 40, 50,
    ])
    expect(minors(t).every((x) => x.label === '')).toBe(true)
  })

  it('below the pixel threshold only majors show', () => {
    const t = logTicks(1, 1e4, 100)
    expect(t.every((x) => x.kind === 'major')).toBe(true)
    expect(t).toHaveLength(5)
  })

  it('invalid input gives nothing', () => {
    expect(logTicks(0, 10, 400)).toEqual([])
    expect(logTicks(-1, 10, 400)).toEqual([])
    expect(logTicks(10, 10, 400)).toEqual([])
    expect(logTicks(10, 1, 400)).toEqual([])
    expect(logTicks(NaN, 10, 400)).toEqual([])
    expect(logTicks(1, NaN, 400)).toEqual([])
    expect(logTicks(1, Infinity, 400)).toEqual([])
  })

  it('stays inside the range, ascending, over 100 seeded ranges', () => {
    let s = 12345
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
    for (let i = 0; i < 100; i++) {
      const lo = Math.pow(10, -8 + rnd() * 16)
      const hi = lo * Math.pow(10, 0.1 + rnd() * 14)
      const t = logTicks(lo, hi, 20 + rnd() * 600)
      for (let j = 0; j < t.length; j++) {
        if (j > 0) expect(t[j].value).toBeGreaterThan(t[j - 1].value)
        expect(t[j].value).toBeGreaterThanOrEqual(lo * (1 - 1e-12))
        expect(t[j].value).toBeLessThanOrEqual(hi * (1 + 1e-12))
      }
      for (const m of majors(t)) expect(close(m.value, Math.pow(10, Math.round(Math.log10(m.value))))).toBe(true)
    }
  })
})
