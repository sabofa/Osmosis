// The debug views (R5) that are not the painted image itself: the value plan,
// zones, planes and edge classes. The model hands the renderer per-pixel data
// at G-buffer resolution (PaintFrame.debug); each view becomes a flat RGBA8
// image drawn nearest-filtered over the canvas, with the edge segments as
// lines on top. The role, grey and paint-only views use the stroke and
// composite passes instead (PaintRenderer).

import type { PaintDebug } from '../types'
import { ZONES } from '../types'
import type { ProgramInfo } from '../../gl/program'
import type { Resources, Gl } from './resources'

// Edge classes (EDGE_CLASSES order): lost grey, soft blue, firm orange, hard red.
export const EDGE_CLASS_COLOURS = new Float32Array([
  0.62, 0.62, 0.62, // lost
  0.25, 0.52, 0.9, // soft
  0.96, 0.58, 0.14, // firm
  0.82, 0.12, 0.12, // hard
])

// Zone colours in ZONES order: light, half-tone, core shadow, reflected, cast.
export const ZONE_COLOURS: readonly (readonly [number, number, number])[] = [
  [0.96, 0.9, 0.62], // light
  [0.88, 0.62, 0.34], // half
  [0.36, 0.22, 0.42], // core
  [0.36, 0.64, 0.6], // reflected
  [0.22, 0.3, 0.5], // cast
]

export const DEBUG_BACKGROUND: readonly [number, number, number] = [0.86, 0.84, 0.8]

const to8 = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 255)

// OKLab lightness L as a grey (sRGB), the way the mockup draws a value plan.
export function greyForLightness(L: number): number {
  const lin = Math.min(Math.max(L, 0), 1) ** 3
  const c = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055
  return c
}

// The model's value per G-buffer pixel (PaintDebug.value, 0..1, -1 empty) as
// grey: lightness 0.12 + 0.84 u, the way the mockup draws a value plan.
export function valueImage(value: Float32Array): Uint8Array {
  const n = value.length
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const u = value[i]
    if (u < 0) continue // empty: transparent, the background shows
    const g = to8(greyForLightness(0.12 + 0.84 * u))
    out[i * 4] = g
    out[i * 4 + 1] = g
    out[i * 4 + 2] = g
    out[i * 4 + 3] = 255
  }
  return out
}

export function zonesImage(debug: PaintDebug): Uint8Array {
  const n = debug.zones.length
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const z = debug.zones[i]
    if (z >= ZONES.length) continue
    const c = ZONE_COLOURS[z]
    out[i * 4] = to8(c[0])
    out[i * 4 + 1] = to8(c[1])
    out[i * 4 + 2] = to8(c[2])
    out[i * 4 + 3] = 255
  }
  return out
}

// A stable pastel per plane id (a golden-ratio walk around the hue circle).
export function planeColour(id: number): [number, number, number] {
  const hue = ((id * 0.61803398875) % 1 + 1) % 1
  const k = (n: number) => (n + hue * 12) % 12
  const s = 0.45
  const l = 0.72
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

export function planesImage(debug: PaintDebug): Uint8Array {
  const n = debug.planes.length
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const id = debug.planes[i]
    if (id < 0) continue
    const c = planeColour(id)
    out[i * 4] = to8(c[0])
    out[i * 4 + 1] = to8(c[1])
    out[i * 4 + 2] = to8(c[2])
    out[i * 4 + 3] = 255
  }
  return out
}

// The edge view's backdrop: a faint grey tint per plane.
export function planeTintImage(debug: PaintDebug): Uint8Array {
  const n = debug.planes.length
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const id = debug.planes[i]
    if (id < 0) continue
    // Three greys by plane id, close to the background.
    const g = to8(0.9 - 0.06 * ((((id * 2654435761) >>> 0) % 5) / 4))
    out[i * 4] = g
    out[i * 4 + 1] = g
    out[i * 4 + 2] = g
    out[i * 4 + 3] = 255
  }
  return out
}

export class DebugRenderer {
  private image: WebGLTexture | null = null
  private imageWidth = 0
  private imageHeight = 0
  private segmentBuffer: WebGLBuffer | null = null
  private classBuffer: WebGLBuffer | null = null
  private vao: WebGLVertexArrayObject | null = null

  private readonly gl: Gl
  private readonly res: Resources

  constructor(gl: Gl, res: Resources) {
    this.gl = gl
    this.res = res
  }

  // Draw a flat image over the whole canvas.
  drawImage(
    program: ProgramInfo,
    rgba: Uint8Array,
    width: number,
    height: number,
    canvas: { width: number; height: number },
    covered: { width: number; height: number },
  ): void {
    const gl = this.gl
    if (!this.image || this.imageWidth !== width || this.imageHeight !== height) {
      this.res.deleteTexture(this.image)
      this.image = this.res.texture(gl.RGBA8, width, height)
      this.imageWidth = width
      this.imageHeight = height
    }
    if (!this.image) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.image)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    gl.useProgram(program.program)
    gl.uniform1i(program.uniform('u_image'), 0)
    gl.uniform2f(program.uniform('u_resolution'), canvas.width, canvas.height)
    // The image covers `width * scale` css px; the canvas shows `covered` of them.
    gl.uniform2f(program.uniform('u_uvScale'), covered.width, covered.height)
    gl.uniform3f(program.uniform('u_background'), DEBUG_BACKGROUND[0], DEBUG_BACKGROUND[1], DEBUG_BACKGROUND[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // The edge segments (x0, y0, x1, y1 in CSS px) with their classes.
  drawEdges(program: ProgramInfo, debug: PaintDebug, cssSize: readonly [number, number], canvas: { width: number; height: number }): void {
    const gl = this.gl
    const count = Math.min(debug.edgeClass.length, Math.floor(debug.edgeSegments.length / 4))
    if (count === 0) return
    if (!this.vao) {
      this.vao = this.res.vertexArray()
      this.segmentBuffer = this.res.buffer()
      this.classBuffer = this.res.buffer()
    }
    if (!this.vao || !this.segmentBuffer || !this.classBuffer) return
    const classes = new Float32Array(count)
    for (let i = 0; i < count; i++) classes[i] = Math.min(debug.edgeClass[i], 3)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segmentBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, debug.edgeSegments.subarray(0, count * 4), gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.classBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, classes, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.useProgram(program.program)
    gl.uniform2f(program.uniform('u_cssSize'), cssSize[0], cssSize[1])
    gl.uniform1f(program.uniform('u_halfWidth'), 1.5)
    gl.uniform3fv(program.uniform('u_classColour'), EDGE_CLASS_COLOURS)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.bindVertexArray(null)
  }

  destroy(): void {
    this.res.deleteTexture(this.image)
    this.res.deleteBuffer(this.segmentBuffer)
    this.res.deleteBuffer(this.classBuffer)
    this.res.deleteVertexArray(this.vao)
    this.forget()
  }

  forget(): void {
    this.image = null
    this.imageWidth = 0
    this.imageHeight = 0
    this.segmentBuffer = null
    this.classBuffer = null
    this.vao = null
  }
}
