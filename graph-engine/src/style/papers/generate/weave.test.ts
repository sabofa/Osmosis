import { describe, expect, it } from 'vitest'
import { randomFor } from '../../random'
import { seamRatio } from './testing'
import { addSlub, prime, weaveField } from './weave'
import type { WeaveSpec } from './weave'

// An irregular linen-like cloth.
const IRREGULAR: WeaveSpec = {
  pitch: 1024 / 192,
  width: [0.86, 1.04],
  fatP: 0.05,
  narrowP: 0.05,
  thick: 0.28,
  wander: 0.28,
  jit: 0.13,
  slubP: 0.5,
  slubAmp: [0.5, 1.3],
  slubSig: [25, 110],
  bright: [0.94, 1.05],
  occl: 0.9,
  streak: 0.08,
}

// A perfect cloth: identical threads on an exact grid, no slubs, no variation.
const PERFECT: WeaveSpec = {
  pitch: 8,
  width: [1, 1],
  fatP: 0,
  narrowP: 0,
  thick: 0,
  wander: 0,
  jit: 0,
  slubP: 0,
  slubAmp: [0, 0],
  slubSig: [20, 20],
  bright: [1, 1],
  occl: 0.9,
  streak: 0,
}

// The strongest spatial frequency (cycles per tile) of the mean height along one axis.
function dominantFrequency(H: Float32Array, size: number, axis: 'rows' | 'columns'): number {
  const profile = new Float64Array(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) profile[axis === 'rows' ? y : x] += H[y * size + x] / size
  }
  let best = 0
  let bestPower = -1
  for (let k = 4; k < size / 2; k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < size; n++) {
      re += profile[n] * Math.cos((2 * Math.PI * k * n) / size)
      im += profile[n] * Math.sin((2 * Math.PI * k * n) / size)
    }
    const power = re * re + im * im
    if (power > bestPower) {
      bestPower = power
      best = k
    }
  }
  return best
}

describe('prime', () => {
  it('fills the valleys: heights under the level rise by `fill` of their depth', () => {
    // level 0.6, fill 0.72: 0.2 + 0.72 * 0.4 = 0.488; the level and anything above stay.
    const h = new Float32Array([0.2, 0.6, 0.9])
    prime(h, 0.6, 0.72)
    expect(h[0]).toBeCloseTo(0.488, 6)
    expect(h[1]).toBeCloseTo(0.6, 6)
    expect(h[2]).toBeCloseTo(0.9, 6)
  })
})

describe('addSlub', () => {
  it('swells a thread in a Gaussian around its centre, spilling over the edge of the loop', () => {
    // size 16, centre 1, sigma 2, amp 1: dist 0 is 1, dist 1 is exp(-1/8), and texel 15 is two texels
    // away round the loop: exp(-4/8). Beyond 3.5 sigma = 7 texels the swelling is cut off.
    const thick = new Float32Array(16)
    addSlub(thick, 1, 2, 1)
    expect(thick[1]).toBeCloseTo(1, 6)
    expect(thick[0]).toBeCloseTo(Math.exp(-1 / 8), 6)
    expect(thick[2]).toBeCloseTo(Math.exp(-1 / 8), 6)
    expect(thick[15]).toBeCloseTo(Math.exp(-4 / 8), 6)
    expect(thick[14]).toBeCloseTo(Math.exp(-9 / 8), 6)
    expect(thick[9]).toBe(0) // 8 texels away: outside the reach
  })

  it('reaches 3.5 sigma and no further', () => {
    // sigma 2 on a loop of 64, centre 32: 7 texels out is exp(-49/8); 8 texels out is beyond the reach.
    const thick = new Float32Array(64)
    addSlub(thick, 32, 2, 1)
    expect(thick[39]).toBeCloseTo(Math.exp(-49 / 8), 6)
    expect(thick[25]).toBeCloseTo(Math.exp(-49 / 8), 6)
    expect(thick[40]).toBe(0)
    expect(thick[24]).toBe(0)
  })

  it('counts no texel twice, however wide the swelling', () => {
    // sigma 100 on a loop of 8: the reach is the whole loop, and each texel is added to once.
    const thick = new Float32Array(8)
    addSlub(thick, 3, 100, 1)
    for (let x = 0; x < 8; x++) {
      const dist = Math.min(Math.abs(x - 3), 8 - Math.abs(x - 3))
      expect(thick[x]).toBeCloseTo(Math.exp(-(dist * dist) / 20000), 6)
    }
  })

  it('adds to what is there', () => {
    const thick = new Float32Array(8).fill(1)
    addSlub(thick, 3, 1, 0.5)
    expect(thick[3]).toBeCloseTo(1.5, 6)
  })
})

describe('weaveField', () => {
  it('has one thread per pitch, in both directions', () => {
    // 256 texels at a pitch of 5.33: 48 threads each way.
    const { H } = weaveField(randomFor('t/weave/count'), 256, IRREGULAR)
    expect(dominantFrequency(H, 256, 'rows')).toBe(48)
    expect(dominantFrequency(H, 256, 'columns')).toBe(48)
  })

  it('always has an even number of threads, so over and under alternate across the wrap', () => {
    // 176 / 5.33 = 33 (odd): rounded to 34 threads.
    const { H } = weaveField(randomFor('t/weave/even'), 176, IRREGULAR)
    expect(dominantFrequency(H, 176, 'rows')).toBe(34)
    expect(seamRatio(H, 176, 'x')).toBeLessThan(1.3)
    expect(seamRatio(H, 176, 'y')).toBeLessThan(1.3)
  })

  it('is a plain weave: each thread goes over then under, and the neighbours do the opposite', () => {
    const size = 64 // 8 threads of 8 texels each way
    const { H } = weaveField(randomFor('t/weave/plain'), size, PERFECT)
    const at = (x: number, y: number) => H[(y % size) * size + (x % size)]
    let flipped = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // One thread across and one down is the same crossing again ...
        expect(at(x + 8, y + 8)).toBeCloseTo(at(x, y), 5)
        // ... and so is two threads across.
        expect(at(x + 16, y)).toBeCloseTo(at(x, y), 5)
        // One thread across alone is the opposite crossing.
        if (Math.abs(at(x + 8, y) - at(x, y)) > 0.1) flipped++
      }
    }
    expect(flipped / (size * size)).toBeGreaterThan(0.25)
  })

  it('is periodic across the thread wrap even when the threads overlap their neighbours', () => {
    // Threads 2.2 pitches wide reach well into the next cell on both sides, so the thread that wraps round the end
    // of the cloth (thread N-1 beside thread 0) must be found from both ends, in both directions.
    const wide: WeaveSpec = { ...PERFECT, width: [2.2, 2.2] }
    const size = 64
    const { H } = weaveField(randomFor('t/weave/wide'), size, wide)
    let worst = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const here = H[y * size + x]
        worst = Math.max(worst, Math.abs(H[y * size + ((x + 16) % size)] - here), Math.abs(H[((y + 16) % size) * size + x] - here))
      }
    }
    expect(worst).toBeLessThan(1e-5)
  })

  it('cuts the tile through the middle of a thread, where the cloth is smoothest', () => {
    // A perfect cloth is symmetric about a thread's centre, so the last column and the
    // first are mirror images of one another, as are the last row and the first.
    const size = 64
    const { H } = weaveField(randomFor('t/weave/mid'), size, PERFECT)
    for (let k = 0; k < size; k++) {
      expect(H[k * size + size - 1]).toBeCloseTo(H[k * size], 5)
      expect(H[(size - 1) * size + k]).toBeCloseTo(H[k], 5)
    }
  })

  it('tiles seamlessly, irregular threads and slubs that spill over the edge included', () => {
    const slubby: WeaveSpec = { ...IRREGULAR, slubP: 1, slubAmp: [1, 1.5], slubSig: [30, 60] }
    for (const spec of [IRREGULAR, slubby]) {
      const { H, K } = weaveField(randomFor('t/weave/seam'), 192, spec)
      expect(H.every(Number.isFinite) && K.every(Number.isFinite)).toBe(true)
      for (const field of [H, K]) {
        expect(seamRatio(field, 192, 'x')).toBeLessThan(1.3)
        expect(seamRatio(field, 192, 'y')).toBeLessThan(1.3)
      }
    }
  })

  it('darkens the valleys by `occl` and leaves the thread crowns at the thread brightness', () => {
    // occl 0.9: a gap (top height 0) is 0.9 of the thread colour, a crown (top height 1) all of it.
    const { H, K } = weaveField(randomFor('t/weave/occl'), 64, PERFECT)
    let lowest = Infinity
    let highest = -Infinity
    for (let i = 0; i < K.length; i++) {
      lowest = Math.min(lowest, K[i])
      highest = Math.max(highest, K[i])
      // K = 0.9 + 0.1 * min(1, 1.25 * top), exactly.
      expect(K[i]).toBeCloseTo(0.9 + 0.1 * Math.min(1, 1.25 * H[i]), 5)
    }
    expect(lowest).toBeLessThan(0.97)
    expect(highest).toBeCloseTo(1, 5)
  })

  it('varies the brightness of a thread along its length by `streak`, as a standard deviation', () => {
    // No valley occlusion and thread brightness 1: K is 1 + streak * (a unit-variance noise).
    const streaky: WeaveSpec = { ...PERFECT, occl: 1, streak: 0.1 }
    const { K } = weaveField(randomFor('t/weave/streak'), 256, streaky)
    const n = K.length
    let mean = 0
    for (const v of K) mean += v / n
    let variance = 0
    for (const v of K) variance += (v - mean) ** 2 / n
    expect(mean).toBeCloseTo(1, 1)
    expect(Math.sqrt(variance)).toBeGreaterThan(0.092)
    expect(Math.sqrt(variance)).toBeLessThan(0.108)
  })

  it('leaves gaps between narrow threads: nothing on top, the valley colour', () => {
    // Size 64 at a pitch of 8 is 8 threads each way. A thread half a pitch wide has a half width of
    // 0.5 * 8 * 0.5 * 1.04 = 2.08 texels about its centre at 4 (mod 8), so it covers the four texel rows (columns)
    // whose centres, 2.5 3.5 4.5 5.5, are under 2.08 from it: 32 of 64 rows, 32 of 64 columns. A texel is open
    // where neither family reaches it: 32 * 32 = 1024 of 4096 are covered by neither (and 1024 by both).
    const narrow: WeaveSpec = { ...PERFECT, width: [0.5, 0.5] }
    const { H, K } = weaveField(randomFor('t/weave/narrow'), 64, narrow)
    let gaps = 0
    let wrong = 0
    for (let i = 0; i < H.length; i++) {
      if (H[i] === 0) {
        gaps++
        // Nothing on top: the valley colour, `occl` (0.9) of the thread colour 1.
        if (Math.abs(K[i] - 0.9) > 1e-6) wrong++
      }
    }
    expect(gaps).toBe(1024)
    expect(wrong).toBe(0)
  })

  it('is deterministic in its random source, and different in another', () => {
    const a = weaveField(randomFor('t/weave/same'), 64, IRREGULAR).H
    const b = weaveField(randomFor('t/weave/same'), 64, IRREGULAR).H
    const c = weaveField(randomFor('t/weave/other'), 64, IRREGULAR).H
    expect(Array.from(b)).toEqual(Array.from(a))
    expect(Array.from(c)).not.toEqual(Array.from(a))
  })
})
