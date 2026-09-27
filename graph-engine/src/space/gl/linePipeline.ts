// The line pipeline (plan G9 "Lines"): one instanced screen-space quad per
// segment. Used for LineMarks, arrow shafts, and the frame's lines.

import { project, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { FrameStyle } from '../config'
import type { Vec3 } from '../scene/types'
import type { Rgb, SpaceColors } from '../theme'
import { createBuffer, float32, floatAttribute, type GpuResource } from './buffers'
import { cumulativeScreenLength, CUMULATIVE_DASH_LIMIT, dashUniform } from './dash'
import type { ProgramInfo } from './program'
import { LINE_FRAGMENT, LINE_VERTEX } from './shaders/line'

export const LINE_PROGRAM = { name: 'line', vertex: LINE_VERTEX, fragment: LINE_FRAGMENT }
// NDC z subtracted from lines, points and arrowheads so they win against a surface they lie on.
export const LINE_DEPTH_BIAS = 1e-5
// The box frame's lines go the other way: they lie on the box's walls, where
// data often ends exactly (a z = f surface's edges, with automatic bounds),
// and a wall gridline biased forward would poke through that edge. Pushed
// back, the data wins.
export const FRAME_DEPTH_BIAS = -1e-5

// The bias a frame draws with. The box frame (walls, grid, tick edges) sits
// behind data; the axes frame is content, like a curve: an axis lying in
// z = 0, or on z = xy, must not lose to the surface.
export function frameDepthBias(style: FrameStyle): number {
  return style === 'box' ? FRAME_DEPTH_BIAS : LINE_DEPTH_BIAS
}

// The corner buffers every instanced quad shares, created once per context.
export interface SharedQuads extends GpuResource {
  // (end, side) for the line capsule, as a 4-vertex triangle strip.
  lineCorners: WebGLBuffer
  // (-1..1, -1..1) for point and arrowhead quads, as a 4-vertex triangle strip.
  squareCorners: WebGLBuffer
}

export function createSharedQuads(gl: WebGL2RenderingContext): SharedQuads | null {
  const lineCorners = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]))
  const squareCorners = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
  if (!lineCorners || !squareCorners) return null
  return {
    lineCorners,
    squareCorners,
    destroy(g) {
      g.deleteBuffer(lineCorners)
      g.deleteBuffer(squareCorners)
    },
  }
}

export interface LineLook {
  // CSS px.
  width: number
  dash: readonly number[] | null
  opacity: number
  // CSS px; > 0 marks an arrow shaft, trimmed to end inside its head.
  headSize: number
  color: (colors: SpaceColors) => Rgb
}

export interface LineGpu extends GpuResource {
  vao: WebGLVertexArrayObject
  instances: number
  look: LineLook
  // 0 solid, 1 cumulative dash lengths, 2 per-segment dash phase.
  dashMode: 0 | 1 | 2
  // What the dash lengths are recomputed from (author coordinates).
  positions: Float64Array
  starts: Uint32Array
  // Per instance, the index of its first vertex.
  firstVertex: Uint32Array
  dashBuffer: WebGLBuffer | null
  dashKey: string
}

// One instance per segment, (p0, p1) relative to the box centre, and never a
// segment from the end of one polyline to the start of the next.
export function segmentInstances(positions: Float64Array, starts: Uint32Array, centre: Vec3): { data: Float32Array; firstVertex: Uint32Array } {
  const count = Math.floor(positions.length / 3)
  const firsts: number[] = []
  for (let p = 0; p < starts.length; p++) {
    const begin = starts[p]
    const end = p + 1 < starts.length ? starts[p + 1] : count
    for (let i = begin; i + 1 < end; i++) firsts.push(i)
  }
  const data = new Float32Array(firsts.length * 6)
  firsts.forEach((i, k) => {
    data[k * 6] = positions[i * 3] - centre[0]
    data[k * 6 + 1] = positions[i * 3 + 1] - centre[1]
    data[k * 6 + 2] = positions[i * 3 + 2] - centre[2]
    data[k * 6 + 3] = positions[i * 3 + 3] - centre[0]
    data[k * 6 + 4] = positions[i * 3 + 4] - centre[1]
    data[k * 6 + 5] = positions[i * 3 + 5] - centre[2]
  })
  return { data, firstVertex: Uint32Array.from(firsts) }
}

export function uploadLines(
  gl: WebGL2RenderingContext,
  shared: SharedQuads,
  positions: Float64Array,
  starts: Uint32Array,
  world: WorldMap,
  look: LineLook,
): LineGpu | null {
  const { data, firstVertex } = segmentInstances(positions, starts, world.centre)
  if (firstVertex.length === 0) return null
  const vao = gl.createVertexArray()
  if (!vao) return null
  gl.bindVertexArray(vao)
  const buffers: WebGLBuffer[] = []
  floatAttribute(gl, 0, shared.lineCorners, 2)
  const segments = createBuffer(gl, gl.ARRAY_BUFFER, data)
  if (segments) {
    buffers.push(segments)
    floatAttribute(gl, 1, segments, 3, 24, 0, 1)
    floatAttribute(gl, 2, segments, 3, 24, 12, 1)
  }
  const dashed = dashUniform(look.dash) !== null
  const dashMode: 0 | 1 | 2 = !dashed ? 0 : positions.length / 3 > CUMULATIVE_DASH_LIMIT ? 2 : 1
  let dashBuffer: WebGLBuffer | null = null
  if (dashMode === 1) {
    dashBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(firstVertex.length * 2), gl.DYNAMIC_DRAW)
    if (dashBuffer) {
      buffers.push(dashBuffer)
      floatAttribute(gl, 3, dashBuffer, 2, 0, 0, 1)
    }
  }
  gl.bindVertexArray(null)
  return {
    vao,
    instances: firstVertex.length,
    look,
    dashMode,
    positions,
    starts,
    firstVertex,
    dashBuffer,
    dashKey: '',
    destroy(g) {
      g.deleteVertexArray(vao)
      for (const b of buffers) g.deleteBuffer(b)
    },
  }
}

// A camera's identity for dash purposes: the lengths depend on nothing else.
export function cameraKey(camera: CameraMatrices): string {
  return `${camera.viewport.width}x${camera.viewport.height}|${Array.prototype.join.call(camera.viewProj, ',')}`
}

// Recompute a dashed line's cumulative screen lengths when the camera moved.
export function updateDashes(gl: WebGL2RenderingContext, line: LineGpu, camera: CameraMatrices, key: string, world: WorldMap): void {
  if (line.dashMode !== 1 || !line.dashBuffer || line.dashKey === key) return
  const lengths = cumulativeScreenLength(line.positions, line.starts, (x, y, z) => project(camera, world.toWorld([x, y, z])))
  const data = new Float32Array(line.instances * 2)
  for (let k = 0; k < line.instances; k++) {
    const i = line.firstVertex[k]
    data[k * 2] = lengths[i]
    data[k * 2 + 1] = lengths[i + 1]
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, line.dashBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  line.dashKey = key
}

// The antialiased pipelines draw twice: 0, the opaque core, writing depth;
// 1, the blended fringe, not writing it (see shaders/line.ts).
export type AaPass = 0 | 1

export interface DrawTarget {
  camera: CameraMatrices
  world: WorldMap
  colors: SpaceColors
  // Backing-store pixels.
  width: number
  height: number
  pixelRatio: number
  // NDC z subtracted from depth; LINE_DEPTH_BIAS unless given.
  depthBias?: number
}

export function drawLines(gl: WebGL2RenderingContext, program: ProgramInfo, lines: readonly LineGpu[], target: DrawTarget, pass: AaPass): void {
  if (lines.length === 0) return
  const { camera, world, colors } = target
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_viewProj'), false, float32(camera.viewProj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform2f(program.uniform('u_viewport'), target.width, target.height)
  gl.uniform1f(program.uniform('u_pixelRatio'), target.pixelRatio)
  gl.uniform1f(program.uniform('u_depthBias'), target.depthBias ?? LINE_DEPTH_BIAS)
  gl.uniform1i(program.uniform('u_pass'), pass)
  gl.uniform3f(program.uniform('u_eyeDir'), camera.direction[0], camera.direction[1], camera.direction[2])
  gl.uniform3f(program.uniform('u_eye'), camera.eye[0], camera.eye[1], camera.eye[2])
  gl.uniform1i(program.uniform('u_perspective'), camera.projection === 'perspective' ? 1 : 0)
  for (const line of lines) {
    const [r, g, b] = line.look.color(colors)
    const dash = dashUniform(line.look.dash)
    gl.uniform3f(program.uniform('u_color'), r, g, b)
    gl.uniform1f(program.uniform('u_opacity'), line.look.opacity)
    gl.uniform1f(program.uniform('u_width'), line.look.width)
    gl.uniform1f(program.uniform('u_headSize'), line.look.headSize)
    gl.uniform1i(program.uniform('u_dashMode'), dash ? line.dashMode : 0)
    gl.uniform4f(program.uniform('u_dash'), ...(dash?.pattern ?? ([0, 0, 0, 0] as const)))
    gl.uniform1f(program.uniform('u_dashTotal'), dash?.total ?? 0)
    gl.bindVertexArray(line.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, line.instances)
  }
  gl.bindVertexArray(null)
}
