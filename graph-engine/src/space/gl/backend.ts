// GlBackend (plan G9, spec SP4): owns the WebGL2 context, the programs and
// every mark's GPU resources, and draws a frame on request. It is the only
// code that touches WebGL. Nothing in here throws out of a public method: a
// missing WebGL2, a shader failure or an unexpected GL error is reported
// through onError, and the backend then draws nothing.
//
// Every GPU resource derives from the retained scene and frame, so a lost
// context is rebuilt on `webglcontextrestored` by re-uploading them.
//
// Draw order: the frame (its lines, then the axes frame's arrows), opaque
// meshes, the scene's lines, arrows and points, then translucent meshes back
// to front. Box marks are skipped until S5.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { FrameLineRole, FrameModel } from '../frame/types'
import type { ArrowMark, LineMark, Mark, SpaceScene } from '../scene/types'
import { resolveSpaceColor, type Rgb, type SpaceColors } from '../theme'
import { ARROWHEAD_PROGRAM, drawArrowHeads, uploadArrows, type ArrowGpu, type ArrowLook } from './arrowPipeline'
import { syncByIdentity, type GpuResource } from './buffers'
import { createContext, watchContext, type GlCapabilities } from './context'
import {
  cameraKey,
  createSharedQuads,
  drawLines,
  LINE_PROGRAM,
  updateDashes,
  uploadLines,
  type DrawTarget,
  type LineGpu,
  type LineLook,
  type SharedQuads,
} from './linePipeline'
import { drawMeshes, drawTranslucentMeshes, isTranslucent, MESH_PROGRAM, sortBackToFront, uploadMesh, type MeshGpu } from './meshPipeline'
import { drawPoints, POINT_PROGRAM, uploadPoints, type PointGpu } from './pointPipeline'
import { ProgramCache, type ProgramInfo } from './program'

export interface GlBackendOptions {
  onError?: (message: string) => void
  onContextLost?: () => void
  onContextRestored?: () => void
}

type MarkGpu =
  | { kind: 'mesh'; gpu: MeshGpu }
  | { kind: 'lines'; gpu: LineGpu }
  | { kind: 'points'; gpu: PointGpu }
  | { kind: 'arrows'; gpu: ArrowGpu }

type CachedMark = MarkGpu & GpuResource

interface FrameGpu extends GpuResource {
  lines: LineGpu[]
  arrows: ArrowGpu[]
}

const PROGRAMS = [MESH_PROGRAM, LINE_PROGRAM, POINT_PROGRAM, ARROWHEAD_PROGRAM]

// The frame's look (plan G9 "Frame drawing"): 1 px grid, 1.5 px walls and
// ticks; the axes frame's axes as 1.5 px arrows with 10 px heads.
const FRAME_LINES: readonly { role: FrameLineRole; width: number; color: (c: SpaceColors) => Rgb }[] = [
  { role: 'grid', width: 1, color: (c) => c.grid },
  { role: 'wall', width: 1.5, color: (c) => c.gridStrong },
  { role: 'tick', width: 1.5, color: (c) => c.axis },
]
export const FRAME_AXIS_SHAFT = 1.5
export const FRAME_AXIS_HEAD = 10

function lineLook(mark: LineMark): LineLook {
  return {
    width: mark.style.width,
    dash: mark.style.dash,
    opacity: 1,
    headSize: 0,
    color: (c) => resolveSpaceColor(mark.style.color, c.palette, c.theme),
  }
}

function arrowLook(mark: ArrowMark): ArrowLook {
  return {
    shaftWidth: mark.style.shaftWidth,
    headSize: mark.style.headSize,
    opacity: 1,
    color: (c) => resolveSpaceColor(mark.style.color, c.palette, c.theme),
  }
}

function cached(entry: MarkGpu | null): CachedMark | null {
  if (!entry) return null
  return { ...entry, destroy: (g: WebGL2RenderingContext) => entry.gpu.destroy(g) } as CachedMark
}

export class GlBackend {
  readonly available: boolean
  readonly capabilities: GlCapabilities | null
  private readonly canvas: HTMLCanvasElement
  private readonly options: GlBackendOptions
  private readonly gl: WebGL2RenderingContext | null
  private readonly programs = new ProgramCache()
  private readonly marks = new Map<Mark, CachedMark>()
  private readonly unwatch: (() => void) | null
  private shared: SharedQuads | null = null
  private scene: SpaceScene | null = null
  private world: WorldMap | null = null
  private worldKey = ''
  private sceneGeneration = 0
  private colors: SpaceColors | null = null
  private frame: FrameModel | null = null
  private frameGpu: FrameGpu | null = null
  private frameKey = ''
  private failed = false
  private lost = false
  private disposed = false

  constructor(canvas: HTMLCanvasElement, options: GlBackendOptions = {}) {
    this.canvas = canvas
    this.options = options
    const context = createContext(canvas)
    if ('error' in context) {
      this.gl = null
      this.available = false
      this.capabilities = null
      this.unwatch = null
      this.report(context.error)
      return
    }
    this.gl = context.gl
    this.available = true
    this.capabilities = context.capabilities
    this.unwatch = watchContext(
      canvas,
      () => this.handleLost(),
      () => this.handleRestored(),
    )
    this.prepare()
  }

  // Replace the scene. Marks kept by identity keep their buffers, unless the
  // box centre or scale changed, which re-uploads everything.
  setScene(scene: SpaceScene, world: WorldMap, colors: SpaceColors): void {
    this.scene = scene
    this.world = world
    this.colors = colors
    this.sceneGeneration++
    // The retained frame belongs to the previous scene's box: drop it, so
    // nothing draws until the caller sets this scene's frame.
    this.dropFrame()
    const boxes = scene.marks.filter((m) => m.kind === 'boxes').length
    if (boxes > 0) console.warn(`space: box marks are not drawn until S5; skipped ${boxes}`)
    this.upload()
  }

  // The frame's lines, in author coordinates, drawn before the marks. They
  // are re-uploaded only when their geometry can have changed: a new frame
  // key (a new box, new ticks, or walls flipped) or a new scene.
  setFrame(frame: FrameModel, colors: SpaceColors): void {
    this.frame = frame
    this.colors = colors
    this.uploadFrame()
  }

  setColors(colors: SpaceColors): void {
    this.colors = colors
  }

  // `pixelRatio` is the backing store's pixels per CSS pixel.
  draw(camera: CameraMatrices, pixelRatio: number): void {
    const gl = this.gl
    if (!gl || this.failed || this.lost || this.disposed || gl.isContextLost()) return
    const colors = this.colors
    try {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      const bg = colors?.background ?? [1, 1, 1]
      gl.clearColor(bg[0], bg[1], bg[2], 1)
      gl.clearDepth(1)
      gl.depthMask(true)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      const world = this.world
      if (!colors || !world) return
      const mesh = this.program(MESH_PROGRAM)
      const line = this.program(LINE_PROGRAM)
      const point = this.program(POINT_PROGRAM)
      const head = this.program(ARROWHEAD_PROGRAM)
      if (!mesh || !line || !point || !head) return
      const target: DrawTarget = { camera, world, colors, width: this.canvas.width, height: this.canvas.height, pixelRatio }

      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.disable(gl.CULL_FACE)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      const meshes: MeshGpu[] = []
      const lines: LineGpu[] = []
      const arrows: ArrowGpu[] = []
      const points: PointGpu[] = []
      for (const m of this.marks.values()) {
        if (m.kind === 'mesh') meshes.push(m.gpu)
        else if (m.kind === 'lines') lines.push(m.gpu)
        else if (m.kind === 'arrows') arrows.push(m.gpu)
        else points.push(m.gpu)
      }
      const key = cameraKey(camera)
      for (const l of lines) updateDashes(gl, l, camera, key, world)

      // Lines, arrowheads and points in two passes: their opaque cores
      // write depth, then their antialiased fringes blend without writing it.
      const antialiased = (ls: readonly LineGpu[], heads: readonly ArrowGpu[], ps: readonly PointGpu[]) => {
        for (const pass of [0, 1] as const) {
          if (pass === 1) {
            gl.enable(gl.BLEND)
            gl.depthMask(false)
          }
          drawLines(gl, line, ls, target, pass)
          drawArrowHeads(gl, head, heads, target, pass)
          drawPoints(gl, point, ps, target, pass)
        }
        gl.depthMask(true)
        gl.disable(gl.BLEND)
      }

      // The frame, first.
      gl.disable(gl.BLEND)
      if (this.frameGpu) antialiased([...this.frameGpu.lines, ...this.frameGpu.arrows.map((a) => a.shaft)], this.frameGpu.arrows, [])

      // Opaque meshes.
      drawMeshes(gl, mesh, meshes.filter((m) => !isTranslucent(m)), camera, world, colors)

      // Lines, arrows and points, with their depth bias.
      antialiased([...lines, ...arrows.map((a) => a.shaft)], arrows, points)

      // Translucent meshes, back to front, blended, each its nearest layer.
      drawTranslucentMeshes(gl, mesh, sortBackToFront(meshes.filter(isTranslucent), camera), camera, world, colors)
    } catch (error) {
      this.fail(error)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unwatch?.()
    const gl = this.gl
    if (!gl) return
    if (!this.lost && !gl.isContextLost()) {
      for (const m of this.marks.values()) m.destroy(gl)
      this.frameGpu?.destroy(gl)
      this.shared?.destroy(gl)
      this.programs.deleteAll(gl)
    }
    this.marks.clear()
    this.frameGpu = null
    this.shared = null
    this.programs.forget()
    this.scene = null
    this.frame = null
  }

  private program(spec: { name: string; vertex: string; fragment: string }): ProgramInfo | null {
    if (!this.gl) return null
    return this.programs.get(this.gl, spec.name, spec.vertex, spec.fragment)
  }

  // Programs and the shared quad corners: everything not tied to a mark.
  private prepare(): void {
    const gl = this.gl
    if (!gl) return
    try {
      for (const spec of PROGRAMS) this.program(spec)
      this.shared = createSharedQuads(gl)
    } catch (error) {
      this.fail(error)
    }
  }

  private upload(): void {
    const gl = this.gl
    const scene = this.scene
    const world = this.world
    const shared = this.shared
    if (!gl || !scene || !world || !shared || this.failed || this.lost || this.disposed) return
    try {
      const key = `${world.centre.join(',')}|${world.scale.join(',')}`
      if (key !== this.worldKey) {
        for (const m of this.marks.values()) m.destroy(gl)
        this.marks.clear()
        this.worldKey = key
      }
      const drawable = scene.marks.filter((m) => m.kind !== 'boxes')
      syncByIdentity(gl, this.marks, drawable, (mark) => cached(this.uploadMark(gl, shared, mark, world)))
    } catch (error) {
      this.fail(error)
    }
  }

  private uploadMark(gl: WebGL2RenderingContext, shared: SharedQuads, mark: Mark, world: WorldMap): MarkGpu | null {
    switch (mark.kind) {
      case 'mesh': {
        const gpu = uploadMesh(gl, mark, world)
        return gpu && { kind: 'mesh', gpu }
      }
      case 'lines': {
        const gpu = uploadLines(gl, shared, mark.positions, mark.starts, world, lineLook(mark))
        return gpu && { kind: 'lines', gpu }
      }
      case 'points': {
        const gpu = uploadPoints(gl, shared, mark, world)
        return gpu && { kind: 'points', gpu }
      }
      case 'arrows': {
        const gpu = uploadArrows(gl, shared, mark.tails, mark.vectors, world, arrowLook(mark))
        return gpu && { kind: 'arrows', gpu }
      }
      default:
        return null
    }
  }

  private dropFrame(): void {
    if (this.gl && this.frameGpu && !this.lost && !this.gl.isContextLost()) this.frameGpu.destroy(this.gl)
    this.frameGpu = null
    this.frame = null
    this.frameKey = ''
  }

  private uploadFrame(): void {
    const gl = this.gl
    const frame = this.frame
    const world = this.world
    const shared = this.shared
    if (!gl || !frame || !world || !shared || this.failed || this.lost || this.disposed) return
    const key = `${frame.key}|${this.sceneGeneration}|${this.worldKey}`
    if (key === this.frameKey && this.frameGpu) return
    try {
      this.frameGpu?.destroy(gl)
      this.frameGpu = null
      const lines: LineGpu[] = []
      for (const spec of FRAME_LINES) {
        const own = frame.lines.filter((l) => l.role === spec.role)
        if (own.length === 0) continue
        const positions = new Float64Array(own.length * 6)
        const starts = new Uint32Array(own.length)
        own.forEach((l, i) => {
          positions.set([l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]], i * 6)
          starts[i] = i * 2
        })
        const gpu = uploadLines(gl, shared, positions, starts, world, { width: spec.width, dash: null, opacity: 1, headSize: 0, color: spec.color })
        if (gpu) lines.push(gpu)
      }
      const arrows: ArrowGpu[] = []
      const axes = frame.lines.filter((l) => l.role === 'axis')
      if (axes.length > 0) {
        const tails = new Float64Array(axes.length * 3)
        const vectors = new Float64Array(axes.length * 3)
        axes.forEach((l, i) => {
          tails.set(l.a, i * 3)
          vectors.set([l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]], i * 3)
        })
        const gpu = uploadArrows(gl, shared, tails, vectors, world, {
          shaftWidth: FRAME_AXIS_SHAFT,
          headSize: FRAME_AXIS_HEAD,
          opacity: 1,
          color: (c) => c.axis,
        })
        if (gpu) arrows.push(gpu)
      }
      this.frameGpu = {
        lines,
        arrows,
        destroy(g) {
          for (const l of lines) l.destroy(g)
          for (const a of arrows) a.destroy(g)
        },
      }
      this.frameKey = key
    } catch (error) {
      this.fail(error)
    }
  }

  private handleLost(): void {
    this.lost = true
    // The context took every resource with it: drop the handles undeleted.
    this.marks.clear()
    this.frameGpu = null
    this.frameKey = ''
    this.shared = null
    this.programs.forget()
    this.worldKey = ''
    this.options.onContextLost?.()
  }

  private handleRestored(): void {
    if (this.disposed) return
    this.lost = false
    this.prepare()
    this.upload()
    this.uploadFrame()
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
