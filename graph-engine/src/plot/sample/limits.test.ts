import { describe, expect, it } from 'vitest'
import { classify, oneSided } from './limits'
import { pointFnOf, scopeOf } from './testkit'
import { LIMITS } from './tuning'
import type { PointFn } from './types'

const c = (text: string, tc: number, defs = '', angle: 'radians' | 'degrees' = 'radians') =>
  classify(pointFnOf(text, 'x', scopeOf(defs, angle)), tc, 0.1, { x: 40, y: 40 }, { points: 0, intervals: 0 })

describe('classify', () => {
  it('poles', () => {
    expect(c('1/x', 0).kind).toBe('pole')
    expect(c('1/x^2', 0).kind).toBe('pole')
    expect(c('tan(x)', Math.PI / 2).kind).toBe('pole')
    expect(c('tan(x)', 90, '', 'degrees').kind).toBe('pole')
  })
  it('holes, with the limit', () => {
    for (const [text, at, limit] of [['(x^2 - 1)/(x - 1)', 1, 2], ['sin(x)/x', 0, 1], ['sin(x - pi)/(x - pi)', Math.PI, 1], ['x sin(1/x)', 0, 0]] as const) {
      const r = c(text, at)
      expect(r.kind, text).toBe('hole')
      if (r.kind === 'hole') {
        expect(r.limit.y).toBeCloseTo(limit, 6)
        expect(r.value).toBeNull()
      }
    }
  })
  it('a removable point with its own value', () => {
    const r = c('{x = 1: 5, x}', 1)
    expect(r).toMatchObject({ kind: 'hole', limit: { x: 1, y: expect.closeTo(1, 6) }, value: { x: 1, y: 5 } })
  })
  it('jumps, with the value at the seam', () => {
    expect(c('floor(x)', 1)).toMatchObject({ kind: 'jump', left: { y: expect.closeTo(0, 9) }, right: { y: expect.closeTo(1, 9) }, value: { y: 1 } })
    expect(c('{x < 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 1 } })
    expect(c('{x <= 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 0 } })
  })
  it('edges', () => {
    expect(c('sqrt(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(0, 3) } })
    expect(c('ln(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: null })
    expect(c('{0 < x <= 3: 2}', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(2, 9) } })
    expect(c('{0 < x <= 3: 2}', 3)).toMatchObject({ kind: 'edge', defined: 'left', limit: { y: expect.closeTo(2, 9) } })
  })
  it('a point with nothing either side of it is isolated (the curve is that point), and a point with no value too is unknown', () => {
    expect(c('{x = 1: 5}', 1)).toEqual({ kind: 'isolated', value: { x: 1, y: 5 } })
    expect(c('{x = 1.05: 5}', 1.05)).toEqual({ kind: 'isolated', value: { x: 1.05, y: 5 } })
    expect(c('{x = 1: 5}', 2).kind).toBe('unknown')
  })
  it('regular points and the honest unknowns', () => {
    expect(c('{x < 1: x, x}', 1).kind).toBe('regular')
    expect(c('sin(1/x)', 0).kind).toBe('unknown')
    expect(c('x^0.1', 0).kind).toBe('unknown') // converges too slowly to call within the offsets; the sampler reaches the edge itself
  })
  // calc P2 final review, I3: a steep root's tip is finite at every offset, settles by a geometric tail that is a little too
  // long for convergePx, and has an undefined side: it is an edge, with the extrapolated limit, and not an unknown with no
  // anchor (the core stopped 18 px short of x sqrt(9 - x^2)'s tips, 52 at COARSE, and 71 short of 5 sqrt(1 - x^2)'s).
  describe('an edge whose defined side settles without converging', () => {
    const at = (text: string, tc: number, scale: number) => classify(pointFnOf(text, 'x', scopeOf()), tc, 4 / scale, { x: scale, y: scale }, { points: 0, intervals: 0 })
    it.each([
      ['(4 - x^2)^(1/4)', 2, 40, 'left'],
      ['(4 - x^2)^(1/4)', -2, 40, 'right'],
      ['(4 - x^2)^(1/4)', 2, 133, 'left'],
      ['x sqrt(9 - x^2)', 3, 100, 'left'],
      ['x sqrt(9 - x^2)', -3, 100, 'right'],
      ['5 sqrt(1 - x^2)', 1, 200, 'left'],
    ] as const)('%s at %d, %d px a unit: an edge with its limit at the tip', (text, tc, scale, defined) => {
      const r = at(text, tc, scale)
      expect(r).toMatchObject({ kind: 'edge', defined })
      if (r.kind === 'edge' && r.limit !== null) expect(Math.abs(r.limit.y) * scale, text).toBeLessThan(0.1)
    })
    it('is the whole of what the geometric test accepted before, for a side that did converge', () => {
      expect(at('sqrt(x)', 0, 40)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(0, 3) } })
    })
    it('not a root too slow to draw to (x^0.1: seven pixels to go), an oscillation, or a side with holes in it', () => {
      expect(at('x^0.1', 0, 40).kind).toBe('unknown')
      // the right side is finite at every offset and does not settle: sin(1/x) is still sin(1/x)
      expect(at('sin(1/x) + sqrt(x)', 0, 40).kind).toBe('unknown')
      // sqrt(sin(1/x)) is NaN at a scatter of offsets, so not "finite at every offset"
      expect(at('sqrt(sin(1/x))', 0, 40).kind).toBe('unknown')
    })
  })
})

const side = (text: string, tc: number, which: -1 | 1, scale = 40, defs = '', angle: 'radians' | 'degrees' = 'radians') =>
  oneSided(pointFnOf(text, 'x', scopeOf(defs, angle)), tc, which, 0.1, { x: scale, y: scale }, { points: 0, intervals: 0 })

describe('oneSided', () => {
  it('signs a divergence by which way the curve runs off', () => {
    expect(side('1/x', 0, -1)).toEqual({ kind: 'diverge', sign: -1 })
    expect(side('1/x', 0, 1)).toEqual({ kind: 'diverge', sign: 1 })
    expect(side('ln(x)', 0, 1)).toEqual({ kind: 'diverge', sign: -1 })
  })
  it('reads a side that is not there as undefined', () => {
    expect(side('sqrt(x)', 0, -1)).toEqual({ kind: 'undefined' })
    expect(side('ln(x)', 0, -1)).toEqual({ kind: 'undefined' })
  })
  it('converges geometrically where the window is too wide for a finer view', () => {
    // sqrt(x) at 400 px per unit spreads 0.22 px over the last four samples, but its
    // differences halve and the tail past the last is a thirtieth of a pixel.
    const s = side('sqrt(x)', 0, 1, 400)
    expect(s.kind).toBe('converge')
    // the limit is extrapolated past the last sample, to the true 0 and not to sqrt(6e-9)
    if (s.kind === 'converge') expect(Math.abs(s.at.y)).toBeLessThan(1e-9)
    // and at 4000 px the tail is a third of a pixel: honestly not called
    expect(side('sqrt(x)', 0, 1, 4000).kind).toBe('unknown')
  })
  it('does not call a slow convergence a divergence, and a sample that overflows stays unknown', () => {
    expect(side('x^0.1', 0, 1).kind).toBe('unknown')
    expect(side('exp(1/x^2)', 0, 1).kind).toBe('unknown')
  })
  it('signs a curve that runs off along x by x', () => {
    const along: PointFn = (t, out) => {
      out[0] = 1 / t
      out[1] = 0
    }
    const px = { x: 40, y: 40 }
    const counter = { points: 0, intervals: 0 }
    expect(oneSided(along, 0, 1, 0.1, px, counter)).toEqual({ kind: 'diverge', sign: 1 })
    expect(oneSided(along, 0, -1, 0.1, px, counter)).toEqual({ kind: 'diverge', sign: -1 })
  })
  it('is unknown for a step or a scale it cannot read', () => {
    const p = pointFnOf('x', 'x', scopeOf())
    const counter = { points: 0, intervals: 0 }
    for (const h0 of [0, -1, NaN, Infinity]) expect(oneSided(p, 0, 1, h0, { x: 40, y: 40 }, counter).kind).toBe('unknown')
    expect(oneSided(p, 0, 1, 0.1, { x: 0, y: 40 }, counter).kind).toBe('unknown')
    expect(counter.points).toBe(0)
  })
})

describe('classify, accounting', () => {
  const run = (text: string, tc: number, angle: 'radians' | 'degrees' = 'radians') => {
    const counter = { points: 0, intervals: 0 }
    const result = classify(pointFnOf(text, 'x', scopeOf('', angle)), tc, 0.1, { x: 40, y: 40 }, counter)
    return { result, counter }
  }
  it('counts every evaluation: 13 offsets a side and the point itself', () => {
    expect(run('1/x', 0).counter).toEqual({ points: 27, intervals: 0 })
  })
  it('stops the offsets short of the cancellation noise, further out at a large tc', () => {
    // 9e-8 is the floor at tc = 90: 0.1 / 4^10 = 9.5e-8 is the last offset above it, so 11 a side
    expect(run('tan(x)', 90, 'degrees').counter.points).toBe(23)
  })
  it('is deterministic', () => {
    expect(run('sin(x)/x', 0)).toEqual(run('sin(x)/x', 0))
  })
  it('gives a hole the middle of its two limits, so x is the point and not the last offset', () => {
    const { result } = run('(x^2 - 1)/(x - 1)', 1)
    expect(result).toMatchObject({ kind: 'hole', limit: { x: expect.closeTo(1, 12) } })
  })
})

describe('classify, functions periodic in 1/x', () => {
  // The offsets are h0 / 4^k, so 1/x sits at 4^k / h0 on every one of them. At h0 = 0.1
  // and 0.08, pi / x is a whole number of pi from k = 2 on: sin(pi/x) reads 0 at every
  // sample and the lattice alone would call 0 a hole. The sample off the lattice that a
  // converging side takes (h sqrt 2) must agree, and does not.
  const aliased = (text: string, h0: number) =>
    classify(pointFnOf(text, 'x', scopeOf()), 0, h0, { x: 40, y: 40 }, { points: 0, intervals: 0 })
  for (const h0 of [0.1, 0.08]) {
    for (const text of ['sin(pi/x)', 'cos(pi/x)', 'tan(pi/x)', '1/x - floor(1/x)']) {
      it(`${text} at 0 is not a hole (h0 = ${h0})`, () => {
        expect(aliased(text, h0).kind).toBe('unknown')
      })
    }
  }
  it('a real limit still passes the off-lattice sample, and the sample is counted', () => {
    const run = (text: string, tc: number) => {
      const counter = { points: 0, intervals: 0 }
      const result = classify(pointFnOf(text, 'x', scopeOf()), tc, 0.1, { x: 40, y: 40 }, counter)
      return { kind: result.kind, points: counter.points }
    }
    // 13 offsets a side, two confirming samples on each converging side, and the point
    expect(run('sin(x)/x', 0)).toEqual({ kind: 'hole', points: 13 + 13 + 4 + 1 })
    expect(run('sqrt(x)', 0)).toEqual({ kind: 'edge', points: 13 + 13 + 2 + 1 })
    expect(run('1/x', 0)).toEqual({ kind: 'pole', points: 27 }) // a divergence is not confirmed
  })
})

describe('classify, distances that overflow when squared', () => {
  it('1/x^30 is a pole: 1e247 px squared is not Infinity', () => {
    expect(c('1/x^30', 0).kind).toBe('pole')
  })
})

describe('classify, holes whose numerator cancels to higher order', () => {
  // (x - sin x)/x^3 is the cancellation of two O(x) terms, then divided by x^3: its
  // noise is eps/h^2, not eps/h, and the minRel floor (first order only) lets it
  // through. The last offsets read 0.1666, 0.1669, 0.1678, 0.244, 0: a run whose
  // distance grows every step, and the divergence test took it for a pole.
  const hole = (text: string, h0: number, scale: number) =>
    classify(pointFnOf(text, 'x', scopeOf()), 0, h0, { x: scale, y: scale }, { points: 0, intervals: 0 })
  const cases: [string, number, number, number][] = [
    ['(x - sin(x))/x^3', 0.1, 40, 1 / 6],
    ['(exp(x) - 1 - x)/x^2', 0.1, 40, 1 / 2],
    ['(tan(x) - x)/x^3', 0.1, 40, 1 / 3],
    ['(1 - cos(x))/x^2', 0.1, 40, 1 / 2],
    ['(exp(x) - 1 - x)/x^2', 0.01, 400, 1 / 2],
    ['(1 - cos(x))/x^2', 0.001, 4000, 1 / 2],
  ]
  for (const [text, h0, scale, limit] of cases) {
    it(`${text} at 0 is a hole with limit ${limit.toFixed(4)} (h0 = ${h0}, ${scale} px)`, () => {
      const r = hole(text, h0, scale)
      expect(r.kind).toBe('hole')
      if (r.kind === 'hole') {
        // The limit is the last sample the retry kept, and that still carries some noise
        // (and, for exp(x) - 1 - x, the O(h) of the function): no sample of this noisy
        // sequence is within 1e-6 of the limit (the best of them, exp at 40 px, is off by
        // 3e-6), and none is needed. It is right to what the rule means by "reached":
        // within convergePx on screen, so the open mark sits on the right dot.
        expect(Math.abs(r.limit.y - limit) * scale).toBeLessThan(LIMITS.convergePx)
        // x likewise: a geometric tail extrapolates x as well as y, along one ratio
        expect(Math.abs(r.limit.x) * scale).toBeLessThan(LIMITS.convergePx)
        expect(r.value).toBeNull()
      }
    })
  }
  it('counts the retry: x - sin x over x^3 at 40 px takes confirming samples for each drop it tries', () => {
    const counter = { points: 0, intervals: 0 }
    classify(pointFnOf('(x - sin(x))/x^3', 'x', scopeOf()), 0, 0.1, { x: 40, y: 40 }, counter)
    // 13 a side, the point, and per side the tail dropped 2 (the first confirming sample
    // refuses it: 1) and 3 (taken, both samples agree: 2)
    expect(counter.points).toBe(13 + 13 + 1 + 3 + 3)
    // at most: per side 13, and two confirming samples for the whole sequence and for each drop
    expect(counter.points).toBeLessThanOrEqual(2 * (13 + LIMITS.confirmFactors.length * (1 + LIMITS.noiseDrop)) + 1)
  })
  it('order-5 cancellation, past what the retry reaches, is unknown and never a pole', () => {
    expect(hole('(sin(x) - x + x^3/6)/x^5', 0.1, 40).kind).toBe('unknown')
    expect(hole('(sin(x) - x + x^3/6)/x^5', 0.001, 4000).kind).toBe('unknown')
  })
  it('real poles stay poles at the zooms the noise is tested at', () => {
    for (const [text, tc] of [['1/x', 0], ['1/x^2', 0], ['tan(x)', Math.PI / 2]] as const)
      for (const [h0, scale] of [[0.01, 400], [0.001, 4000]] as const)
        expect(classify(pointFnOf(text, 'x', scopeOf()), tc, h0, { x: scale, y: scale }, { points: 0, intervals: 0 }).kind, `${text} at ${scale} px`).toBe('pole')
  })
})

describe('classify, noise that is as steady as a pole', () => {
  // On the lattice h0 4^-k the numerator's rounding error is the same few ulps at every
  // offset, so the noise is exactly c/x^2: growth ratios 14.6, 16, 16, 16, a spread of
  // 1.1, and the steady test takes it for a pole. What tells it from one is the tail
  // before it: a real pole's shorter tails never converge, and these do.
  const at = (text: string, tc: number, h0: number, scale: number) =>
    classify(pointFnOf(text, 'x', scopeOf()), tc, h0, { x: scale, y: scale }, { points: 0, intervals: 0 })
  for (const [text, scale] of [['(x - ln(1 + x))/x^2', 40], ['(x - ln(1 + x))/x^2', 160], ['(x - ln(1 + x))/x^2', 640], ['(1 - cos(x))/x^2', 60]] as const) {
    it(`${text} at ${scale} px is not a pole`, () => {
      expect(['hole', 'unknown']).toContain(at(text, 0, 4 / scale, scale).kind)
    })
  }
  it('every real pole stays a pole at the default view', () => {
    const poles: [string, number][] = [
      ['1/x', 0], ['1/x^3', 0], ['1/x^30', 0], ['1/(x ln(abs(x)))', 0], ['ln(abs(x))/x', 0],
      ['1/sqrt(abs(x))', 0], ['abs(x)^(-0.1)', 0], ['tan(x)', Math.PI / 2], ['1/sin(x)', Math.PI],
    ]
    for (const [text, tc] of poles) expect(at(text, tc, 0.1, 40).kind, text).toBe('pole')
  })
  it('a pole too weak to see in the view is unknown: the accepted cost', () => {
    // 1e-6/x at 0.4 px per unit is under a twentieth of a pixel until the last offsets, so
    // a shorter tail converges and confirms, and the rule cannot say pole.
    expect(at('1e-6/x', 0, 10, 0.4).kind).toBe('unknown')
  })
})

describe('classify, aliasing that one off-lattice sample misses', () => {
  // cos(pi/x) sits at a maximum on the lattice, so a given off-lattice sample agrees with
  // it one time in sixty; at h0 = 0.2 and on round views the one sample at sqrt 2 times
  // the last offset did. Two samples (sqrt 2 and the golden ratio) both have to agree.
  const z = () => ({ points: 0, intervals: 0 })
  const units = [2, 4, 5, 10, 20, 40, 50, 100]
  const widths = [400, 500, 600, 640, 720, 800, 960, 1000, 1200, 1280, 1600, 1920]
  for (const text of ['cos(pi/x)', 'cos(2 pi/x)', 'sin(pi/x)', '1/x - floor(1/x)']) {
    it(`${text} at 0 is unknown on all ${units.length * widths.length} round views (no hole, jump or edge)`, () => {
      const p = pointFnOf(text, 'x', scopeOf())
      const wrong: string[] = []
      for (const u of units) {
        for (const w of widths) {
          const scale = w / u
          const kind = classify(p, 0, 4 / scale, { x: scale, y: scale }, z()).kind
          if (kind !== 'unknown') wrong.push(`${u} units at ${w} px: ${kind}`)
        }
      }
      expect(wrong).toEqual([])
    })
  }
  it('cos(pi/x) at h0 = 0.2 is unknown, and so are the jump and the edge built on it', () => {
    for (const text of ['cos(pi/x)', 'sign(x) cos(pi/x)', '{x > 0: cos(pi/x)}'])
      expect(classify(pointFnOf(text, 'x', scopeOf()), 0, 0.2, { x: 20, y: 20 }, z()).kind, text).toBe('unknown')
  })
})

describe('classify, a jump that is only noise', () => {
  const at = (text: string, scale: number) =>
    classify(pointFnOf(text, 'x', scopeOf()), 0, 4 / scale, { x: scale, y: scale }, { points: 0, intervals: 0 })
  it('(exp(x) - 1 - x)/x^2 at 1600 px is a hole, not a jump: its sides are 0.065 px apart', () => {
    // The retried tails each carry noise under a twentieth of a pixel, so two of them can
    // differ by nearly twice that: 0.50000001 and 0.50004066 here, a hole's two sides.
    const r = at('(exp(x) - 1 - x)/x^2', 1600)
    expect(r.kind).toBe('hole')
    if (r.kind === 'hole') expect(Math.abs(r.limit.y - 0.5) * 1600).toBeLessThan(LIMITS.convergePx)
  })
  it('a clean step of 0.07 px is still a jump: the wider tolerance is for retried tails only', () => {
    expect(at('{x < 0: 0, 0.00175}', 40).kind).toBe('jump')
  })
  it('the point\'s own value is compared as loosely: (tan(x) - x)/x^3 with its limit as its value is regular at 2500 px', () => {
    // Its retried limit is 0.068 px off the true 1/3 there, the one of 59 holes over the
    // five cancellation families at 15 zooms that is over convergePx; the curve with its
    // own value 1/3 is continuous, and a "hole with a value" there would be noise's.
    expect(at('{x = 0: 1/3, (tan(x) - x)/x^3}', 2500).kind).toBe('regular')
    // and a value that really is off (0.001 is 2.5 px at 2500 px per unit) is still a hole with a value
    expect(at('{x = 0: 1/3 + 0.001, (tan(x) - x)/x^3}', 2500).kind).toBe('hole')
  })
})
