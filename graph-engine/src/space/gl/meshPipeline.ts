// The mesh pipeline (plan G9, E3): lit two-sided triangles with colormaps,
// mesh lines, the back-face tint, depth cueing and box clipping
// (shaders/mesh.ts). Opaque meshes draw first; translucent ones (opacity < 1)
// draw later, by the frame loop's order-independent transparency or, without
// it, sorted back to front (drawTranslucentMeshes).
//
// Attributes: positions (0) and normals (1) always; the colormap scalar (2)
// only when the mark has scalars and a colour scale; (u, v) (3) only when it
// has uv and mesh lines. (u, v) goes up shifted by a whole number of
// mesh-line steps from the first line, so the lines sit at the integers of
// uv / step and a surface at x ~ 4500 keeps its line precision in Float32.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { ColormapName, ColorScale, MeshLines, MeshMark, Vec3 } from '../scene/types'
import { hexToRgb, resolveSpaceColor, type Rgb, type SpaceColors } from '../theme'
import { createBuffer, float32, floatAttribute, relativeFloat32, worldNormalsFloat32, type GpuResource } from './buffers'
import { applyLook, type MarkLook } from './look'
import type { ProgramInfo } from './program'
import { MESH_FRAGMENT, MESH_VERTEX } from './shaders/mesh'

export const MESH_PROGRAM = { name: 'mesh', vertex: MESH_VERTEX, fragment: MESH_FRAGMENT }

// The back face's tint (E3), per theme.
export const BACK_TINT: Record<'light' | 'dark', Rgb> = {
  light: hexToRgb(0x5a6b8c),
  dark: hexToRgb(0x8fa2c9),
}

export const SCALAR_LOCATION = 2
export const UV_LOCATION = 3

export interface MeshGpu extends GpuResource {
  mark: MeshMark
  vao: WebGLVertexArrayObject
  count: number
  // The mean vertex, in world, for sorting translucent meshes.
  centroid: Vec3
  // Whether the colormap scalar is an attribute.
  scalars: boolean
  // The mesh-line steps (du, dv) when (u, v) is an attribute.
  meshStep: readonly [number, number] | null
}

export function drawableMeshLines(lines: MeshLines | null): lines is MeshLines {
  return lines !== null && lines.du > 0 && lines.dv > 0 && Number.isFinite(lines.du) && Number.isFinite(lines.dv)
}

// (u, v) less a whole number of steps from (u0, v0), chosen from the first
// vertex, so the uploaded values are small and the lines stay at integers.
export function shiftedUv(uv: Float64Array, lines: MeshLines): Float32Array {
  const shift = (first: number, origin: number, step: number) =>
    Number.isFinite(first) ? origin + step * Math.floor((first - origin) / step) : origin
  const su = shift(uv[0], lines.u0, lines.du)
  const sv = shift(uv[1], lines.v0, lines.dv)
  const out = new Float32Array(uv.length)
  for (let i = 0; i + 1 < uv.length; i += 2) {
    out[i] = uv[i] - su
    out[i + 1] = uv[i + 1] - sv
  }
  return out
}

export function uploadMesh(gl: WebGL2RenderingContext, mark: MeshMark, world: WorldMap): MeshGpu | null {
  const count = mark.indices.length - (mark.indices.length % 3)
  if (count === 0 || mark.positions.length < 9) return null
  const vertices = mark.positions.length / 3
  const positions = relativeFloat32(mark.positions, world.centre)
  const normals = worldNormalsFloat32(mark.normals, world.scale)
  const vao = gl.createVertexArray()
  if (!vao) return null
  gl.bindVertexArray(vao)
  const buffers: WebGLBuffer[] = []
  const attribute = (location: number, data: Float32Array, size: number) => {
    const buffer = createBuffer(gl, gl.ARRAY_BUFFER, data)
    if (!buffer) return false
    buffers.push(buffer)
    floatAttribute(gl, location, buffer, size)
    return true
  }
  attribute(0, positions, 3)
  attribute(1, normals, 3)
  const scalars =
    mark.scalars !== null && mark.style.colorScale !== null && mark.scalars.length >= vertices && attribute(SCALAR_LOCATION, Float32Array.from(mark.scalars), 1)
  const lines = mark.style.meshLines
  const withUv = mark.uv !== null && mark.uv.length >= 2 * vertices && drawableMeshLines(lines) && attribute(UV_LOCATION, shiftedUv(mark.uv, lines), 2)
  // The element buffer binding is VAO state: bind it while the VAO is bound.
  const idx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mark.indices)
  if (idx) buffers.push(idx)
  gl.bindVertexArray(null)

  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i]
    cy += positions[i + 1]
    cz += positions[i + 2]
  }
  const [kx, ky, kz] = world.scale
  return {
    mark,
    vao,
    count,
    centroid: [(cx / vertices) * kx, (cy / vertices) * ky, (cz / vertices) * kz],
    scalars,
    meshStep: withUv && lines ? [lines.du, lines.dv] : null,
    destroy(g) {
      g.deleteVertexArray(vao)
      for (const b of buffers) g.deleteBuffer(b)
    },
  }
}

export function isTranslucent(mesh: MeshGpu): boolean {
  return mesh.mark.style.opacity < 1
}

// View-space depth (more negative is farther).
function viewDepth(camera: CameraMatrices, p: Vec3): number {
  const m = camera.view
  return m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
}

// Farthest first.
export function sortBackToFront(meshes: MeshGpu[], camera: CameraMatrices): MeshGpu[] {
  return meshes
    .map((mesh) => ({ mesh, depth: viewDepth(camera, mesh.centroid) }))
    .sort((a, b) => a.depth - b.depth)
    .map((e) => e.mesh)
}

// Everything a mesh draw needs beyond the meshes.
export interface MeshDraw {
  camera: CameraMatrices
  world: WorldMap
  colors: SpaceColors
  look: MarkLook
  // Backing-store pixels per CSS pixel.
  pixelRatio: number
  scales: readonly ColorScale[]
  // The colormap texture for a map, under the current theme.
  lut(map: ColormapName): WebGLTexture | null
}

// The maps the meshes' colour scales use.
export function mapsUsed(meshes: readonly MeshGpu[], scales: readonly ColorScale[]): Set<ColormapName> {
  const maps = new Set<ColormapName>()
  for (const m of meshes) {
    const scale = m.scalars && m.mark.style.colorScale !== null ? scales[m.mark.style.colorScale] : undefined
    if (scale) maps.add(scale.map)
  }
  return maps
}

export function bindMeshProgram(gl: WebGL2RenderingContext, program: ProgramInfo, draw: MeshDraw): void {
  const { camera, world, colors } = draw
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_view'), false, float32(camera.view))
  gl.uniformMatrix4fv(program.uniform('u_proj'), false, float32(camera.proj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform1i(program.uniform('u_perspective'), camera.projection === 'perspective' ? 1 : 0)
  const tint = BACK_TINT[colors.theme]
  gl.uniform3f(program.uniform('u_backTint'), tint[0], tint[1], tint[2])
  gl.uniform3f(program.uniform('u_ink'), colors.axis[0], colors.axis[1], colors.axis[2])
  gl.uniform3f(program.uniform('u_noData'), colors.grid[0], colors.grid[1], colors.grid[2])
  gl.uniform1f(program.uniform('u_pixelRatio'), draw.pixelRatio)
  gl.uniform1i(program.uniform('u_lut'), 0)
  applyLook(gl, program, draw.look)
}

export function drawOneMesh(gl: WebGL2RenderingContext, program: ProgramInfo, mesh: MeshGpu, draw: MeshDraw): void {
  const style = mesh.mark.style
  const [r, g, b] = resolveSpaceColor(style.color, draw.colors.palette, draw.colors.theme)
  gl.uniform3f(program.uniform('u_color'), r, g, b)
  gl.uniform1f(program.uniform('u_opacity'), Math.min(1, Math.max(0, style.opacity)))
  const scale = mesh.scalars && style.colorScale !== null ? draw.scales[style.colorScale] : undefined
  const lut = scale ? draw.lut(scale.map) : null
  gl.uniform1i(program.uniform('u_colormap'), scale && lut ? 1 : 0)
  if (scale && lut) {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, lut)
    gl.uniform2f(program.uniform('u_domain'), scale.domain.min, scale.domain.max)
    gl.uniform1i(program.uniform('u_diverging'), scale.diverging ? 1 : 0)
  }
  const step = mesh.meshStep
  gl.uniform1i(program.uniform('u_meshLines'), step ? 1 : 0)
  gl.uniform2f(program.uniform('u_meshStep'), step ? step[0] : 1, step ? step[1] : 1)
  gl.bindVertexArray(mesh.vao)
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
}

export function drawMeshes(gl: WebGL2RenderingContext, program: ProgramInfo, meshes: readonly MeshGpu[], draw: MeshDraw): void {
  if (meshes.length === 0) return
  bindMeshProgram(gl, program, draw)
  for (const mesh of meshes) drawOneMesh(gl, program, mesh, draw)
  gl.bindVertexArray(null)
}

// Translucent meshes, already sorted back to front, blended, never writing
// depth: a translucent mesh that wrote depth would hide every translucent
// mesh drawn after it wherever it lies in front of that mesh's far parts
// (a tangent plane cutting a translucent surface lost whole regions). Each
// mesh draws its back faces (front culled) and then its front faces (back
// culled), so a closed surface's far side composites under its near side.
// This sorted fallback is for devices without EXT_color_buffer_float (SP4);
// elsewhere the frame loop's order-independent transparency draws them.
export function drawTranslucentMeshes(gl: WebGL2RenderingContext, program: ProgramInfo, meshes: readonly MeshGpu[], draw: MeshDraw): void {
  if (meshes.length === 0) return
  bindMeshProgram(gl, program, draw)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.depthMask(false)
  gl.enable(gl.CULL_FACE)
  for (const mesh of meshes) {
    gl.cullFace(gl.FRONT)
    drawOneMesh(gl, program, mesh, draw)
    gl.cullFace(gl.BACK)
    drawOneMesh(gl, program, mesh, draw)
  }
  gl.disable(gl.CULL_FACE)
  gl.depthMask(true)
  gl.disable(gl.BLEND)
  gl.bindVertexArray(null)
}
