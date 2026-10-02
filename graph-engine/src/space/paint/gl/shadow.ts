// The shadow map (R2): an orthographic depth map from the key light, fitted to
// the scene's bounding sphere, at 1024 x 1024. The G-buffer pass samples it
// with a 3 x 3 PCF and a slope-scaled bias (shaders/gbuffer.ts).

import { complete, type Resources, type Gl } from './resources'

export const SHADOW_SIZE = 1024
// A margin over the fitted radius so nothing on the sphere is clipped.
export const SHADOW_FIT = 1.02

export interface ShadowTarget {
  size: number
  fbo: WebGLFramebuffer
  depth: WebGLTexture
  destroy(): void
}

export function createShadowTarget(gl: Gl, res: Resources, size = SHADOW_SIZE): ShadowTarget | null {
  const fbo = res.framebuffer()
  const depth = res.texture(gl.DEPTH_COMPONENT24, size, size)
  const destroy = () => {
    res.deleteFramebuffer(fbo)
    res.deleteTexture(depth)
  }
  if (!fbo || !depth) {
    destroy()
    return null
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0)
  gl.drawBuffers([gl.NONE])
  gl.readBuffer(gl.NONE)
  const good = complete(gl)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (!good) {
    destroy()
    return null
  }
  return { size, fbo, depth, destroy }
}

export interface LightFrame {
  // Column-major clip matrix for positions relative to the scene origin.
  matrix: Float32Array
  // The light's screen axes and its direction (toward the light).
  right: [number, number, number]
  up: [number, number, number]
  toward: [number, number, number]
  radius: number
}

// The light's orthographic frame: x along `right`, y along `up`, depth along
// the light direction, all scaled by 1 / radius, so a point at origin + radius
// toward the light is at depth -1 (nearest) and the far side at +1.
export function lightFrame(lightDir: readonly [number, number, number], radius: number): LightFrame {
  const e = normalise(lightDir, [0, 0, 1])
  // right = normalise(z x e); a light straight up or down takes x instead.
  let right = normalise([-e[1], e[0], 0], [1, 0, 0])
  if (Math.hypot(e[0], e[1]) < 1e-4) right = [1, 0, 0]
  const up: [number, number, number] = [
    e[1] * right[2] - e[2] * right[1],
    e[2] * right[0] - e[0] * right[2],
    e[0] * right[1] - e[1] * right[0],
  ]
  const k = 1 / radius
  const m = new Float32Array(16)
  // Rows of the matrix: right, up, -toward (nearest the light is smallest z).
  const rows = [right, up, [-e[0], -e[1], -e[2]] as [number, number, number]]
  rows.forEach((row, r) => {
    for (let c = 0; c < 3; c++) m[c * 4 + r] = row[c] * k
  })
  m[15] = 1
  return { matrix: m, right, up, toward: e, radius }
}

function normalise(v: readonly [number, number, number], fallback: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : fallback
}
