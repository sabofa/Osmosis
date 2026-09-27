// S5 fix round 1: integrals that have no value are refused on their line, in
// well under a second, and the figure still draws.

import { describe, expect, it } from 'vitest'
import type { SceneError, SpaceScene } from '../../scene/types'
import { markNamed, readout, sceneOf } from './testing'

function timedScene(spec: string): { scene: SpaceScene; ms: number } {
  const start = performance.now()
  const scene = sceneOf(spec)
  return { scene, ms: performance.now() - start }
}

const on = (errors: readonly SceneError[], line: number) => errors.filter((e) => e.line === line).map((e) => e.message)

describe('divergent integrals are refused within the evaluation budget', () => {
  it('volume: x in [0, 1], y in [0, 1], z in [0, 1/x] — does not converge near x = 0, and the faces still draw', () => {
    const { scene, ms } = timedScene('volume: x in [0, 1], y in [0, 1], z in [0, 1/x]')
    expect(ms).toBeLessThan(1000)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the integral does not converge near x = 0/)])
    expect(scene.marks.some((m) => m.source.object.startsWith('s1.face'))).toBe(true)
    expect(scene.labels.filter((l) => l.source.object === 's1.readout')).toEqual([])
  })

  it('volume: under 1/x over x in [0, 1], y in [0, 1] — does not converge near x = 0; the surface still draws', () => {
    const { scene, ms } = timedScene('volume: under 1/x over x in [0, 1], y in [0, 1]')
    expect(ms).toBeLessThan(1000)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the integral does not converge near x = 0/)])
    markNamed(scene, 's1', 'mesh')
  })

  it('a named divergent volume is refused on its own line, and centroid: of it on its line, together in under a second', () => {
    const { scene, ms } = timedScene(
      'V = volume x in [0, 1], y in [0, 1], z in [0, 1/x]\nW = volume under 1/x over x in [0, 1], y in [0, 1]\ncentroid: V\ncentroid: W',
    )
    expect(ms).toBeLessThan(1000)
    for (const line of [1, 2, 3, 4]) expect(on(scene.errors, line)).toEqual([expect.stringMatching(/does not converge near x = 0/)])
  })

  it('1/x over x in [-1, 1] is undefined at x = 0, never "≈ ∞"', () => {
    const scene = sceneOf('volume: under 1/x over x in [-1, 1], y in [0, 1]')
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the integral is undefined: the integrand is not a number at \(x, y\) = \(0, 0\.5\)/)])
    expect(scene.labels.map((l) => l.text).join()).not.toMatch(/∞/)
  })

  it('an unbounded region’s area, and a Riemann sum’s integral, are refused; the Riemann sum itself still reads', () => {
    expect(on(sceneOf('region: x in [0, 1], y in [0, 1/x]').errors, 1)).toEqual([expect.stringMatching(/does not converge near x = 0/)])
    const riemann = sceneOf('riemann: under 1/x over x in [0, 1], y in [0, 1], n = 2')
    expect(on(riemann.errors, 1)).toEqual([expect.stringMatching(/does not converge near x = 0/)])
    // samples at x = 0.25 and 0.75: (4 + 4/3 + 4 + 4/3) × 1/4 = 8/3
    expect(readout(riemann, 1).text).toBe('Σ (1/x) ΔA ≈ 2.667')
  })

  it('over an inequality region: a sum that does not settle as its mesh refines is refused', () => {
    const { scene, ms } = timedScene('volume: under 1/(x^2 + y^2) over x^2 + y^2 <= 1')
    expect(ms).toBeLessThan(1000)
    expect(on(scene.errors, 1)).toEqual([expect.stringMatching(/^the integral does not converge: its sum over the mesh does not settle as the mesh refines/)])
  })

  it('the refusal names the region’s own variables: polar r and theta', () => {
    const scene = sceneOf('volume: under 1/r over r in [0, 1], theta in [0, pi]')
    // ∫∫ (1/r) r dr dθ = π converges; 1/r^2 does not
    expect(scene.errors).toEqual([])
    const bad = sceneOf('volume: under 1/r^2 over r in [0, 1], theta in [0, pi]')
    expect(on(bad.errors, 1)).toEqual([expect.stringMatching(/does not converge near r = 0/)])
  })
})
