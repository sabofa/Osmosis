import { describe, expect, it } from 'vitest'
import {
  CONTINUOUS,
  copy,
  DEFINED,
  down,
  hull,
  isEmpty,
  iv,
  LIB,
  PARTIAL,
  set,
  setBox,
  setEmpty,
  setPoint,
  setUnknown,
  ULP2,
  UNKNOWN,
  up,
  worst,
} from './core'
import { admits, mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

describe('verdicts and widening', () => {
  it('verdicts order from unknown to continuous, and combine by the weakest', () => {
    expect([UNKNOWN, PARTIAL, DEFINED, CONTINUOUS]).toEqual([0, 1, 2, 3])
    expect(worst(CONTINUOUS, DEFINED)).toBe(DEFINED)
    expect(worst(PARTIAL, CONTINUOUS)).toBe(PARTIAL)
    expect(worst(UNKNOWN, DEFINED)).toBe(UNKNOWN)
  })

  it('ULP2 and LIB are two and four ulps as a relative step', () => {
    expect(ULP2).toBe(2 ** -51)
    expect(LIB).toBe(2 ** -50)
  })

  it('down and up widen outward by whole ulps, and leave infinities alone', () => {
    const f = new Float64Array(1)
    const u = new BigUint64Array(f.buffer)
    const ulp = (x: number): number => {
      f[0] = Math.abs(x)
      const at = f[0]
      u[0] += 1n
      return f[0] - at
    }
    for (const x of [1, -1, 3.7, -1234.5, 1e-300, -1e-300, 1e300, -1e300, 0.1, 2 ** 40]) {
      // the relative step is 2 (4) ulps before rounding to a double: at least one
      // (two) and under five (nine) after
      expect(x - down(x)).toBeGreaterThanOrEqual(ulp(x))
      expect(up(x) - x).toBeGreaterThanOrEqual(ulp(x))
      expect(x - down(x)).toBeLessThan(5 * ulp(x))
      expect(up(x, LIB) - x).toBeGreaterThanOrEqual(2 * ulp(x))
      expect(x - down(x, LIB)).toBeGreaterThanOrEqual(2 * ulp(x))
      expect(up(x, LIB) - x).toBeLessThan(9 * ulp(x))
    }
    expect(down(0)).toBe(-Number.MIN_VALUE)
    expect(up(0)).toBe(Number.MIN_VALUE)
    expect(down(Infinity)).toBe(Infinity)
    expect(up(-Infinity)).toBe(-Infinity)
    expect(down(-Infinity)).toBe(-Infinity)
    expect(up(Infinity)).toBe(Infinity)
  })

  it('widening covers the rounding of a neighbouring sum', () => {
    expect(down(0.1 + 0.2) <= 0.3 && 0.3 <= up(0.1 + 0.2)).toBe(true)
  })
})

describe('setters', () => {
  it('set writes the bounds and turns a NaN bound into no bound', () => {
    expect(set(iv(), 1, 2, DEFINED)).toEqual({ lo: 1, hi: 2, v: DEFINED })
    expect(set(iv(), NaN, NaN, PARTIAL)).toEqual({ lo: -Infinity, hi: Infinity, v: PARTIAL })
  })

  it('setEmpty is lo > hi and partial; setUnknown is the whole line', () => {
    const e = setEmpty(iv())
    expect(isEmpty(e) && e.v === PARTIAL).toBe(true)
    expect(setUnknown(iv())).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
  })

  it('setPoint is [x, x], and a NaN is empty', () => {
    expect(setPoint(iv(), 3)).toEqual({ lo: 3, hi: 3, v: CONTINUOUS })
    expect(setPoint(iv(), Infinity)).toEqual({ lo: Infinity, hi: Infinity, v: CONTINUOUS })
    expect(isEmpty(setPoint(iv(), NaN))).toBe(true)
  })

  it('setBox is an input box, empty when either end is NaN or the ends cross', () => {
    expect(setBox(iv(), 1, 2)).toEqual({ lo: 1, hi: 2, v: CONTINUOUS })
    expect(setBox(iv(), 2, 2)).toEqual({ lo: 2, hi: 2, v: CONTINUOUS })
    expect(isEmpty(setBox(iv(), 2, 1))).toBe(true)
    expect(isEmpty(setBox(iv(), NaN, 1))).toBe(true)
    expect(isEmpty(setBox(iv(), 1, NaN))).toBe(true)
  })

  it('every setter returns the out it was given', () => {
    const out = iv()
    expect(set(out, 0, 1, CONTINUOUS)).toBe(out)
    expect(setEmpty(out)).toBe(out)
    expect(setUnknown(out)).toBe(out)
    expect(setPoint(out, 1)).toBe(out)
    expect(setBox(out, 0, 1)).toBe(out)
    expect(copy(out, iv(1, 2, DEFINED))).toBe(out)
    expect(hull(out, iv(5, 6))).toBe(out)
  })

  it('copy duplicates all three fields', () => {
    expect(copy(iv(), iv(1, 2, DEFINED))).toEqual({ lo: 1, hi: 2, v: DEFINED })
  })

  it('iv defaults to the continuous point 0', () => {
    expect(iv()).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
  })
})

describe('hull', () => {
  it('widens to include the other, and takes the weaker verdict', () => {
    const h = hull(iv(0, 1, CONTINUOUS), iv(5, 6, DEFINED))
    expect(h).toEqual({ lo: 0, hi: 6, v: DEFINED })
  })

  it('an empty other changes the verdict only', () => {
    const h = hull(iv(0, 1, CONTINUOUS), setEmpty(iv()))
    expect(h).toEqual({ lo: 0, hi: 1, v: PARTIAL })
  })

  it('an empty accumulator that has seen nothing undefined takes the other whole', () => {
    const h = hull(iv(Infinity, -Infinity, CONTINUOUS), iv(2, 3, DEFINED))
    expect(h).toEqual({ lo: 2, hi: 3, v: DEFINED })
  })

  it('an empty out that is already partial stays partial', () => {
    const h = hull(setEmpty(iv()), iv(2, 3, CONTINUOUS))
    expect(h).toEqual({ lo: 2, hi: 3, v: PARTIAL })
  })

  it('may be taken from another that aliases a copy', () => {
    const a = iv(1, 2, CONTINUOUS)
    hull(a, a)
    expect(a).toEqual({ lo: 1, hi: 2, v: CONTINUOUS })
  })
})

describe('testkit', () => {
  it('mulberry32 is deterministic, in [0, 1), and differs by seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const c = mulberry32(8)
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    for (let i = 0; i < 100; i++) {
      xs.push(a())
      ys.push(b())
      zs.push(c())
    }
    expect(xs).toEqual(ys)
    expect(xs).not.toEqual(zs)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })

  it('randomBox gives finite, ordered boxes, some degenerate and some touching zero', () => {
    const rand = mulberry32(1)
    let degenerate = 0
    let touching = 0
    for (let i = 0; i < 2000; i++) {
      const [lo, hi] = randomBox(rand)
      expect(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi).toBe(true)
      if (lo === hi) degenerate++
      if (lo === 0) touching++
    }
    expect(degenerate).toBeGreaterThan(50)
    expect(touching).toBeGreaterThan(0)
  })

  it('pointsIn keeps every point inside the box and includes both ends', () => {
    const rand = mulberry32(2)
    for (let i = 0; i < 500; i++) {
      const [lo, hi] = randomBox(rand)
      const pts = pointsIn(lo, hi, rand, 6)
      expect(pts[0]).toBe(lo)
      expect(pts[1]).toBe(hi)
      expect(pts.every((x) => lo <= x && x <= hi)).toBe(true)
    }
  })

  it('zerosIn: an end that is a zero is that signed zero, a zero strictly inside is either', () => {
    expect(zerosIn(-1, 1)).toEqual([0, -0])
    expect(Object.is(zerosIn(-1, 1)[0], 0) && Object.is(zerosIn(-1, 1)[1], -0)).toBe(true)
    expect(zerosIn(0, 2).map((z) => Object.is(z, 0))).toEqual([true])
    expect(zerosIn(-0, 2).map((z) => Object.is(z, -0))).toEqual([true])
    expect(zerosIn(-2, 0).map((z) => Object.is(z, 0))).toEqual([true])
    expect(zerosIn(-2, -0).map((z) => Object.is(z, -0))).toEqual([true])
    expect(zerosIn(0, 0).map((z) => Object.is(z, 0))).toEqual([true])
    expect(zerosIn(-0, -0).map((z) => Object.is(z, -0))).toEqual([true])
    expect(zerosIn(-0, 0).map((z) => Object.is(z, -0) || Object.is(z, 0))).toEqual([true, true])
    expect(zerosIn(1, 2)).toEqual([])
    expect(zerosIn(-3, -1)).toEqual([])
  })

  it('pointsIn includes the signed zeros a box holds, and survives a width that overflows', () => {
    const rand = mulberry32(3)
    const across = pointsIn(-1, 1, rand, 4)
    expect(across.some((x) => Object.is(x, 0)) && across.some((x) => Object.is(x, -0))).toBe(true)
    const wide = pointsIn(-1.5e308, 1.5e308, rand, 20)
    expect(wide.every((x) => Number.isFinite(x) && -1.5e308 <= x && x <= 1.5e308)).toBe(true)
    const end = pointsIn(-0, 2, rand, 4)
    expect(end.some((x) => Object.is(x, 0))).toBe(false)
  })

  it('admits holds the contract: finite inside, NaN only under a partial verdict, an infinity only by an infinite bound', () => {
    const cont = iv(0, 1, CONTINUOUS)
    expect(admits(cont, 0.5)).toBe(true)
    expect(admits(cont, 1.5)).toBe(false)
    expect(admits(cont, NaN)).toBe(false)
    expect(admits(cont, Infinity)).toBe(false)
    expect(admits(cont, -Infinity)).toBe(false)
    expect(admits(iv(0, Infinity, CONTINUOUS), Infinity)).toBe(true)
    expect(admits(iv(0, Infinity, CONTINUOUS), -Infinity)).toBe(false)
    expect(admits(iv(-Infinity, 0, DEFINED), -Infinity)).toBe(true)
    const part = iv(0, 1, PARTIAL)
    expect(admits(part, NaN)).toBe(true)
    expect(admits(part, 2)).toBe(false)
    expect(admits(iv(0, 1, UNKNOWN), NaN)).toBe(true)
    // strict infinities: a partial verdict does not excuse one, and neither does an empty answer
    expect(admits(part, Infinity)).toBe(false)
    expect(admits(part, -Infinity)).toBe(false)
    expect(admits(iv(0, Infinity, PARTIAL), Infinity)).toBe(true)
    expect(admits(iv(-Infinity, 1, PARTIAL), -Infinity)).toBe(true)
    expect(admits(iv(Infinity, -Infinity, PARTIAL), Infinity)).toBe(false)
    expect(admits(iv(Infinity, -Infinity, PARTIAL), -Infinity)).toBe(false)
    expect(admits(iv(Infinity, -Infinity, PARTIAL), 3)).toBe(false)
    expect(admits(iv(Infinity, -Infinity, PARTIAL), NaN)).toBe(true)
    expect(admits(iv(Infinity, Infinity, PARTIAL), Infinity)).toBe(true)
  })
})
