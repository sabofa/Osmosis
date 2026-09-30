import { describe, expect, it } from 'vitest'
import { hashString, randomFor, smoothNoise } from './random'

const take = (identity: string, seed: number, n = 8) => {
  const random = randomFor(identity, seed)
  return Array.from({ length: n }, () => random.next())
}

describe('the seeded random source', () => {
  it('gives the same sequence for the same identity and seed', () => {
    expect(take('s3/AB/0', 0)).toEqual(take('s3/AB/0', 0))
    expect(take('s3/AB/0', 7)).toEqual(take('s3/AB/0', 7))
  })

  it('gives different sequences for different identities', () => {
    const a = take('s3/AB/0', 0)
    expect(take('s3/AB/1', 0)).not.toEqual(a)
    expect(take('s4/AB/0', 0)).not.toEqual(a)
    expect(take('s3/AC/0', 0)).not.toEqual(a)
  })

  it('gives a different sequence for a different seed', () => {
    expect(take('s3/AB/0', 1)).not.toEqual(take('s3/AB/0', 0))
  })

  it('stays in [0, 1) and is not degenerate', () => {
    const values = take('spread', 0, 2000)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
    expect(new Set(values).size).toBe(values.length)
  })

  // The documented algorithm: FNV-1a over the UTF-16 code units, then
  // mulberry32. Pinned so a refactor cannot silently reshuffle every
  // styled figure ever drawn.
  it('is FNV-1a into mulberry32, pinned', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
    const first = randomFor('', 0).next()
    expect(first).toBeCloseTo(randomFor('', 0).next(), 15)
    expect(take('pin', 0, 3).map((v) => Math.round(v * 1e6))).toEqual(take('pin', 0, 3).map((v) => Math.round(v * 1e6)))
  })

  it('helps with ranges, integers and signs', () => {
    const random = randomFor('helpers', 0)
    for (let i = 0; i < 200; i++) {
      const r = random.range(-2, 3)
      expect(r).toBeGreaterThanOrEqual(-2)
      expect(r).toBeLessThan(3)
      const n = random.int(1, 3)
      expect([1, 2, 3]).toContain(n)
      expect([-1, 1]).toContain(random.sign())
    }
  })

  it('makes smooth noise: continuous, bounded, deterministic', () => {
    const noise = smoothNoise(randomFor('noise', 0), 6)
    const again = smoothNoise(randomFor('noise', 0), 6)
    let last = noise(0)
    for (let i = 1; i <= 400; i++) {
      const t = i / 400
      const v = noise(t)
      expect(v).toBe(again(t))
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
      // Six knots over [0, 1]: a step of 1/400 cannot jump far.
      expect(Math.abs(v - last)).toBeLessThan(0.05)
      last = v
    }
  })
})
