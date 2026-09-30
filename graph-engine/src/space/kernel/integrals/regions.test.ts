import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { approx, kernelOf, lastDigitUnit, markNamed, meshArea, polylines, readout, sceneOf, vertices } from './testing'

describe('region: type I, x in [0, 1], y in [x^2, x]', () => {
  const scene = sceneOf('region: x in [0, 1], y in [x^2, x]')

  it('reads its area ≈ 1/6 (the integral of x - x^2 from 0 to 1) to 1e-10', () => {
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - 1 / 6)).toBeLessThan(1e-10)
  })

  it('draws its boundary exactly on y = x^2 and y = x, with points on both', () => {
    const boundary = markNamed(scene, 's1.boundary', 'lines')
    const onParabola = (p: number[]) => Math.abs(p[1] - p[0] * p[0]) < 1e-12
    const onLine = (p: number[]) => Math.abs(p[1] - p[0]) < 1e-12
    const points = vertices(boundary)
    expect(points.every((p) => onParabola(p) || onLine(p))).toBe(true)
    expect(points.filter((p) => onParabola(p) && p[0] > 0.1 && p[0] < 0.9).length).toBeGreaterThan(100)
    expect(points.filter((p) => onLine(p) && p[0] > 0.1 && p[0] < 0.9).length).toBeGreaterThan(100)
    // The sides x = 0 and x = 1 are single points: dropped, so two pieces of 256 segments.
    expect(polylines(boundary).map((l) => l.length)).toEqual([257, 257])
  })

  it('anchors its readout halfway along its longest boundary piece, clear of its centre and the box corners', () => {
    // the half-disc: the arc (length π) beats the diameter (2); its middle is
    // (0, 1), on the floor: with no z data the box pass (J1) gives z [-5, 5]
    const [x, y, z] = readout(sceneOf('region: r in [0, 1], theta in [0, pi]'), 1).position
    expect([Math.abs(x) < 1e-12, y, z]).toEqual([true, 1, -5])
    // type I: the parabola (length √5/2 + asinh(2)/4 = 1.4789) beats the line (1.4142). Half
    // its length, 0.7394, is reached at x = 0.6106 (L(0.60) = 0.7226, L(0.62) = 0.7542); the
    // anchor is the first of its 256 samples past it, x = 157/256.
    const [px, py] = readout(sceneOf('region: x in [0, 1], y in [x^2, x]'), 1).position
    expect(px).toBe(157 / 256)
    expect(py).toBeCloseTo(px * px, 12)
  })

  it('is a set: either range written high-to-low gives the same area', () => {
    // Each reverses the iterated integral's sign once.
    for (const spec of ['region: x in [1, 0], y in [x^2, x]', 'region: x in [0, 1], y in [x, x^2]']) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      expect(Math.abs(approx(readout(scene, 1).text, 'area') - 1 / 6)).toBeLessThan(1e-10)
    }
  })

  it('shades the region on the box floor (with no z data the box pass, J1, gives z [-5, 5]), at opacity 0.35', () => {
    const floor = markNamed(scene, 's1', 'mesh')
    expect(vertices(floor).every((p) => p[2] === -5)).toBe(true)
    expect(floor.style.opacity).toBe(0.35)
    expect(meshArea(floor)).toBeCloseTo(1 / 6, 3)
    const raised = sceneOf('@bounds3d: z [-2, 3]\nregion: x in [0, 1], y in [x^2, x]')
    expect(vertices(markNamed(raised, 's2', 'mesh')).every((p) => p[2] === -2)).toBe(true)
  })
})

describe('region: polar and inequality', () => {
  it('r in [0, 2], theta in [0, pi/2]: area ≈ pi', () => {
    const scene = sceneOf('region: r in [0, 2], theta in [0, pi/2]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI)).toBeLessThan(1e-10)
  })

  it('r in [0, 1], theta in [0, pi]: area ≈ pi/2, which needs the Jacobian r (without it, pi)', () => {
    // r in [0, 2] cannot tell: the integral of r from 0 to 2 is 2, its length.
    const scene = sceneOf('region: r in [0, 1], theta in [0, pi]')
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI / 2)).toBeLessThan(1e-10)
  })

  it('theta written first (the outer variable) is the same region', () => {
    const scene = sceneOf('region: theta in [0, pi], r in [0, 1]')
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI / 2)).toBeLessThan(1e-10)
  })

  it('a full turn drops the theta seam and the centre: its boundary is the circle alone', () => {
    const scene = sceneOf('region: r in [0, 2], theta in [0, 2*pi]')
    const pieces = polylines(markNamed(scene, 's1.boundary', 'lines'))
    expect(pieces).toHaveLength(1)
    for (const p of pieces[0]) expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 12)
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - 4 * Math.PI)).toBeLessThan(1e-9)
  })

  it('x^2 + y^2 <= 4 and y >= 0 at res 128: whatever digits it prints are right (a SAFETY margin, F1, may print fewer)', () => {
    const scene = sceneOf('region: x^2 + y^2 <= 4 and y >= 0 res: 128')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    const area = approx(text, 'area')
    expect(Math.abs(area - 2 * Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
    // Its boundary lies on the circle or on y = 0.
    for (const p of vertices(markNamed(scene, 's1.boundary', 'lines'))) {
      expect(Math.abs(Math.hypot(p[0], p[1]) - 2) < 1e-6 || Math.abs(p[1]) < 1e-12).toBe(true)
    }
  })

  // S5 breaker follow-up, F1a: a bounded inequality-region mesh sum's own
  // error is a direct measurement (mesh: true), not a heuristic quadrature
  // estimate, so it skips SAFETY — this area values, deterministically,
  // never a refusal.
  it('a small disc at the default resolution: right digits, never a refusal', () => {
    const scene = sceneOf('region: x^2 + y^2 <= 0.25')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') - Math.PI / 4)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })
})

describe('boundary orientation: every piece runs counter-clockwise, the region on its left', () => {
  // The probe's distance from the boundary: the iterated boundaries lie on
  // their curves; the mesh's is chords, up to 5e-4 inside the circle, so its
  // probe steps past that.
  const cases: [string, (x: number, y: number) => boolean, number][] = [
    ['region: x in [0, 1], y in [x^2, x]', (x, y) => x > 0 && x < 1 && y > x * x && y < x, 1e-4],
    ['region: x in [1, 0], y in [x^2, x]', (x, y) => x > 0 && x < 1 && y > x * x && y < x, 1e-4],
    ['region: y in [0, 2], x in [0, y/2]', (x, y) => y > 0 && y < 2 && x > 0 && x < y / 2, 1e-4],
    ['region: r in [1, 2], theta in [0, pi/2]', (x, y) => Math.hypot(x, y) > 1 && Math.hypot(x, y) < 2 && x > 0 && y > 0, 1e-4],
    ['region: theta in [0, pi/2], r in [1, 2]', (x, y) => Math.hypot(x, y) > 1 && Math.hypot(x, y) < 2 && x > 0 && y > 0, 1e-4],
    ['region: x^2 + y^2 <= 1 and y >= 0', (x, y) => x * x + y * y < 1 && y > 0, 1e-2],
  ]
  for (const [spec, inside, eps] of cases) {
    it(spec, () => {
      const pieces = polylines(markNamed(sceneOf(spec), 's1.boundary', 'lines'))
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        for (let k = 0; k + 1 < piece.length; k += Math.max(1, Math.floor(piece.length / 7))) {
          const [p, q] = [piece[k], piece[k + 1]]
          const len = Math.hypot(q[0] - p[0], q[1] - p[1])
          if (len === 0) continue
          const left = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len]
          const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
          expect([spec, k, inside(mid[0] + eps * left[0], mid[1] + eps * left[1])]).toEqual([spec, k, true])
          expect([spec, k, inside(mid[0] - eps * left[0], mid[1] - eps * left[1])]).toEqual([spec, k, false])
        }
      }
    })
  }
})

describe('named regions and "over R"', () => {
  it('R = region ... draws nothing on its own', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]')
    expect(scene.errors).toEqual([])
    expect(scene.marks).toEqual([])
  })

  it('z = x + y over R: every vertex has 0 <= y <= x <= 1', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\nz = x + y over R')
    expect(scene.errors).toEqual([])
    const surface = markNamed(scene, 's2', 'mesh')
    expect(vertices(surface).length).toBeGreaterThan(100)
    for (const [x, y, z] of vertices(surface)) {
      expect(y).toBeGreaterThanOrEqual(-1e-12)
      expect(y).toBeLessThanOrEqual(x + 1e-12)
      expect(x).toBeLessThanOrEqual(1 + 1e-12)
      expect(z).toBeCloseTo(x + y, 12)
    }
  })

  it('z = x over a polar R is sampled in (r, theta) and evaluated at (x, y)', () => {
    const scene = sceneOf('R = region r in [0, 1], theta in [0, pi/2]\nz = x over R')
    expect(scene.errors).toEqual([])
    for (const [x, y, z] of vertices(markNamed(scene, 's2', 'mesh'))) {
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-12)
      expect(z).toBeCloseTo(x, 12)
    }
  })

  it('region: R draws the named region', () => {
    const scene = sceneOf('R = region r in [0, 2], theta in [0, pi/2]\nregion: R')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 2).text, 'area') - Math.PI)).toBeLessThan(1e-10)
  })

  it('a region defined as another follows it; a cycle is refused', () => {
    expect(sceneOf('R = region x in [0, 1], y in [0, x]\nS = region R\nregion: S').errors).toEqual([])
    const cycle = sceneOf('R = region S\nS = region R\nregion: R')
    // Every line that resolves the cycle says so.
    expect(cycle.errors.map((e) => e.line)).toEqual([1, 2, 3])
    for (const e of cycle.errors) expect(e.message).toMatch(/defined in terms of itself \((R|S) → (R|S) → (R|S)\)/)
  })

  it('an unknown name is refused on the line that uses it', () => {
    expect(sceneOf('z = x over R').errors).toEqual([{ line: 1, message: expect.stringMatching(/no region named "R"/) }])
  })

  it('a name bound twice is refused on the later line', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\nR = region x in [0, 2], y in [0, x]')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"R" is named twice \(lines 1 and 2\)/) }])
  })

  it('a named region that reads a parameter rebuilds the surface over it on setValue', () => {
    const kernel = kernelOf('@param a = 1 range [0.5, 2]\nR = region x in [0, a], y in [0, x]\nz = x over R')
    const maxX = (mesh: MeshMark) => Math.max(...vertices(mesh).map((p) => p[0]))
    expect(maxX(markNamed(kernel.scene(), 's3', 'mesh'))).toBe(1)
    expect(maxX(markNamed(kernel.setValue('a', 2), 's3', 'mesh'))).toBe(2)
  })

  it('crossing bounds on a named region are refused where it is used', () => {
    const scene = sceneOf('R = region x in [0, 2], y in [x, 1]\nregion: R')
    expect(scene.errors.some((e) => e.line === 2 && /cross near x = 1/.test(e.message))).toBe(true)
  })
})

describe('inequality regions: meshed on their own box, every printed digit right (fix round 2)', () => {
  for (const r of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5]) {
    // S5 breaker follow-up, F1a: bounded mesh sums skip SAFETY (mesh: true,
    // common.ts), so every one of these values, deterministically.
    it(`the disc of radius ${r} at the default resolution: area πr², never a refusal`, () => {
      const scene = sceneOf(`region: x^2 + y^2 <= ${r * r}`)
      expect(scene.errors).toEqual([])
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'area') - Math.PI * r * r)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
    })
  }

  it('a small region is meshed on its own box: the drawn floor spans it at full resolution', () => {
    const floor = markNamed(sceneOf('region: x^2 + y^2 <= 0.01'), 's1', 'mesh')
    const xs = vertices(floor).map((p) => p[0])
    // 96 cells over about 0.3 across, not 2 cells of the box's 10/96
    expect(new Set(xs.map((v) => v.toFixed(9))).size).toBeGreaterThan(50)
  })

  // S5 breaker ruling, F2: a region this tiny relative to the box is
  // flagged thin from the start (isThin), so it is never fitted and never
  // reaches fittedBox's own "empty or too small" throw; instead it is
  // meshed on the authored box as resolution doubles, an aliasing case
  // where a probe near res 190 happens to catch a sliver of it while a
  // coarser one misses it outright (sums 2.414e-6, 2.414e-6, 0, 2.414e-6 at
  // res 24, 48, 95, 190) — too erratic to trust, refused honestly as
  // "shrinks too slowly", never a wrong confident number.
  it('a region the grid cannot find is refused, saying what to do', () => {
    expect(sceneOf('region: x^2 + y^2 <= 0.000001 res: 95').errors).toEqual([
      {
        line: 1,
        message:
          'the integral did not settle on this mesh (its sums 2.414×10⁻⁶, 2.414×10⁻⁶, 0, 2.414×10⁻⁶ at res 24, 48, 95, 190 shrink too slowly to judge) — raise res:',
      },
    ])
  })

  it('a polygon is meshed exactly: abs(x) + abs(y) <= 1 at res 32 reads 2', () => {
    expect(readout(sceneOf('region: abs(x) + abs(y) <= 1 res: 32'), 1).text).toBe('area ≈ 2')
  })

  it('the hemisphere over the disc at res 160: no sample lands outside, so no NaN; digits right', () => {
    const scene = sceneOf('volume: under sqrt(1 - x^2 - y^2) over x^2 + y^2 <= 1 res: 160')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - (2 * Math.PI) / 3)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})

describe('inequality regions: samples never fall outside, divergence only on evidence (fix round 2)', () => {
  it('a concave boundary: sqrt(x^2 + y^2 - 1) over the annulus 1 <= r <= 2 is 2π√3, no sample in the hole', () => {
    // the chords along r = 1 lie in the hole, where the integrand is not a number
    const scene = sceneOf('volume: under sqrt(x^2 + y^2 - 1) over x^2 + y^2 >= 1 and x^2 + y^2 <= 4')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - 2 * Math.PI * Math.sqrt(3))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })

  it('a bounded, oscillating integrand is not taken for divergence: 1 + sin(40x) over the unit disc is π', () => {
    for (const spec of ['volume: under 1 + sin(40*x) over x^2 + y^2 <= 1', 'volume: under 1 + sin(20*x)*sin(20*y) over x^2 + y^2 <= 1']) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dA') - Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
    // Under-resolved rings: the sums wander (6.257, 6.262, 6.282, 6.255) without shrinking, but
    // |g| <= 3 everywhere, so it is a value with a wide error, never divergence. S5 breaker
    // follow-up, F1a: this is a bounded mesh sum (mesh: true), so it skips SAFETY and values,
    // deterministically. 2π(1 + sin(150)/300)
    const rings = sceneOf('volume: under 2 + cos(150*(x^2+y^2)) over x^2 + y^2 <= 1')
    expect(rings.errors).toEqual([])
    const text = readout(rings, 1).text
    expect(Math.abs(approx(text, 'dA') - 2 * Math.PI * (1 + Math.sin(150) / 300))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})

describe('thin regions are summed on a finer grid, or refused (fix round 3)', () => {
  it('a slanted strip 0.04 wide at res 48 reads 0.16, every digit right (it read 0.2 on the coarse grid)', () => {
    // |y - x| <= 0.02·√2 is 0.04 across; |x + y| <= 2√2 makes it 4 long
    const text = readout(sceneOf('region: abs(y - x) <= 0.02*sqrt(2) and abs(x + y) <= 2*sqrt(2) res: 48'), 1).text
    expect(Math.abs(approx(text, 'area') - 0.16)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
    expect(lastDigitUnit(text, 'area')).toBeLessThanOrEqual(0.01)
  })

  // S5 breaker follow-up, F1a: a bounded mesh sum, so it skips SAFETY and
  // values, deterministically.
  it('a ring 0.04 wide at res 40 reads π·0.08 ≈ 0.25, every digit right, never a refusal', () => {
    const scene = sceneOf('region: x^2 + y^2 >= 0.95 and x^2 + y^2 <= 1.03 res: 40')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') - 0.08 * Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })

  // S5 breaker ruling, F2: the message changed ("too thin to resolve at res
  // 400", not "thinner than the grid at res 400 (about ... across)") — this
  // region is never fitted, so there is no fitted thickness left to report;
  // the offset and un-offset grids on the authored box still disagree by
  // more than the bounded-sum error rule times SAFETY, all the way to res
  // 400, so it is refused there, deterministically.
  it('a strip thinner than the finest grid is refused, with no number — never a value', () => {
    const scene = sceneOf('region: abs(y - x) <= 0.0002 and abs(x + y) <= 2 res: 48')
    expect(scene.errors).toEqual([{ line: 1, message: 'the region is too thin to resolve at res 400 — raise res:, or write it as ranges' }])
  })
})

// S5 fix round 4, C3: a thin region bounded on only one axis by its own
// conditions (abs(x) <= 2, with y bounded only by the default box) is much
// smaller, relative to the default box, than the earlier round-3 strips
// above (bounded on both axes by their own conditions). The coarse mesh at
// res 40/48 catches only a fragment of it — fittedBox trusted that fragment
// as the whole region, silently dropping the rest.
describe('a thin region the coarse mesh only fragments is never a wrong area (fix round 4, C3)', () => {
  // S5 breaker ruling, F2: never fitted and run on the authored box, this
  // strip's own offset/un-offset grids now agree — and the region clears
  // the "no longer thin" bar — well before res 400 at res 40 and res 48,
  // so both print the exact hand value 0.16. The default resolution starts
  // much coarser (its own doublings still disagree all the way to the
  // cap), so it is refused there instead — never the round-4 fragment
  // values 0.0253, 0.022 or 0.2 either way.
  it('a slanted strip 0.04 wide (hand value 0.16), at res 40 and res 48: values exactly — never 0.0253 or 0.022', () => {
    for (const spec of ['region: abs(y - 0.3*x) <= 0.02 and abs(x) <= 2 res: 40', 'region: abs(y - 0.3*x) <= 0.02 and abs(x) <= 2 res: 48']) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      expect(readout(scene, 1).text).toBe('area ≈ 0.16')
    }
  })

  it('the same strip at the default resolution is too thin to resolve even at res 400 — never 0.2', () => {
    expect(sceneOf('region: abs(y - 0.3*x) <= 0.02 and abs(x) <= 2').errors).toEqual([
      { line: 1, message: 'the region is too thin to resolve at res 400 — raise res:, or write it as ranges' },
    ])
  })

  // S5 breaker follow-up, F1a: this narrower strip (half as wide as the one
  // above) is a bounded mesh sum, so it skips SAFETY and values outright —
  // never the round-4 fragment 0.00967.
  it('a slanted strip 0.02 wide (hand value 0.08) at res 48 values honestly — never 0.00967 (the C3 pin)', () => {
    const scene = sceneOf('region: abs(y - 0.3*x) <= 0.01 and abs(x) <= 2 res: 48')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') - 0.08)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })

  it('a small round region is unaffected: the disc of radius 0.05 still fits and values, not refused', () => {
    const scene = sceneOf('region: x^2 + y^2 <= 0.0025')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') - Math.PI * 0.0025)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })
})

// S5 fix round 5: the round-4 stability test (fittedBox trusted only when
// doubling the resolution found much the same extent) compared nested
// grids — a 2n grid contains every vertex of the n grid, so a fragment
// found at n was found again at 2n, and looked stable. These three cases
// (found by the round-4 re-review) are thin only on one axis (abs(x) <= 2,
// with y bounded only by the default box) and at a resolution where that
// nesting coincidence bit: each printed a wrong, truncated area. The fit is
// now redone from scratch on a grid offset by half a cell, and doubled
// (with its own fresh offset re-fit each time) until its area agrees with
// the un-offset fit's — a fragment is crossed differently by an offset
// grid, so the coincidence cannot repeat.
describe('offset-grid re-fitting replaces the nested stability check (fix round 5)', () => {
  // S5 breaker ruling, F2: never fitted now, this strip's grids agree well
  // before res 400 (see the C3 describe block above, same condition) —
  // values exactly, never a refusal, and never the round-4 fragment
  // 0.0386666667.
  it('|y - 0.3x| <= 0.02, |x| <= 2 at res 24 (hand 0.16): values exactly, never 0.0386666667', () => {
    const scene = sceneOf('region: abs(y - 0.3*x) <= 0.02 and abs(x) <= 2 res: 24')
    expect(scene.errors).toEqual([])
    expect(readout(scene, 1).text).toBe('area ≈ 0.16')
  })

  // S5 breaker follow-up, F1a: the mesh genuinely settles on the exact hand
  // area (0.4 raw, confirmed by an independent offset-grid agreement check
  // reaching 5e-12 at its own finest doubling) well before res 400 — and,
  // as a bounded mesh sum, this readout's own error (the larger of the
  // last two changes) skips SAFETY entirely, so the earlier-documented
  // regression (this case refusing under SAFETY despite an exact raw
  // value) is resolved: it prints "area ≈ 0.4" outright, never 0.32.
  it('|y - 0.6x| <= 0.05, |x| <= 2 at res 40 (hand 0.1 x 4 = 0.4): values exactly, never 0.32', () => {
    const scene = sceneOf('region: abs(y - 0.6*x) <= 0.05 and abs(x) <= 2 res: 40')
    expect(scene.errors).toEqual([])
    expect(readout(scene, 1).text).toBe('area ≈ 0.4')
  })

  // S5 breaker ruling, F2: message changed ("too thin to resolve at res
  // 400"); still refused there, deterministically — this strip's grids
  // never agree on the authored box within SAFETY, all the way to the cap.
  it('|y - 0.1x| <= 0.02, |x| <= 2 at res 64 (hand 0.16): refuses honestly, never 0.1535', () => {
    expect(sceneOf('region: abs(y - 0.1*x) <= 0.02 and abs(x) <= 2 res: 64').errors).toEqual([
      { line: 1, message: 'the region is too thin to resolve at res 400 — raise res:, or write it as ranges' },
    ])
  })
})

// S5 fix round 4, C2: a singular mesh sum's error trusted only the last
// change (d1), which can be a lucky small middle step in an otherwise slow
// sequence — the change before it (d2) told the truth. The error is now the
// larger of the tail and both of the last two changes, as a bounded sum's
// already was.
describe("a singular mesh sum's error is not a lucky last change alone (fix round 4, C2)", () => {
  // S5 breaker follow-up: this sum is singular (the origin is interior, and
  // the mesh's own peak keeps growing as it refines), so it keeps SAFETY
  // (F1a keeps it only for bounded sums) — coarsened all the way to one
  // digit ("≈ 10"), but still honest: never 6.5448, the round-4 fragment.
  it('1/sqrt(x^2 + y^2) over an off-centre rectangle containing the origin: right digits, never 6.5448', () => {
    // Sigma over the four quadrant rectangles of A asinh(B/A) + B asinh(A/B).
    const c = (A: number, B: number) => A * Math.asinh(B / A) + B * Math.asinh(A / B)
    const exact = c(1.55, 1.15) + c(0.45, 1.15) + c(1.55, 0.85) + c(0.45, 0.85)
    const scene = sceneOf('volume: under 1/sqrt(x^2 + y^2) over x >= -0.45 and x <= 1.55 and y >= -0.85 and y <= 1.15')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - exact)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})

// S5 breaker follow-up, F2 pins P1-P6 (the breaker-fix brief's own table) and
// the two keep-passing cases (K1, |y - 0.6x| <= 0.05, is already pinned
// above): each prints the correct raw value honestly, or refuses — the raw
// value is never wrong (verified against the brief's own hand areas), and
// a refusal here is F1's SAFETY margin on the digit choice, not F2's
// thin-region gate (except P3 and P6, genuinely too thin even unfitted).
describe('F2 pins: the breaker-fix brief’s own table (breaker follow-up)', () => {
  it('P1: |x + 0.2y - 0.7| <= 0.05, |y| <= 1.5, res 32 (hand 0.3): an honest refusal, raw value exact', () => {
    expect(sceneOf('region: abs(x + 0.2*y - 0.7) <= 0.05 and abs(y) <= 1.5 res: 32').errors).toEqual([
      { line: 1, message: 'the integral could not be determined to one significant digit (≈ 0.3 ± 0.1375) — try tighter bounds or a finer res:' },
    ])
  })

  it('P2: |y - 0.2x| <= 0.05, |x| <= 2, res 32 (hand 0.4): an honest refusal, raw value exact', () => {
    expect(sceneOf('region: abs(y - 0.2*x) <= 0.05 and abs(x) <= 2 res: 32').errors).toEqual([
      { line: 1, message: 'the integral could not be determined to one significant digit (≈ 0.4 ± 0.1461) — try tighter bounds or a finer res:' },
    ])
  })

  it('P3: |y - 1.3x| <= 0.02, |x| <= 2, res 32 (hand 0.16): too thin to resolve at res 400', () => {
    expect(sceneOf('region: abs(y - 1.3*x) <= 0.02 and abs(x) <= 2 res: 32').errors).toEqual([
      { line: 1, message: 'the region is too thin to resolve at res 400 — raise res:, or write it as ranges' },
    ])
  })

  it('P4: |x + 0.3y - 0.7| <= 0.02, |y| <= 1.5, default res (hand 0.12): an honest refusal, raw value exact', () => {
    expect(sceneOf('region: abs(x + 0.3*y - 0.7) <= 0.02 and abs(y) <= 1.5').errors).toEqual([
      { line: 1, message: 'the integral could not be determined to one significant digit (≈ 0.12 ± 0.04748) — try tighter bounds or a finer res:' },
    ])
  })

  it('P5: |x + 0.2y - 0.7| <= 0.03, |y| <= 1.5, default res (hand 0.18): an honest refusal, raw value exact', () => {
    expect(sceneOf('region: abs(x + 0.2*y - 0.7) <= 0.03 and abs(y) <= 1.5').errors).toEqual([
      { line: 1, message: 'the integral could not be determined to one significant digit (≈ 0.18 ± 0.09238) — try tighter bounds or a finer res:' },
    ])
  })

  it('P6: |y - x^2| <= 0.01, |x| <= 1 (hand 0.04): too thin to resolve at res 400', () => {
    expect(sceneOf('region: abs(y - x^2) <= 0.01 and abs(x) <= 1').errors).toEqual([
      { line: 1, message: 'the region is too thin to resolve at res 400 — raise res:, or write it as ranges' },
    ])
  })

  // S5 breaker follow-up, F1a: as a bounded mesh sum it skips SAFETY, and
  // now values exactly (2 digits) — an improvement over the earlier,
  // documented "refuses under SAFETY" concern.
  it('K2: the tilted ellipse, semi-axes 1 and 0.02 (hand π·0.02 = 0.0628319): values honestly', () => {
    const scene = sceneOf('region: (x + y)^2/2 + (x - y)^2/(2*0.0004) <= 1')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') - Math.PI * 0.02)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })

  it('K3: |y - x^2| <= 0.05, |x| <= 1 (hand 0.2): an honest refusal, raw value close', () => {
    const scene = sceneOf('region: abs(y - x^2) <= 0.05 and abs(x) <= 1')
    expect(scene.errors).toEqual([
      { line: 1, message: 'the integral could not be determined to one significant digit (≈ 0.1952 ± 0.05254) — try tighter bounds or a finer res:' },
    ])
  })
})
