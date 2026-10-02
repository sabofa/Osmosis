import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPaperCache, generatePaper } from './index'
import { buildLinen } from './linen'
import { hashArray, seamRatio } from './testing'
import type { GeneratedPaperType, PaperTile } from './types'

// Counts how often the linen weave is actually built.
vi.mock('./linen', async (importOriginal) => {
  const real = await importOriginal<typeof import('./linen')>()
  return { ...real, buildLinen: vi.fn(real.buildLinen) }
})

const TYPES: GeneratedPaperType[] = ['canvas', 'linen']
const SIZE = 256

const hashTile = (t: PaperTile) => `${hashArray(t.offsets)}/${hashArray(t.height)}`

beforeEach(() => {
  clearPaperCache()
  vi.mocked(buildLinen).mockClear()
})

describe('generatePaper', () => {
  for (const type of TYPES) {
    describe(type, () => {
      it('gives the same tile for the same settings, regenerated from nothing', () => {
        const first = hashTile(generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE }))
        clearPaperCache() // not the cache: a fresh build must reproduce it
        expect(hashTile(generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE }))).toBe(first)
      })

      it('gives a different tile for a different seed', () => {
        const a = generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE })
        const b = generatePaper(type, { texture: 1, seed: 'osmosis-2', size: SIZE })
        expect(hashArray(b.height)).not.toBe(hashArray(a.height))
        expect(hashArray(b.offsets)).not.toBe(hashArray(a.offsets))
      })

      it('tiles seamlessly: the wrap seam is no rougher than the interior', () => {
        const t = generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE })
        expect(t.height.every(Number.isFinite) && t.offsets.every(Number.isFinite)).toBe(true)
        // Height: the mean absolute difference between the last and first column (and row)
        // is within 1.3x of the interior neighbour-to-neighbour mean.
        expect(seamRatio(t.height, SIZE, 'x')).toBeLessThan(1.3)
        expect(seamRatio(t.height, SIZE, 'y')).toBeLessThan(1.3)
        // The same holds for the lightness offsets, which carry the mottle and the threads' colour.
        expect(seamRatio(t.offsets, SIZE, 'x', 3, 0)).toBeLessThan(1.3)
        expect(seamRatio(t.offsets, SIZE, 'y', 3, 0)).toBeLessThan(1.3)
      })

      it('is structure around zero: offsets are small and centred, height is 0..1 around 0.5', () => {
        const t = generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE })
        let meanL = 0
        let sdL = 0
        let maxAB = 0
        const n = SIZE * SIZE
        for (let i = 0; i < n; i++) meanL += t.offsets[i * 3] / n
        for (let i = 0; i < n; i++) {
          sdL += (t.offsets[i * 3] - meanL) ** 2 / n
          maxAB = Math.max(maxAB, Math.abs(t.offsets[i * 3 + 1]), Math.abs(t.offsets[i * 3 + 2]))
        }
        expect(Math.abs(meanL)).toBeLessThan(0.02)
        expect(Math.sqrt(sdL)).toBeGreaterThan(0.01) // there is a weave in the colour ...
        expect(Math.sqrt(sdL)).toBeLessThan(0.06) // ... but it is a tone, not a pattern
        expect(maxAB).toBeLessThan(0.05)
        let meanH = 0
        let lowest = Infinity
        let highest = -Infinity
        for (let i = 0; i < n; i++) {
          meanH += t.height[i] / n
          lowest = Math.min(lowest, t.height[i])
          highest = Math.max(highest, t.height[i])
        }
        expect(lowest).toBeGreaterThanOrEqual(0)
        expect(highest).toBeLessThanOrEqual(1)
        expect(meanH).toBeCloseTo(0.5, 1)
      })

      it('is primed: gesso fills the valleys between the threads, so the height has a short low tail', () => {
        // A bare weave has deep gaps between threads and flat crowns: strongly skewed to the low side
        // (about -0.9 for this linen, -0.78 for this canvas). The priming fills the valleys, so the skew is
        // about -0.5 for either.
        const limit = type === 'linen' ? -0.7 : -0.65
        for (const seed of ['a', 'b', 'c']) {
          const h = generatePaper(type, { texture: 1, seed, size: SIZE }).height
          const n = h.length
          let mean = 0
          for (const v of h) mean += v / n
          let variance = 0
          for (const v of h) variance += (v - mean) ** 2 / n
          let skew = 0
          for (const v of h) skew += ((v - mean) / Math.sqrt(variance)) ** 3 / n
          expect(skew).toBeGreaterThan(limit)
          expect(skew).toBeLessThan(-0.2) // the crowns are still flat-topped: it is a weave, not noise
        }
      })

      it('shows the threads in the colour as well as the relief: crowns are lighter than valleys', () => {
        // The lightness offsets carry the thread brightness, so they rise with the height (a correlation of
        // about 0.11 to 0.18); the mottle and the fibres are independent of it, which is why it is not higher.
        for (const seed of ['a', 'b', 'c']) {
          const t = generatePaper(type, { texture: 1, seed, size: SIZE })
          const n = t.height.length
          let meanH = 0
          let meanL = 0
          for (let i = 0; i < n; i++) {
            meanH += t.height[i] / n
            meanL += t.offsets[i * 3] / n
          }
          let hl = 0
          let hh = 0
          let ll = 0
          for (let i = 0; i < n; i++) {
            const dh = t.height[i] - meanH
            const dl = t.offsets[i * 3] - meanL
            hl += dh * dl
            hh += dh * dh
            ll += dl * dl
          }
          expect(hl / Math.sqrt(hh * ll)).toBeGreaterThan(0.06)
        }
      })

      it('is flat at texture 0: all-zero offsets and a constant height', () => {
        const t = generatePaper(type, { texture: 0, seed: 'osmosis', size: SIZE })
        expect(t.offsets.every((v) => v === 0)).toBe(true)
        expect(new Set(t.height).size).toBe(1)
        expect(t.height[0]).toBe(0.5)
      })

      it('scales offsets and height deviation linearly with texture', () => {
        const one = generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE })
        const half = generatePaper(type, { texture: 0.5, seed: 'osmosis', size: SIZE })
        const two = generatePaper(type, { texture: 2, seed: 'osmosis', size: SIZE })
        let offsetError = 0
        for (let i = 0; i < one.offsets.length; i++) {
          offsetError = Math.max(offsetError, Math.abs(half.offsets[i] - one.offsets[i] * 0.5), Math.abs(two.offsets[i] - one.offsets[i] * 2))
        }
        expect(offsetError).toBeLessThan(1e-7)
        // Height deviates from 0.5 in proportion, wherever the soft limit (which starts at a deviation of 0.35)
        // is not in play: a deviation of 0.17 at texture 1 is still under it at texture 2.
        let heightError = 0
        let compared = 0
        for (let i = 0; i < one.height.length; i++) {
          const d = one.height[i] - 0.5
          if (Math.abs(d) > 0.17) continue
          heightError = Math.max(heightError, Math.abs(half.height[i] - 0.5 - d * 0.5), Math.abs(two.height[i] - 0.5 - d * 2))
          compared++
        }
        expect(compared).toBeGreaterThan(one.height.length * 0.5)
        expect(heightError).toBeLessThan(1e-6)
      })

      it('keeps the height inside 0..1 at every texture without flattening the extremes', () => {
        // Canvas at texture 1 has 1.4% of its texels past a deviation of 0.5, and any paper at texture 2 far more.
        // A hard clamp would pile them up at exactly 0 and 1 and leave flat floors; the soft limit keeps them
        // apart, and in the same order.
        for (const texture of [1, 2]) {
          const t = generatePaper(type, { texture, seed: 'osmosis', size: SIZE })
          let pinned = 0
          let outside = 0
          for (const v of t.height) {
            if (v < 0 || v > 1) outside++
            if (v === 0 || v === 1) pinned++
          }
          expect(outside).toBe(0)
          expect(pinned).toBeLessThan(t.height.length * 0.0005)
        }
        const one = generatePaper(type, { texture: 1, seed: 'osmosis', size: SIZE }).height
        const two = generatePaper(type, { texture: 2, seed: 'osmosis', size: SIZE }).height
        const order = Array.from(one.keys()).sort((a, b) => one[a] - one[b])
        let inversions = 0
        for (let k = 1; k < order.length; k++) {
          // Texels that are equal at texture 1 may differ at 2 (they are the same float32 of different deviations).
          if (one[order[k]] > one[order[k - 1]] && two[order[k]] < two[order[k - 1]]) inversions++
        }
        expect(inversions).toBe(0)
      })
    })
  }

  it('makes linen and canvas different papers', () => {
    const linen = generatePaper('linen', { texture: 1, seed: 'osmosis', size: SIZE })
    const canvas = generatePaper('canvas', { texture: 1, seed: 'osmosis', size: SIZE })
    expect(hashArray(linen.height)).not.toBe(hashArray(canvas.height))
    // Cotton duck is the coarser weave with the stronger relief.
    const sd = (h: Float32Array) => Math.sqrt(h.reduce((s, v) => s + (v - 0.5) ** 2, 0) / h.length)
    expect(sd(canvas.height)).toBeGreaterThan(sd(linen.height))
  })

  describe('the cache', () => {
    it('returns the same tile for the same (type, texture, seed, size)', () => {
      const a = generatePaper('linen', { texture: 1, seed: 'cached', size: 64 })
      expect(generatePaper('linen', { texture: 1, seed: 'cached', size: 64 })).toBe(a)
      expect(generatePaper('linen', { texture: 1, seed: 'cached', size: 64 })).toBe(a)
    })

    it('keys on every part of the identity', () => {
      const base = generatePaper('linen', { texture: 1, seed: 'k', size: 64 })
      expect(generatePaper('canvas', { texture: 1, seed: 'k', size: 64 })).not.toBe(base)
      expect(generatePaper('linen', { texture: 0.5, seed: 'k', size: 64 })).not.toBe(base)
      expect(generatePaper('linen', { texture: 1, seed: 'k2', size: 64 })).not.toBe(base)
      expect(generatePaper('linen', { texture: 1, seed: 'k', size: 32 })).not.toBe(base)
    })

    it('is bounded: an old tile is rebuilt, equal, once newer ones push it out', () => {
      const first = generatePaper('linen', { texture: 1, seed: 'oldest', size: 32 })
      const hash = hashTile(first)
      for (let i = 0; i < 6; i++) generatePaper('linen', { texture: 1, seed: `newer-${i}`, size: 32 })
      const again = generatePaper('linen', { texture: 1, seed: 'oldest', size: 32 })
      expect(again).not.toBe(first)
      expect(hashTile(again)).toBe(hash)
    })

    it('shares the structure between textures: a texture change does not rebuild the weave', () => {
      generatePaper('linen', { texture: 1, seed: 'shared', size: 64 })
      for (const texture of [0, 0.25, 0.5, 1.5, 2]) generatePaper('linen', { texture, seed: 'shared', size: 64 })
      expect(buildLinen).toHaveBeenCalledTimes(1)
      generatePaper('linen', { texture: 1, seed: 'another', size: 64 })
      expect(buildLinen).toHaveBeenCalledTimes(2)
    })
  })

  describe('settings', () => {
    it('defaults to 1024 texels', () => {
      const t = generatePaper('canvas', { texture: 1, seed: 'default-size' })
      expect(t.size).toBe(1024)
      expect(t.offsets.length).toBe(3 * 1024 * 1024)
      expect(t.height.length).toBe(1024 * 1024)
    })

    it('keeps texture to the 0..2 range', () => {
      const two = generatePaper('linen', { texture: 2, seed: 'clamp', size: 64 })
      expect(generatePaper('linen', { texture: 5, seed: 'clamp', size: 64 })).toBe(two)
      const zero = generatePaper('linen', { texture: 0, seed: 'clamp', size: 64 })
      expect(generatePaper('linen', { texture: -1, seed: 'clamp', size: 64 })).toBe(zero)
    })

    it('refuses a size that is not a whole number of texels in range', () => {
      expect(() => generatePaper('linen', { texture: 1, seed: 's', size: 100.5 })).toThrow(RangeError)
      expect(() => generatePaper('linen', { texture: 1, seed: 's', size: 8 })).toThrow(RangeError)
      expect(() => generatePaper('linen', { texture: 1, seed: 's', size: 8192 })).toThrow(RangeError)
    })

    it('refuses a type it does not make', () => {
      for (const type of ['vellum', 'toString', 'constructor']) {
        expect(() => generatePaper(type as GeneratedPaperType, { texture: 1, seed: 's', size: 64 })).toThrow(RangeError)
      }
    })
  })

  describe('timing', () => {
    it('makes a 1024^2 tile of either type well inside a generous guard', () => {
      for (const type of TYPES) {
        const t0 = performance.now()
        generatePaper(type, { texture: 1, seed: 'timing' })
        // The design target is 400 ms in node; the guard is 5 s so a slow CI box does not flake.
        expect(performance.now() - t0).toBeLessThan(5000)
      }
    })
  })
})
