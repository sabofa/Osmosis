import { svgWindow } from '../svgMarkup'
import { coversRect } from '../liveTransform'
import { drawList, levelFor, mayPaint, TILE_PX, TileCache, tileId, tileRect, tilesCovering, wantList, type TileKey } from '../tiles'
import type { Rect, Size } from '../types'

// The browser side of ../tiles.ts: an <svg> drawing painted into tiles once,
// kept, and composited onto one <canvas> for every frame of the view.
//
// Why: an <svg> on the page is repainted by the browser whenever its window
// (viewBox) changes, and a styled figure is dear to repaint (procedural chalk
// and paper grain, hundreds of hatch strokes). Repainting while the view moved
// is what made it lag, and what left blank bars where the repaint had not
// caught up. Here a frame only places painted tiles; painting happens between,
// a few tiles at a time, and a hole is covered by another level's tiles, or at
// worst the overview, so the drawing is never missing.
//
// Two ways to paint, chosen by the figure:
// - a styled figure (every mark scales with the view) is decoded ONCE as one
//   image of the whole drawing, and each tile is a crop of it, drawn at the
//   tile's resolution (Chrome draws an svg image as vectors at the size it is
//   drawn, so a crop is as sharp as a fresh render);
// - a clean figure keeps its strokes a fixed width on screen
//   (`vector-effect: non-scaling-stroke`), which in an image is relative to
//   the image's own size, so each tile is its own small image, sized in CSS
//   pixels. Clean figures are light, so the extra parse is cheap.

// How many painted tiles are kept (each TILE_PX², 4 bytes a pixel: 1 MiB).
export const TILE_BUDGET = 160
// The view counts as at rest this long after it last moved; then the tiles
// around it are painted ahead of need.
export const REST_MS = 120
// The overviews: the stand-ins of last resort, each one image of at most this
// many device pixels a side. One of the whole paintable plane (for a view
// zoomed far out), one of the content and half again around it (sharper).
export const OVERVIEW_PX = 2048

const NON_SCALING = '[data-layer] * { vector-effect: non-scaling-stroke }'

interface Painted {
  bitmap: ImageBitmap
  rect: Rect
}

async function decode(markup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // The decoded image keeps what it needs.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export class SvgTiles {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly scratch = new OffscreenCanvas(TILE_PX, TILE_PX)
  private readonly cache = new TileCache<Painted>(TILE_BUDGET, (p) => p.bitmap.close())
  private readonly clean: boolean
  // Styled: the whole drawing as one image, `extent` at one CSS px per unit.
  private whole: HTMLImageElement | null = null
  private overviews: Painted[] = []
  private view: { visible: Rect; screen: Size } | null = null
  private dpr = globalThis.devicePixelRatio || 1
  private lastMove = 0
  private raf = 0
  private painting = false
  private disposed = false
  private onScreen: ReadonlySet<string> = new Set()

  // `content`: the drawing's own frame. `extent`: the part of its plane worth
  // painting at all (beyond it the tiles are left empty), at least `content`.
  private readonly svg: string
  private readonly content: Rect
  private readonly extent: Rect
  constructor(svg: string, content: Rect, extent: Rect) {
    this.svg = svg
    this.content = content
    this.extent = extent
    this.clean = !/^<svg\b[^>]*\sdata-style="/.test(svg)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'view2d-tiles'
    this.ctx = this.canvas.getContext('2d')!
    void this.start()
  }

  private async start(): Promise<void> {
    if (!this.clean) {
      const markup = svgWindow(this.svg, this.extent, this.extent.width, this.extent.height)
      if (!markup) return
      this.whole = await decode(markup)
      if (this.disposed) return
    }
    await this.paintOverviews()
    this.draw()
    this.kick()
  }

  // The view: draw it now from what is painted, and paint what it lacks.
  setView(visible: Rect, screen: Size): void {
    if (this.disposed) return
    const dpr = globalThis.devicePixelRatio || 1
    if (dpr !== this.dpr) {
      // Painted for another pixel density: start over (the overview too).
      this.dpr = dpr
      this.cache.clear()
      if (this.overviews.length > 0) {
        this.overviews.forEach((o) => o.bitmap.close())
        this.overviews = []
        void this.paintOverviews().then(() => this.draw())
      }
    }
    const was = this.view
    if (!was || was.visible.x !== visible.x || was.visible.y !== visible.y || was.visible.width !== visible.width || was.visible.height !== visible.height) {
      this.lastMove = performance.now()
    }
    this.view = { visible, screen }
    this.draw()
    this.kick()
  }

  dispose(): void {
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.cache.clear()
    this.overviews.forEach((o) => o.bitmap.close())
    this.overviews = []
    this.canvas.remove()
  }

  private level(): number {
    const v = this.view!
    return levelFor((v.screen.width * this.dpr) / v.visible.width)
  }

  private has = (k: TileKey): boolean => this.cache.has(tileId(k))

  // ---------------------------------------------------------------------------
  // Drawing a frame
  // ---------------------------------------------------------------------------

  private draw(): void {
    const v = this.view
    if (!v || this.disposed) return
    const w = Math.max(1, Math.round(v.screen.width * this.dpr))
    const h = Math.max(1, Math.round(v.screen.height * this.dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // Bilinear: a tile is drawn at most √2 smaller than it was painted, and a
    // stand-in only for a moment; 'high' costs the GPU a filter pass per draw.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'low'
    const kx = w / v.visible.width
    const ky = h / v.visible.height
    // Edges are rounded the same way for every tile, so neighbours meet
    // without a hairline between them.
    const place = (p: Painted) => {
      const x0 = Math.round((p.rect.x - v.visible.x) * kx)
      const y0 = Math.round((p.rect.y - v.visible.y) * ky)
      const x1 = Math.round((p.rect.x + p.rect.width - v.visible.x) * kx)
      const y1 = Math.round((p.rect.y + p.rect.height - v.visible.y) * ky)
      if (x1 <= 0 || y1 <= 0 || x0 >= w || y0 >= h) return
      ctx.drawImage(p.bitmap, x0, y0, x1 - x0, y1 - y0)
    }
    const level = this.level()
    const list = drawList(v.visible, level, this.has)
    // The overviews only under holes: when the level's own tiles cover the
    // screen, nothing shows through. The far one only past the near one.
    const whole = list.length === tilesCovering(v.visible, level).length && list.every((k) => k.level === level)
    if (!whole) {
      const [far, near] = this.overviews
      if (far && (!near || !coversRect(near.rect, v.visible))) place(far)
      if (near) place(near)
    }
    for (const k of list) {
      const p = this.cache.get(tileId(k))
      if (p) place(p)
    }
    this.onScreen = new Set(list.map(tileId))
  }

  // ---------------------------------------------------------------------------
  // Painting tiles
  // ---------------------------------------------------------------------------

  private kick(): void {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.tick)
  }

  // Frame intervals, for pacing (see ../tiles.ts mayPaint).
  private lastTick = 0
  private lastFrameMs = Infinity
  private recentFrames: number[] = []

  private readonly tick = (now: number): void => {
    this.raf = 0
    if (this.lastTick > 0) {
      this.lastFrameMs = now - this.lastTick
      this.recentFrames.push(this.lastFrameMs)
      if (this.recentFrames.length > 60) this.recentFrames.shift()
    }
    this.lastTick = now
    void this.paintSome()
  }

  private async paintSome(): Promise<void> {
    const v = this.view
    if (!v || this.painting || this.disposed || (!this.clean && !this.whole)) return
    const atRest = performance.now() - this.lastMove >= REST_MS
    if (!atRest) {
      // Nothing is painted while the view moves; wait for it to settle.
      this.kick()
      return
    }
    const want = wantList(v.visible, this.level(), this.has, true)
    if (want.length === 0) {
      // Nothing to paint: the loop stops, and its frame clock with it.
      this.lastTick = 0
      this.lastFrameMs = Infinity
      return
    }
    if (!mayPaint({ lastFrameMs: this.lastFrameMs, quickestFrameMs: Math.min(...this.recentFrames) })) {
      this.kick()
      return
    }
    this.painting = true
    try {
      const k = want[0]
      const painted = await this.paint(tileRect(k), TILE_PX, TILE_PX)
      if (this.disposed) return
      if (painted) {
        this.cache.set(tileId(k), painted, this.onScreen)
        this.draw()
      }
    } finally {
      this.painting = false
    }
    this.kick()
  }

  private async paintOverviews(): Promise<void> {
    const c = this.content
    const near: Rect = { x: c.x - c.width / 2, y: c.y - c.height / 2, width: c.width * 2, height: c.height * 2 }
    for (const r of [this.extent, near]) {
      const scale = OVERVIEW_PX / Math.max(r.width, r.height)
      const painted = await this.paint(r, Math.max(1, Math.round(r.width * scale)), Math.max(1, Math.round(r.height * scale)))
      if (this.disposed) return
      if (painted) this.overviews.push(painted)
    }
  }

  // One window of the drawing, painted at `pw` × `ph` device pixels.
  private async paint(rect: Rect, pw: number, ph: number): Promise<Painted | null> {
    const canvas = pw === TILE_PX && ph === TILE_PX ? this.scratch : new OffscreenCanvas(pw, ph)
    const g = canvas.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, pw, ph)
    if (this.clean) {
      const markup = svgWindow(this.svg, rect, pw / this.dpr, ph / this.dpr, NON_SCALING)
      if (!markup) return null
      const img = await decode(markup)
      if (this.disposed) return null
      g.drawImage(img, 0, 0, pw, ph)
    } else {
      const img = this.whole
      if (!img) return null
      const e = this.extent
      // The crop of the whole image that is `rect` (one image pixel per unit),
      // clipped to the image: the part of the tile outside it stays empty.
      const sx0 = Math.max(0, rect.x - e.x)
      const sy0 = Math.max(0, rect.y - e.y)
      const sx1 = Math.min(e.width, rect.x + rect.width - e.x)
      const sy1 = Math.min(e.height, rect.y + rect.height - e.y)
      if (sx1 <= sx0 || sy1 <= sy0) return { bitmap: canvas.transferToImageBitmap(), rect }
      const kx = pw / rect.width
      const ky = ph / rect.height
      g.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 + e.x - rect.x) * kx, (sy0 + e.y - rect.y) * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky)
    }
    return { bitmap: canvas.transferToImageBitmap(), rect }
  }
}
