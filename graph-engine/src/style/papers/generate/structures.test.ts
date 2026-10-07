import { beforeEach, describe, expect, it } from 'vitest'
import { clearPaperCache, GENERATED_PAPER_TYPES, generatePaper } from './index'
import { hashArray, seamRatio } from './testing'
import type { GeneratedPaperType, PaperTile } from './types'

// The paper structures of the backgrounds: fine and rough paper, kraft, the three ruled papers' grain,
// and the blackboard, greenboard and whiteboard. Each is seeded, tileable, and structure AROUND zero.

const NEW_TYPES: GeneratedPaperType[] = ['paperFine', 'paperRough', 'kraft', 'notebook', 'graphPaper', 'dotted', 'blackboard', 'greenboard', 'whiteboard']
const SIZE = 256

const tileOf = (type: GeneratedPaperType, seed = 'osmosis', texture = 1): PaperTile => generatePaper(type, { texture, seed, size: SIZE })
const hashTile = (t: PaperTile) => `${hashArray(t.offsets)}/${hashArray(t.height)}`

// Statistics of one channel (0 dL, 1 da, 2 db) of the offsets.
function channel(t: PaperTile, c: number) {
  const n = SIZE * SIZE
  let mean = 0
  for (let i = 0; i < n; i++) mean += t.offsets[i * 3 + c] / n
  let variance = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = t.offsets[i * 3 + c]
    variance += (v - mean) ** 2 / n
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  return { mean, sd: Math.sqrt(variance), min, max }
}

beforeEach(() => clearPaperCache())

describe('the generator knows every type', () => {
  it('lists the two weaves and the nine new structures', () => {
    expect([...GENERATED_PAPER_TYPES].sort()).toEqual(['canvas', 'linen', ...NEW_TYPES].sort())
  })
})

describe('each paper structure', () => {
  for (const type of NEW_TYPES) {
    describe(type, () => {
      it('is deterministic: the same seed gives byte-equal tiles, regenerated from nothing', () => {
        const first = hashTile(tileOf(type))
        clearPaperCache()
        expect(hashTile(tileOf(type))).toBe(first)
      })

      it('is another tile for another seed', () => {
        expect(hashTile(tileOf(type, 'osmosis-2'))).not.toBe(hashTile(tileOf(type)))
      })

      it('tiles: the edge columns and rows continue across the wrap, in height and lightness', () => {
        const t = tileOf(type)
        expect(t.height.every(Number.isFinite) && t.offsets.every(Number.isFinite)).toBe(true)
        for (const axis of ['x', 'y'] as const) {
          expect(seamRatio(t.height, SIZE, axis), `height ${axis}`).toBeLessThan(1.3)
          expect(seamRatio(t.offsets, SIZE, axis, 3, 0), `lightness ${axis}`).toBeLessThan(1.3)
        }
      })

      it('is structure around zero: every offset channel has a mean of nothing, and the height is 0..1 around 0.5', () => {
        const t = tileOf(type)
        for (let c = 0; c < 3; c++) expect(Math.abs(channel(t, c).mean), `channel ${c}`).toBeLessThan(0.0005)
        let meanH = 0
        for (const h of t.height) meanH += h / t.height.length
        expect(Math.min(...t.height)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...t.height)).toBeLessThanOrEqual(1)
        expect(meanH).toBeCloseTo(0.5, 1)
      })

      it('is a tone, not a pattern: the lightness varies a little, the colour hardly at all', () => {
        const L = channel(tileOf(type), 0)
        expect(L.sd).toBeGreaterThan(0.002)
        expect(L.sd).toBeLessThan(0.04)
        expect(Math.abs(L.min)).toBeLessThan(0.4)
        expect(Math.abs(L.max)).toBeLessThan(0.4)
        expect(channel(tileOf(type), 1).sd).toBeLessThan(0.01)
        expect(channel(tileOf(type), 2).sd).toBeLessThan(0.02)
      })

      it('scales with texture: none is flat, and more is livelier', () => {
        const flat = tileOf(type, 'osmosis', 0)
        expect(channel(flat, 0).sd).toBe(0)
        expect(channel(tileOf(type, 'osmosis', 0.5), 0).sd).toBeLessThan(channel(tileOf(type, 'osmosis', 1), 0).sd)
      })
    })
  }
})

describe('the character of each', () => {
  it('rough paper is coarser and livelier than fine paper', () => {
    expect(channel(tileOf('paperRough'), 0).sd).toBeGreaterThan(1.5 * channel(tileOf('paperFine'), 0).sd)
  })

  it('kraft has sparse dark flecks: a few texels far darker than the paper, and not many', () => {
    const t = tileOf('kraft')
    const { sd } = channel(t, 0)
    let dark = 0
    for (let i = 0; i < SIZE * SIZE; i++) if (t.offsets[i * 3] < -0.09) dark++
    expect(dark).toBeGreaterThan(5)
    expect(dark / (SIZE * SIZE)).toBeLessThan(0.02)
    expect(channel(t, 0).min).toBeLessThan(-6 * sd * 0.5)
  })

  for (const board of ['blackboard', 'greenboard'] as const) {
    it(`${board}: an erased haze lies on it in patches, +0.02 to +0.05 lighter than the slate around`, () => {
      // The haze is the slow part of the lightness: average it over 16 x 16 blocks, so the grain is gone.
      const t = tileOf(board)
      const block = 16
      const blocks = SIZE / block
      const means: number[] = []
      for (let by = 0; by < blocks; by++) {
        for (let bx = 0; bx < blocks; bx++) {
          let sum = 0
          for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) sum += t.offsets[((by * block + y) * SIZE + bx * block + x) * 3]
          means.push(sum / (block * block))
        }
      }
      const lo = [...means].sort((a, b) => a - b)[Math.floor(means.length * 0.1)]
      const hi = [...means].sort((a, b) => a - b)[Math.floor(means.length * 0.97)]
      expect(hi - lo).toBeGreaterThan(0.02)
      expect(hi - lo).toBeLessThan(0.07)
    })
  }

  it('the blackboard and the greenboard are the same slate and not the same tile', () => {
    expect(hashTile(tileOf('greenboard'))).not.toBe(hashTile(tileOf('blackboard')))
  })

  it('a whiteboard has faint ghosts, darker than the board by 0.01 to 0.03 where they lie, and a gloss that is lighter', () => {
    const t = tileOf('whiteboard')
    // The darkest blocks (ghosts) against the lightest (gloss), averaged over 8 x 8 blocks to take the surface out.
    const block = 8
    const blocks = SIZE / block
    const means: number[] = []
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        let sum = 0
        for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) sum += t.offsets[((by * block + y) * SIZE + bx * block + x) * 3]
        means.push(sum / (block * block))
      }
    }
    const sorted = [...means].sort((a, b) => a - b)
    expect(sorted[0]).toBeLessThan(-0.008)
    expect(sorted[0]).toBeGreaterThan(-0.06)
    expect(sorted[sorted.length - 1]).toBeGreaterThan(0)
    // It is nearly smooth: the relief is a hair.
    expect(Math.max(...t.height) - Math.min(...t.height)).toBeLessThan(0.3)
  })
})
