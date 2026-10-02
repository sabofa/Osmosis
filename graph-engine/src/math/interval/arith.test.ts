import { describe, expect, it } from 'vitest'
import { CONTINUOUS, DEFINED, iv, PARTIAL, setBox, type Iv } from './core'
import { add, div, mul, neg, powGeneral, powInt, powOddRoot, powReal, sides, sub } from './arith'
import { realOddPow } from '../rational'
import { admits, mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

const box = (lo: number, hi: number): Iv => setBox(iv(), lo, hi)
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b))
const fmt = (x: number): string => (Object.is(x, -0) ? '-0' : String(x))
const show = (r: Iv): string => `[${fmt(r.lo)}, ${fmt(r.hi)}] v${r.v}`

describe('arithmetic is tight on simple boxes', () => {
  it('add, sub, neg, mul', () => {
    const r = add(iv(), box(1, 2), box(10, 20))
    expect(near(r.lo, 11) && near(r.hi, 22) && r.v === CONTINUOUS).toBe(true)
    const s = sub(iv(), box(1, 2), box(10, 20))
    expect(near(s.lo, -19) && near(s.hi, -8)).toBe(true)
    expect(neg(iv(), box(1, 2))).toEqual({ lo: -2, hi: -1, v: CONTINUOUS })
    const m = mul(iv(), box(-1, 2), box(3, 4))
    expect(near(m.lo, -4) && near(m.hi, 8)).toBe(true)
  })

  it('div away from zero is continuous; across or touching zero is partial', () => {
    const d = div(iv(), box(1, 2), box(4, 8))
    expect(near(d.lo, 0.125) && near(d.hi, 0.5) && d.v === CONTINUOUS).toBe(true)
    expect(div(iv(), box(1, 2), box(-1, 1))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const touch = div(iv(), box(1, 2), box(0, 1))
    expect(near(touch.lo, 1) && touch.hi === Infinity && touch.v === PARTIAL).toBe(true)
  })

  it('integer powers', () => {
    const sq = powInt(iv(), box(-1, 2), 2)
    expect(near(sq.lo, 0) && near(sq.hi, 4) && sq.v === CONTINUOUS).toBe(true)
    const cube = powInt(iv(), box(-2, 1), 3)
    expect(near(cube.lo, -8) && near(cube.hi, 1)).toBe(true)
    expect(powInt(iv(), box(-1, 1), -1).v).toBe(PARTIAL)
    const inv = powInt(iv(), box(1, 4), -2)
    expect(near(inv.lo, 1 / 16) && near(inv.hi, 1)).toBe(true)
    expect(powInt(iv(), box(-3, 5), 0)).toMatchObject({ lo: 1, hi: 1, v: CONTINUOUS })
  })

  it('a real exponent needs a non-negative base', () => {
    const r = powReal(iv(), box(4, 9), 0.5)
    expect(near(r.lo, 2) && near(r.hi, 3) && r.v === CONTINUOUS).toBe(true)
    const clipped = powReal(iv(), box(-4, 9), 0.5)
    expect(near(clipped.lo, 0) && near(clipped.hi, 3) && clipped.v === PARTIAL).toBe(true)
    expect(powReal(iv(), box(0, 1), -0.5)).toMatchObject({ hi: Infinity, v: PARTIAL })
  })

  it('a real odd root crosses zero continuously', () => {
    const r = powOddRoot(iv(), box(-8, 27), 1 / 3, true)
    expect(near(r.lo, -2) && near(r.hi, 3) && r.v === CONTINUOUS).toBe(true)
    const even = powOddRoot(iv(), box(-8, 1), 2 / 3, false)
    expect(near(even.lo, 0) && near(even.hi, 4) && even.v === CONTINUOUS).toBe(true)
    expect(powOddRoot(iv(), box(-1, 1), -1 / 3, true).v).toBe(PARTIAL)
  })

  it('an interval exponent over a positive base takes the corners', () => {
    const r = powGeneral(iv(), box(2, 3), box(1, 2))
    expect(near(r.lo, 2) && near(r.hi, 9) && r.v === CONTINUOUS).toBe(true)
    expect(powGeneral(iv(), box(-1, 3), box(1, 2)).v).toBe(PARTIAL)
  })

  it('verdicts propagate as the weakest', () => {
    expect(add(iv(), iv(0, 1, DEFINED), box(0, 1)).v).toBe(DEFINED)
    expect(mul(iv(), iv(0, 1, PARTIAL), box(0, 1)).v).toBe(PARTIAL)
    expect(powInt(iv(), iv(1, 2, DEFINED), 2).v).toBe(DEFINED)
    expect(powInt(iv(), iv(1, 2, DEFINED), 0).v).toBe(DEFINED)
    expect(powGeneral(iv(), iv(1, 2, DEFINED), box(2, 2)).v).toBe(DEFINED)
    expect(powGeneral(iv(), box(1, 2), iv(2, 2, DEFINED)).v).toBe(DEFINED)
    expect(powGeneral(iv(), box(1, 2), iv(1, 2, DEFINED)).v).toBe(DEFINED)
  })

  it('an empty operand gives an empty, partial result', () => {
    const r = add(iv(), iv(Infinity, -Infinity, PARTIAL), box(0, 1))
    expect(r.lo > r.hi && r.v === PARTIAL).toBe(true)
    const empty = iv(Infinity, -Infinity, PARTIAL)
    for (const r2 of [
      sub(iv(), box(0, 1), empty),
      mul(iv(), empty, box(0, 1)),
      div(iv(), box(1, 2), empty),
      neg(iv(), empty),
      powInt(iv(), empty, 2),
      powReal(iv(), empty, 0.5),
      powOddRoot(iv(), empty, 1 / 3, true),
      powGeneral(iv(), box(1, 2), empty),
    ]) {
      expect(r2.lo > r2.hi && r2.v === PARTIAL).toBe(true)
    }
  })

  it('out may alias an input', () => {
    const a = box(1, 2)
    add(a, a, box(10, 20))
    expect(near(a.lo, 11) && near(a.hi, 22)).toBe(true)
    const b = box(10, 20)
    sub(b, box(1, 2), b)
    expect(near(b.lo, -19) && near(b.hi, -8)).toBe(true)
    const c = box(-1, 2)
    mul(c, c, c)
    expect(near(c.lo, -2) && near(c.hi, 4)).toBe(true)
    const d = box(4, 8)
    div(d, box(1, 2), d)
    expect(near(d.lo, 0.125) && near(d.hi, 0.5)).toBe(true)
    const e = box(1, 2)
    neg(e, e)
    expect(e).toEqual({ lo: -2, hi: -1, v: CONTINUOUS })
    const f = box(-1, 2)
    powInt(f, f, 2)
    expect(near(f.lo, 0) && near(f.hi, 4)).toBe(true)
    const g = box(4, 9)
    powReal(g, g, 0.5)
    expect(near(g.lo, 2) && near(g.hi, 3)).toBe(true)
    const h = box(-8, 27)
    powOddRoot(h, h, 1 / 3, true)
    expect(near(h.lo, -2) && near(h.hi, 3)).toBe(true)
    const i = box(2, 3)
    powGeneral(i, i, box(1, 2))
    expect(near(i.lo, 2) && near(i.hi, 9)).toBe(true)
    const j = box(1, 2)
    powGeneral(j, box(2, 3), j)
    expect(near(j.lo, 2) && near(j.hi, 9)).toBe(true)
    const k = box(2, 2)
    powGeneral(k, box(2, 3), k)
    expect(near(k.lo, 4) && near(k.hi, 9)).toBe(true)
  })

  it('every twin returns the out it was given', () => {
    const out = iv()
    const a = box(1, 2)
    const b = box(3, 4)
    expect(add(out, a, b)).toBe(out)
    expect(sub(out, a, b)).toBe(out)
    expect(mul(out, a, b)).toBe(out)
    expect(div(out, a, b)).toBe(out)
    expect(neg(out, a)).toBe(out)
    expect(powInt(out, a, 2)).toBe(out)
    expect(powInt(out, a, 0)).toBe(out)
    expect(powReal(out, a, 0.5)).toBe(out)
    expect(powOddRoot(out, a, 1 / 3, true)).toBe(out)
    expect(powGeneral(out, a, b)).toBe(out)
    expect(powGeneral(out, a, box(2, 2))).toBe(out)
    expect(sides(out, a, Math.cosh, 1)).toBe(out)
  })
})

describe('infinities and zero are flagged', () => {
  const inf = (lo: number, hi: number) => iv(lo, hi, CONTINUOUS)

  it('opposite infinities in a sum or difference may be NaN', () => {
    expect(add(iv(), inf(0, Infinity), inf(-Infinity, 0)).v).toBe(PARTIAL)
    expect(add(iv(), inf(-Infinity, 0), inf(0, Infinity)).v).toBe(PARTIAL)
    expect(add(iv(), inf(0, Infinity), box(1, 2)).v).toBe(CONTINUOUS)
    expect(sub(iv(), inf(0, Infinity), inf(0, Infinity)).v).toBe(PARTIAL)
    expect(sub(iv(), inf(-Infinity, 0), inf(-Infinity, 0)).v).toBe(PARTIAL)
    expect(sub(iv(), inf(0, Infinity), inf(-Infinity, 0)).v).toBe(CONTINUOUS)
  })

  it('zero times infinity may be NaN', () => {
    const r = mul(iv(), inf(-Infinity, 2), box(0, 3))
    expect(r.v).toBe(PARTIAL)
    expect(r.lo).toBe(-Infinity)
    expect(r.hi).toBeGreaterThanOrEqual(6)
    expect(mul(iv(), box(0, 3), inf(1, Infinity)).v).toBe(PARTIAL)
    expect(mul(iv(), inf(1, Infinity), box(2, 3)).v).toBe(CONTINUOUS)
    expect(mul(iv(), box(2, 3), inf(1, Infinity)).v).toBe(CONTINUOUS)
  })

  it('infinity over infinity is not a number, and a zero divisor is undefined', () => {
    expect(div(iv(), inf(1, Infinity), inf(2, Infinity)).v).toBe(PARTIAL)
    // a divisor of exactly zero is +-infinity (or NaN for 0 / 0), never "nothing":
    // 1 / (1 / 0) is 0 downstream
    expect(div(iv(), box(1, 2), box(0, 0))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(div(iv(), box(1, 2), box(-0, -0))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(div(iv(), box(-1, 1), box(0, 0))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const zeroOverZero = div(iv(), box(0, 0), box(0, 0))
    expect(zeroOverZero.lo > zeroOverZero.hi && zeroOverZero.v === PARTIAL).toBe(true)
    // a pole at the divisor's zero end sends the quotient to infinity on one side,
    // when the zero has the sign of the side the rest of the box lies on
    const negOverPos = div(iv(), box(-2, -1), box(0, 4))
    expect(negOverPos.lo).toBe(-Infinity)
    expect(near(negOverPos.hi, -0.25)).toBe(true)
    expect(negOverPos.v).toBe(PARTIAL)
    const negOverNeg = div(iv(), box(-2, -1), box(-4, -0))
    expect(near(negOverNeg.lo, 0.25)).toBe(true)
    expect(negOverNeg.hi).toBe(Infinity)
    expect(negOverNeg.v).toBe(PARTIAL)
    const posOverNeg = div(iv(), box(1, 2), box(-4, -0))
    expect(posOverNeg.lo).toBe(-Infinity)
    expect(near(posOverNeg.hi, -0.25)).toBe(true)
    expect(posOverNeg.v).toBe(PARTIAL)
  })

  it('a divisor zero of the wrong sign for its side reaches the other infinity too', () => {
    // 1 / -0 is -infinity, but the rest of [-0, 4] lies on the positive side
    expect(div(iv(), box(1, 2), box(-0, 4))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    // 1 / +0 is +infinity, but the rest of [-4, +0] lies on the negative side
    expect(div(iv(), box(1, 2), box(-4, 0))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(div(iv(), box(-2, -1), box(-0, 4))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(div(iv(), box(-2, -1), box(-4, 0))).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    // a signed zero of the right sign keeps the one-sided answer
    const keep = div(iv(), box(1, 2), box(0, 1))
    expect(near(keep.lo, 1) && keep.hi === Infinity && keep.v === PARTIAL).toBe(true)
  })

  it('a base of -infinity is not NaN for a real exponent, and an infinite exponent is not either', () => {
    // Math.pow(-Infinity, 2.5) is Infinity and Math.pow(-Infinity, -2.5) is 0
    const toInf = powReal(iv(), inf(-Infinity, 0), -2.5)
    expect(toInf.lo).toBeLessThanOrEqual(0)
    expect(toInf.hi).toBe(Infinity)
    expect(toInf.v).toBe(PARTIAL)
    const pointInf = powReal(iv(), inf(-Infinity, -Infinity), 0.5)
    expect(pointInf.lo).toBe(Infinity)
    expect(pointInf.hi).toBe(Infinity)
    expect(pointInf.v).toBe(PARTIAL)
    // Math.pow(-2, -Infinity) is 0 and Math.pow(-0.5, Infinity) is 0: neither is empty
    for (const [lo, hi, e] of [[-2, -1.5, -Infinity], [-0.5, -0.2, Infinity], [-3, 2, Infinity], [0.5, 2, -Infinity]]) {
      const r = powReal(iv(), box(lo, hi), e)
      expect(r.lo).toBe(0)
      expect(r.hi).toBe(Infinity)
      expect(r.v).toBe(PARTIAL)
    }
    expect(powGeneral(iv(), box(-2, -1.5), box(-Infinity, -Infinity))).toMatchObject({ lo: 0, hi: Infinity, v: PARTIAL })
  })

  it('an overflow lands on the infinite side', () => {
    expect(mul(iv(), box(1e200, 1e201), box(1e200, 1e201)).hi).toBe(Infinity)
    expect(add(iv(), box(1.7e308, 1.7e308), box(1.7e308, 1.7e308)).hi).toBe(Infinity)
  })

  it('overflow is not undefinedness: the verdict stays, the bound becomes infinite', () => {
    const cube = powInt(iv(), box(1e200, 1e201), 3)
    expect(cube.hi).toBe(Infinity)
    expect(cube.v).toBe(CONTINUOUS)
    expect(mul(iv(), box(1e200, 1e201), box(1e200, 1e201)).v).toBe(CONTINUOUS)
    expect(powInt(iv(), box(1e200, 1e201), 2).v).toBe(mul(iv(), box(1e200, 1e201), box(1e200, 1e201)).v)
    expect(powInt(iv(), box(1e-200, 1e-100), -3)).toMatchObject({ hi: Infinity, v: CONTINUOUS })
    expect(powInt(iv(), iv(1e200, 1e201, DEFINED), 2).v).toBe(DEFINED)
    expect(powReal(iv(), box(1e100, 1e210), 1.5)).toMatchObject({ hi: Infinity, v: CONTINUOUS })
    expect(powOddRoot(iv(), box(-1e200, 1e201), 5 / 3, true)).toMatchObject({ lo: -Infinity, hi: Infinity, v: CONTINUOUS })
    expect(powGeneral(iv(), box(1e100, 1e101), box(5, 6))).toMatchObject({ hi: Infinity, v: CONTINUOUS })
    expect(powGeneral(iv(), box(2, 3), box(1000, 2000))).toMatchObject({ hi: Infinity, v: CONTINUOUS })
    expect(sides(iv(), box(1, 800), Math.cosh, 1)).toMatchObject({ hi: Infinity, v: CONTINUOUS })
  })

  it('a base of 1 under an infinite exponent is NaN', () => {
    // Math.pow(1, Infinity) is NaN in JavaScript, and no corner of [0.5, 2] x [1, Infinity] shows it
    expect(powGeneral(iv(), box(0.5, 2), box(1, Infinity)).v).toBe(PARTIAL)
    expect(powGeneral(iv(), box(0.5, 2), box(-Infinity, 3)).v).toBe(PARTIAL)
    expect(powGeneral(iv(), box(1.5, 2), box(1, Infinity)).v).toBe(CONTINUOUS)
    expect(powGeneral(iv(), box(2, 3), box(1, 2)).v).toBe(CONTINUOUS)
  })
})

describe('poles and holes at zero', () => {
  it('a negative integer power approaches its pole from the side its zero shows', () => {
    // [-2, -0]: the zero end is -0 and 1 / -0 is -infinity, the side of the rest
    const left = powInt(iv(), box(-2, -0), -1)
    expect(left.lo).toBe(-Infinity)
    expect(near(left.hi, -0.5)).toBe(true)
    expect(left.v).toBe(PARTIAL)
    // [0, 2]: +0, and 1 / +0 is +infinity
    const right = powInt(iv(), box(0, 2), -1)
    expect(near(right.lo, 0.5)).toBe(true)
    expect(right.hi).toBe(Infinity)
    expect(right.v).toBe(PARTIAL)
  })

  it('a zero end of the other sign reaches the other infinity too', () => {
    // 1 / -0 is -infinity: [-0, 2] holds a value below every positive one
    expect(powInt(iv(), box(-0, 2), -1)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    // 1 / +0 is +infinity: [-2, +0] holds a value above every negative one
    expect(powInt(iv(), box(-2, 0), -1)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(powInt(iv(), box(-1, 1), -1)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
  })

  it('an even negative power across zero is bounded below', () => {
    const r = powInt(iv(), box(-1, 3), -2)
    expect(near(r.lo, 1 / 9)).toBe(true)
    expect(r.hi).toBe(Infinity)
    expect(r.v).toBe(PARTIAL)
  })

  it('the point zero under a pole is the infinity the scalar gives there, not empty', () => {
    expect(powInt(iv(), box(0, 0), -1)).toMatchObject({ lo: Infinity, hi: Infinity, v: PARTIAL })
    expect(powInt(iv(), box(-0, -0), -1)).toMatchObject({ lo: -Infinity, hi: -Infinity, v: PARTIAL })
    expect(powInt(iv(), box(0, 0), -2)).toMatchObject({ lo: Infinity, hi: Infinity, v: PARTIAL })
    expect(powInt(iv(), box(-0, -0), -2)).toMatchObject({ lo: Infinity, hi: Infinity, v: PARTIAL })
    // Math.pow(-0, -1/3) is +Infinity: realOddPow reads -0 as not negative
    expect(powOddRoot(iv(), box(-0, 0), -1 / 3, true)).toMatchObject({ lo: Infinity, hi: Infinity, v: PARTIAL })
    // only a hole (NaN at zero) leaves nothing
    const hole = (x: number): number => (x === 0 ? Number.NaN : 1 / x)
    const r = sides(iv(), box(0, 0), hole, Number.NaN)
    expect(r.lo > r.hi && r.v === PARTIAL).toBe(true)
    const across = sides(iv(), box(-1, 1), hole, Number.NaN)
    expect(across.v).toBe(PARTIAL)
    expect(across.lo).toBeLessThanOrEqual(-1)
    expect(across.hi).toBeGreaterThanOrEqual(1)
  })

  it('a negative odd root keeps both sides of its pole and the infinity at zero', () => {
    // the zero end is +0 and the scalar value there is +Infinity
    const left = powOddRoot(iv(), box(-8, 0), -1 / 3, true)
    expect(left.hi).toBe(Infinity)
    expect(left.lo).toBeLessThan(-1e100)
    expect(left.v).toBe(PARTIAL)
    const right = powOddRoot(iv(), box(0, 8), -1 / 3, true)
    expect(near(right.lo, 0.5)).toBe(true)
    expect(right.hi).toBe(Infinity)
    expect(right.v).toBe(PARTIAL)
    const even = powOddRoot(iv(), box(-8, 8), -2 / 3, false)
    expect(near(even.lo, 0.25)).toBe(true)
    expect(even.hi).toBe(Infinity)
    expect(even.v).toBe(PARTIAL)
  })

  it('a pole away from the box changes nothing', () => {
    const r = powInt(iv(), box(-4, -2), -1)
    expect(near(r.lo, -0.5) && near(r.hi, -0.25) && r.v === CONTINUOUS).toBe(true)
  })

  it('a zero exponent is 1 even when the base is undefined', () => {
    const empty = iv(Infinity, -Infinity, PARTIAL)
    // Math.pow(NaN, 0) is 1
    expect(powInt(iv(), empty, 0)).toMatchObject({ lo: 1, hi: 1, v: PARTIAL })
    expect(powGeneral(iv(), empty, box(0, 0))).toMatchObject({ lo: 1, hi: 1, v: PARTIAL })
    expect(powGeneral(iv(), empty, box(-1, 1))).toMatchObject({ lo: 1, hi: 1, v: PARTIAL })
    expect(powGeneral(iv(), empty, box(-0, -0))).toMatchObject({ lo: 1, hi: 1, v: PARTIAL })
    // any other exponent leaves NaN
    for (const r of [powGeneral(iv(), empty, box(1, 2)), powGeneral(iv(), empty, box(2, 2)), powInt(iv(), empty, 2), powGeneral(iv(), box(1, 2), empty)]) {
      expect(r.lo > r.hi && r.v === PARTIAL).toBe(true)
    }
  })
})

describe('sides', () => {
  it('bounds a function monotone on each side of zero', () => {
    const r = sides(iv(), box(-2, 3), Math.cosh, 1)
    expect(near(r.lo, 1) && near(r.hi, Math.cosh(3)) && r.v === CONTINUOUS).toBe(true)
    const m = sides(iv(), box(-4, 1), Math.abs, 0)
    expect(near(m.lo, 0) && near(m.hi, 4) && m.v === CONTINUOUS).toBe(true)
    const one = sides(iv(), box(2, 3), Math.abs, 0)
    expect(near(one.lo, 2) && near(one.hi, 3)).toBe(true)
  })

  it('a NaN end value makes it partial, with no bound on that side', () => {
    const r = sides(iv(), box(1, 2), (x) => (x > 1.5 ? Number.NaN : x), 0)
    expect(r.v).toBe(PARTIAL)
    expect(r.hi).toBe(Infinity)
  })

  it('an overflowing end value keeps the verdict', () => {
    expect(sides(iv(), box(1, 800), Math.cosh, 1)).toMatchObject({ hi: Infinity, v: CONTINUOUS })
  })

  it('a function argument is passed through', () => {
    const r = sides(iv(), box(1, 2), Math.pow, 0, undefined, 3)
    expect(near(r.lo, 1) && near(r.hi, 8)).toBe(true)
  })
})

describe('arithmetic is sound over random boxes', () => {
  const rand = mulberry32(20261002)
  const cases: [string, (a: Iv, b: Iv) => Iv, (x: number, y: number) => number][] = [
    ['add', (a, b) => add(iv(), a, b), (x, y) => x + y],
    ['sub', (a, b) => sub(iv(), a, b), (x, y) => x - y],
    ['mul', (a, b) => mul(iv(), a, b), (x, y) => x * y],
    ['div', (a, b) => div(iv(), a, b), (x, y) => x / y],
    ['pow', (a, b) => powGeneral(iv(), a, b), (x, y) => Math.pow(x, y)],
  ]
  for (const [name, twin, scalar] of cases) {
    it(name, () => {
      for (let i = 0; i < 400; i++) {
        const [al, ah] = randomBox(rand)
        const [bl, bh] = randomBox(rand)
        const r = twin(box(al, ah), box(bl, bh))
        for (const x of pointsIn(al, ah, rand, 4)) {
          for (const y of pointsIn(bl, bh, rand, 4)) {
            expect(admits(r, scalar(x, y)), `${name} [${fmt(al)}, ${fmt(ah)}] [${fmt(bl)}, ${fmt(bh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(scalar(x, y))} outside ${show(r)}`).toBe(true)
          }
        }
      }
    })
  }

  it('powInt, powReal and powOddRoot', () => {
    for (let i = 0; i < 400; i++) {
      const [lo, hi] = randomBox(rand)
      const n = Math.round(rand() * 10 - 5)
      const e = rand() * 6 - 3
      const q = [3, 5, 7][Math.floor(rand() * 3)]
      const p = Math.round(rand() * 8 - 4) || 1
      const ri = powInt(iv(), box(lo, hi), n)
      const rr = powReal(iv(), box(lo, hi), e)
      const ro = powOddRoot(iv(), box(lo, hi), p / q, Math.abs(p) % 2 === 1)
      for (const x of pointsIn(lo, hi, rand, 8)) {
        expect(admits(ri, Math.pow(x, n)), `x^${n} at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(ri)}`).toBe(true)
        expect(admits(rr, Math.pow(x, e)), `x^${e} at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(rr)}`).toBe(true)
        expect(admits(ro, realOddPow(x, p / q, Math.abs(p) % 2 === 1)), `x^(${p}/${q}) at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(ro)}`).toBe(true)
      }
    }
  })
})

// Boxes the random generator rarely reaches: infinite ends, both signs of zero,
// subnormals, and values near overflow. The test points include the infinities
// and signed zeros the box admits (an operand with an infinite end really may
// produce that infinity).
describe('arithmetic is sound on the edge boxes', () => {
  const BOXES: [number, number][] = [
    [-Infinity, Infinity],
    [0, Infinity],
    [-Infinity, 0],
    [1, Infinity],
    [-Infinity, -1],
    [0, 0],
    [-0, 0],
    [-0, 2],
    [0, 2],
    [-2, 0],
    [-2, -0],
    [-0, -0],
    [-0, Infinity],
    [-Infinity, -0],
    [0, 1e-300],
    [-1e-300, -0],
    [-1, 1],
    [-1e-300, 1e-300],
    [5e-324, 1e-300],
    [-5e-324, 5e-324],
    [1e154, 1e155],
    [-1e154, 1e155],
    [1e300, 1.5e308],
    [0.5, 2],
    [-3, -1],
    [1, 1],
  ]
  const CANDIDATES = [-Infinity, -1e300, -1e154, -2, -1, -0.5, -5e-324, 5e-324, 0.5, 1, 2, 1e154, 1e300, Infinity]
  // the signed zeros a box holds come from zerosIn (an end that is a zero is that signed
  // zero; a zero strictly inside may be either); no other candidate is a zero, so a
  // midpoint that rounds to +0 in a box that starts at -0 is not a point of the box
  const pointsOf = (lo: number, hi: number): number[] =>
    [lo, hi, (lo + hi) / 2, ...CANDIDATES].filter((x) => x !== 0 && lo <= x && x <= hi).concat(zerosIn(lo, hi))

  const binary: [string, (a: Iv, b: Iv) => Iv, (x: number, y: number) => number][] = [
    ['add', (a, b) => add(iv(), a, b), (x, y) => x + y],
    ['sub', (a, b) => sub(iv(), a, b), (x, y) => x - y],
    ['mul', (a, b) => mul(iv(), a, b), (x, y) => x * y],
    ['div', (a, b) => div(iv(), a, b), (x, y) => x / y],
    ['pow', (a, b) => powGeneral(iv(), a, b), (x, y) => Math.pow(x, y)],
  ]
  for (const [name, twin, scalar] of binary) {
    it(name, () => {
      for (const [al, ah] of BOXES) {
        for (const [bl, bh] of BOXES) {
          const r = twin(box(al, ah), box(bl, bh))
          for (const x of pointsOf(al, ah)) {
            for (const y of pointsOf(bl, bh)) {
              expect(admits(r, scalar(x, y)), `${name} [${fmt(al)}, ${fmt(ah)}] [${fmt(bl)}, ${fmt(bh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(scalar(x, y))} outside ${show(r)}`).toBe(true)
            }
          }
        }
      }
    })
  }

  it('powInt, powReal and powOddRoot', () => {
    for (const [lo, hi] of BOXES) {
      const pts = pointsOf(lo, hi)
      for (const n of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
        const r = powInt(iv(), box(lo, hi), n)
        for (const x of pts) expect(admits(r, Math.pow(x, n)), `x^${n} at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(r)}`).toBe(true)
      }
      for (const e of [-2.5, -1.5, -0.5, 0.25, 0.5, 1.5, 2.5]) {
        const r = powReal(iv(), box(lo, hi), e)
        for (const x of pts) expect(admits(r, Math.pow(x, e)), `x^${e} at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(r)}`).toBe(true)
      }
      for (const [p, q] of [[1, 3], [2, 3], [4, 3], [5, 3], [-1, 3], [-2, 3], [-5, 3], [1, 5], [-3, 5]]) {
        const pOdd = Math.abs(p) % 2 === 1
        const r = powOddRoot(iv(), box(lo, hi), p / q, pOdd)
        for (const x of pts) expect(admits(r, realOddPow(x, p / q, pOdd)), `x^(${p}/${q}) at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(r)}`).toBe(true)
      }
    }
  })

  it('sides for the functions the elementary twins use', () => {
    for (const [lo, hi] of BOXES) {
      const pts = pointsOf(lo, hi)
      const cosh = sides(iv(), box(lo, hi), Math.cosh, 1)
      const abs = sides(iv(), box(lo, hi), Math.abs, 0)
      for (const x of pts) {
        expect(admits(cosh, Math.cosh(x)), `cosh at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(cosh)}`).toBe(true)
        expect(admits(abs, Math.abs(x)), `abs at ${fmt(x)} over [${fmt(lo)}, ${fmt(hi)}] outside ${show(abs)}`).toBe(true)
      }
    }
  })
})

// A twin is only as sound as the twins that consume its answer: an infinity that
// one twin leaves out becomes a wrong finite value in the next (c / inf is 0,
// e^-inf is 0, 1 / (1 / 0) is 0). Each case below chains twins over a box and
// checks the scalar chain at the box's ends, the signed zeros it holds and a few
// interior points, for every sign a zero end can have.
describe('composed twins stay sound', () => {
  const pt = (x: number): Iv => setBox(iv(), x, x)
  const INTERIOR = [-8, -2, -1.5, -1, -0.5, -0.25, -1e-3, -1e-300, 1e-300, 1e-3, 0.25, 0.5, 1, 2, 8]
  const samples = (lo: number, hi: number): number[] =>
    [lo, hi, ...INTERIOR].filter((x) => lo <= x && x <= hi).concat(zerosIn(lo, hi))
  // the boxes a zero end allows: each zero end as +0 and as -0
  const withZeroSigns = (lo: number, hi: number): [number, number][] => {
    const los = lo === 0 ? [0, -0] : [lo]
    const his = hi === 0 ? [0, -0] : [hi]
    const out: [number, number][] = []
    for (const l of los) for (const h of his) out.push([l, h])
    return out
  }

  function sound(name: string, lo: number, hi: number, twin: (a: Iv) => Iv, scalar: (x: number) => number): void {
    for (const [l, h] of withZeroSigns(lo, hi)) {
      const r = twin(box(l, h))
      for (const x of samples(l, h)) {
        expect(admits(r, scalar(x)), `${name} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(scalar(x))}, twin ${show(r)}`).toBe(true)
      }
    }
  }

  it('an infinity at a zero is mapped back to a finite value by the next twin', () => {
    sound('1/x^(-2/3)', -1, 1, (a) => div(iv(), pt(1), powOddRoot(iv(), a, -2 / 3, false)), (x) => 1 / realOddPow(x, -2 / 3, false))
    sound('1/x^(-1/3)', -8, 0, (a) => div(iv(), pt(1), powOddRoot(iv(), a, -1 / 3, true)), (x) => 1 / realOddPow(x, -1 / 3, true))
    sound('1/(1 + x^(-2/3))', -1, 1, (a) => div(iv(), pt(1), add(iv(), pt(1), powOddRoot(iv(), a, -2 / 3, false))), (x) => 1 / (1 + realOddPow(x, -2 / 3, false)))
    sound('(x^(-1/3))^-2', -1, 1, (a) => powInt(iv(), powOddRoot(iv(), a, -1 / 3, true), -2), (x) => Math.pow(realOddPow(x, -1 / 3, true), -2))
    sound('1/(1 + x^-2)', 0, 0, (a) => div(iv(), pt(1), add(iv(), pt(1), powInt(iv(), a, -2))), (x) => 1 / (1 + Math.pow(x, -2)))
    sound('1/(1 + x^-2) across zero', -1, 1, (a) => div(iv(), pt(1), add(iv(), pt(1), powInt(iv(), a, -2))), (x) => 1 / (1 + Math.pow(x, -2)))
  })

  it('an infinite exponent from a quotient reaches the base as a finite value', () => {
    sound('e^(-1/x)', -1, 0, (a) => powGeneral(iv(), pt(Math.E), div(iv(), pt(-1), a)), (x) => Math.pow(Math.E, -1 / x))
    sound('2^(-1/x)', -0.25, 0, (a) => powGeneral(iv(), pt(2), div(iv(), pt(-1), a)), (x) => Math.pow(2, -1 / x))
    sound('e^(-(x^-1))', -2, 0, (a) => powGeneral(iv(), pt(Math.E), neg(iv(), powInt(iv(), a, -1))), (x) => Math.pow(Math.E, -Math.pow(x, -1)))
    sound('e^(-1/x) across zero', -1, 1, (a) => powGeneral(iv(), pt(Math.E), div(iv(), pt(-1), a)), (x) => Math.pow(Math.E, -1 / x))
  })

  it('a quotient of a quotient by exactly zero', () => {
    sound('1/(1/x)', 0, 0, (a) => div(iv(), pt(1), div(iv(), pt(1), a)), (x) => 1 / (1 / x))
    sound('1/(1/x) on [-1, 0]', -1, 0, (a) => div(iv(), pt(1), div(iv(), pt(1), a)), (x) => 1 / (1 / x))
    sound('1/(1/x) on [0, 1]', 0, 1, (a) => div(iv(), pt(1), div(iv(), pt(1), a)), (x) => 1 / (1 / x))
    sound('1/(1/x) across zero', -1, 1, (a) => div(iv(), pt(1), div(iv(), pt(1), a)), (x) => 1 / (1 / x))
    sound('x/(x/x)', 0, 0, (a) => div(iv(), a, div(iv(), a, a)), (x) => x / (x / x))
  })

  it('a zero exponent is 1 even when the base is NaN', () => {
    sound('(x^0.5)^0', -2, -1, (a) => powGeneral(iv(), powReal(iv(), a, 0.5), pt(0)), (x) => Math.pow(Math.pow(x, 0.5), 0))
    const r = powGeneral(iv(), powReal(iv(), box(-2, -1), 0.5), box(-1, 1))
    expect(admits(r, Math.pow(Math.pow(-1.5, 0.5), 0))).toBe(true)
    expect(admits(r, Math.pow(Math.pow(-1.5, 0.5), 0.3))).toBe(true)
    expect(r.v).toBe(PARTIAL)
  })

  // Random chains of two or three twins, each against the chained scalar ops, over
  // the edge boxes (infinite ends, signed zeros, subnormals) and random boxes.
  describe('random chains', () => {
    interface Expr {
      src: string
      twin: (x: Iv) => Iv
      scalar: (x: number) => number
    }
    const CONSTANTS = [0, 1, -1, 2, 0.5, -0.5, 3, Math.E]
    function leaf(rand: () => number): Expr {
      if (rand() < 0.6) return { src: 'x', twin: (x) => x, scalar: (x) => x }
      const c = CONSTANTS[Math.floor(rand() * CONSTANTS.length)]
      return { src: String(c), twin: () => pt(c), scalar: () => c }
    }
    function build(rand: () => number, depth: number): Expr {
      if (depth === 0) return leaf(rand)
      const k = Math.floor(rand() * 9)
      const a = build(rand, depth - 1)
      if (k < 4) {
        if (k === 0) return { src: `-(${a.src})`, twin: (x) => neg(iv(), a.twin(x)), scalar: (x) => -a.scalar(x) }
        if (k === 1) {
          const n = [-3, -2, -1, 0, 2, 3, 4][Math.floor(rand() * 7)]
          return { src: `(${a.src})^${n}`, twin: (x) => powInt(iv(), a.twin(x), n), scalar: (x) => Math.pow(a.scalar(x), n) }
        }
        if (k === 2) {
          const e = [0.5, -0.5, 1.5, -1.5, 2.5][Math.floor(rand() * 5)]
          return { src: `(${a.src})^${e}`, twin: (x) => powReal(iv(), a.twin(x), e), scalar: (x) => Math.pow(a.scalar(x), e) }
        }
        const [p, q] = [[1, 3], [2, 3], [-1, 3], [-2, 3], [4, 3], [-3, 5]][Math.floor(rand() * 6)]
        const pOdd = Math.abs(p) % 2 === 1
        return { src: `(${a.src})^(${p}/${q})`, twin: (x) => powOddRoot(iv(), a.twin(x), p / q, pOdd), scalar: (x) => realOddPow(a.scalar(x), p / q, pOdd) }
      }
      const b = build(rand, depth - 1)
      const ops: [string, (l: Iv, r: Iv) => Iv, (l: number, r: number) => number][] = [
        ['+', (l, r) => add(iv(), l, r), (l, r) => l + r],
        ['-', (l, r) => sub(iv(), l, r), (l, r) => l - r],
        ['*', (l, r) => mul(iv(), l, r), (l, r) => l * r],
        ['/', (l, r) => div(iv(), l, r), (l, r) => l / r],
        ['^', (l, r) => powGeneral(iv(), l, r), (l, r) => Math.pow(l, r)],
      ]
      const [sym, t, sc] = ops[k - 4]
      return { src: `(${a.src} ${sym} ${b.src})`, twin: (x) => t(a.twin(x), b.twin(x)), scalar: (x) => sc(a.scalar(x), b.scalar(x)) }
    }

    const EDGE: [number, number][] = [
      [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, -0],
      [-0, 2], [0, 2], [-2, 0], [-2, -0], [-1, 1], [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 1e-300], [-1e-300, -0],
      [1e154, 1e155], [-1e154, 1e155], [0.5, 2], [-3, -1], [1, 1], [-1, 0], [-0.25, 0], [-8, 0], [-8, 8], [-2, -0.5],
    ]
    const pointsOf = (lo: number, hi: number): number[] =>
      [lo, hi, (lo + hi) / 2, -Infinity, -1e154, -2, -1, -0.5, -5e-324, 5e-324, 0.5, 1, 2, 1e154, Infinity].filter((x) => x !== 0 && lo <= x && x <= hi).concat(zerosIn(lo, hi))

    it('depth 2 and 3 over the edge boxes', () => {
      const rand = mulberry32(20261003)
      for (let i = 0; i < 700; i++) {
        const e = build(rand, 2 + (i % 2))
        for (const [lo, hi] of EDGE) {
          const r = e.twin(box(lo, hi))
          for (const x of pointsOf(lo, hi)) {
            const y = e.scalar(x)
            expect(admits(r, y), `${e.src} over [${fmt(lo)}, ${fmt(hi)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`).toBe(true)
          }
        }
      }
    })

    it('depth 2 and 3 over random boxes', () => {
      const rand = mulberry32(20261004)
      for (let i = 0; i < 500; i++) {
        const e = build(rand, 2 + (i % 2))
        for (let j = 0; j < 12; j++) {
          const [lo, hi] = randomBox(rand)
          const r = e.twin(box(lo, hi))
          for (const x of pointsIn(lo, hi, rand, 4)) {
            const y = e.scalar(x)
            expect(admits(r, y), `${e.src} over [${fmt(lo)}, ${fmt(hi)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`).toBe(true)
          }
        }
      }
    })
  })
})
