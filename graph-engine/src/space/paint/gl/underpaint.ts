// The underpainting on the GPU (paint-zoom): the model's image of the colour of every pixel of a form
// (PaintFrame.underpaint) becomes a small RGBA8 texture, and one fullscreen pass lays it as the FIRST layer
// of the paint, before the block-in (strokes.ts run(), shaders/underpaint.ts). Only gl/ touches WebGL;
// the image-to-texels step is plain arithmetic, and tested without a GPU.

import { randomFor } from '../../../style/random'
import type { ProgramInfo } from '../../gl/program'
import type { PaintParams } from '../params'
import type { PaperGpu } from './composite'
import { complete, type Resources, type Gl } from './resources'
import { UNDERPAINT_STREAK_GAIN, UNDERPAINT_TEXTURE_MAX, UNDERPAINT_WEAVE_GATE } from './shaders/underpaint'
import { GBUFFER_SCALE } from './gbuffer'
import { srgbEncodeFast } from './strokes'

// The least coverage the underpainting has anywhere inside a form: its opacity less the most the weave
// and the streaks can take (shaders/underpaint.ts). With the defaults that is 0.62, so a gap between
// strokes reads as paint. (The coverage tests use this.)
export function underpaintFloor(params: PaintParams): number {
  const u = params.underpaint
  const opacity = Math.min(Math.max(u.opacity, 0), 1)
  const weave = UNDERPAINT_WEAVE_GATE * Math.min(Math.max(params.canvas.texture, 0), UNDERPAINT_TEXTURE_MAX)
  const streak = UNDERPAINT_STREAK_GAIN * Math.min(Math.max(u.streak, 0), 1)
  return opacity * Math.max(0, 1 - weave - streak)
}

// The brush direction of the streaks (a unit vector, in CSS px with y up): a seeded angle within about
// 40 degrees of the horizontal, as a hand scrubs a wash across a ground. The seed is the params' seed.
export function underpaintDirection(seed: number): [number, number] {
  const a = randomFor('paint/underpaint/direction', seed).range(-0.7, 0.7)
  return [Math.cos(a), Math.sin(a)]
}

export interface UnderpaintTexels {
  // RGBA8: sRGB colour, and 255 coverage where the form is. An empty texel next to a form takes its
  // nearest neighbour's colour (coverage 0), so the filtered edge does not pull in black.
  rgba: Uint8Array
  // How many texels are covered.
  covered: number
  // The mean sRGB colour of the covered texels (0..1): what a point of the form the last frame did not see is laid in
  // while the camera moves.
  mean: [number, number, number]
}

// How far an empty texel next to a form takes the form's colour, in texels (the baked pass dilates its image the same
// distance, shaders/bakedUnderpaint.ts).
export const UNDERPAINT_BLEED = 2
const BLEED = UNDERPAINT_BLEED

// The texels of an underpainting image (3 floats per pixel, linear-light sRGB, NaN where empty) of
// `width` x `height`; null when the image is not that size or covers nothing.
export function underpaintTexels(image: Float32Array, width: number, height: number): UnderpaintTexels | null {
  const n = width * height
  if (n === 0 || image.length !== 3 * n) return null
  const rgba = new Uint8Array(4 * n)
  let covered = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    const r = image[3 * i]
    if (Number.isNaN(r)) continue
    covered++
    rgba[4 * i] = Math.round(srgbEncodeFast(r) * 255)
    rgba[4 * i + 1] = Math.round(srgbEncodeFast(image[3 * i + 1]) * 255)
    rgba[4 * i + 2] = Math.round(srgbEncodeFast(image[3 * i + 2]) * 255)
    rgba[4 * i + 3] = 255
    sr += rgba[4 * i]
    sg += rgba[4 * i + 1]
    sb += rgba[4 * i + 2]
  }
  if (covered === 0) return null
  const mean: [number, number, number] = [sr / covered / 255, sg / covered / 255, sb / covered / 255]
  // the colour of an empty texel within BLEED of a form: the nearest covered one's, across then down (coverage
  // stays 0). `has` marks the texels that have a colour, covered or taken.
  const has = new Uint8Array(n)
  for (let i = 0; i < n; i++) has[i] = rgba[4 * i + 3] !== 0 ? 1 : 0
  const take = (to: number, from: number) => {
    rgba[4 * to] = rgba[4 * from]
    rgba[4 * to + 1] = rgba[4 * from + 1]
    rgba[4 * to + 2] = rgba[4 * from + 2]
  }
  const taken: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (has[i] === 1) continue
      for (let d = 1; d <= BLEED; d++) {
        const l = x - d >= 0 && has[i - d] === 1 ? i - d : -1
        const r = x + d < width && has[i + d] === 1 ? i + d : -1
        const from = l >= 0 ? l : r
        if (from >= 0) {
          take(i, from)
          taken.push(i)
          break
        }
      }
    }
  }
  for (const i of taken) has[i] = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (has[i] === 1) continue
      for (let d = 1; d <= BLEED; d++) {
        const u = y - d >= 0 && has[i - d * width] === 1 ? i - d * width : -1
        const v = y + d < height && has[i + d * width] === 1 ? i + d * width : -1
        const from = u >= 0 ? u : v
        if (from >= 0) {
          take(i, from)
          break
        }
      }
    }
  }
  return { rgba, covered, mean }
}

export interface UnderpaintDraw {
  program: ProgramInfo
  paper: PaperGpu
  // The accumulation target's size in backing px, and the device px per CSS px.
  width: number
  height: number
  pixelRatio: number
  // The canvas's extent over the image's (the image is rounded up to whole G-buffer pixels).
  covered: { width: number; height: number }
  params: PaintParams
}

// The warp of a re-projected frame (shaders/underpaint.ts, gl/warp.ts): the new view's depth and matrices, the old
// view's, and the old G-buffer's depth.
export interface UnderpaintWarp {
  program: ProgramInfo
  // The new view's depth texture (R32F, the target's size), and how far a point may lie from a stored depth.
  sceneDepth: WebGLTexture
  bias: number
  invViewProj: Float32Array
  eye: readonly [number, number, number]
  viewDir: readonly [number, number, number]
  oldViewProj: Float32Array
  oldEye: readonly [number, number, number]
  oldViewDir: readonly [number, number, number]
  // The old view's size in CSS px.
  oldCss: readonly [number, number]
}

export class UnderpaintRenderer {
  private texture: WebGLTexture | null = null
  // A framebuffer on the texture, made when a pass draws the underpainting (the baked surfaces) instead of an image
  // being uploaded.
  private fbo: WebGLFramebuffer | null = null
  private width = 0
  private height = 0
  // The image the texture holds now: a frame painted again does not make the texels again.
  private held: Float32Array | null = null
  private has = false
  private mean: [number, number, number] = [0.5, 0.5, 0.5]
  // The last full frame's G-buffer depth (R32F), for the warp: the array it was made from, and its size.
  private oldDepth: WebGLTexture | null = null
  private oldDepthHeld: Float32Array | null = null
  private oldDepthWidth = 0
  private oldDepthHeight = 0

  private readonly gl: Gl
  private readonly res: Resources

  constructor(gl: Gl, res: Resources) {
    this.gl = gl
    this.res = res
  }

  // Take an image to lay. False when there is nothing to lay (no image, one of another size, or one that
  // covers nothing), and then draw() does nothing.
  prepare(image: Float32Array, width: number, height: number): boolean {
    if (this.held === image && this.width === width && this.height === height && this.texture) return this.has
    const texels = underpaintTexels(image, width, height)
    this.held = image
    this.has = texels !== null
    if (!texels) return false
    this.mean = texels.mean
    const gl = this.gl
    this.ensureTexture(width, height)
    if (!this.texture) {
      this.has = false
      return false
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, texels.rgba)
    return true
  }

  // The texture, `width` x `height` texels: the one that is there, or a new one (and then it has no framebuffer yet).
  private ensureTexture(width: number, height: number): void {
    const gl = this.gl
    if (!this.texture || this.width !== width || this.height !== height) {
      this.res.deleteFramebuffer(this.fbo)
      this.fbo = null
      this.res.deleteTexture(this.texture)
      this.texture = this.res.texture(gl.RGBA8, width, height, gl.LINEAR)
      this.width = width
      this.height = height
    }
  }

  // The framebuffer of the underpainting texture, for a pass that draws the underpainting (the baked surfaces, gl/bakedSurfaces.ts)
  // in place of an image uploaded from the model: the texture is made `width` x `height` texels if it is not that. Null when no
  // texture or framebuffer can be made. The caller draws every texel and then calls drawn().
  renderTarget(width: number, height: number): WebGLFramebuffer | null {
    const gl = this.gl
    this.ensureTexture(width, height)
    if (!this.texture) return null
    if (!this.fbo) {
      const fbo = this.res.framebuffer()
      if (!fbo) return null
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      const good = complete(gl)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (!good) {
        this.res.deleteFramebuffer(fbo)
        return null
      }
      this.fbo = fbo
    }
    return this.fbo
  }

  // A pass has drawn the underpainting into the texture (renderTarget): draw() lays it, and an image uploaded before it is
  // not what the texture holds any more.
  drawn(): void {
    this.held = null
    this.has = true
  }

  // The pass, into the framebuffer bound for drawing (both attachments, no blending: it goes first).
  draw(input: UnderpaintDraw): void {
    if (!this.has || !this.texture) return
    this.bindCommon(input, input.program)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  // What both variants need: the program, the image and the paper's height, and the mask's uniforms.
  private bindCommon(input: UnderpaintDraw, program: ProgramInfo): void {
    const gl = this.gl
    const { paper, params } = input
    gl.disable(gl.BLEND)
    gl.useProgram(program.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.activeTexture(gl.TEXTURE0 + 1)
    gl.bindTexture(gl.TEXTURE_2D, paper.height)
    gl.uniform1i(program.uniform('u_under'), 0)
    gl.uniform1i(program.uniform('u_paperH'), 1)
    gl.uniform2i(program.uniform('u_paperSize'), paper.size, paper.size)
    gl.uniform2f(program.uniform('u_resolution'), input.width, input.height)
    gl.uniform2f(program.uniform('u_uvScale'), input.covered.width, input.covered.height)
    gl.uniform1f(program.uniform('u_pixelRatio'), input.pixelRatio)
    gl.uniform1f(program.uniform('u_opacity'), params.underpaint.opacity)
    gl.uniform1f(program.uniform('u_streak'), params.underpaint.streak)
    gl.uniform1f(program.uniform('u_texture'), params.canvas.texture)
    const dir = underpaintDirection(params.seed)
    gl.uniform2f(program.uniform('u_dir'), dir[0], dir[1])
    gl.uniform1ui(program.uniform('u_seed'), (Math.imul(params.seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0)
  }

  // The last full frame's G-buffer depth, for the warp: uploaded once for one array (a re-projected frame is painted
  // again and again with the same one). False when it is not a G-buffer-sized depth, or no texture could be made.
  setOldDepth(depth: Float32Array, width: number, height: number): boolean {
    if (depth.length !== width * height || width < 1 || height < 1) return false
    if (this.oldDepthHeld === depth && this.oldDepth) return true
    const gl = this.gl
    if (!this.oldDepth || this.oldDepthWidth !== width || this.oldDepthHeight !== height) {
      this.res.deleteTexture(this.oldDepth)
      this.oldDepth = this.res.texture(gl.R32F, width, height)
      this.oldDepthWidth = width
      this.oldDepthHeight = height
    }
    if (!this.oldDepth) return false
    gl.bindTexture(gl.TEXTURE_2D, this.oldDepth)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, depth)
    this.oldDepthHeld = depth
    return true
  }

  // The pass again, warped onto the new view (see UnderpaintWarp): the same mask and uniforms, and the warp's own.
  drawWarped(input: UnderpaintDraw, warp: UnderpaintWarp): void {
    if (!this.has || !this.texture || !this.oldDepth) return
    const gl = this.gl
    const { program } = warp
    this.bindCommon(input, program)
    gl.activeTexture(gl.TEXTURE0 + 2)
    gl.bindTexture(gl.TEXTURE_2D, warp.sceneDepth)
    gl.activeTexture(gl.TEXTURE0 + 3)
    gl.bindTexture(gl.TEXTURE_2D, this.oldDepth)
    gl.uniform1i(program.uniform('u_sceneDepth'), 2)
    gl.uniform1i(program.uniform('u_oldDepth'), 3)
    gl.uniformMatrix4fv(program.uniform('u_invVP'), false, warp.invViewProj)
    gl.uniform3f(program.uniform('u_eye'), warp.eye[0], warp.eye[1], warp.eye[2])
    gl.uniform3f(program.uniform('u_viewDir'), warp.viewDir[0], warp.viewDir[1], warp.viewDir[2])
    gl.uniformMatrix4fv(program.uniform('u_oldVP'), false, warp.oldViewProj)
    gl.uniform3f(program.uniform('u_oldEye'), warp.oldEye[0], warp.oldEye[1], warp.oldEye[2])
    gl.uniform3f(program.uniform('u_oldViewDir'), warp.oldViewDir[0], warp.oldViewDir[1], warp.oldViewDir[2])
    gl.uniform2f(program.uniform('u_oldCss'), warp.oldCss[0], warp.oldCss[1])
    gl.uniform2f(program.uniform('u_gridCss'), this.width * GBUFFER_SCALE, this.height * GBUFFER_SCALE)
    gl.uniform3f(program.uniform('u_fallback'), this.mean[0], this.mean[1], this.mean[2])
    gl.uniform1f(program.uniform('u_depthBias'), warp.bias)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  destroy(): void {
    this.res.deleteFramebuffer(this.fbo)
    this.res.deleteTexture(this.texture)
    this.res.deleteTexture(this.oldDepth)
    this.forget()
  }

  // After a context loss the texture is already dead.
  forget(): void {
    this.texture = null
    this.fbo = null
    this.width = 0
    this.height = 0
    this.held = null
    this.has = false
    this.oldDepth = null
    this.oldDepthHeld = null
    this.oldDepthWidth = 0
    this.oldDepthHeight = 0
  }
}
