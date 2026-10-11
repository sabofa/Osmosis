// GPU buffers for marks (plan G9).
//
// - Positions go up as Float32 RELATIVE TO THE BOX CENTRE (G1): a - c is
//   computed in Float64 and then cast, and the model matrix applies k. A
//   surface at x ~ 4500 keeps its precision.
// - Normals go up already in world: normalise(n / k).
// - A mark's resources are keyed by the mark OBJECT, so a scene whose
//   unchanged marks are the same objects (S1's setValue guarantee) re-uploads
//   nothing for them, and replacing a scene frees every mark not in it.

import { worldNormal } from '../camera/world'
import type { Vec3 } from '../scene/types'

export function relativeFloat32(positions: Float64Array, centre: Vec3): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i] - centre[0]
    out[i + 1] = positions[i + 1] - centre[1]
    out[i + 2] = positions[i + 2] - centre[2]
  }
  return out
}

export function worldNormalsFloat32(normals: Float64Array, scale: Vec3): Float32Array {
  const out = new Float32Array(normals.length)
  for (let i = 0; i + 2 < normals.length; i += 3) {
    const n = worldNormal([normals[i], normals[i + 1], normals[i + 2]], scale)
    out[i] = n[0]
    out[i + 1] = n[1]
    out[i + 2] = n[2]
  }
  return out
}

export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: Float32Array | Uint32Array,
  usage: number = gl.STATIC_DRAW,
): WebGLBuffer | null {
  const buffer = gl.createBuffer()
  if (!buffer) return null
  gl.bindBuffer(target, buffer)
  gl.bufferData(target, data, usage)
  return buffer
}

// Bind `buffer` to a float attribute of the bound VAO.
export function floatAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  buffer: WebGLBuffer,
  size: number,
  stride = 0,
  offset = 0,
  divisor = 0,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset)
  if (divisor) gl.vertexAttribDivisor(location, divisor)
}

// Anything uploaded that must be freed.
export interface GpuResource {
  destroy(gl: WebGL2RenderingContext): void
}

// Reconcile `cache` with `keys` by identity: destroy what is no longer
// wanted, create what is new, keep the rest untouched. A `create` that
// returns null (nothing to draw) is simply not cached.
export function syncByIdentity<K extends object, R extends GpuResource>(
  gl: WebGL2RenderingContext,
  cache: Map<K, R>,
  keys: readonly K[],
  create: (key: K) => R | null,
): void {
  const wanted = new Set(keys)
  for (const [key, resource] of cache) {
    if (wanted.has(key)) continue
    resource.destroy(gl)
    cache.delete(key)
  }
  for (const key of keys) {
    if (cache.has(key)) continue
    const resource = create(key)
    if (resource) cache.set(key, resource)
  }
}

// Float64 column-major matrices (camera/mat4.ts) cast for uniformMatrix4fv.
export function float32(m: Float64Array, into?: Float32Array): Float32Array {
  const out = into ?? new Float32Array(m.length)
  out.set(m)
  return out
}
