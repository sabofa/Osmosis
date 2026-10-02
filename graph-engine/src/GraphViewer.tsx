import { useEffect, useRef, useState } from 'react'
import { parseSpec } from './parser/parseSpec'
import { defaultConfig, type GraphConfig } from './parser/config'
import { buildScene } from './scene/buildScene'
import { buildTable, type NamedTableData } from './scene/buildTable'
import { formatCoord } from './scene/format'
import { isThreeD, resolvePanels } from './scene/mode'
import { renderFigure } from './figure/render'
import { SceneRenderer, type HoverInfo } from './render/SceneRenderer'
import { SpaceRenderer } from './space/SpaceRenderer'
import { canvasKey, releaseRenderer } from './viewerCanvas'
import { resolvePalette } from './render/palette'
import type { Regression } from './scene/types'
import type { ParseError, ParseResult } from './parser/types'
import TableView from './TableView'
import FigureView from './FigureView'
import './GraphViewer.css'

export interface GraphViewerProps {
  spec: string
  onErrors?: (errors: ParseError[]) => void
  // Overrides whatever "@theme:" directive (or the default) the spec text
  // resolves to. Lets a host app force light/dark to match its own theme
  // state without having to rewrite the spec string. Falls back to the
  // spec-parsed theme when omitted, so existing callers are unaffected.
  theme?: 'light' | 'dark'
}

type Mode = '2d' | '3d'
// The 2D plot renderer (three.js) or space (track 3's hand-made WebGL2
// renderer, which draws every 3D spec).
type Renderer = SceneRenderer | SpaceRenderer

// Collapses a burst of spec changes (fast typing, a paste, a streamed LLM
// write) into one rebuild instead of one per keystroke — the rebuild itself
// is real work (re-sampling every curve/region in the spec). Pan/zoom
// rebuilds are a separate, already-throttled path inside SceneRenderer
// itself and aren't affected by this.
const REBUILD_DEBOUNCE_MS = 80
// Reduced marching-squares resolution used for regions/implicit curves while
// actively dragging — see buildScene's `resolution` param. Region fill
// triangle count scales with the square of this, so it's kept noticeably
// lower than the settled resolution rather than just halved.
const DRAG_RESOLUTION = 45

// The reusable, app-agnostic entry point: text spec in, live-rendered scene
// out. No dependency on anything outside this package. Switches between a 2D
// pan/zoom view, the space view (see scene/mode.ts), and a plain HTML table
// (via "@mode: table") based on what the spec contains, swapping the
// underlying renderer as needed.
export default function GraphViewer({ spec, onErrors, theme }: GraphViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const modeRef = useRef<Mode | null>(null)
  const rebuildRef = useRef<() => void>(() => {})
  const applyParsedRef = useRef<((parsed: ParseResult, reportState: boolean) => void) | null>(null)
  // A pan/zoom frame doesn't need the spec re-parsed — the text hasn't
  // changed, only the camera bounds have — so the last parse result is
  // cached here and reused by the view-change path below. Re-parsing on
  // every drag frame (and, worse, pushing the resulting parse/regression/
  // error state up through React on every frame even when none of it
  // actually changed) was real, avoidable cost sitting on top of the
  // rendering work itself.
  const parsedRef = useRef<ParseResult | null>(null)
  const viewChangeRef = useRef<() => void>(() => {})
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const themeRef = useRef(theme)
  themeRef.current = theme

  const [config, setConfig] = useState<GraphConfig>(defaultConfig())
  // Whether a table panel is showing, and whether the drawable panel is. A
  // spec can put up both (F5): "@mode" decides which renderer draws the
  // drawing, and a table is additive rather than exclusive.
  const [tableMode, setTableMode] = useState(false)
  const [drawing, setDrawing] = useState(true)
  const [tables, setTables] = useState<NamedTableData[]>([])
  // The rendered figure's markup, or null when this spec is not a figure.
  // Mirrors `tables` above exactly: a mode that owns the view holds its own
  // built content, and the canvas renderer is disposed while it does.
  const [figure, setFigure] = useState<string | null>(null)
  const [regression, setRegression] = useState<Regression | null>(null)
  // 2D hover only: space's probe and readout arrive in S3.
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [contextLost, setContextLost] = useState(false)
  // Which context type the mounted <canvas> is for. A canvas is permanently
  // bound to the first context it hands out ('2d' for the pan/zoom view,
  // 'webgl' for the orbit view), so switching modes on the same element makes
  // the second getContext() return null — three.js then dies on a null
  // context. The canvas is keyed by this, so a mode switch remounts a fresh
  // element and the rebuild finishes from the effect on it below.
  const [canvasMode, setCanvasMode] = useState<Mode>('2d')
  const canvasModeRef = useRef<Mode>('2d')
  canvasModeRef.current = canvasMode
  // Every renderer releases its context when disposed, and a released canvas
  // can never be drawn on again: each release bumps this generation, which is
  // part of the canvas's key, so the next renderer always gets a fresh
  // element (viewerCanvas.ts). Reusing the spent canvas is what crashed
  // 2D -> figure -> 2D ("reading 'precision'").
  const [canvasGeneration, setCanvasGeneration] = useState(0)
  // Set when a rebuild stopped to wait for a fresh canvas; the effect on the
  // canvas's key finishes it once the new element has mounted.
  const awaitingCanvasRef = useRef(false)

  useEffect(() => {
    // Shared by both the full (text-driven) rebuild and the lighter
    // view-change-only rebuild. `reportState` is false for the latter: pan/
    // zoom doesn't change the config, table data, regression stats, or error
    // list, so skipping those setState calls avoids forcing a React
    // re-render (of this component and, via onErrors, the parent) on every
    // single drag frame.
    // Fully dispose the renderer (releasing its WebGL context), and retire its
    // canvas if it had one.
    function release() {
      if (releaseRenderer(rendererRef)) setCanvasGeneration((g) => g + 1)
      modeRef.current = null
      setHover(null)
    }

    function applyParsed(parsed: ParseResult, reportState: boolean) {
      if (reportState) setConfig(parsed.config)

      // What this spec puts on screen: which renderer draws its drawable
      // content, and whether a table sits beside it (see scene/mode.ts).
      const panels = resolvePanels(parsed.statements, parsed.config)

      if (reportState) {
        setTableMode(panels.table)
        setDrawing(panels.drawable !== null)
        setTables(panels.table ? buildTable(parsed.statements, parsed.config) : [])
      }

      if (panels.drawable === null) {
        if (reportState) {
          release()
          setFigure(null)
          onErrorsRef.current?.(parsed.errors)
        }
        return
      }

      // A figure is its own renderer, selected the way table already is: the
      // canvas renderer (2D or space) is disposed entirely rather than left alive behind
      // a hidden canvas. Missing this leaks a WebGL context on every mode
      // change, which is why it follows the table branch above line for line.
      if (panels.drawable === 'figure') {
        if (reportState) {
          release()
          const palette = resolvePalette(parsed.config.theme, containerRef.current)
          const built = renderFigure(parsed.statements, parsed.config, palette)
          setFigure(built.svg)
          onErrorsRef.current?.([...parsed.errors, ...built.errors])
        }
        return
      }

      if (reportState) setFigure(null)

      const canvas = canvasRef.current
      if (!canvas) return

      const mode: Mode = isThreeD(parsed.statements) ? '3d' : '2d'

      if (canvasModeRef.current !== mode) {
        release()
        awaitingCanvasRef.current = true
        if (reportState) setCanvasMode(mode)
        return
      }

      // Colours come from the host's design tokens when it defines them (read
      // off this component's own container, so inline overrides on <html>
      // and media-query flips both count), else the built-in palette.
      const palette = resolvePalette(parsed.config.theme, containerRef.current)

      if (modeRef.current !== mode) {
        // A renderer still on this canvas has spent it: release it and wait
        // for the fresh element.
        if (rendererRef.current) {
          release()
          awaitingCanvasRef.current = true
          return
        }
        setHover(null)
        const onContextLost = () => setContextLost(true)
        const onContextRestored = () => setContextLost(false)
        rendererRef.current =
          mode === '3d'
            ? new SpaceRenderer(canvas, { palette, theme: parsed.config.theme, onContextLost, onContextRestored })
            : new SceneRenderer(canvas, {
                config: parsed.config,
                onViewChange: () => viewChangeRef.current(),
                onHover: setHover,
                onContextLost,
                palette,
              })
        modeRef.current = mode
      } else if (reportState) {
        const current = rendererRef.current
        if (current instanceof SpaceRenderer) current.setPalette(palette, parsed.config.theme)
        else current?.setConfig(parsed.config, palette)
      }

      const renderer = rendererRef.current
      if (!renderer) return

      if (mode === '3d') {
        // Space builds its own scene from the statements (the kernel), keeps
        // the viewer's camera across rebuilds, and returns its errors by line.
        // The spec text titles its readouts and lets a pin survive a rebuild
        // whose line for it reads the same (a theme flip, an edit elsewhere).
        const errors = (renderer as SpaceRenderer).setSpec(parsed.statements, parsed.config, parsed.statementLines, spec)
        if (reportState) {
          setRegression(null)
          onErrorsRef.current?.([...parsed.errors, ...errors])
        }
      } else {
        const renderer2d = renderer as SceneRenderer
        const resolution = renderer2d.isDragging() ? DRAG_RESOLUTION : undefined
        const scene = buildScene(parsed.statements, renderer2d.getBounds(), parsed.config, resolution)
        renderer2d.setGraphScene(scene)
        if (reportState) {
          setRegression(scene.regression)
          onErrorsRef.current?.([...parsed.errors, ...scene.errors])
        }
      }
    }

    applyParsedRef.current = applyParsed
    rebuildRef.current = () => {
      setContextLost(false)
      const parsed = parseSpec(spec)
      // The `theme` prop, when given, takes priority over whatever the spec
      // text itself resolved to (its own "@theme:" directive or the
      // default) — override before anything downstream (renderer palette
      // selection, TableView, the wrapper className) reads config.theme.
      if (themeRef.current) parsed.config = { ...parsed.config, theme: themeRef.current }
      parsedRef.current = parsed
      applyParsed(parsed, true)
    }
    viewChangeRef.current = () => {
      if (parsedRef.current) applyParsed(parsedRef.current, false)
    }

    const timeout = setTimeout(() => rebuildRef.current(), REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [spec, theme])

  // The host can change its design tokens without touching this component's
  // props: a theme preset is applied as inline custom properties on <html>,
  // light/dark flips its data-theme attribute, and "system" mode follows a
  // media query. Any of those means the palette must be re-read and the
  // scene rebuilt with the new colours.
  useEffect(() => {
    const rebuild = () => {
      if (parsedRef.current) rebuildRef.current()
    }
    const observer = new MutationObserver(rebuild)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] })
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', rebuild)
    return () => {
      observer.disconnect()
      mql.removeEventListener('change', rebuild)
    }
  }, [])

  // Second half of a mode switch or a release: the keyed canvas has just
  // remounted, so the cached parse can now be applied to the fresh element.
  useEffect(() => {
    if (!parsedRef.current || !awaitingCanvasRef.current) return
    awaitingCanvasRef.current = false
    applyParsedRef.current?.(parsedRef.current, true)
  }, [canvasMode, canvasGeneration])

  useEffect(
    () => () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
      modeRef.current = null
    },
    []
  )

  // The canvas stays mounted (just hidden) even in table mode, rather than
  // being conditionally rendered — unmounting it would null out canvasRef
  // for a render pass, and the rebuild effect above runs synchronously with
  // the spec change, before React would get a chance to remount it.
  // Side by side when a spec puts up both, and stacked once the view is too
  // narrow to give each panel a readable width — a figure squeezed into half
  // of a phone screen is not a figure. The split is CSS (see
  // GraphViewer.css); everything here decides is which panels exist.
  const split = drawing && tableMode

  return (
    <div ref={containerRef} className={`graph-viewer graph-viewer-${config.theme}${split ? ' graph-viewer-split' : ''}`}>
      <div className="graph-viewer-panel graph-viewer-panel-drawing" style={drawing ? undefined : { display: 'none' }}>
        <canvas
          key={canvasKey(canvasMode, canvasGeneration)}
          ref={canvasRef}
          className="graph-viewer-canvas"
          style={figure !== null ? { display: 'none' } : undefined}
        />
        {contextLost && (
          <div className="graph-viewer-context-lost">
            Graph couldn't render — your browser dropped its WebGL context (usually from too many
            graphics-heavy tabs/panels open at once). Try closing some tabs or restarting your
            browser, then reopen this question.
          </div>
        )}
        {figure !== null && <FigureView svg={figure} theme={config.theme} />}
        {figure === null && regression && (
          <div className="graph-viewer-stats">
            <div>y = {formatCoord(regression.slope)}x + {formatCoord(regression.intercept)}</div>
            <div>r = {formatCoord(regression.r)}</div>
          </div>
        )}
        {figure === null && hover && (
          <div className="graph-viewer-hover-label" style={{ left: hover.screenX, top: hover.screenY }}>
            {hover.label ? `${hover.label}: ` : ''}(
            {formatCoord(hover.worldX)}, {formatCoord(hover.worldY)})
          </div>
        )}
      </div>
      {tableMode && (
        <div className="graph-viewer-panel graph-viewer-panel-table">
          <TableView tables={tables} theme={config.theme} showFormulas={config.tableFormulas} />
        </div>
      )}
    </div>
  )
}
