// The stroke passes (R3): the batch sorted into layers and back to front, packed
// into a data texture, and drawn one instanced draw per non-empty layer into
// an accumulation framebuffer, with two targets ping-ponged between layers so
// a layer's strokes can pick up what the layers beneath it already painted.

import { LAYER_ORDER, PATH_POINTS, ROLES, type StrokeBatch } from '../types'
import type { PaperGpu } from './composite'
import type { ProgramInfo } from '../../gl/program'
import { complete, type Resources, type Gl } from './resources'
import { TEXELS_PER_STROKE, VERTICES_PER_STROKE } from './shaders/stroke'

// --- plan: sort -------------------------------------------------------------

export interface StrokePlan {
  // Strokes that will draw (those with a valid layer).
  count: number
  // The batch index of each slot, layers in LAYER_ORDER, and within a layer
  // back to front: the farthest (largest depth) first, ties by batch index.
  order: Uint32Array
  // Slot range of layer i: [layerStart[i], layerStart[i + 1]).
  layerStart: Int32Array
}

export function planStrokes(batch: StrokeBatch): StrokePlan {
  const layers = LAYER_ORDER.length
  const counts = new Int32Array(layers + 1)
  for (let i = 0; i < batch.count; i++) {
    const layer = batch.layer[i]
    if (layer < layers) counts[layer + 1]++
  }
  for (let l = 0; l < layers; l++) counts[l + 1] += counts[l]
  const layerStart = counts.slice()
  const order = new Uint32Array(layerStart[layers])
  const cursor = layerStart.slice(0, layers)
  for (let i = 0; i < batch.count; i++) {
    const layer = batch.layer[i]
    if (layer < layers) order[cursor[layer]++] = i
  }
  const depth = batch.depth
  for (let l = 0; l < layers; l++) sortFarthestFirst(order.subarray(layerStart[l], layerStart[l + 1]), depth)
  return { count: order.length, order, layerStart }
}

const INDEX_BITS = 2 ** 21

// Sorts the batch indices in `slots` farthest (largest depth) first, ties by
// index. The depth is quantised to 32 bits within the layer's range and packed
// with the index into one number (below 2^53), so the native numeric sort does
// the work: far faster than a comparator on 15k strokes. A non-finite depth
// sorts last (drawn last, over everything).
function sortFarthestFirst(slots: Uint32Array, depth: Float32Array): void {
  const n = slots.length
  if (n < 2) return
  let lo = Infinity
  let hi = -Infinity
  let maxIndex = 0
  for (let k = 0; k < n; k++) {
    const i = slots[k]
    if (i > maxIndex) maxIndex = i
    const d = depth[i]
    if (!Number.isFinite(d)) continue
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  if (maxIndex >= INDEX_BITS) {
    slots.sort((a, b) => depth[b] - depth[a] || a - b)
    return
  }
  const span = hi > lo ? hi - lo : 1
  const keys = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const i = slots[k]
    const d = depth[i]
    const q = Number.isFinite(d) ? Math.floor(((hi - d) / span) * 4294967294) : 4294967295
    keys[k] = q * INDEX_BITS + i
  }
  keys.sort()
  for (let k = 0; k < n; k++) slots[k] = keys[k] % INDEX_BITS
}

// --- pack: the data texture --------------------------------------------------

export interface StrokeLayout {
  perRow: number
  width: number
  rows: number
}

// Strokes sit side by side, TEXELS_PER_STROKE texels each, `perRow` to a row.
export function strokeLayout(count: number, maxTextureSize: number): StrokeLayout {
  const maxRows = Math.max(1, maxTextureSize)
  const perRow = Math.max(8, Math.ceil(count / maxRows))
  return { perRow, width: perRow * TEXELS_PER_STROKE, rows: Math.max(1, Math.ceil(count / perRow)) }
}

export function srgbEncode(linear: number): number {
  const c = Math.min(Math.max(linear, 0), 1)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

// A lookup of srgbEncode over [0, 1] (4096 steps, linear between), for the
// per-stroke colours: far cheaper than three pow() per stroke at 15k strokes.
const SRGB_STEPS = 4096
const SRGB_LUT = (() => {
  const t = new Float32Array(SRGB_STEPS + 2)
  for (let i = 0; i <= SRGB_STEPS + 1; i++) t[i] = srgbEncode(i / SRGB_STEPS)
  return t
})()

export function srgbEncodeFast(linear: number): number {
  const x = (linear < 0 ? 0 : linear > 1 ? 1 : linear) * SRGB_STEPS
  const i = x | 0
  return SRGB_LUT[i] + (SRGB_LUT[i + 1] - SRGB_LUT[i]) * (x - i)
}

// Fills `out` (RGBA32F texels, width x rows) with the planned strokes. Per
// stroke: PATH_POINTS texels (x, y, width, 0); colour (sRGB) + alpha; (load,
// impasto, bristles, bristleVar); (dry, wet, endSoft, seed >>> 8); (role, edge
// class, 0, 0). A stroke with a non-finite number is packed as an empty one.
export function packStrokes(batch: StrokeBatch, plan: StrokePlan, layout: StrokeLayout, out: Float32Array): void {
  const { perRow, width } = layout
  const { path, width: widths, colour } = batch
  for (let slot = 0; slot < plan.count; slot++) {
    const i = plan.order[slot]
    const row = (slot / perRow) | 0
    const base = (row * width + (slot - row * perRow) * TEXELS_PER_STROKE) * 4
    const pBase = i * 2 * PATH_POINTS
    const wBase = i * PATH_POINTS
    // A NaN or infinity anywhere makes the sum non-finite.
    let sum = 0
    for (let k = 0; k < PATH_POINTS; k++) {
      const x = path[pBase + 2 * k]
      const y = path[pBase + 2 * k + 1]
      const w = widths[wBase + k]
      sum += x + y + w
      const o = base + k * 4
      out[o] = x
      out[o + 1] = y
      out[o + 2] = w > 0 ? w : 0
      out[o + 3] = 0
    }
    if (!Number.isFinite(sum)) {
      // Collapse to a point: the vertex shader drops a stroke shorter than half a pixel.
      for (let k = 0; k < PATH_POINTS; k++) {
        const o = base + k * 4
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
      }
    }
    let o = base + PATH_POINTS * 4
    out[o] = srgbEncodeFast(colour[i * 3])
    out[o + 1] = srgbEncodeFast(colour[i * 3 + 1])
    out[o + 2] = srgbEncodeFast(colour[i * 3 + 2])
    out[o + 3] = batch.alpha[i]
    o += 4
    out[o] = batch.load[i]
    out[o + 1] = batch.impasto[i]
    out[o + 2] = batch.bristles[i]
    out[o + 3] = batch.bristleVar[i]
    o += 4
    out[o] = batch.dry[i]
    out[o + 1] = batch.wet[i]
    out[o + 2] = batch.endSoft[i]
    out[o + 3] = batch.seed[i] >>> 8
    o += 4
    out[o] = batch.role[i]
    out[o + 1] = batch.edge[i]
    out[o + 2] = 0
    out[o + 3] = 0
  }
}

// --- per-role brush constants -------------------------------------------------
// What the batch does not carry, from the mockup's STYLE table, in ROLES order
// (block, form, scumble, glaze, reflected, dab, edge, line).
//   A: base opacity, thinning along the stroke, start boost, wet pickup at the start
//   B: where the bristles end (mean), its spread, 1 for a crisp, exact brush
// A stroke's opacity is `alpha x base`; for a glaze `alpha` is the absolute
// opacity, capped at the glaze's base (a veil of 0.26 stays 0.26).
export const ROLE_A = new Float32Array([
  0.96, 0.45, 0.35, 0.28, // block
  0.9, 0.6, 0.3, 0.3, // form
  0.6, 0.8, 0.2, 0.25, // scumble
  0.34, 0.3, 0.15, 0.3, // glaze
  0.5, 0.4, 0.15, 0.3, // reflected
  0.96, 0, 0.4, 0.1, // dab
  0.95, 0.5, 0.3, 0.1, // edge
  0.98, 0.2, 0.25, 0.04, // line
])
export const ROLE_B = new Float32Array([
  0.92, 0.2, 0, 0, // block
  0.88, 0.3, 0, 0, // form
  0.7, 0.35, 0, 0, // scumble
  1.0, 0.1, 0, 0, // glaze
  0.95, 0.15, 0, 0, // reflected
  1.05, 0, 0, 0, // dab
  0.95, 0.15, 0, 0, // edge
  1.06, 0, 1, 0, // line
])
// Flat colours of the roles view (sRGB).
export const ROLE_DEBUG_COLOURS = new Float32Array([
  0.78, 0.4, 0.3, // block
  0.9, 0.68, 0.25, // form
  0.45, 0.72, 0.42, // scumble
  0.3, 0.45, 0.78, // glaze
  0.3, 0.72, 0.75, // reflected
  0.98, 0.95, 0.75, // dab
  0.55, 0.25, 0.55, // edge
  0.15, 0.15, 0.18, // line
])
export const ROLE_COUNT = ROLES.length

// --- accumulation targets -----------------------------------------------------

export interface AccumTarget {
  fbo: WebGLFramebuffer
  // Premultiplied sRGB colour, coverage (a).
  colour: WebGLTexture
  // Paint height (r).
  height: WebGLTexture
}

export interface AccumTargets {
  width: number
  height: number
  // RGBA16F + R16F (true) or RGBA8 + R8 (false, no float targets).
  float: boolean
  // The scale that keeps paint height inside an 8-bit target.
  heightScale: number
  targets: [AccumTarget, AccumTarget]
  destroy(): void
}

export function createAccumTargets(
  gl: Gl,
  res: Resources,
  width: number,
  height: number,
  float: boolean,
): AccumTargets | null {
  const made: AccumTarget[] = []
  const destroy = () => {
    for (const t of made) {
      res.deleteFramebuffer(t.fbo)
      res.deleteTexture(t.colour)
      res.deleteTexture(t.height)
    }
  }
  for (let n = 0; n < 2; n++) {
    const fbo = res.framebuffer()
    const colour = res.texture(float ? gl.RGBA16F : gl.RGBA8, width, height)
    const heightTexture = res.texture(float ? gl.R16F : gl.R8, width, height)
    if (!fbo || !colour || !heightTexture) {
      res.deleteFramebuffer(fbo)
      res.deleteTexture(colour)
      res.deleteTexture(heightTexture)
      destroy()
      return null
    }
    made.push({ fbo, colour, height: heightTexture })
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + 1, gl.TEXTURE_2D, heightTexture, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0 + 1])
    if (!complete(gl)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      destroy()
      return null
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { width, height, float, heightScale: float ? 1 : 0.5, targets: [made[0], made[1]], destroy }
}

// --- the passes ---------------------------------------------------------------

export interface StrokePassInput {
  stroke: ProgramInfo
  copy: ProgramInfo
  targets: AccumTargets
  paper: PaperGpu
  cssSize: readonly [number, number]
  debugRoles: boolean
}

export interface StrokePassResult {
  // The target holding the finished paint.
  final: AccumTarget
  // Instanced draws made (one per non-empty layer).
  draws: number
}

// A pass laid before the first layer, into the target it is given (the underpainting).
export type FirstPass = (target: AccumTarget) => void

export class StrokeRenderer {
  private data: WebGLTexture | null = null
  private dataWidth = 0
  private dataRows = 0
  private scratch = new Float32Array(0)

  private readonly gl: Gl
  private readonly res: Resources

  constructor(gl: Gl, res: Resources) {
    this.gl = gl
    this.res = res
  }

  // Sort, pack and upload the batch. Returns the plan and layout to draw with.
  upload(batch: StrokeBatch): { plan: StrokePlan; layout: StrokeLayout } {
    const gl = this.gl
    const plan = planStrokes(batch)
    const maxSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
    const layout = strokeLayout(plan.count, Number.isFinite(maxSize) && maxSize > 0 ? maxSize : 2048)
    if (plan.count === 0) return { plan, layout }
    if (!this.data || layout.width !== this.dataWidth || layout.rows > this.dataRows) {
      this.res.deleteTexture(this.data)
      // Grow in steps so a batch that varies a little between frames does not
      // reallocate every frame.
      const rows = Math.max(layout.rows, Math.ceil(layout.rows * 1.25))
      this.data = this.res.texture(gl.RGBA32F, layout.width, rows)
      this.dataWidth = layout.width
      this.dataRows = rows
    }
    const texels = layout.width * layout.rows * 4
    if (this.scratch.length < texels) this.scratch = new Float32Array(texels)
    else this.scratch.fill(0, 0, texels)
    packStrokes(batch, plan, layout, this.scratch)
    if (this.data) {
      gl.bindTexture(gl.TEXTURE_2D, this.data)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layout.width, layout.rows, gl.RGBA, gl.FLOAT, this.scratch.subarray(0, texels))
    }
    return { plan, layout }
  }

  // The layers in order, one draw each. `first`, when there is one, is laid before them (the underpainting),
  // and what it lays is what the first layer's wet pickup finds beneath it.
  run(input: StrokePassInput, plan: StrokePlan, layout: StrokeLayout, first: FirstPass | null = null): StrokePassResult {
    const gl = this.gl
    const { stroke, copy, targets, paper } = input
    const [A, B] = targets.targets
    const zero = new Float32Array(4)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.viewport(0, 0, targets.width, targets.height)
    for (const t of targets.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clearBufferfv(gl.COLOR, 0, zero)
      gl.clearBufferfv(gl.COLOR, 1, zero)
    }
    let final = A
    let draws = 0
    // the passes made so far, the underpainting too: the targets are ping-ponged between them
    let passes = 0
    if (first) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo)
      first(A)
      passes = 1
    }
    if (plan.count === 0 || !this.data) return { final, draws }

    const bind = (unit: number, texture: WebGLTexture | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
    }
    for (let layer = 0; layer < LAYER_ORDER.length; layer++) {
      const first = plan.layerStart[layer]
      const count = plan.layerStart[layer + 1] - first
      if (count === 0) continue
      const dst = passes % 2 === 0 ? A : B
      const src = passes % 2 === 0 ? B : A
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
      if (passes > 0) {
        // The paint so far moves into this layer's target.
        gl.disable(gl.BLEND)
        gl.useProgram(copy.program)
        bind(0, src.colour)
        bind(1, src.height)
        gl.uniform1i(copy.uniform('u_src0'), 0)
        gl.uniform1i(copy.uniform('u_src1'), 1)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(stroke.program)
      bind(0, this.data)
      bind(1, src.colour)
      bind(2, paper.rgba)
      bind(3, paper.height)
      gl.uniform1i(stroke.uniform('u_strokes'), 0)
      gl.uniform1i(stroke.uniform('u_prev'), 1)
      gl.uniform1i(stroke.uniform('u_paper'), 2)
      gl.uniform1i(stroke.uniform('u_paperH'), 3)
      gl.uniform1i(stroke.uniform('u_base'), first)
      gl.uniform1i(stroke.uniform('u_perRow'), layout.perRow)
      gl.uniform2f(stroke.uniform('u_cssSize'), input.cssSize[0], input.cssSize[1])
      gl.uniform2i(stroke.uniform('u_paperSize'), paper.size, paper.size)
      gl.uniform2f(stroke.uniform('u_resolution'), targets.width, targets.height)
      gl.uniform1f(stroke.uniform('u_heightScale'), targets.heightScale)
      gl.uniform4fv(stroke.uniform('u_roleA'), ROLE_A)
      gl.uniform4fv(stroke.uniform('u_roleB'), ROLE_B)
      gl.uniform1i(stroke.uniform('u_debugRoles'), input.debugRoles ? 1 : 0)
      gl.uniform3fv(stroke.uniform('u_roleColour'), ROLE_DEBUG_COLOURS)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, VERTICES_PER_STROKE, count)
      gl.disable(gl.BLEND)
      final = dst
      draws++
      passes++
    }
    return { final, draws }
  }

  destroy(): void {
    this.res.deleteTexture(this.data)
    this.data = null
    this.dataWidth = 0
    this.dataRows = 0
  }

  // After a context loss the texture is already dead.
  forget(): void {
    this.data = null
    this.dataWidth = 0
    this.dataRows = 0
  }
}
