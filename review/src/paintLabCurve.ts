// The chart in the "Lighting curve" and "Curves" groups (spec §6): L, C and H
// against value for the figure's local colour, redrawn as the curve sliders
// and the adjustment curves move.
//
// It draws the BASE curve of spec §3.4 (the L line, the C bell, the warm/cool
// hue swing) with the lightness, chroma and hue adjustment curves of §11 on
// top, and nothing else the model adds: not the half-tone accent, the plane
// steps, the tints or the seeded deviation. Those live in the model
// (space/paint/model/curve.ts); when it lands, the lab should chart its curve
// instead and this file goes. Until then the chart says what it shows.

import { evalCurve, type CurvePoints } from '../../graph-engine/src/space/paint/curves'
import type { PaintParams } from '../../graph-engine/src/space/paint/params'

export interface Lch {
  L: number
  C: number
  // Degrees, 0..360.
  h: number
}

export function labToLch(lab: readonly number[]): Lch {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
  return { L: lab[0], C: Math.hypot(lab[1], lab[2]), h: (h + 360) % 360 }
}

// The signed shortest turn from hue a to hue b, in [-180, 180).
const arc = (a: number, b: number) => ((b - a + 540) % 360) - 180

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// §3.4, with local colour (lc, cc, hc) and value u:
//   L = lc + lSlope (u - lPivot)
//   C = cc (cBase + cPeak exp(-((u - cCentre) / cWidth)^2))
//   H = hc + k |s| arc(hc -> warm if s > 0, cool if s < 0), s = clamp((u - 0.5) / 0.4, -1, 1)
// `hueShare` is the share of the hue swing kept (colormapHue for a colormapped
// surface, 1 otherwise). `adjust` is §11's curves over value: L gets lAdjust(u)
// added, C is multiplied by cAdjust(u) (never below 0), H gets hAdjust(u)
// degrees added.
export interface Adjustments {
  lAdjust: CurvePoints
  cAdjust: CurvePoints
  hAdjust: CurvePoints
}

export function baseCurve(c: PaintParams['curve'], local: Lch, u: number, hueShare = 1, adjust?: Adjustments): { L: number; C: number; H: number } {
  let L = local.L + c.lSlope * (u - c.lPivot)
  let C = local.C * (c.cBase + c.cPeak * Math.exp(-(((u - c.cCentre) / c.cWidth) ** 2)))
  const s = clamp((u - 0.5) / 0.4, -1, 1)
  const warm = s > 0
  let swing = (warm ? c.kWarm : c.kCool) * Math.abs(s) * arc(local.h, warm ? c.warmHue : c.coolHue) * hueShare
  if (adjust) {
    L += evalCurve(adjust.lAdjust, u)
    C = Math.max(0, C * evalCurve(adjust.cAdjust, u))
    swing += evalCurve(adjust.hAdjust, u)
  }
  return { L, C, H: (((local.h + swing) % 360) + 360) % 360 }
}

export interface CurveSeries {
  u: number[]
  L: number[]
  C: number[]
  // Unwrapped, so a hue crossing 0 draws as a line, not a leap.
  H: number[]
}

export function curveSeries(c: PaintParams['curve'], local: Lch, n: number, hueShare = 1, adjust?: Adjustments): CurveSeries {
  const out: CurveSeries = { u: [], L: [], C: [], H: [] }
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const p = baseCurve(c, local, u, hueShare, adjust)
    let H = p.H
    const prev = out.H[i - 1]
    if (prev !== undefined) H += 360 * Math.round((prev - H) / 360)
    out.u.push(u)
    out.L.push(p.L)
    out.C.push(p.C)
    out.H.push(H)
  }
  return out
}
