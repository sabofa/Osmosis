import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { applySlider } from '../../../../../review/src/paintLabParams'
import { showcaseKey, showcaseLayout, TileQueue } from '../../../../../review/src/paintLabShowcase'

// The Showcase paints every figure with the current tune. These are its pure
// parts: the grid, what makes a tile stale, and the one-at-a-time queue.

describe('showcaseLayout', () => {
  it('is three columns of 4:3 tiles on a desktop: (1200 - 2 x 16) / 3 = 389.3 -> 389 x 292', () => {
    expect(showcaseLayout(1200)).toEqual({ columns: 3, tileWidth: 389, tileHeight: 292, gap: 16 })
  })

  it('is three columns from 900 px, two from 560 px, one below', () => {
    // (900 - 32) / 3 = 289.3 -> 289, 289 x 3/4 = 216.75 -> 217
    expect(showcaseLayout(900)).toMatchObject({ columns: 3, tileWidth: 289, tileHeight: 217 })
    // (899 - 16) / 2 = 441.5 -> 441, 441 x 3/4 = 330.75 -> 331
    expect(showcaseLayout(899)).toMatchObject({ columns: 2, tileWidth: 441, tileHeight: 331 })
    // (560 - 16) / 2 = 272 -> 204
    expect(showcaseLayout(560)).toMatchObject({ columns: 2, tileWidth: 272, tileHeight: 204 })
    // one column takes the whole width: 559 x 3/4 = 419.25 -> 419
    expect(showcaseLayout(559)).toMatchObject({ columns: 1, tileWidth: 559, tileHeight: 419 })
  })

  it('a phone is one column: 375 wide gives 375 x 281', () => {
    expect(showcaseLayout(375)).toEqual({ columns: 1, tileWidth: 375, tileHeight: 281, gap: 16 })
  })

  it('never makes a tile smaller than a pixel, and fits the width it was given', () => {
    expect(showcaseLayout(0)).toMatchObject({ columns: 1, tileWidth: 1, tileHeight: 1 })
    for (const width of [320, 600, 1024, 1920]) {
      const l = showcaseLayout(width)
      expect(l.columns * l.tileWidth + (l.columns - 1) * l.gap).toBeLessThanOrEqual(width)
    }
  })
})

describe('showcaseKey', () => {
  const base = { params: DEFAULT_PAINT_PARAMS, debug: 'none' as const, theme: 'light' as const, localHex: null, tile: { width: 389, height: 292 }, pixelRatio: 1 }

  it('is the same for the same tune, even from another object', () => {
    expect(showcaseKey({ ...base, params: structuredClone(DEFAULT_PAINT_PARAMS) })).toBe(showcaseKey(base))
  })

  it('changes when a parameter does, the seed included', () => {
    expect(showcaseKey({ ...base, params: applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', -20) })).not.toBe(showcaseKey(base))
    expect(showcaseKey({ ...base, params: applySlider(DEFAULT_PAINT_PARAMS, 'seed', 2) })).not.toBe(showcaseKey(base))
  })

  it('changes with the debug view, the theme, a local colour, the tile size and the pixel ratio', () => {
    const keys = new Set([
      showcaseKey(base),
      showcaseKey({ ...base, debug: 'edges' }),
      showcaseKey({ ...base, theme: 'dark' }),
      showcaseKey({ ...base, localHex: '#b7603a' }),
      showcaseKey({ ...base, tile: { width: 272, height: 204 } }),
      showcaseKey({ ...base, pixelRatio: 2 }),
    ])
    expect(keys.size).toBe(6)
  })
})

describe('TileQueue', () => {
  const ids = ['a', 'b', 'c']

  it('hands out the tiles in order and counts each as it is painted', () => {
    const q = new TileQueue(ids)
    expect(q.setKey('k1')).toBe(true)
    expect(q.progress()).toEqual({ done: 0, total: 3 })
    const order: string[] = []
    for (let id = q.next(); id !== null; id = q.next()) {
      order.push(id)
      q.done(id, 'k1')
    }
    expect(order).toEqual(['a', 'b', 'c'])
    expect(q.progress()).toEqual({ done: 3, total: 3 })
    expect(q.next()).toBeNull()
  })

  it('caches: the same key queues nothing', () => {
    const q = new TileQueue(ids)
    q.setKey('k1')
    for (const id of ids) q.done(id, 'k1')
    expect(q.setKey('k1')).toBe(false)
    expect(q.next()).toBeNull()
    expect(ids.every((id) => q.isFresh(id))).toBe(true)
  })

  it('a new key queues every tile again, from the first, even mid-run', () => {
    const q = new TileQueue(ids)
    q.setKey('k1')
    q.done('a', 'k1')
    q.done('b', 'k1')
    expect(q.setKey('k2')).toBe(true)
    expect(q.progress()).toEqual({ done: 0, total: 3 })
    expect(q.isFresh('a')).toBe(false)
    expect(q.next()).toBe('a')
  })

  it('ignores a tile painted at a key that is no longer current: it stays queued', () => {
    const q = new TileQueue(ids)
    q.setKey('k1')
    q.setKey('k2')
    q.done('a', 'k1')
    expect(q.next()).toBe('a')
    expect(q.progress().done).toBe(0)
    q.done('a', 'k2')
    expect(q.next()).toBe('b')
  })

  it('ignores a tile it was never given, and a tile counted twice counts once', () => {
    const q = new TileQueue(ids)
    q.setKey('k1')
    q.done('zzz', 'k1')
    q.done('a', 'k1')
    q.done('a', 'k1')
    expect(q.progress()).toEqual({ done: 1, total: 3 })
  })
})
