// A stroke's colour as a RECIPE: the lighting curve's inputs, kept beside the
// stroke, so the colour can be made again when only a colour parameter changes
// (the curve's own numbers, its adjustment curves, the environment's colour, the
// brush-load mix) without the analysis, the walk or the geometry being redone.
//
// The full run and the recolour both make a stroke's colour through
// colourOfRecipe, from the same recipe, so they cannot differ: the full run is
// "build the recipe, then evaluate it", and a recolour is "evaluate it again".
//
// A recipe holds only what the colour parameters do NOT change: the local
// colour of the particle or plane, the plan value, the normal, the bounce and
// ambient shares, the plane's mean normal (its hue step is the curve's, so it is
// recomputed), the stroke's own seeded draws and where they apply. The ground's
// local colour (the canvas tone through the inverse of the curve) follows the
// curve's parameters, so a recipe says "the ground" rather than holding it.

import type { Oklab } from '../types'
import type { Curve, CurveInput } from './curve'

export interface ColourRecipe {
  // The local colour is the ground's (the canvas through the inverse curve), not lx, ly, lz.
  ground: boolean
  lx: number
  ly: number
  lz: number
  // The plan value the colour is made at.
  u: number
  // NaN where the curve is not told (it then leaves that term out).
  nz: number
  bounce: number
  ambientShare: number
  // The plane whose hue and chroma step the colour takes: its mean normal.
  hasPlane: boolean
  pnx: number
  pny: number
  pnz: number
  colormapped: boolean
  // NaN: the curve's own slope.
  lScale: number
  // The stroke's jitter: three standard-normal draws, the amplitude each is
  // multiplied by (and then by the curve's devL, devC, devH), and a relative chroma shift.
  g0: number
  g1: number
  g2: number
  c0: number
  c1: number
  c2: number
  dC: number
  // Add the curve's smooth jitter field at this surface point (a stroke on a particle does; edges and lines do not).
  field: boolean
  px: number
  py: number
  pz: number
}

// A source of colour: a recipe, or a fixed colour (the canvas tone, which is
// one side of a silhouette).
export type ColourSource = ColourRecipe | readonly [number, number, number]

// What a draft's colour is made of: one source, or two blended (an edge stroke
// that carries one side's colour into the other); `t` is the share of b.
export interface DraftColour {
  a: ColourSource
  b: ColourSource | null
  t: number
}

export function newRecipe(): ColourRecipe {
  return {
    ground: false,
    lx: 0, ly: 0, lz: 0,
    u: 0.5,
    nz: Number.NaN, bounce: Number.NaN, ambientShare: Number.NaN,
    hasPlane: false, pnx: 0, pny: 0, pnz: 0,
    colormapped: false,
    lScale: Number.NaN,
    g0: 0, g1: 0, g2: 0, c0: 0, c1: 0, c2: 0, dC: 0,
    field: false, px: 0, py: 0, pz: 0,
  }
}

// What colourOfRecipe reads from the parameters of the moment.
export interface RecipeEnv {
  curve: Curve
  // The ground's local colour under the current parameters.
  ground: Oklab
  devL: number
  devC: number
  devH: number
}

// Scratch for the hot path: the curve reads its input at once and keeps nothing.
const LOCAL: [number, number, number] = [0, 0, 0]
const JIT: [number, number, number] = [0, 0, 0]
const INPUT: CurveInput = { local: LOCAL, u: 0 }

export function colourOfRecipe(r: ColourRecipe, env: RecipeEnv): Oklab {
  const curve = env.curve
  if (r.ground) {
    LOCAL[0] = env.ground[0]
    LOCAL[1] = env.ground[1]
    LOCAL[2] = env.ground[2]
  } else {
    LOCAL[0] = r.lx
    LOCAL[1] = r.ly
    LOCAL[2] = r.lz
  }
  let j0 = r.g0 * r.c0 * env.devL
  let j1 = r.g1 * r.c1 * env.devC
  let j2 = r.g2 * r.c2 * env.devH
  if (r.field) {
    const dj = curve.devJ(r.px, r.py, r.pz)
    j0 = dj[0] + j0
    j1 = dj[1] + j1
    j2 = dj[2] + j2
  }
  j1 += r.dC
  JIT[0] = j0
  JIT[1] = j1
  JIT[2] = j2
  const input = INPUT
  input.u = r.u
  input.nz = Number.isNaN(r.nz) ? undefined : r.nz
  input.bounce = Number.isNaN(r.bounce) ? undefined : r.bounce
  input.ambientShare = Number.isNaN(r.ambientShare) ? undefined : r.ambientShare
  if (r.hasPlane) {
    const step = curve.planeStep(r.pnx, r.pny, r.pnz)
    input.planeHue = step[0]
    input.planeChroma = step[1]
  } else {
    input.planeHue = 0
    input.planeChroma = 0
  }
  input.colormapped = r.colormapped
  input.lScale = Number.isNaN(r.lScale) ? undefined : r.lScale
  input.j = JIT
  return curve.lab(input)
}

const sourceColour = (s: ColourSource, env: RecipeEnv): Oklab =>
  Array.isArray(s) ? [s[0], s[1], s[2]] : colourOfRecipe(s as ColourRecipe, env)

export function colourOfDraft(c: DraftColour, env: RecipeEnv): Oklab {
  const a = sourceColour(c.a, env)
  if (c.b === null) return a
  const b = sourceColour(c.b, env)
  return [a[0] + (b[0] - a[0]) * c.t, a[1] + (b[1] - a[1]) * c.t, a[2] + (b[2] - a[2]) * c.t]
}

// The lightness the colour would have if it were made at value `u` instead: the same recipe in every other respect (the
// local colour, the jitters, the plane, the lighting curve, the gamut fit), so it is what "the cap's lightness" or
// "the darkest half-tone's lightness" is FOR THIS STROKE. The mix's value step is held against it (strokes.ts).
export function lightnessAtValue(c: DraftColour, u: number, env: RecipeEnv): number {
  const at = (s: ColourSource): number => (Array.isArray(s) ? s[0] : colourOfRecipe({ ...(s as ColourRecipe), u }, env)[0])
  const a = at(c.a)
  if (c.b === null) return a
  const b = at(c.b)
  return a + (b - a) * c.t
}
