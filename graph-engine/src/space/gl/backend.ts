// GlBackend (plan G9, spec SP4): owns the WebGL2 context, the programs and
// every mark's GPU resources, and draws a frame on request. It is the only
// code that touches WebGL. Nothing in here throws out of a public method: a
// missing WebGL2, a shader failure or an unexpected GL error is reported
// through onError, and the backend then draws nothing.
//
// Every GPU resource derives from the retained scene and frame, so a lost
// context is rebuilt on `webglcontextrestored` by re-uploading them.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { FrameModel } from '../frame/types'
import type { Mark, SpaceScene } from '../scene/types'
import type { SpaceColors } from '../theme'
import { syncByIdentity, type GpuResource } from './buffers'
import { createContext, watchContext, type GlCapabilities } from './context'
import { drawMeshes, isTranslucent, MESH_PROGRAM, sortBackToFront, uploadMesh, type MeshGpu } from './meshPipeline'
import { ProgramCache, type ProgramInfo } from './program'

export interface GlBackendOptions {
  onError?: (message: string) => void
  onContextLost?: () => void
  onContextRestored?: () => void
}

type MarkGpu = { kind: 'mesh'; gpu: MeshGpu } & GpuResource

const PROGRAMS = [MESH_PROGRAM]

export class GlBackend {
  readonly available: boolean
  readonly capabilities: GlCapabilities | null
  private readonly canvas: HTMLCanvasElement
  private readonly options: GlBackendOptions
  private readonly gl: WebGL2RenderingContext | null
  private readonly programs = new ProgramCache()
  private readonly marks = new Map<Mark, MarkGpu>()
  private readonly unwatch: (() => void) | null
  private scene: SpaceScene | null = null
  private world: WorldMap | null = null
  private worldKey = ''
  private colors: SpaceColors | null = null
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
    this.compilePrograms()
  }

  // Replace the scene. Marks kept by identity keep their buffers, unless the
  // box centre or scale changed, which re-uploads everything.
  setScene(scene: SpaceScene, world: WorldMap, colors: SpaceColors): void {
    this.scene = scene
    this.world = world
    this.colors = colors
    const boxes = scene.marks.filter((m) => m.kind === 'boxes').length
    if (boxes > 0) console.warn(`space: box marks are not drawn until S5; skipped ${boxes}`)
    this.upload()
  }

  // The frame's lines, in author coordinates. Wired to the line and arrow
  // pipelines with them (S2 Task 4); until then only its colours apply.
  setFrame(_frame: FrameModel, colors: SpaceColors): void {
    this.colors = colors
  }

  setColors(colors: SpaceColors): void {
    this.colors = colors
  }

  draw(camera: CameraMatrices, _pixelRatio: number): void {
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
      if (!colors || !this.world) return
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.BLEND)

      const meshes: MeshGpu[] = []
      for (const m of this.marks.values()) if (m.kind === 'mesh') meshes.push(m.gpu)
      const program = this.program(MESH_PROGRAM)
      if (!program) return

      // 1. Opaque meshes.
      drawMeshes(gl, program, meshes.filter((m) => !isTranslucent(m)), camera, this.world, colors)

      // 4. Translucent meshes, back to front, blended, no depth writes.
      const translucent = sortBackToFront(meshes.filter(isTranslucent), camera)
      if (translucent.length > 0) {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.depthMask(false)
        drawMeshes(gl, program, translucent, camera, this.world, colors)
        gl.depthMask(true)
        gl.disable(gl.BLEND)
      }
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
      this.programs.deleteAll(gl)
    }
    this.marks.clear()
    this.programs.forget()
    this.scene = null
  }

  private program(spec: { name: string; vertex: string; fragment: string }): ProgramInfo | null {
    if (!this.gl) return null
    return this.programs.get(this.gl, spec.name, spec.vertex, spec.fragment)
  }

  private compilePrograms(): void {
    if (!this.gl) return
    try {
      for (const spec of PROGRAMS) this.program(spec)
    } catch (error) {
      this.fail(error)
    }
  }

  private upload(): void {
    const gl = this.gl
    const scene = this.scene
    const world = this.world
    if (!gl || !scene || !world || this.failed || this.lost || this.disposed) return
    try {
      const key = `${world.centre.join(',')}|${world.scale.join(',')}`
      if (key !== this.worldKey) {
        for (const m of this.marks.values()) m.destroy(gl)
        this.marks.clear()
        this.worldKey = key
      }
      const drawable = scene.marks.filter((m) => m.kind === 'mesh')
      syncByIdentity(gl, this.marks, drawable, (mark) => {
        if (mark.kind !== 'mesh') return null
        const gpu = uploadMesh(gl, mark, world)
        return gpu ? { kind: 'mesh', gpu, destroy: (g) => gpu.destroy(g) } : null
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private handleLost(): void {
    this.lost = true
    // The context took every resource with it: drop the handles undeleted.
    this.marks.clear()
    this.programs.forget()
    this.worldKey = ''
    this.options.onContextLost?.()
  }

  private handleRestored(): void {
    if (this.disposed) return
    this.lost = false
    this.compilePrograms()
    this.upload()
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
