import { describe, expect, it } from 'vitest'
import { colourisePaper } from './colourise'
import { clearPaperCache, generatePaper } from './index'
import { oklabToSrgb8, srgb8ToOklab } from './oklab'
import { hashArray } from './testing'
import type { GeneratedPaperType, PaperTile } from './types'

// A tile of `size` x `size` texels with a constant offset and the given height.
function tile(type: GeneratedPaperType, size: number, offset: [number, number, number], height: (x: number, y: number) => number): PaperTile {
  const offsets = new Float32Array(3 * size * size)
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      offsets.set(offset, i * 3)
      h[i] = height(x, y)
    }
  }
  return { type, size, offsets, height: h }
}
const flat = (type: GeneratedPaperType, size: number, offset: [number, number, number] = [0, 0, 0]) => tile(type, size, offset, () => 0.5)
const pixel = (rgba: Uint8ClampedArray, size: number, x: number, y: number) => Array.from(rgba.slice((y * size + x) * 4, (y * size + x) * 4 + 4))

describe('oklab helpers', () => {
  it('know white, black and a mid grey', () => {
    expect(srgb8ToOklab(255, 255, 255)[0]).toBeCloseTo(1, 4)
    expect(srgb8ToOklab(0, 0, 0)[0]).toBeCloseTo(0, 6)
    // sRGB 128 is linear 0.2159, whose cube root is the grey's lightness 0.5999.
    expect(srgb8ToOklab(128, 128, 128)[0]).toBeCloseTo(0.5999, 3)
    expect(srgb8ToOklab(128, 128, 128)[1]).toBeCloseTo(0, 4)
  })

  it('round-trip', () => {
    for (const rgb of [[226, 217, 197], [200, 60, 40], [10, 120, 230]]) {
      const [L, a, b] = srgb8ToOklab(rgb[0], rgb[1], rgb[2])
      oklabToSrgb8(L, a, b).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 3))
    }
  })
})

describe('colourisePaper', () => {
  it('is the base tone where the tile is flat and has no offsets', () => {
    // OKLab L 0.6 (a = b = 0) is sRGB 128.04 on every channel; L 1 is white; L 0 is black.
    // Texture 0 is no relief and no dither, so the value is exact ...
    const grey = colourisePaper(flat('linen', 4), [0.6, 0, 0], 0)
    for (let i = 0; i < 16; i++) expect(pixel(grey, 4, i % 4, Math.floor(i / 4))).toEqual([128, 128, 128, 255])
    expect(pixel(colourisePaper(flat('linen', 4), [1, 0, 0], 0), 4, 1, 1)).toEqual([255, 255, 255, 255])
    expect(pixel(colourisePaper(flat('linen', 4), [0, 0, 0], 0), 4, 1, 1)).toEqual([0, 0, 0, 255])
    // ... and at texture 1 the dither moves a texel by at most one level.
    const dithered = colourisePaper(flat('linen', 8), [0.6, 0, 0], 1)
    for (let i = 0; i < 64; i++) expect(Math.abs(pixel(dithered, 8, i % 8, Math.floor(i / 8))[0] - 128)).toBeLessThanOrEqual(1)
  })

  it('adds the tile\'s OKLab offsets to the base, in all three channels', () => {
    // base L 0.5 + dL 0.1 is L 0.6 again: 128.
    expect(pixel(colourisePaper(flat('linen', 4, [0.1, 0, 0]), [0.5, 0, 0], 1), 4, 2, 2)).toEqual([128, 128, 128, 255])
    // L 0.6 with a +0.05 is a redder pink: hand-computed through the OKLab matrices and the sRGB curve,
    // l = 0.2381, m = 0.2104, s = 0.2112 -> linear (0.3237, 0.1748, 0.2117) -> sRGB (154.1, 116.1, 126.9).
    const a = pixel(colourisePaper(flat('linen', 4, [0, 0.05, 0]), [0.6, 0, 0], 1), 4, 0, 0)
    expect(a.slice(0, 3)).toEqual([154, 116, 127])
    // L 0.6 with b +0.05 is yellower: sRGB (139.8, 127.3, 93.9).
    const b = pixel(colourisePaper(flat('linen', 4, [0, 0, 0.05]), [0.6, 0, 0], 1), 4, 0, 0)
    expect(b.slice(0, 3)).toEqual([140, 127, 94])
    // And the same offset on a base that already has a: they add, they do not replace.
    const both = pixel(colourisePaper(flat('linen', 4, [0, 0.03, 0]), [0.6, 0.02, 0], 1), 4, 0, 0)
    expect(both.slice(0, 3)).toEqual(a.slice(0, 3))
  })

  it('lights the relief from the upper left: a slope rising to the right is brighter', () => {
    // Height rises 0.05 per texel along x, centred on 0.5 at x = 3, so the occlusion term is 1 there.
    // linen gain 0.30; light (cos 135 cos 23, -, sin 23) = (-0.6509, ., 0.3907):
    // f = 1 - 0.30 * 0.05 * (-0.6509) / 0.3907 = 1.02499, and 128.04 * f = 131.2.
    const up = colourisePaper(tile('linen', 8, [0, 0, 0], (x) => 0.5 + 0.05 * (x - 3)), [0.6, 0, 0], 1)
    for (const c of pixel(up, 8, 3, 4).slice(0, 3)) expect(Math.abs(c - 131.2)).toBeLessThan(1.5) // dither is at most 0.9
    // The same ramp falling to the right faces away from the light: f = 0.97501, 124.8.
    const down = colourisePaper(tile('linen', 8, [0, 0, 0], (x) => 0.5 - 0.05 * (x - 3)), [0.6, 0, 0], 1)
    for (const c of pixel(down, 8, 3, 4).slice(0, 3)) expect(Math.abs(c - 124.8)).toBeLessThan(1.5)
    // A ramp down the page (texel rows run down) is lit from the top: rising to the bottom is brighter.
    const rows = colourisePaper(tile('linen', 8, [0, 0, 0], (_x, y) => 0.5 + 0.05 * (y - 3)), [0.6, 0, 0], 1)
    for (const c of pixel(rows, 8, 4, 3).slice(0, 3)) expect(Math.abs(c - 131.2)).toBeLessThan(1.5)
  })

  it('takes the slope across the edge of the tile from the other side, as the tile repeats', () => {
    // The ramp 0.35 .. 0.7 runs round the 8 texels. At x = 0 the neighbours are x = 7 (0.7) and x = 1 (0.4), so
    // hx = (0.4 - 0.7) / 2 = -0.15, and the occlusion term is 1 - 0.03 * (0.5 - 0.35) = 0.9955:
    // f = (1 - 0.30 * -0.15 * -0.6509 / 0.3907) * 0.9955 = 0.925 * 0.9955 = 0.9208, 128.04 * f = 117.9.
    // At x = 7 the neighbours are x = 6 (0.65) and x = 0 (0.35): hx = -0.15 again, with occlusion
    // 1 - 0.03 * (0.5 - 0.7) = 1.006: f = 0.925 * 1.006 = 0.9306, 119.2.
    const ramp = colourisePaper(tile('linen', 8, [0, 0, 0], (x) => 0.35 + 0.05 * x), [0.6, 0, 0], 1)
    expect(Math.abs(pixel(ramp, 8, 0, 4)[0] - 117.9)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(pixel(ramp, 8, 7, 4)[0] - 119.2)).toBeLessThanOrEqual(1.5)
    // The same down the page: the first row looks at the last, and the last at the first.
    const rows = colourisePaper(tile('linen', 8, [0, 0, 0], (_x, y) => 0.35 + 0.05 * y), [0.6, 0, 0], 1)
    expect(Math.abs(pixel(rows, 8, 3, 0)[0] - 117.9)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(pixel(rows, 8, 3, 7)[0] - 119.2)).toBeLessThanOrEqual(1.5)
  })

  it('darkens low spots and lightens high ones a little, in proportion to how far from the mean height', () => {
    // Canvas occlusion 0.10: a flat tile at height 0.7 is 1 - 0.10 * (0.5 - 0.7) = 1.02 of the tone, and at 0.3 it is
    // 0.98. Flat means no slope, so this is the occlusion alone: 128.04 * 1.02 = 130.6 and 128.04 * 0.98 = 125.5.
    const mean = (h: number, texture: number) => {
      const out = colourisePaper(tile('canvas', 8, [0, 0, 0], () => h), [0.6, 0, 0], texture)
      let s = 0
      for (let i = 0; i < 64; i++) s += out[i * 4]
      return s / 64
    }
    expect(mean(0.7, 1)).toBeCloseTo(130.6, 0)
    expect(mean(0.3, 1)).toBeCloseTo(125.5, 0)
    expect(mean(0.7, 0)).toBe(128) // and it goes with the texture
  })

  it('lights harder with `texture` and not at all at 0', () => {
    const ramp = tile('linen', 8, [0, 0, 0], (x) => 0.5 + 0.05 * (x - 3))
    // texture 2: f = 1 + 2 * 0.0249875 = 1.04998, 128.04 * f = 134.4.
    for (const c of pixel(colourisePaper(ramp, [0.6, 0, 0], 2), 8, 3, 4).slice(0, 3)) expect(Math.abs(c - 134.4)).toBeLessThan(1.5)
    // texture 0: no relief and no dither, so the sloped tile is exactly flat grey.
    const none = colourisePaper(ramp, [0.6, 0, 0], 0)
    for (let i = 0; i < 64; i++) expect(pixel(none, 8, i % 8, Math.floor(i / 8))).toEqual([128, 128, 128, 255])
  })

  it('lights each paper at its own strength', () => {
    // A sawtooth ramp (0.05 per texel, 0.5 at x % 8 === 4) lit at x % 8 === 4, where the occlusion term is 1:
    // linen gain 0.30 gives f = 1.02499 and 131.24; canvas gain 0.32 gives f = 1.02665 and 131.45. The dither
    // is at most 0.9 per texel, but it averages out over 64 x 8 texels.
    const meanAtCrest = (type: GeneratedPaperType) => {
      const out = colourisePaper(tile(type, 64, [0, 0, 0], (x) => 0.5 + 0.05 * ((x % 8) - 4)), [0.6, 0, 0], 1)
      let s = 0
      let n = 0
      for (let y = 0; y < 64; y++) {
        for (let x = 4; x < 64; x += 8) {
          s += out[(y * 64 + x) * 4]
          n++
        }
      }
      return s / n
    }
    expect(meanAtCrest('linen')).toBeCloseTo(131.24, 0)
    expect(meanAtCrest('canvas')).toBeCloseTo(131.45, 0)
    expect(meanAtCrest('canvas') - meanAtCrest('linen')).toBeGreaterThan(0.1)
    expect(meanAtCrest('canvas') - meanAtCrest('linen')).toBeLessThan(0.35)
  })

  it('gives the same luminance pattern on two different bases, shifted by the base difference', () => {
    clearPaperCache()
    const paper = generatePaper('linen', { texture: 1, seed: 'two-bases', size: 128 })
    const dark: [number, number, number] = [0.7, 0, 0.02]
    const light: [number, number, number] = [0.85, 0, 0.02]
    const lightnessOf = (rgba: Uint8ClampedArray) => {
      const out = new Float64Array(rgba.length / 4)
      for (let i = 0; i < out.length; i++) out[i] = srgb8ToOklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])[0]
      return out
    }
    const a = lightnessOf(colourisePaper(paper, dark, 1))
    const b = lightnessOf(colourisePaper(paper, light, 1))
    const mean = (v: Float64Array) => v.reduce((s, x) => s + x, 0) / v.length
    // The whole tile moves up by the base difference ...
    expect(mean(b) - mean(a)).toBeCloseTo(0.15, 2)
    // ... and every texel with it, give or take the multiplicative relief, which scales with brightness.
    let worst = 0
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(b[i] - a[i] - 0.15))
    expect(worst).toBeLessThan(0.03)
    // The pattern itself (the deviation from each mean) is the same: correlation near 1.
    const ma = mean(a)
    const mb = mean(b)
    let ab = 0
    let aa = 0
    let bb = 0
    for (let i = 0; i < a.length; i++) {
      ab += (a[i] - ma) * (b[i] - mb)
      aa += (a[i] - ma) ** 2
      bb += (b[i] - mb) ** 2
    }
    expect(ab / Math.sqrt(aa * bb)).toBeGreaterThan(0.98)
  })

  it('is deterministic, and its dither is a pure function of the tile', () => {
    const paper = generatePaper('canvas', { texture: 1, seed: 'dither', size: 64 })
    const a = colourisePaper(paper, [0.9, 0.004, 0.022], 1)
    expect(hashArray(colourisePaper(paper, [0.9, 0.004, 0.022], 1))).toBe(hashArray(a))
    expect(hashArray(colourisePaper(paper, [0.9, 0.004, 0.03], 1))).not.toBe(hashArray(a))
  })

  it('returns opaque RGBA8 with one texel per tile texel', () => {
    const out = colourisePaper(generatePaper('linen', { texture: 1, seed: 'rgba', size: 32 }), [0.93, 0.004, 0.022], 1)
    expect(out).toBeInstanceOf(Uint8ClampedArray)
    expect(out.length).toBe(32 * 32 * 4)
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255)
  })

  it('refuses a tile whose arrays do not match its size', () => {
    const bad: PaperTile = { type: 'linen', size: 8, offsets: new Float32Array(10), height: new Float32Array(64) }
    expect(() => colourisePaper(bad, [0.9, 0, 0], 1)).toThrow(RangeError)
  })
})
