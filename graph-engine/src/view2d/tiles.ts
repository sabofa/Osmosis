import type { Rect } from './types'

// Tiles: how a drawing that is dear to paint is kept on the screen while the
// view moves.
//
// The drawing is cut into square tiles, each painted once at a fixed
// resolution (a *level*) and kept. A frame of a moving view then only places
// tiles that already exist; nothing is repainted to move. Where the level the
// view wants has a hole (a tile not painted yet), the tiles of other levels
// that cover it stand in, scaled: a coarser tile is blurry for a moment, but
// the drawing is never missing. This is the map-viewer model, and it is what
// keeps a heavily textured figure (chalk on rough paper) smooth at any zoom.
//
// Everything here is arithmetic on content rects and tile keys; the painting
// itself is ./dom/svgTiles.ts.

// A tile's side, in device pixels.
export const TILE_PX = 512
// Levels per doubling of resolution. Two: a tile is never drawn more than √2
// smaller than it was painted, which keeps hatching and grain crisp.
export const LEVEL_STEPS = 2
// How many coarser and finer levels may stand in for a missing tile.
export const FALLBACK_COARSER = 8
export const FALLBACK_FINER = 2

export interface TileKey {
  level: number
  i: number
  j: number
}

export const tileId = (k: TileKey): string => `${k.level}/${k.i}/${k.j}`

// Device pixels per content unit at a level.
export const levelScale = (level: number): number => 2 ** (level / LEVEL_STEPS)

// The level to paint at for a view drawn at `devicePxPerUnit`: the first at
// least that fine, so tiles are only ever scaled down (by less than √2).
export function levelFor(devicePxPerUnit: number): number {
  const exact = Math.log2(devicePxPerUnit) * LEVEL_STEPS
  const near = Math.round(exact)
  // Within rounding of a level is that level, not the next one up.
  return Math.abs(exact - near) < 1e-6 ? near : Math.ceil(exact)
}

// A tile's side, in content units.
export const tileUnits = (level: number): number => TILE_PX / levelScale(level)

export function tileRect(k: TileKey): Rect {
  const u = tileUnits(k.level)
  return { x: k.i * u, y: k.j * u, width: u, height: u }
}

// The tiles of `level` that cover `rect`, grown by `ring` tiles on every side,
// nearest the rect's centre first (the order they are wanted in).
export function tilesCovering(rect: Rect, level: number, ring = 0): TileKey[] {
  const u = tileUnits(level)
  const i0 = Math.floor(rect.x / u) - ring
  const j0 = Math.floor(rect.y / u) - ring
  const i1 = Math.ceil((rect.x + rect.width) / u) - 1 + ring
  const j1 = Math.ceil((rect.y + rect.height) / u) - 1 + ring
  const ci = (rect.x + rect.width / 2) / u - 0.5
  const cj = (rect.y + rect.height / 2) / u - 0.5
  const out: TileKey[] = []
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push({ level, i, j })
  return out.sort((a, b) => Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj))
}

// What to draw for a view at `level` over `visible`, in drawing order (each
// drawn over the ones before): stand-ins first, coarsest first, then the
// level's own tiles. A missing tile is stood in for by the nearest finer level
// that covers it whole (sharper, so preferred), else by every painted tile of
// the coarser levels that touches it, down until one level covers it whole.
export function drawList(visible: Rect, level: number, has: (k: TileKey) => boolean): TileKey[] {
  const wanted = tilesCovering(visible, level)
  const own = wanted.filter(has)
  const missing = wanted.filter((k) => !has(k))
  const standIns = new Map<string, TileKey>()
  for (const m of missing) {
    const area = tileRect(m)
    let done = false
    for (let l = level + 1; l <= level + FALLBACK_FINER && !done; l++) {
      const finer = tilesCovering(area, l)
      if (finer.every(has)) {
        finer.forEach((k) => standIns.set(tileId(k), k))
        done = true
      }
    }
    for (let l = level - 1; l >= level - FALLBACK_COARSER && !done; l--) {
      const coarser = tilesCovering(area, l)
      const painted = coarser.filter(has)
      painted.forEach((k) => standIns.set(tileId(k), k))
      done = painted.length === coarser.length
    }
  }
  const byLevel = [...standIns.values()].sort((a, b) => a.level - b.level)
  return [...byLevel, ...own]
}

// The tiles worth painting next, most wanted first: none while the view moves
// (painting costs GPU time the moving frames need, and a zoom crosses levels
// faster than they could be painted; the stand-ins show meanwhile). At rest:
// the screen, then a ring around it (for a pan), the next level in (for a zoom
// in) and the one out.
export function wantList(visible: Rect, level: number, has: (k: TileKey) => boolean, atRest: boolean): TileKey[] {
  if (!atRest) return []
  const lists = [tilesCovering(visible, level), tilesCovering(visible, level, 1), tilesCovering(visible, level + 1), tilesCovering(visible, level - 1)]
  const seen = new Set<string>()
  const out: TileKey[] = []
  for (const list of lists) {
    for (const k of list) {
      const id = tileId(k)
      if (seen.has(id) || has(k)) continue
      seen.add(id)
      out.push(k)
    }
  }
  return out
}

// Pacing. Painting a tile is cheap for the page but not for the GPU, which
// rasterises it in the same queue it presents frames from (~5 ms a tile for a
// heavy style, 50–100 ms for the first tile of a level). Tiles painted in a
// burst are one lump of GPU work that the next frames wait behind: a spike,
// just when the reader starts to move. So: one tile per frame at most, and none
// while frames are coming late (the GPU still busy with the last one).
// Late: the last frame took this much longer than the quickest recent one.
export const LATE_FRAME_FACTOR = 1.5
export const LATE_FRAME_SLACK_MS = 2

export interface PaceInput {
  // The interval before this frame, and the quickest of the recent ones (the
  // display's own rate, when nothing is in the way).
  lastFrameMs: number
  quickestFrameMs: number
}

export function mayPaint(p: PaceInput): boolean {
  // No interval yet (a loop just started) counts as late: wait one frame.
  return Number.isFinite(p.lastFrameMs) && p.lastFrameMs <= p.quickestFrameMs * LATE_FRAME_FACTOR + LATE_FRAME_SLACK_MS
}

// A least-recently-used store with a budget. `keep` names what must not be
// evicted now (what is on screen); `drop` is told what leaves.
export class TileCache<T> {
  private readonly map = new Map<string, T>()
  private readonly budget: number
  private readonly drop: (value: T) => void
  constructor(budget: number, drop: (value: T) => void = () => {}) {
    this.budget = budget
    this.drop = drop
  }

  get size(): number {
    return this.map.size
  }

  has(id: string): boolean {
    return this.map.has(id)
  }

  // Marks it as just used.
  get(id: string): T | undefined {
    const v = this.map.get(id)
    if (v !== undefined) {
      this.map.delete(id)
      this.map.set(id, v)
    }
    return v
  }

  set(id: string, value: T, keep: ReadonlySet<string> = new Set()): void {
    const old = this.map.get(id)
    if (old !== undefined && old !== value) this.drop(old)
    this.map.delete(id)
    this.map.set(id, value)
    for (const [k, v] of this.map) {
      if (this.map.size <= this.budget) break
      if (k === id || keep.has(k)) continue
      this.map.delete(k)
      this.drop(v)
    }
  }

  clear(): void {
    for (const v of this.map.values()) this.drop(v)
    this.map.clear()
  }
}
