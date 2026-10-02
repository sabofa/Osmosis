// The Paint Lab's engine adapter: the real painter behind the interface the lab
// was built against. One frame is
//
//   renderer.renderGBuffer(view, params)          the shadow map and the G-buffer, read back   (this thread, the GPU)
//   session.frame(...)                            the model: strokes from the G-buffer         (a worker, or this thread)
//   renderer.paint(frame, view, params, debug)    the brush, the canvas and the relief         (this thread, the GPU)
//
// The model is the long part (50 to 150 ms for a figure), so it runs in a Web
// Worker (paintLabWorker.ts) and the controls never wait for it: while one frame
// is in the worker the newest request waits behind it (newest wins), and the
// picture on screen is the last one painted. With ?worker=0, or when the worker
// cannot start, the same session (graph-engine/src/space/paint/session.ts) runs
// on this thread.
//
// What a frame costs depends on what changed:
//   full    the G-buffer and the whole model;
//   repaint only renderer parameters changed (the relief, the canvas's texture or weave: classifyChange),
//           and the view did not: the strokes are the last frame's, painted again, with no G-buffer
//           and no model (the paper alone comes from the worker when the texture or the weave moved).
//   colour  colour parameters changed (and the view did not): no G-buffer, no analysis; the worker
//           makes the colours and the brush-load mix again from the last frame's recipes. This is
//           what the colour sliders and the curve editors do.
//   drag    a full frame at the camera's dragging quality (particles.dragDensity, a coarser analysis)
//           while the pointer is down; the pointer coming up is a full frame at full quality.
//
// The contract the lab keeps:
//  - setScene receives the scene in WORLD coordinates (paintLabCamera.ts):
//    box-normalised, the same space as the PaintView's matrices and lightDir.
//    The renderer takes no WorldMap, so the camera is built over an identity
//    one and the model and renderer see the same numbers.
//  - render asks for a frame: the PaintView for this frame at the canvas's CSS
//    size and pixelRatio, the live params and the debug view. The result arrives
//    through events.onFrame; an engine error through events.onError (the lab
//    shows it in the view; nothing here throws out of a frame).
//  - createPaintEngine throws, with a message fit to show, when it cannot run
//    (no WebGL2).
//  - renderTo is render-then-copy, for the Showcase's grid of tiles: it paints
//    one view at view.width x view.height CSS px (x view.pixelRatio) and, in
//    the same task as the paint, copies the result into the 2D context `target`
//    (so a WebGL canvas can be copied without preserveDrawingBuffer). It returns
//    when the tile is copied. The engine sizes its own canvas for it. The
//    Showcase has ONE engine and canvas for all its tiles and calls setScene for
//    each figure in turn, so what the engine keeps per scene (its scene and
//    particles in the session, its GPU upload) is keyed by the scene, and
//    alternating between figures redoes none of it.
//  - dispose frees everything the engine made.

import { PaintRenderer } from '../../graph-engine/src/space/paint/gl/PaintRenderer'
import { classifyChange } from '../../graph-engine/src/space/paint/model/index'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import {
  colourDataOf,
  PaintSession,
  paperKey,
  plainScene,
  type FrameResponse,
  type PaperData,
  type PaperWanted,
  type SceneColourData,
  type SessionRequest,
  type SessionResponse,
  type WireDebug,
} from '../../graph-engine/src/space/paint/session'
import type { GBuffer, PaintDebug, PaintDebugMode, PaintFrame, PaintView, SceneColours } from '../../graph-engine/src/space/paint/types'
import type { SpaceScene } from '../../graph-engine/src/space/scene/types'
import { URL_STATE } from './paintLabState'
import type { WorkerIn, WorkerOut } from './paintLabWorker'

// What one frame cost, in ms. `ms` is the whole of it, from the request to the
// picture (a worker frame includes the wait), and the rest is where it went:
// the G-buffer pass and readback, the model (in the worker or here), the
// particles the model had to build first, the paper, and the paint's CPU side
// (the GPU's own time overlaps the next frame).
export interface FrameStats {
  strokes: number
  ms: number
  gbufferMs: number
  modelMs: number
  particlesMs: number
  paperMs: number
  paintMs: number
  kind: 'full' | 'colour' | 'repaint'
}

export interface EngineEvents {
  onFrame(stats: FrameStats): void
  // A message to show in the view, or null when the engine is well again.
  onError(message: string | null): void
}

export interface PaintEngine {
  setScene(scene: SpaceScene, colours: SceneColours): void
  render(view: PaintView, params: PaintParams, debug: PaintDebugMode): void
  renderTo(target: CanvasRenderingContext2D, view: PaintView, params: PaintParams, debug: PaintDebugMode): Promise<FrameStats>
  dispose(): void
}

// The generated tile has two texels to a CSS px (the mockup's scale: it is 512 CSS px
// square), and the renderer lays one texel on one device px. Below a pixel ratio of 1.5
// the tile is halved (a 2x2 average, in the session) so that its weave is the size the
// mockup's is, and not twice that.
const HALVE_BELOW_RATIO = 1.5

// ---- where the model runs ----

interface ModelHost {
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData): void
  setColours(sceneId: number, colours: SceneColourData): void
  frame(request: SessionRequest): Promise<SessionResponse>
  dispose(): void
}

// On this thread: the session itself.
class ThreadHost implements ModelHost {
  private readonly session = new PaintSession()
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.session.setScene(sceneId, scene, colours)
  }
  setColours(sceneId: number, colours: SceneColourData) {
    this.session.setColours(sceneId, colours)
  }
  frame(request: SessionRequest) {
    return Promise.resolve(this.session.frame(request))
  }
  dispose() {}
}

// In a Web Worker. `failed` is called once if the worker dies or cannot start.
class WorkerHost implements ModelHost {
  private readonly worker: Worker
  private readonly waiting = new Map<number, (r: SessionResponse) => void>()
  private dead = false

  constructor(failed: (reason: string) => void) {
    this.worker = new Worker(new URL('./paintLabWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const { response } = event.data
      const done = this.waiting.get(response.id)
      this.waiting.delete(response.id)
      done?.(response)
    }
    this.worker.onerror = (event) => {
      if (this.dead) return
      this.dead = true
      failed(event.message || 'the model worker stopped')
    }
  }

  private send(message: WorkerIn, transfer: ArrayBuffer[] = []) {
    this.worker.postMessage(message, transfer)
  }
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.send({ type: 'scene', sceneId, scene, colours })
  }
  setColours(sceneId: number, colours: SceneColourData) {
    this.send({ type: 'colours', sceneId, colours })
  }
  frame(request: SessionRequest) {
    return new Promise<SessionResponse>((resolve) => {
      this.waiting.set(request.id, resolve)
      const g = request.gbuffer
      this.send({ type: 'frame', request }, g ? ([g.depth.buffer, g.normal.buffer, g.value.buffer, g.shadow.buffer, g.mark.buffer] as ArrayBuffer[]) : [])
    })
  }
  dispose() {
    this.dead = true
    this.worker.terminate()
    for (const done of this.waiting.values()) done({ id: -1, ok: false, error: 'the engine was disposed' })
    this.waiting.clear()
  }
}

// ---- the engine ----

const EMPTY_F32 = new Float32Array(0)
const EMPTY_I32 = new Int32Array(0)
const EMPTY_U8 = new Uint8Array(0)

// The debug views of a frame from what the model sent (only the arrays the view in use reads).
const debugOf = (wire: WireDebug | null): PaintDebug => ({
  value: wire?.value ?? EMPTY_F32,
  zones: wire?.zones ?? EMPTY_U8,
  planes: wire?.planes ?? EMPTY_I32,
  edgeSegments: wire?.edgeSegments ?? EMPTY_F32,
  edgeClass: wire?.edgeClass ?? EMPTY_U8,
})

// What decides whether a frame's G-buffer and analysis are still the right ones: the view, and its quality.
function sameFrame(a: PaintView, b: PaintView): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pixelRatio !== b.pixelRatio || a.dragging !== b.dragging) return false
  for (let i = 0; i < 16; i++) if (a.viewProj[i] !== b.viewProj[i]) return false
  for (let i = 0; i < 3; i++) if (a.lightDir[i] !== b.lightDir[i] || a.eye[i] !== b.eye[i] || a.viewDir[i] !== b.viewDir[i]) return false
  return true
}

interface Job {
  // The scene (and its id and colours) the job was asked for: setScene after the request does not change what it paints.
  sceneId: number
  scene: SpaceScene
  colours: SceneColours
  view: PaintView
  params: PaintParams
  debug: PaintDebugMode
  // renderTo: the 2D context to copy into, and how to answer.
  target: CanvasRenderingContext2D | null
  settle: { resolve(stats: FrameStats): void; reject(error: Error): void } | null
}

// What the model's last full frame was made from (the session holds the same), and the strokes on screen now.
interface Analysed {
  sceneId: number
  view: PaintView
  // The parameters of the analysis, and of the strokes now held (they differ after a recolour).
  params: PaintParams
  strokesParams: PaintParams
  debug: PaintDebugMode
  frame: PaintFrame
}

export function createPaintEngine(canvas: HTMLCanvasElement, events: EngineEvents): PaintEngine {
  let failure: string | null = null
  // new PaintRenderer throws, with a message fit to show, when there is no WebGL2.
  const renderer = new PaintRenderer(canvas, {
    onError: (message) => {
      failure = message
    },
    // A GPU reset, or a tab that slept: the context takes the picture with it and the renderer gives its
    // resources back when it returns; the picture is painted again from the strokes the engine holds.
    onContextLost: () => events.onError('The graphics context was lost (the GPU reset, or the tab was asleep). It comes back by itself, and the picture with it.'),
    onContextRestored: () => {
      events.onError(null)
      if (lastJob && !disposed) {
        latest = lastJob
        pump()
      }
    },
  })

  // Scenes get ids; a scene (and the colours it was given) is sent to the model once.
  const ids = new WeakMap<SpaceScene, number>()
  const sent = new Map<number, { scene: SpaceScene; colours: SceneColours }>()
  let nextSceneId = 1
  // The scene the lab last set: what the next request is for.
  let sceneId = 0
  let sceneNow: SpaceScene | null = null
  let coloursNow: SceneColours | null = null

  // The scene the renderer holds (its meshes are uploaded for the G-buffer pass).
  let rendererScene: SpaceScene | null = null

  let host: ModelHost
  const fallBack = (reason: string) => {
    if (disposed) return
    console.warn(`The model worker could not run (${reason}); the model runs on this thread.`)
    host.dispose()
    host = new ThreadHost()
    // The session on this thread knows nothing yet: give it every scene again and forget what it was holding.
    for (const [id, s] of sent) host.setScene(id, plainScene(s.scene), colourDataOf(s.scene, s.colours))
    analysed = null
    paperHeld = ''
  }
  let disposed = false
  try {
    host = URL_STATE.worker && typeof Worker !== 'undefined' ? new WorkerHost(fallBack) : new ThreadHost()
  } catch {
    host = new ThreadHost()
  }

  let analysed: Analysed | null = null
  let paperHeld = ''
  let nextRequest = 1

  let inFlight = false
  let latest: Job | null = null
  // The last request for the view, to paint again after a lost context.
  let lastJob: Job | null = null
  const tiles: Job[] = []

  const paperFor = (params: PaintParams, view: PaintView): PaperWanted => ({
    weave: params.canvas.weave,
    seed: params.seed,
    tone: [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]],
    texture: params.canvas.texture,
    halve: view.pixelRatio < HALVE_BELOW_RATIO,
  })

  async function run(job: Job): Promise<FrameStats> {
    const started = performance.now()
    const { view, params, debug } = job
    const id = job.sceneId
    if (!id || !sent.has(id)) return { strokes: 0, ms: 0, gbufferMs: 0, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: 0, kind: 'full' }
    if (rendererScene !== job.scene) {
      renderer.setScene(job.scene, job.colours)
      rendererScene = job.scene
    }
    if (job.target) {
      // The renderer sizes its canvas to the canvas's client size times the pixel ratio.
      canvas.style.width = `${view.width}px`
      canvas.style.height = `${view.height}px`
    }
    const want = paperFor(params, view)
    const request = (kind: 'full' | 'colour' | 'paper', gbuffer: GBuffer | null): SessionRequest => ({
      id: nextRequest++, sceneId: id, kind, params, view, gbuffer, debug, havePaper: paperHeld, paper: want,
    })

    let gbufferMs = 0
    const full = (): Promise<SessionResponse> => {
      const t0 = performance.now()
      const g = renderer.renderGBuffer(view, params)
      gbufferMs = performance.now() - t0
      return host.frame(request('full', g))
    }
    // What the last frame lets this one skip.
    const a = analysed
    const same = a !== null && a.sceneId === id && a.debug === debug && sameFrame(a.view, view)
    const sinceStrokes = same ? classifyChange(a.strokesParams, params) : 'full'
    const sinceAnalysis = same ? classifyChange(a.params, params) : 'full'
    let kind: FrameStats['kind']
    let modelMs = 0
    let particlesMs = 0
    let paperMs = 0
    let frame: PaintFrame
    const takePaper = (paper: PaperData | null) => {
      if (!paper) return
      renderer.setPaper(paper.rgba, paper.height, paper.size)
      paperHeld = paper.key
    }
    const failed = (response: SessionResponse): never => {
      if (!response.ok && 'needFull' in response) throw new Error('the model would not recolour or paint the frame')
      throw new Error(response.ok ? 'the model sent a frame that is not one' : response.error)
    }
    const isFrame = (r: SessionResponse): r is FrameResponse => r.ok && r.kind !== 'paper'
    // The worker went away under this frame and the model moved to this thread: make the frame again there.
    const gone = (r: SessionResponse) => !r.ok && 'error' in r && r.id === -1 && !disposed

    if ((sinceStrokes === 'same' || sinceStrokes === 'render') && a) {
      // The strokes are the frame's own: paint them again (the paper from the worker if it changed).
      kind = 'repaint'
      frame = a.frame
      if (paperKey(want) !== paperHeld) {
        const r = await host.frame(request('paper', null))
        if (gone(r)) return run(job)
        if (!r.ok || r.kind !== 'paper') return failed(r)
        takePaper(r.paper)
        paperMs = r.timing.paperMs
      }
      a.strokesParams = params
    } else {
      let response: SessionResponse
      if (sinceAnalysis !== 'full' && a) {
        response = await host.frame(request('colour', null))
        if (!response.ok && 'needFull' in response) response = await full()
      } else response = await full()
      if (gone(response)) return run(job)
      if (!isFrame(response)) return failed(response)
      // The scene changed while the model worked: a frame of the view is not the picture any more (a tile is of its own scene).
      if (!job.target && id !== sceneId) return { strokes: 0, ms: 0, gbufferMs, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: 0, kind: response.kind }
      takePaper(response.paper)
      kind = response.kind
      modelMs = response.timing.modelMs
      particlesMs = response.timing.particlesMs
      paperMs = response.timing.paperMs
      frame = {
        strokes: response.strokes,
        underpaint: response.underpaint,
        // a colour frame's debug views are the last full frame's
        debug: response.kind === 'full' ? debugOf(response.debug) : (a as Analysed).frame.debug,
        stats: response.stats,
      }
      if (response.kind === 'full') analysed = { sceneId: id, view, params, strokesParams: params, debug, frame }
      else if (a) {
        a.frame = frame
        a.strokesParams = params
      }
    }
    const t1 = performance.now()
    renderer.paint(frame, view, params, debug)
    // A renderer that failed says so (it then draws nothing).
    if (failure) throw new Error(failure)
    if (job.target) job.target.drawImage(canvas, 0, 0, job.target.canvas.width, job.target.canvas.height)
    const now = performance.now()
    return { strokes: frame.stats.strokes, ms: now - started, gbufferMs, modelMs, particlesMs, paperMs, paintMs: now - t1, kind }
  }

  // One frame at a time: a Showcase tile in order, else the newest request.
  function pump(): void {
    if (inFlight || disposed) return
    const job = tiles.shift() ?? latest
    if (!job) return
    if (job === latest) latest = null
    inFlight = true
    run(job).then(
      (stats) => {
        inFlight = false
        if (disposed) return
        if (!job.target) {
          events.onError(null)
          events.onFrame(stats)
        } else job.settle?.resolve(stats)
        pump()
      },
      (error: unknown) => {
        inFlight = false
        const message = error instanceof Error ? error.message : String(error)
        if (job.target) job.settle?.reject(new Error(message))
        else events.onError(message)
        if (!disposed) pump()
      },
    )
  }

  return {
    setScene(sc, co) {
      let id = ids.get(sc)
      const known = id !== undefined ? sent.get(id) : undefined
      if (id === undefined) {
        id = nextSceneId++
        ids.set(sc, id)
      }
      if (!known) {
        sent.set(id, { scene: sc, colours: co })
        host.setScene(id, plainScene(sc), colourDataOf(sc, co))
      } else if (known.colours !== co) {
        known.colours = co
        host.setColours(id, colourDataOf(sc, co))
        if (analysed?.sceneId === id) analysed = null
      }
      sceneId = id
      sceneNow = sc
      coloursNow = co
    },

    render(view, params, debug) {
      if (!sceneNow || !coloursNow) return
      latest = { sceneId, scene: sceneNow, colours: coloursNow, view, params, debug, target: null, settle: null }
      lastJob = latest
      pump()
    },

    renderTo(target, view, params, debug) {
      return new Promise<FrameStats>((resolve, reject) => {
        if (!sceneNow || !coloursNow) return reject(new Error('the engine has no scene'))
        tiles.push({ sceneId, scene: sceneNow, colours: coloursNow, view, params, debug, target, settle: { resolve, reject } })
        pump()
      })
    },

    dispose() {
      disposed = true
      latest = null
      lastJob = null
      for (const t of tiles.splice(0)) t.settle?.reject(new Error('the engine was disposed'))
      sent.clear()
      sceneNow = null
      coloursNow = null
      analysed = null
      host.dispose()
      renderer.dispose()
    },
  }
}
