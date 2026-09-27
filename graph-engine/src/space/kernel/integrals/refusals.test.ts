// S5 fix rounds 1 to 3: integrals that have no value are refused on their
// line, the figure still drawn; integrals that have one are never refused,
// and every digit they print is right. Wall-clock bounds are only a generous
// guard (a loaded machine is slow); costs are asserted in evaluations in
// math/quadrature.test.ts.

import { describe, expect, it } from 'vitest'
import type { SceneError, SpaceScene } from '../../scene/types'
import { QUAD_BUDGET } from '../../../math/tolerance'
import { approxText, determined, IntegralRefusal } from './common'
import { approx, approxTuple, lastDigitUnit, markNamed, readout, sceneOf } from './testing'

const GUARD_MS = 15000
// A test reading several heavy integrals may take longer than vitest's 5 s on a loaded machine.
const HEAVY_MS = 60000
const BUDGET = QUAD_BUDGET.toLocaleString('en-US')

function timedScene(spec: string): { scene: SpaceScene; ms: number } {
  const start = performance.now()
  const scene = sceneOf(spec)
  return { scene, ms: performance.now() - start }
}

const on = (errors: readonly SceneError[], line: number) => errors.filter((e) => e.line === line).map((e) => e.message)
const GROWS_AT_X0 = /^the integral does not converge: it grows without bound near x = 0$/

describe('textbook integrals are not refused (every printed digit right)', () => {
  const ball = 'x in [-1, 1], y in [-sqrt(1-x^2), sqrt(1-x^2)]'
  const cases: [string, number, number, string][] = [
    [`volume: ${ball}, z in [-sqrt(1-x^2-y^2), sqrt(1-x^2-y^2)]`, 1, (4 * Math.PI) / 3, 'dV'],
    [`volume: ${ball}, z in [0, sqrt(1-x^2-y^2)]`, 1, (2 * Math.PI) / 3, 'dV'],
    [`volume: under sqrt(1 - x^2 - y^2) over ${ball}`, 1, (2 * Math.PI) / 3, 'dA'],
    [`volume: ${ball}, z in [sqrt(x^2+y^2), 1]`, 1, Math.PI / 3, 'dV'],
    ['volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand 1/sqrt(z)', 1, 2, 'dV'],
    ['volume: under abs(x - y) over x in [0, 1], y in [0, 1]', 1, 1 / 3, 'dA'],
  ]
  for (const [spec, line, exact, name] of cases) {
    it(spec, () => {
      const { scene, ms } = timedScene(spec)
      expect(ms).toBeLessThan(GUARD_MS)
      expect(scene.errors).toEqual([])
      const text = readout(scene, line).text
      expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    })
  }

  it(`W = volume under sqrt(1-x^2-y^2) over the rectangular disc, then centroid: W — (0, 0, 3/8)`, () => {
    const { scene, ms } = timedScene(`W = volume under sqrt(1-x^2-y^2) over ${ball}\ncentroid: W`)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const [x, y, z] = approxTuple(readout(scene, 2).text, 'centroid')
    expect([x, y]).toEqual([0, 0])
    expect(Math.abs(z - 0.375)).toBeLessThan(1e-6)
  }, HEAVY_MS)

  it('1/(x^2 + y^2 + z^2) over the unit cube converges: its value, or at worst "did not settle" — never "does not converge"', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand 1/(x^2 + y^2 + z^2)')
    expect(ms).toBeLessThan(GUARD_MS)
    for (const e of scene.errors) expect(e.message).toMatch(new RegExp(`^the integral did not settle within ${BUDGET} evaluations`))
  }, HEAVY_MS)
})

describe('divergent integrals are refused, found directly, with where', () => {
  it('volume: x in [0, 1], y in [0, 1], z in [0, 1/x] — grows without bound near x = 0; the faces still draw', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [0, 1/x]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    expect(scene.marks.some((m) => m.source.object.startsWith('s1.face'))).toBe(true)
    expect(scene.labels.filter((l) => l.source.object === 's1.readout')).toEqual([])
  })

  it('volume: under 1/x over x in [0, 1], y in [0, 1] — grows without bound near x = 0; the surface still draws', () => {
    const { scene, ms } = timedScene('volume: under 1/x over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    markNamed(scene, 's1', 'mesh')
  })

  it('a named divergent volume is refused on its own line, and centroid: of it on its line', () => {
    const { scene, ms } = timedScene(
      'V = volume x in [0, 1], y in [0, 1], z in [0, 1/x]\nW = volume under 1/x over x in [0, 1], y in [0, 1]\ncentroid: V\ncentroid: W',
    )
    expect(ms).toBeLessThan(GUARD_MS)
    for (const line of [1, 2, 3, 4]) expect(on(scene.errors, line)).toEqual([expect.stringMatching(GROWS_AT_X0)])
  })

  it('an infinity at a node is divergence there: 1/x over x in [-1, 1] near x = 0, never "≈ ∞"', () => {
    const scene = sceneOf('volume: under 1/x over x in [-1, 1], y in [0, 1]')
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    expect(scene.labels.map((l) => l.text).join()).not.toMatch(/∞/)
  })

  it('overflow is divergence, not "undefined": 1/x^3 and exp(1/x) grow without bound near x = 0', () => {
    for (const f of ['1/x^3', 'exp(1/x)']) {
      expect(on(sceneOf(`volume: under ${f} over x in [0, 1], y in [0, 1]`).errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    }
  })

  it('an unbounded region’s area, and a Riemann sum’s integral, are refused; the Riemann sum itself still reads', () => {
    expect(on(sceneOf('region: x in [0, 1], y in [0, 1/x]').errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    const riemann = sceneOf('riemann: under 1/x over x in [0, 1], y in [0, 1], n = 2')
    expect(on(riemann.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    // samples at x = 0.25 and 0.75: (4 + 4/3 + 4 + 4/3) × 1/4 = 8/3
    expect(readout(riemann, 1).text).toBe('Σ (1/x) ΔA ≈ 2.667')
  })

  it('the refusal names the level that diverges: 1/y near y = 0, polar 1/r^2 near r = 0 (1/r converges to π)', () => {
    expect(on(sceneOf('volume: under 1/y over x in [0, 1], y in [0, 1]').errors, 1)).toEqual([
      'the integral does not converge: it grows without bound near y = 0',
    ])
    expect(sceneOf('volume: under 1/r over r in [0, 1], theta in [0, pi]').errors).toEqual([])
    expect(on(sceneOf('volume: under 1/r^2 over r in [0, 1], theta in [0, pi]').errors, 1)).toEqual([
      'the integral does not converge: it grows without bound near r = 0',
    ])
  })

  it('over an inequality region: a sum that grows as its mesh refines is refused, at res 40 as at 96', () => {
    for (const spec of ['volume: under 1/(x^2 + y^2) over x^2 + y^2 <= 1', '@resolution: 40\nvolume: under 1/(x^2 + y^2) over x^2 + y^2 <= 1']) {
      const { scene, ms } = timedScene(spec)
      expect(ms).toBeLessThan(GUARD_MS)
      expect(scene.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^the integral does not converge: its sum over the mesh grows as the mesh refines/)])
    }
  })

  it('an integrable singularity over an inequality region is not divergence: 1/sqrt(x^2 + y^2) over the disc is 2π', () => {
    const scene = sceneOf('volume: under 1/sqrt(x^2 + y^2) over x^2 + y^2 <= 1')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - 2 * Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})

describe('what is not a number, and whose fault it is', () => {
  it('NaN in a bound is the bound’s: "the bound sqrt(x - 0.5) is not a number at x = …"', () => {
    const scene = sceneOf('volume: x in [0, 1], y in [0, 1], z in [0, sqrt(x - 0.5)]')
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the bound sqrt\(x - 0\.5\) is not a number at \(x, y\) = \(0\.00\d+, [0-9.]+\)$/)])
  })

  it('NaN in the integrand is the integrand’s, at the point', () => {
    const scene = sceneOf('volume: under sqrt(x) over x in [-1, 1], y in [0, 1]')
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the integral is undefined: the integrand is not a number at \(x, y\) = \(−0\.\d+, 0\.\d+\)$/)])
  })
})

// S5 fix round 3: every readout is right to its last digit, or the integral
// is refused; divergence is claimed only on evidence and placed where it is.
describe('never a wrong confident number (fix round 3)', () => {
  const read = (spec: string, name: string, exact: number): string => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    return text
  }
  const refused = (spec: string): string[] => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    return on(scene.errors, 1)
  }

  it('tan, sec and sec^2 to pi/2 read "does not converge" near x = 1.571 — never ≈ 40', () => {
    for (const f of ['tan(x)', 'sec(x)', 'sec(x)^2']) {
      expect(refused(`volume: under ${f} over x in [0, pi/2], y in [0, 1]`)).toEqual(['the integral does not converge: it grows without bound near x = 1.571'])
    }
  })

  it('kinks read every digit right: |x - y| over [0, 2]^2, [-1, 1]^2, [0, 3]^2; max and min over [0, 2]^2', () => {
    for (const square of ['[0, 2]', '[-1, 1]']) {
      const text = read(`volume: under abs(x - y) over x in ${square}, y in ${square}`, 'dA', 8 / 3)
      expect(lastDigitUnit(text, 'dA')).toBeLessThanOrEqual(1e-8)
    }
    read('volume: under abs(x - y) over x in [0, 3], y in [0, 3]', 'dA', 9)
    read('volume: under max(x, y) over x in [0, 2], y in [0, 2]', 'dA', 16 / 3)
    read('volume: under min(x, y) over x in [0, 2], y in [0, 2]', 'dA', 8 / 3)
  }, HEAVY_MS)

  it('x^(-2/3) over the cube is 3, as an integrand and as a bound — never ≈ 0', () => {
    expect(read('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand x^(-2/3)', 'dV', 3)).toBe('∭ (x^(-2/3)) dV ≈ 3')
    expect(read('volume: x in [0, 1], y in [0, 1], z in [0, x^(-2/3)]', 'dV', 3)).toBe('∭ dV ≈ 3')
  }, HEAVY_MS)

  it('1/(x^2 + y^2)^0.9 over the disc (10π ≈ 31.4) reads its right digits or is refused — never ≈ 20', () => {
    const { scene } = timedScene('volume: under 1/(x^2 + y^2)^0.9 over x^2 + y^2 <= 1')
    if (scene.errors.length) expect(on(scene.errors, 1)[0]).toMatch(/^the integral did not settle|^the integral could not be determined to one significant digit/)
    else {
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dA') - 10 * Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
  })

  it('convergent singular ends are valued: 1/sqrt(1 - x^2 - y^2) (rectangular and polar), 1/sqrt(1 - x^2), 1/sqrt(1 - x), y <= 1/sqrt(1 - x^2)', () => {
    read('volume: under 1/sqrt(1 - x^2 - y^2) over x in [-1, 1], y in [-sqrt(1-x^2), sqrt(1-x^2)]', 'dA', 2 * Math.PI)
    read('volume: under 1/sqrt(1 - r^2) over r in [0, 1], theta in [0, 2*pi]', 'dA', 2 * Math.PI)
    read('volume: under 1/sqrt(1 - x^2) over x in [-1, 1], y in [0, 1]', 'dA', Math.PI)
    read('volume: under 1/sqrt(1 - x) over x in [0, 1], y in [0, 1]', 'dA', 2)
    read('region: x in [-1, 1], y in [0, 1/sqrt(1 - x^2)]', 'area', Math.PI)
  }, HEAVY_MS)

  it('convergent singular points inside are valued: 1/sqrt|x|, ln|x| (and log|x|, base 10), y <= 1/sqrt|x|, 1/sqrt|x - y|', () => {
    read('volume: under 1/sqrt(abs(x)) over x in [-1, 1], y in [0, 1]', 'dA', 4)
    read('volume: under ln(abs(x)) over x in [-1, 1], y in [0, 1]', 'dA', -2)
    read('volume: under log(abs(x)) over x in [-1, 1], y in [0, 1]', 'dA', -2 / Math.LN10)
    read('region: x in [-1, 1], y in [0, 1/sqrt(abs(x))]', 'area', 4)
    read('volume: under 1/sqrt(abs(x - y)) over x in [0, 1], y in [0, 1]', 'dA', 8 / 3)
  }, HEAVY_MS)

  it('1/sqrt(x^2 + y^2) over [-1, 1]^2 is 8 asinh(1), or an honest "did not settle" — never "does not converge" (fix round 4, I1c)', () => {
    // the check pass's single-panel start puts its own outer centre exactly
    // at x = 0, where 1/hypot(0, y) = 1/|y| genuinely does not converge in y
    // (unlike the true g(x), finite for x != 0) — a measure-zero artifact of
    // the node, not the integral; a divergence claim from only one pass is
    // not believed over the other's value (I1c), so this is now refused
    // honestly rather than wrongly, when it is refused at all.
    const { scene, ms } = timedScene('volume: under 1/sqrt(x^2 + y^2) over x in [-1, 1], y in [-1, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    const errors = on(scene.errors, 1)
    if (errors.length) {
      expect(errors).toEqual([expect.stringMatching(/^the integral did not settle( near y = 0)?: the pieces shed there shrink too slowly to tell a value from divergence in floating point$/)])
    }
    else {
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dA') - 8 * Math.asinh(1))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
  }, HEAVY_MS)

  it('slow singular ends never read "does not converge": x^-0.99, x^-0.999, 1/(x ln^2 x) did not settle near x = 0', () => {
    for (const [f, hi] of [['x^(-0.99)', 1], ['x^(-0.999)', 1], ['1/(x*ln(x)^2)', 0.5]] as const) {
      expect(refused(`volume: under ${f} over x in [0, ${hi}], y in [0, 1]`)).toEqual([
        'the integral did not settle near x = 0: the pieces shed there shrink too slowly to tell a value from divergence in floating point',
      ])
    }
  }, HEAVY_MS)

  it('divergence is placed where it is: exp(1/x) over the cube and 1/x over [-1, 1] x [0, 1]^2, near x = 0', () => {
    expect(refused('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand exp(1/x)')).toEqual([expect.stringMatching(GROWS_AT_X0)])
    expect(refused('volume: x in [-1, 1], y in [0, 1], z in [0, 1] integrand 1/x')).toEqual([expect.stringMatching(GROWS_AT_X0)])
  }, HEAVY_MS)

  it('a removable point is not "undefined": sin(x)/x over [-1, 1] x [0, 1] is 2 Si(1)', () => {
    read('volume: under sin(x)/x over x in [-1, 1], y in [0, 1]', 'dA', 1.8921661407343662)
  })

  it('the ice-cream cone in rectangular bounds is a volume: its z bounds meet at the rim, which is not crossing', () => {
    // between z = r and the sphere of radius sqrt(2), r <= 1: 4π(√2 - 1)/3
    read('volume: x in [-1, 1], y in [-sqrt(1-x^2), sqrt(1-x^2)], z in [sqrt(x^2+y^2), sqrt(2 - x^2 - y^2)]', 'dV', (4 * Math.PI * (Math.SQRT2 - 1)) / 3)
  })

  // The D list, each its own test (heavy on a loaded machine: a generous timeout).
  const ball = 'x in [-1, 1], y in [-sqrt(1-x^2), sqrt(1-x^2)], z in [-sqrt(1-x^2-y^2), sqrt(1-x^2-y^2)]'
  const D: [string, number][] = [
    [`volume: ${ball} integrand abs(z)`, Math.PI / 2],
    [`volume: ${ball} integrand sqrt(x^2 + y^2)`, Math.PI ** 2 / 4],
    [`volume: ${ball} integrand (x^2 + y^2)^6`, ((4 * Math.PI) / 15) * (46080 / 135135)],
    ['volume: x in [-1, 1], y in [-1, 1], z in [0, 1 - max(abs(x), abs(y))]', 4 / 3],
    ['volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand abs(y - z)', 1 / 3],
    ['volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand min(y, z)', 1 / 3],
    ['volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand max(x, y, z)', 3 / 4],
  ]
  for (const [spec, exact] of D) it(`D: ${spec}`, () => void read(spec, 'dV', exact), HEAVY_MS)

  it('D: a point singularity nested three deep in rectangular bounds, 1/rho over the ball, does not settle — and says so', () => {
    expect(refused(`volume: ${ball} integrand 1/sqrt(x^2 + y^2 + z^2)`)).toEqual([`the integral did not settle within ${BUDGET} evaluations`])
  }, HEAVY_MS)
})

// S5 fix round 4, I1: a singularity centred on an INNER range's own midpoint
// (y = 0 for y in [-1, 1]) is valued, not falsely "does not converge" — the
// cross-check's single-panel start used to put a node exactly there.
describe('a singularity centred on an inner range is valued, not falsely divergent (fix round 4, I1)', () => {
  const read = (spec: string, name: string, exact: number): string => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    return text
  }

  it('1/sqrt|y|, ln|y| and ln(y^2) over x in [0, 1], y in [-1, 1] are 4, -2 and -4', () => {
    read('volume: under 1/sqrt(abs(y)) over x in [0, 1], y in [-1, 1]', 'dA', 4)
    read('volume: under ln(abs(y)) over x in [0, 1], y in [-1, 1]', 'dA', -2)
    read('volume: under ln(y^2) over x in [0, 1], y in [-1, 1]', 'dA', -4)
  }, HEAVY_MS)

  it('3D ln|z|, z in [-1, 1] is -2', () => {
    read('volume: x in [0, 1], y in [0, 1], z in [-1, 1] integrand ln(abs(z))', 'dV', -2)
  }, HEAVY_MS)

  it('3D 1/sqrt|z|, z in [-1, 1] (expect 4): the same singularity, nested one level deeper — the node is no longer falsely divergent, but three nested levels of adaptive refinement (x and y both need to sample it fresh at every node) cost more than one integral’s 6,000,000-evaluation budget can buy at full precision; an honest "did not settle" is acceptable, never "does not converge"', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [-1, 1] integrand 1/sqrt(abs(z))')
    expect(ms).toBeLessThan(GUARD_MS)
    const errors = on(scene.errors, 1)
    if (errors.length === 0) {
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dV') - 4)).toBeLessThanOrEqual(lastDigitUnit(text, 'dV'))
    } else {
      expect(errors).toEqual([expect.stringMatching(new RegExp(`^the integral did not settle within ${BUDGET} evaluations`))])
    }
  }, HEAVY_MS)

  it('a genuinely divergent inner singularity is still found, and placed at its own level: 1/y over x in [0, 1], y in [-1, 1] near y = 0', () => {
    const { scene, ms } = timedScene('volume: under 1/y over x in [0, 1], y in [-1, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(on(scene.errors, 1)).toEqual(['the integral does not converge: it grows without bound near y = 0'])
  })
})

// S5 fix round 4, C1: an interior algebraic singularity, |x - c|^-p, narrows
// its final panel to only a few floats wide, where all 15 Kronrod nodes
// clamp onto 1-2 floats: K ≈ G, so its own error reads as tiny and it is
// never picked as the worst panel again — the singular tail beyond it was
// silently dropped. Fixed at the end of every level's run, not only for the
// worst panel; a singular result also prints at most 4 digits with its
// error floored ×10 (belt and braces).
describe('an interior singularity narrowed to a sliver still reports its tail (fix round 4, C1)', () => {
  // Hand value: (0.25^0.2 + 0.75^0.2) / 0.2.
  const tr = (c: number, p: number) => (c ** (1 - p) + (1 - c) ** (1 - p)) / (1 - p)
  const digitsOk = (spec: string, exact: number, name: string, line = 1): void => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, line).text
    expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
  }

  it('|x - 0.25|^-0.8 over the unit square, as an outer and as an inner variable — hand value 8.509729', () => {
    digitsOk('volume: under abs(x - 0.25)^(-0.8) over x in [0, 1], y in [0, 1]', tr(0.25, 0.8), 'dA')
    digitsOk('volume: under abs(y - 0.25)^(-0.8) over x in [0, 1], y in [0, 1]', tr(0.25, 0.8), 'dA')
  })

  it('|x - 0.123|^-0.8 (an off-centre anchor) — hand value 8.158605', () => {
    digitsOk('volume: under abs(x - 0.123)^(-0.8) over x in [0, 1], y in [0, 1]', tr(0.123, 0.8), 'dA')
  })

  it('|x - 0.25|^-0.75 (a milder exponent) — hand value 6.550847', () => {
    digitsOk('volume: under abs(x - 0.25)^(-0.75) over x in [0, 1], y in [0, 1]', tr(0.25, 0.75), 'dA')
  })

  it('a region bounded by y <= |x - 0.25|^-0.8 reads the same hand value', () => {
    digitsOk('region: x in [0, 1], y in [0, abs(x - 0.25)^(-0.8)]', tr(0.25, 0.8), 'area')
  })

  it('a singular result prints at most 4 significant digits and never fewer than a wrong one', () => {
    const scene = sceneOf('volume: under abs(x - 0.25)^(-0.8) over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    const digits = /≈ [−-]?(\d[\d.]*)/.exec(text)![1].replace(/[.\-−]/g, '').replace(/^0+/, '')
    expect(digits.length).toBeLessThanOrEqual(4)
  })
})

// S5 fix round 4, M1: a level's own panel cap (QUAD_INNER_MAX_PANELS = 200)
// running out is not the whole pass's 6,000,000-evaluation budget.
describe('the inner panel cap never claims the outer evaluation budget (fix round 4, M1)', () => {
  it('a many-kinked inner integrand refuses honestly, never claiming "within 6,000,000 evaluations"', () => {
    const { scene, ms } = timedScene('volume: under abs(sin(200*y*pi)) over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    const errors = on(scene.errors, 1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toMatch(/6,000,000/)
    expect(errors[0]).toMatch(/^the integral did not settle/)
  })
})

describe('the zero rule and the one-digit rule (fix round 3)', () => {
  it('≈ 0 only when zero is within the error and the error is negligible beside the integral of |g|', () => {
    expect(approxText({ value: 2e-12, error: 5e-12, scale: 1 })).toBe('≈ 0')
    expect(() => determined({ value: 2e-12, error: 5e-12, scale: 1 })).not.toThrow()
    // within its error but not negligible (5e-3 of the scale): not zero, and known to no digit
    expect(() => determined({ value: 2e-3, error: 5e-3, scale: 1 })).toThrow(IntegralRefusal)
  })

  it('a value whose error is half of it or more is refused, with both named; below that, its digits', () => {
    expect(() => determined({ value: 3, error: 1.6, scale: 3 })).toThrow('the integral could not be determined to one significant digit (≈ 3 ± 1.6)')
    expect(approxText(determined({ value: 3.14159, error: 0.004, scale: 3.2 }))).toBe('≈ 3.1')
  })
})
