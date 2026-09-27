// The box pipeline (S5, C3; the BoxMark S2 deferred). Self-contained: its own
// program (shaders/box.ts), its own buffers, and one entry point each for
// upload and draw, so the backend registers it with one upload branch and one
// draw call.
//
// - A BoxMark is ONE instanced draw of a unit cube (36 vertices), each
//   instance scaled and offset to its box by (min, max) relative to the box
//   centre.
// - Boxes are closed and convex, so back faces are culled: opaque, they are
//   never seen; translucent, one layer of faces reads as one tinted volume.
// - Translucent boxes (opacity < 1) blend without writing depth, marks
//   farthest first and each mark's instances re-sorted back to front when
//   the camera moves. This is the sorted fallback; S3's order-independent
//   transparency makes the order irrelevant where it is available.
// - Edges (style.edges) are each box's 12 edges, generated on the CPU into
//   one polyline batch and drawn by the line pipeline, 1 px, in the box's
//   colour.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { BoxMark } from '../scene/types'
import { resolveSpaceColor, type SpaceColors } from '../theme'
import { createBuffer, float32, floatAttribute, type GpuResource } from './buffers'
import { uploadLines, type LineGpu, type SharedQuads } from './linePipeline'
import type { ProgramInfo } from './program'
import { BOX_FRAGMENT, BOX_VERTEX } from './shaders/box'

export const BOX_PROGRAM = { name: 'box', vertex: BOX_VERTEX, fragment: BOX_FRAGMENT }
export const BOX_EDGE_WIDTH = 1
export const CUBE_VERTICES = 36

// The unit cube as 12 triangles: (corner xyz, outward normal xyz) per vertex,
// each triangle counter-clockwise seen from outside (the front face).
export const UNIT_CUBE: Float32Array = (() => {
  const out: number[] = []
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3
    const c = (a + 2) % 3
    for (const side of [0, 1]) {
      // (b, c) round the square is counter-clockwise about e_b x e_c = e_a:
      // kept on the +a side, reversed on the -a side.
      const square = side === 1 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]]
      const corner = (k: number) => {
        const p = [0, 0, 0]
        p[a] = side
        p[b] = square[k][0]
        p[c] = square[k][1]
        return p
      }
      const normal = [0, 0, 0]
      normal[a] = side === 1 ? 1 : -1
      for (const k of [0, 1, 2, 0, 2, 3]) out.push(...corner(k), ...normal)
    }
  }
  return Float32Array.from(out)
})()

// Each box's 12 edges as 2-vertex polylines, in author coordinates.
export function boxEdges(mins: Float64Array, maxs: Float64Array): { positions: Float64Array; starts: Uint32Array } {
  const count = Math.floor(Math.min(mins.length, maxs.length) / 3)
  const positions = new Float64Array(count * 12 * 6)
  const starts = new Uint32Array(count * 12)
  let e = 0
  for (let i = 0; i < count; i++) {
    const lo = [mins[3 * i], mins[3 * i + 1], mins[3 * i + 2]]
    const hi = [maxs[3 * i], maxs[3 * i + 1], maxs[3 * i + 2]]
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3
      const c = (a + 2) % 3
      for (const sb of [0, 1]) {
        for (const sc of [0, 1]) {
          const p = [0, 0, 0]
          const q = [0, 0, 0]
          p[a] = lo[a]
          q[a] = hi[a]
          p[b] = q[b] = sb ? hi[b] : lo[b]
          p[c] = q[c] = sc ? hi[c] : lo[c]
          positions.set([...p, ...q], e * 6)
          starts[e] = e * 2
          e++
        }
      }
    }
  }
  return { positions, starts }
}

export interface BoxGpu extends GpuResource {
  mark: BoxMark
  vao: WebGLVertexArrayObject
  count: number
  // Per instance (min xyz, max xyz) relative to the box centre, in the
  // mark's order; the buffer holds them in draw order.
  data: Float32Array
  instanceBuffer: WebGLBuffer | null
  // Each box's centre in world, for sorting.
  centres: Float64Array
  // The camera the instance order was sorted for ('' for the mark's order).
  orderKey: string
  edges: LineGpu | null
}

export function uploadBoxes(gl: WebGL2RenderingContext, shared: SharedQuads, mark: BoxMark, world: WorldMap): BoxGpu | null {
  const count = Math.floor(Math.min(mark.mins.length, mark.maxs.length) / 3)
  if (count === 0) return null
  const [cx, cy, cz] = world.centre
  const [kx, ky, kz] = world.scale
  const data = new Float32Array(count * 6)
  const centres = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    const lo = [0, 1, 2].map((c) => Math.min(mark.mins[3 * i + c], mark.maxs[3 * i + c]))
    const hi = [0, 1, 2].map((c) => Math.max(mark.mins[3 * i + c], mark.maxs[3 * i + c]))
    data.set([lo[0] - cx, lo[1] - cy, lo[2] - cz, hi[0] - cx, hi[1] - cy, hi[2] - cz], i * 6)
    centres.set([((lo[0] + hi[0]) / 2 - cx) * kx, ((lo[1] + hi[1]) / 2 - cy) * ky, ((lo[2] + hi[2]) / 2 - cz) * kz], i * 3)
  }
  const vao = gl.createVertexArray()
  if (!vao) return null
  gl.bindVertexArray(vao)
  const buffers: WebGLBuffer[] = []
  const cube = createBuffer(gl, gl.ARRAY_BUFFER, UNIT_CUBE)
  if (cube) {
    buffers.push(cube)
    floatAttribute(gl, 0, cube, 3, 24, 0)
    floatAttribute(gl, 1, cube, 3, 24, 12)
  }
  const instanceBuffer = createBuffer(gl, gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  if (instanceBuffer) {
    buffers.push(instanceBuffer)
    floatAttribute(gl, 2, instanceBuffer, 3, 24, 0, 1)
    floatAttribute(gl, 3, instanceBuffer, 3, 24, 12, 1)
  }
  gl.bindVertexArray(null)

  let edges: LineGpu | null = null
  if (mark.style.edges) {
    const { positions, starts } = boxEdges(mark.mins, mark.maxs)
    edges = uploadLines(gl, shared, positions, starts, world, {
      width: BOX_EDGE_WIDTH,
      dash: null,
      opacity: 1,
      headSize: 0,
      color: (c) => resolveSpaceColor(mark.style.color, c.palette, c.theme),
    })
  }
  return {
    mark,
    vao,
    count,
    data,
    instanceBuffer,
    centres,
    orderKey: '',
    edges,
    destroy(g) {
      g.deleteVertexArray(vao)
      for (const b of buffers) g.deleteBuffer(b)
      edges?.destroy(g)
    },
  }
}

// View-space depth (more negative is farther).
function viewDepth(camera: CameraMatrices, x: number, y: number, z: number): number {
  const m = camera.view
  return m[2] * x + m[6] * y + m[10] * z + m[14]
}

function meanDepth(box: BoxGpu, camera: CameraMatrices): number {
  let sum = 0
  for (let i = 0; i < box.count; i++) sum += viewDepth(camera, box.centres[3 * i], box.centres[3 * i + 1], box.centres[3 * i + 2])
  return sum / box.count
}

// Re-sort a translucent mark's instances farthest first, when the camera
// has moved since the last sort.
export function sortInstances(gl: WebGL2RenderingContext, box: BoxGpu, camera: CameraMatrices, key: string): void {
  if (box.orderKey === key || !box.instanceBuffer) return
  const order = Array.from({ length: box.count }, (_, i) => i)
  const depth = order.map((i) => viewDepth(camera, box.centres[3 * i], box.centres[3 * i + 1], box.centres[3 * i + 2]))
  order.sort((a, b) => depth[a] - depth[b] || a - b)
  const sorted = new Float32Array(box.data.length)
  order.forEach((from, to) => sorted.set(box.data.subarray(from * 6, from * 6 + 6), to * 6))
  gl.bindBuffer(gl.ARRAY_BUFFER, box.instanceBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, sorted, gl.DYNAMIC_DRAW)
  box.orderKey = key
}

function drawOne(gl: WebGL2RenderingContext, program: ProgramInfo, box: BoxGpu, colors: SpaceColors): void {
  const [r, g, b] = resolveSpaceColor(box.mark.style.color, colors.palette, colors.theme)
  gl.uniform3f(program.uniform('u_color'), r, g, b)
  gl.uniform1f(program.uniform('u_opacity'), Math.min(1, Math.max(0, box.mark.style.opacity)))
  gl.bindVertexArray(box.vao)
  gl.drawArraysInstanced(gl.TRIANGLES, 0, CUBE_VERTICES, box.count)
}

// Every box mark: opaque ones first (writing depth), then translucent ones
// blended, farthest first. `key` identifies the camera (linePipeline's
// cameraKey). Leaves culling, blending and depth writes as it found the
// frame loop's defaults: off, off, on.
export function drawBoxes(
  gl: WebGL2RenderingContext,
  program: ProgramInfo,
  boxes: readonly BoxGpu[],
  camera: CameraMatrices,
  world: WorldMap,
  colors: SpaceColors,
  key: string,
): void {
  if (boxes.length === 0) return
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_view'), false, float32(camera.view))
  gl.uniformMatrix4fv(program.uniform('u_proj'), false, float32(camera.proj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform1i(program.uniform('u_perspective'), camera.projection === 'perspective' ? 1 : 0)
  gl.enable(gl.CULL_FACE)
  gl.cullFace(gl.BACK)
  gl.disable(gl.BLEND)
  gl.depthMask(true)
  for (const box of boxes) if (box.mark.style.opacity >= 1) drawOne(gl, program, box, colors)
  const translucent = boxes
    .filter((box) => box.mark.style.opacity < 1)
    .map((box) => ({ box, depth: meanDepth(box, camera) }))
    .sort((a, b) => a.depth - b.depth)
  if (translucent.length > 0) {
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    for (const { box } of translucent) {
      sortInstances(gl, box, camera, key)
      drawOne(gl, program, box, colors)
    }
  }
  gl.depthMask(true)
  gl.disable(gl.BLEND)
  gl.disable(gl.CULL_FACE)
  gl.bindVertexArray(null)
}
