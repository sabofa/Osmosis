import { useCallback, useEffect, useRef, useState } from 'react'
import { easeStep, ORBIT_DEG_PER_PX, orbit, pan, reset, sanitizeView, startEase, WHEEL_STEP, zoomAt, type Easing } from '../../graph-engine/src/space/camera/controls'
import { cameraMatrices } from '../../graph-engine/src/space/camera/projection'
import type { SpaceView } from '../../graph-engine/src/space/config'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import type { PaintDebugMode, SceneColours } from '../../graph-engine/src/space/paint/types'
import type { SpaceScene } from '../../graph-engine/src/space/scene/types'
import { buildPaintView, type BuiltFigure } from './paintLabCamera'
import { createPaintEngine, type PaintEngine } from './paintLabEngine'
import { FpsMeter } from './paintLabMeter'
import { URL_STATE, type InjectedState } from './paintLabState'

// The Tune view: one painted figure on one canvas, with the turntable camera
// (drag orbits, right- or shift-drag pans, the wheel zooms about the cursor,
// double-click or 0 resets, the arrows orbit, + and - zoom), the frame loop
// (any change draws on the next animation frame), and the engine's errors
// shown in the view and never thrown.

export interface Readout {
  fps: number
  ms: number
  strokes: number
  view: SpaceView
}

export interface StageProps {
  built: BuiltFigure
  worldScene: SpaceScene
  colours: SceneColours
  params: PaintParams
  debug: PaintDebugMode
  caption: { label: string; text: string }
  banner: string | null
  injected: InjectedState
  onReadout: (r: Readout) => void
}

const READOUT_MS = 250

export function Stage(props: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<PaintEngine | null>(null)
  const viewRef = useRef<SpaceView>(props.built.authored)
  const easingRef = useRef<Easing | null>(null)
  const draggingRef = useRef(false)
  const frameRef = useRef(0)
  const meterRef = useRef(new FpsMeter())
  const readoutTimer = useRef(0)
  const pendingReadout = useRef<Readout | null>(null)
  const builtRef = useRef<BuiltFigure | null>(null)
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null)
  // Everything a frame reads, kept current so the frame loop never goes stale.
  const live = useRef(props)
  live.current = props

  const flushReadout = useCallback(() => {
    readoutTimer.current = 0
    if (pendingReadout.current) live.current.onReadout(pendingReadout.current)
    pendingReadout.current = null
  }, [])

  // The frame loop: request() asks for one frame on the next animation frame
  // (any number of requests before it coalesce into one), and draw() paints it
  // from the live props and the camera.
  const drawRef = useRef<() => void>(() => {})
  const request = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      drawRef.current()
    })
  }, [])

  drawRef.current = () => {
    const engine = engineRef.current
    const host = hostRef.current
    const canvas = canvasRef.current
    // A hidden view (the Showcase tab is up) paints nothing; showing it again
    // resizes the host, which asks for a frame.
    if (!engine || !host || !canvas || host.clientWidth === 0) return
    const p = live.current
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    const dpr = window.devicePixelRatio || 1
    const bw = Math.max(1, Math.round(width * dpr))
    const bh = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    let again = false
    const ease = easingRef.current
    if (ease) {
      const eased = easeStep(ease, performance.now())
      if (eased) {
        viewRef.current = eased
        again = true
      } else {
        viewRef.current = ease.to
        easingRef.current = null
      }
    }
    const camera = cameraMatrices(viewRef.current, p.built.world, { width, height }, p.built.projection)
    const view = buildPaintView(camera, p.params.light, dpr, draggingRef.current)
    try {
      if (p.injected === 'engine-error') throw new Error('Injected engine failure (?state=engine-error).')
      const result = engine.render(view, p.params, p.debug)
      const fps = meterRef.current.tick(performance.now(), result.ms)
      pendingReadout.current = { fps, ms: result.ms, strokes: result.strokes, view: viewRef.current }
      if (!readoutTimer.current) readoutTimer.current = window.setTimeout(flushReadout, READOUT_MS)
      setMessage(null)
    } catch (error) {
      setMessage({ title: 'The painter hit an error', text: error instanceof Error ? error.message : String(error) })
    }
    if (again) request()
  }

  // The canvas, the engine and the pointer, wheel and key input. The canvas is
  // made here, not rendered by React: dispose() releases the engine's context,
  // and a released canvas cannot be drawn on again, so each engine (StrictMode
  // mounts twice in development) gets its own element.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', 'Painted figure')
    host.appendChild(canvas)
    canvasRef.current = canvas
    let engine: PaintEngine | null = null
    try {
      engine = createPaintEngine(canvas)
    } catch (error) {
      setMessage({ title: 'The painter cannot start', text: error instanceof Error ? error.message : String(error) })
    }
    engineRef.current = engine

    const viewport = () => ({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) })
    const local = (e: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const apply = (next: SpaceView) => {
      viewRef.current = next
      easingRef.current = null
      request()
    }
    const resetView = () => {
      const target = sanitizeView(reset(live.current.built.authored), live.current.built.authored)
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        apply(target)
      } else {
        easingRef.current = startEase(viewRef.current, target, performance.now())
        request()
      }
    }

    let drag: { id: number; x: number; y: number; mode: 'orbit' | 'pan' } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      host.focus({ preventScroll: true })
      host.setPointerCapture(e.pointerId)
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit' }
      draggingRef.current = true
      easingRef.current = null
      host.classList.add('is-dragging')
      request()
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      const { built } = live.current
      viewRef.current = drag.mode === 'orbit' ? orbit(viewRef.current, dx, dy) : pan(viewRef.current, dx, dy, viewport(), built.world, built.projection)
      request()
    }
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      drag = null
      draggingRef.current = false
      host.classList.remove('is-dragging')
      request()
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100
      const { built } = live.current
      const at = local(e)
      apply(zoomAt(viewRef.current, WHEEL_STEP ** -notches, at.x, at.y, viewport(), built.world, built.projection))
    }
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const { built } = live.current
      const step = 5 / ORBIT_DEG_PER_PX
      const vp = viewport()
      let next: SpaceView | null = null
      switch (e.key) {
        case 'ArrowRight': next = orbit(viewRef.current, step, 0); break
        case 'ArrowLeft': next = orbit(viewRef.current, -step, 0); break
        case 'ArrowDown': next = orbit(viewRef.current, 0, step); break
        case 'ArrowUp': next = orbit(viewRef.current, 0, -step); break
        case '+': case '=': next = zoomAt(viewRef.current, WHEEL_STEP, vp.width / 2, vp.height / 2, vp, built.world, built.projection); break
        case '-': case '_': next = zoomAt(viewRef.current, 1 / WHEEL_STEP, vp.width / 2, vp.height / 2, vp, built.world, built.projection); break
        case '0': e.preventDefault(); resetView(); return
        default: return
      }
      e.preventDefault()
      apply(next)
    }
    const stop = (e: Event) => e.preventDefault()
    const resizer = new ResizeObserver(() => request())
    resizer.observe(host)
    const listeners: [string, EventListener, AddEventListenerOptions?][] = [
      ['pointerdown', down as EventListener],
      ['pointermove', move as EventListener],
      ['pointerup', up as EventListener],
      ['pointercancel', up as EventListener],
      ['wheel', wheel as EventListener, { passive: false }],
      ['dblclick', resetView],
      ['keydown', key as EventListener],
      ['contextmenu', stop],
    ]
    for (const [type, fn, options] of listeners) host.addEventListener(type, fn, options)
    request()
    return () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      window.clearTimeout(readoutTimer.current)
      readoutTimer.current = 0
      resizer.disconnect()
      for (const [type, fn, options] of listeners) host.removeEventListener(type, fn, options)
      host.classList.remove('is-dragging')
      draggingRef.current = false
      engine?.dispose()
      engineRef.current = null
      canvas.remove()
      canvasRef.current = null
    }
  }, [request])

  // A new scene or new colours (a theme, a local colour): the engine takes the
  // scene again. A new figure also returns the camera to its authored view.
  useEffect(() => {
    try {
      engineRef.current?.setScene(props.worldScene, props.colours)
    } catch (error) {
      setMessage({ title: 'The painter hit an error', text: error instanceof Error ? error.message : String(error) })
    }
    request()
  }, [props.worldScene, props.colours, request])

  useEffect(() => {
    // StrictMode runs this twice for the same figure: the second run keeps what the first did.
    if (builtRef.current === props.built) return request()
    const first = builtRef.current === null
    builtRef.current = props.built
    const { authored } = props.built
    const v = URL_STATE.view
    viewRef.current = first
      ? sanitizeView({ ...authored, azimuth: v.azimuth ?? authored.azimuth, elevation: v.elevation ?? authored.elevation, zoom: v.zoom ?? authored.zoom }, authored)
      : authored
    easingRef.current = null
    request()
  }, [props.built, request])

  // Any parameter or mode change draws on the next animation frame.
  useEffect(() => request(), [props.params, props.debug, request])

  return (
    <div className="pl-stage" ref={hostRef} tabIndex={0} aria-label="Painted figure: drag to orbit, right-drag to pan, wheel to zoom, double-click to reset">
      <div className="pl-caption" aria-hidden="true">
        <strong>{props.caption.label}</strong>
        <span>{props.caption.text}</span>
        <em>drag orbits · right-drag or shift-drag pans · wheel zooms · double-click resets</em>
      </div>
      {props.banner && (
        <div className="pl-banner" role="status">
          {props.banner}
        </div>
      )}
      {message && (
        <div className="pl-message" role="alert">
          <h2>{message.title}</h2>
          <p>{message.text}</p>
        </div>
      )}
      {props.built.errors.length > 0 && (
        <ul className="pl-errors" aria-label="Figure errors">
          {props.built.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
