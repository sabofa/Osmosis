// The scene's depth for the current view (shaders/depth.ts): the target it is drawn into, the matrix it is drawn
// with, and the tolerance a stroke is tested against. Only gl/ touches WebGL.

import { complete, type Gl, type Resources } from './resources'

export interface SceneDepthTarget {
  width: number
  height: number
  fbo: WebGLFramebuffer
  // RG32F: the view depth of the nearest opaque surface at each pixel (1e30 where there is none) and whether that
  // surface is bare table.
  texture: WebGLTexture
  depth: WebGLRenderbuffer
  destroy(): void
}

// Where the target holds nothing (the shaders compare against 1e29).
export const NO_SURFACE = 1e30

// A target of `width` x `height` backing px, or null when the framebuffer is incomplete (a context that cannot
// render to RG32F: the caller then paints the strokes without a depth test).
export function createSceneDepthTarget(gl: Gl, res: Resources, width: number, height: number): SceneDepthTarget | null {
  const fbo = res.framebuffer()
  const texture = res.texture(gl.RG32F, width, height)
  const depth = res.renderbuffer(gl.DEPTH_COMPONENT24, width, height)
  const destroy = () => {
    res.deleteFramebuffer(fbo)
    res.deleteTexture(texture)
    res.deleteRenderbuffer(depth)
  }
  if (!fbo || !texture || !depth) {
    destroy()
    return null
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  gl.drawBuffers([gl.COLOR_ATTACHMENT0])
  const good = complete(gl)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (!good) {
    destroy()
    return null
  }
  return { width, height, fbo, texture, depth, destroy }
}

// clip = viewProj * T(origin), as a column-major matrix for a mesh whose positions are uploaded relative to `origin`
// (the same folding as gbufferMatrix, without the G-buffer's grid and its flip: the paint's targets are drawn the
// way the strokes are, GL's y up).
export function originMatrix(viewProj: ArrayLike<number>, origin: readonly [number, number, number]): Float32Array {
  const m = new Float64Array(16)
  for (let i = 0; i < 12; i++) m[i] = viewProj[i]
  for (let r = 0; r < 4; r++) {
    m[12 + r] = viewProj[r] * origin[0] + viewProj[4 + r] * origin[1] + viewProj[8 + r] * origin[2] + viewProj[12 + r]
  }
  return Float32Array.from(m)
}

// How far behind a surface a stroke may lie and still be on it, in view depth: the surface the stroke was walked
// on is a polyline against the mesh's own facets, and the depth is a float. About a hundredth of the scene's radius:
// 0.012 of it.
export const DEPTH_BIAS_FRACTION = 0.012
export const depthBias = (radius: number): number => DEPTH_BIAS_FRACTION * Math.max(radius, 1e-6)
