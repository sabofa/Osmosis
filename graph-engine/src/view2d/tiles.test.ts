import { describe, expect, it } from 'vitest'
import { drawList, LATE_FRAME_FACTOR, levelFor, mayPaint, levelScale, TILE_PX, TileCache, tileId, tileRect, tilesCovering, tileUnits, wantList, type TileKey } from './tiles'
import type { Rect } from './types'

const covers = (tiles: TileKey[], r: Rect): boolean => {
  // Sample a grid of points inside r; each must fall in some tile.
  for (let a = 0; a <= 10; a++)
    for (let b = 0; b <= 10; b++) {
      const x = r.x + (r.width * a) / 10
      const y = r.y + (r.height * b) / 10
      if (!tiles.some((k) => { const t = tileRect(k); return x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height })) return false
    }
  return true
}

describe('levels', () => {
  it('paints at least as fine as asked, and less than one step finer', () => {
    for (const s of [0.07, 0.5, 1, 1.3, 2, 3.99, 17, 300]) {
      const l = levelFor(s)
      expect(levelScale(l)).toBeGreaterThanOrEqual(s * (1 - 1e-9))
      expect(levelScale(l - 1)).toBeLessThan(s)
    }
  })
  it('an exact level scale maps to that level', () => {
    for (const l of [-6, -1, 0, 1, 5, 12]) expect(levelFor(levelScale(l))).toBe(l)
  })
  it('a tile is TILE_PX device pixels at its own level', () => {
    for (const l of [-3, 0, 4]) expect(tileUnits(l) * levelScale(l)).toBeCloseTo(TILE_PX, 9)
  })
})

describe('tilesCovering', () => {
  const r: Rect = { x: -137.2, y: 40.5, width: 700, height: 333 }
  it('covers the rect, with no tile wholly outside it', () => {
    for (const l of [-2, 0, 3, 7]) {
      const tiles = tilesCovering(r, l)
      expect(covers(tiles, r)).toBe(true)
      for (const k of tiles) {
        const t = tileRect(k)
        expect(t.x < r.x + r.width && t.x + t.width > r.x && t.y < r.y + r.height && t.y + t.height > r.y).toBe(true)
      }
    }
  })
  it('a ring adds a tile on every side', () => {
    const a = tilesCovering(r, 2)
    const b = tilesCovering(r, 2, 1)
    const span = (ts: TileKey[]) => [Math.min(...ts.map((k) => k.i)), Math.max(...ts.map((k) => k.i)), Math.min(...ts.map((k) => k.j)), Math.max(...ts.map((k) => k.j))]
    const [i0, i1, j0, j1] = span(a)
    expect(span(b)).toEqual([i0 - 1, i1 + 1, j0 - 1, j1 + 1])
  })
  it('nearest the centre first', () => {
    const tiles = tilesCovering({ x: 0, y: 0, width: tileUnits(0) * 5, height: tileUnits(0) * 5 }, 0)
    expect(tiles[0]).toEqual({ level: 0, i: 2, j: 2 })
  })
})

describe('drawList', () => {
  const view: Rect = { x: 10, y: 20, width: 1500, height: 800 }
  const L = 0
  it('everything painted: just the level, nothing else', () => {
    const list = drawList(view, L, () => true)
    expect(list.every((k) => k.level === L)).toBe(true)
    expect(list.length).toBe(tilesCovering(view, L).length)
  })
  it('a hole is filled from a coarser level, drawn before (under) the level', () => {
    const own = tilesCovering(view, L)
    const hole = own[0]
    const painted = new Set([...own.slice(1), ...tilesCovering(view, L - 3)].map(tileId))
    const list = drawList(view, L, (k) => painted.has(tileId(k)))
    const standIns = list.filter((k) => k.level !== L)
    expect(standIns.length).toBeGreaterThan(0)
    expect(standIns.every((k) => k.level === L - 3)).toBe(true)
    expect(covers(standIns, tileRect(hole))).toBe(true)
    expect(list.findIndex((k) => k.level === L)).toBeGreaterThan(list.findIndex((k) => k.level === L - 3))
  })
  it('prefers a finer level that covers the hole whole', () => {
    const own = tilesCovering(view, L)
    const hole = own[0]
    const painted = new Set([...tilesCovering(tileRect(hole), L + 1), ...tilesCovering(view, L - 2)].map(tileId))
    const list = drawList(view, L, (k) => painted.has(tileId(k)))
    const forHole = list.filter((k) => k.level !== L)
    expect(forHole.some((k) => k.level === L + 1)).toBe(true)
  })
  it('nothing painted anywhere: nothing to draw', () => {
    expect(drawList(view, L, () => false)).toEqual([])
  })
  it('stacks coarser levels when the nearer one only partly covers', () => {
    const own = tilesCovering(view, L)
    const partial = tilesCovering(view, L - 1).slice(0, 1)
    const painted = new Set([...partial, ...tilesCovering(view, L - 4)].map(tileId))
    const list = drawList(view, L, (k) => painted.has(tileId(k)))
    expect(list.some((k) => k.level === L - 4)).toBe(true)
    expect(covers(list, view)).toBe(true)
    expect(own.length).toBeGreaterThan(0)
  })
})

describe('wantList', () => {
  const view: Rect = { x: 0, y: 0, width: 1500, height: 800 }
  it('moving: nothing (the stand-ins show; the GPU is for the frames)', () => {
    expect(wantList(view, 0, () => false, false)).toEqual([])
  })
  it('at rest: the screen first, then look-ahead; never a painted tile, never twice', () => {
    const screen = tilesCovering(view, 0)
    const painted = new Set([tileId(screen[0])])
    const list = wantList(view, 0, (k) => painted.has(tileId(k)), true)
    expect(list.slice(0, screen.length - 1).every((k) => k.level === 0)).toBe(true)
    expect(list.some((k) => k.level === 1)).toBe(true)
    expect(list.some((k) => k.level === -1)).toBe(true)
    expect(list.map(tileId)).not.toContain(tileId(screen[0]))
    expect(new Set(list.map(tileId)).size).toBe(list.length)
  })
})

describe('TileCache', () => {
  it('evicts the least recently used past its budget, and tells drop', () => {
    const dropped: number[] = []
    const c = new TileCache<number>(2, (v) => dropped.push(v))
    c.set('a', 1)
    c.set('b', 2)
    c.get('a')
    c.set('c', 3)
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(false)
    expect(dropped).toEqual([2])
  })
  it('never evicts what is kept', () => {
    const c = new TileCache<number>(1)
    c.set('a', 1)
    c.set('b', 2, new Set(['a']))
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(true)
  })
  it('clear drops everything', () => {
    const dropped: number[] = []
    const c = new TileCache<number>(5, (v) => dropped.push(v))
    c.set('a', 1)
    c.set('b', 2)
    c.clear()
    expect(c.size).toBe(0)
    expect(dropped.sort()).toEqual([1, 2])
  })
})

describe('mayPaint', () => {
  it('on time: yes', () => {
    expect(mayPaint({ lastFrameMs: 7, quickestFrameMs: 6.9 })).toBe(true)
  })
  it('a late frame (the GPU still busy): no', () => {
    expect(mayPaint({ lastFrameMs: 6.9 * LATE_FRAME_FACTOR + 10, quickestFrameMs: 6.9 })).toBe(false)
  })
  it('no interval yet (Infinity): no', () => {
    expect(mayPaint({ lastFrameMs: Infinity, quickestFrameMs: Infinity })).toBe(false)
  })
})
