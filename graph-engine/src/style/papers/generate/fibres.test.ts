import { describe, expect, it } from 'vitest'
import { randomFor } from '../../random'
import { fibrePass } from './fibres'
import type { FibreSpec } from './fibres'
import { hashArray } from './testing'

const SIZE = 64
const DELTA: [number, number, number] = [-0.1, 0.02, 0.03]
// count 256 at 1024^2 is one strand on a 64^2 tile (the count scales with area).
const ONE_STRAND: FibreSpec = { count: 256, len: [20, 20], curl: 0, wid: [1, 1], alpha: [0.5, 0.5], colours: [{ delta: DELTA, weight: 1 }] }

function strand(identity: string, spec: FibreSpec = ONE_STRAND) {
  const off = new Float32Array(3 * SIZE * SIZE)
  fibrePass(off, SIZE, randomFor(identity), spec)
  return off
}

// The fraction of the strand colour each texel took, from its first channel.
const fractions = (off: Float32Array) => Array.from({ length: SIZE * SIZE }, (_, i) => off[i * 3] / DELTA[0])

describe('fibrePass', () => {
  it('blends toward the strand colour, the same fraction in every channel, and no further than its alpha', () => {
    const off = strand('t/fibre/blend')
    let touched = 0
    let maxFraction = 0
    for (let i = 0; i < SIZE * SIZE; i++) {
      const f = off[i * 3] / DELTA[0]
      if (f === 0) {
        expect(off[i * 3 + 1]).toBe(0)
        expect(off[i * 3 + 2]).toBe(0)
        continue
      }
      touched++
      maxFraction = Math.max(maxFraction, f)
      expect(off[i * 3 + 1] / DELTA[1]).toBeCloseTo(f, 5)
      expect(off[i * 3 + 2] / DELTA[2]).toBeCloseTo(f, 5)
    }
    expect(touched).toBeGreaterThan(15)
    // alpha 0.5 and full coverage at most: a joint between two segments is not counted twice.
    expect(maxFraction).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(maxFraction).toBeGreaterThan(0.3)
  })

  it('lays down the mass of a 20-texel strand one texel wide, wherever it falls, wrapping at the edges', () => {
    // A strand one texel wide has a triangular coverage profile whose area per unit length is 1, plus a half
    // cone (pi / 6 = 0.52) at each end: 20 + 1.05 = 21.05, and each texel carries alpha 0.5 of it, so 10.5.
    // Many seeds, so some strands cross the tile's edges.
    for (let n = 0; n < 12; n++) {
      const mass = fractions(strand(`t/fibre/mass/${n}`)).reduce((s, f) => s + f, 0)
      expect(mass).toBeGreaterThan(8.5)
      expect(mass).toBeLessThan(12.5)
    }
  })

  it('draws more strands in a bigger tile, in proportion to its area', () => {
    const big = new Float32Array(3 * 128 * 128)
    fibrePass(big, 128, randomFor('t/fibre/area'), ONE_STRAND) // 4 strands
    let mass = 0
    for (let i = 0; i < 128 * 128; i++) mass += big[i * 3] / DELTA[0]
    expect(mass).toBeGreaterThan(4 * 8)
    expect(mass).toBeLessThan(4 * 13)
  })

  it('is deterministic in its random source', () => {
    expect(hashArray(strand('t/fibre/same'))).toBe(hashArray(strand('t/fibre/same')))
    expect(hashArray(strand('t/fibre/other'))).not.toBe(hashArray(strand('t/fibre/same')))
  })

  it('picks colours by weight', () => {
    const spec: FibreSpec = {
      ...ONE_STRAND,
      count: 256 * 40, // 40 strands
      colours: [
        { delta: [-0.1, 0, 0], weight: 3 },
        { delta: [0.1, 0, 0], weight: 1 },
      ],
    }
    const off = strand('t/fibre/weights', spec)
    let dark = 0
    let light = 0
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (off[i * 3] < 0) dark++
      if (off[i * 3] > 0) light++
    }
    // Three to one by weight; strands overlap and cancel a little, so the bound is loose.
    expect(dark).toBeGreaterThan(light * 1.5)
  })
})
