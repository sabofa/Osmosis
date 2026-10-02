import { describe, expect, it } from 'vitest'
import { randomFor } from '../../random'
import { fbm, fbmN, mixFields, normStd, periodic1D, scaleCells, upsamplePeriodic } from './noise'
import { hashArray, seamRatio } from './testing'

describe('scaleCells', () => {
  it('keeps the feature count at 1024 and scales it with the tile', () => {
    expect(scaleCells(7, 1024)).toBe(7)
    expect(scaleCells(120, 256)).toBe(30) // 120 * 256 / 1024
    expect(scaleCells(3, 512)).toBe(2) // 1.5 rounds up
    expect(scaleCells(3, 64)).toBe(1) // 0.19 rounds to 0, but a lattice needs a cell
  })
})

describe('normStd', () => {
  it('gives zero mean and the asked standard deviation', () => {
    // mean 2.5, population sd sqrt(1.25) = 1.11803: (-1.5, -0.5, 0.5, 1.5) / 1.11803
    const a = normStd(new Float32Array([1, 2, 3, 4]))
    ;[-1.3416407, -0.4472136, 0.4472136, 1.3416407].forEach((v, i) => expect(a[i]).toBeCloseTo(v, 6))
    const b = normStd(new Float32Array([1, 2, 3, 4]), 0.15)
    expect(b[3]).toBeCloseTo(1.3416407 * 0.15, 6)
  })

  it('leaves a constant field at zero instead of dividing by nothing', () => {
    expect(Array.from(normStd(new Float32Array([5, 5, 5])))).toEqual([0, 0, 0])
  })
})

describe('upsamplePeriodic', () => {
  it('resamples with bilinear weights that wrap at the edge', () => {
    // 2x2 [0 4; 8 12] to 4x4: each output texel centre sits 1/4 of a sample from
    // its nearest source sample, so the weights are 3/4 and 1/4, and the first and
    // last texels blend across the wrap.
    const up = upsamplePeriodic(new Float32Array([0, 4, 8, 12]), 2, 2, 4, 4)
    expect(Array.from(up)).toEqual([3, 3, 5, 5, 3, 3, 5, 5, 7, 7, 9, 9, 7, 7, 9, 9])
  })
})

describe('periodic1D', () => {
  it('runs the last sample into the first', () => {
    const f = periodic1D(randomFor('t/periodic1d'), 8, 512)
    let inner = 0
    for (let i = 1; i < f.length; i++) inner += Math.abs(f[i] - f[i - 1])
    inner /= f.length - 1
    // A smooth noise changes by about `inner` per sample everywhere, wrap included.
    expect(Math.abs(f[0] - f[f.length - 1])).toBeLessThan(inner * 1.5)
  })

  it('is deterministic in its random source', () => {
    expect(hashArray(periodic1D(randomFor('t/p1d'), 6, 64))).toBe(hashArray(periodic1D(randomFor('t/p1d'), 6, 64)))
    expect(hashArray(periodic1D(randomFor('t/p1d'), 6, 64))).not.toBe(hashArray(periodic1D(randomFor('t/other'), 6, 64)))
  })
})

describe('fbm', () => {
  const size = 128
  const specs = {
    plain: { cx: 3, octaves: 3 },
    anisotropic: { cx: 2, cy: 24, octaves: 2 },
    warped: { cx: 3, octaves: 3, warp: { amp: 12, cx: 3 } },
    coarse: { cx: 3, octaves: 3, warp: { amp: 12, cx: 3 }, grid: 32 },
    streaks: { cx: 2, cy: 24, octaves: 2, warp: { amp: 6, cx: 2 }, grid: [16, 128] as [number, number] },
  }

  for (const [name, spec] of Object.entries(specs)) {
    it(`tiles seamlessly in both axes (${name})`, () => {
      const f = fbm(randomFor(`t/fbm/${name}`), size, spec)
      expect(Number.isFinite(f[0]) && f.every(Number.isFinite)).toBe(true)
      // The wrap seam is a neighbour like any other. A smooth field's seam varies a
      // little with the draw (the difference is nearly constant along each stretch),
      // so the bound is loose; two unrelated edges would give ten times the interior.
      expect(seamRatio(f, size, 'x')).toBeLessThan(3)
      expect(seamRatio(f, size, 'y')).toBeLessThan(3)
    })
  }

  it('is a pure function of its random source and spec', () => {
    const a = fbm(randomFor('t/fbm/same'), 64, specs.warped)
    expect(hashArray(fbm(randomFor('t/fbm/same'), 64, specs.warped))).toBe(hashArray(a))
    expect(hashArray(fbm(randomFor('t/fbm/different'), 64, specs.warped))).not.toBe(hashArray(a))
  })

  it('has unit variance after fbmN, whatever the grid', () => {
    for (const spec of [specs.plain, specs.coarse, specs.streaks]) {
      const f = fbmN(randomFor('t/fbm/unit'), size, spec)
      let s = 0
      let q = 0
      for (const v of f) {
        s += v
        q += v * v
      }
      expect(s / f.length).toBeCloseTo(0, 5)
      expect(Math.sqrt(q / f.length)).toBeCloseTo(1, 5)
    }
  })

  it('a domain warp moves the field without changing its character', () => {
    // Same lattice seed with and without the warp: different fields, similar spread.
    const flat = fbmN(randomFor('t/fbm/warp'), size, { cx: 3, octaves: 3 })
    const warped = fbmN(randomFor('t/fbm/warp'), size, { cx: 3, octaves: 3, warp: { amp: 20, cx: 3 } })
    expect(hashArray(flat)).not.toBe(hashArray(warped))
    let diff = 0
    for (let i = 0; i < flat.length; i++) diff += Math.abs(flat[i] - warped[i])
    expect(diff / flat.length).toBeGreaterThan(0.05)
  })
})

describe('mixFields', () => {
  it('sums fields of different grids on the finest, by amount', () => {
    const coarse = { data: new Float32Array([1, 1, 1, 1]), w: 2, h: 2 }
    const fine = { data: new Float32Array(16).fill(2), w: 4, h: 4 }
    const mix = mixFields([
      { field: coarse, amount: 3 },
      { field: fine, amount: 0.5 },
    ])
    expect([mix.w, mix.h]).toEqual([4, 4])
    expect(Array.from(mix.data)).toEqual(new Array(16).fill(4)) // 3 * 1 + 0.5 * 2
  })
})
