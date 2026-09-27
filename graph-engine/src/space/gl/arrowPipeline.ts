// The arrow pipeline (plan G9 "Arrows"): the shaft through the line pipeline
// (at `shaftWidth`, trimmed to end inside the head), the head as an
// instanced screen-space triangle, or a ring when the vector points at the
// viewer. Used for ArrowMarks and the axes frame's axes.

import type { WorldMap } from '../camera/world'
import type { Rgb, SpaceColors } from '../theme'
import { createBuffer, float32, floatAttribute, type GpuResource } from './buffers'
import { LINE_DEPTH_BIAS, uploadLines, type AaPass, type DrawTarget, type LineGpu, type SharedQuads } from './linePipeline'
import type { ProgramInfo } from './program'
import { ARROW_FRAGMENT, ARROW_VERTEX } from './shaders/arrow'

export const ARROWHEAD_PROGRAM = { name: 'arrowhead', vertex: ARROW_VERTEX, fragment: ARROW_FRAGMENT }

// The head's shape for a projected arrow `projectedLength` CSS px long: a
// ring when it is shorter than the head (it points at or away from the
// viewer), a triangle otherwise. The arrowhead vertex shader makes the same
// comparison in backing pixels.
export function arrowHeadKind(projectedLength: number, headSize: number): 'ring' | 'triangle' {
  return projectedLength < headSize ? 'ring' : 'triangle'
}

export interface ArrowLook {
  shaftWidth: number
  headSize: number
  opacity: number
  color: (colors: SpaceColors) => Rgb
}

export interface ArrowGpu extends GpuResource {
  shaft: LineGpu
  vao: WebGLVertexArrayObject
  count: number
  look: ArrowLook
}

export function uploadArrows(
  gl: WebGL2RenderingContext,
  shared: SharedQuads,
  tails: Float64Array,
  vectors: Float64Array,
  world: WorldMap,
  look: ArrowLook,
): ArrowGpu | null {
  const count = Math.floor(Math.min(tails.length, vectors.length) / 3)
  if (count === 0) return null
  // Shafts: one 2-vertex polyline per arrow.
  const positions = new Float64Array(count * 6)
  const starts = new Uint32Array(count)
  // Heads: (tail, tip) per instance, relative to the box centre.
  const heads = new Float32Array(count * 6)
  const [cx, cy, cz] = world.centre
  for (let i = 0; i < count; i++) {
    const tx = tails[i * 3]
    const ty = tails[i * 3 + 1]
    const tz = tails[i * 3 + 2]
    const hx = tx + vectors[i * 3]
    const hy = ty + vectors[i * 3 + 1]
    const hz = tz + vectors[i * 3 + 2]
    positions.set([tx, ty, tz, hx, hy, hz], i * 6)
    starts[i] = i * 2
    heads.set([tx - cx, ty - cy, tz - cz, hx - cx, hy - cy, hz - cz], i * 6)
  }
  const shaft = uploadLines(gl, shared, positions, starts, world, {
    width: look.shaftWidth,
    dash: null,
    opacity: look.opacity,
    headSize: look.headSize,
    color: look.color,
  })
  if (!shaft) return null
  const vao = gl.createVertexArray()
  if (!vao) {
    shaft.destroy(gl)
    return null
  }
  gl.bindVertexArray(vao)
  floatAttribute(gl, 0, shared.squareCorners, 2)
  const buffer = createBuffer(gl, gl.ARRAY_BUFFER, heads)
  if (buffer) {
    floatAttribute(gl, 1, buffer, 3, 24, 0, 1)
    floatAttribute(gl, 2, buffer, 3, 24, 12, 1)
  }
  gl.bindVertexArray(null)
  return {
    shaft,
    vao,
    count,
    look,
    destroy(g) {
      shaft.destroy(g)
      g.deleteVertexArray(vao)
      if (buffer) g.deleteBuffer(buffer)
    },
  }
}

export function drawArrowHeads(gl: WebGL2RenderingContext, program: ProgramInfo, arrows: readonly ArrowGpu[], target: DrawTarget, pass: AaPass): void {
  if (arrows.length === 0) return
  const { camera, world, colors } = target
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_viewProj'), false, float32(camera.viewProj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform2f(program.uniform('u_viewport'), target.width, target.height)
  gl.uniform1f(program.uniform('u_pixelRatio'), target.pixelRatio)
  gl.uniform1f(program.uniform('u_depthBias'), LINE_DEPTH_BIAS)
  gl.uniform1i(program.uniform('u_pass'), pass)
  for (const a of arrows) {
    const [r, g, b] = a.look.color(colors)
    gl.uniform3f(program.uniform('u_color'), r, g, b)
    gl.uniform1f(program.uniform('u_opacity'), a.look.opacity)
    gl.uniform1f(program.uniform('u_headSize'), a.look.headSize)
    gl.uniform1f(program.uniform('u_shaftWidth'), a.look.shaftWidth)
    gl.bindVertexArray(a.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, a.count)
  }
  gl.bindVertexArray(null)
}
