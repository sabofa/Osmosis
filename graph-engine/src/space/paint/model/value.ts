// The value plan (spec §3.3, §11): "find the values of the figure".
//
// The model computes its OWN value at every G-buffer pixel from the normal and
// the shadow flag, so Ben's curves apply (the renderer's GBuffer.value is a
// reference only):
//   lit  = lightResponse(max(0, n·L)) · intensity · (shadowed ? 0 : 1)
//   raw  = clamp(lit + ambient + sky·max(n.z, 0) + bounce·max(−n.z, 0) − occlusion·ao, 0, 1)
//   v    = valueCurve(raw)
// ao is screen-space ambient occlusion from the G-buffer depth: a small seeded
// kernel of 8 samples over occlusionRadiusPx at G-buffer resolution, a sample
// counting only where it stands NEARER than the tangent plane extended to it
// (so a tilted plane does not occlude itself) and within range. The default
// curves are the identity, so with occlusion 0 the value is bit-identical to
// the renderer's own raw lit value (rawLitValue).
//
// A painter does not paint that continuous ramp; she paints a few zones, each
// with its own value, and the steps between them: light, half-tone, core
// shadow, reflected light, cast shadow. zoneSample() maps v to the PLAN value
// the lighting curve consumes. Boundaries are over v and soft (value.soft wide):
//   core side | half-tone ramp | light ramp
//   a boundary centred just under halfLo, so the half-tone is fully on at halfLo
//   a boundary centred between halfHi and lightLo
// Inside a zone the plan value is
//   half-tone   lerp(halfLo, halfHi) over v in halfLo..halfHi
//   light       lerp(lightLo, lightHi) over v in lightLo..1
//   core        the plateau corePlateau
//   reflected   reflectedLo..reflectedHi by the bounce weight
//   cast        the plateau castPlateau
// (the mockup's outputs: half-tone 0.52–0.72, light 0.85–0.94, plateaus 0.24,
// 0.34–0.48 and 0.32). Zone weights blend across the soft boundaries, so
// there is a step in value at a terminator, not a smooth ramp.
//
// A cast shadow is a surface that FACES the light but is occluded (the shadow
// flag with n·L > 0); a self-shadowed side is the core.

import { randomFor } from '../../../style/random'
import type { PaintParams } from '../params'
import { Z_CAST, Z_CORE, Z_LIGHT } from './zones'
import { clamp, lerp, scratchF32, scratchU8, smooth, TAU, vnorm, type V3 } from './math'
import { compileCurves, type CompiledCurves } from './respond'
import type { FrameCtx } from './view'

export { Z_CAST, Z_CORE, Z_HALF, Z_LIGHT, Z_REFLECTED } from './zones'

// The direction reflected light comes from: the table below the figure.
export const BOUNCE_DIR: V3 = vnorm([-0.1, -0.5, -0.86])

// The raw lit value the renderer writes (§3.3, R1): the contract's formula,
// used by the synthetic G-buffers of the tests and as the reference the
// model's own value matches under identity curves.
export function rawLitValue(params: PaintParams, n: readonly number[], lightDir: readonly number[], shadow: boolean): number {
  const l = params.light
  const lambert = Math.max(0, n[0] * lightDir[0] + n[1] * lightDir[1] + n[2] * lightDir[2])
  const u = lambert * l.intensity * (shadow ? 0 : 1) + l.ambient + l.sky * Math.max(n[2], 0) + l.bounce * Math.max(-n[2], 0)
  return clamp(u, 0, 1)
}

// The model's own value at a point (curves and occlusion applied). `nl` is the
// unclamped n·L; `ao` the occlusion 0..1.
export function modelValue(params: PaintParams, curves: CompiledCurves, nl: number, shadow: boolean, nz: number, ao: number): number {
  const l = params.light
  const lit = curves.lightResponse(Math.max(0, nl)) * l.intensity * (shadow ? 0 : 1)
  const raw = clamp(lit + l.ambient + l.sky * Math.max(nz, 0) + l.bounce * Math.max(-nz, 0) - params.environment.occlusion * ao, 0, 1)
  return curves.value(raw)
}

// The share of the light at a point that is environment light (ambient, sky
// and bounce) over its value, 0..1: how much of the environment's colour the
// surface takes in (spec §11, "environment absorption").
export function ambientShare(params: PaintParams, nz: number, value: number): number {
  const l = params.light
  const terms = l.ambient + l.sky * Math.max(nz, 0) + l.bounce * Math.max(-nz, 0)
  return value > 1e-6 ? clamp(terms / value, 0, 1) : 0
}

// What lit canvas reads as: primed canvas. The mockup used 0.70 against a
// canvas of L 0.93, and the canvas value follows the canvas tone's lightness
// (a dark theme's canvas is a dark value).
export function canvasValue(params: PaintParams): number {
  return clamp(0.7 + 0.8 * (params.canvas.tone[0] - 0.93), 0.05, 0.98)
}

// The weight of reflected light on a normal: it faces the table and is not
// already lit by the key.
export function bounceWeight(params: PaintParams, nx: number, ny: number, nz: number, key: number): number {
  const facing = Math.max(0, nx * BOUNCE_DIR[0] + ny * BOUNCE_DIR[1] + nz * BOUNCE_DIR[2])
  return facing * 0.85 * (1 - smooth(0, 0.3, key)) * clamp(params.light.bounce / 0.1, 0, 1.5)
}

export interface ZoneSample {
  // Weights of light, half-tone, core, reflected, cast; they sum to 1.
  w: [number, number, number, number, number]
  // The plan value.
  u: number
  // The dominant zone (an index into ZONES).
  zone: number
  // How far into a zone boundary: 0 inside a zone, up to ~0.5 on a boundary.
  trans: number
}

export const newZoneSample = (): ZoneSample => ({ w: [0, 0, 0, 0, 0], u: 0, zone: Z_CORE, trans: 0 })

// v: the model's value; b: the bounce weight; cast: occluded while facing the light.
export function zoneSample(params: PaintParams, v: number, b: number, cast: boolean, out: ZoneSample): ZoneSample {
  const vp = params.value
  const w = out.w
  if (cast) {
    w[0] = w[1] = w[2] = w[3] = 0
    w[4] = 1
    out.u = vp.castPlateau
    out.zone = Z_CAST
    out.trans = 0
    return out
  }
  const s = Math.max(1e-4, vp.soft)
  const cA = vp.halfLo - s / 2
  const cB = (vp.halfHi + vp.lightLo) / 2
  const sHt = smooth(cA - s / 2, cA + s / 2, v)
  const sL = Math.min(sHt, smooth(cB - s / 2, cB + s / 2, v))
  const rest = 1 - sHt
  const rb = smooth(0.1, 0.2, b)
  w[0] = sL
  w[1] = sHt - sL
  w[3] = rest * rb
  w[2] = rest - w[3]
  w[4] = 0
  const uHalf = lerp(vp.halfLo, vp.halfHi, clamp((v - vp.halfLo) / Math.max(1e-6, vp.halfHi - vp.halfLo), 0, 1))
  const uLight = lerp(vp.lightLo, vp.lightHi, clamp((v - vp.lightLo) / Math.max(1e-6, 1 - vp.lightLo), 0, 1))
  const uRefl = lerp(vp.reflectedLo, vp.reflectedHi, clamp(b / 0.5, 0, 1))
  out.u = w[0] * uLight + w[1] * uHalf + w[2] * vp.corePlateau + w[3] * uRefl
  let best = 0
  for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k
  out.zone = best
  out.trans = 1 - w[best]
  return out
}

// The value, in v units, of the terminator: the centre of the core | half-tone boundary.
export const terminatorValue = (params: PaintParams): number => params.value.halfLo - params.value.soft / 2

// ---- screen-space occlusion ----

const AO_SAMPLES = 8

// Occlusion 0..1 per G-buffer pixel from the depth: see the header. `out` is written for every pixel.
export function computeOcclusion(fc: FrameCtx, out: Float32Array): void {
  const g = fc.g
  const w = g.width
  const h = g.height
  const R = Math.max(1, fc.params.environment.occlusionRadiusPx)
  // a small seeded kernel: evenly spread directions, jittered, and radii spread over the disc
  const rng = randomFor('paint/ao', fc.params.seed)
  const base = rng.next() * TAU
  const kx = new Float64Array(AO_SAMPLES)
  const ky = new Float64Array(AO_SAMPLES)
  for (let k = 0; k < AO_SAMPLES; k++) {
    const a = base + (k / AO_SAMPLES) * TAU + (rng.next() - 0.5) * 0.4
    const r = R * (0.3 + 0.7 * ((k * 0.61803398875 + rng.next() * 0.1) % 1))
    kx[k] = Math.cos(a) * r
    ky[k] = Math.sin(a) * r
  }
  const m = fc.view.view
  const rx = m[0], ry = m[4], rz = m[8]
  const ux = m[1], uy = m[5], uz = m[9]
  const bx = m[2], by = m[6], bz = m[10]
  const scale = g.scale
  const half = fc.W / 2
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const i = gy * w + gx
      if (g.mark[i] < 0) {
        out[i] = 0
        continue
      }
      const nxw = g.normal[3 * i], nyw = g.normal[3 * i + 1], nzw = g.normal[3 * i + 2]
      let nx = nxw * rx + nyw * ry + nzw * rz
      let ny = nxw * ux + nyw * uy + nzw * uz
      let nz = nxw * bx + nyw * by + nzw * bz
      if (nz < 0) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      if (nz < 0.2) {
        out[i] = 0 // grazing: the tangent plane is no guide
        continue
      }
      const d0 = g.depth[i]
      const ppu = (half * fc.rowX) / (fc.ortho ? 1 : Math.max(1e-6, d0))
      const Rw = R / ppu
      const bias = 0.03 * Rw
      const cx = (gx + 0.5) * scale
      const cy = (gy + 0.5) * scale
      let acc = 0
      for (let k = 0; k < AO_SAMPLES; k++) {
        const sx = Math.floor((cx + kx[k]) / scale)
        const sy = Math.floor((cy + ky[k]) / scale)
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
        const q = sy * w + sx
        if (g.mark[q] < 0) continue
        // the depth the tangent plane at this pixel would have where the sample pixel's own
        // centre is (the G-buffer holds depth at pixel centres, up to half a pixel from the kernel point)
        const ox = (sx + 0.5) * scale - cx
        const oy = (sy + 0.5) * scale - cy
        const expected = d0 + (nx * ox - ny * oy) / (ppu * nz)
        const diff = expected - g.depth[q]
        if (diff <= bias) continue
        acc += smooth(bias, 0.35 * Rw, diff) * (1 - smooth(1.0 * Rw, 2.0 * Rw, diff))
      }
      out[i] = acc / AO_SAMPLES
    }
  }
}

// ---- the per-pixel plan ----

// The per-pixel plan over a G-buffer. Its arrays are scratch: valid until the
// next call.
export interface PlanMap {
  width: number
  height: number
  scale: number
  // The model's value v (curves and occlusion applied), 0..1, and the occlusion.
  value: Float32Array
  ao: Float32Array
  // The plan value, and its zone (255 where empty).
  u: Float32Array
  zone: Uint8Array
  // How far into a zone boundary (0 inside a zone).
  trans: Float32Array
  // Key Lambert × shadow, and the bounce weight.
  key: Float32Array
  bounce: Float32Array
  // Light weight (light + 0.6·half), shadow weight (core + cast), reflected weight.
  lightW: Float32Array
  shadowW: Float32Array
  reflW: Float32Array
  // |∇v| per CSS px (a large number at an edge of the figure).
  grad: Float32Array
  // The value of lit canvas.
  uCanvas: number
  curves: CompiledCurves
}

export function buildPlanMap(fc: FrameCtx): PlanMap {
  const { g, params, view } = fc
  const n = g.width * g.height
  const value = scratchF32('plan.value', n)
  const ao = scratchF32('plan.ao', n)
  const u = scratchF32('plan.u', n)
  const zone = scratchU8('plan.zone', n)
  const trans = scratchF32('plan.trans', n)
  const keyA = scratchF32('plan.key', n)
  const bounceA = scratchF32('plan.bounce', n)
  const lightW = scratchF32('plan.lightW', n)
  const shadowW = scratchF32('plan.shadowW', n)
  const reflW = scratchF32('plan.reflW', n)
  const grad = scratchF32('plan.grad', n)
  const uCanvas = canvasValue(params)
  const curves = compileCurves(params)
  if (params.environment.occlusion > 0) computeOcclusion(fc, ao)
  else ao.fill(0)
  const L = view.lightDir
  const zs = newZoneSample()
  for (let i = 0; i < n; i++) {
    const m = g.mark[i]
    if (m < 0) {
      value[i] = -1
      u[i] = 0
      zone[i] = 255
      trans[i] = 0
      keyA[i] = 0
      bounceA[i] = 0
      lightW[i] = 0
      shadowW[i] = 0
      reflW[i] = 0
      continue
    }
    const nx = g.normal[3 * i]
    const ny = g.normal[3 * i + 1]
    const nz = g.normal[3 * i + 2]
    const ndl = nx * L[0] + ny * L[1] + nz * L[2]
    const shadow = g.shadow[i] === 1
    const key = shadow ? 0 : Math.max(0, ndl)
    const b = bounceWeight(params, nx, ny, nz, key)
    keyA[i] = key
    bounceA[i] = b
    const v = modelValue(params, curves, ndl, shadow, nz, ao[i])
    value[i] = v
    if (fc.ground[m] === 1 && !shadow) {
      // bare canvas in the light
      u[i] = uCanvas
      zone[i] = Z_LIGHT
      trans[i] = 0
      lightW[i] = 1
      shadowW[i] = 0
      reflW[i] = 0
      continue
    }
    zoneSample(params, v, b, shadow && ndl > 0.02, zs)
    u[i] = zs.u
    zone[i] = zs.zone
    trans[i] = zs.trans
    lightW[i] = zs.w[0] + 0.6 * zs.w[1]
    shadowW[i] = zs.w[2] + zs.w[4]
    reflW[i] = zs.w[3]
  }
  // the gradient of the value, per CSS px; 999 beside an edge of the figure
  const W = g.width
  const H = g.height
  const inv = 1 / (2 * g.scale)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (g.mark[i] < 0 || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        grad[i] = 999
        continue
      }
      const a = g.mark[i - 1]
      const b = g.mark[i + 1]
      const c = g.mark[i - W]
      const d = g.mark[i + W]
      if (a !== g.mark[i] || b !== g.mark[i] || c !== g.mark[i] || d !== g.mark[i]) {
        grad[i] = 999
        continue
      }
      const gx = (value[i + 1] - value[i - 1]) * inv
      const gy = (value[i + W] - value[i - W]) * inv
      grad[i] = Math.hypot(gx, gy)
    }
  }
  return { width: W, height: H, scale: g.scale, value, ao, u, zone, trans, key: keyA, bounce: bounceA, lightW, shadowW, reflW, grad, uCanvas, curves }
}
