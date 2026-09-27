// The point pipeline (plan G9 "Points"): instanced screen-aligned quads,
// shaped by a signed distance in the fragment shader.

import type { WorldMap } from '../camera/world'
import type { PointMark, PointShape } from '../scene/types'
import { resolveSpaceColor } from '../theme'
import { createBuffer, float32, floatAttribute, relativeFloat32, type GpuResource } from './buffers'
import { LINE_DEPTH_BIAS, type AaPass, type DrawTarget, type SharedQuads } from './linePipeline'
import type { ProgramInfo } from './program'
import { POINT_FRAGMENT, POINT_VERTEX } from './shaders/point'

export const POINT_PROGRAM = { name: 'point', vertex: POINT_VERTEX, fragment: POINT_FRAGMENT }

export const SHAPE_CODE: Record<PointShape, number> = { dot: 0, ring: 1, cross: 2, diamond: 3, square: 4 }

export interface PointGpu extends GpuResource {
  mark: PointMark
  vao: WebGLVertexArrayObject
  count: number
}

export function uploadPoints(gl: WebGL2RenderingContext, shared: SharedQuads, mark: PointMark, world: WorldMap): PointGpu | null {
  const count = Math.floor(mark.positions.length / 3)
  if (count === 0) return null
  const vao = gl.createVertexArray()
  if (!vao) return null
  gl.bindVertexArray(vao)
  floatAttribute(gl, 0, shared.squareCorners, 2)
  const centres = createBuffer(gl, gl.ARRAY_BUFFER, relativeFloat32(mark.positions, world.centre))
  if (centres) floatAttribute(gl, 1, centres, 3, 0, 0, 1)
  gl.bindVertexArray(null)
  return {
    mark,
    vao,
    count,
    destroy(g) {
      g.deleteVertexArray(vao)
      if (centres) g.deleteBuffer(centres)
    },
  }
}

export function drawPoints(gl: WebGL2RenderingContext, program: ProgramInfo, points: readonly PointGpu[], target: DrawTarget, pass: AaPass): void {
  if (points.length === 0) return
  const { camera, world, colors } = target
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_viewProj'), false, float32(camera.viewProj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform2f(program.uniform('u_viewport'), target.width, target.height)
  gl.uniform1f(program.uniform('u_pixelRatio'), target.pixelRatio)
  gl.uniform1f(program.uniform('u_depthBias'), LINE_DEPTH_BIAS)
  gl.uniform1i(program.uniform('u_pass'), pass)
  for (const p of points) {
    const [r, g, b] = resolveSpaceColor(p.mark.style.color, colors.palette, colors.theme)
    gl.uniform3f(program.uniform('u_color'), r, g, b)
    gl.uniform1f(program.uniform('u_size'), p.mark.style.size)
    gl.uniform1i(program.uniform('u_shape'), SHAPE_CODE[p.mark.style.shape] ?? 0)
    gl.bindVertexArray(p.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.count)
  }
  gl.bindVertexArray(null)
}
