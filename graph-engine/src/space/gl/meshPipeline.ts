// The mesh pipeline (plan G9): lit two-sided triangles, opaque first, then
// translucent (opacity < 1) in a second pass with depth writes off, blended,
// sorted back to front by centroid depth, each mesh back faces first (see
// drawTranslucentMeshes). That pass is the fallback S3's order-independent
// transparency replaces.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { MeshMark, Vec3 } from '../scene/types'
import { resolveSpaceColor, type SpaceColors } from '../theme'
import { createBuffer, float32, floatAttribute, relativeFloat32, worldNormalsFloat32, type GpuResource } from './buffers'
import type { ProgramInfo } from './program'
import { MESH_FRAGMENT, MESH_VERTEX } from './shaders/mesh'

export const MESH_PROGRAM = { name: 'mesh', vertex: MESH_VERTEX, fragment: MESH_FRAGMENT }

export interface MeshGpu extends GpuResource {
  mark: MeshMark
  vao: WebGLVertexArrayObject
  count: number
  // The mean vertex, in world, for sorting translucent meshes.
  centroid: Vec3
}

export function uploadMesh(gl: WebGL2RenderingContext, mark: MeshMark, world: WorldMap): MeshGpu | null {
  const count = mark.indices.length - (mark.indices.length % 3)
  if (count === 0 || mark.positions.length < 9) return null
  const positions = relativeFloat32(mark.positions, world.centre)
  const normals = worldNormalsFloat32(mark.normals, world.scale)
  const vao = gl.createVertexArray()
  if (!vao) return null
  gl.bindVertexArray(vao)
  const buffers: WebGLBuffer[] = []
  const pos = createBuffer(gl, gl.ARRAY_BUFFER, positions)
  const nrm = createBuffer(gl, gl.ARRAY_BUFFER, normals)
  if (pos) {
    buffers.push(pos)
    floatAttribute(gl, 0, pos, 3)
  }
  if (nrm) {
    buffers.push(nrm)
    floatAttribute(gl, 1, nrm, 3)
  }
  // The element buffer binding is VAO state: bind it while the VAO is bound.
  const idx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mark.indices)
  if (idx) buffers.push(idx)
  gl.bindVertexArray(null)

  let cx = 0
  let cy = 0
  let cz = 0
  const n = positions.length / 3
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
    centroid: [(cx / n) * kx, (cy / n) * ky, (cz / n) * kz],
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

function bindMeshProgram(gl: WebGL2RenderingContext, program: ProgramInfo, camera: CameraMatrices, world: WorldMap): void {
  gl.useProgram(program.program)
  gl.uniformMatrix4fv(program.uniform('u_view'), false, float32(camera.view))
  gl.uniformMatrix4fv(program.uniform('u_proj'), false, float32(camera.proj))
  gl.uniform3f(program.uniform('u_scale'), world.scale[0], world.scale[1], world.scale[2])
  gl.uniform1i(program.uniform('u_perspective'), camera.projection === 'perspective' ? 1 : 0)
}

function drawOne(gl: WebGL2RenderingContext, program: ProgramInfo, mesh: MeshGpu, colors: SpaceColors): void {
  const [r, g, b] = resolveSpaceColor(mesh.mark.style.color, colors.palette, colors.theme)
  gl.uniform3f(program.uniform('u_color'), r, g, b)
  gl.uniform1f(program.uniform('u_opacity'), Math.min(1, Math.max(0, mesh.mark.style.opacity)))
  gl.bindVertexArray(mesh.vao)
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
}

export function drawMeshes(
  gl: WebGL2RenderingContext,
  program: ProgramInfo,
  meshes: readonly MeshGpu[],
  camera: CameraMatrices,
  world: WorldMap,
  colors: SpaceColors,
): void {
  if (meshes.length === 0) return
  bindMeshProgram(gl, program, camera, world)
  for (const mesh of meshes) drawOne(gl, program, mesh, colors)
  gl.bindVertexArray(null)
}

// Translucent meshes, already sorted back to front, blended, never writing
// depth: a translucent mesh that wrote depth would hide every translucent
// mesh drawn after it wherever it lies in front of that mesh's far parts
// (a tangent plane cutting a translucent surface lost whole regions). Each
// mesh draws its back faces (front culled) and then its front faces (back
// culled), so a closed surface's far side composites under its near side.
// This sorted fallback stays on devices without EXT_color_buffer_float
// (SP4); S3's order-independent transparency replaces it elsewhere.
export function drawTranslucentMeshes(
  gl: WebGL2RenderingContext,
  program: ProgramInfo,
  meshes: readonly MeshGpu[],
  camera: CameraMatrices,
  world: WorldMap,
  colors: SpaceColors,
): void {
  if (meshes.length === 0) return
  bindMeshProgram(gl, program, camera, world)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.depthMask(false)
  gl.enable(gl.CULL_FACE)
  for (const mesh of meshes) {
    gl.cullFace(gl.FRONT)
    drawOne(gl, program, mesh, colors)
    gl.cullFace(gl.BACK)
    drawOne(gl, program, mesh, colors)
  }
  gl.disable(gl.CULL_FACE)
  gl.depthMask(true)
  gl.disable(gl.BLEND)
  gl.bindVertexArray(null)
}
