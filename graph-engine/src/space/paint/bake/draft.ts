// The baked strokes before they are packed (the baked painting, spec §14; plan Task 3): a growing structure-of-arrays of strokes in CREATION
// order, with each stroke's colour recipe beside it, then the packing into a BakedPainting's arrays in painting order.
//
// THE PRODUCERS. The surface strokes (strokes.ts) and, next, the edge strokes (edgeStrokes.ts) and the data marks' lines (lines.ts) each
// append their strokes to one StrokeSink: `alloc()` a slot, write its fields and its geometry straight into the sink's arrays, and give it a
// colour recipe (`setRecipe`). A producer that decides against a stroke after allocating it gives the slot back with `drop()`.
//
// THE COLOURS. A stroke's colour is made from its recipe (model/recipe.ts DraftColour) by the same steps as the per-frame packStrokes: the
// curve colour, the brush-load mix, the family hold, linear sRGB; at each of BAKE_MIX_LEVELS brush-load cell levels for a stroke that takes the
// SPATIAL mix (a surface stroke: the offset is a pure function of (role, cell, seed)), and once, repeated, for a stroke that takes the
// SEQUENTIAL mix (an edge or a data line: loads of consecutive strokes, in creation order, so the order a producer appends in is the order
// the load runs in). `colourStrokes` is the one place that makes them, for the full bake and for the recolour alike, so the two cannot differ.
//
// THE SEQUENTIAL LOAD'S BREAK. The mixer breaks a load where the next stroke is more than `mix.loadBreakPx` from the last (model/mix.ts), measured
// on a screen. The bake has no screen: a producer keeps a `LoadChain`, which gives each stroke its WORLD distance from the one before it, in px at
// the reference scale (or `CHAIN_BREAK`, where the chain starts again: another run), and `colourStrokes` unrolls those distances onto one axis
// (the running sum, per mixing role), where the mixer's own test sees the same distance. The distances are kept, not the decision, so a change of
// `mix.loadBreakPx` (a colour-only slider) breaks the loads somewhere else without a new bake.
//
// THE ORDER. Strokes are packed by layer, then by a seeded key (FNV of mark, particle or run, role, side, piece), so the order never depends on
// the camera; the packing's permutation is kept for the recolour.

import { holdLightness, oklabToLinear } from '../model/colour'
import { LoadMixer } from '../model/mix'
import { colourOfDraft, colourOfRecipe, lightnessAtValue, newRecipe, type ColourRecipe, type DraftColour, type RecipeEnv } from '../model/recipe'
import { FAM_SHADOW } from '../model/value'
import type { PaintParams } from '../params'
import { LAYER_ORDER, ROLES, type Oklab } from '../types'
import { BAKE_MIX_LEVELS, BAKE_PATH_POINTS, type BakedPainting } from './types'

// The index of a stroke that belongs to no particle (an edge, a data mark, a highlight dab: always drawn).
export const NO_PARTICLE = 0xffffffff

const P3 = 3 * BAKE_PATH_POINTS

// FNV-1a over the four bytes of each integer.
export function fnvInts(...words: number[]): number {
  let h = 0x811c9dc5
  for (const w of words) {
    const x = w | 0
    for (let k = 0; k < 4; k++) {
      h ^= (x >>> (8 * k)) & 255
      h = Math.imul(h, 0x01000193)
    }
  }
  return h >>> 0
}

// The distance (px) a chain gives for a stroke that starts it again (another run): far past any `mix.loadBreakPx` (the slider's top is 400).
export const CHAIN_BREAK = 1e5

// The strokes of one sequential mix chain, in creation order: what the brush-load mix needs of where each lies. `next` gives a stroke's distance
// in px (world distance over the reference world per px) from the one before it, or CHAIN_BREAK for the first of a chain and where `fresh`.
export class LoadChain {
  private have = false
  private x = 0
  private y = 0
  private z = 0
  private readonly perPx: number
  constructor(perPx: number) {
    this.perPx = perPx
  }
  next(x: number, y: number, z: number, fresh = false): number {
    const d = this.have && !fresh ? Math.min(CHAIN_BREAK, Math.hypot(x - this.x, y - this.y, z - this.z) / this.perPx) : CHAIN_BREAK
    this.have = true
    this.x = x
    this.y = y
    this.z = z
    return d
  }
}

// The middle of stroke `idx`'s baked path (the mean of its two middle points), written to `out`.
export function pathMid(sink: StrokeSink, idx: number, out: number[]): void {
  const o = 3 * BAKE_PATH_POINTS * idx
  const a = o + 3 * (BAKE_PATH_POINTS / 2 - 1)
  const b = o + 3 * (BAKE_PATH_POINTS / 2)
  out[0] = (sink.worldPath[a] + sink.worldPath[b]) / 2
  out[1] = (sink.worldPath[a + 1] + sink.worldPath[b + 1]) / 2
  out[2] = (sink.worldPath[a + 2] + sink.worldPath[b + 2]) / 2
}

// The fields of a plain colour recipe (model/recipe.ts ColourRecipe) kept per stroke in one Float32Array, REC_STRIDE to a stroke, in this order. A
// surface stroke's recipe is plain: it is most of the strokes of a bake, and a recipe as an object would be most of what a painting keeps.
// (Float32: the full bake makes its colours from the kept values too, so a recolour and a full bake agree bit for bit.)
export const REC_STRIDE = 21
const REC = { lx: 0, ly: 1, lz: 2, u: 3, nz: 4, bounce: 5, amb: 6, pnx: 7, pny: 8, pnz: 9, lScale: 10, g0: 11, g1: 12, g2: 13, c0: 14, c1: 15, c2: 16, dC: 17, px: 18, py: 19, pz: 20 } as const
const FLAG_GROUND = 1
const FLAG_PLANE = 2
const FLAG_FIELD = 4

// What a stroke's colour is made of, per stroke (the arrays of the sink's colour half): kept beside the packed painting so a change of colour
// parameters can make the colours again (the recolour).
export interface ColourRecipes {
  count: number
  // A plain recipe is in `rec` and `flags`. What is not plain (an edge that blends two sources, one side's colour into the other, or takes a
  // fixed colour: model/recipe.ts DraftColour) is an object here, and `hold` is, for a stroke whose family bound is not its own colour's (the same
  // edge), the colour whose lightness at the bound is the bound. Undefined for a plain recipe.
  draft: (DraftColour | undefined)[]
  hold: (DraftColour | undefined)[]
  rec: Float32Array
  flags: Uint8Array
  // The role the brush-load mix is keyed to (index into ROLES), the value the colour was made at (the mix amount's curve), the colormapped
  // flag, the stroke's own seed and its two personal jitter draws.
  mixRole: Uint8Array
  u: Float64Array
  colormapped: Uint8Array
  seed: Uint32Array
  jit0: Float64Array
  jit1: Float64Array
  // The family (value.ts FAM_LIGHT / FAM_SHADOW, -1 none) and the bound of its value in plan values (NaN none): the mix may not take the
  // stroke's lightness over the colour's lightness at the bound.
  fam: Int8Array
  uBound: Float64Array
  // 1: the SEQUENTIAL mix (`mx`, its distance from the stroke before it in its chain, px: the load's break test against params.mix.loadBreakPx);
  // 0: the SPATIAL mix by the brush-load cell at each level. A sequential stroke's `cells[0]` is the cell that seeds the load it starts.
  sequential: Uint8Array
  cells: Uint32Array // BAKE_MIX_LEVELS per stroke
  mx: Float64Array
  // 1: a sequential stroke that RIDES the load of the stroke before it in its role's chain (LoadMixer.mixFollow): it has the same offset, at the place in the
  // load that stroke has, takes no place in it of its own, and is no step of the chain (its `mx` is not added up). The edge strokes that the model has not
  // at the authored zoom (the finer cells of an edge stroke's refinement, bake/edgeStrokes.ts) ride, so the loads along an edge are the model's however fine
  // the cells are, and the strokes a zoomed-in view adds to an edge take the colour of the load they lie in.
  follow: Uint8Array
}

// What a producer gives for the colour of one stroke: a plain recipe, or a DraftColour (and for it, optionally, the colour its bound is made from).
export interface RecipeInput {
  recipe?: ColourRecipe
  draft?: DraftColour
  hold?: DraftColour
  mixRole: number
  u: number
  colormapped: boolean
  seed: number
  jit0: number
  jit1: number
  fam?: number
  uBound?: number
  // the cell at each level (spatial) or null (sequential)
  cells: ArrayLike<number> | null
  // A sequential stroke: the cell that seeds its load if it starts one (model/mix.ts newLoad: the surface cell of the load's first stroke), and
  // `mx`, its distance in px from the stroke before it in its chain (LoadChain.next).
  cell?: number
  mx?: number
  // The stroke rides the load of the one before it (ColourRecipes.follow): it is no step of the chain, so it has no `mx`.
  follow?: boolean
}

// What a producer gives for the geometry and the brush of one stroke (the fields a stroke has that are not its colour recipe or its path).
export interface StrokeFields {
  role: number
  layer: number
  mark: number
  particle: number
  rank: number
  side: -1 | 0 | 1
  sizing: number
  hidden: number
  handStart: number
  pathLength: number
  anchor: number
  basePx0: number
  basePx1: number
  // An edge stroke's spacing rank (BakedPainting.spacing); 0 when not given.
  spacing?: number
  alpha: number
  load: number
  impasto: number
  bristles: number
  bristleVar: number
  dry: number
  wet: number
  endSoft: number
  edge: number
  seed: number
  // the stroke's place in the painting order within its layer: the FNV key of (mark, particle or run, role, side, piece)
  key: number
}

function growArray<T extends Float32Array | Float64Array | Uint8Array | Int8Array | Uint32Array>(a: T, length: number): T {
  const out = new (a.constructor as new (n: number) => T)(length)
  out.set(a)
  return out
}

// The strokes of a bake in creation order.
export class StrokeSink {
  count = 0
  private cap: number
  role: Uint8Array
  layer: Uint8Array
  mark: Uint32Array
  particle: Uint32Array
  rank: Float32Array
  spacing: Float32Array
  side: Int8Array
  sizing: Uint8Array
  hidden: Uint8Array
  handStart: Uint8Array
  worldPath: Float32Array
  worldNormal: Float32Array
  pathLength: Float32Array
  anchor: Float32Array
  basePx: Float32Array
  alpha: Float32Array
  load: Float32Array
  impasto: Float32Array
  bristles: Float32Array
  bristleVar: Float32Array
  dry: Float32Array
  wet: Float32Array
  endSoft: Float32Array
  edge: Uint8Array
  seed: Uint32Array
  key: Uint32Array
  recipes: ColourRecipes

  constructor(capacity = 1024) {
    this.cap = Math.max(16, capacity)
    const n = this.cap
    this.role = new Uint8Array(n)
    this.layer = new Uint8Array(n)
    this.mark = new Uint32Array(n)
    this.particle = new Uint32Array(n)
    this.rank = new Float32Array(n)
    this.spacing = new Float32Array(n)
    this.side = new Int8Array(n)
    this.sizing = new Uint8Array(n)
    this.hidden = new Uint8Array(n)
    this.handStart = new Uint8Array(n)
    this.worldPath = new Float32Array(P3 * n)
    this.worldNormal = new Float32Array(P3 * n)
    this.pathLength = new Float32Array(n)
    this.anchor = new Float32Array(n)
    this.basePx = new Float32Array(2 * n)
    this.alpha = new Float32Array(n)
    this.load = new Float32Array(n)
    this.impasto = new Float32Array(n)
    this.bristles = new Float32Array(n)
    this.bristleVar = new Float32Array(n)
    this.dry = new Float32Array(n)
    this.wet = new Float32Array(n)
    this.endSoft = new Float32Array(n)
    this.edge = new Uint8Array(n)
    this.seed = new Uint32Array(n)
    this.key = new Uint32Array(n)
    this.recipes = {
      count: 0, draft: [], hold: [], rec: new Float32Array(REC_STRIDE * n), flags: new Uint8Array(n),
      mixRole: new Uint8Array(n), u: new Float64Array(n), colormapped: new Uint8Array(n), seed: new Uint32Array(n),
      jit0: new Float64Array(n), jit1: new Float64Array(n), fam: new Int8Array(n), uBound: new Float64Array(n),
      sequential: new Uint8Array(n), cells: new Uint32Array(BAKE_MIX_LEVELS * n), mx: new Float64Array(n), follow: new Uint8Array(n),
    }
  }

  // Room for one more stroke: its index (the next creation index). Write its path and normals at `3 * BAKE_PATH_POINTS * index` of `worldPath` and
  // `worldNormal`, then `set` its fields and `setRecipe` its colour; or `drop()` it.
  alloc(): number {
    if (this.count >= this.cap) this.grow(2 * this.cap)
    return this.count++
  }

  // Give back the slot `alloc` last gave (the producer decided against that stroke).
  drop(): void {
    this.count--
  }

  private grow(cap: number): void {
    this.cap = cap
    this.role = growArray(this.role, cap)
    this.layer = growArray(this.layer, cap)
    this.mark = growArray(this.mark, cap)
    this.particle = growArray(this.particle, cap)
    this.rank = growArray(this.rank, cap)
    this.spacing = growArray(this.spacing, cap)
    this.side = growArray(this.side, cap)
    this.sizing = growArray(this.sizing, cap)
    this.hidden = growArray(this.hidden, cap)
    this.handStart = growArray(this.handStart, cap)
    this.worldPath = growArray(this.worldPath, P3 * cap)
    this.worldNormal = growArray(this.worldNormal, P3 * cap)
    this.pathLength = growArray(this.pathLength, cap)
    this.anchor = growArray(this.anchor, cap)
    this.basePx = growArray(this.basePx, 2 * cap)
    this.alpha = growArray(this.alpha, cap)
    this.load = growArray(this.load, cap)
    this.impasto = growArray(this.impasto, cap)
    this.bristles = growArray(this.bristles, cap)
    this.bristleVar = growArray(this.bristleVar, cap)
    this.dry = growArray(this.dry, cap)
    this.wet = growArray(this.wet, cap)
    this.endSoft = growArray(this.endSoft, cap)
    this.edge = growArray(this.edge, cap)
    this.seed = growArray(this.seed, cap)
    this.key = growArray(this.key, cap)
    const r = this.recipes
    r.rec = growArray(r.rec, REC_STRIDE * cap)
    r.flags = growArray(r.flags, cap)
    r.mixRole = growArray(r.mixRole, cap)
    r.u = growArray(r.u, cap)
    r.colormapped = growArray(r.colormapped, cap)
    r.seed = growArray(r.seed, cap)
    r.jit0 = growArray(r.jit0, cap)
    r.jit1 = growArray(r.jit1, cap)
    r.fam = growArray(r.fam, cap)
    r.uBound = growArray(r.uBound, cap)
    r.sequential = growArray(r.sequential, cap)
    r.cells = growArray(r.cells, BAKE_MIX_LEVELS * cap)
    r.mx = growArray(r.mx, cap)
    r.follow = growArray(r.follow, cap)
  }

  set(i: number, f: StrokeFields): void {
    this.role[i] = f.role
    this.layer[i] = f.layer
    this.mark[i] = f.mark
    this.particle[i] = f.particle
    this.rank[i] = f.rank
    this.spacing[i] = f.spacing ?? 0
    this.side[i] = f.side
    this.sizing[i] = f.sizing
    this.hidden[i] = f.hidden
    this.handStart[i] = f.handStart
    this.pathLength[i] = f.pathLength
    this.anchor[i] = f.anchor
    this.basePx[2 * i] = f.basePx0
    this.basePx[2 * i + 1] = f.basePx1
    this.alpha[i] = f.alpha
    this.load[i] = f.load
    this.impasto[i] = f.impasto
    this.bristles[i] = f.bristles
    this.bristleVar[i] = f.bristleVar
    this.dry[i] = f.dry
    this.wet[i] = f.wet
    this.endSoft[i] = f.endSoft
    this.edge[i] = f.edge
    this.seed[i] = f.seed
    this.key[i] = f.key
  }

  // The colour recipes of the strokes made (trimmed to `count`): what the recolour keeps beside the packed painting. The sink's other arrays
  // are the geometry, which the packed painting has its own copy of.
  finish(): ColourRecipes {
    const c = this.recipes
    const n = this.count
    c.count = n
    c.draft.length = n
    c.hold.length = n
    return {
      count: n, draft: c.draft, hold: c.hold, rec: c.rec.slice(0, REC_STRIDE * n), flags: c.flags.slice(0, n),
      mixRole: c.mixRole.slice(0, n), u: c.u.slice(0, n), colormapped: c.colormapped.slice(0, n), seed: c.seed.slice(0, n),
      jit0: c.jit0.slice(0, n), jit1: c.jit1.slice(0, n), fam: c.fam.slice(0, n), uBound: c.uBound.slice(0, n),
      sequential: c.sequential.slice(0, n), cells: c.cells.slice(0, BAKE_MIX_LEVELS * n), mx: c.mx.slice(0, n), follow: c.follow.slice(0, n),
    }
  }

  setRecipe(i: number, r: RecipeInput): void {
    const c = this.recipes
    if (r.recipe) {
      packRecipe(r.recipe, c.rec, i)
      c.flags[i] = (r.recipe.ground ? FLAG_GROUND : 0) | (r.recipe.hasPlane ? FLAG_PLANE : 0) | (r.recipe.field ? FLAG_FIELD : 0)
      c.draft[i] = undefined
    } else {
      c.draft[i] = r.draft
      c.flags[i] = 0
    }
    c.hold[i] = r.hold
    c.mixRole[i] = r.mixRole
    c.u[i] = r.u
    c.colormapped[i] = r.colormapped ? 1 : 0
    c.seed[i] = r.seed
    c.jit0[i] = r.jit0
    c.jit1[i] = r.jit1
    c.fam[i] = r.fam === undefined ? -1 : r.fam
    c.uBound[i] = r.uBound === undefined ? Number.NaN : r.uBound
    if (r.cells === null) {
      c.sequential[i] = 1
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) c.cells[BAKE_MIX_LEVELS * i + l] = l === 0 ? (r.cell ?? 0) >>> 0 : 0
    } else {
      c.sequential[i] = 0
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) c.cells[BAKE_MIX_LEVELS * i + l] = r.cells[l]
    }
    c.mx[i] = r.mx ?? 0
    c.follow[i] = r.follow ? 1 : 0
  }
}

// ---- the colours ----

function packRecipe(r: ColourRecipe, out: Float32Array, i: number): void {
  const o = REC_STRIDE * i
  out[o + REC.lx] = r.lx
  out[o + REC.ly] = r.ly
  out[o + REC.lz] = r.lz
  out[o + REC.u] = r.u
  out[o + REC.nz] = r.nz
  out[o + REC.bounce] = r.bounce
  out[o + REC.amb] = r.ambientShare
  out[o + REC.pnx] = r.pnx
  out[o + REC.pny] = r.pny
  out[o + REC.pnz] = r.pnz
  out[o + REC.lScale] = r.lScale
  out[o + REC.g0] = r.g0
  out[o + REC.g1] = r.g1
  out[o + REC.g2] = r.g2
  out[o + REC.c0] = r.c0
  out[o + REC.c1] = r.c1
  out[o + REC.c2] = r.c2
  out[o + REC.dC] = r.dC
  out[o + REC.px] = r.px
  out[o + REC.py] = r.py
  out[o + REC.pz] = r.pz
}

// Stroke i's plain recipe (written into `r`): what `packRecipe` kept of it. `colormapped` is the stroke's own.
export function readRecipe(c: ColourRecipes, i: number, r: ColourRecipe): ColourRecipe {
  const o = REC_STRIDE * i
  const f = c.rec
  const flags = c.flags[i]
  r.ground = (flags & FLAG_GROUND) !== 0
  r.hasPlane = (flags & FLAG_PLANE) !== 0
  r.field = (flags & FLAG_FIELD) !== 0
  r.colormapped = c.colormapped[i] === 1
  r.lx = f[o + REC.lx]
  r.ly = f[o + REC.ly]
  r.lz = f[o + REC.lz]
  r.u = f[o + REC.u]
  r.nz = f[o + REC.nz]
  r.bounce = f[o + REC.bounce]
  r.ambientShare = f[o + REC.amb]
  r.pnx = f[o + REC.pnx]
  r.pny = f[o + REC.pny]
  r.pnz = f[o + REC.pnz]
  r.lScale = f[o + REC.lScale]
  r.g0 = f[o + REC.g0]
  r.g1 = f[o + REC.g1]
  r.g2 = f[o + REC.g2]
  r.c0 = f[o + REC.c0]
  r.c1 = f[o + REC.c1]
  r.c2 = f[o + REC.c2]
  r.dC = f[o + REC.dC]
  r.px = f[o + REC.px]
  r.py = f[o + REC.py]
  r.pz = f[o + REC.pz]
  return r
}

const SCRATCH = newRecipe()

// The colour of stroke i before the brush-load mix (fitted OKLab): the curve colour of its recipe.
export function preMixLab(c: ColourRecipes, i: number, env: RecipeEnv): Oklab {
  const d = c.draft[i]
  return d ? colourOfDraft(d, env) : colourOfRecipe(readRecipe(c, i, SCRATCH), env)
}

// The lightness stroke i's colour has at the value `u` (the same recipe in every other respect), or its hold colour's: the lightness the family's
// bound holds it to. (`u` defaults to the stroke's own bound.)
export function boundLightness(c: ColourRecipes, i: number, env: RecipeEnv, u = c.uBound[i]): number {
  const h = c.hold[i]
  const d = h ?? c.draft[i]
  if (d) return lightnessAtValue(d, u, env)
  const r = readRecipe(c, i, SCRATCH)
  r.u = u
  return colourOfRecipe(r, env)[0]
}

// The final colours (linear-light sRGB, 3 x BAKE_MIX_LEVELS per stroke: level l at 3*(BAKE_MIX_LEVELS*i + l)) of strokes [0, count) in CREATION
// order under `params`: the recipe's colour, each level's cell's brush-load mix (the sequential mix once, in creation order), the lightness held
// on the family's side of the bound (what the same recipe is at the bound value: packStrokes' rule), linear sRGB.
export function colourStrokes(r: ColourRecipes, params: PaintParams, env: RecipeEnv): Float32Array {
  const count = r.count
  const out = new Float32Array(3 * BAKE_MIX_LEVELS * count)
  const mixer = new LoadMixer(params)
  // the sequential strokes' chains unrolled onto one axis per mixing role (the mixer keeps one load per role)
  const axis = new Float64Array(ROLES.length)
  for (let i = 0; i < count; i++) {
    const lab = preMixLab(r, i, env)
    const fam = r.fam[i]
    const uBound = r.uBound[i]
    const held = fam >= 0 && !Number.isNaN(uBound)
    const lBound = held ? boundLightness(r, i, env) : 0
    const role = ROLES[r.mixRole[i]]
    const levels = r.sequential[i] === 1 ? 1 : BAKE_MIX_LEVELS
    let lin: number[] = [0, 0, 0]
    let x = r.mx[i]
    // (a stroke that rides a load is no step of its chain)
    const rides = r.sequential[i] === 1 && r.follow[i] === 1
    if (r.sequential[i] === 1 && !rides) {
      axis[r.mixRole[i]] += r.mx[i]
      x = axis[r.mixRole[i]]
    }
    for (let l = 0; l < levels; l++) {
      const input = {
        role, cell: r.cells[BAKE_MIX_LEVELS * i + l], u: r.u[i], x, y: 0, lab, colormapped: r.colormapped[i] === 1,
        seed: r.seed[i], jit0: r.jit0[i], jit1: r.jit1[i],
      }
      const mixed = rides ? mixer.mixFollow(input) : mixer.mix(input)
      let m: Oklab = mixed.lab
      if (held) m = holdLightness(m, fam === FAM_SHADOW, lBound)
      lin = oklabToLinear(m)
      out[3 * (BAKE_MIX_LEVELS * i + l)] = lin[0]
      out[3 * (BAKE_MIX_LEVELS * i + l) + 1] = lin[1]
      out[3 * (BAKE_MIX_LEVELS * i + l) + 2] = lin[2]
    }
    // (a sequential stroke's colour is the same at every level)
    for (let l = levels; l < BAKE_MIX_LEVELS; l++) {
      out[3 * (BAKE_MIX_LEVELS * i + l)] = lin[0]
      out[3 * (BAKE_MIX_LEVELS * i + l) + 1] = lin[1]
      out[3 * (BAKE_MIX_LEVELS * i + l) + 2] = lin[2]
    }
  }
  return out
}

// ---- the order ----

// The painting order: by layer, then by the seeded key, then by creation order. `perm[k]` is the creation index of the stroke painted k-th.
export function paintingOrder(sink: StrokeSink): Uint32Array {
  const n = sink.count
  const perm = new Uint32Array(n)
  for (let i = 0; i < n; i++) perm[i] = i
  const layer = sink.layer
  const key = sink.key
  perm.sort((a, b) => layer[a] - layer[b] || key[a] - key[b] || a - b)
  return perm
}

function gather<T extends Float32Array | Uint8Array | Int8Array | Uint32Array>(src: T, perm: Uint32Array, per: number): T {
  const out = new (src.constructor as new (n: number) => T)(per * perm.length)
  if (per === 1) for (let k = 0; k < perm.length; k++) out[k] = src[perm[k]]
  else for (let k = 0; k < perm.length; k++) for (let c = 0; c < per; c++) out[per * k + c] = src[per * perm[k] + c]
  return out
}

// The strokes' arrays of a BakedPainting (everything but the surfaces, the per-mark data and the key) in painting order, and the colours (made in
// creation order, then gathered).
export type StrokeArrays = Pick<
  BakedPainting,
  'count' | 'role' | 'layer' | 'mark' | 'particle' | 'rank' | 'spacing' | 'side' | 'sizing' | 'hidden' | 'handStart' | 'worldPath' | 'worldNormal' | 'pathLength' | 'anchor' | 'basePx' | 'colour' | 'alpha' | 'load' | 'impasto' | 'bristles' | 'bristleVar' | 'dry' | 'wet' | 'endSoft' | 'edge' | 'seed'
>

export function packStrokeArrays(sink: StrokeSink, perm: Uint32Array, colour: Float32Array): StrokeArrays {
  return {
    count: sink.count,
    role: gather(sink.role, perm, 1),
    layer: gather(sink.layer, perm, 1),
    mark: gather(sink.mark, perm, 1),
    particle: gather(sink.particle, perm, 1),
    rank: gather(sink.rank, perm, 1),
    spacing: gather(sink.spacing, perm, 1),
    side: gather(sink.side, perm, 1),
    sizing: gather(sink.sizing, perm, 1),
    hidden: gather(sink.hidden, perm, 1),
    handStart: gather(sink.handStart, perm, 1),
    worldPath: gather(sink.worldPath, perm, P3),
    worldNormal: gather(sink.worldNormal, perm, P3),
    pathLength: gather(sink.pathLength, perm, 1),
    anchor: gather(sink.anchor, perm, 1),
    basePx: gather(sink.basePx, perm, 2),
    colour: gather(colour, perm, 3 * BAKE_MIX_LEVELS),
    alpha: gather(sink.alpha, perm, 1),
    load: gather(sink.load, perm, 1),
    impasto: gather(sink.impasto, perm, 1),
    bristles: gather(sink.bristles, perm, 1),
    bristleVar: gather(sink.bristleVar, perm, 1),
    dry: gather(sink.dry, perm, 1),
    wet: gather(sink.wet, perm, 1),
    endSoft: gather(sink.endSoft, perm, 1),
    edge: gather(sink.edge, perm, 1),
    seed: gather(sink.seed, perm, 1),
  }
}

// The colours of the strokes in painting order (the recolour's: the colours made in creation order, gathered).
export function gatherColours(colour: Float32Array, perm: Uint32Array): Float32Array {
  return gather(colour, perm, 3 * BAKE_MIX_LEVELS)
}

// The layer of a role (index into LAYER_ORDER).
export const layerOfRole = (role: string): number => LAYER_ORDER.indexOf(role as (typeof LAYER_ORDER)[number])
