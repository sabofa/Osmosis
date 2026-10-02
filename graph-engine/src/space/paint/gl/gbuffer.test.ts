import { describe, expect, it } from 'vitest'
import {
  decodeFloatGBuffer,
  decodeRgba8GBuffer,
  decodeRgba8Texel,
  depthRangeFor,
  emptyGBuffer,
  encodeFloatTexel,
  encodeRgba8Texel,
  gbufferMatrix,
  gbufferSize,
  GBUFFER_SCALE,
  isPerspective,
  octDecode,
  octEncode,
  RGBA8_BYTES_PER_TEXEL,
} from './gbuffer'
import type { PaintView } from '../types'

const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

// Apply a column-major 4x4 to (x, y, z, 1) and divide by w.
function ndc(m: Float32Array, p: [number, number, number]): [number, number, number] {
  const out = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  return [out[0] / out[3], out[1] / out[3], out[2] / out[3]]
}

describe('G-buffer size and the grid matrix', () => {
  it('is half the CSS size, rounded up: 800 x 600 -> 400 x 300 and 801 x 601 -> 401 x 301', () => {
    expect(GBUFFER_SCALE).toBe(2)
    expect(gbufferSize(800, 600)).toEqual({ width: 400, height: 300 })
    expect(gbufferSize(801, 601)).toEqual({ width: 401, height: 301 })
  })

  it('maps the view corners onto the grid with row 0 at the top: css (0, 0) -> ndc (-1, -1), css (800, 600) -> (1, 1)', () => {
    const m = gbufferMatrix(IDENTITY, [0, 0, 0], 800, 600, 400, 300)
    // Identity viewProj: clip = world, so (-1, 1) is the top left of the view.
    const close = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6))
    close(ndc(m, [-1, 1, 0]), [-1, -1, 0])
    close(ndc(m, [1, -1, 0]), [1, 1, 0])
    close(ndc(m, [0, 0, 0]), [0, 0, 0])
  })

  it('does not stretch an odd width: css x = 801 lands at pixel 400.5 of 401', () => {
    const m = gbufferMatrix(IDENTITY, [0, 0, 0], 801, 601, 401, 301)
    const x = ndc(m, [1, 0, 0])[0]
    expect(x).toBeCloseTo(2 * (801 / 802) - 1, 6)
    expect(((x + 1) / 2) * 401).toBeCloseTo(400.5, 4)
  })

  it('folds the origin in: a position relative to origin (2, 0, 0) is moved by it', () => {
    const m = gbufferMatrix(IDENTITY, [2, 0, 0], 800, 600, 400, 300)
    expect(ndc(m, [0, 0, 0])[0]).toBeCloseTo(2, 6)
  })

  it('keeps depth and w from the view-projection (only x and y are remapped)', () => {
    const persp = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.02, -1, 0, 0, -2.02, 0])
    const m = gbufferMatrix(persp, [0, 0, 0], 800, 600, 400, 300)
    for (const i of [2, 6, 10, 14, 3, 7, 11, 15]) expect(m[i]).toBeCloseTo(persp[i], 6)
  })

  it('tells a perspective projection (a z term in the last row) from an orthographic one', () => {
    expect(isPerspective(IDENTITY)).toBe(false)
    expect(isPerspective(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.02, -1, 0, 0, -2.02, 0]))).toBe(true)
  })

  it('packs the rgba8 depth range around the scene sphere along the view direction', () => {
    const view = { eye: [0, -10, 0], viewDir: [0, 1, 0] } as PaintView
    expect(depthRangeFor(view, [0, 0, 0], 2)).toEqual([8, 12])
  })
})

describe('the octahedral normal', () => {
  it('maps the axes to hand values: +z -> (0, 0), +x -> (1, 0), -z -> (1, 1)', () => {
    expect(octEncode([0, 0, 1])).toEqual([0, 0])
    expect(octEncode([1, 0, 0])).toEqual([1, 0])
    expect(octEncode([0, 0, -1])).toEqual([1, 1])
  })

  it('round-trips unit vectors on both hemispheres to 1e-6', () => {
    const vs: [number, number, number][] = [
      [0.6, 0, 0.8],
      [-0.48, 0.64, -0.6],
      [0.267261, -0.534522, 0.801784],
      [0, -1, 0],
      [-0.57735, -0.57735, -0.57735],
    ]
    for (const v of vs) {
      const l = Math.hypot(...v)
      const n: [number, number, number] = [v[0] / l, v[1] / l, v[2] / l]
      const [x, y] = octEncode(n)
      const d = octDecode(x, y)
      expect(Math.hypot(d[0] - n[0], d[1] - n[1], d[2] - n[2])).toBeLessThan(1e-6)
    }
  })
})

describe('the float layout readback', () => {
  // A known 2 x 2 G-buffer, rows top first:
  //   (0,0) sphere mark 3, normal +z, depth 12.5, u 0.5, lit
  //   (1,0) empty
  //   (0,1) mark 0, normal +x, depth 4, u 1, in shadow
  //   (1,1) mark 7, normal -y, depth 9.25, u 0, lit
  const texels = [
    encodeFloatTexel({ normal: [0, 0, 1], depth: 12.5, value: 0.5, shadow: false, mark: 3 }),
    [0, 0, 1e30, 0],
    encodeFloatTexel({ normal: [1, 0, 0], depth: 4, value: 1, shadow: true, mark: 0 }),
    encodeFloatTexel({ normal: [0, -1, 0], depth: 9.25, value: 0, shadow: false, mark: 7 }),
  ]
  const raw = Float32Array.from(texels.flat())

  it('packs hand values: mark 3, lit, u 0.5 is ((3 + 1) * 2 + 0) * 1024 + 512 = 8704', () => {
    expect(texels[0][3]).toBe(8704)
    // mark 0, shadow, u 1: ((0 + 1) * 2 + 1) * 1024 + 1023 = 4095
    expect(texels[2][3]).toBe(4095)
  })

  it('decodes into the contract arrays, empty pixels at depth +Infinity, value -1, mark -1', () => {
    const g = decodeFloatGBuffer(raw, 2, 2)
    expect([g.width, g.height, g.scale]).toEqual([2, 2, 2])
    expect(Array.from(g.mark)).toEqual([3, -1, 0, 7])
    expect(Array.from(g.depth)).toEqual([12.5, Number.POSITIVE_INFINITY, 4, 9.25])
    expect(Array.from(g.shadow)).toEqual([0, 0, 1, 0])
    expect(g.value[0]).toBeCloseTo(512 / 1023, 9)
    expect(g.value[1]).toBe(-1)
    expect(g.value[2]).toBe(1)
    expect(g.value[3]).toBe(0)
    const n = Array.from(g.normal)
    const want = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1, 0]
    n.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6))
  })

  it('reads a texel with mark 0 as drawn, not empty (the packed number carries mark + 1)', () => {
    const g = decodeFloatGBuffer(Float32Array.from(texels[2]), 1, 1)
    expect(g.mark[0]).toBe(0)
    expect(g.depth[0]).toBe(4)
  })

  it('reads the shadow flag from its own bit, whatever the mark: mark 0 lit, mark 3 shadowed, mark 1 lit', () => {
    const t = (mark: number, shadow: boolean) => encodeFloatTexel({ normal: [0, 0, 1], depth: 1, value: 0.25, shadow, mark })
    const g = decodeFloatGBuffer(Float32Array.from([t(0, false), t(3, true), t(1, false)].flat()), 3, 1)
    expect(Array.from(g.shadow)).toEqual([0, 1, 0])
    expect(Array.from(g.mark)).toEqual([0, 3, 1])
    // u = 0.25 -> round(0.25 * 1023) = 256 -> 256 / 1023
    expect(g.value[0]).toBeCloseTo(256 / 1023, 9)
  })

  it('an empty G-buffer has the contract defaults', () => {
    const g = emptyGBuffer(2, 1)
    expect(Array.from(g.depth)).toEqual([Infinity, Infinity])
    expect(Array.from(g.value)).toEqual([-1, -1])
    expect(Array.from(g.mark)).toEqual([-1, -1])
    expect(Array.from(g.normal)).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('the rgba8 layout', () => {
  const range: [number, number] = [10, 20]

  it('encodes hand bytes: normal +z, depth 15 of [10, 20], u 0.5, mark 5', () => {
    const bytes = encodeRgba8Texel({ normal: [0, 0, 1], depth: 15, value: 0.5, shadow: false, mark: 5 }, range)
    expect(bytes.length).toBe(RGBA8_BYTES_PER_TEXEL)
    // n * .5 + .5 -> 127.5 -> 128 (round), 128, 255; shadow 0
    // depth24 = floor(0.5 * 16777215 + 0.5) = 8388608 = 0x800000 -> 128, 0, 0; then 255
    // u16 = floor(0.5 * 65535 + 0.5) = 32768 -> 128, 0; mark + 1 = 6 -> 0, 6
    expect(Array.from(bytes)).toEqual([128, 128, 255, 0, 128, 0, 0, 255, 128, 0, 0, 6])
  })

  it('round-trips within the quantisation: normal 1/255, depth range / 2^24, u 1/65535', () => {
    const t = { normal: [0.6, -0.48, 0.64] as [number, number, number], depth: 13.37, value: 0.8123, shadow: true, mark: 300 }
    const out = decodeRgba8Texel(encodeRgba8Texel(t, range), range)
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.mark).toBe(300)
    expect(out.shadow).toBe(true)
    expect(Math.abs(out.value - t.value)).toBeLessThan(1 / 65535)
    expect(Math.abs(out.depth - t.depth)).toBeLessThan(10 / 16777215)
    expect(Math.hypot(out.normal[0] - t.normal[0], out.normal[1] - t.normal[1], out.normal[2] - t.normal[2])).toBeLessThan(0.02)
  })

  it('an all-zero texel (mark + 1 = 0) is empty', () => {
    expect(decodeRgba8Texel(new Uint8Array(12), range)).toBeNull()
  })

  it('decodes a 2 x 1 readback from three planes', () => {
    const a = encodeRgba8Texel({ normal: [0, 0, 1], depth: 15, value: 0.5, shadow: false, mark: 5 }, range)
    const nb = new Uint8Array(8)
    const db = new Uint8Array(8)
    const vb = new Uint8Array(8)
    nb.set(a.subarray(0, 4), 0)
    db.set(a.subarray(4, 8), 0)
    vb.set(a.subarray(8, 12), 0)
    // The second texel stays zero: empty.
    const g = decodeRgba8GBuffer(nb, db, vb, 2, 1, range)
    expect(Array.from(g.mark)).toEqual([5, -1])
    expect(g.depth[0]).toBeCloseTo(15, 5)
    expect(g.depth[1]).toBe(Number.POSITIVE_INFINITY)
    expect(g.value[0]).toBeCloseTo(0.5, 4)
    expect(g.value[1]).toBe(-1)
    expect(g.normal[2]).toBeGreaterThan(0.99)
  })
})
