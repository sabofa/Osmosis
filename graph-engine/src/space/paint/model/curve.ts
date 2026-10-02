// The lighting curve (spec §3.4): "assign the lighting curve", the hue,
// saturation and luminance change over value, "not very randomized but not
// perfect". Lighting lives INSIDE the colour: the local colour is transformed
// by the curve, nothing is painted on top.
//
// With local colour (lc, cc, hc) and plan value u (0 deepest shadow .. 1
// brightest light):
//   L = lc + lSlope·(u − lPivot) + dL(u)
//   C = cc · (cBase + cPeak·exp(−((u − cCentre)/cWidth)²)) · (1 + dC(u))
//   H = hc + k·|s|·arc(hc → warm if s > 0, cool if s < 0)        s = clamp((u − 0.5)/0.4, −1, 1)
//        + a clamped arc toward accentHue in the half-tones
//        + the plane's hue step
//   then, in OKLab and never touching L: a warm/cool tint, a sky tint on
//   up-facing normals and a bounce tint on down-facing ones.
// Reflected light mixes the bounce colour's hue and chroma in by up to reflectedBounceMix, in OKLab and
// NEVER touching L (value plan, spec §12): the value of reflected light is the plan's (it is kept below the
// darkest half-tone there), and a lift here would put the bounce back among the half-tones.
// Colormapped surfaces scale the hue rotation, the accent, the plane steps
// and every tint by curve.colormapHue (a third), so the colorbar stays true.
//
// Ben's editable curves (spec §11) adjust the result over value u: L += lAdjust(u),
// C *= cAdjust(u), H += hAdjust(u) (scaled by colormapHue on a colormapped
// colour); their defaults are flat, which leave the formulas bit-identical. The
// lightness adjustment is added AFTER the soft clamps at the ends of the lightness range
// (it was added before them, so a +0.1 in the lights was halved by the 0.92 clamp). A
// colormapped colour's hue deviation and per-stroke jitter are scaled by colormapHue
// like every other hue term (the colorbar stays true): they were not.
// Environment absorption adds, in OKLab with L untouched, the environment's
// colour: (cos hue, sin hue) · chroma · absorption · ambientShare (scaled by
// colormapHue on a colormapped colour, like every tint).
//
// Ported from the approved mockup (paint-math.js makeCurve, figures.js devJ
// and hueOff). The deviations are smooth, seeded functions, never white noise.

import { randomFor } from '../../../style/random'
import type { PaintParams } from '../params'
import type { Oklab } from '../types'
import { fitLch, hueArc, labToLch, lchToLab, type Oklch } from './colour'
import { clamp, D2R, smooth, TAU } from './math'
import { compileCurve } from './respond'

// The mockup's own constants, not exposed as sliders: where the half-tone
// accent sits on the value axis and how wide it is, the plane chroma step,
// and the soft clamps at the ends of the lightness range.
const ACCENT_U = 0.56
const ACCENT_SIG = 0.17
const PLANE_CHROMA_STEP = 0.05

export interface CurveInput {
  // The local colour, OKLab.
  local: readonly number[]
  // The plan value u.
  u: number
  // World normal z (for the sky and bounce tints), when known.
  nz?: number
  // Reflected-light weight b (0 none .. ~0.85), when known.
  bounce?: number
  // The share of the light here that is environment light, 0..1 (value.ts
  // ambientShare), when known: how much of the environment colour it takes in.
  ambientShare?: number
  // The plane's hue step in degrees and chroma step (relative).
  planeHue?: number
  planeChroma?: number
  // Colormapped: scale hue and tints by curve.colormapHue.
  colormapped?: boolean
  // Scale the lightness slope (line marks use 0.55, highlight dabs 1.35).
  lScale?: number
  // Leave out the curve's own deviation.
  noDev?: boolean
  // A per-stroke jitter [dL, dC (relative), dH (degrees)].
  j?: readonly [number, number, number]
}

export interface Curve {
  // The coloured result in OKLCH, before the gamut fit.
  lch(input: CurveInput): Oklch
  // The same, fitted to sRGB, as OKLab.
  lab(input: CurveInput): Oklab
  // The curve's own seeded deviation at value u: dL, dC (relative), dH (degrees).
  deviation(u: number): [number, number, number]
  // A smooth seeded deviation of the plan value at a surface point, within
  // ±value.deviation (the value plan's "not perfect").
  devU(x: number, y: number, z: number): number
  // A smooth seeded colour jitter at a surface point: [dL, dC (rel), dH (deg)].
  devJ(x: number, y: number, z: number): [number, number, number]
  // The plane step for a plane whose mean world normal is n: [hue deg, chroma rel].
  planeStep(nx: number, ny: number, nz: number): [number, number]
  // The bounce colour reflected light mixes toward (from the canvas tone).
  bounceLch: Oklch
}

// Three sines of rising frequency, summed: a smooth function of u.
interface Component {
  a: number
  f: number
  ph: number
}
const sumSines = (comps: Component[], u: number): number => {
  let s = 0
  for (const c of comps) s += c.a * Math.sin(TAU * (c.f * u + c.ph))
  return s
}

export function makeCurve(params: PaintParams): Curve {
  const p = params.curve
  const rng = randomFor('paint/curve', params.seed)
  // The mockup's deviation amplitudes were 0.010 / 0.006 / 0.004 for L,
  // 6% / 4% / 2.5% for C and 2.2° / 1.4° / 0.8° for H. The first of each is
  // the slider; the others keep the same ratios.
  const comp = (amp: number, ratios: number[], freqs: number[]): Component[] =>
    ratios.map((r, i) => ({ a: amp * r, f: freqs[i], ph: rng.next() }))
  const dL = comp(p.devL, [1, 0.6, 0.4], [0.7, 1.5, 2.7])
  const dC = comp(p.devC, [1, 2 / 3, 5 / 12], [0.6, 1.3, 2.4])
  const dH = comp(p.devH, [1, 7 / 11, 4 / 11], [0.8, 1.7, 3.1])

  // Positional phases (the value deviation, the colour jitter, the plane steps).
  const pos = randomFor('paint/dev', params.seed)
  const ph = [0, 1, 2, 3, 4, 5].map(() => pos.next() * TAU)
  const devAmp = params.value.deviation

  const lAdj = compileCurve(params.curves.lAdjust)
  const cAdj = compileCurve(params.curves.cAdjust)
  const hAdj = compileCurve(params.curves.hAdjust)
  const env = params.environment
  const tone = labToLch(params.canvas.tone)
  const bounceLch: Oklch = [tone[0] - 0.04, tone[1] * 2.1, tone[2]]

  const curveLch = (i: CurveInput): Oklch => {
    const local = labToLch(i.local)
    const u = i.u
    const hs = i.colormapped ? p.colormapHue : 1
    const ls = i.lScale ?? 1
    const nd = i.noDev ? 0 : 1
    const j = i.j ?? [0, 0, 0]
    let L = local[0] + p.lSlope * ls * (u - p.lPivot) + nd * sumSines(dL, u) + j[0]
    if (L > 0.92) L = 0.92 + (L - 0.92) * 0.5
    if (L < 0.14) L = 0.14 + (L - 0.14) * 0.4
    L += lAdj(u)
    const gC = p.cBase + p.cPeak * Math.exp(-(((u - p.cCentre) / p.cWidth) ** 2))
    const C = local[1] * gC * (1 + nd * sumSines(dC, u) + j[1]) * (1 + hs * (i.planeChroma ?? 0)) * cAdj(u)
    const s = clamp((u - 0.5) / 0.4, -1, 1)
    const warm = s > 0
    const target = warm ? p.warmHue : p.coolHue
    const k = (warm ? p.kWarm : p.kCool) * hs
    const accent = clamp(0.5 * hueArc(local[2], p.accentHue), -p.accentMax, p.accentMax)
    const h =
      local[2] +
      k * Math.abs(s) * hueArc(local[2], target) +
      hs * (nd * sumSines(dH, u) + j[2]) +
      hs * accent * Math.exp(-(((u - ACCENT_U) / ACCENT_SIG) ** 2)) +
      hs * (i.planeHue ?? 0) +
      hs * hAdj(u)
    const lab = lchToLab(L, C, h)
    // greys still lean warm in the light and cool in the shadow
    const tint = (warm ? p.tintWarm : p.tintCool) * Math.abs(s) * hs
    lab[1] += tint * Math.cos(target * D2R)
    lab[2] += tint * Math.sin(target * D2R)
    // environment light as colour: sky from above, bounce from below
    if (i.nz !== undefined) {
      const up = Math.max(0, i.nz)
      const dn = Math.max(0, -i.nz)
      const wSky = up * (1 - 0.75 * smooth(0.62, 0.9, u)) * p.skyTint * hs
      const wGnd = dn * (1 - 0.6 * smooth(0.6, 0.9, u)) * p.bounceTint * hs
      lab[1] += wSky * Math.cos(p.skyHue * D2R) + wGnd * Math.cos(p.bounceHue * D2R)
      lab[2] += wSky * Math.sin(p.skyHue * D2R) + wGnd * Math.sin(p.bounceHue * D2R)
    }
    // environment absorption: the ambient share of the light takes the environment's colour
    if (i.ambientShare !== undefined && env.absorption > 0 && env.chroma > 0) {
      const k = env.chroma * env.absorption * i.ambientShare * hs
      lab[1] += k * Math.cos(env.hue * D2R)
      lab[2] += k * Math.sin(env.hue * D2R)
    }
    // reflected light: the bounce colour's hue and chroma mixed in; L stays where the value plan put it, so the
    // bounce can never lift a shadow past the ceiling the plan keeps below the half-tones
    const b = i.bounce ?? 0
    if (b > 0) {
      const w = p.reflectedBounceMix * clamp(b / 0.45, 0, 1)
      const bl = lchToLab(bounceLch[0], bounceLch[1], bounceLch[2])
      lab[1] += (bl[1] - lab[1]) * w
      lab[2] += (bl[2] - lab[2]) * w
    }
    return labToLch(lab)
  }

  return {
    lch: curveLch,
    lab: (i) => fitLch(curveLch(i)),
    deviation: (u) => [sumSines(dL, u), sumSines(dC, u), sumSines(dH, u)],
    devU: (x, y, z) =>
      (devAmp * (Math.sin(2.1 * x + 1.1 * z + ph[0]) * Math.cos(1.7 * y + ph[1]) + 0.6 * Math.sin(2.9 * z + 1.3 * x + ph[2]))) / 1.6,
    devJ: (x, y, z) => [
      p.devL * (1.6 * Math.sin(1.3 * x + 1.1 * y + 0.7 * z + ph[3]) + 0.6 * Math.sin(2.7 * y - 1.9 * z + ph[4])),
      p.devC * ((4 / 3) * Math.sin(1.1 * x - 1.4 * y + 1.2 * z + ph[5]) + (7 / 12) * Math.sin(2.3 * x + ph[0])),
      p.devH * ((16 / 11) * Math.sin(0.9 * x + 1.6 * y - 1.1 * z + ph[2]) + (7 / 11) * Math.sin(2.5 * z + ph[4])),
    ],
    planeStep: (nx, ny, nz) => [
      p.planeStepA * Math.sin(3.1 * nx + 1.3 * ny + ph[1]) + p.planeStepB * Math.sin(2.2 * ny - 2.6 * nz + ph[3]),
      PLANE_CHROMA_STEP * Math.sin(1.7 * nx - 2.1 * nz + ph[5]),
    ],
    bounceLch,
  }
}
