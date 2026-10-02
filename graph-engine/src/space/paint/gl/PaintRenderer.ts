// The paint renderer (spec 2026-10-02-painted-figures-design.md §4).
//
// It owns one WebGL2 context and draws what the paint model decides:
//   renderGBuffer   the shadow map and the G-buffer, read back at half the CSS
//                   resolution for the model (value, normal, depth, mark);
//   paint           the model's strokes, one instanced draw per layer with a
//                   procedural oil brush and wet pickup, then the canvas and
//                   impasto composite; or one of the debug views.
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
import type { SceneColours, GBuffer, PaintDebugMode, PaintFrame, PaintView } from '../types'
import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { createPaperGpu, destroyPaperGpu, drawComposite, DEFAULT_TONE, type PaperGpu } from './composite'
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
  readGBuffer,
  type GBufferTarget,
} from './gbuffer'
import { uploadScene, type SceneGpu } from './meshes'
import { Resources, type Gl } from './resources'
import { createShadowTarget, lightFrame, SHADOW_FIT, SHADOW_SIZE, type ShadowTarget } from './shadow'
import { COPY_FRAGMENT, EDGE_FRAGMENT, EDGE_VERTEX, IMAGE_FRAGMENT } from './shaders/blit'
import { COMPOSITE_FRAGMENT } from './shaders/composite'
import { FULLSCREEN_VERTEX } from './shaders/common'
import { GBUFFER_VERTEX, gbufferFragment } from './shaders/gbuffer'
import { SHADOW_FRAGMENT, SHADOW_VERTEX } from './shaders/shadow'
import { STROKE_FRAGMENT, STROKE_VERTEX } from './shaders/stroke'
import { createAccumTargets, StrokeRenderer, type AccumTargets } from './strokes'

export interface PaintRendererOptions {
  // A shader failure or unexpected GL error, as a plain-text reason.
  onError?: (message: string) => void
  onContextLost?: () => void
  onContextRestored?: () => void
}

export interface PaintStats {
  // The G-buffer layout in use, and whether the accumulation targets are float.
  gbuffer: 'float' | 'rgba8' | null
  accumFloat: boolean | null
  // Strokes drawn and instanced draws made by the last paint().
  strokes: number
  strokeDraws: number
}

const SHADOW_PROGRAM = { name: 'shadow', vertex: SHADOW_VERTEX, fragment: SHADOW_FRAGMENT }
const GBUFFER_FLOAT_PROGRAM = { name: 'gbuffer-float', vertex: GBUFFER_VERTEX, fragment: gbufferFragment(true) }
const GBUFFER_RGBA8_PROGRAM = { name: 'gbuffer-rgba8', vertex: GBUFFER_VERTEX, fragment: gbufferFragment(false) }
const STROKE_PROGRAM = { name: 'stroke', vertex: STROKE_VERTEX, fragment: STROKE_FRAGMENT }
const COPY_PROGRAM = { name: 'copy', vertex: FULLSCREEN_VERTEX, fragment: COPY_FRAGMENT }
const COMPOSITE_PROGRAM = { name: 'composite', vertex: FULLSCREEN_VERTEX, fragment: COMPOSITE_FRAGMENT }
const IMAGE_PROGRAM = { name: 'image', vertex: FULLSCREEN_VERTEX, fragment: IMAGE_FRAGMENT }
const EDGE_PROGRAM = { name: 'edges', vertex: EDGE_VERTEX, fragment: EDGE_FRAGMENT }

export class PaintRenderer {
  readonly stats: PaintStats = { gbuffer: null, accumFloat: null, strokes: 0, strokeDraws: 0 }

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
  private readonly strokes: StrokeRenderer
  private readonly debugger: DebugRenderer
  private readonly scratch = new ReadbackScratch()

  private scene: SpaceScene | null = null
  private sceneGpu: SceneGpu | null = null
  private paperCpu: { rgba: Uint8ClampedArray; height: Float32Array; size: number } | null = null
  private paper: PaperGpu | null = null
  private defaultPaper: PaperGpu | null = null
  private shadow: ShadowTarget | null = null
  private gbuffer: GBufferTarget | null = null
  private gbufferKey = ''
  private accum: AccumTargets | null = null
  private accumKey = ''
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
    this.strokes = new StrokeRenderer(this.gl, this.res)
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

  // The shadow map and the G-buffer, read back at half the CSS resolution.
  renderGBuffer(view: PaintView, params: PaintParams): GBuffer {
    const size = gbufferSize(view.width, view.height)
    const empty = () => emptyGBuffer(size.width, size.height)
    if (!this.usable()) return empty()
    try {
      const scene = this.sceneGpu
      if (!scene || scene.meshes.length === 0) return empty()
      const target = this.ensureGBuffer(size.width, size.height)
      const shadow = this.ensureShadow()
      const gbufferProgram = this.program(target?.mode === 'float' ? GBUFFER_FLOAT_PROGRAM : GBUFFER_RGBA8_PROGRAM)
      const shadowProgram = this.program(SHADOW_PROGRAM)
      if (!target || !shadow) return empty()
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

      // Readback: one readPixels per attachment.
      return readGBuffer(gl, target, this.scratch, depthRange)
    } catch (error) {
      this.fail(error)
      return empty()
    }
  }

  // Draw a frame to the canvas.
  paint(frame: PaintFrame, view: PaintView, params: PaintParams, debug: PaintDebugMode): void {
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
        return
      }

      const accum = this.ensureAccum(backing.width, backing.height)
      if (!accum) return
      const paper = this.ensurePaperGpu()
      const roles = debug === 'roles'
      const { plan, layout } = this.strokes.upload(frame.strokes)
      const result = this.strokes.run(
        { stroke: this.program(STROKE_PROGRAM), copy: this.program(COPY_PROGRAM), targets: accum, paper, cssSize, debugRoles: roles },
        plan,
        layout,
      )
      this.stats.strokes = plan.count
      this.stats.strokeDraws = result.draws
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
      this.debugger.destroy()
      this.res.disposeAll()
      this.sceneRes.disposeAll()
      this.programs.deleteAll(gl)
      // Deleting resources does not release the context itself, and browsers
      // cap live contexts: release it on purpose.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } else {
      this.res.forget()
      this.sceneRes.forget()
      this.programs.forget()
    }
    this.sceneGpu = null
    this.scene = null
    this.paper = null
    this.defaultPaper = null
    this.shadow = null
    this.gbuffer = null
    this.accum = null
    this.paperCpu = null
  }

  // --- internals ----------------------------------------------------------

  private usable(): boolean {
    return !this.failed && !this.lost && !this.disposed && !this.gl.isContextLost()
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
    this.programs.forget()
    this.strokes.forget()
    this.debugger.forget()
    this.sceneGpu = null
    this.paper = null
    this.defaultPaper = null
    this.shadow = null
    this.gbuffer = null
    this.gbufferKey = ''
    this.accum = null
    this.accumKey = ''
    this.options.onContextLost?.()
  }

  private handleRestored(): void {
    if (this.disposed) return
    this.lost = false
    // Extensions are off on a restored context until asked for again.
    this.caps = queryCapabilities(this.gl)
    this.gbufferFloatFailed = false
    this.accumFloatFailed = false
    this.uploadSceneNow()
    this.uploadPaperNow()
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
