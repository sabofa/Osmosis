// The oil brush's deposit, in plain numbers (fix round 2, item 12): the TypeScript twin of the bristle loop in
// STROKE_FRAGMENT (shaders/stroke.ts), as warp.ts is of the underpainting's warp. It answers, for a stroke and a point
// of its ribbon, how much paint lands there, so a test can look at the ribbon's start and ends in numbers: whether the
// ribbon is long enough for the round ends of its bristles to show, and what the canvas does to a dry brush.
//
// One deliberate difference: the shader widens the dry gate by half the deposit's change over a pixel (fwidth), which
// only softens an edge by a pixel and needs a screen. The twin has none, so a gate edge here is the sharp one.

import { MAX_BRISTLES } from '../types'

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
  0.98, 0, 0, 0.04, // line: no thinning and no loaded start (a line is cut into 21 px strokes, which would then show as beads)
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

const TAU = Math.PI * 2

// How far a bristle's round end reaches past its own start or end, in its radius: a bristle's radius is
// spacing * (1.2 + 0.65 r) for a seeded r in 0..1, so at most 1.85 spacings, and a spacing is 2 / bristles of the
// half width.
export const BRISTLE_REACH = 1.2 + 0.65
// The ribbon's cap past the path's end also keeps this much beyond the reach, in px: the fragments at the edge of the
// ribbon are then a pixel past the end of the deposit, and a geometric edge is something fwidth cannot soften.
export const CAP_PAD = 1
// The narrowest half width the shader uses, in px.
export const MIN_HALF_WIDTH = 0.6

// The bristles a stroke has, as the shader reads them from the batch's number.
export const bristleCount = (packed: number): number => Math.trunc(Math.min(Math.max(packed + 0.5, 2), MAX_BRISTLES))

// How far the ribbon runs past each end of the path, in px, for a stroke of `width` px (at that end) and `bristles`.
export function ribbonCap(width: number, bristles: number): number {
  return BRISTLE_REACH * Math.max(width * 0.5, MIN_HALF_WIDTH) * (2 / bristleCount(bristles)) + CAP_PAD
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

// uint hashU(uint x), and rnd4: four numbers in (0, 1) from (seed, index, salt).
const hashU = (x: number): number => {
  x >>>= 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b) >>> 0
  x ^= x >>> 16
  return x >>> 0
}
export function rnd4(seed: number, index: number, salt: number): [number, number, number, number] {
  const h = hashU((Math.imul(seed, 0x9e3779b1) + Math.imul(index, 0x85ebca6b) + Math.imul(salt, 0xc2b2ae35) + 0x165667b1) >>> 0)
  return [((h & 255) + 0.5) / 256, (((h >>> 8) & 255) + 0.5) / 256, (((h >>> 16) & 255) + 0.5) / 256, ((h >>> 24) + 0.5) / 256]
}
const gauss3 = (a: number, b: number, c: number): number => (a + b + c - 1.5) * 2

const ROLE_GLAZE = 3

// What the shader reads of a stroke: the batch's numbers as packStrokes writes them (the seed already >>> 8).
export interface BrushStroke {
  role: number
  // the colour's alpha
  alpha: number
  load: number
  bristles: number
  bristleVar: number
  dry: number
  endSoft: number
  seed: number
}

export interface Deposit {
  // The heaviest bristle's deposit, before the gate.
  dep: number
  // What the canvas's tooth lets through of it.
  gate: number
  // The coverage the stroke lays at this point (the fragment's `al`, without the depth test).
  alpha: number
}

// The deposit at lateral offset `o` (in half widths, -1..1 across the brush) and arc position `s` (px along the
// stroke, from the path's start; negative before it) of a stroke `len` px long with half width `hw` px, over canvas
// tooth `tooth` (the canvas height as the shader reads it: normalised, and scaled by the canvas texture).
export function brushDeposit(stroke: BrushStroke, o: number, s: number, hw: number, len: number, tooth = 0): Deposit {
  const { role, seed } = stroke
  const nB = bristleCount(stroke.bristles)
  const ra = ROLE_A.subarray(4 * role, 4 * role + 4)
  const rb = ROLE_B.subarray(4 * role, 4 * role + 4)
  const sc = clamp(s, 0, len)
  const t = sc / len
  const crisp = rb[2] > 0.5
  const tEndMean = clamp(mix(rb[0], 0.6, stroke.endSoft) + (rnd4(seed, 0, 900)[0] - 0.5) * rb[1], 0.35, 1.08)
  const cp = rnd4(seed, 0, 901)
  const clumpPhase = [cp[0] * TAU, cp[1] * TAU]
  const spacingN = 2 / nB
  const inset = 1 - 0.6 * spacingN
  const fb = (o / inset) * 0.5 * nB + 0.5 * nB - 0.5
  const bc = Math.floor(fb)

  let best = 0
  for (let di = -1; di <= 2; di++) {
    const b = bc + di
    if (b < 0 || b >= nB) continue
    const r1 = rnd4(seed, b, 1)
    const ob = ((b + 0.5) * spacingN - 1 + (crisp ? 0 : (r1[0] - 0.5) * 0.5 * spacingN)) * inset
    const radius = spacingN * (crisp ? 1.5 : 1.2 + 0.65 * r1[1])
    if (Math.abs(o - ob) >= radius + 0.5 / Math.max(1, hw)) continue
    const r2 = rnd4(seed, b, 2)
    const r3 = rnd4(seed, b, 3)
    const e = Math.abs(ob)
    const edgeRag = crisp ? 0 : sstep(0.78, 1, e)
    const m = 0.5 + 0.5 * (0.6 * Math.sin(b * 0.9 + clumpPhase[0]) + 0.4 * Math.sin(b * 2.3 + clumpPhase[1]))
    const f0 = crisp ? 1 : 0.58 + 0.28 * m + 0.22 * r1[2]
    const bl = stroke.load * (1 - stroke.bristleVar * (1 - f0)) * (1 + (crisp ? 0 : 0.3 * sstep(0.72, 1, e))) * (1 - 0.4 * edgeRag * r1[3])
    const ts = crisp ? 0 : Math.max(0, gauss3(r2[0], r2[1], r2[2]) * 0.012 + 0.08 * e * e + 0.04 * edgeRag * r2[3])
    const tEnd = crisp ? 1.08 : clamp(tEndMean + (r3[0] - 0.5) * 0.4 - 0.4 * e * e - 0.1 * edgeRag * r3[1], 0.3, 1.08)
    const freq = 0.03 + 0.04 * r3[3]
    const wob = crisp ? 0 : (0.45 * Math.sin(sc * freq + r3[2] * TAU)) / Math.max(1, hw)

    // round caps at this bristle's own start and end
    const sStart = ts * len
    const sEnd = Math.min(tEnd, 1) * len
    const along = s < sStart ? sStart - s : s > sEnd ? s - sEnd : 0
    const dLat = o - (ob + wob)
    const dn = along / hw
    const d2 = (dLat * dLat + dn * dn) / (radius * radius)
    const w = Math.max(1 - d2, 0)
    if (w <= 0) continue

    const START_RAMP = 0.026
    const tl = clamp(t, ts + START_RAMP + 0.002, Math.max(Math.min(tEnd, 1), ts + START_RAMP + 0.003))
    const endQ = (tl - (tEnd - 0.045)) / 0.022
    const load0 =
      bl *
      (1 + ra[2] * Math.exp(-((tl / 0.06) * (tl / 0.06)))) *
      (1 - ra[1] * sstep(0.2, 1, tl)) *
      sstep(ts, ts + START_RAMP, tl) *
      (1 + 0.45 * Math.exp(-endQ * endQ)) *
      sstep(tEnd, tEnd - 0.04, tl)
    best = Math.max(best, load0 * w * w)
  }
  if (best <= 0) return { dep: 0, gate: 0, alpha: 0 }

  // the canvas tooth decides what a dry brush catches
  const tail = sstep(1 - clamp(stroke.dry, 0.1, 1), 1, t)
  const dryEff = stroke.dry * (0.5 + 0.5 * tail)
  const g0 = 0.08 + 0.12 * dryEff
  const g1 = 0.26 + 0.22 * dryEff
  const gate = dryEff > 0 ? sstep(g0, g1, best + 0.45 * tooth) : sstep(0.03, 0.12, best)
  const opac = role === ROLE_GLAZE ? Math.min(stroke.alpha, ra[0]) : stroke.alpha * ra[0]
  return { dep: best, gate, alpha: gate * Math.min(opac, opac * (0.42 + 1.6 * best)) }
}
