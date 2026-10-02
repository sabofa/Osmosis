import { useEffect, useRef, useState } from 'react'
import { cameraMatrices } from '../../graph-engine/src/space/camera/projection'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import type { PaintDebugMode } from '../../graph-engine/src/space/paint/types'
import { buildPaintView, prepareFigure } from './paintLabCamera'
import { hexToOklab, makeSceneColours, oklabToHex, type Theme } from './paintLabColours'
import { createPaintEngine, type PaintEngine } from './paintLabEngine'
import { figureById, PAINT_FIGURES } from './paintLabFigures'
import { showcaseKey, showcaseLayout, TileQueue, type ShowcaseLayout } from './paintLabShowcase'

const FIGURE_IDS = PAINT_FIGURES.map((f) => f.id)

export interface ShowcaseProps {
  active: boolean
  params: PaintParams
  debug: PaintDebugMode
  theme: Theme
  localHex: string | null
  compare: boolean
  onCompare: () => void
  onOpen: (id: string) => void
  onProgress: (p: { done: number; total: number }) => void
}

// A grid of every figure, each at its own authored camera and painted with the
// params the Tune tab edits. It has ONE engine and canvas for all the tiles (a
// browser caps WebGL contexts): for each tile in turn, one per animation frame,
// the scene is set, the engine paints at the tile's size, and the picture is
// copied into the tile's 2D canvas in the same task (engine.renderTo). Tiles
// are cached: a tile is painted again only when the params, the debug view, the
// theme, a local colour or the tile's size change (paintLabShowcase.ts).
export function Showcase(props: ShowcaseProps) {
  const { active } = props
  const gridRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<PaintEngine | null>(null)
  const tiles = useRef(new Map<string, HTMLCanvasElement>())
  const [queue] = useState(() => new TileQueue(FIGURE_IDS))
  const [layout, setLayout] = useState<ShowcaseLayout>(() => showcaseLayout(1200))
  const [, setPainted] = useState(0)
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null)
  const live = useRef(props)
  live.current = props
  const dpr = window.devicePixelRatio || 1
  const tileW = layout.tileWidth
  const tileH = layout.tileHeight
  const pxW = Math.max(1, Math.round(tileW * dpr))
  const pxH = Math.max(1, Math.round(tileH * dpr))

  // The grid's width sets the columns and the tile size.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = (width: number) => {
      if (width <= 0) return
      setLayout((l) => {
        const next = showcaseLayout(width)
        return next.columns === l.columns && next.tileWidth === l.tileWidth && next.tileHeight === l.tileHeight ? l : next
      })
    }
    const resizer = new ResizeObserver((entries) => measure(entries[0].contentRect.width))
    resizer.observe(grid)
    measure(grid.clientWidth)
    return () => resizer.disconnect()
  }, [])

  // The one engine, on its own canvas, parked off screen.
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const canvas = document.createElement('canvas')
    holder.appendChild(canvas)
    let engine: PaintEngine | null = null
    try {
      engine = createPaintEngine(canvas)
    } catch (error) {
      setMessage({ title: 'The painter cannot start', text: error instanceof Error ? error.message : String(error) })
    }
    engineRef.current = engine
    return () => {
      engine?.dispose()
      engineRef.current = null
      canvas.remove()
    }
  }, [])

  const key = active
    ? showcaseKey({ params: props.params, debug: props.debug, theme: props.theme, localHex: props.localHex, tile: { width: pxW, height: pxH }, pixelRatio: dpr })
    : ''

  // Paint the stale tiles, one per animation frame, while the Showcase is showing.
  useEffect(() => {
    if (!active) return
    queue.setKey(key)
    live.current.onProgress(queue.progress())
    setPainted((n) => n + 1)
    let frame = 0
    const step = () => {
      frame = 0
      const engine = engineRef.current
      const id = queue.next()
      if (!engine || id === null) return
      try {
        const target = tiles.current.get(id)?.getContext('2d')
        if (!target) return
        const p = live.current
        const { built, worldScene } = prepareFigure(figureById(id)!)
        const camera = cameraMatrices(built.authored, built.world, { width: tileW, height: tileH }, built.projection)
        const view = buildPaintView(camera, p.params.light, dpr, false)
        engine.setScene(worldScene, makeSceneColours(built.scene, p.theme, p.localHex ? hexToOklab(p.localHex) : null))
        engine.renderTo(target, view, p.params, p.debug)
        queue.done(id, key)
        setMessage(null)
      } catch (error) {
        // Stop here: the next change of params or size tries again.
        setMessage({ title: 'The painter hit an error', text: error instanceof Error ? error.message : String(error) })
        return
      }
      live.current.onProgress(queue.progress())
      setPainted((n) => n + 1)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // The key already holds the params, the debug view, the theme, the local colour and the tile size.
  }, [active, key, queue, tileW, tileH, dpr])

  const tone = oklabToHex(props.params.canvas.tone)
  return (
    <main className="pl-showcase" id="pl-view-showcase" role="tabpanel" aria-labelledby="pl-tab-showcase" hidden={!active}>
      <div className="pl-showcase-head">
        <p>{props.compare ? 'Showing the saved defaults (B).' : 'Every figure, painted with the current tune.'} Click one to tune it.</p>
        <button type="button" className={`pl-mini${props.compare ? ' is-on' : ''}`} aria-pressed={props.compare} onClick={props.onCompare} title="Flip between your tune (A) and the saved defaults (B)">
          A/B
        </button>
      </div>
      <div className="pl-showcase-grid" ref={gridRef} style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gap: layout.gap }}>
        {PAINT_FIGURES.map((f) => (
          <button key={f.id} type="button" className={`pl-tile${queue.isFresh(f.id) ? '' : ' is-stale'}`} style={{ background: tone }} onClick={() => props.onOpen(f.id)} aria-label={`Open ${f.label} in Tune`}>
            <canvas
              width={pxW}
              height={pxH}
              ref={(el) => {
                if (el) tiles.current.set(f.id, el)
                else tiles.current.delete(f.id)
              }}
            />
            <span className="pl-tile-name">{f.label}</span>
            <span className="pl-tile-open" aria-hidden="true">
              {queue.isFresh(f.id) ? 'Open in Tune ›' : 'painting…'}
            </span>
          </button>
        ))}
      </div>
      {message && (
        <div className="pl-message" role="alert">
          <h2>{message.title}</h2>
          <p>{message.text}</p>
        </div>
      )}
      <div className="pl-offscreen" ref={holderRef} aria-hidden="true" />
    </main>
  )
}
