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
// THE BAKED PAINTING. With the key light fixed in the world (light.worldFixed 1, the default) a stroke's colour, role and path on the surface do
// not depend on the camera, so the lab paints the figure from a BAKE (graph-engine/src/space/paint/bake/): made once, in a worker of its own (the
// model's worker never queues behind a bake of 4 to 16 s; the page stops for it only with ?worker=0), with its progress shown as "Painting... NN%", and
// then every frame, at rest and under a drag, is
//
//   frameFromBake(bake, scene, view, params, latest G-buffer or null)   the strokes this view shows, on this thread, a few ms
//   renderer.paint(frame, view, params)                                the underpainting drawn from the baked surfaces, the strokes tested
//                                                                      against the view's depth, the brush, the canvas
//
// with no model request at all: orbiting a figure is instant. The G-buffer is read back (asynchronously, never waited for) only AT REST, for the
// silhouette strokes' tint beyond the outline: a frame is given the one that was read for its own view and light, and null (the canvas) otherwise, so
// under a drag no read starts and the silhouettes read the canvas. What the lab does when something changes (tested in lab/engine.test.ts):
//   the view moved       nothing (a new frame from the bake);
//   a renderer parameter or one only a frame reads (density, fade, zoom growth)    nothing but the frame (a view-only slider that moves a stroke's baked
//                        length across a bucket is a re-bake: bake/index.ts lengthFactorsMoved);
//   a colour parameter   the worker makes the colours again from the bake's recipes (recolourBake), and only the colour arrays come back;
//   anything else the bake reads (the light, the seed, a role's size, the figure's framing, the colours of a theme)
//                        a new bake, 150 ms after the last change, one at a time, the newest request: the old bake stays on screen
//                        until the new one lands, and a bake that lands for inputs that are no longer the newest is dropped. A bake
//                        in flight that a change or another figure makes useless is CANCELLED for real: its worker is terminated and
//                        made again (a bake does not yield, so nothing less stops it).
// Used only when all three hold: the light is fixed in the world, the renderer can depth-test strokes (float render targets: baked strokes
// are hidden by the view's depth and would paint through the surfaces without it), and no debug view is chosen. Otherwise the picture is the
// per-frame painter's, as described above, unchanged. While the first bake of a figure is made, the per-frame painter's frames are the
// picture, and so they are on returning to the baked path (from a debug view, say) until a bake that is for the params of the moment is held:
// the baked path is entered only with a bake that is not stale. The Showcase's tiles (renderTo) are always the per-frame painter's. If the bake's
// worker dies, the bake is off (the status line says so) and does not move to this thread, unless ?worker=0 asked for that.
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

import { classifyBakeChange, lengthFactorsMoved, lightKeyOf } from '../../graph-engine/src/space/paint/bake/index'
import { frameFromBakeWith, FrameScratch, prepareBake } from '../../graph-engine/src/space/paint/bake/frame'
import type { AuthoredFraming, BakedPainting } from '../../graph-engine/src/space/paint/bake/types'
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
  withColours,
  type BakeAnswer,
  type BakeRequest,
  type FrameResponse,
  type PaperData,
  type PaperWanted,
  type RecolourAnswer,
  type RecolourRequest,
  type SceneColourData,
  type SessionRequest,
  type SessionResponse,
  type WireDebug,
} from '../../graph-engine/src/space/paint/session'
import { ROLES, type GBuffer, type PaintDebug, type PaintDebugMode, type PaintFrame, type PaintFrameInput, type PaintView, type Role, type SceneColours, type StrokeBatch } from '../../graph-engine/src/space/paint/types'
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
  // 'baked' is a frame of the baked painting (frameFromBake, then the paint); the others are the per-frame model's.
  kind: 'full' | 'colour' | 'repaint' | 'reproject' | 'baked'
  // Which painter drew it, and what a baked frame's own build cost (frameFromBake alone, ms; 0 for a per-frame one: its model's time is modelMs).
  path: 'baked' | 'live'
  buildMs: number
  // A result that was not shown because a newer picture was (the camera moved on while the model worked).
  skipped?: boolean
  // The model's frame for an earlier view of a moving camera has just become the base: this picture is its strokes
  // re-projected into the view the camera has now (kind 'reproject'), and modelMs and gbufferMs are what that frame cost.
  adopted?: boolean
}

// What the baked painting is doing, for the lab's status line: which painter is drawing, how far a bake in the making has come (whole percent, null
// when none is), and, when the light is fixed in the world and the picture is the per-frame painter's all the same, why not the baked one.
export interface BakeStatus {
  path: 'baked' | 'live'
  painting: number | null
  why: string | null
}

export interface EngineEvents {
  onFrame(stats: FrameStats): void
  // The status above, each time it changes (a bake's percent included).
  onBake?(status: BakeStatus): void
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
  // Where the bake is made. Left out: the lab's own worker for it (made when the first bake is wanted), or the model's host on this thread with
  // ?worker=0; with a `host` of your own and no bake host, no bake is made. null: none.
  bakeHost?: BakeHost | null
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
  // `authored` is the framing the picture is composed for (paintLabCamera.ts authoredFraming): what the baked painting is made for. Left out, the
  // picture is the per-frame painter's.
  render(view: PaintView, params: PaintParams, debug: PaintDebugMode, authored?: AuthoredFraming): void
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

// Where the baked painting is made (session.ts): once for a scene and its params, and its colours made again under colour-only params. It is
// NOT the model's host: a bake takes 4 to 16 s, and a worker that makes it would hold the model's frames (a new figure's first picture) behind it. It
// is given every scene the model's host is. `progress` is told the whole percent as the bake grows. An answer with id -1 says the host went away.
export interface BakeHost {
  readonly background: boolean
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData): void
  setColours(sceneId: number, colours: SceneColourData): void
  bake(request: BakeRequest, progress: (percent: number) => void): Promise<BakeAnswer>
  recolour(request: RecolourRequest): Promise<RecolourAnswer>
  // Abandon what is in flight, for real: a bake does not yield, so a worker is terminated and made again with the scenes it held (and none of its
  // bake); every answer still waited for settles with id -1. A host that runs on this thread cannot interrupt a bake and does nothing.
  cancel(): void
  dispose(): void
}

// On this thread: the session itself (the model's, and with ?worker=0 the bake's too: the bake then stops the page for as long as it takes).
class ThreadHost implements ModelHost, BakeHost {
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
  // On this thread the bake stops the page for as long as it takes (a few seconds): a task of its own, after the picture on screen has been
  // painted and the status line has said it is painting.
  async bake(request: BakeRequest, progress: (percent: number) => void) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return this.session.bake(request, progress)
  }
  recolour(request: RecolourRequest) {
    return Promise.resolve(this.session.recolour(request))
  }
  cancel() {}
  dispose() {}
}

// In a Web Worker. `failed` is called once if the worker dies or cannot start.
class WorkerHost implements ModelHost {
  readonly background = true
  private readonly worker: Worker
  private readonly waiting = new Map<number, (r: never) => void>()
  private dead = false

  constructor(failed: (reason: string) => void) {
    this.worker = new Worker(new URL('./paintLabWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const m = event.data
      if (m.type !== 'frame') return
      const done = this.waiting.get(m.response.id)
      this.waiting.delete(m.response.id)
      done?.(m.response as never)
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
    for (const done of this.waiting.values()) done({ id: -1, ok: false, error: 'the engine was disposed' } as never)
    this.waiting.clear()
  }
}

// In a Web Worker of its own, with its own session (and so its own particles): only bakes and recolours go to it, and only frames to the model's.
// `failed` is called once if the worker dies; a worker that is cancelled (cancel()) is made again and is not a failure.
class WorkerBakeHost implements BakeHost {
  readonly background = true
  private worker: Worker
  private readonly waiting = new Map<number, (r: never) => void>()
  private readonly progress = new Map<number, (percent: number) => void>()
  // What the worker was given, to give a new one the same.
  private readonly scenes = new Map<number, { scene: SpaceScene; colours: SceneColourData }>()
  private readonly failed: (reason: string) => void
  private dead = false

  constructor(failed: (reason: string) => void) {
    this.failed = failed
    this.worker = this.spawn()
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./paintLabWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const m = event.data
      if (m.type === 'progress') {
        this.progress.get(m.id)?.(m.percent)
        return
      }
      if (m.type === 'frame') return
      const done = this.waiting.get(m.response.id)
      this.waiting.delete(m.response.id)
      this.progress.delete(m.response.id)
      done?.(m.response as never)
    }
    worker.onerror = (event) => {
      if (this.dead) return
      this.dead = true
      // (a worker that has thrown is not used again, and nothing holds it after the engine lets the host go: it is stopped here, not left running)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      this.settleAll('the bake worker stopped')
      this.failed(event.message || 'the bake worker stopped')
    }
    return worker
  }

  private settleAll(error: string) {
    for (const done of this.waiting.values()) done({ id: -1, ok: false, error } as never)
    this.waiting.clear()
    this.progress.clear()
  }

  private send(message: WorkerIn) {
    this.worker.postMessage(message, [])
  }
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.scenes.set(sceneId, { scene, colours })
    this.send({ type: 'scene', sceneId, scene, colours })
  }
  setColours(sceneId: number, colours: SceneColourData) {
    const have = this.scenes.get(sceneId)
    if (have) have.colours = colours
    this.send({ type: 'colours', sceneId, colours })
  }
  bake(request: BakeRequest, progress: (percent: number) => void) {
    return new Promise<BakeAnswer>((resolve) => {
      this.waiting.set(request.id, resolve)
      this.progress.set(request.id, progress)
      this.send({ type: 'bake', request })
    })
  }
  recolour(request: RecolourRequest) {
    return new Promise<RecolourAnswer>((resolve) => {
      this.waiting.set(request.id, resolve)
      this.send({ type: 'recolour', request })
    })
  }
  cancel() {
    if (this.dead) return
    const old = this.worker
    old.onmessage = null
    old.onerror = null
    old.terminate()
    this.settleAll('the bake was cancelled')
    this.worker = this.spawn()
    for (const [sceneId, s] of this.scenes) this.send({ type: 'scene', sceneId, scene: s.scene, colours: s.colours })
  }
  dispose() {
    this.dead = true
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.settleAll('the engine was disposed')
    this.scenes.clear()
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

// Has the camera turned from `a`'s view to `b`'s: do they look in another direction? A zoom or a pan moves the picture of a
// form but not the outline of it: an edge stroke is still where the outline is, so it does not age (it ages from when the
// view turns, and a pan that turns nothing leaves it as it was).
function turned(a: PaintView, b: PaintView): boolean {
  const dot = a.viewDir[0] * b.viewDir[0] + a.viewDir[1] * b.viewDir[1] + a.viewDir[2] * b.viewDir[2]
  return 1 - dot > 1e-9
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
  // When the camera first turned from this frame's view (the engine's clock, ms), null while it has not: the frame's edge
  // strokes are stale from then on and fade with their age (edgeFade). A zoom or a pan does not turn it (turned()).
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

// A bake is asked for this long after the last change of what it is made of (a slider dragged is one bake, when it stops), and it is one at a time.
export const BAKE_DEBOUNCE_MS = 150

const EMPTY_DEBUG: PaintDebug = { value: EMPTY_F32, zones: EMPTY_U8, planes: EMPTY_I32, edgeSegments: EMPTY_F32, edgeClass: EMPTY_U8 }

// What a baked frame is made for: the scene and its colours, the world light, the framing, and the params (a bake's colours are the params'
// colour part; its geometry and strokes the rest of what `bakedParams` holds).
interface BakeWant {
  sceneId: number
  scene: SpaceScene
  colours: SceneColours
  params: PaintParams
  lightDir: [number, number, number]
  lightKey: string
  authored: AuthoredFraming
}

// The bake the lab holds on this thread: what it was made for, and the params its colours are made for now (a recolour moves them).
interface HeldBake {
  sceneId: number
  scene: SpaceScene
  colours: SceneColours
  baked: BakedPainting
  // The params it was baked with (its strokes, their bucketed lengths), and the ones its colours were last made under.
  bakeParams: PaintParams
  colourParams: PaintParams
  authored: AuthoredFraming
  lightKey: string
}

const isOpaqueMesh = (mark: SpaceScene['marks'][number] | undefined): boolean => mark !== undefined && mark.kind === 'mesh' && mark.style.opacity >= 1

const sameAuthored = (a: AuthoredFraming, b: AuthoredFraming): boolean =>
  a.ortho === b.ortho && a.worldPerPx === b.worldPerPx && a.eye.every((v, i) => v === b.eye[i]) && a.viewDir.every((v, i) => v === b.viewDir[i])

// What a change of the want asks of the bake held: nothing, its colours again, or a new bake (the whole of the rule is in bake/index.ts: the key's
// own).
type Need = 'none' | 'colour' | 'bake'

function needOf(held: HeldBake | null, want: BakeWant, fresh: boolean): Need {
  if (!held || fresh || held.sceneId !== want.sceneId || held.colours !== want.colours) return 'bake'
  if (held.lightKey !== want.lightKey || !sameAuthored(held.authored, want.authored)) return 'bake'
  if (classifyBakeChange(held.bakeParams, want.params) === 'bake') return 'bake'
  if (lengthFactorsMoved(held.baked.areaPerParticle, held.baked.referenceWorldPerPx, held.bakeParams, want.params)) return 'bake'
  return classifyBakeChange(held.colourParams, want.params) === 'colour' ? 'colour' : 'none'
}

// Is what a bake in the making is for no longer what `now` asks for, whatever it turns out to be (the figure, the colours, the light, the framing, or
// params the bake reads): it is cancelled.
function uselessFor(made: BakeWant, now: BakeWant): boolean {
  if (made.sceneId !== now.sceneId || made.colours !== now.colours || made.lightKey !== now.lightKey || !sameAuthored(made.authored, now.authored)) return true
  return classifyBakeChange(made.params, now.params) === 'bake'
}

// Is a bake made for `made` no longer what `now` asks for (so it is dropped when it lands)? The same, and the bucketed length of its paths, which is
// the bake's own (its areas per particle).
function staleFor(made: BakeWant, now: BakeWant, baked: BakedPainting): boolean {
  return uselessFor(made, now) || lengthFactorsMoved(baked.areaPerParticle, baked.referenceWorldPerPx, made.params, now.params)
}

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
      if (lastJob && !disposed && bakedMode && heldBake) {
        // The renderer put the baked surfaces up again itself (it keeps the last ones given); the picture is made from the bake held: a new request,
        // newer than the picture the lost context took with it.
        lastJob = { ...lastJob, seq: ++seq }
        reportBaked(lastJob)
      } else if (lastJob && !disposed) {
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
    held = null
    pendingAdoption = null
    paperHeld = ''
    // (the thread's session holds no bake: a recolour of the one the page holds is answered `needBake`, and a bake is made there)
  }
  let disposed = false
  try {
    host = options.host ?? (URL_STATE.worker && typeof Worker !== 'undefined' ? new WorkerHost(fallBack) : new ThreadHost())
  } catch {
    host = new ThreadHost()
  }
  // Where the bake is made (see BakeHost), found when the first bake is wanted: a Showcase's engine, which never bakes, makes none. `bakeOffWhy` says
  // why there is none when the light is fixed in the world and a bake was wanted.
  let bakeHost: BakeHost | null = null
  let bakeHostFound = false
  let bakeOffWhy: string | null = null
  function findBakeHost(): BakeHost | null {
    if (bakeHostFound) return bakeHost
    bakeHostFound = true
    if (options.bakeHost !== undefined) bakeHost = options.bakeHost
    else if (options.host) bakeHost = null
    else if (!URL_STATE.worker) bakeHost = host instanceof ThreadHost ? host : null
    else if (typeof Worker === 'undefined') bakeOffWhy = 'there are no workers here, and a bake on this thread would stop the page (&worker=0 asks for that)'
    else {
      try {
        bakeHost = new WorkerBakeHost(bakeWorkerLost)
      } catch (error) {
        bakeOffWhy = `the bake worker could not start (${error instanceof Error ? error.message : String(error)}), and a bake on this thread would stop the page (&worker=0 asks for that)`
      }
    }
    // (the scenes the lab has set so far: the model's host was given them as they came)
    if (bakeHost && (bakeHost as unknown) !== host) for (const [id, s] of sent) bakeHost.setScene(id, plainScene(s.scene), colourDataOf(s.scene, s.colours))
    return bakeHost
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
  // An answer that came while a fade was running, waiting for it to end: a base adopted mid-fade would take the old strokes of
  // the half-faded one away at once. It takes over when the fade has run its time (takeHeld), and a newer answer replaces it.
  let held: { base: Analysed; stats: Pick<FrameStats, 'ms' | 'gbufferMs' | 'modelMs' | 'particlesMs' | 'paperMs'> } | null = null
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

  // ---- the baked painting's state ----
  // The bake held, the inputs the newest baked-path render asked for (null while the picture is not the baked path's), the one bake or recolour in flight
  // and the time before which no bake starts (the debounce).
  let heldBake: HeldBake | null = null
  let bakeWant: BakeWant | null = null
  let lastWant: BakeWant | null = null
  // The inputs of the last baked-path render, kept when the baked path is left (a debug view): a bake that lands then and is still right for them is held.
  let lastSeenWant: BakeWant | null = null
  let bakeFlight: { id: number; kind: 'bake' | 'recolour'; want: BakeWant } | null = null
  let bakeDueAt = Number.NEGATIVE_INFINITY
  let bakeTimer: ReturnType<typeof setTimeout> | null = null
  // The worker did not hold the bake a recolour was for: the next step is a bake whatever the params say.
  let needFresh = false
  // Why the baked path cannot be used on this device or just now (null: it can): the renderer cannot depth-test strokes, or a bake failed.
  let bakeBroken: string | null = null
  // The same, as the newest render found it while the light is fixed in the world (the status line says it when the picture is the per-frame painter's).
  let whyNot: string | null = null
  // The picture being drawn is the baked path's (frames from the bake), and the surfaces the renderer was last given.
  let bakedMode = false
  let surfacesSet: BakedPainting['surfaces'] | null = null
  // The newest G-buffer that has arrived (for the silhouettes), the one the last baked frame used, and whether a readback is under way.
  let latestG: { g: GBuffer; view: PaintView; sceneId: number; light: string } | null = null
  let paintedG: GBuffer | null = null
  // What a baked frame is built in, kept: the arrays of its selection, its painting order and the strokes themselves (FrameScratch.reuseOutput: the batch is
  // views of arrays that the next frame writes over).
  const bakeScratch = new FrameScratch()
  bakeScratch.reuseOutput = true
  let gFlight = false
  let paperFlight = false
  let paintingNow: number | null = null
  let statusSent = ''
  // ?perf=1: a handle for a measuring script, like the lab's __paintFrames: the bake held and the newest request (to time frameFromBake alone, with
  // the GPU out of it).
  if (URL_STATE.perf && typeof window !== 'undefined') {
    ;(window as unknown as { __paintBakeHook?: unknown }).__paintBakeHook = { baked: () => heldBake?.baked ?? null, job: () => lastJob }
  }

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
    if (!id || !sent.has(id)) return { strokes: 0, ms: 0, gbufferMs: 0, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: 0, kind: 'full', path: 'live', buildMs: 0 }
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
    // The context was lost before the G-buffer could be read (or while the GPU worked on it): there is none to give the model.
    // Nothing is made of the request; the restore asks again (onContextRestored).
    let contextLost = false as boolean
    const full = async (): Promise<SessionResponse> => {
      const t0 = performance.now()
      // The G-buffer is drawn now, and read back when the GPU has done it, the page free in between (a paint of a drag goes
      // on). A context that reads it the plain way gives it at once, and the request goes out in this task.
      const read = renderer.startGBuffer(view, params)
      const g = read instanceof Promise ? await read : read
      if (disposed) return { id: -1, ok: false, error: 'the engine was disposed' }
      if (g === null) {
        contextLost = true
        return { id: -1, ok: false, error: 'the graphics context was lost' }
      }
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
    const notShown = (shown: FrameStats['kind']): FrameStats => ({ strokes: 0, ms: 0, gbufferMs, modelMs, particlesMs, paperMs, paintMs: 0, kind: shown, path: 'live', buildMs: 0, skipped: true })

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
      // (no G-buffer, so no request: the picture comes back with the context)
      if (contextLost) return notShown('full')
      // the baked painting has taken over the picture (its bake landed while the model worked): this frame is not wanted, and is not a base
      if (bakedMode && !job.target) return notShown('full')
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
        const newestBase = Math.max(analysed?.seq ?? -1, held?.base.seq ?? -1)
        if (!job.target && !shouldAdopt(newestBase < 0 ? null : newestBase, job.seq)) return notShown(response.kind)
        // If the camera is no longer where the frame was made, its strokes are stale from when it first moved off.
        const departed = lastJob && turned(view, lastJob.view) ? (movedAt ?? clock()) : null
        // (a tile of the Showcase is no base for a view's frames: it never outranks a request of the lab's own)
        const candidate: Analysed = { sceneId: id, view, depth: gbufferDepth ?? new Float32Array(0), params, strokesParams: params, debug, frame, seq: job.target ? 0 : job.seq, departedAt: departed, scratch: new Scratch() }
        if (!job.target && fadeRunning() && lastJob?.view.dragging) {
          // A fade is running and the camera is still being dragged: the answer waits for the fade to end and then takes over
          // (its strokes are re-projected, as the picture is). One for a camera that has stopped (a release's frame, a
          // settle's, a slider's) is the picture itself and is painted at once, the snapshot's crossfade easing the switch.
          held = { base: candidate, stats: { ms: performance.now() - started, gbufferMs, modelMs, particlesMs, paperMs } }
          scheduleTick()
          return notShown(response.kind)
        }
        replaced = analysed
        analysed = candidate
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
    // A newer request has been painted since this one began (or the baked painting is what is drawn now): this is not the picture any more.
    if (!job.target && (job.seq < shownSeq || bakedMode)) return notShown(kind)
    const t1 = performance.now()
    fade = null
    held = null
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
    return { strokes: frame.stats.strokes, ms: finished - started, gbufferMs, modelMs, particlesMs, paperMs, paintMs: finished - t1, kind, path: 'live', buildMs: 0 }
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

  // Is a fade on the base that is on screen running, with its time not yet up?
  function fadeRunning(at = clock()): boolean {
    return fade !== null && fade.to === analysed && crossfadeWeight(at - fade.startedAt, reduced()) < 1
  }

  // The held answer takes over once the fade it waited for has run its time: it becomes the base, and a fade begins from the
  // one that was on screen, at weight 0, so the picture goes on as it was. (A figure switch or new colours drop it, in
  // setScene, and one that is older than the base is never held.) True when it took over.
  function takeHeld(): boolean {
    const h = held
    if (!h || fadeRunning()) return false
    held = null
    if (!shouldAdopt(analysed?.seq ?? null, h.base.seq)) return false
    const before = analysed
    analysed = h.base
    beginFade(before)
    pendingAdoption = h.stats
    return true
  }

  // How long ago the camera left the view of a base's frame (0 while it has not).
  const ageOf = (base: Analysed, at: number): number => (base.departedAt === null ? 0 : Math.max(0, at - base.departedAt))

  // The strokes on screen for `job`'s view: the base's, re-projected (its edges as faded as its age says), and while a new
  // base is being eased in, the old one's too, blended by how far along that is.
  function strokesFor(job: Job, base: Analysed, at: number): StrokeBatch {
    const own = reprojectStrokes(base.frame.strokes, base.view, job.view, job.params, edgeFade(ageOf(base, at)), base.scratch)
    // (a fade of another base is over: the base it was easing in is not the one on screen any more)
    if (fade && fade.to !== base) fade = null
    if (!fade) return own
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
    fade = null
    const a = analysed
    if (!a || !before || before === a || before.sceneId !== a.sceneId || !onScreenReprojected || reduced()) return
    fade = { from: before, to: a, startedAt: clock(), match: matchStrokes(before.frame.strokes, a.frame.strokes), scratch: new Scratch() }
  }

  // Paint the base's strokes in this job's view (the renderer puts them through the view's depth and warps the underpainting
  // from the base's). Null when it cannot be done, nothing painted. Synchronous, a few milliseconds.
  function showReprojected(job: Job, opts: { force?: boolean } = {}): FrameStats | null {
    if (bakedMode) return null
    // (a base that takes over here may be for the very view the camera is at: its picture is wanted all the same, which is why
    // the callers force it)
    takeHeld()
    const a = analysed
    if (!a || !canReproject(job, opts.force === true)) return null
    const started = performance.now()
    const at = clock()
    try {
      if (a.departedAt === null && turned(a.view, job.view)) a.departedAt = at
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
      if (adoption) return { strokes: strokes.count, ...adoption, paintMs: done - t1, kind: 'reproject', path: 'live', buildMs: 0, adopted: true }
      return { strokes: strokes.count, ms: done - started, gbufferMs: 0, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: done - t1, kind: 'reproject', path: 'live', buildMs: 0 }
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  // The camera moved: the newest base's strokes through the new view, painted and reported. Synchronous, and whatever the
  // model is doing at the time, whose result then replaces the base (run()).
  function reproject(job: Job): boolean {
    // (the picture of a base for the very view the camera is at is wanted too while it is still being eased in, or has just
    // taken over: a render() of a paused pointer carries the fade on, it does not cut it short with the base's own frame. An
    // answer that is held always has a fade on the base, which is what it waits for, and it is taken over in the paint.)
    const forced = fade !== null || pendingAdoption !== null
    if (!canReproject(job, forced)) return false
    const shown = showReprojected(job, { force: forced })
    // (a failure was shown as an error, and counts as handled: the model is not asked to make it again)
    if (shown) events.onFrame(shown)
    return true
  }

  // Does the picture on screen still change by itself? While a new base is being eased in, and while a model frame that was
  // adopted under a drag has not been painted yet. (A base's edges fade with its age too, but that is told at each frame
  // the camera's move asks for, and a camera that has stopped gets the model's own frame for its view.)
  function needsTick(): boolean {
    if (fade !== null && fade.to !== analysed) fade = null
    return analysed !== null && onScreenReprojected && (fade !== null || pendingAdoption !== null || held !== null)
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
    if (disposed || !lastJob || bakedMode) return
    // The settled frame is the request on screen now: a context that is lost after it paints this one again.
    lastJob = latest = { ...lastJob, seq: ++seq }
    pump()
  }

  // ---- the baked painting ----

  // Why the baked painting cannot be the picture on this device, or null: baked strokes are hidden by the view's depth (the renderer's depth pass,
  // in RG32F targets), and without it they would paint through the surfaces; and a bake that failed, or a depth test that did, stays off.
  function bakeUnavailable(): string | null {
    if (bakeBroken) return bakeBroken
    if (bakeOffWhy) return bakeOffWhy
    if (!renderer.capabilities.colorBufferFloat) return 'this graphics context cannot render to float targets, which the baked strokes\u2019 depth test needs'
    return null
  }

  // The status line's state, sent when it changes.
  function publish(): void {
    const status: BakeStatus = { path: bakedMode ? 'baked' : 'live', painting: paintingNow, why: bakedMode ? null : whyNot }
    const text = `${status.path}|${status.painting}|${status.why}`
    if (text === statusSent) return
    statusSent = text
    events.onBake?.(status)
  }

  const setPainting = (percent: number | null): void => {
    if (percent === paintingNow) return
    paintingNow = percent
    publish()
  }

  // The camera and the figure the picture is drawn for, leaving the baked path: what the per-frame painter starts from is a full frame of its own.
  function leaveBaked(keepWanting = false): void {
    if (bakedMode) {
      bakedMode = false
      renderer.setBakedSurfaces(null)
      surfacesSet = null
      analysed = null
      fade = null
      held = null
      pendingAdoption = null
      onScreenReprojected = false
    }
    if (!keepWanting) {
      bakeWant = null
      lastWant = null
      if (bakeTimer !== null) clearTimeout(bakeTimer)
      bakeTimer = null
      bakeDueAt = Number.NEGATIVE_INFINITY
      // (a bake in flight still lands; with nothing wanted, it is dropped)
      if (!bakeFlight) paintingNow = null
    }
    publish()
  }

  // The baked painting takes over the picture: what the per-frame painter held (its base, its fade, its timers, a request waiting) is let go; a model
  // frame still in the worker is dropped when it lands.
  function enterBaked(): void {
    if (bakedMode) return
    bakedMode = true
    if (settleTimer !== null) clearTimeout(settleTimer)
    settleTimer = null
    if (tickTimer !== null) clearTimeout(tickTimer)
    tickTimer = null
    if (resumeTimer !== null) clearTimeout(resumeTimer)
    resumeTimer = null
    latest = null
    flight = null
    analysed = null
    fade = null
    held = null
    pendingAdoption = null
    onScreenReprojected = false
    snapshotValid = false
    publish()
  }

  const paperRequest = (job: Job): SessionRequest => ({
    id: nextRequest++, sceneId: job.sceneId, kind: 'paper', params: job.params, view: job.view, gbuffer: null, debug: job.debug, havePaper: paperHeld, paper: paperFor(job.params, job.view),
  })

  // The canvas tile, from the model's thread, when the one held is not the one wanted (the live frames bring it with them; a bake's frames do not
  // ask the model for anything else). The picture is painted again when it lands.
  function ensurePaper(job: Job): void {
    if (paperFlight || paperKey(paperFor(job.params, job.view)) === paperHeld) return
    paperFlight = true
    void host.frame(paperRequest(job)).then((r) => {
      paperFlight = false
      if (disposed || !r.ok || r.kind !== 'paper' || !r.paper) return
      renderer.setPaper(r.paper.rgba, r.paper.height, r.paper.size)
      paperHeld = r.paper.key
      if (bakedMode && lastJob) reportBaked(lastJob)
    })
  }

  // The G-buffer for the silhouettes: read back without waiting, for the view painted, AT REST (not under a drag: nothing is read, and the silhouettes
  // read the canvas), when the one held is not for this view and these light parameters. A frame is given the one that was read for its own view; one
  // that lands for the view the camera is at paints the picture again.
  function wantGBuffer(job: Job): void {
    if (gFlight || disposed || job.target || job.view.dragging) return
    const light = JSON.stringify(job.params.light)
    const g = latestG
    if (g && g.sceneId === job.sceneId && g.light === light && sameCamera(g.view, job.view)) return
    gFlight = true
    const read = renderer.startGBuffer(job.view, job.params)
    void Promise.resolve(read).then((got) => {
      gFlight = false
      if (disposed || got === null) return
      latestG = { g: got, view: job.view, sceneId: job.sceneId, light }
      const now = lastJob
      if (!bakedMode || !now) return
      if (!now.view.dragging && sameCamera(job.view, now.view) && paintedG !== got) reportBaked(now)
      else wantGBuffer(now)
    })
  }

  // The frame of the baked painting for `job`, painted: the strokes this view shows (frameFromBake), then the renderer's paint. Null when it
  // cannot be made (no bake held for this scene); throws what the frame or the renderer throw.
  function paintBaked(job: Job): FrameStats | null {
    const h = heldBake
    if (!h || h.sceneId !== job.sceneId || h.colours !== job.colours) return null
    const started = performance.now()
    if (rendererScene !== job.scene) {
      renderer.setScene(job.scene, job.colours)
      rendererScene = job.scene
    }
    if (surfacesSet !== h.baked.surfaces) {
      renderer.setBakedSurfaces(h.baked.surfaces)
      surfacesSet = h.baked.surfaces
    }
    // (only the G-buffer that was read for this very view and light: the pixels of another view's are not this view's, and under a drag there is none)
    const lg = latestG
    const g = !job.view.dragging && lg !== null && lg.sceneId === job.sceneId && sameCamera(lg.view, job.view) && lg.light === JSON.stringify(job.params.light) ? lg.g : null
    const t0 = performance.now()
    // (into the arrays the engine keeps from frame to frame: a frame of 60k strokes is some 15 MB, and nothing holds one past its own paint, which copies it
    // into the GPU's buffers: `events.onPaint` is told of it as it is painted and must not keep it)
    const strokes = frameFromBakeWith(bakeScratch, h.baked, job.scene, job.view, job.params, g)
    const buildMs = performance.now() - t0
    paintedG = g
    const byRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
    for (let i = 0; i < strokes.count; i++) byRole[ROLES[strokes.role[i]]]++
    const frame: PaintFrameInput = { strokes, underpaint: null, debug: EMPTY_DEBUG, stats: { strokes: strokes.count, byRole, loads: 0 } }
    const t1 = performance.now()
    lastPaintAt = clock()
    renderer.paint(frame, job.view, job.params, job.debug)
    if (failure) throw new Error(failure)
    // A renderer whose context is lost paints nothing, and its stats are those of the paint before (a stale `depthTested: false` is no verdict on the device, and a bake
    // that lands, or a debug view that is left, while the context is lost must keep the baked path): the bake is held, and the restore asks for this picture again
    // (onContextRestored).
    if (!renderer.stats.painted) return null
    shownSeq = job.seq
    const finished = performance.now()
    const stats: FrameStats = { strokes: strokes.count, ms: finished - started, gbufferMs: 0, modelMs: 0, particlesMs: 0, paperMs: 0, paintMs: finished - t1, kind: 'baked', path: 'baked', buildMs }
    events.onPaint?.({ strokes, underpaint: EMPTY_F32, debug: EMPTY_DEBUG, stats: frame.stats }, 'baked')
    // The strokes must be hidden by the view's depth, and a renderer that could not draw it paints them through the surfaces: no baked painting then.
    if (!renderer.stats.depthTested && h.baked.surfaces.some((surface, m) => surface !== null && isOpaqueMesh(job.scene.marks[m]))) {
      breakBaked('the renderer could not depth-test the strokes on this device')
      return null
    }
    return stats
  }

  // The baked path cannot be used: why, said in the status line, and the per-frame painter takes the picture again.
  function breakBaked(why: string): void {
    bakeBroken = why
    whyNot = why
    console.warn(`The baked painting is off: ${why}.`)
    leaveBaked()
    const job = lastJob
    if (job && !disposed) {
      lastJob = latest = { ...job, seq: ++seq }
      pump()
    }
  }

  // Paint the baked frame for `job` and tell the lab (its stats, an error as the lab shows one).
  function reportBaked(job: Job): void {
    try {
      const stats = paintBaked(job)
      if (!stats) return
      events.onError(null)
      events.onFrame(stats)
      if (!disposed && bakedMode) wantGBuffer(job)
      ensurePaper(job)
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
    }
  }

  // What the held bake needs for the newest want: nothing, a recolour, or a new bake (debounced). One thing in flight at a time, always for the newest want.
  function maintainBake(): void {
    const want = bakeWant
    if (!want || disposed || bakeFlight) return
    const need = needOf(heldBake, want, needFresh)
    if (need === 'none') {
      if (bakeTimer !== null) clearTimeout(bakeTimer)
      bakeTimer = null
      setPainting(null)
      return
    }
    if (need === 'colour') {
      startRecolour(want)
      return
    }
    const wait = bakeDueAt - clock()
    if (wait <= 0) {
      startBake(want)
      return
    }
    setPainting(0)
    if (bakeTimer === null) {
      bakeTimer = setTimeout(() => {
        bakeTimer = null
        maintainBake()
      }, wait)
    }
  }

  // The bake in flight is abandoned for real (BakeHost.cancel: its worker is terminated and made again), and what it was making is not waited for.
  function cancelBake(): void {
    const flight = bakeFlight
    if (!flight) return
    bakeFlight = null
    bakeHost?.cancel()
    setPainting(null)
  }

  function startBake(want: BakeWant): void {
    const target = bakeHost
    if (!target) return
    const id = nextRequest++
    const flight = { id, kind: 'bake' as const, want }
    bakeFlight = flight
    setPainting(0)
    const request: BakeRequest = { id, sceneId: want.sceneId, params: want.params, lightDir: want.lightDir, authored: want.authored }
    void target.bake(request, (percent) => {
      if (bakeFlight === flight) setPainting(percent)
    }).then(
      (answer) => arriveBake(flight, answer),
      (error: unknown) => arriveBake(flight, { id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    )
  }

  function arriveBake(flight: NonNullable<typeof bakeFlight>, answer: BakeAnswer): void {
    // (cancelled, or the host was lost: what was waited for is not wanted any more)
    if (bakeFlight !== flight) return
    bakeFlight = null
    const made = flight.want
    if (disposed) return
    if (!answer.ok) {
      setPainting(null)
      if (answer.id === -1) return maintainBake()
      if ('error' in answer) {
        breakBaked(`the bake failed: ${answer.error}`)
        return
      }
      return maintainBake()
    }
    // (the inputs of the newest render, or of the last one before the baked path was left: a bake that is still right for them is kept, though it is
    // not shown until the baked path is wanted again)
    const now = bakeWant ?? lastSeenWant
    // Inputs that are no longer the newest: the bake is dropped (the one on screen stays), and the newest are baked.
    if (!now || staleFor(made, now, answer.baked)) {
      setPainting(null)
      return maintainBake()
    }
    // (the first frame of a bake makes its per-stroke anchors and each surface's vertex index once: tens of ms, here and not in a frame of a drag)
    prepareBake(answer.baked, made.scene)
    needFresh = false
    heldBake = {
      sceneId: made.sceneId, scene: made.scene, colours: made.colours, baked: answer.baked, bakeParams: made.params, colourParams: made.params,
      authored: made.authored, lightKey: made.lightKey,
    }
    setPainting(null)
    // The picture is the new bake's from now on: at once, from the view the camera is at (when the baked path is the one wanted).
    const job = lastJob
    if (bakeWant && job && job.sceneId === made.sceneId && job.colours === made.colours && !job.target) {
      enterBaked()
      lastJob = { ...job, seq: ++seq }
      reportBaked(lastJob)
    }
    maintainBake()
  }

  function startRecolour(want: BakeWant): void {
    const h = heldBake
    const target = bakeHost
    if (!h || !target) return
    const id = nextRequest++
    const flight = { id, kind: 'recolour' as const, want }
    bakeFlight = flight
    void target.recolour({ id, sceneId: h.sceneId, key: h.baked.key, params: want.params }).then(
      (answer) => arriveRecolour(flight, h, want, answer),
      (error: unknown) => arriveRecolour(flight, h, want, { id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    )
  }

  function arriveRecolour(flight: NonNullable<typeof bakeFlight>, h: HeldBake, want: BakeWant, answer: RecolourAnswer): void {
    if (bakeFlight !== flight) return
    bakeFlight = null
    if (disposed) return
    if (!answer.ok) {
      if (answer.id === -1) return maintainBake()
      if ('error' in answer) {
        breakBaked(`the recolour failed: ${answer.error}`)
        return
      }
      // the model's side does not hold this bake (another one was made there, or the model moved to this thread): a new bake
      needFresh = true
      bakeDueAt = Number.NEGATIVE_INFINITY
      return maintainBake()
    }
    if (heldBake !== h) return maintainBake()
    // Only the colour arrays came: swapped into the bake (every other array is the one held, so everything keyed to them stays), and into the GPU's buffers.
    h.baked = withColours(h.baked, answer.colours)
    h.colourParams = want.params
    if (bakedMode && surfacesSet) {
      renderer.updateBakedColours(h.baked.surfaces)
      surfacesSet = h.baked.surfaces
    }
    if (bakedMode && lastJob) reportBaked(lastJob)
    maintainBake()
  }

  // The newest baked-path render's inputs: when they are not the ones before, what the held bake needs is asked again, and a bake is due 150 ms after.
  function considerBake(want: BakeWant): void {
    const before = lastWant
    // (a frame of the same inputs, as a drag's are: nothing to ask again, and nothing computed)
    if (before && before.sceneId === want.sceneId && before.params === want.params && before.colours === want.colours && before.lightKey === want.lightKey && sameAuthored(before.authored, want.authored)) return
    bakeWant = want
    lastWant = want
    lastSeenWant = want
    // (a bake in the making that these inputs make useless is stopped now, not waited for: the debounce is for the next one)
    if (bakeFlight?.kind === 'bake' && uselessFor(bakeFlight.want, want)) cancelBake()
    if (needOf(heldBake, want, needFresh) === 'bake') bakeDueAt = clock() + BAKE_DEBOUNCE_MS
    maintainBake()
  }

  // The bake's worker died: no bake is made from now on (the lab does not move it to this thread unless &worker=0 asked for that), the status line
  // says so, and the per-frame painter draws.
  function bakeWorkerLost(reason: string): void {
    if (disposed) return
    console.warn(`The bake worker stopped (${reason}); the baked painting is off.`)
    const wasBaked = bakedMode
    // (a host that stopped its own worker is let go; one that did not is stopped now: the engine's dispose() no longer finds it)
    const lost = bakeHost
    bakeHost = null
    if (lost && (lost as unknown) !== host) lost.dispose()
    bakeOffWhy = `the bake worker stopped (${reason}), and a bake on this thread would stop the page (&worker=0 asks for that)`
    whyNot = bakeOffWhy
    bakeFlight = null
    if (bakeTimer !== null) clearTimeout(bakeTimer)
    bakeTimer = null
    paintingNow = null
    leaveBaked()
    const job = lastJob
    if (wasBaked && job) {
      lastJob = latest = { ...job, seq: ++seq }
      pump()
    }
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
        const plain = plainScene(sc)
        const data = colourDataOf(sc, co)
        host.setScene(id, plain, data)
        if (bakeHost && (bakeHost as unknown) !== host) bakeHost.setScene(id, plain, data)
      } else if (known.colours !== co) {
        known.colours = co
        const data = colourDataOf(sc, co)
        host.setColours(id, data)
        if (bakeHost && (bakeHost as unknown) !== host) bakeHost.setColours(id, data)
        // (a bake in the making is of the old colours)
        cancelBake()
        if (analysed?.sceneId === id) {
          analysed = null
          fade = null
          held = null
          pendingAdoption = null
        }
      }
      if (id !== sceneId) {
        // another figure: the base's strokes are not its, and no fade or adopted frame belongs to it
        fade = null
        held = null
        pendingAdoption = null
        latestG = null
        // and a bake in the making is of the old one: it is stopped, so the new figure's first frames (the model's worker, which a bake never
        // shared) and then its own bake are not made after it
        cancelBake()
      }
      sceneId = id
      sceneNow = sc
      coloursNow = co
    },

    render(view, params, debug, authored) {
      if (!sceneNow || !coloursNow) return
      const job: Job = { seq: ++seq, sceneId, scene: sceneNow, colours: coloursNow, view, params, debug, target: null, settle: null }
      lastJob = job
      // The baked painting is the picture when the light is fixed in the world, the renderer can depth-test strokes and no debug view is chosen (and
      // the page said what framing to bake for). While the first bake of a figure is made, the per-frame painter's frames are the picture.
      if (authored && URL_STATE.bake && params.light.worldFixed >= 0.5 && debug === 'none' && (findBakeHost() !== null || bakeOffWhy !== null)) {
        whyNot = bakeUnavailable()
        if (whyNot === null) {
          const [lx, ly, lz] = view.lightDir
          const want: BakeWant = { sceneId, scene: sceneNow, colours: coloursNow, params, lightDir: [lx, ly, lz], lightKey: lightKeyOf(view.lightDir), authored }
          considerBake(want)
          // The baked path is entered with a bake that is not stale for these params (or kept when it already is the picture: the old bake stays on
          // screen while the new one is made); coming back from the per-frame painter (a debug view, a camera-relative light) the live picture holds until
          // a bake for the params of the moment lands, and arriveBake takes over.
          const h = heldBake
          if (h && h.sceneId === sceneId && h.colours === coloursNow && (bakedMode || needOf(h, want, needFresh) !== 'bake')) {
            enterBaked()
            lastDragging = view.dragging
            reportBaked(job)
            return
          }
          leaveBaked(true)
        } else leaveBaked()
      } else {
        whyNot = null
        leaveBaked()
      }
      // the model is running for a view the camera has now left: its answer's strokes are stale from here
      if (flight && flight.movedAt === null && turned(flight.job.view, view)) flight.movedAt = clock()
      // (so is an answer that waits for a fade to end: its edges age from this turn, not from when it takes over)
      if (held && held.base.departedAt === null && turned(held.base.view, view)) held.base.departedAt = clock()
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
      held = null
      pendingAdoption = null
      flight = null
      if (bakeTimer !== null) clearTimeout(bakeTimer)
      bakeTimer = null
      heldBake = null
      bakeWant = null
      lastWant = null
      bakeFlight = null
      lastSeenWant = null
      latestG = null
      for (const t of tiles.splice(0)) t.settle?.reject(new Error('the engine was disposed'))
      sent.clear()
      sceneNow = null
      coloursNow = null
      analysed = null
      host.dispose()
      if (bakeHost && (bakeHost as unknown) !== host) bakeHost.dispose()
      bakeHost = null
      renderer.dispose()
    },
  }
}
