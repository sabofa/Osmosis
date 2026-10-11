// S5 fix rounds 1 to 3: integrals that have no value are refused on their
// line, the figure still drawn; integrals that have one are never refused,
// and every digit they print is right. Wall-clock bounds are only a generous
// guard (a loaded machine is slow); costs are asserted in evaluations in
// math/quadrature.test.ts.

import { describe, expect, it } from 'vitest'
import type { SceneError, SpaceScene } from '../../scene/types'
import { QuadratureError } from '../../../math/quadrature'
import { QUAD_BUDGET } from '../../../math/tolerance'
import { approxText, determined, IntegralRefusal, refusalOf } from './common'
import { approx, approxTuple, lastDigitUnit, markNamed, readout, readoutFull, sceneOf } from './testing'

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

  // S5 breaker follow-up: this sum is singular (the origin is interior, and
  // the mesh's own peak keeps growing as it refines), so it keeps SAFETY;
  // SAFETY's own search finds no honest unit, but F1c's honest fallback —
  // one significant digit, or one unit coarser, under the raw error alone —
  // does: 2π ≈ 6.283 rounds to the coarser "≈ 10", still an honest bound,
  // never "does not converge".
  it('an integrable singularity over an inequality region is not divergence: 1/sqrt(x^2 + y^2) over the disc is 2π — prints ≈ 10, never "does not converge"', () => {
    const scene = sceneOf('volume: under 1/sqrt(x^2 + y^2) over x^2 + y^2 <= 1')
    expect(scene.errors).toEqual([])
    expect(readout(scene, 1).text).toBe('∬_R (1/sqrt(x^2 + y^2)) dA ≈ 10')
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
  // Gate fix I1: checks the half-unit rule on BOTH the on-figure `.text`
  // (S6 plan V3 caps it at DISPLAY_DIGITS) and the full, uncapped text —
  // a regression of the C1 kind (a capped digit the truth contradicts)
  // shows up only in `.text`, and the merge that switched this helper to
  // read only the full text let 23 cases pass right past it. Returns the
  // full text: the digit-count pin below (:183 as first written) judges
  // how many digits the quadrature's own error honestly supports, which
  // only the uncapped text speaks to directly.
  const read = (spec: string, name: string, exact: number): string => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const capped = readout(scene, 1).text
    const full = readoutFull(scene, 1)
    for (const text of [capped, full]) {
      expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    }
    return full
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
    // SAFETY (F1, breaker ruling) on the quadrature's own error — measured up
    // to 29x short on kinks like these — trims a couple of digits from
    // round 5's own count; `read` itself still checks every digit shown
    // against the hand value.
    for (const square of ['[0, 2]', '[-1, 1]']) {
      const text = read(`volume: under abs(x - y) over x in ${square}, y in ${square}`, 'dA', 8 / 3)
      expect(lastDigitUnit(text, 'dA')).toBeLessThanOrEqual(1e-6)
    }
    read('volume: under abs(x - y) over x in [0, 3], y in [0, 3]', 'dA', 9)
    read('volume: under max(x, y) over x in [0, 2], y in [0, 2]', 'dA', 16 / 3)
    read('volume: under min(x, y) over x in [0, 2], y in [0, 2]', 'dA', 8 / 3)
  }, HEAVY_MS)

  it('x^(-2/3) over the cube is 3, as an integrand and as a bound — never ≈ 0', () => {
    expect(read('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand x^(-2/3)', 'dV', 3)).toBe('∭ (x^(-2/3)) dV ≈ 3')
    expect(read('volume: x in [0, 1], y in [0, 1], z in [0, x^(-2/3)]', 'dV', 3)).toBe('∭ dV ≈ 3')
  }, HEAVY_MS)

  // S5 breaker ruling, F3: pinned to the deterministic result, not "either
  // outcome" — SAFETY (F1) on the mesh's own wide error here (this sum
  // never settles better than roughly 3x the value) refuses it outright.
  it('1/(x^2 + y^2)^0.9 over the disc (10π ≈ 31.4) refuses honestly — never ≈ 20', () => {
    const { scene } = timedScene('volume: under 1/(x^2 + y^2)^0.9 over x^2 + y^2 <= 1')
    expect(on(scene.errors, 1)).toEqual(['the integral could not be determined to one significant digit (≈ 31.3 ± 92.19) — try tighter bounds or a finer res:'])
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

  // S5 fix round 5, finding 3: the check pass's old one-panel start put its
  // own outer centre exactly at x = 0, where 1/hypot(0, y) = 1/|y| genuinely
  // does not converge in y (unlike the true g(x), finite for x != 0) — a
  // measure-zero artifact of that node, not the integral. Removing the
  // centre-node nudge ladder and giving the check pass the same golden
  // start as the main pass (so neither ever puts a node at a range's own
  // midpoint) fixes this at its source: both squares below are now always
  // valued, never even transiently refused. Pinned exactly, not "either a
  // value or a refusal" (fix round 5, finding 5).
  it('1/sqrt(x^2 + y^2) over [-1, 1]^2 is 8 asinh(1) — never "does not converge", and no longer even "did not settle"', () => {
    const { scene, ms } = timedScene('volume: under 1/sqrt(x^2 + y^2) over x in [-1, 1], y in [-1, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    // SAFETY (breaker ruling, F1) drops this to 1 digit from round 5's 3.
    expect(text).toBe('∬_R (1/sqrt(x^2 + y^2)) dA ≈ 7')
    expect(Math.abs(approx(text, 'dA') - 8 * Math.asinh(1))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  }, HEAVY_MS)

  it('1/sqrt(x^2 + y^2) over [-2, 2]^2 is 16 asinh(1) — the same fix, a differently scaled square', () => {
    const { scene, ms } = timedScene('volume: under 1/sqrt(x^2 + y^2) over x in [-2, 2], y in [-2, 2]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    // SAFETY (F1, breaker ruling) drops this to 2 digits from round 5's 3.
    expect(text).toBe('∬_R (1/sqrt(x^2 + y^2)) dA ≈ 14')
    expect(Math.abs(approx(text, 'dA') - 16 * Math.asinh(1))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
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
  // Pins the exact printed string, not just a loose digit-unit bound (fix
  // round 5, finding 5: these are the four cases refusals.test.ts's own
  // former line 276 covered).
  const read = (spec: string, name: string, exact: number, pinned: string): string => {
    const { scene, ms } = timedScene(spec)
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(text).toBe(pinned)
    expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    return text
  }

  it('1/sqrt|y|, ln|y| and ln(y^2) over x in [0, 1], y in [-1, 1] are 4, -2 and -4', () => {
    read('volume: under 1/sqrt(abs(y)) over x in [0, 1], y in [-1, 1]', 'dA', 4, '∬_R (1/sqrt(abs(y))) dA ≈ 4')
    read(
      'volume: under ln(abs(y)) over x in [0, 1], y in [-1, 1]',
      'dA',
      -2,
      '∬_R (ln(abs(y))) dA ≈ −2; (ln(abs(y))) < 0 on part of R; the integral counts that part negatively',
    )
    read(
      'volume: under ln(y^2) over x in [0, 1], y in [-1, 1]',
      'dA',
      -4,
      '∬_R (ln(y^2)) dA ≈ −4; (ln(y^2)) < 0 on part of R; the integral counts that part negatively',
    )
  }, HEAVY_MS)

  it('3D ln|z|, z in [-1, 1] is -2', () => {
    read('volume: x in [0, 1], y in [0, 1], z in [-1, 1] integrand ln(abs(z))', 'dV', -2, '∭ (ln(abs(z))) dV ≈ −2')
  }, HEAVY_MS)

  // S5 breaker ruling, F3: pinned to the deterministic result, not "either
  // outcome" — three nested levels of adaptive refinement near z = 0 (x and
  // y both need to sample it fresh at every node) cost more than one
  // integral's 6,000,000-evaluation budget can buy, so this always "did not
  // settle", never a value and never "does not converge".
  it('3D 1/sqrt|z|, z in [-1, 1] (expect 4): the same singularity, nested one level deeper, never settles within budget — "did not settle", never "does not converge"', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [-1, 1] integrand 1/sqrt(abs(z))')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(new RegExp(`^the integral did not settle within ${BUDGET} evaluations`))])
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
// S5 breaker ruling, F1: a singular result's error already carries C1's own
// ×10 belt-and-braces; SAFETY (×100 more) makes it ×1000 against the raw
// qk15 estimate — every case below fails SAFETY's own search for an honest
// unit. S5 breaker follow-up, F1c: the honest fallback (one significant
// digit, or one unit coarser, under the raw error alone) rescues each of
// them instead of a refusal — a genuine value, heavily coarsened, never a
// wrong one.
describe('an interior singularity narrowed to a sliver still reports its tail (fix round 4, C1)', () => {
  it('|x - 0.25|^-0.8 over the unit square, as an outer and as an inner variable — hand value 8.509729, prints ≈ 10', () => {
    for (const spec of ['volume: under abs(x - 0.25)^(-0.8) over x in [0, 1], y in [0, 1]', 'volume: under abs(y - 0.25)^(-0.8) over x in [0, 1], y in [0, 1]']) {
      const { scene, ms } = timedScene(spec)
      expect(ms).toBeLessThan(GUARD_MS)
      expect(scene.errors).toEqual([])
      expect(approx(readout(scene, 1).text, 'dA')).toBe(10)
    }
  })

  it('|x - 0.123|^-0.8 (an off-centre anchor) — hand value 8.158605, prints ≈ 8', () => {
    const { scene, ms } = timedScene('volume: under abs(x - 0.123)^(-0.8) over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    expect(approx(readout(scene, 1).text, 'dA')).toBe(8)
  })

  it('|x - 0.25|^-0.75 (a milder exponent) — hand value 6.550847, prints ≈ 7', () => {
    const { scene, ms } = timedScene('volume: under abs(x - 0.25)^(-0.75) over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(GUARD_MS)
    expect(scene.errors).toEqual([])
    expect(approx(readout(scene, 1).text, 'dA')).toBe(7)
  })

  it('a region bounded by y <= |x - 0.25|^-0.8 reads the same hand value, prints ≈ 10', () => {
    const scene = sceneOf('region: x in [0, 1], y in [0, abs(x - 0.25)^(-0.8)]')
    expect(scene.errors).toEqual([])
    expect(approx(readout(scene, 1).text, 'area')).toBe(10)
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
    // SAFETY (breaker ruling, F1) means the stated error must now be small
    // enough that even 100x it still covers the rounding gap.
    expect(approxText(determined({ value: 3.14159, error: 0.00005, scale: 3.2 }))).toBe('≈ 3.1')
  })
})

// S5 fix round 5, finding 4, then the breaker ruling's F1: the digit count a
// formatter shows must cover the error by at least half a unit of the *last
// digit actually printed*, read off the rounded value (round 5) — and, since
// adaptive error estimates measured up to 29x short of the truth on some
// kinks, that error is SAFETY (100x) times the stated one before the check,
// dropping digits past the leading one to a coarser unit where even that
// is not enough (S5_SAFETY, tolerance.ts). When no unit at all covers it,
// the existing half-value refusal applies.
describe('digits print only what the error supports, with a SAFETY margin on the stated error (fix round 5 / breaker ruling, F1)', () => {
  it('y^(-0.9) on the inner range: hand value 1 / (1 - 0.9) = 10, raw value 9.999994872133758 ± 5.4449803620800676e-6 prints ≈ 10, not ≈ 9.99999', () => {
    expect(approxText({ value: 9.999994872133758, error: 0.0000054449803620800676, scale: 10 })).toBe('≈ 10')
    const scene = sceneOf('volume: under y^(-0.9) over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([])
    expect(readout(scene, 1).text).toBe('∬_R (y^(-0.9)) dA ≈ 10')
  })

  it('the brief’s own worked example: 9.4 ± 0.04 (SAFETY-scaled to 4) prints ≈ 10: |10 - 9.4| + 4 = 4.6 <= 5', () => {
    expect(approxText({ value: 9.4, error: 0.04, scale: 9.4 })).toBe('≈ 10')
  })

  it('the kink-rectangle motivating case: ∬|x-y| over [0,4]x[0,1] is 19/3 = 6.333333333…; the stated error (2.55e-11) missed the true one (7.38e-10) by 29x, SAFETY covers it', () => {
    const scene = sceneOf('volume: under abs(x - y) over x in [0, 4], y in [0, 1]')
    expect(scene.errors).toEqual([])
    // The full text (S6 plan V3): the on-figure `.text` caps at DISPLAY_DIGITS,
    // fewer than the 8 digits this pin checks.
    const text = readoutFull(scene, 1)
    expect(text).toBe('∬_R (abs(x - y)) dA ≈ 6.3333333')
    expect(Math.abs(approx(text, 'dA') - 19 / 3)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })

  it('max(x, y) over [0,4]x[0,1] is 49/6, over [0,2]x[0,1] is 13/6, over [0,1]x[0,1.2] is 0.88666666…67 — all digits correct', () => {
    for (const [spec, exact] of [
      ['volume: under max(x, y) over x in [0, 4], y in [0, 1]', 49 / 6],
      ['volume: under max(x, y) over x in [0, 2], y in [0, 1]', 13 / 6],
      ['volume: under max(x, y) over x in [0, 1], y in [0, 1.2]', 0.8866666666666667],
    ] as const) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dA') - exact)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
  })

  // S5 breaker follow-up, F1c pin: 5.414953129607524 ± 0.00433518985552053
  // (already ×10-floored, singular): SAFETY (×100 more) makes the effective
  // error 0.4335, and no unit is honest under it — but the honest fallback
  // tries one significant digit ("5") under the RAW error alone instead:
  // |5 - 5.414953| + 0.004335 = 0.419288 <= 0.5, honest. A correct prefix,
  // not a refusal.
  it('|x - 0.5|^-0.7 (a singular, ×1000-total case): hand value 5.415016 prints ≈ 5, a correct prefix, not a refusal', () => {
    const scene = sceneOf('volume: under abs(x - 0.5)^(-0.7) over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([])
    expect(readout(scene, 1).text).toBe('∬_R (abs(x - 0.5)^(-0.7)) dA ≈ 5')
  })
})

// S5 fix round 5 (minor): a divergence claim downgraded because the two
// passes merely disagreed on it (unsettled(), I1c) used to keep the
// genuine-slow-decay wording ("the pieces shed there shrink too slowly to
// tell a value from divergence in floating point"), which misstates why —
// the passes' disagreement says nothing about how fast anything decays.
describe('a downgraded divergence claim says only that it did not settle, not why (fix round 5, minor)', () => {
  it('refusalOf on a downgraded QuadratureError drops the "shrink too slowly" reason', () => {
    const err = new QuadratureError('slow')
    err.downgraded = true
    err.at[0] = 0
    expect(refusalOf(err, [{ name: 'x', lower: '0', upper: '1' }]).message).toBe('the integral did not settle near x = 0')
  })

  it('a genuine slow-decay refusal (not downgraded) keeps the fuller reason', () => {
    const err = new QuadratureError('slow')
    err.at[0] = 0
    expect(refusalOf(err, [{ name: 'x', lower: '0', upper: '1' }]).message).toBe(
      'the integral did not settle near x = 0: the pieces shed there shrink too slowly to tell a value from divergence in floating point',
    )
  })
})
