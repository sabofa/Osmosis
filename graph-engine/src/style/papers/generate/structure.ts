// A paper's STRUCTURE: per-texel OKLab offsets around a base tone, and a
// height. It is what a type builder returns before the texture setting is
// applied; the texture is a scale on top of it (see index.ts).
//
// The mockup built colour by multiplying RGB channels (a mottle of a few
// percent, a warm/cool drift). The generator keeps the same operations but
// records them as OKLab offsets, so they apply to ANY base tone. The two
// sensitivities below turn "this many percent brighter" and "this much warm
// drift" into OKLab offsets, linearised around the mockup's warm canvas tone.

import { resampleAxis } from './noise'
import type { Field } from './noise'
import { srgb8ToOklab } from './oklab'
import type { Vec3 } from './oklab'

export interface Structure {
  size: number
  // OKLab (dL, da, db) per texel at texture 1: 3 * size^2.
  offsets: Float32Array
  // Height minus 0.5 per texel at texture 1, NOT clamped (texture 2 doubles it): size^2.
  deviation: Float32Array
}

// The mockup's warm canvas tone, which the offsets are linearised around.
const NOMINAL: Vec3 = [226, 217, 197]

function sensitivity(factor: Vec3): Vec3 {
  const eps = 0.02
  const base = srgb8ToOklab(NOMINAL[0], NOMINAL[1], NOMINAL[2])
  const moved = srgb8ToOklab(NOMINAL[0] * (1 + eps * factor[0]), NOMINAL[1] * (1 + eps * factor[1]), NOMINAL[2] * (1 + eps * factor[2]))
  return [(moved[0] - base[0]) / eps, (moved[1] - base[1]) / eps, (moved[2] - base[2]) / eps]
}

// OKLab offset per unit of fractional brightness (all three channels scaled alike).
export const BRIGHTNESS: Vec3 = sensitivity([1, 1, 1])
// OKLab offset per unit of the mockup's warm/cool drift: red up, blue down, green a quarter.
export const DRIFT: Vec3 = sensitivity([1, 0.25, -1])

// One unit-variance fBm field's contribution: `amount` of its value times a sensitivity.
export interface Layer {
  field: Field
  amount: number
  sensitivity: Vec3
}

// A layer that adds nothing, standing in for a missing second layer.
const NO_LAYER: Layer = { field: { data: new Float32Array(1), w: 1, h: 1 }, amount: 0, sensitivity: [0, 0, 0] }

// The tile's OKLab offsets in one pass: the thread brightness factor K (1 =
// the tone itself, `kAmount` of its departure from 1) plus up to two fBm
// layers, each upsampled on the fly from its own coarse grid. One pass because
// the offsets are 12 MB at 1024^2: writing them once, not once per field, is
// most of the cost. The two layers are unrolled into locals (the tile has a
// mottle and, for linen, a drift): this is the hottest loop after the weave.
export function composeOffsets(size: number, K: Float32Array, kAmount: number, layers: Layer[]): Float32Array {
  if (layers.length > 2) throw new RangeError('composeOffsets takes at most two layers')
  const A = layers[0] ?? NO_LAYER
  const B = layers[1] ?? NO_LAYER
  const out = new Float32Array(3 * size * size)
  const aSrc = A.field.data
  const aW = A.field.w
  const aX = resampleAxis(A.field.w, size)
  const aY = resampleAxis(A.field.h, size)
  const bSrc = B.field.data
  const bW = B.field.w
  const bX = resampleAxis(B.field.w, size)
  const bY = resampleAxis(B.field.h, size)
  const aw0 = A.amount * A.sensitivity[0]
  const aw1 = A.amount * A.sensitivity[1]
  const aw2 = A.amount * A.sensitivity[2]
  const bw0 = B.amount * B.sensitivity[0]
  const bw1 = B.amount * B.sensitivity[1]
  const bw2 = B.amount * B.sensitivity[2]
  const kb0 = kAmount * BRIGHTNESS[0]
  const kb1 = kAmount * BRIGHTNESS[1]
  const kb2 = kAmount * BRIGHTNESS[2]
  for (let y = 0; y < size; y++) {
    const ar0 = aY.i0[y] * aW
    const ar1 = aY.i1[y] * aW
    const afy = aY.f[y]
    const br0 = bY.i0[y] * bW
    const br1 = bY.i1[y] * bW
    const bfy = bY.f[y]
    const row = y * size
    for (let x = 0; x < size; x++) {
      const i = row + x
      const k = K[i] - 1

      const a00 = aSrc[ar0 + aX.i0[x]]
      const a01 = aSrc[ar0 + aX.i1[x]]
      const a10 = aSrc[ar1 + aX.i0[x]]
      const a11 = aSrc[ar1 + aX.i1[x]]
      const atop = a00 + (a01 - a00) * aX.f[x]
      const av = atop + (a10 + (a11 - a10) * aX.f[x] - atop) * afy

      const b00 = bSrc[br0 + bX.i0[x]]
      const b01 = bSrc[br0 + bX.i1[x]]
      const b10 = bSrc[br1 + bX.i0[x]]
      const b11 = bSrc[br1 + bX.i1[x]]
      const btop = b00 + (b01 - b00) * bX.f[x]
      const bv = btop + (b10 + (b11 - b10) * bX.f[x] - btop) * bfy

      const o = i * 3
      out[o] = kb0 * k + aw0 * av + bw0 * bv
      out[o + 1] = kb1 * k + aw1 * av + bw1 * bv
      out[o + 2] = kb2 * k + aw2 * av + bw2 * bv
    }
  }
  return out
}

// The height is a 0..1 channel around 0.5, and a scaled deviation can pass 0.5: at texture 1 canvas has 1.4% of its
// texels there, and any paper at texture 2 has far more. A hard clamp would leave flat dead floors and ceilings,
// so beyond KNEE the deviation bends smoothly toward its limit of 0.5 (a tanh that starts with slope 1, so there
// is no kink and nothing below the knee changes).
export const KNEE = 0.35
export function softLimit(d: number): number {
  const a = Math.abs(d)
  if (a <= KNEE) return d
  const limited = KNEE + (0.5 - KNEE) * Math.tanh((a - KNEE) / (0.5 - KNEE))
  return d < 0 ? -limited : limited
}
