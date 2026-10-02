// The scene's meshes on the GPU, for the shadow and G-buffer passes.
//
// Scene positions are drawn as they are: the paint model and the renderer
// share the scene's coordinate space, so PaintView's matrices map scene
// space (the lab builds them against an identity world map). Positions go up
// as Float32 RELATIVE TO AN ORIGIN near the scene (computed in Float64), so a
// scene far from zero keeps its precision (the same rule as space/gl); the
// origin is folded into the matrices on the CPU.
//
// Only opaque meshes (opacity 1) draw. A translucent mesh is painted as
// glazes by the model, and anything behind it must reach the G-buffer to be
// painted; so a translucent mesh is in neither the G-buffer nor the shadow
// map, and the model treats its particles as visible when nothing opaque is
// nearer than they are.

import type { Mark, MeshMark, SpaceScene } from '../../scene/types'
import { MAX_MARKS } from './gbuffer'
import type { Resources, Gl } from './resources'

export interface MeshGpu {
  // Index into scene.marks.
  mark: number
  vao: WebGLVertexArrayObject
  count: number
  // Bare table: flat, horizontal (every normal straight up). Lit, it is canvas, and the underpainting of a re-projected
  // frame does not fill it in where the last frame did not see it (the model's rule: model/view.ts groundMarks).
  ground: boolean
}

export interface SceneGpu {
  meshes: MeshGpu[]
  // The origin the positions are relative to, and a bounding sphere about it
  // of every drawn vertex.
  origin: [number, number, number]
  radius: number
}

export function isDrawableMesh(mark: Mark): mark is MeshMark {
  return mark.kind === 'mesh' && mark.style.opacity >= 1 && mark.indices.length >= 3 && mark.positions.length >= 9
}

// The bounding box centre and the farthest finite vertex from it, over the
// drawable meshes.
export function sceneBounds(scene: SpaceScene): { origin: [number, number, number]; radius: number } {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const meshes = scene.marks.filter(isDrawableMesh)
  for (const m of meshes) {
    const p = m.positions
    for (let i = 0; i + 2 < p.length; i += 3) {
      if (!Number.isFinite(p[i]) || !Number.isFinite(p[i + 1]) || !Number.isFinite(p[i + 2])) continue
      for (let c = 0; c < 3; c++) {
        if (p[i + c] < lo[c]) lo[c] = p[i + c]
        if (p[i + c] > hi[c]) hi[c] = p[i + c]
      }
    }
  }
  if (!Number.isFinite(lo[0])) return { origin: [0, 0, 0], radius: 1 }
  const origin: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  let r2 = 0
  for (const m of meshes) {
    const p = m.positions
    for (let i = 0; i + 2 < p.length; i += 3) {
      const dx = p[i] - origin[0]
      const dy = p[i + 1] - origin[1]
      const dz = p[i + 2] - origin[2]
      const d2 = dx * dx + dy * dy + dz * dz
      if (Number.isFinite(d2) && d2 > r2) r2 = d2
    }
  }
  return { origin, radius: Math.max(Math.sqrt(r2), 1e-6) }
}

// Every normal straight up (a flat horizontal surface): the same test as the model's (model/view.ts).
export function isFlatUp(mesh: MeshMark): boolean {
  const n = mesh.normals
  if (n.length === 0) return false
  for (let i = 0; i < n.length; i += 3) if (n[i + 2] < 0.9995) return false
  return true
}

export function relativePositions(positions: Float64Array, origin: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i] - origin[0]
    out[i + 1] = positions[i + 1] - origin[1]
    out[i + 2] = positions[i + 2] - origin[2]
  }
  return out
}

export function uploadScene(gl: Gl, res: Resources, scene: SpaceScene): SceneGpu {
  const { origin, radius } = sceneBounds(scene)
  const meshes: MeshGpu[] = []
  scene.marks.forEach((mark, index) => {
    // The G-buffer packs the mark index into 13 bits.
    if (index > MAX_MARKS || !isDrawableMesh(mark)) return
    const vao = res.vertexArray()
    if (!vao) return
    gl.bindVertexArray(vao)
    const attribute = (location: number, data: Float32Array) => {
      const buffer = res.buffer()
      if (!buffer) return
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
    }
    attribute(0, relativePositions(mark.positions, origin))
    // A normal array shorter than the positions is padded with zeros (undefined).
    const normals = new Float32Array(mark.positions.length)
    normals.set(mark.normals.length > normals.length ? mark.normals.subarray(0, normals.length) : mark.normals)
    attribute(1, normals)
    // The element buffer binding is VAO state: bind it while the VAO is bound.
    const indices = res.buffer()
    if (indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mark.indices, gl.STATIC_DRAW)
    }
    gl.bindVertexArray(null)
    meshes.push({ mark: index, vao, count: mark.indices.length - (mark.indices.length % 3), ground: isFlatUp(mark) })
  })
  return { meshes, origin, radius }
}
