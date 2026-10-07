// The value plan (spec §3.3, §11, §12): "find the values of the figure", as a painter builds them.
//
// THE STRUCTURE (Ben, 2026-10-02: the classical form-shadow model). Two families, divided by the terminator, where
// the surface turns from the key light (N·L = 0):
//   LIGHT family   N·L > 0 and not in cast shadow:  highlight, light, half-tone (bright to dark)
//   SHADOW family  N·L <= 0, plus the cast shadow:  core shadow, reflected light, cast shadow
// and every value of the shadow family is darker than every value of the light family. The plan is a function of
// the signed N·L (and of the bounce, the cast flag and the occlusion), not of a lit value with the fill light on
// top of it: the fill light could lift the shadows into the half-tones, and it did (the bounce read as a half-tone).
//
//   light family  u = halfLo + (halfHi - halfLo)·S(0, lightTurn, n)             the half-tone ramp
//                      + (lightLo - halfHi)·S(lightTurn ± lightSoftness/2, n)   the SOFT turn to light
//                      + (lightHi - lightLo)·S(lightTurn, 1, n)                 the light ramp to the highlight
//                 with n = N·L through the light response curve and the intensity, S the smoothstep. Every term is
//                 a smoothstep, so the gradation is smooth (its derivative is continuous) everywhere.
//   shadow family u = corePlateau + (reflectedMax - corePlateau)·bounceAmount·S(coreWidth, coreWidth + reflectedSoftness, -N·L)
//                 the core band from the terminator to -coreWidth, then a SOFT lift to the reflected light. The
//                 bounce amount (0..1: the bounce, sky and ambient light the normal takes, less the occlusion) can
//                 only choose a place between the core and reflectedMax: nothing can lift the shadow past the cap
//                   reflectedMax = corePlateau + reflectedShare·(halfLo - corePlateau),   reflectedShare <= 0.9.
//                 (A terminator softer than the default's pushes the lift out by the edge's extra half-width, so the
//                 edge's foot does not run into it: the core is the darkest band of the form shadow at every softness.)
//   terminator    the two meet in an edge centred on N·L = 0, terminatorSoftness wide: clearly defined, and
//                 crisper than the turn to light and the lift to reflected light.
//   cast shadow   castPlateau (never lighter than reflectedMax) away from the contact, castContact at it: the
//                 occlusion, over its radius in px, takes it down. It takes over from the form where the key
//                 light is occluded on a surface that faces it, from N·L 0 over CAST_FADE, and NEVER softened by
//                 the terminator's band (a ground has no terminator at all: a flagged ground pixel is cast whole).
//                 A pixel that is mostly cast (the light weight under a half) is never lighter than
//                 reflectedMax: the fade blends the light end toward the cap, not toward the half-tone it lifted
//                 a cast shadow into.
// The value curve (Ben's) is applied last, to the finished plan value; it keeps the families in order for any
// curve that does not decrease (a curve that rises and falls can reorder them: that is his own choice).
//
// STRUCTURAL GUARD. Whatever the sliders say, the model keeps the families apart: corePlateau is held
// CORE_GAP under halfLo, the half-tone and light ramps rise (halfHi >= halfLo, lightLo >= halfHi, lightHi >=
// lightLo), and the cast plateau and contact are never lighter than reflectedMax, which is below halfLo.
// effectiveValues() is what the model reads, and what a UI that shows the numbers should show.
//
// Occlusion (screen space, from the G-buffer depth: a small seeded kernel of 8 samples over occlusionRadiusPx, a
// sample counting only where it stands NEARER than the tangent plane extended to it, so a tilted plane does not
// occlude itself, and within range) takes the cast shadow to its contact value and the bounce away from the form
// shadow near a contact. It does not darken the light family: that is the key light's, and a crease it reaches
// is lit.
//
// The PLAN value is what the lighting curve consumes (the strokes' lightness, curve.ts). Zone weights (light,
// half-tone, core, reflected, cast; they sum to 1) classify each pixel for the roles, the planes and the zones
// debug view; a pixel's zone is the heaviest weight.

import { randomFor } from '../../../style/random'
import type { PaintParams } from '../params'
import { Z_CORE, Z_HALF, Z_LIGHT } from './zones'
import { clamp, lerp, scratchF32, scratchU8, smooth, TAU, vnorm, type V3 } from './math'
import { compileCurves, type CompiledCurves } from './respond'
import type { FrameCtx } from './view'

export { Z_CAST, Z_CORE, Z_HALF, Z_LIGHT, Z_REFLECTED } from './zones'

// The direction reflected light comes from: the table below the figure.
export const BOUNCE_DIR: V3 = vnorm([-0.1, -0.5, -0.86])

// The raw lit value the renderer writes (§3.3, R1): the contract's formula,
// used by the synthetic G-buffers of the tests as the renderer's reference
// (GBuffer.value). The model's own value is the plan below.
export function rawLitValue(params: PaintParams, n: readonly number[], lightDir: readonly number[], shadow: boolean): number {
  const l = params.light
  const lambert = Math.max(0, n[0] * lightDir[0] + n[1] * lightDir[1] + n[2] * lightDir[2])
  const u = lambert * l.intensity * (shadow ? 0 : 1) + l.ambient + l.sky * Math.max(n[2], 0) + l.bounce * Math.max(-n[2], 0)
  return clamp(u, 0, 1)
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

// How much of its reflected light a form-shadow normal takes, 0..1: the bounce off the table (bounceWeight, for
// a normal the key does not reach), the sky on up-facing normals and the ambient, each against the slider's
// default (bounce 0.1, sky 0.12, ambient 0.18). It chooses a place between the core and reflectedMax and nothing
// more: the clamp is what keeps the sliders from lifting a shadow into the half-tones.
const SKY_GAIN = 0.4
const AMBIENT_GAIN = 0.25
export function bounceAmount(params: PaintParams, nx: number, ny: number, nz: number): number {
  const l = params.light
  const sky = SKY_GAIN * clamp(l.sky / 0.12, 0, 2.5) * Math.max(nz, 0)
  const ambient = AMBIENT_GAIN * clamp(l.ambient / 0.18, 0, 2.5)
  return clamp(bounceWeight(params, nx, ny, nz, 0) + sky + ambient, 0, 1)
}

// How far under halfLo the core shadow is held, at the most: the core and the darkest half-tone are never the same value.
export const CORE_GAP = 0.02

// The value plan's numbers as the model reads them: the sliders, held to the structure (see the header). Every
// field is the slider's own value unless the structure moved it.
export interface EffectiveValues {
  halfLo: number
  halfHi: number
  lightLo: number
  lightHi: number
  corePlateau: number
  // The lightest the reflected light gets: the core, and reflectedShare of the way from it to halfLo.
  reflectedMax: number
  castPlateau: number
  castContact: number
}

// effectiveValues into a given object (the plan is sampled per pixel: nothing is allocated).
export function effectiveValuesInto(params: PaintParams, out: EffectiveValues): EffectiveValues {
  const v = params.value
  const halfLo = Math.max(v.halfLo, CORE_GAP)
  const halfHi = Math.max(v.halfHi, halfLo)
  const lightLo = Math.max(v.lightLo, halfHi)
  const core = Math.max(0, Math.min(v.corePlateau, halfLo - CORE_GAP))
  const rMax = core + clamp(v.reflectedShare, 0, 0.9) * (halfLo - core)
  const castPlateau = Math.min(v.castPlateau, rMax)
  out.halfLo = halfLo
  out.halfHi = halfHi
  out.lightLo = lightLo
  out.lightHi = Math.max(v.lightHi, lightLo)
  out.corePlateau = core
  out.reflectedMax = rMax
  out.castPlateau = castPlateau
  out.castContact = Math.min(v.castContact, castPlateau)
  return out
}

export const effectiveValues = (params: PaintParams): EffectiveValues =>
  effectiveValuesInto(params, { halfLo: 0, halfHi: 0, lightLo: 0, lightHi: 0, corePlateau: 0, reflectedMax: 0, castPlateau: 0, castContact: 0 })

// The lightest the reflected light gets, and the lightest any shadow-family value gets: the core, and reflectedShare of
// the way from it to the darkest half-tone, always darker than the darkest half-tone.
export const reflectedMax = (params: PaintParams): number => effectiveValues(params).reflectedMax

// The darkest half-tone: the light family's floor, the value at the terminator.
export const halfToneLowest = (params: PaintParams): number => effectiveValues(params).halfLo

// ---- the two families ----

export const FAM_LIGHT = 0
export const FAM_SHADOW = 1

// The family of a zone: light, half-tone (and the highlight, which is the light zone) against core, reflected, cast.
export const zoneFamily = (zone: number): number => (zone === Z_LIGHT || zone === Z_HALF ? FAM_LIGHT : FAM_SHADOW)

// A cast shadow is told from the terminator by its N·L: from N·L 0 up, this much more to take over (the renderer flags N·L <= 0 as
// shadow, and the shadow map's bias at a graze must not paint a ragged edge). The start is FIXED at 0, whatever the terminator's softness:
// a cast shadow is never softened by the terminator's band (it is a shadow where the key light is occluded, on a surface that faces the
// light, and it is as dark at N·L 0.2 under a wide terminator as under a narrow one). Only the N·L <= 0 side is the terminator's.
export const CAST_FADE = 0.08

// The half-width of the default terminator's edge (terminatorSoftness 0.1): a softer edge than that pushes the reflected light's lift out by the
// extra (planSample), and the figure's core band starts where the edge ends.
const DEFAULT_EDGE_HALF = 0.05

// The weight of the cast shadow at a point (the renderer's shadow flag is set for every N·L <= 0 and for the key light's occlusion). A
// GROUND has no terminator (it is flat: its N·L is the light's own elevation), so a flagged ground pixel is cast at full weight. On a
// figure the flag counts for something only past N·L 0, where it fades in over CAST_FADE.
export function castWeight(nl: number, shadow: boolean, ground = false): number {
  if (!shadow) return 0
  return ground ? 1 : smooth(0, CAST_FADE, nl)
}

// The weight of the light family at a point: the light side of the terminator edge (centred on N·L = 0, ts wide), less
// the cast shadow, which takes over from N·L 0 (castWeight).
export function lightWeight(ts: number, nl: number, shadow: boolean, ground = false): number {
  const wT = smooth(-ts / 2, ts / 2, nl)
  return (1 - castWeight(nl, shadow, ground)) * wT
}
// Is the point in the light family: the weight of the light is over a half. (N·L <= 0 is the shadow family, and so is
// a cast shadow, past the middle of its fade.)
export const isLightFamily = (params: PaintParams, nl: number, shadow: boolean, ground = false): boolean =>
  lightWeight(Math.max(1e-4, params.value.terminatorSoftness), nl, shadow, ground) > 0.5

// The weight of the terminator's band at a point on a surface: 1 where the plan's own soft edge is at its middle, 0 at its edges
// (|N·L| = ts / 2) and outside it. A surface stroke follows the plan's own value in the band, the plane's step outside it, and blends
// between them across it (the underpainting's lattice samples do not: its band pixels are made at the plan's own value already). A ground has no terminator, and a cast shadow is never softened by the band.
export function bandFollow(ts: number, nl: number, shadow = false, ground = false): number {
  if (ground) return 0
  return (1 - smooth(0, Math.max(1e-4, ts) / 2, Math.abs(nl))) * (1 - castWeight(nl, shadow))
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
  // How much of the reflected-light range the form shadow has taken here, 0..1 (the lift): the bounce mix of the
  // colour reads it. 0 in the light family, in the core and in the cast shadow.
  lift: number
  // The family: FAM_LIGHT where the weight of the light is over a half (highlight, light, half-tone), else FAM_SHADOW.
  fam: number
}

export const newZoneSample = (): ZoneSample => ({ w: [0, 0, 0, 0, 0], u: 0, zone: Z_CORE, trans: 0, lift: 0, fam: FAM_SHADOW })

// The value plan's numbers as the model reads them, for planSample (one pixel at a time, so nothing is allocated).
const EV: EffectiveValues = { halfLo: 0, halfHi: 0, lightLo: 0, lightHi: 0, corePlateau: 0, reflectedMax: 0, castPlateau: 0, castContact: 0 }

// The occlusion·ao at which a contact is fully dark (the default occlusion 0.35 reaches it at ao 0.23: the kernel's
// occlusion is a fraction of 8 samples, and a surface beside a form seldom has more than a quarter of them nearer).
export const CONTACT_FULL = 0.08
// The plan at one point. nl: the unclamped N·L; shadow: the G-buffer's shadow flag (set for every N·L <= 0 and for
// the key light's occlusion); n: the world normal; ao: the occlusion 0..1.
export function planSample(
  params: PaintParams, curves: CompiledCurves, nl: number, shadow: boolean, nx: number, ny: number, nz: number, ao: number, out: ZoneSample,
  ground = false,
): ZoneSample {
  const vp = params.value
  const ev = effectiveValuesInto(params, EV)
  const w = out.w
  const ts = Math.max(1e-4, vp.terminatorSoftness)
  const ls = Math.max(1e-4, vp.lightSoftness)
  const rs = Math.max(1e-4, vp.reflectedSoftness)
  const core = ev.corePlateau
  const rMax = ev.reflectedMax
  // the occlusion at this point: 0 free .. 1 a contact
  const contact = clamp((params.environment.occlusion * ao) / CONTACT_FULL, 0, 1)

  // -- the shadow family: the core, then the reflected light --
  // (the core band starts where the terminator's edge ends on the shadow side: a softer terminator than the default's pushes the
  // reflected light's lift out by the extra half-width, or the lift would reach the edge's own foot and wash the core out)
  const into = Math.max(0, -nl - Math.max(0, ts / 2 - DEFAULT_EDGE_HALF))
  const reflect = smooth(vp.coreWidth, vp.coreWidth + rs, into)
  const amount = bounceAmount(params, nx, ny, nz) * (1 - contact)
  const lift = amount * reflect
  const uForm = core + (rMax - core) * lift
  // -- the cast shadow, darkest at the contact --
  const uCast = lerp(ev.castPlateau, ev.castContact, contact)
  const wCast = castWeight(nl, shadow, ground)

  // -- the light family: the half-tone ramp, the soft turn to light, the light ramp --
  const n = clamp(curves.lightResponse(Math.max(0, nl)) * params.light.intensity, 0, 1)
  const turn = vp.lightTurn
  const rise = smooth(turn - ls / 2, turn + ls / 2, n)
  const uLight =
    ev.halfLo +
    (ev.halfHi - ev.halfLo) * smooth(0, Math.max(0.05, turn), n) +
    (ev.lightLo - ev.halfHi) * rise +
    (ev.lightHi - ev.lightLo) * smooth(turn, 1, n)

  // -- the terminator: the form shadow gives way to the light family across an edge centred on N·L = 0 --
  const wT = smooth(-ts / 2, ts / 2, nl)
  const uFormed = lerp(uForm, uLight, wT)
  // -- the cast shadow takes over from the form from N·L 0. Over its fade the light end of the blend moves to the
  // cap (a cast shadow is a shadow-family value: it never rises above reflectedMax, which the half-tone it fades
  // from would have lifted it to), fully by the middle of the fade, where the cast shadow is the dominant zone: where
  // the terminator's edge is crisp that is a cast weight of a half, and where it is wide (the light weight is the
  // edge's less the cast's) it is the cast weight that takes the light weight under a half, which is where a pixel
  // changes family --
  const toCap = wCast > 0 ? Math.min(1, wCast / Math.max(1e-9, 1 - 0.5 / Math.max(wT, 0.5))) : 0
  const uFrom = lerp(uFormed, Math.min(uFormed, rMax), toCap)
  out.u = clamp(curves.value(clamp(lerp(uFrom, uCast, wCast), 0, 1)), 0, 1)

  const lit = (1 - wCast) * wT
  const dark = (1 - wCast) * (1 - wT)
  w[0] = lit * rise
  w[1] = lit - w[0]
  // (a pixel is reflected light only where the bounce, or the sky, really reaches it: the ambient alone, 0.25, is not)
  w[3] = dark * reflect * smooth(0.2, 0.5, amount)
  w[2] = dark - w[3]
  w[4] = wCast
  out.lift = dark * lift
  out.fam = lit > 0.5 ? FAM_LIGHT : FAM_SHADOW
  let best = 0
  for (let k = 1; k < 5; k++) if (w[k] > w[best]) best = k
  out.zone = best
  out.trans = 1 - w[best]
  return out
}

// What one sample of the plan hands the strokes and the planes (the arrays of a PlanMap, per sample): the value the plan shows, the plan value
// the strokes read, the zone, how far into a zone's boundary, the reflected-light lift (a PlanMap's `bounce`), the key light (Lambert × shadow),
// the light, shadow and reflected weights, and the family.
export interface PlanFacts {
  value: number
  u: number
  zone: number
  trans: number
  lift: number
  key: number
  lightW: number
  shadowW: number
  reflW: number
  fam: number
}

export const newPlanFacts = (): PlanFacts => ({ value: 0, u: 0, zone: Z_LIGHT, trans: 0, lift: 0, key: 0, lightW: 1, shadowW: 0, reflW: 0, fam: FAM_LIGHT })

// The plan at one sample of a surface, for the per-pixel plan (buildPlanMap) and the baked one per vertex (bake/plan.ts): the one place that
// says how a sample's numbers come from planSample. Bare canvas in the light (a ground, not in shadow) is the canvas value (the strokes' u
// stays the canvas, so a value curve never repaints the ground; the value plan shows what the curve would make of it), light and unshadowed;
// anything else is planSample, with its weights as the roles read them (the light weight is the light plus 0.6 of the half-tone; the shadow
// weight the core plus the cast). `uCanvas` is canvasValue(params); `zs` is scratch.
export function planFacts(
  params: PaintParams, curves: CompiledCurves, uCanvas: number, nl: number, shadow: boolean, nx: number, ny: number, nz: number, ao: number,
  ground: boolean, zs: ZoneSample, out: PlanFacts,
): PlanFacts {
  out.key = shadow ? 0 : Math.max(0, nl)
  if (ground && !shadow) {
    out.value = clamp(curves.value(uCanvas), 0, 1)
    out.u = uCanvas
    out.zone = Z_LIGHT
    out.trans = 0
    out.lift = 0
    out.lightW = 1
    out.shadowW = 0
    out.reflW = 0
    out.fam = FAM_LIGHT
    return out
  }
  planSample(params, curves, nl, shadow, nx, ny, nz, ao, zs, ground)
  out.value = zs.u
  out.u = zs.u
  out.zone = zs.zone
  out.trans = zs.trans
  out.lift = zs.lift
  out.lightW = zs.w[0] + 0.6 * zs.w[1]
  out.shadowW = zs.w[2] + zs.w[4]
  out.reflW = zs.w[3]
  out.fam = zs.fam
  return out
}

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
  // The model's value (the plan value, before the deviation: the 'value' debug view), 0..1, -1 where empty; and
  // the occlusion. `u` is the plan value too (0 where empty): the strokes' value reads it. They differ only on lit
  // canvas, whose u is the canvas value and whose value has the value curve applied.
  value: Float32Array
  ao: Float32Array
  // The plan value, and its zone (255 where empty).
  u: Float32Array
  zone: Uint8Array
  // How far into a zone boundary (0 inside a zone).
  trans: Float32Array
  // Key Lambert × shadow, the signed N·L (0 where empty: the form strokes' distance from the terminator), and
  // the reflected light the form shadow has taken (0..1, the colour's bounce mix).
  key: Float32Array
  nl: Float32Array
  bounce: Float32Array
  // Light weight (light + 0.6·half), shadow weight (core + cast), reflected weight.
  lightW: Float32Array
  shadowW: Float32Array
  reflW: Float32Array
  // |∇v| per CSS px (a large number at an edge of the figure).
  grad: Float32Array
  // The family of each pixel (FAM_LIGHT or FAM_SHADOW; FAM_SHADOW where empty): the light family is where the weight
  // of the light is over a half (N·L > 0 and not cast). The zones, planes and strokes' value bounds follow it.
  fam: Uint8Array
  // The value of lit canvas.
  uCanvas: number
  // The family's value bounds as plan values (the value curve applied to the cap and to the darkest half-tone): no
  // shadow-family stroke is made lighter than capU, and no light-family stroke darker than floorU (familyBound).
  capU: number
  floorU: number
  curves: CompiledCurves
}

// The bound on a stroke's value at pixel i, in plan values: a shadow-family pixel's strokes are at most capU (or the
// plan's own value there, where it is higher: the terminator's edge, where the families meet), a light-family pixel's
// at least floorU (or the plan's own, where it is lower). The bound is what the plan gave the pixel, never more
// than the family's own range.
export function familyBound(plan: PlanMap, i: number): number {
  return plan.fam[i] === FAM_SHADOW ? Math.max(plan.capU, plan.u[i]) : Math.min(plan.floorU, plan.u[i])
}

// A stroke's value held inside its family's range at pixel i: the plane steps, the seeded deviation and a role's own
// lightening or darkening (the scumble's ±0.1) cannot carry a stroke from one family into the other.
export function holdFamily(plan: PlanMap, i: number, u: number): number {
  return plan.fam[i] === FAM_SHADOW ? Math.min(u, familyBound(plan, i)) : Math.max(u, familyBound(plan, i))
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
  const nlA = scratchF32('plan.nl', n)
  const bounceA = scratchF32('plan.bounce', n)
  const lightW = scratchF32('plan.lightW', n)
  const shadowW = scratchF32('plan.shadowW', n)
  const reflW = scratchF32('plan.reflW', n)
  const grad = scratchF32('plan.grad', n)
  const fam = scratchU8('plan.fam', n)
  const uCanvas = canvasValue(params)
  const curves = compileCurves(params)
  const ev = effectiveValues(params)
  if (params.environment.occlusion > 0) computeOcclusion(fc, ao)
  else ao.fill(0)
  const L = view.lightDir
  const zs = newZoneSample()
  const pf = newPlanFacts()
  for (let i = 0; i < n; i++) {
    const m = g.mark[i]
    if (m < 0) {
      value[i] = -1
      u[i] = 0
      zone[i] = 255
      trans[i] = 0
      keyA[i] = 0
      nlA[i] = 0
      bounceA[i] = 0
      lightW[i] = 0
      shadowW[i] = 0
      reflW[i] = 0
      fam[i] = FAM_SHADOW
      continue
    }
    const nx = g.normal[3 * i]
    const ny = g.normal[3 * i + 1]
    const nz = g.normal[3 * i + 2]
    const ndl = nx * L[0] + ny * L[1] + nz * L[2]
    const shadow = g.shadow[i] === 1
    nlA[i] = ndl
    planFacts(params, curves, uCanvas, ndl, shadow, nx, ny, nz, ao[i], fc.ground[m] === 1, zs, pf)
    keyA[i] = pf.key
    value[i] = pf.value
    u[i] = pf.u
    zone[i] = pf.zone
    trans[i] = pf.trans
    bounceA[i] = pf.lift
    lightW[i] = pf.lightW
    shadowW[i] = pf.shadowW
    reflW[i] = pf.reflW
    fam[i] = pf.fam
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
  return {
    width: W, height: H, scale: g.scale, value, ao, u, zone, trans, key: keyA, nl: nlA, bounce: bounceA, lightW, shadowW, reflW, grad, fam, uCanvas,
    capU: curves.value(ev.reflectedMax), floorU: curves.value(ev.halfLo), curves,
  }
}
