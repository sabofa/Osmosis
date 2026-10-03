// The world value plan (the baked painting, spec §14; plan Task 1): the painter's "find the values of the figure"
// (model/value.ts) done on the meshes themselves, in the world, once.
//
// The per-frame model builds a plan per G-buffer pixel from the N·L the G-buffer holds, its shadow flag and its
// screen-space occlusion (buildPlanMap). The bake builds the same plan per VERTEX of each mesh's refined surface, from
// the world light, the CPU shadow caster (shadow.ts) and the world occlusion (occlusion.ts). The painter's maths is not
// repeated here: every vertex is `planSample`, with `canvasValue` for bare lit ground, `effectiveValues` for the family
// bounds and `compileCurves` for the curves, so a fix to those reaches the bake by itself.
//
// SIDES. The per-frame model turns every normal toward the viewer, so an open sheet is painted from whichever side is
// seen. The plan is therefore made for both sides of an open mesh: side +1 uses the vertex normal as given, side -1 its
// negation, and every quantity that reads the normal (N·L, the shadow test's lift, the sky and bounce terms of the plan,
// the occlusion's hemisphere) reads that side's. A closed OPAQUE mesh has side +1 only, and its side +1 is the OUTSIDE:
// the kernel does not orient closed surfaces, so the normal is turned by the surface's `orient` (surface.ts ORIENTATION).
// A closed VEIL has both sides (the far half of a translucent solid is seen through the near half, lit with the normal
// turned toward the viewer), side +1 being its outside too. A veil (opacity < 1) is not in the
// shadow map and casts nothing: its plan is made unshadowed and unoccluded, as roles.ts whereOf makes it.
//
// ADAPTIVE REFINEMENT. A plan per vertex blends across a triangle. Where the families meet (the terminator, a cast
// shadow's edge) a 12 px triangle would blend light into shadow across 12 px, where the per-frame underpainting's ring is
// 3. So after the first plan every triangle whose vertices differ in family, in the shadow flag, or in the terminator band
// is bisected, the plan recomputed at the new vertices, and again, until no such triangle has an edge over RING_PX or the
// passes (at most MAX_PASSES) or the triangle budget are spent.
//
// A vertex's values are stored as Float32 and the plan is made FROM the stored N·L and occlusion, so `u` is exactly
// planSample of the stored inputs (the bit-for-bit test).

import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { compileCurves, type CompiledCurves } from '../model/respond'
import { RING_PX, UNDERPAINT_CELL_PX } from '../model/underpaint'
import { canvasValue, effectiveValues, familyBound, holdFamily, newPlanFacts, newZoneSample, planFacts, type EffectiveValues, type PlanMap } from '../model/value'
import { groundMarks, meshArea } from '../model/view'
import { occlusionAt } from './occlusion'
import { makeShadowCaster, type ShadowCaster } from './shadow'
import { refineSurface, refineWhere, type RefinedSurface, type SurfacePoint } from './surface'

// Triangles over the whole scene (shared by the meshes by world area): past it a surface stays at the coarser level.
export const BAKE_MAX_TRIANGLES = 400_000
// At most this many adaptive passes at the families' boundaries.
export const MAX_PASSES = 6

// The plan at the vertices of one side of a refined surface.
export interface SidePlan {
  nl: Float32Array // the signed N·L with the side's normal
  shadow: Uint8Array // 1 where nl <= 0 or the cast shadow's vote (vis < 0.5) says so: the G-buffer's flag
  vis: Float32Array // the fraction of the shadow rays that reach the light
  shadowDist: Float32Array // the mean distance to the occluder of the rays that were blocked, Infinity when none
  ao: Float32Array // the world occlusion 0..1
  u: Float32Array // the plan value the strokes read (canvasValue on bare lit ground)
  value: Float32Array // the model's value (the curve applied, on bare lit ground, to the canvas value)
  zone: Uint8Array
  fam: Uint8Array
  trans: Float32Array
  lift: Float32Array // the reflected-light lift (buildPlanMap's `bounce`)
  key: Float32Array // shadow ? 0 : max(0, nl)
  lightW: Float32Array // light + 0.6 half
  shadowW: Float32Array // core + cast
  reflW: Float32Array
  grad: Float32Array // per TRIANGLE: |∇ value| per CSS px at the reference scale (the world gradient × referenceWorldPerPx)
}

export interface WorldPlanStats {
  // Triangles and vertices over every mesh's refined surface.
  triangles: number
  vertices: number
  // True when the triangle budget stopped a refinement (of the surface's edges or of a family boundary) short.
  budgetHit: boolean
  // The most adaptive passes any mesh took.
  passes: number
  // Triangles that still straddle a family boundary or the band with an edge over RING_PX (0 unless the budget or the pass limit ended the refinement).
  unresolved: number
}

export interface WorldPlan {
  surfaces: (RefinedSurface | null)[] // per scene mark: opaque meshes and veils (null for non-meshes)
  front: (SidePlan | null)[] // side +1
  back: (SidePlan | null)[] // side -1 (null for closed opaque meshes: surface.outsideOnly)
  ground: Uint8Array // per mark (view.ts groundMarks)
  veil: Uint8Array // per mark (opacity < 1)
  capU: number
  floorU: number
  uCanvas: number // as PlanMap
  curves: CompiledCurves
  lightDir: [number, number, number]
  referenceWorldPerPx: number
  stats: WorldPlanStats
}

export interface WorldPlanOptions {
  // The scene-wide triangle budget (BAKE_MAX_TRIANGLES): a test passes a small one.
  maxTriangles?: number
}

// ---- building ----

interface Ctx {
  scene: SpaceScene
  params: PaintParams
  curves: CompiledCurves
  L: [number, number, number]
  caster: ShadowCaster
  uCanvas: number
  aoRadius: number
  ts: number
}

function newSidePlan(nv: number, nt: number): SidePlan {
  return {
    nl: new Float32Array(nv),
    shadow: new Uint8Array(nv),
    vis: new Float32Array(nv),
    shadowDist: new Float32Array(nv),
    ao: new Float32Array(nv),
    u: new Float32Array(nv),
    value: new Float32Array(nv),
    zone: new Uint8Array(nv),
    fam: new Uint8Array(nv),
    trans: new Float32Array(nv),
    lift: new Float32Array(nv),
    key: new Float32Array(nv),
    lightW: new Float32Array(nv),
    shadowW: new Float32Array(nv),
    reflW: new Float32Array(nv),
    grad: new Float32Array(nt),
  }
}

// The same plan with room for `nv` vertices and `nt` triangles; the first vertices keep their values.
function grownPlan(old: SidePlan, nv: number, nt: number): SidePlan {
  const out = newSidePlan(nv, nt)
  for (const k of Object.keys(old) as (keyof SidePlan)[]) {
    if (k === 'grad') continue
    ;(out[k] as Float32Array | Uint8Array).set(old[k])
  }
  return out
}

// The occlusion rays of a vertex come from a stream seeded by WHAT THE VERTEX IS (the seed, the mark, the side, its position),
// not by how many vertices came before it: a vertex that exists in two bakes of the same mesh (one refined a little more
// somewhere else, a refinement pass added) gets the same rays, so the same occlusion, bit for bit. The seed is an FNV-1a hash of
// the integers (seed, mark, side, the position in units of 1e-6 of the mesh's bounding-box diagonal from its corner), the stream
// is mulberry32 (random.ts's own generator) from it. Every vertex draws the same number of values.
export interface AoStreams {
  reset(side: 1 | -1, x: number, y: number, z: number): void
  next: () => number
}

export function aoStreams(seed: number, mark: number, lo: readonly number[], diag: number): AoStreams {
  const q = 1 / (1e-6 * (diag > 0 ? diag : 1))
  const base = fnvWord(fnvWord(0x811c9dc5, Math.floor(seed) | 0), mark | 0)
  let state = 0
  return {
    reset(side, x, y, z) {
      let h = fnvWord(base, side === 1 ? 1 : 2)
      h = fnvWord(h, Math.round((x - lo[0]) * q))
      h = fnvWord(h, Math.round((y - lo[1]) * q))
      h = fnvWord(h, Math.round((z - lo[2]) * q))
      state = h >>> 0
    },
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

// FNV-1a over the four bytes of a 32-bit integer.
function fnvWord(h: number, w: number): number {
  for (let k = 0; k < 4; k++) {
    h ^= (w >>> (8 * k)) & 255
    h = Math.imul(h, 0x01000193)
  }
  return h
}

const ZS = newZoneSample()
const PF = newPlanFacts()
const VIS = { vis: 1, dist: Infinity }

// The plan at vertices [from, to) of one side.
function planVertices(
  c: Ctx, plan: SidePlan, s: RefinedSurface, side: 1 | -1, from: number, to: number, opaque: boolean, ground: boolean, ao: AoStreams,
): void {
  const { params, curves, L } = c
  const p = s.positions
  for (let i = from; i < to; i++) {
    // (the side's normal: the side's sign, and for a closed surface the orientation that makes side +1 the outside)
    const o = side * s.orient
    const nx = o * s.normals[3 * i]
    const ny = o * s.normals[3 * i + 1]
    const nz = o * s.normals[3 * i + 2]
    // (the stored N·L and occlusion are what the plan is made from)
    const nl = Math.fround(nx * L[0] + ny * L[1] + nz * L[2])
    let vis = 1
    let dist = Infinity
    let shadow = false
    let occ = 0
    if (opaque) {
      // the renderer looks the shadow map up only where the surface faces the light
      if (nl > 0) {
        c.caster.visibility(p[3 * i], p[3 * i + 1], p[3 * i + 2], nx, ny, nz, VIS)
        vis = VIS.vis
        dist = VIS.dist
      }
      shadow = nl <= 0 || vis < 0.5
      if (params.environment.occlusion > 0) {
        ao.reset(side, p[3 * i], p[3 * i + 1], p[3 * i + 2])
        occ = Math.fround(occlusionAt(c.scene, c.caster, p[3 * i], p[3 * i + 1], p[3 * i + 2], nx, ny, nz, c.aoRadius, ao.next))
      }
    }
    plan.nl[i] = nl
    plan.shadow[i] = shadow ? 1 : 0
    plan.vis[i] = vis
    plan.shadowDist[i] = dist
    plan.ao[i] = occ
    // (the plan's numbers from planSample, as the per-pixel plan makes them: value.ts planFacts, with the ground flag of the cast gate)
    planFacts(params, curves, c.uCanvas, nl, shadow, nx, ny, nz, occ, ground, ZS, PF)
    plan.key[i] = PF.key
    plan.value[i] = PF.value
    plan.u[i] = PF.u
    plan.zone[i] = PF.zone
    plan.trans[i] = PF.trans
    plan.lift[i] = PF.lift
    plan.lightW[i] = PF.lightW
    plan.shadowW[i] = PF.shadowW
    plan.reflW[i] = PF.reflW
    plan.fam[i] = PF.fam
  }
}

// |∇ value| per triangle, per CSS px at the reference scale: the gradient of the linear interpolant of the vertex values over
// the triangle's own plane, in world units, times the world size of a px.
export function triangleGradients(s: RefinedSurface, value: Float32Array, perPx: number, out: Float32Array): void {
  const p = s.positions
  for (let t = 0; t < s.indices.length / 3; t++) {
    const a = s.indices[3 * t]
    const b = s.indices[3 * t + 1]
    const c = s.indices[3 * t + 2]
    const e1x = p[3 * b] - p[3 * a], e1y = p[3 * b + 1] - p[3 * a + 1], e1z = p[3 * b + 2] - p[3 * a + 2]
    const e2x = p[3 * c] - p[3 * a], e2y = p[3 * c + 1] - p[3 * a + 1], e2z = p[3 * c + 2] - p[3 * a + 2]
    const d1 = value[b] - value[a]
    const d2 = value[c] - value[a]
    const g11 = e1x * e1x + e1y * e1y + e1z * e1z
    const g22 = e2x * e2x + e2y * e2y + e2z * e2z
    const g12 = e1x * e2x + e1y * e2y + e1z * e2z
    const det = g11 * g22 - g12 * g12
    if (!(det > 1e-30)) {
      out[t] = 0
      continue
    }
    // ∇v = α e1 + β e2 with (α, β) solving  [g11 g12; g12 g22] (α, β) = (d1, d2)
    const al = (d1 * g22 - d2 * g12) / det
    const be = (d2 * g11 - d1 * g12) / det
    out[t] = Math.hypot(al * e1x + be * e2x, al * e1y + be * e2y, al * e1z + be * e2z) * perPx
  }
}

// What a triangle needs refined at a family boundary: its vertices differ in family, in the shadow flag or in the terminator
// band (|N·L| under half the terminator's softness), on either side.
function straddles(plans: SidePlan[], s: RefinedSurface, ts: number, t: number): boolean {
  const a = s.indices[3 * t]
  const b = s.indices[3 * t + 1]
  const c = s.indices[3 * t + 2]
  const half = ts / 2
  for (const plan of plans) {
    if (plan.fam[a] !== plan.fam[b] || plan.fam[b] !== plan.fam[c]) return true
    if (plan.shadow[a] !== plan.shadow[b] || plan.shadow[b] !== plan.shadow[c]) return true
    const ba = Math.abs(plan.nl[a]) < half
    const bb = Math.abs(plan.nl[b]) < half
    const bc = Math.abs(plan.nl[c]) < half
    if (ba !== bb || bb !== bc) return true
  }
  return false
}

function longestEdge(s: RefinedSurface, t: number): number {
  const p = s.positions
  let m = 0
  for (let e = 0; e < 3; e++) {
    const a = s.indices[3 * t + e]
    const b = s.indices[3 * t + ((e + 1) % 3)]
    m = Math.max(m, Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]))
  }
  return m
}

// The plan of every mesh of a scene, for a WORLD light direction (toward the light). `referenceWorldPerPx` is the world
// size of a CSS px at the authored framing: it turns the px parameters (the 12 px cell, the 3 px ring, the occlusion
// radius) into world units. Deterministic: a vertex's occlusion rays are seeded by (seed, mark, side, position), see aoStreams.
export function buildWorldPlan(
  scene: SpaceScene, lightDir: [number, number, number], params: PaintParams, referenceWorldPerPx: number, options: WorldPlanOptions = {},
): WorldPlan {
  const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1
  const L: [number, number, number] = [lightDir[0] / len, lightDir[1] / len, lightDir[2] / len]
  const curves = compileCurves(params)
  const ev: EffectiveValues = effectiveValues(params)
  const ground = groundMarks(scene)
  const caster = makeShadowCaster(scene, L)
  const uCanvas = canvasValue(params)
  const cell = UNDERPAINT_CELL_PX * referenceWorldPerPx
  const ring = RING_PX * referenceWorldPerPx
  const ctx: Ctx = {
    scene, params, curves, L, caster, uCanvas, aoRadius: params.environment.occlusionRadiusPx * referenceWorldPerPx,
    ts: Math.max(1e-4, params.value.terminatorSoftness),
  }

  // the triangle budget, shared by the meshes by their world area (a mesh keeps at least the triangles it came with)
  const meshes: number[] = []
  let totalArea = 0
  scene.marks.forEach((m, i) => {
    if (m.kind !== 'mesh' || m.indices.length < 3) return
    meshes.push(i)
    totalArea += meshArea(m)
  })
  const budget = options.maxTriangles ?? BAKE_MAX_TRIANGLES

  const surfaces: (RefinedSurface | null)[] = scene.marks.map(() => null)
  const front: (SidePlan | null)[] = scene.marks.map(() => null)
  const back: (SidePlan | null)[] = scene.marks.map(() => null)
  const veil = new Uint8Array(scene.marks.length)
  const stats: WorldPlanStats = { triangles: 0, vertices: 0, budgetHit: false, passes: 0, unresolved: 0 }

  for (const m of meshes) {
    const mesh = scene.marks[m] as MeshMark
    const opaque = mesh.style.opacity >= 1
    veil[m] = opaque ? 0 : 1
    const isGround = ground[m] === 1
    const share = totalArea > 0 ? meshArea(mesh) / totalArea : 1 / meshes.length
    const own = Math.floor(mesh.indices.length / 3)
    const maxT = Math.max(own, Math.floor(budget * share))
    let s = refineSurface(mesh, m, cell, maxT)
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < s.positions.length / 3; i++) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], s.positions[3 * i + k])
        hi[k] = Math.max(hi[k], s.positions[3 * i + k])
      }
    }
    // (the box of the first surface: refining only adds midpoints, which are inside it, so it is the box of every later one)
    const streams = aoStreams(params.seed, m, lo, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))

    const sides: (1 | -1)[] = s.outsideOnly ? [1] : [1, -1]
    let plans = sides.map(() => newSidePlan(0, 0))
    let passes = 0
    let done = 0
    for (;;) {
      const nv = s.positions.length / 3
      const nt = s.indices.length / 3
      plans = plans.map((p) => grownPlan(p, nv, nt))
      for (let i = done; i < nv; i++) {
        sides.forEach((side, k) => planVertices(ctx, plans[k], s, side, i, i + 1, opaque, isGround, streams))
      }
      done = nv
      if (passes >= MAX_PASSES) break
      const now = s
      const next = refineWhere(now, (t) => straddles(plans, now, ctx.ts, t), ring, maxT)
      if (next === now) break
      s = next
      passes++
    }

    // what is still unresolved, and the gradients
    let unresolved = 0
    for (let t = 0; t < s.indices.length / 3; t++) if (straddles(plans, s, ctx.ts, t) && longestEdge(s, t) > ring * 1.01) unresolved++
    plans.forEach((p) => triangleGradients(s, p.value, referenceWorldPerPx, p.grad))
    surfaces[m] = s
    front[m] = plans[0]
    back[m] = sides.length === 2 ? plans[1] : null
    stats.triangles += s.indices.length / 3
    stats.vertices += s.positions.length / 3
    stats.budgetHit ||= s.budgetHit
    stats.passes = Math.max(stats.passes, passes)
    stats.unresolved += unresolved
  }

  return {
    surfaces, front, back, ground, veil,
    capU: curves.value(ev.reflectedMax),
    floorU: curves.value(ev.halfLo),
    uCanvas, curves, lightDir: L, referenceWorldPerPx, stats,
  }
}

// ---- reading the plan at a point ----

export interface PlanAt {
  u: number
  value: number
  zone: number
  fam: number
  trans: number
  lift: number
  key: number
  nl: number
  lightW: number
  shadowW: number
  reflW: number
  shadowDist: number
  ao: number
}

export const newPlanAt = (): PlanAt => ({ u: 0, value: 0, zone: 0, fam: 0, trans: 0, lift: 0, key: 0, nl: 0, lightW: 0, shadowW: 0, reflW: 0, shadowDist: Infinity, ao: 0 })

// The plan at a point of a mark's surface, for one side: the vertex values interpolated barycentrically; the zone and the
// family from the nearest vertex (they do not blend). A cast shadow's distance is blended over the vertices that have one
// (a vertex in the light has none: Infinity). A closed opaque mesh has only side +1: side -1 reads it too.
export function planAt(plan: WorldPlan, mark: number, side: 1 | -1, p: SurfacePoint, out: PlanAt): PlanAt {
  const s = plan.surfaces[mark]
  const sp = side === -1 && plan.back[mark] ? plan.back[mark] : plan.front[mark]
  if (!s || !sp) throw new Error(`planAt: mark ${mark} has no plan`)
  const a = s.indices[3 * p.tri]
  const b = s.indices[3 * p.tri + 1]
  const c = s.indices[3 * p.tri + 2]
  const w0 = 1 - p.b1 - p.b2
  const w1 = p.b1
  const w2 = p.b2
  const mix = (f: Float32Array): number => w0 * f[a] + w1 * f[b] + w2 * f[c]
  out.u = mix(sp.u)
  out.value = mix(sp.value)
  out.trans = mix(sp.trans)
  out.lift = mix(sp.lift)
  out.key = mix(sp.key)
  out.nl = mix(sp.nl)
  out.lightW = mix(sp.lightW)
  out.shadowW = mix(sp.shadowW)
  out.reflW = mix(sp.reflW)
  out.ao = mix(sp.ao)
  const nearest = w0 >= w1 && w0 >= w2 ? a : w1 >= w2 ? b : c
  out.zone = sp.zone[nearest]
  out.fam = sp.fam[nearest]
  let sw = 0
  let sd = 0
  const d0 = sp.shadowDist[a]
  const d1 = sp.shadowDist[b]
  const d2 = sp.shadowDist[c]
  if (d0 !== Infinity) { sw += w0; sd += w0 * d0 }
  if (d1 !== Infinity) { sw += w1; sd += w1 * d1 }
  if (d2 !== Infinity) { sw += w2; sd += w2 * d2 }
  out.shadowDist = sw > 0 ? sd / sw : Infinity
  return out
}

// value.ts familyBound and holdFamily with the point's own u and family: the model's functions, handed a one-pixel plan.
const SHIM = { fam: [0], u: [0], capU: 0, floorU: 0 } as unknown as PlanMap & { fam: number[]; u: number[]; capU: number; floorU: number }
function shim(plan: WorldPlan, at: PlanAt): PlanMap {
  SHIM.fam[0] = at.fam
  SHIM.u[0] = at.u
  SHIM.capU = plan.capU
  SHIM.floorU = plan.floorU
  return SHIM
}

// The bound on a stroke's value at a point (plan values): a shadow-family point's strokes are at most the cap (or the plan's own value there,
// where it is higher), a light-family point's at least the floor (or the plan's own, where lower).
export function familyBoundAt(plan: WorldPlan, at: PlanAt): number {
  return familyBound(shim(plan, at), 0)
}

// A stroke's value `u` held inside its family's range at the point.
export function holdFamilyAt(plan: WorldPlan, at: PlanAt, u: number): number {
  return holdFamily(shim(plan, at), 0, u)
}
