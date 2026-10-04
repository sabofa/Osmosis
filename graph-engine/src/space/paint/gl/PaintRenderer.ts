// The paint renderer (spec 2026-10-02-painted-figures-design.md §4).
//
// It owns one WebGL2 context and draws what the paint model decides:
//   renderGBuffer   the shadow map and the G-buffer, read back at half the CSS
//                   resolution for the model (value, normal, depth, mark);
//   paint           the underpainting (the model's image of the colour of every
//                   pixel of a form, laid first; or, with baked surfaces set and no image,
//                   the baked surfaces drawn from this view into the same kind of image:
//                   bakedSurfaces.ts), the model's strokes, one
//                   instanced draw per layer with a procedural oil brush and wet
//                   pickup, then the canvas and impasto composite; or one of the
//                   debug views. A frame that is a RE-PROJECTION (the camera moved and
//                   the model did not run: PaintReproject) is also put through the new
//                   view's depth: a depth-only pass of the opaque meshes, which hides
//                   the strokes the new view's surfaces cover and warps the underpainting
//                   onto the new view (shaders/depth.ts, warp.ts). A baked frame (one whose
//                   strokes carry `hidden`, the baked painting's) is put through that depth
//                   too, and its data lines with a dashed hidden style are drawn again where
//                   a surface hides them, dashed (strokes.ts, shaders/stroke.ts).
//
// Scene positions are used as the scene gives them: PaintView's matrices must
// map scene space (see meshes.ts). Strokes arrive in CSS px of the view.
// Only space/paint/gl/ touches WebGL, and nothing in here reads a clock or a
// random source: the same frame draws the same pixels.
//
// Nothing throws out of a public method after construction: a shader failure
// or an unexpected GL error is reported through onError and the renderer then
// draws nothing. The constructor throws, with a message the lab shows, when
// WebGL2 is missing.

import { createContext, queryCapabilities, watchContext, type GlCapabilities } from '../../gl/context'
import { ProgramCache, type ProgramInfo } from '../../gl/program'
import type { BakedSurface } from '../bake/types'
import type { SceneColours, GBuffer, PaintDebugMode, PaintFrameInput, PaintView } from '../types'
import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { createBakedTarget, drawBakedDilate, drawBakedSurfaces, recolourBaked, uploadBaked, type BakedGpu, type BakedTarget } from './bakedSurfaces'
import { createPaperGpu, destroyPaperGpu, drawComposite, DEFAULT_TONE, type PaperGpu } from './composite'
import { createSceneDepthTarget, depthBias, NO_SURFACE, originMatrix, type SceneDepthTarget } from './depth'
import {
  DebugRenderer,
  planesImage,
  planeTintImage,
  valueImage,
  zonesImage,
} from './debug'
import {
  createGBufferTarget,
  depthRangeFor,
  emptyGBuffer,
  GBUFFER_SCALE,
  gbufferMatrix,
  gbufferSize,
  isPerspective,
  ReadbackScratch,
  beginFloatRead,
  canReadAsync,
  dropRead,
  finishFloatRead,
  pollRead,
  readGBuffer,
  type GBufferTarget,
  type PackBuffer,
  type PendingRead,
} from './gbuffer'
import { uploadScene, type SceneGpu } from './meshes'
import { Resources, type Gl } from './resources'
import { createShadowTarget, lightFrame, SHADOW_FIT, SHADOW_SIZE, type ShadowTarget } from './shadow'
import { COPY_FRAGMENT, EDGE_FRAGMENT, EDGE_VERTEX, IMAGE_FRAGMENT } from './shaders/blit'
import { COMPOSITE_FRAGMENT } from './shaders/composite'
import { FULLSCREEN_VERTEX } from './shaders/common'
import { DEPTH_FRAGMENT, DEPTH_VERTEX } from './shaders/depth'
import { GBUFFER_VERTEX, gbufferFragment } from './shaders/gbuffer'
import { BAKED_DILATE_FRAGMENT, BAKED_FRAGMENT, BAKED_VERTEX } from './shaders/bakedUnderpaint'
import { SHADOW_FRAGMENT, SHADOW_VERTEX } from './shaders/shadow'
import { STROKE_FRAGMENT, STROKE_VERTEX } from './shaders/stroke'
import { UNDERPAINT_FRAGMENT, UNDERPAINT_WARP_FRAGMENT } from './shaders/underpaint'
import { createAccumTargets, StrokeRenderer, type AccumTargets } from './strokes'
import { UnderpaintRenderer } from './underpaint'
import { inverseViewProj } from './warp'

export interface PaintRendererOptions {
  // A shader failure or unexpected GL error, as a plain-text reason.
  onError?: (message: string) => void
  onContextLost?: () => void
  onContextRestored?: () => void
}

// What a re-projected frame needs besides the frame: the view its strokes' world paths and its underpainting were
// made for, and that view's G-buffer depth (G-buffer size, row 0 the top, +Infinity where nothing is drawn), which
// the underpainting's warp reads to find which points the old view saw.
export interface PaintReproject {
  from: PaintView
  depth: Float32Array
}

export interface PaintStats {
  // The G-buffer layout in use, and whether the accumulation targets are float.
  gbuffer: 'float' | 'rgba8' | null
  accumFloat: boolean | null
  // Whether the last paint() drew a frame at all. False when it could not: the context is lost (the picture comes back when it is restored), the renderer
  // has failed or is disposed, or the frame's accumulation targets could not be made. Every other number here is of the last paint() that DID draw (or is
  // reset by one): a caller that reads depthTested or strokes after a paint() that painted nothing reads what the paint before it left, so it asks `painted` first.
  painted: boolean
  // Strokes drawn and instanced draws made by the last paint().
  strokes: number
  strokeDraws: number
  // Whether the last paint() drew the depth pass and tested the strokes against it, and warped the underpainting.
  depthTested: boolean
  underpaintWarped: boolean
  // Whether the last paint() drew its underpainting from the baked surfaces, and how many surfaces that drew.
  underpaintBaked: boolean
  bakedSurfaces: number
  // How the last G-buffer was read back: 'async' through a pack buffer and a fence (the page never waited for the GPU),
  // 'sync' with readPixels into an array.
  gbufferRead: 'sync' | 'async' | null
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1))

// What a frame with no underpainting image hands the underpainting: nothing to lay.
const NO_IMAGE = new Float32Array(0)

const SHADOW_PROGRAM = { name: 'shadow', vertex: SHADOW_VERTEX, fragment: SHADOW_FRAGMENT }
const GBUFFER_FLOAT_PROGRAM = { name: 'gbuffer-float', vertex: GBUFFER_VERTEX, fragment: gbufferFragment(true) }
const GBUFFER_RGBA8_PROGRAM = { name: 'gbuffer-rgba8', vertex: GBUFFER_VERTEX, fragment: gbufferFragment(false) }
const STROKE_PROGRAM = { name: 'stroke', vertex: STROKE_VERTEX, fragment: STROKE_FRAGMENT }
const UNDERPAINT_PROGRAM = { name: 'underpaint', vertex: FULLSCREEN_VERTEX, fragment: UNDERPAINT_FRAGMENT }
const UNDERPAINT_WARP_PROGRAM = { name: 'underpaint-warp', vertex: FULLSCREEN_VERTEX, fragment: UNDERPAINT_WARP_FRAGMENT }
const DEPTH_PROGRAM = { name: 'depth', vertex: DEPTH_VERTEX, fragment: DEPTH_FRAGMENT }
const BAKED_PROGRAM = { name: 'baked-surfaces', vertex: BAKED_VERTEX, fragment: BAKED_FRAGMENT }
const BAKED_DILATE_PROGRAM = { name: 'baked-dilate', vertex: FULLSCREEN_VERTEX, fragment: BAKED_DILATE_FRAGMENT }
const COPY_PROGRAM = { name: 'copy', vertex: FULLSCREEN_VERTEX, fragment: COPY_FRAGMENT }
const COMPOSITE_PROGRAM = { name: 'composite', vertex: FULLSCREEN_VERTEX, fragment: COMPOSITE_FRAGMENT }
const IMAGE_PROGRAM = { name: 'image', vertex: FULLSCREEN_VERTEX, fragment: IMAGE_FRAGMENT }
const EDGE_PROGRAM = { name: 'edges', vertex: EDGE_VERTEX, fragment: EDGE_FRAGMENT }

export class PaintRenderer {
  readonly stats: PaintStats = {
    gbuffer: null,
    accumFloat: null,
    painted: false,
    strokes: 0,
    strokeDraws: 0,
    depthTested: false,
    underpaintWarped: false,
    underpaintBaked: false,
    bakedSurfaces: 0,
    gbufferRead: null,
  }

  private readonly canvas: HTMLCanvasElement
  private readonly options: PaintRendererOptions
  private readonly gl: Gl
  private caps: GlCapabilities
  private readonly unwatch: () => void
  private readonly programs = new ProgramCache()
  // Long-lived targets and textures; the scene's meshes have their own so a
  // new scene replaces them without touching the rest.
  private readonly res: Resources
  private readonly sceneRes: Resources
  // The baked surfaces' buffers, apart from the scene's so a new bake replaces them without touching the rest.
  private readonly bakedRes: Resources
  private readonly strokes: StrokeRenderer
  private readonly underpaint: UnderpaintRenderer
  private readonly debugger: DebugRenderer
  private readonly scratch = new ReadbackScratch()
  // The buffer an asynchronous G-buffer readback goes to, and whether the context can do one (asked once).
  private pack: PackBuffer = { buffer: null, bytes: 0 }
  private asyncRead: boolean | null = null
  // Counts the contexts the renderer has had (a restore makes a new one): a read that was started on one is not finished on
  // another, even when the loss and the restore both came between two polls.
  private contextGeneration = 0

  private scene: SpaceScene | null = null
  private sceneGpu: SceneGpu | null = null
  // The baked surfaces last given (kept: the buffers are uploaded again when a lost context comes back), their upload, and the
  // image they are drawn into before it is dilated into the underpainting.
  private bakedSource: (BakedSurface | null)[] | null = null
  private baked: BakedGpu | null = null
  private bakedTarget: BakedTarget | null = null
  private bakedTargetKey = ''
  private bakedTargetFailed = false
  private paperCpu: { rgba: Uint8ClampedArray; height: Float32Array; size: number } | null = null
  private paper: PaperGpu | null = null
  private defaultPaper: PaperGpu | null = null
  private shadow: ShadowTarget | null = null
  private gbuffer: GBufferTarget | null = null
  private gbufferKey = ''
  private accum: AccumTargets | null = null
  private accumKey = ''
  // The scene's depth for the view being painted (a re-projected frame's), at the paint's size; a context that cannot
  // render to RG32F is not retried.
  private sceneDepth: SceneDepthTarget | null = null
  private sceneDepthKey = ''
  private sceneDepthFailed = false
  // The same depth at the G-buffer's size and in its orientation, which the baked surfaces are tested against.
  private underDepth: SceneDepthTarget | null = null
  private underDepthKey = ''
  private underDepthFailed = false
  // Float targets that proved incomplete on this context are not retried.
  private gbufferFloatFailed = false
  private accumFloatFailed = false

  private failed = false
  private lost = false
  private disposed = false

  // Throws when WebGL2 is not available; the message is for the lab to show.
  constructor(canvas: HTMLCanvasElement, options: PaintRendererOptions = {}) {
    this.canvas = canvas
    this.options = options
    const context = createContext(canvas)
    if ('error' in context) throw new Error(context.error)
    this.gl = context.gl
    this.caps = context.capabilities
    this.res = new Resources(this.gl)
    this.sceneRes = new Resources(this.gl)
    this.bakedRes = new Resources(this.gl)
    this.strokes = new StrokeRenderer(this.gl, this.res)
    this.underpaint = new UnderpaintRenderer(this.gl, this.res)
    this.debugger = new DebugRenderer(this.gl, this.res)
    this.unwatch = watchContext(
      canvas,
      () => this.handleLost(),
      () => this.handleRestored(),
    )
  }

  get capabilities(): GlCapabilities {
    return this.caps
  }

  // Upload the scene's opaque meshes (positions, normals and their mark
  // index) for the shadow and G-buffer passes. `colours` is the lab's colour
  // resolver for the model; the renderer only ever draws colours it is given.
  setScene(scene: SpaceScene, colours: SceneColours): void {
    void colours
    // A scene is immutable once built: the same object keeps its upload.
    if (scene === this.scene && this.sceneGpu) return
    this.scene = scene
    this.uploadSceneNow()
  }

  // The canvas tile: sRGB RGBA8 and a 0..1 height, `size` x `size` texels,
  // tiled in screen space at 1:1 device px.
  setPaper(rgba: Uint8ClampedArray, height: Float32Array, size: number): void {
    if (!(size >= 1) || rgba.length < size * size * 4 || height.length < size * size) {
      this.report(`paint: a paper tile of ${size} x ${size} needs ${size * size * 4} colour bytes and ${size * size} heights`)
      return
    }
    this.paperCpu = { rgba, height, size }
    this.uploadPaperNow()
  }

  // The baked painting's refined surfaces (bake/types.ts BakedPainting.surfaces, one per scene mark, null for a non-mesh),
  // uploaded once per bake. While they are set, a frame with no underpainting image (`underpaint` null or empty) has its
  // underpainting drawn from them for the view painted, instead of laid from an image; a frame with an image is laid from the
  // image as ever. Null goes back to the image path. The surfaces are kept: a lost context's buffers are uploaded again when
  // it is restored.
  setBakedSurfaces(surfaces: (BakedSurface | null)[] | null): void {
    if (surfaces === this.bakedSource && (this.baked || surfaces === null)) return
    this.bakedSource = surfaces
    this.uploadBakedNow()
    // none set: what only the surface pass used goes too (its image, its depth, the framebuffer on the underpainting)
    if (surfaces === null) this.freeBakedTargets()
  }

  // The same surfaces recoloured (a colour-only change of the parameters, bake/types.ts RecolourBake): only the colour buffers
  // are written, nothing else is uploaded again. Surfaces that are not the ones set (another vertex count, or one that now has
  // coverage and had none) are uploaded in full.
  updateBakedColours(surfaces: (BakedSurface | null)[]): void {
    const had = this.baked
    // (kept for a context that comes back)
    this.bakedSource = surfaces
    if (!had) {
      // nothing is uploaded: none were set before, or the context is lost (the restore uploads these)
      if (this.usable()) this.uploadBakedNow()
      return
    }
    if (!this.usable()) return
    try {
      if (!recolourBaked(this.gl, had, surfaces)) this.uploadBakedNow()
    } catch (error) {
      if (this.gone()) return
      this.fail(error)
    }
  }

  // The shadow map and the G-buffer, read back at half the CSS resolution: the page waits for the GPU to be done with it.
  renderGBuffer(view: PaintView, params: PaintParams): GBuffer {
    const size = gbufferSize(view.width, view.height)
    if (!this.usable()) return emptyGBuffer(size.width, size.height)
    try {
      const pass = this.gbufferPass(view, params)
      if (!pass) return emptyGBuffer(size.width, size.height)
      this.stats.gbufferRead = 'sync'
      return readGBuffer(this.gl, pass.target, this.scratch, pass.depthRange)
    } catch (error) {
      this.fail(error)
      return emptyGBuffer(size.width, size.height)
    }
  }

  // The same G-buffer, read back without the page waiting for the GPU: the passes are drawn now, the readback goes to a
  // pack buffer behind a fence, and the G-buffer comes as a promise, kept when the fence has passed (polled without
  // waiting, between the page's other tasks, a paint of a drag among them). A context that cannot do that (no fence, the
  // rgba8 layout, a test's fake) reads it the plain way at once and gives the G-buffer itself, not a promise: the caller
  // takes it in the same task, as it always did. Never rejects: a failure is reported through onError and the G-buffer is empty.
  // Null (or a promise of null) is no G-buffer at all: the context is lost, or went while the GPU worked (or the renderer was
  // disposed). It is not an empty scene and must not go to the model as one (the frame it made would be blank, and become
  // the base): the caller asks again when the context is back.
  startGBuffer(view: PaintView, params: PaintParams): GBuffer | null | Promise<GBuffer | null> {
    const size = gbufferSize(view.width, view.height)
    const empty = () => emptyGBuffer(size.width, size.height)
    if (this.gone()) return null
    if (!this.usable()) return empty()
    try {
      const pass = this.gbufferPass(view, params)
      if (!pass) return empty()
      if (this.asyncRead === null) this.asyncRead = canReadAsync(this.gl)
      const pending: PendingRead | null = pass.target.mode === 'float' && this.asyncRead ? beginFloatRead(this.gl, this.res, pass.target, this.pack, this.contextGeneration) : null
      if (!pending) {
        this.stats.gbufferRead = 'sync'
        return readGBuffer(this.gl, pass.target, this.scratch, pass.depthRange)
      }
      this.stats.gbufferRead = 'async'
      return this.finishRead(pending, empty)
    } catch (error) {
      // (a context that went while the passes were drawn is a loss, not a failure of the renderer)
      if (this.gone()) return null
      this.fail(error)
      return empty()
    }
  }

  private async finishRead(pending: PendingRead, empty: () => GBuffer): Promise<GBuffer | null> {
    let finished = false
    try {
      for (;;) {
        // the context went while the GPU worked, even if another has come back since (the fence and the buffer are of the
        // one that went), or the renderer was disposed: nothing to read
        if (this.gone() || pending.generation !== this.contextGeneration) return null
        const status = pollRead(this.gl, pending)
        if (status === 'ready') break
        if (status === 'failed') throw new Error('paint: the G-buffer readback failed')
        await pause()
      }
      const g = finishFloatRead(this.gl, pending, this.pack, this.scratch)
      finished = true
      return g
    } catch (error) {
      // (what GL threw as the context went)
      if (this.gone()) return null
      this.fail(error)
      return empty()
    } finally {
      // (finishFloatRead deletes the fence of a read that was finished; every other way out gives it back here)
      if (!finished) dropRead(this.gl, pending)
    }
  }

  // The shadow map pass and the G-buffer pass; the target holds the G-buffer when it returns (null: no scene, nothing to
  // read). Throws what GL throws.
  private gbufferPass(view: PaintView, params: PaintParams): { target: GBufferTarget; depthRange: [number, number] } | null {
    const scene = this.sceneGpu
    if (!scene || scene.meshes.length === 0) return null
    const size = gbufferSize(view.width, view.height)
    const target = this.ensureGBuffer(size.width, size.height)
    const shadow = this.ensureShadow()
    const gbufferProgram = this.program(target?.mode === 'float' ? GBUFFER_FLOAT_PROGRAM : GBUFFER_RGBA8_PROGRAM)
    const shadowProgram = this.program(SHADOW_PROGRAM)
    if (!target || !shadow) return null
    const gl = this.gl
    const radius = scene.radius * SHADOW_FIT
    const light = lightFrame(view.lightDir, radius)

    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.depthMask(true)

    // Pass 1: the shadow map, depth only, from the key light.
    const shadows = params.light.shadows >= 0.5
    if (shadows) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fbo)
      gl.viewport(0, 0, shadow.size, shadow.size)
      gl.clearDepth(1)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(1.5, 3)
      gl.useProgram(shadowProgram.program)
      gl.uniformMatrix4fv(shadowProgram.uniform('u_lightViewProj'), false, light.matrix)
      for (const mesh of scene.meshes) {
        gl.bindVertexArray(mesh.vao)
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
      }
      gl.disable(gl.POLYGON_OFFSET_FILL)
    }

    // Pass 2: the G-buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.width, target.height)
    if (target.mode === 'float') {
      // Empty: no mark in the packed number, depth far away.
      gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 1e30, 0]))
    } else {
      for (let i = 0; i < 3; i++) gl.clearBufferfv(gl.COLOR, i, new Float32Array(4))
    }
    gl.clearDepth(1)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.useProgram(gbufferProgram.program)
    const o = scene.origin
    const depthRange = depthRangeFor(view, o, radius)
    const depthBase = (o[0] - view.eye[0]) * view.viewDir[0] + (o[1] - view.eye[1]) * view.viewDir[1] + (o[2] - view.eye[2]) * view.viewDir[2]
    gl.uniformMatrix4fv(gbufferProgram.uniform('u_viewProj'), false, gbufferMatrix(view.viewProj, o, view.width, view.height, target.width, target.height))
    gl.uniformMatrix4fv(gbufferProgram.uniform('u_lightViewProj'), false, light.matrix)
    gl.uniform3f(gbufferProgram.uniform('u_relEye'), view.eye[0] - o[0], view.eye[1] - o[1], view.eye[2] - o[2])
    gl.uniform3f(gbufferProgram.uniform('u_viewDir'), view.viewDir[0], view.viewDir[1], view.viewDir[2])
    gl.uniform1i(gbufferProgram.uniform('u_perspective'), isPerspective(view.viewProj) ? 1 : 0)
    gl.uniform3f(gbufferProgram.uniform('u_lightDir'), light.toward[0], light.toward[1], light.toward[2])
    gl.uniform1f(gbufferProgram.uniform('u_intensity'), params.light.intensity)
    gl.uniform1f(gbufferProgram.uniform('u_ambient'), params.light.ambient)
    gl.uniform1f(gbufferProgram.uniform('u_sky'), params.light.sky)
    gl.uniform1f(gbufferProgram.uniform('u_bounce'), params.light.bounce)
    gl.uniform1i(gbufferProgram.uniform('u_shadows'), shadows ? 1 : 0)
    gl.uniform1f(gbufferProgram.uniform('u_shadowTexel'), 1 / SHADOW_SIZE)
    gl.uniform1f(gbufferProgram.uniform('u_depthBase'), depthBase)
    gl.uniform2f(gbufferProgram.uniform('u_depthRange'), depthRange[0], depthRange[1])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, shadow.depth)
    gl.uniform1i(gbufferProgram.uniform('u_shadowMap'), 0)
    for (const mesh of scene.meshes) {
      gl.uniform1f(gbufferProgram.uniform('u_mark'), mesh.mark)
      gl.bindVertexArray(mesh.vao)
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
    }
    gl.bindVertexArray(null)
    return { target, depthRange }
  }

  // Draw a frame to the canvas. `reproject` is given for a frame whose strokes were made for another view: they are
  // put through this view's depth (a stroke that a nearer surface covers is hidden, one that has left its surface is
  // clipped), and the underpainting is warped onto this view, instead of lying on the glass.
  paint(frame: PaintFrameInput, view: PaintView, params: PaintParams, debug: PaintDebugMode, reproject?: PaintReproject): void {
    // (nothing is drawn until it says so: a paint that returns early, on a lost context, has painted nothing, whatever the last one left in the stats)
    this.stats.painted = false
    if (!this.usable()) return
    try {
      const gl = this.gl
      const backing = this.syncCanvasSize(view)
      const cssSize: [number, number] = [view.width, view.height]
      const size = gbufferSize(view.width, view.height)
      const covered = {
        width: view.width / (size.width * GBUFFER_SCALE),
        height: view.height / (size.height * GBUFFER_SCALE),
      }
      this.stats.strokes = 0
      this.stats.strokeDraws = 0
      this.stats.depthTested = false
      this.stats.underpaintWarped = false
      this.stats.underpaintBaked = false
      this.stats.bakedSurfaces = 0

      if (debug === 'value' || debug === 'zones' || debug === 'planes' || debug === 'edges') {
        const image = this.program(IMAGE_PROGRAM)
        const d = frame.debug
        let rgba: Uint8Array
        if (debug === 'value') rgba = valueImage(d.value)
        else if (debug === 'zones') rgba = zonesImage(d)
        else if (debug === 'planes') rgba = planesImage(d)
        else rgba = planeTintImage(d)
        // The model's arrays are at G-buffer size; anything else cannot be shown.
        if (rgba.length !== size.width * size.height * 4) rgba = new Uint8Array(size.width * size.height * 4)
        this.debugger.drawImage(image, rgba, size.width, size.height, backing, covered)
        if (debug === 'edges') this.debugger.drawEdges(this.program(EDGE_PROGRAM), d, cssSize, backing)
        this.stats.painted = true
        return
      }

      const accum = this.ensureAccum(backing.width, backing.height)
      if (!accum) return
      const paper = this.ensurePaperGpu()
      const roles = debug === 'roles'
      const { plan, layout } = this.strokes.upload(frame.strokes)
      // A re-projected frame: the new view's depth, drawn first (it binds a framebuffer of its own). So is a baked frame
      // (the baked painting's: its strokes carry `hidden`): its strokes are the bake's projected through this view, and
      // what a surface hides of them is the depth's to say, which the hidden pass also reads.
      const depth = reproject || frame.strokes.hidden ? this.renderSceneDepth(view, backing.width, backing.height) : null
      // The underpainting goes first (not into the flat role view, where it would muddy the role colours). An
      // image that is not the G-buffer's size, or covers nothing, is not laid. A frame with no image at all, while baked
      // surfaces are set, has the surfaces drawn for this view instead.
      const image = frame.underpaint
      const bakedUnder = !roles && (image === null || image.length === 0) && this.baked !== null && this.baked.surfaces.length > 0
      const laid = bakedUnder ? this.drawBakedUnderpaint(view, size, paper.height) : !roles && this.underpaint.prepare(image ?? NO_IMAGE, size.width, size.height)
      const oldView = reproject?.from
      const inverse = depth && oldView ? inverseViewProj(view) : null
      // (the baked underpainting was drawn for this very view: nothing to warp)
      const warp =
        laid && !bakedUnder && depth && reproject && oldView && inverse && this.underpaint.setOldDepth(reproject.depth, size.width, size.height)
      this.stats.underpaintWarped = Boolean(warp)
      this.stats.underpaintBaked = bakedUnder && laid
      const common = {
        paper,
        width: backing.width,
        height: backing.height,
        pixelRatio: view.pixelRatio,
        covered,
        params,
      }
      const first = laid
        ? () => {
            if (warp && depth && oldView && inverse) {
              this.underpaint.drawWarped(
                { program: this.program(UNDERPAINT_WARP_PROGRAM), ...common },
                {
                  program: this.program(UNDERPAINT_WARP_PROGRAM),
                  sceneDepth: depth.target.texture,
                  bias: depth.bias,
                  invViewProj: Float32Array.from(inverse),
                  eye: view.eye,
                  viewDir: view.viewDir,
                  oldViewProj: Float32Array.from(oldView.viewProj),
                  oldEye: oldView.eye,
                  oldViewDir: oldView.viewDir,
                  oldCss: [oldView.width, oldView.height],
                },
              )
            } else this.underpaint.draw({ program: this.program(UNDERPAINT_PROGRAM), ...common })
          }
        : null
      const result = this.strokes.run(
        {
          stroke: this.program(STROKE_PROGRAM),
          copy: this.program(COPY_PROGRAM),
          targets: accum,
          paper,
          cssSize,
          pixelRatio: view.pixelRatio,
          texture: params.canvas.texture,
          debugRoles: roles,
          depthTest: depth
            ? {
                texture: depth.target.texture,
                viewDir: view.viewDir,
                eyeDot: view.eye[0] * view.viewDir[0] + view.eye[1] * view.viewDir[1] + view.eye[2] * view.viewDir[2],
                bias: depth.bias,
              }
            : null,
        },
        plan,
        layout,
        first,
      )
      this.stats.strokes = plan.count
      this.stats.strokeDraws = result.draws
      this.stats.depthTested = depth !== null
      drawComposite(gl, {
        program: this.program(COMPOSITE_PROGRAM),
        paint: result.final,
        paper,
        heightScale: accum.heightScale,
        width: backing.width,
        height: backing.height,
        pixelRatio: view.pixelRatio,
        params,
        noCanvas: debug === 'paint-only' || roles,
        relief: !roles,
        grey: debug === 'grey',
      })
      this.stats.painted = true
    } catch (error) {
      this.fail(error)
    }
  }

  // Frees every GL object and releases the context.
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unwatch()
    const gl = this.gl
    if (!this.lost && !gl.isContextLost()) {
      this.strokes.destroy()
      this.underpaint.destroy()
      this.debugger.destroy()
      this.res.disposeAll()
      this.sceneRes.disposeAll()
      this.bakedRes.disposeAll()
      this.programs.deleteAll(gl)
      // Deleting resources does not release the context itself, and browsers
      // cap live contexts: release it on purpose.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } else {
      this.res.forget()
      this.sceneRes.forget()
      this.bakedRes.forget()
      this.programs.forget()
    }
    this.sceneGpu = null
    this.scene = null
    this.bakedSource = null
    this.baked = null
    this.bakedTarget = null
    this.underDepth = null
    this.paper = null
    this.defaultPaper = null
    this.shadow = null
    this.gbuffer = null
    this.accum = null
    this.sceneDepth = null
    this.pack = { buffer: null, bytes: 0 }
    this.paperCpu = null
  }

  // --- internals ----------------------------------------------------------

  private usable(): boolean {
    return !this.failed && !this.gone()
  }

  // The context is lost, or the renderer is disposed: there is nothing to draw on and nothing to read from.
  private gone(): boolean {
    return this.lost || this.disposed || this.gl.isContextLost()
  }

  private program(spec: { name: string; vertex: string; fragment: string }): ProgramInfo {
    return this.programs.get(this.gl, spec.name, spec.vertex, spec.fragment)
  }

  // Resizing follows the canvas's client size times the pixel ratio.
  private syncCanvasSize(view: PaintView): { width: number; height: number } {
    const cssWidth = this.canvas.clientWidth || view.width
    const cssHeight = this.canvas.clientHeight || view.height
    const width = Math.max(1, Math.round(cssWidth * view.pixelRatio))
    const height = Math.max(1, Math.round(cssHeight * view.pixelRatio))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    return { width, height }
  }

  private uploadSceneNow(): void {
    if (!this.scene || !this.usable()) return
    try {
      this.sceneRes.disposeAll()
      this.sceneGpu = uploadScene(this.gl, this.sceneRes, this.scene)
    } catch (error) {
      this.fail(error)
    }
  }

  private uploadPaperNow(): void {
    if (!this.paperCpu || !this.usable()) return
    try {
      destroyPaperGpu(this.res, this.paper)
      const { rgba, height, size } = this.paperCpu
      this.paper = createPaperGpu(this.gl, this.res, rgba, height, size)
    } catch (error) {
      this.fail(error)
    }
  }

  // The paper to draw with: the set tile, or a flat warm tone.
  private ensurePaperGpu(): PaperGpu {
    if (this.paper) return this.paper
    if (this.defaultPaper) return this.defaultPaper
    const rgba = new Uint8ClampedArray([
      Math.round(DEFAULT_TONE[0] * 255),
      Math.round(DEFAULT_TONE[1] * 255),
      Math.round(DEFAULT_TONE[2] * 255),
      255,
    ])
    const made = createPaperGpu(this.gl, this.res, rgba, new Float32Array(1), 1)
    if (!made) throw new Error('paint: could not create the default paper')
    this.defaultPaper = made
    return made
  }

  // The opaque meshes' view depth for `view`, into a target of the paint's size (the strokes are drawn into
  // targets of that size, in the same orientation, so a stroke's pixel is the depth's pixel). Null when there is no
  // scene, or the context cannot render to RG32F: the strokes are then not tested.
  private renderSceneDepth(view: PaintView, width: number, height: number): { target: SceneDepthTarget; bias: number } | null {
    const scene = this.sceneGpu
    if (!scene || scene.meshes.length === 0 || !this.caps.colorBufferFloat || this.sceneDepthFailed) return null
    const key = `${width}x${height}`
    if (!this.sceneDepth || this.sceneDepthKey !== key) {
      this.sceneDepth?.destroy()
      this.sceneDepth = createSceneDepthTarget(this.gl, this.res, width, height)
      this.sceneDepthKey = key
      if (!this.sceneDepth) this.sceneDepthFailed = true
    }
    const target = this.sceneDepth
    if (!target) return null
    this.drawSceneDepth(scene, target, originMatrix(view.viewProj, scene.origin), view, width, height)
    return { target, bias: depthBias(scene.radius) }
  }

  // The opaque meshes' view depth, again, at the G-buffer's size and in its orientation (row 0 the top): what the baked
  // surfaces drawn into the underpainting are tested against, pixel for pixel. Null when there is no scene, or the context
  // cannot render to RG32F: the surfaces are then tested against each other only.
  private renderUnderDepth(view: PaintView, width: number, height: number): { target: SceneDepthTarget; bias: number } | null {
    const scene = this.sceneGpu
    if (!scene || scene.meshes.length === 0 || !this.caps.colorBufferFloat || this.underDepthFailed) return null
    const key = `${width}x${height}`
    if (!this.underDepth || this.underDepthKey !== key) {
      this.underDepth?.destroy()
      this.underDepth = createSceneDepthTarget(this.gl, this.res, width, height)
      this.underDepthKey = key
      if (!this.underDepth) this.underDepthFailed = true
    }
    const target = this.underDepth
    if (!target) return null
    this.drawSceneDepth(scene, target, gbufferMatrix(view.viewProj, scene.origin, view.width, view.height, width, height), view, width, height)
    return { target, bias: depthBias(scene.radius) }
  }

  // The depth pass: the opaque meshes through `matrix` (the view's with the scene's origin folded in) into `target`.
  private drawSceneDepth(scene: SceneGpu, target: SceneDepthTarget, matrix: Float32Array, view: PaintView, width: number, height: number): void {
    const gl = this.gl
    const program = this.program(DEPTH_PROGRAM)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.depthMask(true)
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([NO_SURFACE, 0, 0, 0]))
    gl.clearDepth(1)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program.program)
    const o = scene.origin
    gl.uniformMatrix4fv(program.uniform('u_viewProj'), false, matrix)
    gl.uniform3f(program.uniform('u_viewDir'), view.viewDir[0], view.viewDir[1], view.viewDir[2])
    gl.uniform1f(
      program.uniform('u_depthBase'),
      (o[0] - view.eye[0]) * view.viewDir[0] + (o[1] - view.eye[1]) * view.viewDir[1] + (o[2] - view.eye[2]) * view.viewDir[2],
    )
    for (const mesh of scene.meshes) {
      gl.uniform1f(program.uniform('u_ground'), mesh.ground ? 1 : 0)
      gl.bindVertexArray(mesh.vao)
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
    }
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // The baked surfaces' underpainting for `view`: the surfaces drawn into an image the G-buffer's size (tested against the
  // scene's depth there), then its rim dilated into the underpainting texture, where the composite reads it as it reads an
  // uploaded image. False when nothing could be drawn (no surfaces, no target).
  private drawBakedUnderpaint(view: PaintView, size: { width: number; height: number }, standIn: WebGLTexture | null): boolean {
    const baked = this.baked
    if (!baked || baked.surfaces.length === 0) return false
    const into = this.underpaint.renderTarget(size.width, size.height)
    const raw = this.ensureBakedTarget(size.width, size.height)
    if (!into || !raw) return false
    const depth = this.renderUnderDepth(view, size.width, size.height)
    const o = baked.origin
    const drawn = drawBakedSurfaces(this.gl, {
      program: this.program(BAKED_PROGRAM),
      gpu: baked,
      target: raw,
      matrix: gbufferMatrix(view.viewProj, o, view.width, view.height, size.width, size.height),
      relEye: [view.eye[0] - o[0], view.eye[1] - o[1], view.eye[2] - o[2]],
      viewDir: view.viewDir,
      perspective: isPerspective(view.viewProj),
      depthBase: (o[0] - view.eye[0]) * view.viewDir[0] + (o[1] - view.eye[1]) * view.viewDir[1] + (o[2] - view.eye[2]) * view.viewDir[2],
      sceneDepth: depth ? depth.target.texture : null,
      bias: depth ? depth.bias : 0,
      standIn,
    })
    drawBakedDilate(this.gl, this.program(BAKED_DILATE_PROGRAM), raw, into)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.underpaint.drawn()
    this.stats.bakedSurfaces = drawn
    return true
  }

  // Frees the targets the baked surface pass draws with. The next baked frame makes them again.
  private freeBakedTargets(): void {
    this.bakedTarget?.destroy()
    this.bakedTarget = null
    this.bakedTargetKey = ''
    this.bakedTargetFailed = false
    this.underDepth?.destroy()
    this.underDepth = null
    this.underDepthKey = ''
    this.underDepthFailed = false
    this.underpaint.releaseTarget()
  }

  private ensureBakedTarget(width: number, height: number): BakedTarget | null {
    const key = `${width}x${height}`
    if (this.bakedTarget && this.bakedTargetKey === key) return this.bakedTarget
    if (this.bakedTargetFailed && this.bakedTargetKey === key) return null
    this.bakedTarget?.destroy()
    this.bakedTarget = createBakedTarget(this.gl, this.res, width, height)
    this.bakedTargetKey = key
    this.bakedTargetFailed = this.bakedTarget === null
    if (!this.bakedTarget) this.report('paint: the baked underpainting framebuffer is incomplete on this device')
    return this.bakedTarget
  }

  // Uploads (again) the surfaces last given: replaces what is there. Nothing when there are none, or the context is lost
  // (the restore uploads them).
  private uploadBakedNow(): void {
    this.bakedRes.disposeAll()
    this.baked = null
    if (!this.bakedSource || !this.usable()) return
    try {
      const { gpu, skipped } = uploadBaked(this.gl, this.bakedRes, this.bakedSource)
      this.baked = gpu
      for (const line of skipped) this.report(line)
    } catch (error) {
      if (this.gone()) return
      this.fail(error)
    }
  }

  private ensureShadow(): ShadowTarget | null {
    if (!this.shadow) this.shadow = createShadowTarget(this.gl, this.res)
    return this.shadow
  }

  // The G-buffer target at this size: float when the context renders to float
  // textures, else (or when that framebuffer is incomplete) the RGBA8 layout.
  private ensureGBuffer(width: number, height: number): GBufferTarget | null {
    const key = `${width}x${height}`
    if (this.gbuffer && this.gbufferKey === key) return this.gbuffer
    this.gbuffer?.destroy()
    this.gbuffer = null
    this.gbufferKey = key
    if (this.caps.colorBufferFloat && !this.gbufferFloatFailed) {
      this.gbuffer = createGBufferTarget(this.gl, this.res, width, height, true)
      if (!this.gbuffer) this.gbufferFloatFailed = true
    }
    if (!this.gbuffer) this.gbuffer = createGBufferTarget(this.gl, this.res, width, height, false)
    this.stats.gbuffer = this.gbuffer?.mode ?? null
    if (!this.gbuffer) this.report('paint: the G-buffer framebuffer is incomplete on this device')
    return this.gbuffer
  }

  private ensureAccum(width: number, height: number): AccumTargets | null {
    const key = `${width}x${height}`
    if (this.accum && this.accumKey === key) return this.accum
    this.accum?.destroy()
    this.accum = null
    this.accumKey = key
    if (this.caps.colorBufferFloat && !this.accumFloatFailed) {
      this.accum = createAccumTargets(this.gl, this.res, width, height, true)
      if (!this.accum) this.accumFloatFailed = true
    }
    if (!this.accum) this.accum = createAccumTargets(this.gl, this.res, width, height, false)
    this.stats.accumFloat = this.accum?.float ?? null
    if (!this.accum) this.report('paint: the paint framebuffer is incomplete on this device')
    return this.accum
  }

  private handleLost(): void {
    this.lost = true
    // The context took every resource with it: drop the handles undeleted.
    this.res.forget()
    this.sceneRes.forget()
    this.bakedRes.forget()
    this.programs.forget()
    this.strokes.forget()
    this.underpaint.forget()
    this.debugger.forget()
    this.sceneGpu = null
    this.baked = null
    this.bakedTarget = null
    this.bakedTargetKey = ''
    this.bakedTargetFailed = false
    this.paper = null
    this.defaultPaper = null
    this.shadow = null
    this.gbuffer = null
    this.gbufferKey = ''
    this.accum = null
    this.accumKey = ''
    this.sceneDepth = null
    this.sceneDepthKey = ''
    this.underDepth = null
    this.underDepthKey = ''
    this.pack = { buffer: null, bytes: 0 }
    this.asyncRead = null
    this.options.onContextLost?.()
  }

  private handleRestored(): void {
    if (this.disposed) return
    this.lost = false
    this.contextGeneration++
    // A failure before the loss (an error that surfaced as the context went) must not keep a good context silent:
    // the restore starts again, and a failure that is real (a shader that will not compile) comes back by itself.
    this.failed = false
    // Extensions are off on a restored context until asked for again.
    this.caps = queryCapabilities(this.gl)
    this.gbufferFloatFailed = false
    this.accumFloatFailed = false
    this.sceneDepthFailed = false
    this.underDepthFailed = false
    this.uploadSceneNow()
    this.uploadPaperNow()
    // the baked surfaces last given go up again
    this.uploadBakedNow()
    this.options.onContextRestored?.()
  }

  private fail(error: unknown): void {
    this.failed = true
    this.report(error instanceof Error ? error.message : String(error))
  }

  private report(message: string): void {
    if (this.options.onError) this.options.onError(message)
    else console.error(message)
  }
}
