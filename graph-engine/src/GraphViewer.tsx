import { useEffect, useRef, useState } from 'react'
import { parseSpec } from './parser/parseSpec'
import { defaultConfig, type GraphConfig } from './parser/config'
import { buildScene } from './scene/buildScene'
import { buildScene3d } from './scene/buildScene3d'
import { buildTable, type NamedTableData } from './scene/buildTable'
import { formatCoord } from './scene/format'
import { isThreeD } from './scene/mode'
import { SceneRenderer, type HoverInfo } from './render/SceneRenderer'
import { SceneRenderer3D, type HoverInfo3D } from './render/SceneRenderer3D'
import type { Regression } from './scene/types'
import type { ParseError, ParseResult } from './parser/types'
import TableView from './TableView'
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
type Renderer = SceneRenderer | SceneRenderer3D

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
// pan/zoom view, a 3D orbit view (see scene/mode.ts), and a plain HTML table
// (via "@mode: table") based on what the spec contains, swapping the
// underlying renderer as needed.
export default function GraphViewer({ spec, onErrors, theme }: GraphViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const modeRef = useRef<Mode | null>(null)
  const rebuildRef = useRef<() => void>(() => {})
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
  const [tableMode, setTableMode] = useState(false)
  const [tables, setTables] = useState<NamedTableData[]>([])
  const [regression, setRegression] = useState<Regression | null>(null)
  const [hover, setHover] = useState<HoverInfo | HoverInfo3D | null>(null)
  const [contextLost, setContextLost] = useState(false)

  useEffect(() => {
    // Shared by both the full (text-driven) rebuild and the lighter
    // view-change-only rebuild. `reportState` is false for the latter: pan/
    // zoom doesn't change the config, table data, regression stats, or error
    // list, so skipping those setState calls avoids forcing a React
    // re-render (of this component and, via onErrors, the parent) on every
    // single drag frame.
    function applyParsed(parsed: ParseResult, reportState: boolean) {
      if (reportState) setConfig(parsed.config)

      if (parsed.config.mode === 'table') {
        if (reportState) {
          rendererRef.current?.dispose()
          rendererRef.current = null
          modeRef.current = null
          setHover(null)
          setTableMode(true)
          setTables(buildTable(parsed.statements, parsed.config))
          onErrorsRef.current?.(parsed.errors)
        }
        return
      }
      if (reportState) setTableMode(false)

      const canvas = canvasRef.current
      if (!canvas) return

      const mode: Mode = isThreeD(parsed.statements) ? '3d' : '2d'

      if (modeRef.current !== mode) {
        rendererRef.current?.dispose()
        setHover(null)
        const onContextLost = () => setContextLost(true)
        rendererRef.current =
          mode === '3d'
            ? new SceneRenderer3D(canvas, parsed.config, { onHover: setHover, onContextLost })
            : new SceneRenderer(canvas, {
                config: parsed.config,
                onViewChange: () => viewChangeRef.current(),
                onHover: setHover,
                onContextLost,
              })
        modeRef.current = mode
      } else if (reportState) {
        rendererRef.current?.setConfig(parsed.config)
      }

      const renderer = rendererRef.current
      if (!renderer) return

      if (mode === '3d') {
        const scene = buildScene3d(parsed.statements, parsed.config)
        ;(renderer as SceneRenderer3D).setGraphScene(scene)
        if (reportState) {
          setRegression(null)
          onErrorsRef.current?.([...parsed.errors, ...scene.errors])
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
  }, [spec])

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
  return (
    <div className={`graph-viewer graph-viewer-${config.theme}`}>
      <canvas ref={canvasRef} className="graph-viewer-canvas" style={tableMode ? { display: 'none' } : undefined} />
      {contextLost && (
        <div className="graph-viewer-context-lost">
          Graph couldn't render — your browser dropped its WebGL context (usually from too many
          graphics-heavy tabs/panels open at once). Try closing some tabs or restarting your
          browser, then reopen this question.
        </div>
      )}
      {tableMode && <TableView tables={tables} theme={config.theme} showFormulas={config.tableFormulas} />}
      {!tableMode && regression && (
        <div className="graph-viewer-stats">
          <div>y = {formatCoord(regression.slope)}x + {formatCoord(regression.intercept)}</div>
          <div>r = {formatCoord(regression.r)}</div>
        </div>
      )}
      {!tableMode && hover && (
        <div className="graph-viewer-hover-label" style={{ left: hover.screenX, top: hover.screenY }}>
          {hover.label ? `${hover.label}: ` : ''}(
          {formatCoord(hover.worldX)}, {formatCoord(hover.worldY)}
          {'worldZ' in hover ? `, ${formatCoord(hover.worldZ)}` : ''})
        </div>
      )}
    </div>
  )
}
