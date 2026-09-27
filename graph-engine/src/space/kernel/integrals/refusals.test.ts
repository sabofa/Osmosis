// S5 fix rounds 1 and 2: integrals that have no value are refused on their
// line, in well under a second, the figure still drawn; integrals that have
// one are never refused.

import { describe, expect, it } from 'vitest'
import type { SceneError, SpaceScene } from '../../scene/types'
import { approx, approxTuple, lastDigitUnit, markNamed, readout, sceneOf } from './testing'

function timedScene(spec: string): { scene: SpaceScene; ms: number } {
  const start = performance.now()
  const scene = sceneOf(spec)
  return { scene, ms: performance.now() - start }
}

const on = (errors: readonly SceneError[], line: number) => errors.filter((e) => e.line === line).map((e) => e.message)
const GROWS_AT_X0 = /^the integral does not converge: it grows without bound near x = 0$/

describe('textbook integrals are not refused (each under a second, every printed digit right)', () => {
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
      expect(ms).toBeLessThan(1000)
      expect(scene.errors).toEqual([])
      const text = readout(scene, line).text
      expect(Math.abs(approx(text, name) - exact)).toBeLessThanOrEqual(lastDigitUnit(text, name))
    })
  }

  it(`W = volume under sqrt(1-x^2-y^2) over the rectangular disc, then centroid: W — (0, 0, 3/8)`, () => {
    const { scene, ms } = timedScene(`W = volume under sqrt(1-x^2-y^2) over ${ball}\ncentroid: W`)
    expect(ms).toBeLessThan(1000)
    expect(scene.errors).toEqual([])
    const [x, y, z] = approxTuple(readout(scene, 2).text, 'centroid')
    expect([x, y]).toEqual([0, 0])
    expect(Math.abs(z - 0.375)).toBeLessThan(1e-6)
  })

  it('1/(x^2 + y^2 + z^2) over the unit cube converges: its value, or at worst "did not settle" — never "does not converge"', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [0, 1] integrand 1/(x^2 + y^2 + z^2)')
    expect(ms).toBeLessThan(1000)
    for (const e of scene.errors) expect(e.message).toMatch(/^the integral did not settle within 3,000,000 evaluations/)
  })
})

describe('divergent integrals are refused, found directly, with where', () => {
  it('volume: x in [0, 1], y in [0, 1], z in [0, 1/x] — grows without bound near x = 0; the faces still draw', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [0, 1/x]')
    expect(ms).toBeLessThan(1000)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    expect(scene.marks.some((m) => m.source.object.startsWith('s1.face'))).toBe(true)
    expect(scene.labels.filter((l) => l.source.object === 's1.readout')).toEqual([])
  })

  it('volume: under 1/x over x in [0, 1], y in [0, 1] — grows without bound near x = 0; the surface still draws', () => {
    const { scene, ms } = timedScene('volume: under 1/x over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(1000)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(GROWS_AT_X0)])
    markNamed(scene, 's1', 'mesh')
  })

  it('a named divergent volume is refused on its own line, and centroid: of it on its line, together in under a second', () => {
    const { scene, ms } = timedScene(
      'V = volume x in [0, 1], y in [0, 1], z in [0, 1/x]\nW = volume under 1/x over x in [0, 1], y in [0, 1]\ncentroid: V\ncentroid: W',
    )
    expect(ms).toBeLessThan(1000)
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
      expect(ms).toBeLessThan(1000)
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
