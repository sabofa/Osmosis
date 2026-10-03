// The baked painting's entry points (the baked painting, spec §14; plan Task 3): `bakePainting` makes a BakedPainting once, in the world, for a scene,
// its particles, the world light and the params; `recolourBake` makes the colours of one again under new colour parameters, with no analysis.
//
//   plan        the value plan per vertex and side of every mesh's refined surface (bake/plan.ts)
//   planes      the painter's planes on the surfaces (bake/planes.ts)
//   edges       the edges between them, their hardness and the edge field (bake/edges.ts)
//   strokes     every particle's strokes per role and per side, walked on the surface (bake/strokes.ts), and, slotted in after them (Task 3b),
//               the edge strokes (edgeStrokes.ts) and the data marks' lines (lines.ts)
//   underpaint  the underpainting per vertex per side (bake/underpaint.ts)
//   pack        the strokes' colours at each brush-load level, the painting order, and the packed arrays
//
// Deterministic: nothing here reads a clock or Math.random; the same inputs give byte-identical arrays and an equal key. The PHASE times are the
// caller's to take: `progress` is called at the start (done 0) and the end (done 1) of every phase, and in the long ones in between.

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { ParticleSet, SceneColours } from '../types'
import { ROLES } from '../types'
import { COLOUR_ONLY, curveFor, groundLocal, NOT_COLOUR_ONLY, recipeEnv, RENDER_ONLY } from '../model/index'
import { mixerOf } from '../model/underpaint'
import { colourStrokes, gatherColours, packStrokeArrays, paintingOrder, StrokeSink, type ColourRecipes } from './draft'
import { buildWorldEdges, type WorldEdges } from './edges'
import { buildWorldPlan, type WorldPlan } from './plan'
import { buildWorldPlanes, type WorldPlanes } from './planes'
import { buildSurfaceStrokes, strokeCtx, type SurfaceStrokeStats } from './strokes'
import { buildSurfaceUnder, withUnderColours, type SurfaceUnder } from './underpaint'
import type { AuthoredFraming, BakedPainting, BakedSurface, BakePainting, RecolourBake } from './types'

export type { AuthoredFraming } from './types'

// ---- the key ----

// The params only a frame reads (the bake emits every role's strokes for every particle and the frame thins them by screen density, sizes them by
// the zoom and fades them by the facing: none of these moves a baked stroke). The bake reads `particles.zoomBigMax` (the longest path), which is
// not here.
export const VIEW_ONLY: readonly string[] = [
  'particles.targetPer10kPx', 'particles.fadeLo', 'particles.fadeHi', 'particles.dragDensity', 'particles.zoomGrowMax', 'particles.zoomStrokeScale',
  ...ROLES.map((r) => `roles.${r}.density`),
]

// FNV-1a 32 bit over bytes, from two bases (a 64-bit key in effect).
class Fnv {
  private a = 0x811c9dc5
  private b = 0x9e3779b1
  bytes(u8: Uint8Array): this {
    let a = this.a
    let b = this.b
    for (let i = 0; i < u8.length; i++) {
      a ^= u8[i]
      a = Math.imul(a, 0x01000193)
      b ^= u8[i] + 0x5b
      b = Math.imul(b, 0x01000193)
    }
    this.a = a
    this.b = b
    return this
  }
  array(a: ArrayBufferView | null | undefined): this {
    if (!a) return this.text('null')
    this.number(a.byteLength)
    return this.bytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
  }
  number(n: number): this {
    return this.bytes(new Uint8Array(new Float64Array([n]).buffer))
  }
  text(s: string): this {
    return this.bytes(new TextEncoder().encode(s))
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0')
  }
}

// The parameters with the colour-only, render-only and view-only paths removed (the colour-only `mix.loadCell`, which moves where the load cells
// are, stays): what the bake's geometry, values and strokes read.
export function bakedParams(params: PaintParams): unknown {
  const copy = JSON.parse(JSON.stringify(params)) as Record<string, unknown>
  const drop = (path: string): void => {
    const keys = path.split('.')
    let at: Record<string, unknown> | undefined = copy
    for (let i = 0; i < keys.length - 1 && at; i++) at = at[keys[i]] as Record<string, unknown> | undefined
    if (at) delete at[keys[keys.length - 1]]
  }
  for (const p of [...COLOUR_ONLY, ...RENDER_ONLY, ...VIEW_ONLY]) drop(p)
  for (const p of NOT_COLOUR_ONLY) {
    const keys = p.split('.')
    let from: unknown = params
    let to = copy
    for (let i = 0; i < keys.length - 1; i++) {
      from = (from as Record<string, unknown>)[keys[i]]
      to = ((to[keys[i]] as Record<string, unknown> | undefined) ?? (to[keys[i]] = {})) as Record<string, unknown>
    }
    to[keys[keys.length - 1]] = (from as Record<string, unknown>)[keys[keys.length - 1]]
  }
  return copy
}

// A key of everything the bake read: the scene (its marks' kinds, counts, geometry and the style fields that change what is baked), the light direction
// to 1e-6, the authored framing, and the params that are not the frame's or the colours'. Equal keys, equal paintings (for equal particle sets and
// theme colours, which the lab rebuilds on their own changes).
export function bakeKey(scene: SpaceScene, lightDir: readonly number[], params: PaintParams, authored: AuthoredFraming): string {
  const h = new Fnv()
  h.number(scene.marks.length)
  for (const m of scene.marks) {
    h.text(m.kind)
    switch (m.kind) {
      case 'mesh':
        h.number(m.positions.length / 3).number(m.indices.length).array(m.positions).array(m.normals).array(m.indices).array(m.scalars)
        h.number(m.style.opacity).number(m.style.colorScale ?? -1)
        break
      case 'lines':
        h.number(m.positions.length / 3).number(m.starts.length).array(m.positions).array(m.starts).text(JSON.stringify(m.style))
        break
      case 'points':
        h.number(m.positions.length / 3).array(m.positions).text(JSON.stringify(m.style))
        break
      case 'arrows':
        h.number(m.tails.length / 3).array(m.tails).array(m.vectors).text(JSON.stringify(m.style))
        break
      case 'boxes':
        h.number(m.mins.length / 3).array(m.mins).array(m.maxs).text(JSON.stringify(m.style))
        break
    }
  }
  const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1
  for (let k = 0; k < 3; k++) h.number(Math.round((lightDir[k] / len) * 1e6))
  for (const v of [...authored.eye, ...authored.viewDir]) h.number(v)
  h.number(authored.ortho ? 1 : 0).number(authored.worldPerPx)
  h.text(JSON.stringify(bakedParams(params)))
  return h.hex()
}

// ---- the bake ----

export interface BakeProgress {
  phase: 'plan' | 'planes' | 'edges' | 'strokes' | 'underpaint' | 'pack'
  done: number // 0..1
}

// What a bake keeps beside the painting so a colour-only change can make the colours again.
interface Retained {
  recipes: ColourRecipes
  perm: Uint32Array
  unders: (SurfaceUnder | null)[]
}
const retained = new WeakMap<BakedPainting, Retained>()

// What a bake made besides the painting, for diagnostics, the tests and the bench: the world plan, planes and edges (which hold every refined
// surface and its BVH: tens of MB, so a bake keeps them only when asked: `keepStats`), and the strokes by role and side.
export interface BakeStats {
  plan: WorldPlan
  planes: WorldPlanes
  edges: WorldEdges
  strokes: SurfaceStrokeStats
}
const statsOf = new WeakMap<BakedPainting, BakeStats>()
export const bakeStats = (baked: BakedPainting): BakeStats | undefined => statsOf.get(baked)
// The colour recipes of a bake's strokes in CREATION order, and the permutation from painting order to creation order (`perm[k]` is the creation
// index of the k-th painted stroke), for the tests and diagnostics that check a stroke's colour against what it was made from.
export const bakedRecipes = (baked: BakedPainting): { recipes: ColourRecipes; perm: Uint32Array } | undefined => retained.get(baked)

export interface BakeOptions {
  // Keep the world plan, planes and edges beside the painting (`bakeStats`). Off by default: they are what the bake worked from, and a painting that
  // is kept for a session should not keep them.
  keepStats?: boolean
}

export function bakePaintingWithProgress(
  scene: SpaceScene, particles: ParticleSet, colours: SceneColours, lightDir: [number, number, number], params: PaintParams, authored: AuthoredFraming,
  progress?: (p: BakeProgress) => void, options: BakeOptions = {},
): BakedPainting {
  const phase = (p: BakeProgress['phase'], done: number): void => progress?.({ phase: p, done })
  const curve = curveFor(params)
  const env = recipeEnv(params, curve, groundLocal(params))
  const nMarks = scene.marks.length

  phase('plan', 0)
  const plan = buildWorldPlan(scene, lightDir, params, authored.worldPerPx)
  phase('plan', 1)
  phase('planes', 0)
  const planes = buildWorldPlanes(plan, particles, colours, curve, params)
  phase('planes', 1)
  phase('edges', 0)
  const edges = buildWorldEdges(plan, planes, params, scene, authored)
  phase('edges', 1)

  // the strokes, in creation order: the surface strokes (every particle, every role it qualifies for, each side), then --- TASK 3b --- the edge
  // strokes (edgeStrokes.ts, along the world edges' runs) and the data marks' lines (lines.ts, which also fills `dataColour`), appended to the same
  // sink: their sequential brush-load mix runs in the order they are appended, edges then lines.
  phase('strokes', 0)
  const sink = new StrokeSink(Math.max(1024, 3 * particles.count))
  const ctx = strokeCtx(scene, particles, params, curve, env, plan, planes, edges)
  const strokeStats = buildSurfaceStrokes(ctx, sink, (d) => phase('strokes', Math.min(0.99, d)))
  phase('strokes', 1)

  // the underpainting of every opaque mesh's surface, per vertex
  phase('underpaint', 0)
  const unders: (SurfaceUnder | null)[] = scene.marks.map(() => null)
  const surfaces: (BakedSurface | null)[] = scene.marks.map(() => null)
  const mixer = mixerOf(params)
  for (let m = 0; m < nMarks; m++) {
    if (!plan.surfaces[m]) continue
    const made = buildSurfaceUnder(scene, colours, params, curve, plan, planes, m)
    unders[m] = made.under
    surfaces[m] = withUnderColours(made.surface, made.under, params, env, mixer)
    phase('underpaint', (m + 1) / nMarks)
  }
  phase('underpaint', 1)

  // the colours (at each brush-load level), the painting order, the packed arrays
  phase('pack', 0)
  const recipes = sink.finish()
  const colour = colourStrokes(recipes, params, env)
  const perm = paintingOrder(sink)
  const arrays = packStrokeArrays(sink, perm, colour)
  const baked: BakedPainting = {
    ...arrays,
    referenceWorldPerPx: authored.worldPerPx,
    areaPerParticle: ctx.areaPerParticle,
    surfaces,
    focal: edges.focal,
    dataColour: new Float32Array(3 * nMarks), // TASK 3b: lines.ts fills it (the line recipe's colour before the mix)
    key: bakeKey(scene, lightDir, params, authored),
  }
  retained.set(baked, { recipes, perm, unders })
  if (options.keepStats) statsOf.set(baked, { plan, planes, edges, strokes: strokeStats })
  phase('pack', 1)
  return baked
}

export const bakePainting: BakePainting = (scene, particles, colours, lightDir, params, authored) =>
  bakePaintingWithProgress(scene, particles, colours, lightDir, params, authored)

// ---- the recolour ----

// The painting again with new colour parameters, without the analysis, the walks or the geometry: every stroke's colour is made again from its
// recipe at each level, and every surface's underpainting from its vertices' recipes, by the same functions the bake used, so it is the painting
// `bakePainting` would give under `params` bit for bit (provided the change is colour-only: model/index.ts isColourOnlyChange). The new painting
// shares every array that is not a colour with `baked`, by identity. Null when `baked` was not made here.
export const recolourBake: RecolourBake = (baked: BakedPainting, params: PaintParams): BakedPainting | null => {
  const held = retained.get(baked)
  if (!held) return null
  const curve = curveFor(params)
  const env = recipeEnv(params, curve, groundLocal(params))
  const colour = gatherColours(colourStrokes(held.recipes, params, env), held.perm)
  const mixer = mixerOf(params)
  const surfaces = baked.surfaces.map((s, m) => (s && held.unders[m] ? withUnderColours(s, held.unders[m]!, params, env, mixer) : s))
  // TASK 3b: the data marks' colours (lines.ts) are made again here, as `dataColour`
  const next: BakedPainting = { ...baked, colour, surfaces }
  retained.set(next, held)
  const stats = statsOf.get(baked)
  if (stats) statsOf.set(next, stats)
  return next
}
