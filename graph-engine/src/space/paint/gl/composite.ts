// The paper on the GPU and the composite pass (R4).
//
// The canvas tile comes from setPaper: sRGB RGBA8 and a 0..1 height. The
// height is normalised once on upload to the mockup's convention (zero mean,
// standard deviation 0.2), because the brush's dry gate and the relief both
// expect that scale. The tile is tiled in screen space at 1:1 device px.

import type { PaintParams } from '../params'
import type { ProgramInfo } from '../../gl/program'
import type { AccumTarget } from './strokes'
import type { Resources, Gl } from './resources'

export interface PaperGpu {
  size: number
  rgba: WebGLTexture
  // Normalised weave height, R32F.
  height: WebGLTexture
  // The tile's mean colour (sRGB 0..1), the flat tone of the no-canvas view.
  flatTone: [number, number, number]
}

// The standard deviation the mockup's canvas height has after normStd x 0.2.
export const PAPER_HEIGHT_STD = 0.2

export function normaliseHeight(height: Float32Array): Float32Array {
  const n = height.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += height[i]
  const mean = n > 0 ? sum / n : 0
  let variance = 0
  for (let i = 0; i < n; i++) variance += (height[i] - mean) * (height[i] - mean)
  const std = Math.sqrt(variance / Math.max(n, 1))
  const out = new Float32Array(n)
  if (std < 1e-9) return out
  const k = PAPER_HEIGHT_STD / std
  for (let i = 0; i < n; i++) out[i] = (height[i] - mean) * k
  return out
}

export function meanColour(rgba: Uint8ClampedArray | Uint8Array): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  const texels = Math.floor(rgba.length / 4)
  // Every 7th texel is plenty for a mean tone.
  let used = 0
  for (let i = 0; i < texels; i += 7) {
    r += rgba[i * 4]
    g += rgba[i * 4 + 1]
    b += rgba[i * 4 + 2]
    used++
  }
  if (used === 0) return [0.93, 0.9, 0.82]
  return [r / used / 255, g / used / 255, b / used / 255]
}

// A flat, warm paper for when nothing was set.
export const DEFAULT_TONE: [number, number, number] = [0.93, 0.9, 0.82]

export function createPaperGpu(
  gl: Gl,
  res: Resources,
  rgba: Uint8ClampedArray | Uint8Array,
  height: Float32Array,
  size: number,
): PaperGpu | null {
  const rgbaTexture = res.texture(gl.RGBA8, size, size)
  const heightTexture = res.texture(gl.R32F, size, size)
  if (!rgbaTexture || !heightTexture) {
    res.deleteTexture(rgbaTexture)
    res.deleteTexture(heightTexture)
    return null
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.bindTexture(gl.TEXTURE_2D, rgbaTexture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba.buffer, rgba.byteOffset, size * size * 4))
  gl.bindTexture(gl.TEXTURE_2D, heightTexture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RED, gl.FLOAT, normaliseHeight(height))
  return { size, rgba: rgbaTexture, height: heightTexture, flatTone: meanColour(rgba) }
}

export function destroyPaperGpu(res: Resources, paper: PaperGpu | null): void {
  if (!paper) return
  res.deleteTexture(paper.rgba)
  res.deleteTexture(paper.height)
}

// The unit light vector of the relief, in image coordinates (y down): the
// azimuth runs counter-clockwise from +x as drawn, so 135 degrees is the
// upper left.
export function reliefLight(azimuthDeg: number, elevationDeg: number): { light: [number, number, number]; half: [number, number, number] } {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const light: [number, number, number] = [Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el), Math.sin(el)]
  // Half vector with a viewer straight above.
  const hx = light[0]
  const hy = light[1]
  const hz = light[2] + 1
  const len = Math.hypot(hx, hy, hz) || 1
  return { light, half: [hx / len, hy / len, hz / len] }
}

export interface CompositeInput {
  program: ProgramInfo
  paint: AccumTarget
  paper: PaperGpu
  heightScale: number
  width: number
  height: number
  // Device px per CSS px.
  pixelRatio: number
  params: PaintParams
  // Show the paint over a flat tone, with no weave.
  noCanvas: boolean
  // Light the paint's relief (off for the flat role view).
  relief: boolean
  grey: boolean
}

// Draws the finished image to the default framebuffer.
export function drawComposite(gl: Gl, input: CompositeInput): void {
  const { program, paint, paper, params } = input
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, input.width, input.height)
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)
  gl.useProgram(program.program)
  const bind = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }
  bind(0, paint.colour)
  bind(1, paint.height)
  bind(2, paper.rgba)
  bind(3, paper.height)
  gl.uniform1i(program.uniform('u_paint0'), 0)
  gl.uniform1i(program.uniform('u_paint1'), 1)
  gl.uniform1i(program.uniform('u_paper'), 2)
  gl.uniform1i(program.uniform('u_paperH'), 3)
  gl.uniform2i(program.uniform('u_paperSize'), paper.size, paper.size)
  gl.uniform2f(program.uniform('u_resolution'), input.width, input.height)
  gl.uniform3f(program.uniform('u_flatTone'), paper.flatTone[0], paper.flatTone[1], paper.flatTone[2])
  gl.uniform1i(program.uniform('u_noCanvas'), input.noCanvas ? 1 : 0)
  gl.uniform1i(program.uniform('u_relief'), input.relief ? 1 : 0)
  gl.uniform1i(program.uniform('u_grey'), input.grey ? 1 : 0)
  gl.uniform1f(program.uniform('u_impasto'), params.impasto.strength)
  gl.uniform1f(program.uniform('u_texture'), params.canvas.texture)
  gl.uniform1f(program.uniform('u_heightScale'), input.heightScale)
  gl.uniform1f(program.uniform('u_pixelRatio'), input.pixelRatio)
  const { light, half } = reliefLight(params.impasto.lightAzimuth, params.impasto.lightElevation)
  gl.uniform3f(program.uniform('u_light'), light[0], light[1], light[2])
  gl.uniform3f(program.uniform('u_halfVec'), half[0], half[1], half[2])
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
