// The chart in the "Lighting curve" and "Curves" groups (spec §6): L, C and H
// against value for the figure's local colour, redrawn as the curve sliders
// and the adjustment curves move.
//
// It draws the MODEL'S curve (space/paint/model/curve.ts), the very function a
// stroke's colour comes from (makeCurve(params).lab), fitted to sRGB, so the
// chart shows exactly what the strokes use: the base curve of §3.4 with the
// half-tone accent, the lightness, chroma and hue adjustment curves of §11 and
// the curve's own seeded deviation. What differs from stroke to stroke comes on
// top and is not drawn: a stroke's personal jitter, its plane's hue step, and
// the colour of the sky, the ground and the environment on its normal.

import type { PaintParams } from '../../graph-engine/src/space/paint/params'
import { labToLch as modelLabToLch, lchToLab } from '../../graph-engine/src/space/paint/model/colour'
import { makeCurve } from '../../graph-engine/src/space/paint/model/curve'

export interface Lch {
  L: number
  C: number
  // Degrees, 0..360.
  h: number
}

export function labToLch(lab: readonly number[]): Lch {
  const [L, C, h] = modelLabToLch(lab)
  return { L, C, h }
}

export interface CurveSeries {
  u: number[]
  L: number[]
  C: number[]
  // Unwrapped, so a hue crossing 0 draws as a line, not a leap.
  H: number[]
}

// The curve's colour at n values of u from 0 to 1, for `local` (a colormapped
// colour keeps a third of the hue swing, as its strokes do).
export function curveSeries(params: PaintParams, local: Lch, n: number, colormapped = false): CurveSeries {
  const curve = makeCurve(params)
  const lab = lchToLab(local.L, local.C, local.h)
  const out: CurveSeries = { u: [], L: [], C: [], H: [] }
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const [L, C, h] = modelLabToLch(curve.lab({ local: lab, u, colormapped }))
    let H = h
    const prev = out.H[i - 1]
    if (prev !== undefined) H += 360 * Math.round((prev - H) / 360)
    out.u.push(u)
    out.L.push(L)
    out.C.push(C)
    out.H.push(H)
  }
  return out
}
