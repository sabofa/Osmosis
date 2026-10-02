import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, setParam } from '../params'
import { UNDERPAINT_FRAGMENT, UNDERPAINT_STREAK_GAIN, UNDERPAINT_TEXTURE_MAX, UNDERPAINT_WEAVE_GATE } from './shaders/underpaint'
import { underpaintDirection, underpaintFloor, underpaintTexels } from './underpaint'

const NAN = Number.NaN

describe('the texels of an underpainting', () => {
  it('are sRGB bytes with coverage 255 where the form is, 0 where it is not', () => {
    // 3 x 1: linear (1, 1, 1) white, empty, linear (0, 0, 0) black
    const image = Float32Array.from([1, 1, 1, NAN, NAN, NAN, 0, 0, 0])
    const t = underpaintTexels(image, 3, 1)!
    expect(t.covered).toBe(2)
    expect(Array.from(t.rgba.subarray(0, 4))).toEqual([255, 255, 255, 255])
    expect(Array.from(t.rgba.subarray(8, 12))).toEqual([0, 0, 0, 255])
    // the empty texel takes the colour of its nearest covered one (the left, white and the right, black are 1 away: the first found, the lower index)
    expect(t.rgba[7]).toBe(0)
    expect(Array.from(t.rgba.subarray(4, 7))).toEqual([255, 255, 255])
  })

  it('give an empty texel the colour of the nearest covered texel within 2, and nothing farther', () => {
    // 6 x 1: only texel 0 is covered, in linear (0.2, 0.4, 0.6)
    const image = new Float32Array(18).fill(NAN)
    image.set([0.2, 0.4, 0.6], 0)
    const t = underpaintTexels(image, 6, 1)!
    const srgb = (v: number) => Math.round(255 * (1.055 * v ** (1 / 2.4) - 0.055))
    const covered = [srgb(0.2), srgb(0.4), srgb(0.6)]
    expect(Array.from(t.rgba.subarray(0, 4))).toEqual([...covered, 255])
    expect(Array.from(t.rgba.subarray(4, 8))).toEqual([...covered, 0]) // 1 away
    expect(Array.from(t.rgba.subarray(8, 12))).toEqual([...covered, 0]) // 2 away
    expect(Array.from(t.rgba.subarray(12, 16))).toEqual([0, 0, 0, 0]) // 3 away
  })

  it('take the colour across and down: a texel diagonal from the form, within 2 each way, has its colour too', () => {
    // 4 x 4, only texel (0, 0) covered, linear white; texel (1, 1) is one across and one down
    const image = new Float32Array(3 * 16).fill(NAN)
    image.set([1, 1, 1], 0)
    const t = underpaintTexels(image, 4, 4)!
    const at = (x: number, y: number) => Array.from(t.rgba.subarray(4 * (y * 4 + x), 4 * (y * 4 + x) + 4))
    expect(at(0, 0)).toEqual([255, 255, 255, 255])
    expect(at(2, 0)).toEqual([255, 255, 255, 0]) // two across
    expect(at(0, 2)).toEqual([255, 255, 255, 0]) // two down (below an across-filled texel's column)
    expect(at(1, 1)).toEqual([255, 255, 255, 0]) // across, then down
    expect(at(3, 3)).toEqual([0, 0, 0, 0]) // too far
  })

  it('are null for an image of the wrong size, or one that covers nothing', () => {
    expect(underpaintTexels(new Float32Array(0), 0, 0)).toBeNull()
    expect(underpaintTexels(new Float32Array(3 * 4), 2, 3)).toBeNull()
    expect(underpaintTexels(new Float32Array(3 * 4).fill(NAN), 2, 2)).toBeNull()
  })
})

describe('the underpainting’s mean colour (for a point the last frame did not see)', () => {
  it('is the mean sRGB colour of the covered texels: red and blue are (0.5, 0, 0.5), and the empty ones do not count', () => {
    const image = new Float32Array(3 * 4).fill(Number.NaN)
    image.set([1, 0, 0], 0)
    image.set([0, 0, 1], 3)
    const t = underpaintTexels(image, 2, 2)!
    expect(t.covered).toBe(2)
    expect(t.mean[0]).toBeCloseTo(0.5, 9)
    expect(t.mean[1]).toBe(0)
    expect(t.mean[2]).toBeCloseTo(0.5, 9)
    // linear 0.5 is sRGB 0.7354 (byte 188), the one covered texel: the mean is that
    const one = new Float32Array(3 * 4).fill(Number.NaN)
    one.set([0.5, 0.5, 0.5], 6)
    expect(underpaintTexels(one, 2, 2)!.mean[0]).toBeCloseTo(188 / 255, 9)
  })
})

describe('the least coverage of an underpainting', () => {
  it('is its opacity less what the weave and the streaks can take: 0.85 x (1 - 0.08 x 0.5 - 0.3 x 0.4) = 0.714 at the defaults', () => {
    expect(UNDERPAINT_WEAVE_GATE).toBe(0.08)
    expect(UNDERPAINT_STREAK_GAIN).toBe(0.3)
    // (the canvas texture is 0.5 by default)
    expect(DEFAULT_PAINT_PARAMS.canvas.texture).toBe(0.5)
    expect(underpaintFloor(DEFAULT_PAINT_PARAMS)).toBeCloseTo(0.85 * (1 - 0.08 * 0.5 - 0.3 * 0.4), 12)
    expect(underpaintFloor(DEFAULT_PAINT_PARAMS)).toBeGreaterThan(0.6)
  })

  it('follows the parameters: no streaks, no texture and full opacity is a full cover; texture counts only to 1.5, and a nothing is nothing', () => {
    const flat = resolvePaintParams({ underpaint: { opacity: 1, streak: 0 }, canvas: { texture: 0 } })
    expect(underpaintFloor(flat)).toBe(1)
    expect(underpaintFloor(setParam(setParam(flat, 'canvas.texture', 2), 'underpaint.streak', 1))).toBeCloseTo(1 - 0.08 * UNDERPAINT_TEXTURE_MAX - 0.3, 12)
    expect(underpaintFloor(setParam(DEFAULT_PAINT_PARAMS, 'underpaint.opacity', 0))).toBe(0)
  })
})

describe('the brush direction of the streaks', () => {
  it('is a unit vector within 0.7 rad of the horizontal, the same for a seed, another for another', () => {
    const [x, y] = underpaintDirection(1)
    expect(Math.hypot(x, y)).toBeCloseTo(1, 12)
    expect(Math.abs(Math.atan2(y, x))).toBeLessThanOrEqual(0.7)
    expect(underpaintDirection(1)).toEqual([x, y])
    expect(underpaintDirection(2)).not.toEqual([x, y])
    for (let seed = 1; seed <= 50; seed++) {
      expect(underpaintDirection(seed)[0]).toBeGreaterThan(0.76) // cos 0.7
    }
  })
})

describe('the underpainting shader', () => {
  it('is deterministic (no clock, no random source), reads the canvas height, and discards outside the form', () => {
    expect(UNDERPAINT_FRAGMENT).not.toMatch(/Math\.random|\bu_time\b|\bu_frame\b/)
    expect(UNDERPAINT_FRAGMENT).toContain('// paint: underpaint')
    expect(UNDERPAINT_FRAGMENT).toContain('u_paperH')
    expect(UNDERPAINT_FRAGMENT).toContain('discard')
    // the constants the floor is computed from are the ones in the shader
    expect(UNDERPAINT_FRAGMENT).toContain(`float weave = ${UNDERPAINT_WEAVE_GATE.toFixed(2)} *`)
    expect(UNDERPAINT_FRAGMENT).toContain(`float streak = ${UNDERPAINT_STREAK_GAIN.toFixed(2)} *`)
  })
})
