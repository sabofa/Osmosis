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
// THE ORDER. Strokes are packed by layer, then by a seeded key (FNV of mark, particle or run, role, side, piece), so the order never depends on
// the camera; the packing's permutation is kept for the recolour.

import { holdLightness, oklabToLinear } from '../model/colour'
import { LoadMixer } from '../model/mix'
import { colourOfDraft, lightnessAtValue, type DraftColour, type RecipeEnv } from '../model/recipe'
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

// What a stroke's colour is made of, per stroke (the arrays of the sink's colour half): kept beside the packed painting so a change of colour
// parameters can make the colours again (the recolour).
export interface ColourRecipes {
  count: number
  // What the colour is made of (a recipe, or two blended: an edge that bridges its own side to what lies across it), and, for a stroke whose
  // family bound is not its own colour's (the same edge), the colour whose lightness at the bound is the bound.
  colour: DraftColour[]
  hold: (DraftColour | undefined)[]
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
  // 1: the SEQUENTIAL mix (its position `mx`, `my` is the load's break test, in the units of params.mix.loadBreakPx); 0: the SPATIAL mix by
  // the brush-load cell at each level.
  sequential: Uint8Array
  cells: Uint32Array // BAKE_MIX_LEVELS per stroke
  mx: Float64Array
  my: Float64Array
}

// What a producer gives for the colour of one stroke.
export interface RecipeInput {
  colour: DraftColour
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
  mx?: number
  my?: number
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
      count: 0, colour: [], hold: [],
      mixRole: new Uint8Array(n), u: new Float64Array(n), colormapped: new Uint8Array(n), seed: new Uint32Array(n),
      jit0: new Float64Array(n), jit1: new Float64Array(n), fam: new Int8Array(n), uBound: new Float64Array(n),
      sequential: new Uint8Array(n), cells: new Uint32Array(BAKE_MIX_LEVELS * n), mx: new Float64Array(n), my: new Float64Array(n),
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
    r.my = growArray(r.my, cap)
  }

  set(i: number, f: StrokeFields): void {
    this.role[i] = f.role
    this.layer[i] = f.layer
    this.mark[i] = f.mark
    this.particle[i] = f.particle
    this.rank[i] = f.rank
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
    c.colour.length = n
    c.hold.length = n
    return {
      count: n, colour: c.colour, hold: c.hold,
      mixRole: c.mixRole.slice(0, n), u: c.u.slice(0, n), colormapped: c.colormapped.slice(0, n), seed: c.seed.slice(0, n),
      jit0: c.jit0.slice(0, n), jit1: c.jit1.slice(0, n), fam: c.fam.slice(0, n), uBound: c.uBound.slice(0, n),
      sequential: c.sequential.slice(0, n), cells: c.cells.slice(0, BAKE_MIX_LEVELS * n), mx: c.mx.slice(0, n), my: c.my.slice(0, n),
    }
  }

  setRecipe(i: number, r: RecipeInput): void {
    const c = this.recipes
    c.colour[i] = r.colour
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
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) c.cells[BAKE_MIX_LEVELS * i + l] = 0
    } else {
      c.sequential[i] = 0
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) c.cells[BAKE_MIX_LEVELS * i + l] = r.cells[l]
    }
    c.mx[i] = r.mx ?? 0
    c.my[i] = r.my ?? 0
  }
}

// ---- the colours ----

// The final colours (linear-light sRGB, 3 × BAKE_MIX_LEVELS per stroke: level l at 3·(BAKE_MIX_LEVELS·i + l)) of strokes [0, count) in CREATION
// order under `params`: the recipe's colour, each level's cell's brush-load mix (the sequential mix once, in creation order), the lightness held
// on the family's side of the bound (what the same recipe is at the bound value: packStrokes' rule), linear sRGB.
export function colourStrokes(r: ColourRecipes, params: PaintParams, env: RecipeEnv): Float32Array {
  const count = r.count
  const out = new Float32Array(3 * BAKE_MIX_LEVELS * count)
  const mixer = new LoadMixer(params)
  for (let i = 0; i < count; i++) {
    const lab = colourOfDraft(r.colour[i], env)
    const fam = r.fam[i]
    const uBound = r.uBound[i]
    const held = fam >= 0 && !Number.isNaN(uBound)
    const lBound = held ? lightnessAtValue(r.hold[i] ?? r.colour[i], uBound, env) : 0
    const role = ROLES[r.mixRole[i]]
    const levels = r.sequential[i] === 1 ? 1 : BAKE_MIX_LEVELS
    let lin: number[] = [0, 0, 0]
    for (let l = 0; l < levels; l++) {
      const mixed = mixer.mix({
        role, cell: r.cells[BAKE_MIX_LEVELS * i + l], u: r.u[i], x: r.mx[i], y: r.my[i], lab, colormapped: r.colormapped[i] === 1,
        seed: r.seed[i], jit0: r.jit0[i], jit1: r.jit1[i],
      })
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
  'count' | 'role' | 'layer' | 'mark' | 'particle' | 'rank' | 'side' | 'sizing' | 'hidden' | 'handStart' | 'worldPath' | 'worldNormal' | 'pathLength' | 'anchor' | 'basePx' | 'colour' | 'alpha' | 'load' | 'impasto' | 'bristles' | 'bristleVar' | 'dry' | 'wet' | 'endSoft' | 'edge' | 'seed'
>

export function packStrokeArrays(sink: StrokeSink, perm: Uint32Array, colour: Float32Array): StrokeArrays {
  return {
    count: sink.count,
    role: gather(sink.role, perm, 1),
    layer: gather(sink.layer, perm, 1),
    mark: gather(sink.mark, perm, 1),
    particle: gather(sink.particle, perm, 1),
    rank: gather(sink.rank, perm, 1),
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
