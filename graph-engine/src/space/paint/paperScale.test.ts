import { describe, expect, it } from 'vitest'
import { PAPER_MAX_SIZE, PAPER_MIN_SIZE, paperTileSize, resampleTile } from './paperScale'

const tile = (size: number, f: (x: number, y: number) => [number, number, number, number], h: (x: number, y: number) => number) => {
  const rgba = new Uint8ClampedArray(size * size * 4)
  const height = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      rgba.set(f(x, y), 4 * (y * size + x))
      height[y * size + x] = h(x, y)
    }
  }
  return { rgba, height }
}

describe('paperTileSize: two texels to the CSS px at any pixel ratio', () => {
  it('is 512 texels for each device px to the CSS px, as the mockup lays its 1024 tile at two to the CSS px', () => {
    expect(paperTileSize(1)).toBe(512)
    expect(paperTileSize(2)).toBe(1024)
    // a laptop at 125% or 150%: the tile follows, so a CSS px still holds two texels of weave (the first wiring gave 1.25 and 1.5
    // device px to the CSS px a whole 1024 tile or a half one, a weave a third too coarse)
    expect(paperTileSize(1.25)).toBe(640)
    expect(paperTileSize(1.5)).toBe(768)
    expect(paperTileSize(1.0004)).toBe(512)
  })

  it('stays within sane bounds and ignores a bad ratio', () => {
    expect(paperTileSize(0.1)).toBe(PAPER_MIN_SIZE)
    expect(paperTileSize(10)).toBe(PAPER_MAX_SIZE)
    expect(paperTileSize(Number.NaN)).toBe(512)
    expect(paperTileSize(-3)).toBe(512)
  })
})

describe('resampleTile', () => {
  it('hands the same arrays back when the size is already right', () => {
    const t = tile(4, () => [10, 20, 30, 255], () => 0.5)
    const out = resampleTile(t.rgba, t.height, 4, 4)
    expect(out.rgba).toBe(t.rgba)
    expect(out.height).toBe(t.height)
  })

  it('averages 2x2 texels when halving, colour and height (hand-computed)', () => {
    // 4x4 -> 2x2. The top-left block is (0, 100, 50, 150) in red: mean 75; heights (0, 1, 0.5, 0.5): mean 0.5
    const t = tile(
      4,
      (x, y) => [x < 2 && y < 2 ? [0, 100, 50, 150][y * 2 + x] : 200, 40, 40, 255],
      (x, y) => (x < 2 && y < 2 ? [0, 1, 0.5, 0.5][y * 2 + x] : 0.25),
    )
    const out = resampleTile(t.rgba, t.height, 4, 2)
    expect(out.size).toBe(2)
    expect(out.rgba[0]).toBe(75)
    expect(out.rgba[4]).toBe(200)
    expect(out.rgba[1]).toBe(40)
    expect(out.rgba[3]).toBe(255)
    expect(out.height[0]).toBeCloseTo(0.5, 6)
    expect(out.height[1]).toBeCloseTo(0.25, 6)
  })

  it('weighs the texels a fractional step covers by their overlap (3 -> 2: each output texel spans 1.5)', () => {
    // one row of 3 texels with heights 0, 3, 6: the first output is (0 x 1 + 3 x 0.5) / 1.5 = 1, the second (3 x 0.5 + 6 x 1) / 1.5 = 5
    const t = tile(3, () => [0, 0, 0, 255], (x) => 3 * x)
    const out = resampleTile(t.rgba, t.height, 3, 2)
    // (the columns carry the heights; the rows are all alike, so the vertical pass keeps them)
    expect(out.height[0]).toBeCloseTo(1, 6)
    expect(out.height[1]).toBeCloseTo(5, 6)
    expect(out.height[2]).toBeCloseTo(1, 6)
    expect(out.height[3]).toBeCloseTo(5, 6)
  })

  it('keeps the mean of the tile whatever the ratio, up or down', () => {
    const t = tile(8, (x, y) => [(37 * x + 11 * y) % 256, 90, 120, 255], (x, y) => Math.sin(x) + Math.cos(y))
    const mean = (a: ArrayLike<number>, step = 1, off = 0) => {
      let s = 0
      let n = 0
      for (let i = off; i < a.length; i += step) {
        s += a[i]
        n++
      }
      return s / n
    }
    for (const target of [4, 5, 8, 12, 16]) {
      const out = resampleTile(t.rgba, t.height, 8, target)
      expect(out.size).toBe(target)
      expect(out.rgba.length).toBe(target * target * 4)
      expect(mean(out.height)).toBeCloseTo(mean(t.height), 1)
      expect(Math.abs(mean(out.rgba, 4) - mean(t.rgba, 4))).toBeLessThan(1.5)
      expect(mean(out.rgba, 4, 3)).toBe(255)
    }
  })

  it('doubles by bilinear interpolation and wraps at the edge (a tile repeats)', () => {
    // 2 -> 4 along x with heights 0 and 8. An output texel's centre lies (x + 0.5) / 2 - 0.5 = -0.25, 0.25, 0.75, 1.25 texels
    // along the source: -0.25 is three quarters of the way from the wrapped last texel (8) to the first (0): 2; 0.25 is a
    // quarter of the way from 0 to 8: 2; 0.75: 6; and 1.25 is a quarter of the way from the last texel (8) to the first, wrapped (0): 6
    const t = tile(2, () => [0, 0, 0, 255], (x) => 8 * x)
    const out = resampleTile(t.rgba, t.height, 2, 4)
    expect(out.size).toBe(4)
    expect(Array.from(out.height.subarray(0, 4)).map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 2, 6, 6])
    // and down the rows the same way (the wrap at the bottom edge reads the top row)
    const tall = tile(2, () => [0, 0, 0, 255], (_x, y) => 8 * y)
    const up = resampleTile(tall.rgba, tall.height, 2, 4)
    expect([0, 4, 8, 12].map((i) => Math.round(up.height[i] * 1000) / 1000)).toEqual([2, 2, 6, 6])
  })
})
