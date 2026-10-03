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
// While the camera moves the picture is the strokes of the model's newest frame, re-projected through the new view
// (each keeps its world path, StrokeBatch.worldPath), so every stroke stays and the paint rides the object, at the
// cost of a few milliseconds a frame. Under a drag the model keeps running behind it, in the worker (graph-engine
// space/paint/liveOrbit.ts has the rules):
//   - one request at a time, always for the newest view: a request that is running is never interrupted, and the
//     views that came while it ran are skipped for the newest one;
//   - an answer becomes the base the next frames re-project from, at once: its strokes were made for the view the
//     camera had when it was asked, and are moved to where it is now, so a form that turns into view is painted by the
//     next model frame and not bare until the release. An answer for an older request than the base is never adopted;
//   - the picture does not pop: the strokes the old base and the new one share are one stroke, the ones that moved
//     are eased, the ones that appeared fade in and the ones that went fade out, over CROSSFADE_MS (at once under
//     reduced motion);
//   - an edge stroke is the outline of the view it was made for, so it fades out as its base ages (EDGE_FADE_MS).
// The main thread never waits for the model, and no one task does a frame's work twice over. The G-buffer is drawn in
// the task of the render() that asks for it and read back through a pack buffer and a fence, polled without waiting
// (gl/gbuffer.ts), so no readPixels stalls the page behind the paints of a drag; its decode, the transfer to the worker and
// the answer are tasks of their own. An answer that comes while the pointer drags is adopted but not painted, and asks
// for nothing: the next animation frame's render() paints from the new base (the tick does, if none comes, when the
// pointer has paused) and asks for the next request, so the paint of an adopted frame and the request that follows are
// never stacked on the task the answer came in. The arrays a frame's re-projection and blend are made in are kept from
// frame to frame (scratch.ts), so a fade allocates nothing. (On this thread, with ?worker=0, the model would be the wait,
// so it is left for the release as it was.) The model runs once more, at full quality, on the pointer's release (120 ms after the last wheel turn, key or eased step) and
// the picture eases from the re-projected frame to the new one. Nothing runs while nothing changes.
//
// A re-projected frame is put through the new view's depth, so it does not show what the strokes' old view
// saw: the renderer draws the opaque meshes' depth for the new view (a depth-only pass), hides each stroke
// a nearer surface covers and clips an edge decal that has left its surface, and warps the underpainting
// (an image of the old view) back through that depth, so it rides the surface like the strokes and leaves
// no canvas inside a form. It is given the view and the G-buffer depth the frame was made for (a copy of
// the depth is kept with the frame: the G-buffer itself goes to the worker).
//
// What a frame costs depends on what changed:
//   full    the G-buffer and the whole model;
//   reproject the camera moved (and nothing else did, unless the pointer is dragging it: then whatever else changed
//           waits for the release): the last full frame's strokes through the new view
//           (graph-engine/src/space/paint/reproject.ts), painted again; no G-buffer and no model.
//   repaint only renderer parameters changed (the relief, the canvas's texture or weave: classifyChange),
//           and the view did not: the strokes are the last frame's, painted again, with no G-buffer
//           and no model (the paper alone comes from the worker when the texture or the weave moved).
//   colour  colour parameters changed (and the view did not): no G-buffer, no analysis; the worker
//           makes the colours and the brush-load mix again from the last frame's recipes. This is
//           what the colour sliders and the curve editors do.
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
//    each figure in turn. What the model keeps per scene (the scene, its colours
//    and its particles, in the session) is keyed by the scene, so alternating
//    between figures builds none of that again. The renderer's GPU upload is not:
//    it holds ONE scene's meshes, and a tile of another figure uploads its own
//    (buffers only, small beside the model's work).
//  - dispose frees everything the engine made.

import { PaintRenderer } from '../../graph-engine/src/space/paint/gl/PaintRenderer'
import { classifyChange } from '../../graph-engine/src/space/paint/model/index'
import { blendStrokes, crossfadeWeight, edgeFade, matchStrokes, refineMatch, shouldAdopt, type StrokeMatch } from '../../graph-engine/src/space/paint/liveOrbit'
import { reprojectStrokes } from '../../graph-engine/src/space/paint/reproject'
import { Scratch } from '../../graph-engine/src/space/paint/scratch'
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
import type { GBuffer, PaintDebug, PaintDebugMode, PaintFrame, PaintView, SceneColours, StrokeBatch } from '../../graph-engine/src/space/paint/types'
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
  kind: 'full' | 'colour' | 'repaint' | 'reproject'
  // A result that was not shown because a newer picture was (the camera moved on while the model worked).
  skipped?: boolean
  // The model's frame for an earlier view of a moving camera has just become the base: this picture is its strokes
  // re-projected into the view the camera has now (kind 'reproject'), and modelMs and gbufferMs are what that frame cost.
  adopted?: boolean
}

export interface EngineEvents {
  onFrame(stats: FrameStats): void
  // A message to show in the view, or null when the engine is well again.
  onError(message: string | null): void
  // The frame just painted replaces a re-projected one (the camera stopped): the picture the snapshot holds
  // is the old one, to ease out over the new.
  onCrossfade?(): void
  // Every frame painted, with its strokes (for tests and measuring).
  onPaint?(frame: PaintFrame, kind: FrameStats['kind']): void
}

export interface EngineOptions {
  // A 2D canvas the engine copies each re-projected frame into, in the same task as its paint, so the lab can
  // ease from that picture to the full-quality frame that follows (a WebGL canvas cannot be read later).
  snapshot?: CanvasRenderingContext2D | null
  // Where the model runs. Left out, the lab's worker (or this thread, with ?worker=0 or when no worker can start).
  host?: ModelHost
  // The clock the crossfade and the edges' age are told by, in ms (default performance.now), and whether the user
  // asked for no motion (default prefers-reduced-motion: reduce).
  now?: () => number
  reducedMotion?: () => boolean
}

// The wait after the camera's last move (the wheel, a key, an eased step; not a pointer drag, which ends
// at its release) before the model runs for the view it stopped at.
export const SETTLE_MS = 120

export interface PaintEngine {
  setScene(scene: SpaceScene, colours: SceneColours): void
  render(view: PaintView, params: PaintParams, debug: PaintDebugMode): void
  renderTo(target: CanvasRenderingContext2D, view: PaintView, params: PaintParams, debug: PaintDebugMode): Promise<FrameStats>
  dispose(): void
}

// ---- where the model runs ----

export interface ModelHost {
  // True when the model runs off this thread: a frame is then asked for and waited for without stopping the page, so
  // the model may run under a drag. (On this thread a frame stops everything for as long as it takes.)
  readonly background: boolean
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData): void
  setColours(sceneId: number, colours: SceneColourData): void
  frame(request: SessionRequest): Promise<SessionResponse>
  dispose(): void
}

// On this thread: the session itself.
class ThreadHost implements ModelHost {
  readonly background = false
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
  readonly background = true
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

// Is `b` the camera `a` was made for (the view, the light, the size)?
function sameCamera(a: PaintView, b: PaintView): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pixelRatio !== b.pixelRatio) return false
  for (let i = 0; i < 16; i++) if (a.viewProj[i] !== b.viewProj[i]) return false
  for (let i = 0; i < 3; i++) if (a.lightDir[i] !== b.lightDir[i] || a.eye[i] !== b.eye[i] || a.viewDir[i] !== b.viewDir[i]) return false
  return true
}

// What decides whether a frame's G-buffer and analysis are still the right ones: the camera, and the quality
// (an analysis made while dragging, at the coarser stride, is not one for a still view).
function sameFrame(a: PaintView, b: PaintView): boolean {
  return sameCamera(a, b) && (!a.dragging || b.dragging)
}

// The debug views drawn from images of the G-buffer's size, which a re-projection cannot move.
const IMAGE_VIEWS = new Set<PaintDebugMode>(['value', 'zones', 'planes', 'edges'])

interface Job {
  // Which request it was: a result never replaces the picture of a newer one.
  seq: number
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
  // The G-buffer's depth of that frame (a copy: the G-buffer itself goes to the worker): the underpainting's warp reads
  // it to find which points the frame saw.
  depth: Float32Array
  // The parameters of the analysis, and of the strokes now held (they differ after a recolour).
  params: PaintParams
  strokesParams: PaintParams
  debug: PaintDebugMode
  frame: PaintFrame
  // The request that made it: an answer of an older request never replaces it (shouldAdopt).
  seq: number
  // When the camera first left this frame's view (the engine's clock, ms), null while it has not: the frame's edge
  // strokes are stale from then on and fade with their age (edgeFade).
  departedAt: number | null
  // The arrays its strokes are re-projected into, every frame (scratch.ts).
  scratch: Scratch
}

// A new base being eased in: `from` is the base the picture was re-projected from, `to` the one it is now, `match` which
// strokes of the two are the same (liveOrbit.ts), and `startedAt` when `to` was adopted.
interface Fade {
  from: Analysed
  to: Analysed
  startedAt: number
  match: StrokeMatch
  // The arrays the two are blended into, every frame.
  scratch: Scratch
}

// How often the picture is re-made while nothing asks for it (a crossfade goes on in time), and how long a model request
// that no render() has taken up waits before it starts by itself (two animation frames: a pointer that has paused).
const TICK_MS = 16
const RESUME_MS = 2 * TICK_MS

const defaultReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function createPaintEngine(canvas: HTMLCanvasElement, events: EngineEvents, options: EngineOptions = {}): PaintEngine {
  let failure: string | null = null
  // new PaintRenderer throws, with a message fit to show, when there is no WebGL2.
  const renderer = new PaintRenderer(canvas, {
    onError: (message) => {
      failure = message
    },
    // A GPU reset, or a tab that slept: the context takes the picture with it and the renderer gives its
    // resources back when it returns; the picture is painted again from the strokes the engine holds.
    onContextLost: () => {
      // The error the renderer reported before the loss is not the next context's. Cleared here, at the loss, not at
      // the restore: the renderer re-uploads the scene and paper before it calls onContextRestored, and a failure it
      // reports then must survive into the restored context (it would otherwise be wiped and the canvas stay blank).
      failure = null
      events.onError('The graphics context was lost (the GPU reset, or the tab was asleep). It comes back by itself, and the picture with it.')
    },
    onContextRestored: () => {
      events.onError(failure)
      if (lastJob && !disposed) {
        // A new request, newer than the picture the lost context took with it: a job that keeps its old seq is skipped
        // (shownSeq says its picture is on screen) when a settle has painted a later one, and the canvas stays blank.
        lastJob = latest = { ...lastJob, seq: ++seq }
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
    fade = null
    pendingAdoption = null
    paperHeld = ''
  }
  let disposed = false
  try {
    host = options.host ?? (URL_STATE.worker && typeof Worker !== 'undefined' ? new WorkerHost(fallBack) : new ThreadHost())
  } catch {
    host = new ThreadHost()
  }
  const clock = options.now ?? (() => performance.now())
  const reduced = options.reducedMotion ?? defaultReducedMotion

  let analysed: Analysed | null = null
  // The base being eased in, while it is (see Fade).
  let fade: Fade | null = null
  // The model request running (a drag's, the release's, a settle's or a slider's: any a view's own), and when the camera
  // first moved off the view it was asked for: its answer's strokes, and so its edges, are stale from then on.
  let flight: { job: Job; movedAt: number | null } | null = null
  let tickTimer: ReturnType<typeof setTimeout> | null = null
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  let resumeSince = 0
  // When the picture on screen was last painted (the engine's clock): the tick leaves a picture that a frame has just
  // painted to that frame.
  let lastPaintAt = Number.NEGATIVE_INFINITY
  // What a model frame that has just become the base cost, kept for the picture that is made of it: it is reported with
  // that picture, which comes with the next animation frame when the pointer drags.
  let pendingAdoption: Pick<FrameStats, 'ms' | 'gbufferMs' | 'modelMs' | 'particlesMs' | 'paperMs'> | null = null
  // The picture on screen was made by re-projecting a base's strokes (not by painting a frame as the model made it).
  let onScreenReprojected = false
  let paperHeld = ''
  let nextRequest = 1

  let inFlight = false
  let latest: Job | null = null
  // The last request for the view, to paint again after a lost context.
  let lastJob: Job | null = null
  // Requests are numbered; shownSeq is the newest whose picture is on screen.
  let seq = 0
  let shownSeq = 0
  // The picture on screen is a re-projected one, and the snapshot holds it.
  let snapshotValid = false
  let lastDragging = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const tiles: Job[] = []

  const paperFor = (params: PaintParams, view: PaintView): PaperWanted => ({
    weave: params.canvas.weave,
    seed: params.seed,
    tone: [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]],
    texture: params.canvas.texture,
    ratio: view.pixelRatio,
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
    // the G-buffer's depth of the full frame being made, kept for the frame it becomes (see Analysed.depth)
    let gbufferDepth = null as Float32Array | null
    const full = async (): Promise<SessionResponse> => {
      const t0 = performance.now()
      // The G-buffer is drawn now, and read back when the GPU has done it, the page free in between (a paint of a drag goes
      // on). A context that reads it the plain way gives it at once, and the request goes out in this task.
      const read = renderer.startGBuffer(view, params)
      const g = read instanceof Promise ? await read : read
      if (disposed) return { id: -1, ok: false, error: 'the engine was disposed' }
      gbufferDepth = Float32Array.from(g.depth)
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
    // The base this frame replaced, when it became one.
    let replaced: Analysed | null = null
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
    const notShown = (shown: FrameStats['kind']): FrameStats => ({ strokes: 0, ms: 0, gbufferMs, modelMs, particlesMs, paperMs, paintMs: 0, kind: shown, skipped: true })

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
      // The model runs for this view while the camera may move on (under a drag, or after a release that is grabbed again
      // before its frame lands): what it makes becomes the base, aged from when the camera left its view.
      if (!job.target) flight = { job, movedAt: null }
      let movedAt: number | null = null
      let response: SessionResponse
      try {
        if (sinceAnalysis !== 'full' && a) {
          response = await host.frame(request('colour', null))
          if (!response.ok && 'needFull' in response) response = await full()
        } else response = await full()
      } finally {
        if (flight?.job === job) {
          movedAt = flight.movedAt
          flight = null
        }
      }
      // the engine was disposed while the model (or the GPU) worked: nothing to show, and nothing to say
      if (disposed) return notShown('full')
      if (gone(response)) return run(job)
      if (!isFrame(response)) return failed(response)
      kind = response.kind
      modelMs = response.timing.modelMs
      particlesMs = response.timing.particlesMs
      paperMs = response.timing.paperMs
      // The scene (or its colours) changed while the model worked: a frame of the view is not the picture any more
      // (a tile is of its own scene).
      if (!job.target && (id !== sceneId || job.colours !== coloursNow)) return notShown(response.kind)
      takePaper(response.paper)
      frame = {
        strokes: response.strokes,
        underpaint: response.underpaint,
        // a colour frame's debug views are the last full frame's
        debug: response.kind === 'full' ? debugOf(response.debug) : (a as Analysed).frame.debug,
        stats: response.stats,
      }
      if (response.kind === 'full') {
        // Adopted only when it is for a newer request than the base on screen: an answer that comes late, for an older
        // drag position than the base, is dropped (shouldAdopt).
        if (!job.target && !shouldAdopt(analysed?.seq ?? null, job.seq)) return notShown(response.kind)
        // If the camera is no longer where the frame was made, its strokes are stale from when it first moved off.
        const departed = lastJob && !sameCamera(view, lastJob.view) ? (movedAt ?? clock()) : null
        replaced = analysed
        // (a tile of the Showcase is no base for a view's frames: it never outranks a request of the lab's own)
        analysed = { sceneId: id, view, depth: gbufferDepth ?? new Float32Array(0), params, strokesParams: params, debug, frame, seq: job.target ? 0 : job.seq, departedAt: departed, scratch: new Scratch() }
      } else if (a) {
        a.frame = frame
        a.strokesParams = params
      }
    }
    // The camera moved on while the model worked (a newer request has been made since this one began): the frame is for a
    // view it has left. It is the freshest base there is, so the picture is made of its strokes: re-projected into the
    // view the camera has now, and eased in from the base it replaces. So is the frame of a drag that has not moved on
    // (the pointer stopped): the strokes ease in as they do for a moving camera, and not as a picture over the picture.
    // When that cannot be done (the figure or the debug view changed) nothing is shown; what it made is still the base the
    // next re-projection starts from.
    const newest = lastJob
    if (!job.target && newest && (newest.seq > job.seq || isLive(job)) && analysed && kind === 'full') {
      beginFade(replaced)
      pendingAdoption = { ms: performance.now() - started, gbufferMs, modelMs, particlesMs, paperMs }
      // While the pointer drags, the next animation frame's render() paints from the new base and asks for the next request
      // (the tick paints, if none comes): this task, the answer's, paints nothing and asks for nothing, so the paint of
      // the adopted frame and the G-buffer of the next request are not stacked on it. A pointer that has paused (the frame
      // is for the view the camera is at) or been released gets its picture at once.
      if (newest.view.dragging && newest.seq > job.seq) {
        scheduleTick()
        return notShown(kind)
      }
      const shown = showReprojected(newest, { force: true })
      if (shown) return shown
      pendingAdoption = null
    }
    // A newer request has been painted since this one began: this is not the picture any more.
    if (!job.target && job.seq < shownSeq) return notShown(kind)
    const t1 = performance.now()
    fade = null
    pendingAdoption = null
    onScreenReprojected = false
    lastPaintAt = clock()
    renderer.paint(frame, view, params, debug)
    // A renderer that failed says so (it then draws nothing).
    if (failure) throw new Error(failure)
    if (job.target) job.target.drawImage(canvas, 0, 0, job.target.canvas.width, job.target.canvas.height)
    else {
      shownSeq = job.seq
      // the camera stopped and the model has made its frame: ease from the re-projected picture to it
      if (snapshotValid) {
        snapshotValid = false
        events.onCrossfade?.()
      }
    }
    events.onPaint?.(frame, kind)
    const finished = performance.now()
    return { strokes: frame.stats.strokes, ms: finished - started, gbufferMs, modelMs, particlesMs, paperMs, paintMs: finished - t1, kind }
  }

  // Is this request for a camera that is being dragged, with the model off this thread? Its frame is made while the camera
  // goes on moving and becomes the base the picture is re-projected from.
  const isLive = (job: Job): boolean => !job.target && job.view.dragging && host.background

  // Can the picture be made from the base's strokes in this job's view, through the new view's depth? Not for a tile, nor
  // when the base is of another figure or debug view, nor for the depth pass of a figure the renderer was not given;
  // and not when the view is the base's own, unless `force` (the base's own strokes are wanted: a new base is being
  // eased in, or the picture is still changing by itself). A move that is not a drag (the wheel, a key, an eased step)
  // keeps the stricter rule, because a change of the light changes the view too (PaintView.lightDir) and is no movement
  // of the camera: only parameters that leave the strokes as they are. While the pointer drags the camera it does not
  // matter what ELSE changed since the strokes were made (a slider moved, the light): the movement is shown from the
  // strokes the engine holds, and the model's frames, each made for the newest view with the parameters of the moment,
  // bring the rest in.
  function canReproject(job: Job, force: boolean): boolean {
    const a = analysed
    if (!a || job.target || a.sceneId !== job.sceneId || a.debug !== job.debug || IMAGE_VIEWS.has(job.debug)) return false
    // the depth pass is of the scene the renderer holds, and the strokes are of the analysed one: a figure the
    // renderer was given since (a request for another figure is running) is not the figure these strokes are on
    if (rendererScene !== job.scene) return false
    if (!force && sameFrame(a.view, job.view)) return false
    if (!job.view.dragging && classifyChange(a.strokesParams, job.params) !== 'same') return false
    return true
  }

  // How long ago the camera left the view of a base's frame (0 while it has not).
  const ageOf = (base: Analysed, at: number): number => (base.departedAt === null ? 0 : Math.max(0, at - base.departedAt))

  // The strokes on screen for `job`'s view: the base's, re-projected (its edges as faded as its age says), and while a new
  // base is being eased in, the old one's too, blended by how far along that is.
  function strokesFor(job: Job, base: Analysed, at: number): StrokeBatch {
    const own = reprojectStrokes(base.frame.strokes, base.view, job.view, job.params, edgeFade(ageOf(base, at)), base.scratch)
    if (!fade || fade.to !== base) return own
    const weight = crossfadeWeight(at - fade.startedAt, reduced())
    if (weight >= 1) {
      fade = null
      return own
    }
    const before = reprojectStrokes(fade.from.frame.strokes, fade.from.view, job.view, job.params, edgeFade(ageOf(fade.from, at)), fade.from.scratch)
    // with both bases in one view, which pairs are one stroke, which run the other way (once, at the first frame of the fade)
    if (!fade.match.refined) refineMatch(fade.match, before, own)
    return blendStrokes(before, own, fade.match, weight, fade.scratch)
  }

  // The base has just changed from `before` (what the picture on screen is made of): the picture eases from one to the
  // other, unless it is not a re-projection that is on screen, or the user asked for no motion.
  function beginFade(before: Analysed | null): void {
    const a = analysed
    if (!a || !before || before === a || before.sceneId !== a.sceneId || !onScreenReprojected || reduced()) return
    fade = { from: before, to: a, startedAt: clock(), match: matchStrokes(before.frame.strokes, a.frame.strokes), scratch: new Scratch() }
  }

  // Paint the base's strokes in this job's view (the renderer puts them through the view's depth and warps the underpainting
  // from the base's). Null when it cannot be done, nothing painted. Synchronous, a few milliseconds.
  function showReprojected(job: Job, opts: { force?: boolean } = {}): FrameStats | null {
    const a = analysed
    if (!a || !canReproject(job, opts.force === true)) return null
    const started = performance.now()
    const at = clock()
    try {
      if (a.departedAt === null && !sameCamera(a.view, job.view)) a.departedAt = at
      const strokes = strokesFor(job, a, at)
      // The underpaint is an image of the base's view: the renderer warps it onto this one through the scene's depth, and
      // tests the strokes against the same depth (a hidden stroke vanishes, one that has left its surface is clipped),
      // given the view and the G-buffer depth the frame was made for.
      const frame: PaintFrame = { strokes, debug: a.frame.debug, stats: a.frame.stats, underpaint: a.frame.underpaint }
      const t1 = performance.now()
      renderer.paint(frame, job.view, job.params, job.debug, { from: a.view, depth: a.depth })
      if (failure) throw new Error(failure)
      shownSeq = job.seq
      onScreenReprojected = true
      lastPaintAt = at
      const snap = options.snapshot
      if (snap) {
        if (snap.canvas.width !== canvas.width || snap.canvas.height !== canvas.height) {
          snap.canvas.width = canvas.width
          snap.canvas.height = canvas.height
        }
        snap.drawImage(canvas, 0, 0)
        snapshotValid = true
      }
      events.onPaint?.(frame, 'reproject')
      const done = performance.now()
      events.onError(null)
      scheduleTick()
      // a model frame that has just become the base is reported with its first picture
      const adoption = pendingAdoption
      pendingAdoption = null
      if (adoption) return { strokes: strokes.count, ...adoption, paintMs: done - t1, kind: 'reproject', adopted: true }
      return { strokes: strokes.count, ms: done - started, gbufferMs: 0, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: done - t1, kind: 'reproject' }
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  // The camera moved: the newest base's strokes through the new view, painted and reported. Synchronous, and whatever the
  // model is doing at the time, whose result then replaces the base (run()).
  function reproject(job: Job): boolean {
    if (!canReproject(job, false)) return false
    const shown = showReprojected(job)
    // (a failure was shown as an error, and counts as handled: the model is not asked to make it again)
    if (shown) events.onFrame(shown)
    return true
  }

  // Does the picture on screen still change by itself? While a new base is being eased in, and while a model frame that was
  // adopted under a drag has not been painted yet. (A base's edges fade with its age too, but that is told at each frame
  // the camera's move asks for, and a camera that has stopped gets the model's own frame for its view.)
  function needsTick(): boolean {
    return analysed !== null && onScreenReprojected && (fade !== null || pendingAdoption !== null)
  }

  // The next step of that, painted again from the newest request, unless a frame has painted since (the animation frames
  // of a drag do, and the tick leaves the picture to them). Nothing else asks for a frame when the camera is still.
  function scheduleTick(): void {
    if (tickTimer !== null || disposed || !needsTick()) return
    tickTimer = setTimeout(() => {
      tickTimer = null
      if (disposed || !lastJob || !needsTick()) return
      if (clock() - lastPaintAt < TICK_MS) return scheduleTick()
      const shown = showReprojected(lastJob, { force: true })
      if (shown) events.onFrame(shown)
    }, TICK_MS)
  }

  // The next model request, if the render() that would start it does not come within RESUME_MS (the pointer has paused).
  function scheduleResume(): void {
    if (disposed) return
    resumeSince = clock()
    if (resumeTimer !== null) return
    const wait = () => {
      resumeTimer = setTimeout(() => {
        resumeTimer = null
        // a render() has taken it up, or the engine is gone
        if (disposed || latest === null) return
        if (clock() - resumeSince < RESUME_MS) return wait()
        pump()
      }, TICK_MS)
    }
    wait()
  }

  // The camera has stopped: the model's frame for the view it stopped at.
  function settle(): void {
    settleTimer = null
    if (disposed || !lastJob) return
    // The settled frame is the request on screen now: a context that is lost after it paints this one again.
    lastJob = latest = { ...lastJob, seq: ++seq }
    pump()
  }

  // One frame at a time: a Showcase tile in order, else the newest request.
  function pump(): void {
    if (inFlight || disposed) return
    const job = tiles.shift() ?? latest
    if (!job) return
    if (job === latest) latest = null
    inFlight = true
    const live = isLive(job)
    run(job).then(
      (stats) => {
        inFlight = false
        if (disposed) return
        if (!job.target) {
          if (!stats.skipped) {
            events.onError(null)
            events.onFrame(stats)
          }
        } else job.settle?.resolve(stats)
        // The answer of a drag's request does not start the next one in its own task: the next animation frame's render() does
        // (render() asks for it after it has painted), or, if the pointer has paused, a timer. Anything else waiting
        // (the release's frame, a tile, a slider's) goes at once.
        if (live && latest !== null && latest.view.dragging && tiles.length === 0) scheduleResume()
        else pump()
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
        if (analysed?.sceneId === id) {
          analysed = null
          fade = null
          pendingAdoption = null
        }
      }
      if (id !== sceneId) {
        // another figure: the base's strokes are not its, and no fade or adopted frame belongs to it
        fade = null
        pendingAdoption = null
      }
      sceneId = id
      sceneNow = sc
      coloursNow = co
    },

    render(view, params, debug) {
      if (!sceneNow || !coloursNow) return
      const job: Job = { seq: ++seq, sceneId, scene: sceneNow, colours: coloursNow, view, params, debug, target: null, settle: null }
      lastJob = job
      // the model is running for a view the camera has now left: its answer's strokes are stale from here
      if (flight && flight.movedAt === null && !sameCamera(flight.job.view, view)) flight.movedAt = clock()
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = null
      // The pointer's release is the model's frame at once. While the pointer drags, the picture is the newest base's
      // strokes re-projected (every frame) and the model keeps running behind it, one request at a time for the newest
      // view (the request waits behind one that is running, and is replaced by a newer one). Any other move of the
      // camera is shown from the base's strokes too, and the model runs when it has stopped.
      const released = lastDragging && !view.dragging
      lastDragging = view.dragging
      if (!released && reproject(job)) {
        if (!view.dragging) settleTimer = setTimeout(settle, SETTLE_MS)
        else if (host.background) {
          latest = job
          pump()
        }
        return
      }
      latest = job
      pump()
    },

    renderTo(target, view, params, debug) {
      return new Promise<FrameStats>((resolve, reject) => {
        if (!sceneNow || !coloursNow) return reject(new Error('the engine has no scene'))
        tiles.push({ seq: ++seq, sceneId, scene: sceneNow, colours: coloursNow, view, params, debug, target, settle: { resolve, reject } })
        pump()
      })
    },

    dispose() {
      disposed = true
      latest = null
      lastJob = null
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = null
      if (tickTimer !== null) clearTimeout(tickTimer)
      tickTimer = null
      if (resumeTimer !== null) clearTimeout(resumeTimer)
      resumeTimer = null
      fade = null
      pendingAdoption = null
      flight = null
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
