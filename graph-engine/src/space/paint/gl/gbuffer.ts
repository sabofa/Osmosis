// The G-buffer pass (R1): targets, the matrices that map the view onto the
// half-resolution grid, the encodes and their decodes, and the readback into
// the contract's GBuffer.
//
// Pixel (x, y) of the G-buffer covers CSS px (x, y) * scale, row 0 at the TOP:
// the pass renders with y flipped so readPixels returns rows in image order
// and nothing is flipped on the CPU.

import type { GBuffer, PaintView } from '../types'
import { complete, type Resources, type Gl } from './resources'

// CSS px per G-buffer pixel (spec §4: at most half the resolution).
export const GBUFFER_SCALE = 2

export type GBufferMode = 'float' | 'rgba8'

export interface GBufferTarget {
  mode: GBufferMode
  width: number
  height: number
  fbo: WebGLFramebuffer
  textures: WebGLTexture[]
  depth: WebGLRenderbuffer
  destroy(): void
}

export function gbufferSize(cssWidth: number, cssHeight: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(cssWidth / GBUFFER_SCALE)),
    height: Math.max(1, Math.ceil(cssHeight / GBUFFER_SCALE)),
  }
}

// The float layout is one RGBA32F target; the rgba8 layout is three RGBA8
// targets (see shaders/gbuffer.ts). Returns null (everything it made deleted)
// when the framebuffer is incomplete.
export function createGBufferTarget(
  gl: Gl,
  res: Resources,
  width: number,
  height: number,
  float: boolean,
): GBufferTarget | null {
  const formats = float ? [gl.RGBA32F] : [gl.RGBA8, gl.RGBA8, gl.RGBA8]
  const fbo = res.framebuffer()
  const depth = res.renderbuffer(gl.DEPTH_COMPONENT24, width, height)
  const textures: WebGLTexture[] = []
  let ok = fbo !== null && depth !== null
  for (const format of formats) {
    const t = res.texture(format, width, height)
    if (!t) ok = false
    else textures.push(t)
  }
  const destroy = () => {
    res.deleteFramebuffer(fbo)
    res.deleteRenderbuffer(depth)
    for (const t of textures) res.deleteTexture(t)
  }
  if (!ok || !fbo || !depth) {
    destroy()
    return null
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0))
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
  const good = complete(gl)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (!good) {
    destroy()
    return null
  }
  return { mode: float ? 'float' : 'rgba8', width, height, fbo, textures, depth, destroy }
}

// clip' = S * viewProj * T(origin), as a column-major matrix for a mesh whose
// positions are uploaded relative to `origin`. S puts the CSS-pixel view onto
// the G-buffer grid: ndc.x' = sx ndc.x + sx - 1, ndc.y' = -sy ndc.y + sy - 1
// with sx = cssWidth / (scale gw): it matches the pixel grid exactly (an odd
// width is not stretched) and flips y, so row 0 is the top.
export function gbufferMatrix(
  viewProj: ArrayLike<number>,
  origin: readonly [number, number, number],
  cssWidth: number,
  cssHeight: number,
  gw: number,
  gh: number,
): Float32Array {
  const m = new Float64Array(16)
  for (let i = 0; i < 12; i++) m[i] = viewProj[i]
  for (let r = 0; r < 4; r++) {
    m[12 + r] = viewProj[r] * origin[0] + viewProj[4 + r] * origin[1] + viewProj[8 + r] * origin[2] + viewProj[12 + r]
  }
  const sx = cssWidth / (GBUFFER_SCALE * gw)
  const sy = cssHeight / (GBUFFER_SCALE * gh)
  for (let c = 0; c < 4; c++) {
    const x = m[c * 4]
    const y = m[c * 4 + 1]
    const w = m[c * 4 + 3]
    m[c * 4] = sx * x + (sx - 1) * w
    m[c * 4 + 1] = -sy * y + (sy - 1) * w
  }
  return Float32Array.from(m)
}

// A projective matrix is perspective when its last row has a z term (an
// orthographic one is (0, 0, 0, 1)).
export function isPerspective(viewProj: ArrayLike<number>): boolean {
  return Math.abs(viewProj[3]) + Math.abs(viewProj[7]) + Math.abs(viewProj[11]) > 1e-6
}

// --- the float layout (the TypeScript twin of shaders/gbuffer.ts) -----------

// u is quantised to 10 bits in the float layout; (mark + 1) * 2 + shadow takes
// the rest of the float32's 24-bit integer range.
export const U_LEVELS = 1023
export const MAX_MARKS = 8191

// A unit vector as an octahedral map: two numbers in [-1, 1].
export function octEncode(n: readonly [number, number, number]): [number, number] {
  const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1
  let x = n[0] / l
  let y = n[1] / l
  if (n[2] < 0) {
    const ox = (1 - Math.abs(y)) * (n[0] >= 0 ? 1 : -1)
    const oy = (1 - Math.abs(x)) * (n[1] >= 0 ? 1 : -1)
    x = ox
    y = oy
  }
  return [x, y]
}

export function octDecode(x: number, y: number): [number, number, number] {
  let nx = x
  let ny = y
  const nz = 1 - Math.abs(x) - Math.abs(y)
  if (nz < 0) {
    nx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1)
    ny = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1)
  }
  const inv = 1 / (Math.hypot(nx, ny, nz) || 1)
  return [nx * inv, ny * inv, nz * inv]
}

export interface GBufferTexel {
  normal: [number, number, number]
  depth: number
  value: number
  shadow: boolean
  mark: number
}

// One texel of the float layout: [oct x, oct y, depth, packed].
export function encodeFloatTexel(t: GBufferTexel): [number, number, number, number] {
  const [x, y] = octEncode(t.normal)
  const u = Math.floor(Math.min(Math.max(t.value, 0), 1) * U_LEVELS + 0.5)
  return [x, y, t.depth, ((t.mark + 1) * 2 + (t.shadow ? 1 : 0)) * 1024 + u]
}

// The float layout's readback: `a` is RGBA32F, `width * height` texels, rows
// top first. A texel whose packed number is below 2048 (mark + 1 = 0) is empty.
export function decodeFloatGBuffer(a: Float32Array, width: number, height: number): GBuffer {
  const n = width * height
  const depth = new Float32Array(n)
  const normal = new Float32Array(n * 3)
  const value = new Float32Array(n)
  const shadow = new Uint8Array(n)
  const mark = new Int32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const packed = (a[j + 3] + 0.5) | 0
    const m = packed >> 11
    if (m === 0) {
      depth[i] = Number.POSITIVE_INFINITY
      value[i] = -1
      mark[i] = -1
      continue
    }
    mark[i] = m - 1
    shadow[i] = (packed >> 10) & 1
    value[i] = (packed & 1023) / U_LEVELS
    depth[i] = a[j + 2]
    const x = a[j]
    const y = a[j + 1]
    let nx = x
    let ny = y
    const nz = 1 - Math.abs(x) - Math.abs(y)
    if (nz < 0) {
      nx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1)
      ny = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1)
    }
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
    const k = i * 3
    normal[k] = nx * inv
    normal[k + 1] = ny * inv
    normal[k + 2] = nz * inv
  }
  return { width, height, scale: GBUFFER_SCALE, depth, normal, value, shadow, mark }
}

// --- RGBA8 layout (the TypeScript twin of shaders/gbuffer.ts) ---------------

export const RGBA8_BYTES_PER_TEXEL = 12

const unorm8 = (x: number): number => Math.round(Math.min(Math.max(x, 0), 1) * 255)

// One texel as three RGBA8 quads: [n.xyz * .5 + .5, shadow] [depth24, 255]
// [u16, mark + 1 as 16 bits].
export function encodeRgba8Texel(t: GBufferTexel, depthRange: readonly [number, number]): Uint8Array {
  const out = new Uint8Array(RGBA8_BYTES_PER_TEXEL)
  out[0] = unorm8(t.normal[0] * 0.5 + 0.5)
  out[1] = unorm8(t.normal[1] * 0.5 + 0.5)
  out[2] = unorm8(t.normal[2] * 0.5 + 0.5)
  out[3] = t.shadow ? 255 : 0
  const d = Math.min(Math.max((t.depth - depthRange[0]) / (depthRange[1] - depthRange[0]), 0), 1)
  const d24 = Math.floor(d * 16777215 + 0.5)
  out[4] = (d24 >> 16) & 255
  out[5] = (d24 >> 8) & 255
  out[6] = d24 & 255
  out[7] = 255
  const v16 = Math.floor(Math.min(Math.max(t.value, 0), 1) * 65535 + 0.5)
  const m16 = t.mark + 1
  out[8] = v16 >> 8
  out[9] = v16 & 255
  out[10] = (m16 >> 8) & 255
  out[11] = m16 & 255
  return out
}

// The inverse for one texel's 12 bytes. mark + 1 = 0 is empty (null).
export function decodeRgba8Texel(bytes: ArrayLike<number>, depthRange: readonly [number, number]): GBufferTexel | null {
  const m16 = (bytes[10] << 8) | bytes[11]
  if (m16 === 0) return null
  let nx = (bytes[0] / 255) * 2 - 1
  let ny = (bytes[1] / 255) * 2 - 1
  let nz = (bytes[2] / 255) * 2 - 1
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len
  ny /= len
  nz /= len
  const d24 = (bytes[4] << 16) | (bytes[5] << 8) | bytes[6]
  return {
    normal: [nx, ny, nz],
    depth: depthRange[0] + (d24 / 16777215) * (depthRange[1] - depthRange[0]),
    value: ((bytes[8] << 8) | bytes[9]) / 65535,
    shadow: bytes[3] >= 128,
    mark: m16 - 1,
  }
}

// The rgba8 layout's three readbacks (RGBA8, `width * height` texels each).
export function decodeRgba8GBuffer(
  nb: Uint8Array,
  db: Uint8Array,
  vb: Uint8Array,
  width: number,
  height: number,
  depthRange: readonly [number, number],
): GBuffer {
  const n = width * height
  const depth = new Float32Array(n)
  const normal = new Float32Array(n * 3)
  const value = new Float32Array(n)
  const shadow = new Uint8Array(n)
  const mark = new Int32Array(n)
  const span = (depthRange[1] - depthRange[0]) / 16777215
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const m16 = (vb[j + 2] << 8) | vb[j + 3]
    if (m16 === 0) {
      depth[i] = Number.POSITIVE_INFINITY
      value[i] = -1
      mark[i] = -1
      continue
    }
    mark[i] = m16 - 1
    shadow[i] = nb[j + 3] >= 128 ? 1 : 0
    value[i] = ((vb[j] << 8) | vb[j + 1]) / 65535
    depth[i] = depthRange[0] + ((db[j] << 16) | (db[j + 1] << 8) | db[j + 2]) * span
    const nx = (nb[j] / 255) * 2 - 1
    const ny = (nb[j + 1] / 255) * 2 - 1
    const nz = (nb[j + 2] / 255) * 2 - 1
    const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1)
    const k = i * 3
    normal[k] = nx * inv
    normal[k + 1] = ny * inv
    normal[k + 2] = nz * inv
  }
  return { width, height, scale: GBUFFER_SCALE, depth, normal, value, shadow, mark }
}

export function emptyGBuffer(width: number, height: number): GBuffer {
  const n = width * height
  return {
    width,
    height,
    scale: GBUFFER_SCALE,
    depth: new Float32Array(n).fill(Number.POSITIVE_INFINITY),
    normal: new Float32Array(n * 3),
    value: new Float32Array(n).fill(-1),
    shadow: new Uint8Array(n),
    mark: new Int32Array(n).fill(-1),
  }
}

// Scratch buffers for the readbacks, kept between frames.
export class ReadbackScratch {
  private f32: Float32Array[] = []
  private u8: Uint8Array[] = []

  floats(slot: number, length: number): Float32Array {
    if (!this.f32[slot] || this.f32[slot].length < length) this.f32[slot] = new Float32Array(length)
    return this.f32[slot].subarray(0, length)
  }

  bytes(slot: number, length: number): Uint8Array {
    if (!this.u8[slot] || this.u8[slot].length < length) this.u8[slot] = new Uint8Array(length)
    return this.u8[slot].subarray(0, length)
  }
}

// One readPixels per attachment, then decode.
export function readGBuffer(
  gl: Gl,
  target: GBufferTarget,
  scratch: ReadbackScratch,
  depthRange: readonly [number, number],
): GBuffer {
  const { width, height } = target
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
  const texels = width * height * 4
  let g: GBuffer
  if (target.mode === 'float') {
    const a = scratch.floats(0, texels)
    gl.readBuffer(gl.COLOR_ATTACHMENT0)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, a)
    g = decodeFloatGBuffer(a, width, height)
  } else {
    const planes = [0, 1, 2].map((i) => {
      const bytes = scratch.bytes(i, texels)
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      return bytes
    })
    g = decodeRgba8GBuffer(planes[0], planes[1], planes[2], width, height, depthRange)
  }
  gl.readBuffer(gl.COLOR_ATTACHMENT0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return g
}

// --- the float layout's readback that does not wait --------------------------
//
// readGBuffer's readPixels into an array makes the page wait, there and then, for every command the GPU has queued (a
// paint or two of a drag among them). The float layout can be read the other way: readPixels into a PIXEL_PACK_BUFFER
// (the GPU copies when it gets there, the call returns at once), a fence behind it, and the page asks
// clientWaitSync(sync, 0, 0) whether the fence has passed, a call that never waits, until it has; then
// getBufferSubData takes the bytes from a buffer that is already filled, and the usual decode follows.

export interface PackBuffer {
  buffer: WebGLBuffer | null
  bytes: number
}

// Does the context give a sync object for fenceSync (a context that does not, or a test's fake, answers nothing)?
export function canReadAsync(gl: Gl): boolean {
  const probe = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!probe) return false
  gl.deleteSync(probe)
  return true
}

export interface PendingRead {
  sync: WebGLSync
  width: number
  height: number
  // Which context the read was started on (the renderer counts a restore): a read that is polled after the context went, even
  // one that has come back since, is of a context that is no more and is dropped (dropRead).
  generation: number
}

// Starts the readback of a float G-buffer: into `pack` (the buffer, made on first use and grown when the view grows), a
// fence behind it, and the commands flushed so the fence is on its way. Null when there is no buffer or no fence (read it
// the plain way then). `generation` is the context's, kept with the read (PendingRead.generation).
export function beginFloatRead(gl: Gl, res: Resources, target: GBufferTarget, pack: PackBuffer, generation = 0): PendingRead | null {
  const { width, height } = target
  const bytes = width * height * 16
  if (!pack.buffer) pack.buffer = res.buffer()
  if (!pack.buffer) return null
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack.buffer)
  if (pack.bytes < bytes) {
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
    pack.bytes = bytes
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
  gl.readBuffer(gl.COLOR_ATTACHMENT0)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  gl.flush()
  return sync ? { sync, width, height, generation } : null
}

// A read that will not be finished (the context went, the renderer was disposed, the fence or the copy failed): its fence is
// deleted, which on a context that is lost, or one that has come back and never made it, is a call that does nothing.
export function dropRead(gl: Gl, pending: PendingRead): void {
  try {
    gl.deleteSync(pending.sync)
  } catch {
    // (nothing to give back)
  }
}

// Has the fence passed? Never waits.
export function pollRead(gl: Gl, pending: PendingRead): 'ready' | 'wait' | 'failed' {
  const status = gl.clientWaitSync(pending.sync, 0, 0)
  if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return 'ready'
  return status === gl.WAIT_FAILED ? 'failed' : 'wait'
}

// The bytes of a read whose fence has passed, decoded; the fence is deleted.
export function finishFloatRead(gl: Gl, pending: PendingRead, pack: PackBuffer, scratch: ReadbackScratch): GBuffer {
  const a = scratch.floats(0, pending.width * pending.height * 4)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack.buffer)
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, a)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  gl.deleteSync(pending.sync)
  return decodeFloatGBuffer(a, pending.width, pending.height)
}

// The depth packing range of the rgba8 layout: the scene's bounding sphere
// along the view direction.
export function depthRangeFor(view: PaintView, origin: readonly [number, number, number], radius: number): [number, number] {
  const base =
    (origin[0] - view.eye[0]) * view.viewDir[0] +
    (origin[1] - view.eye[1]) * view.viewDir[1] +
    (origin[2] - view.eye[2]) * view.viewDir[2]
  return [base - radius, base + radius]
}
