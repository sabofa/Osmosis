// The Showcase tab's pure parts: how the figures tile the window, what makes a
// painted tile stale, and the queue that paints them one at a time. The page
// (paintLab.tsx) does the drawing; the graph-engine suite tests these
// (graph-engine/src/space/paint/lab/showcase.test.ts).

import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import type { PaintDebugMode } from '../../graph-engine/src/space/paint/types'

export const TILE_ASPECT = 4 / 3
export const SHOWCASE_GAP = 16

export interface ShowcaseLayout {
  columns: number
  // CSS px. A tile is 4:3.
  tileWidth: number
  tileHeight: number
  gap: number
}

// Three columns on a desktop, two on a tablet, one on a phone, from the width
// the grid has (CSS px). The tile size is what the painter renders at, so it is
// a whole number of CSS px.
export function showcaseLayout(width: number): ShowcaseLayout {
  const columns = width >= 900 ? 3 : width >= 560 ? 2 : 1
  const tileWidth = Math.max(1, Math.floor((width - SHOWCASE_GAP * (columns - 1)) / columns))
  return { columns, tileWidth, tileHeight: Math.max(1, Math.round(tileWidth / TILE_ASPECT)), gap: SHOWCASE_GAP }
}

// Everything that changes what a tile looks like, as one string. A painted tile
// is current exactly while the key it was painted at is the key now: the
// params (so the seed and the A/B choice too), the debug view, the theme, a
// local-colour override, and the tile's size in device pixels.
export function showcaseKey(parts: {
  params: PaintParams
  debug: PaintDebugMode
  theme: 'light' | 'dark'
  localHex: string | null
  tile: { width: number; height: number }
  pixelRatio: number
}): string {
  return JSON.stringify([parts.params, parts.debug, parts.theme, parts.localHex, parts.tile.width, parts.tile.height, parts.pixelRatio])
}

// The tiles still to paint at the current key, in order. Painted tiles are
// cached: asking for the same key again queues nothing; a new key queues every
// tile again (each keeps its old picture until its turn).
export class TileQueue {
  private readonly ids: readonly string[]
  private key: string | null = null
  private readonly fresh = new Set<string>()

  constructor(ids: readonly string[]) {
    this.ids = ids
  }

  // Make `key` the current one. True when it was new, and so queued everything.
  setKey(key: string): boolean {
    if (key === this.key) return false
    this.key = key
    this.fresh.clear()
    return true
  }

  // The next tile to paint, or null when every tile is current.
  next(): string | null {
    return this.ids.find((id) => !this.fresh.has(id)) ?? null
  }

  // A tile was painted at `key`. A key that is no longer current (the params
  // moved while it was being painted) leaves the tile queued.
  done(id: string, key: string): void {
    if (key === this.key && this.ids.includes(id)) this.fresh.add(id)
  }

  isFresh(id: string): boolean {
    return this.fresh.has(id)
  }

  progress(): { done: number; total: number } {
    return { done: this.fresh.size, total: this.ids.length }
  }
}
