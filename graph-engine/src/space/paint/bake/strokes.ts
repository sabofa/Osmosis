// The baked particle strokes (the baked painting, spec §14; plan Task 3): every particle's strokes, per role and per side of its surface, walked
// on the refined surface in the world, with their colours; the scumble mask and the highlight dabs on top.
//
// The per-frame model (model/roles.ts particleStrokes, buildParticleStroke, strokeColour, dabStrokes) chooses which of the visible particles
// get which strokes by a screen density and builds each from what the G-buffer holds at its pixel. The bake has no screen. It emits a stroke
// for EVERY role a particle qualifies for, with no density test (the frame thins by `rank`, the role's own shifted rank), reading the plan
// where the model read the pixel (bake/plan.ts planAt, at the particle's point of the refined surface, for the side). The roles' conditions,
// direction fields, sizes, values, colours and behaviours are the model's:
//
//   veil       glaze (alpha 0.3, two crossing directions by seed parity), plus the dry border pass near a flat sheet's border (pass 2);
//   block      every particle but lit bare table;
//   glaze      the core and cast zones under detect.glazeBelow;  form: |N·L| within detect.formBandNL and not in the deep core;
//   scumble    the world scumble mask (detect.ts);  reflected: the bounce reaches it;
//   dab        the top highlights (detect.ts), not drawn from a particle (always drawn).
//
// SIDES. A closed opaque mesh is painted from its outside (side 0, the plan of side +1). An open mesh, and a closed veil, from both sides: each
// particle gets an independent stroke per side, its seed the particle's mixed with the side (so the two sides do not mirror each other).
//
// SIZE. `basePx` is the stroke's size in CSS px at zoom 1 before the zoom's growth, exactly as buildParticleStroke has it before `big`: the
// role's length and width × the seeded ±12% × the light/shadow factor; the table's block 1.25 / 2.3; a veil's ×2. What is baked is the PATH, walked
// BAKE_PATH_POINTS/2 steps each way, long enough for the most zoomed-out view the bake serves and the biggest brush any view asks for
// (bakeLengthFactor × the zoom-1 length); a frame takes a sub-arc of the length it needs.
//
// THE VALUE RULE (spec §12) holds as the model holds it: a stroke's value is the plane's step plus planeGradient of its own gradient, with the
// seeded deviation and the role's own offset, held inside its family (holdFamily); inside the terminator's soft band the stroke follows the plan's
// own value and the role's offset fades out (value.ts bandFollow, `strokeValue` below); and the colour's lightness is held on its family's side
// of the bound (draft.ts colourStrokes, after the brush-load mix).

import { randomFor } from '../../../style/random'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { ROLES, type Role, type ParticleSet } from '../types'
import { loadCellOf, sizedLength } from '../model/brush'
import { behaviourOf, type Behaviour } from '../model/edges'
import { clamp, vcross, vlen, type V3 } from '../model/math'
import { newRecipe, type ColourRecipe, type RecipeEnv } from '../model/recipe'
import {
  BASE_END, CFG, GLAZE_ALPHA, ISO_MIN, PLAIN, ROT, TERMINATOR, VEIL_ALPHA, VEIL_BORDER_ALPHA, VEIL_END_SOFT, VEIL_LOAD, VEIL_SCALE, terminatorValueOf, veilOf,
  type ParticleRole,
} from '../model/roles'
import type { Curve } from '../model/curve'
import { ambientShare, bandFollow, Z_CAST } from '../model/value'
import { bigMax, meshArea, roleRank, zoomGrowOf, zoomSizeScaleAt } from '../model/view'
import { edgeClassAlong, type WorldEdges } from './edges'
import { dabSitesOf, ParticleGrid, scumbleMaskOf } from './detect'
import { fnvInts, layerOfRole, NO_PARTICLE, StrokeSink } from './draft'
import { familyBoundAt, holdFamilyAt, newPlanAt, planAt, type PlanAt, type WorldPlan } from './plan'
import { stepValueWorld, type WorldPlanes } from './planes'
import { normalOf, locate, type SurfacePoint } from './surface'
import { BAKE_MIX_LEVELS, BAKE_PATH_POINTS, BAKE_ZOOM_MIN, SIZING_SURFACE, HIDDEN_NA } from './types'
import { walkStroke, resampleWalk, PATH_HITS, type WalkSide, type WalkSpec } from './walk'

// THE LENGTH OF A BAKED PATH, in zoom-1 strokes: the longest any view the bake serves can ask a stroke to be. At view zoom z a stroke is
// sizedLength(1, big) times its zoom-1 length ON SCREEN, and a CSS px is 1/z of a reference px in the world, so the world length it needs is
// sizedLength(1, big(z)) / z zoom-1 strokes, big(z) = min(growth(z) x zoomSizeScale(z), zoomBigMax) (view.ts zoomGrowOf, zoomSizeScaleAt: the
// frame's own formulas). For z from BAKE_ZOOM_MIN (a view zoomed out to it asks 1/z = 2 with no growth) up to 64, the bake takes the most that is
// asked, with the growth bounded by what the particles supply (the stroke target over the particles' px area, which is the mark's area per
// particle) at the CURRENT params: the target, the growth cap, the brush's follow of the zoom, and the HIGHEST density of the roles that grow
// (block, form, scumble, glaze, reflected). The plan's first reading (sizedLength(1, zoomBigMax) whatever the zoom: 7.6 at the defaults) forgets
// that the zoom divides it, and is the ceiling: a path that long winds 1.5 times round a form (the iso strokes are circles about the light) and 16
// points cannot follow it. At the lab's showcase scenes and the default brush this is 2 to 2.7 zoom-1 strokes.
//
// BUCKETED, SO THAT THE FRAME-ONLY SLIDERS STAY CHEAP. The target, the density, the growth cap and the follow of the zoom are not in the bake's key
// (a frame reads them), yet they move this factor: it is rounded UP to the next LENGTH_BUCKET, and the per-mark factors are in the key (index.ts
// bakeKey). A slider move re-bakes only when a mark's bucket changes; within a bucket the baked path is the same and long enough.
export const LENGTH_BUCKET = 0.5
const ZOOM_SCAN = 96
// The roles whose strokes grow with the particles' shortage (view.ts zoomGrow): the dab follows the zoom only.
const GROWN_ROLES: readonly Role[] = ['block', 'form', 'scumble', 'glaze', 'reflected']
export function bakeLengthFactor(params: PaintParams, areaPerParticle: number, perPx: number): number {
  const bmax = bigMax(params)
  // a particle's px area at zoom 1, facing 1 (the largest it is on screen)
  const px = areaPerParticle / (perPx * perPx)
  let most = 1 / BAKE_ZOOM_MIN
  for (let k = 0; k <= ZOOM_SCAN; k++) {
    const z = BAKE_ZOOM_MIN * 2 ** ((k / ZOOM_SCAN) * 7) // 0.5 .. 64
    let grow = 1
    for (const role of GROWN_ROLES) grow = Math.max(grow, zoomGrowOf(params, false, px * z * z, role))
    const big = Math.min(grow * zoomSizeScaleAt(z, params), bmax)
    most = Math.max(most, sizedLength(1, big) / z)
  }
  const capped = Math.min(most, Math.max(1 / BAKE_ZOOM_MIN, sizedLength(1, bmax)))
  return Math.ceil(capped / LENGTH_BUCKET - 1e-9) * LENGTH_BUCKET
}

// The factor of every mark (the bucketed bakeLengthFactor of its area per particle): what the bake walks, and what its key holds.
export function lengthFactorsOf(scene: SpaceScene, set: ParticleSet, params: PaintParams, perPx: number): number[] {
  return Array.from(areaPerParticleOf(scene, set), (a) => bakeLengthFactor(params, a, perPx))
}
// The bend is the model's angle over a zoom-1 stroke; over the longer baked path it is scaled so the CURVATURE at the anchor stays the model's,
// to at most this many times (a longer path would curl on itself).
export const MAX_BEND_SCALE = 4
// A stroke whose baked path is shorter than this share of its zoom-1 length is dropped (the model drops a walk of fewer than three points: a
// quarter of the walk's length).
export const MIN_PATH_SHARE = 0.25
// The seed of a stroke on side -1 (the particle's mixed with the side).
export const SIDE_SEED = 0x9e3779b9

const ROLE_INDEX: Record<Role, number> = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<Role, number>

// ---- what a stroke's colour reads of the plan at its point ----

interface Where {
  u: number
  v: number
  b: number
  lightW: number
  shadowW: number
  reflW: number
  zone: number
  fam: number
  nl: number
  // The plane (-1 for a veil, which has none) and whether the point is on an opaque surface (a veil's value is its own, unheld).
  plane: number
  opaque: boolean
  // The G-buffer's shadow flag as the plan makes it: N·L <= 0, or the key light's occlusion.
  shadowFlag: boolean
}

function whereOf(c: StrokeCtx, m: number, k: 0 | 1, side: 1 | -1, hit: SurfacePoint, at: PlanAt, w: Where): void {
  const sp = (k === 0 ? c.plan.front[m] : c.plan.back[m])!
  planAt(c.plan, m, side, hit, at)
  const veil = c.plan.veil[m] === 1
  w.u = at.u
  w.v = veil ? at.u : at.value
  w.b = at.lift
  w.lightW = at.lightW
  w.shadowW = at.shadowW
  w.reflW = at.reflW
  w.zone = at.zone
  w.fam = at.fam
  w.nl = at.nl
  w.opaque = !veil
  const s = c.plan.surfaces[m]!
  const a = s.indices[3 * hit.tri]
  const b = s.indices[3 * hit.tri + 1]
  const d = s.indices[3 * hit.tri + 2]
  const vis = (1 - hit.b1 - hit.b2) * sp.vis[a] + hit.b1 * sp.vis[b] + hit.b2 * sp.vis[d]
  w.shadowFlag = at.nl <= 0 || vis < 0.5
  w.plane = !veil && c.planes.planeOf[m][k] ? c.planes.planeOf[m][k]![hit.tri] : -1
}

// ---- the stroke's value and colour ----

interface ColourOpts {
  du?: number
  lScale?: number
  dC?: number
  bounceBoost?: number
}

export interface StrokeColour {
  recipe: ColourRecipe
  u: number
  // the family and its bound in plan values, for a stroke on an opaque surface; none for a veil
  fam?: number
  uBound?: number
}

// A stroke's plan value u, as model/roles.ts strokeColour makes it: the plane's step (planeGradient of the particle's own value, plus the seeded
// deviation), the role's own offset, held in the family of the point. INSIDE THE TERMINATOR'S SOFT BAND the stroke follows the plan's own value
// and the role's offset fades out with it (bandFollow: 1 at the middle of the band, 0 at its edges and outside): held to the family on one side
// only, an offset would put a step across the edge. This is the one place the rule lives in the bake.
export function strokeValue(
  c: StrokeCtx, w: Where, at: PlanAt, ground: boolean, dev: number, du: number,
): number {
  const params = c.params
  const follow = w.opaque ? bandFollow(params.value.terminatorSoftness, w.nl, w.shadowFlag, ground) : 0
  const stepped = w.plane >= 0 ? stepValueWorld(c.planes, w.plane, w.u + dev, params.edges.planeGradient, follow) : w.u + dev
  const lifted = stepped + du * (1 - follow)
  return clamp(w.opaque ? holdFamilyAt(c.plan, at, lifted) : lifted, 0.02, 0.99)
}

// The colour recipe of a stroke on particle i at its point: the curve colour of the particle's local colour at the stroke's value, with the
// plane's hue step, the sky and bounce shares, and the stroke's own seeded jitters (model strokeColour).
function strokeColour(
  c: StrokeCtx, i: number, w: Where, at: PlanAt, ground: boolean, nz: number, rng: ReturnType<typeof randomFor>, opts: ColourOpts,
  sourceParticle = i,
): StrokeColour {
  const { set, params } = c
  const px = set.position[3 * sourceParticle]
  const py = set.position[3 * sourceParticle + 1]
  const pz = set.position[3 * sourceParticle + 2]
  const dev = c.curve.devU(px, py, pz)
  const u = strokeValue(c, w, at, ground, dev, opts.du ?? 0)
  const plane = w.plane >= 0 && !ground ? c.planes.planes[w.plane] : null
  const r = newRecipe()
  r.ground = ground
  r.lx = set.colour[3 * sourceParticle]
  r.ly = set.colour[3 * sourceParticle + 1]
  r.lz = set.colour[3 * sourceParticle + 2]
  r.u = u
  r.nz = nz
  r.bounce = opts.bounceBoost !== undefined ? Math.max(w.b, opts.bounceBoost) : w.b
  r.ambientShare = ambientShare(params, nz, w.v)
  if (plane) {
    r.hasPlane = true
    r.pnx = plane.nx
    r.pny = plane.ny
    r.pnz = plane.nz
  }
  r.colormapped = set.colormapped[sourceParticle] === 1
  r.lScale = opts.lScale ?? Number.NaN
  r.g0 = rng.gauss()
  r.g1 = rng.gauss()
  r.g2 = rng.gauss()
  r.c0 = 0.5
  r.c1 = 5 / 12
  r.c2 = 6 / 11
  r.dC = opts.dC ?? 0
  r.field = true
  r.px = px
  r.py = py
  r.pz = pz
  return w.opaque ? { recipe: r, u, fam: at.fam, uBound: familyBoundAt(c.plan, at) } : { recipe: r, u }
}

// ---- the context ----

export interface StrokeCtx {
  scene: SpaceScene
  set: ParticleSet
  params: PaintParams
  curve: Curve
  env: RecipeEnv
  plan: WorldPlan
  planes: WorldPlanes
  edges: WorldEdges
  perPx: number
  // The world light, unit.
  L: readonly number[]
  // The plan value a form stroke stops at (the terminator's middle).
  terminator: number
  // The factor of the baked path's length over the zoom-1 length, per mark (bakeLengthFactor).
  lengthFactor: number[]
  // World area per particle of each mark (0 for a mark with no particles).
  areaPerParticle: Float32Array
}

// World area per particle of each mesh mark (meshArea / the mark's particle count), for the contract's BakedPainting.areaPerParticle.
export function areaPerParticleOf(scene: SpaceScene, set: ParticleSet): Float32Array {
  const out = new Float32Array(scene.marks.length)
  const counts = new Uint32Array(scene.marks.length)
  for (let i = 0; i < set.count; i++) counts[set.mark[i]]++
  scene.marks.forEach((m, i) => {
    if (m.kind === 'mesh' && counts[i] > 0) out[i] = meshArea(m as MeshMark) / counts[i]
  })
  return out
}

export function strokeCtx(
  scene: SpaceScene, set: ParticleSet, params: PaintParams, curve: Curve, env: RecipeEnv, plan: WorldPlan, planes: WorldPlanes, edges: WorldEdges,
): StrokeCtx {
  const perPx = plan.referenceWorldPerPx
  const areaPerParticle = areaPerParticleOf(scene, set)
  return {
    scene, set, params, curve, env, plan, planes, edges, perPx, L: plan.lightDir,
    terminator: terminatorValueOf(params, plan.curves), areaPerParticle,
    lengthFactor: lengthFactorsOf(scene, set, params, perPx),
  }
}

export interface SurfaceStrokeStats {
  // strokes made, by role index and side (0, +1, -1 → 0, 1, 2)
  byRoleSide: number[][]
  dropped: number
}

// ---- the strokes of one particle ----

const AT: PlanAt = newPlanAt()
const WHERE: Where = { u: 0, v: 0, b: 0, lightW: 0, shadowW: 0, reflW: 0, zone: 0, fam: 0, nl: 0, plane: -1, opaque: true, shadowFlag: false }
const NRM = [0, 0, 0]
const SUB_HITS: SurfacePoint[] = Array.from({ length: 9 }, () => ({ tri: 0, b1: 0, b2: 0 }))

// The strokes of one stroke's worth of inputs (a particle, a side, a role and a veil pass): everything the model's buildParticleStroke reads
// from the pixel is read from the world plan. Returns whether a stroke was made.
function buildParticleStroke(
  c: StrokeCtx, sink: StrokeSink, ws: WalkSide, i: number, hit: SurfacePoint, k: 0 | 1, side: 1 | -1, bakedSide: -1 | 0 | 1, role: ParticleRole, veilPass: 0 | 1 | 2,
): boolean {
  const { set, params, plan, perPx } = c
  const m = set.mark[i]
  const cfg = CFG[role]
  const rp = params.roles[role]
  const veil = plan.veil[m] === 1
  const ground = plan.ground[m] === 1
  const at = AT
  const w = WHERE
  whereOf(c, m, k, side, hit, at, w)
  const seed = side === -1 ? (set.seed[i] ^ SIDE_SEED) >>> 0 : set.seed[i]
  const rng = randomFor(`paint/stroke/${role}${veilPass ? '/v' + veilPass : ''}/${seed}`, params.seed)
  const plain = PLAIN[role]
  const ls = plain ? 1 : 1 + 0.16 * w.lightW - 0.14 * w.shadowW
  const vLen = rng.range(0.88, 1.12)
  const vWid = rng.range(0.88, 1.12)
  const vLoad = rng.range(0.88, 1.12)
  const vImp = rng.range(0.88, 1.12)
  const vBri = rng.range(0.88, 1.12)
  let lengthPx = rp.length * vLen * ls * (ground && role === 'block' ? 1.25 : 1)
  let widthPx = rp.width * vWid * ls * (ground && role === 'block' ? 2.3 : 1)
  if (veil) {
    lengthPx *= VEIL_SCALE
    widthPx *= VEIL_SCALE
    if (veilPass === 2) {
      // the dry scumbles near the border: small, broken
      lengthPx = rp.length * 0.5 * vLen
      widthPx = rp.width * 0.4 * vWid
    }
  }
  const bend = clamp(rng.gauss(), -2, 2) * rp.curvature * 1.2
  const rot = clamp(rng.gauss() * (ROT[role] ?? 0.22), -0.55, 0.55)

  // the start: the particle, on the surface, its normal the side's
  normalOf(plan.surfaces[m]!, hit, side, NRM)
  const nx = NRM[0], ny = NRM[1], nz = NRM[2]
  const L = c.L
  const tx = set.tangent[3 * i], ty = set.tangent[3 * i + 1], tz = set.tangent[3 * i + 2]
  let mode: 'iso' | 'transport' | 'fixed' = 'transport'
  let fixed: V3 | undefined
  const nlx = L[0] * nx + L[1] * ny + L[2] * nz
  // round the light: n × L
  const ix = ny * L[2] - nz * L[1]
  const iy = nz * L[0] - nx * L[2]
  const iz = nx * L[1] - ny * L[0]
  let dx = tx, dy = ty, dz = tz
  if (veil) {
    // two crossing passes over the sheet: along one parameter line, then across it
    if (veilPass === 1 || (veilPass === 0 && (seed & 1) === 1)) {
      dx = ny * tz - nz * ty
      dy = nz * tx - nx * tz
      dz = nx * ty - ny * tx
    }
  } else if (cfg.dir === 'block') {
    if (ground) {
      const sd = Math.sqrt(L[0] * L[0] + L[1] * L[1])
      if (sd > 0.05) {
        fixed = [-L[0] / sd, -L[1] / sd, 0]
        dx = fixed[0]
        dy = fixed[1]
        dz = 0
        mode = 'fixed'
      }
    } else if (Math.sqrt(ix * ix + iy * iy + iz * iz) > ISO_MIN) {
      dx = ix
      dy = iy
      dz = iz
      mode = 'iso'
    }
  } else {
    // the parameter line the light crosses more: t or n × t
    const bx = ny * tz - nz * ty
    const by = nz * tx - nx * tz
    const bz = nx * ty - ny * tx
    const gx = L[0] - nx * nlx
    const gy = L[1] - ny * nlx
    const gz = L[2] - nz * nlx
    if (Math.abs(tx * gx + ty * gy + tz * gz) < Math.abs(bx * gx + by * gy + bz * gz) && Math.sqrt(gx * gx + gy * gy + gz * gz) >= 0.1) {
      dx = bx
      dy = by
      dz = bz
    }
    // a start rotation, so form strokes do not all run straight along the line
    const kk = dx * nx + dy * ny + dz * nz
    const px2 = dx - nx * kk, py2 = dy - ny * kk, pz2 = dz - nz * kk
    const dl = Math.sqrt(px2 * px2 + py2 * py2 + pz2 * pz2)
    if (dl > 1e-9) {
      const ux = px2 / dl, uy = py2 / dl, uz = pz2 / dl
      const kx = ny * uz - nz * uy, ky = nz * ux - nx * uz, kz = nx * uy - ny * ux
      const cr = Math.cos(rot), sr = Math.sin(rot)
      dx = ux * cr + kx * sr
      dy = uy * cr + ky * sr
      dz = uz * cr + kz * sr
    }
  }

  const px = hitX(c, m, hit, 0), py = hitX(c, m, hit, 1), pz = hitX(c, m, hit, 2)
  const spec: WalkSpec = {
    hit, px, py, pz, nx, ny, nz, dx, dy, dz, mode, fixed,
    rot: mode === 'iso' ? rot : 0,
    length: lengthPx * perPx * c.lengthFactor[m],
    bend: bend * Math.min(c.lengthFactor[m], MAX_BEND_SCALE),
    stopBelow: cfg.stopBelow === TERMINATOR ? c.terminator : cfg.stopBelow,
    planeId: !veil && cfg.classed !== 'none' && role !== 'scumble' ? w.plane : -1,
    castOnly: ground,
  }
  const walk = walkStroke(ws, spec)
  if (walk.n < 3) return false

  // which end is the loaded start: the lighter one (a form stroke), or the hand's (the frame's choice, by screen x)
  let reverse = false
  let handStart = 1
  if (cfg.start === 'light') {
    handStart = 0
    const last = walk.n - 1
    SUB_HITS[0].tri = walk.tri[0]
    SUB_HITS[0].b1 = walk.b1[0]
    SUB_HITS[0].b2 = walk.b2[0]
    const u0 = planAt(plan, m, side, SUB_HITS[0], AT).u
    SUB_HITS[1].tri = walk.tri[last]
    SUB_HITS[1].b1 = walk.b1[last]
    SUB_HITS[1].b2 = walk.b2[last]
    const u1 = planAt(plan, m, side, SUB_HITS[1], AT).u
    reverse = u1 > u0
    // (the plan at the start was read into AT: read it again, the walk's ends overwrote it)
    whereOf(c, m, k, side, hit, at, w)
  }

  const idx = sink.alloc()
  const meta = resampleWalk(ws, walk, reverse, sink.worldPath, sink.worldNormal, 3 * BAKE_PATH_POINTS * idx)
  if (!meta || meta.length < MIN_PATH_SHARE * lengthPx * perPx) {
    sink.drop()
    return false
  }

  // the edge environment decides how this brush behaves: distinct (hard / firm), blended (soft), dissolving (lost)
  let cls = -1
  let beh: Behaviour | null = null
  if (!veil && cfg.classed !== 'none') {
    // the nine points of the zoom-1 sub-arc about the anchor
    const ref = lengthPx * perPx
    const a = meta.anchor * meta.length
    const lo = Math.max(0, a - ref / 2)
    const hi = Math.min(meta.length, a + ref / 2)
    for (let q = 0; q < 9; q++) {
      const s = lo + ((hi - lo) * q) / 8
      const near = clamp(Math.round((s / meta.length) * (BAKE_PATH_POINTS - 1)), 0, BAKE_PATH_POINTS - 1)
      SUB_HITS[q].tri = PATH_HITS[near].tri
      SUB_HITS[q].b1 = PATH_HITS[near].b1
      SUB_HITS[q].b2 = PATH_HITS[near].b2
    }
    cls = edgeClassAlong(c.edges, plan, m, side, SUB_HITS, w.lightW, w.shadowW)
    if (cfg.classed === 'soft') cls = clamp(cls, 1, 2)
    beh = behaviourOf(cls)
  }

  // the colour: the local colour through the curve at the stroke's value
  let du = 0
  const opts: ColourOpts = {}
  if (role === 'glaze') du = -0.07
  if (role === 'scumble') du = (seed & 1 ? 1 : -1) * 0.1
  if (role === 'reflected') opts.bounceBoost = 0.5
  opts.du = du
  const col = strokeColour(c, i, w, at, ground, nz, rng, opts)

  const kpLight = plain ? 1 : 1 + 0.25 * w.lightW - 0.35 * w.shadowW
  const loadLight = plain ? 1 : 1 + 0.08 * w.lightW - 0.1 * w.shadowW
  const impasto = Math.max(0, rp.impasto * vImp * (beh ? beh.impastoMul : 1) * kpLight * (veil ? 0 : 1))
  // alpha: a class's opacity; a glaze's is its own absolute opacity (the frame multiplies the silhouette fade and the density fade in)
  const alpha = role === 'glaze' ? (veil ? (veilPass === 2 ? VEIL_BORDER_ALPHA : VEIL_ALPHA) : GLAZE_ALPHA) : beh ? beh.alphaMul : 1
  const loadV = rp.load * vLoad * (beh ? beh.loadMul : 1) * loadLight * (0.9 + 0.2 * rng.next()) * (veil && veilPass !== 2 ? VEIL_LOAD : 1)
  const jit0 = rng.gauss()
  const jit1 = rng.gauss()
  // the stroke's rank: the particle's own, shifted by the role (a veil's border pass is drawn at the scumble's density)
  const rank = roleRank(set.rank[i], veil && veilPass === 2 ? 'scumble' : role)
  const roleIdx = ROLE_INDEX[role]
  sink.set(idx, {
    role: roleIdx,
    layer: layerOfRole(role),
    mark: m,
    particle: i,
    rank,
    side: bakedSide,
    sizing: SIZING_SURFACE,
    hidden: HIDDEN_NA,
    handStart,
    pathLength: meta.length,
    anchor: meta.anchor,
    basePx0: lengthPx,
    basePx1: widthPx,
    alpha,
    load: loadV,
    impasto,
    bristles: rp.bristles * vBri,
    bristleVar: clamp(rp.bristleVar * (beh ? beh.bristleVarMul : 1), 0, 1),
    dry: veilPass === 2 ? 0.6 : beh ? Math.max(rp.dry * 0.5, beh.dryMin) : rp.dry,
    wet: beh ? Math.max(rp.wet * beh.wetMul, beh.wetMin) : rp.wet,
    endSoft: clamp((beh ? beh.endSoft : veil && veilPass !== 2 ? VEIL_END_SOFT : BASE_END[role]) + (walk.endA === 3 || walk.endB === 3 ? 0.2 : 0), 0, 1),
    edge: cls >= 0 ? cls : 255,
    seed,
    key: fnvInts(m, i, roleIdx, bakedSide, veilPass),
  })
  sink.setRecipe(idx, {
    recipe: col.recipe,
    mixRole: roleIdx,
    u: col.u,
    colormapped: set.colormapped[i] === 1,
    seed,
    jit0,
    jit1,
    fam: col.fam,
    uBound: col.uBound,
    cells: cellsOf(set, i, params.mix.loadCell),
  })
  return true
}

// The world position of a surface point's coordinate k.
function hitX(c: StrokeCtx, m: number, hit: SurfacePoint, k: number): number {
  const s = c.plan.surfaces[m]!
  const a = 3 * s.indices[3 * hit.tri] + k
  const b = 3 * s.indices[3 * hit.tri + 1] + k
  const d = 3 * s.indices[3 * hit.tri + 2] + k
  return (1 - hit.b1 - hit.b2) * s.positions[a] + hit.b1 * s.positions[b] + hit.b2 * s.positions[d]
}

const CELLS: number[] = new Array(BAKE_MIX_LEVELS).fill(0)
// The brush-load cell of particle i at each level (loadCellOf exactly as the model has it at that zoom level).
function cellsOf(set: ParticleSet, i: number, loadCell: number): number[] {
  for (let l = 0; l < BAKE_MIX_LEVELS; l++) CELLS[l] = loadCellOf(set, i, loadCell, l)
  return CELLS
}

// ---- the dabs ----

// The dab strokes of one side of a figure's surface: the model's dabStrokes at the highlights of detect.ts, colours from the nearest particle of the mark.
function dabStrokes(c: StrokeCtx, sink: StrokeSink, m: number, k: 0 | 1, side: 1 | -1, bakedSide: -1 | 0 | 1, grid: ParticleGrid, stats: SurfaceStrokeStats): void {
  const { set, params, plan, perPx } = c
  const s = plan.surfaces[m]!
  const sp = (k === 0 ? plan.front[m] : plan.back[m])!
  const rp = params.roles.dab
  const sites = dabSitesOf(s, sp, perPx, params)
  const at = AT
  const w = WHERE
  const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  const pos = [0, 0, 0]
  for (let n = 0; n < sites.length; n++) {
    const site = sites[n]
    hit.tri = site.tri
    hit.b1 = site.b1
    hit.b2 = site.b2
    const px = s.positions[3 * site.vertex]
    const py = s.positions[3 * site.vertex + 1]
    const pz = s.positions[3 * site.vertex + 2]
    pos[0] = px
    pos[1] = py
    pos[2] = pz
    normalOf(s, hit, side, NRM)
    const nx = NRM[0], ny = NRM[1], nz = NRM[2]
    // the nearest particle of this mesh gives the local colour
    const best = grid.nearest(px, py, pz)
    if (best < 0) continue
    const seed = (Math.imul(fnvInts(m, site.vertex, side), 0x9e3779b1) ^ (side === -1 ? (set.seed[best] ^ SIDE_SEED) >>> 0 : set.seed[best])) >>> 0
    const rng = randomFor(`paint/stroke/dab/${seed}`, params.seed)
    const vLen = rng.range(0.88, 1.12)
    const vWid = rng.range(0.88, 1.12)
    const vLoad = rng.range(0.88, 1.12)
    const vImp = rng.range(0.88, 1.12)
    const vBri = rng.range(0.88, 1.12)
    const L = c.L
    let dir: V3 = vcross([nx, ny, nz], L)
    let mode: 'iso' | 'transport' = 'iso'
    if (vlen(dir) <= ISO_MIN) {
      // at the very peak the normal is the light: take the world's x axis (the screen's horizontal, in the model)
      dir = [1, 0, 0]
      mode = 'transport'
    }
    const bend = clamp(rng.gauss(), -2, 2) * rp.curvature * 1.2
    const rot = clamp(rng.gauss() * (ROT.dab ?? 0.1), -0.3, 0.3)
    const lengthPx = rp.length * vLen
    const widthPx = rp.width * vWid
    const ws = walkSideOf(c, m, k, side)
    const spec: WalkSpec = {
      hit, px, py, pz, nx, ny, nz, dx: dir[0], dy: dir[1], dz: dir[2], mode, rot,
      length: lengthPx * perPx * c.lengthFactor[m],
      bend: bend * Math.min(c.lengthFactor[m], MAX_BEND_SCALE),
      stopBelow: -1, planeId: -1, castOnly: false,
    }
    const walk = walkStroke(ws, spec)
    if (walk.n < 3) continue
    const reverse = false
    const idx = sink.alloc()
    const meta = resampleWalk(ws, walk, reverse, sink.worldPath, sink.worldNormal, 3 * BAKE_PATH_POINTS * idx)
    if (!meta || meta.length < MIN_PATH_SHARE * lengthPx * perPx) {
      sink.drop()
      continue
    }
    // the colour: a lighter, bolder value of the local colour, at the dab's own point of the plan
    whereOf(c, m, k, side, hit, at, w)
    const nzP = particleNz(c, best, m, side)
    const col = strokeColour(c, best, w, at, false, nzP, rng, { du: 0.05, lScale: 1.35, dC: 0.9 })
    const loadV = rp.load * vLoad * (0.9 + 0.2 * rng.next())
    const jit0 = rng.gauss()
    const jit1 = rng.gauss()
    const roleIdx = ROLE_INDEX.dab
    sink.set(idx, {
      role: roleIdx, layer: layerOfRole('dab'), mark: m, particle: NO_PARTICLE, rank: 0, side: bakedSide, sizing: SIZING_SURFACE, hidden: HIDDEN_NA,
      handStart: 1, pathLength: meta.length, anchor: meta.anchor, basePx0: lengthPx, basePx1: widthPx, alpha: 1, load: loadV, impasto: rp.impasto * vImp,
      bristles: rp.bristles * vBri, bristleVar: rp.bristleVar, dry: rp.dry, wet: rp.wet, endSoft: BASE_END.dab, edge: 255, seed,
      key: fnvInts(m, site.vertex, roleIdx, bakedSide, 0),
    })
    sink.setRecipe(idx, {
      recipe: col.recipe, mixRole: roleIdx, u: col.u, colormapped: set.colormapped[best] === 1, seed, jit0, jit1, fam: col.fam, uBound: col.uBound,
      cells: cellsOf(set, best, params.mix.loadCell),
    })
    stats.byRoleSide[roleIdx][bakedSide + 1]++
  }
}

// The side's normal z at particle `i` (the particle's normal is the mesh's own, interpolated; the side's is that times the side and the orientation),
// for a dab's colour (the model: the nearest particle's normal).
const particleNz = (c: StrokeCtx, i: number, m: number, side: 1 | -1): number => side * c.plan.surfaces[m]!.orient * c.set.normal[3 * i + 2]

// ---- the walk sides ----

const walkSides = new WeakMap<StrokeCtx, WalkSide[][]>()
function walkSideOf(c: StrokeCtx, m: number, k: 0 | 1, side: 1 | -1): WalkSide {
  let all = walkSides.get(c)
  if (!all) {
    all = c.scene.marks.map(() => [])
    walkSides.set(c, all)
  }
  let ws = all[m][k]
  if (!ws) {
    ws = {
      mark: m,
      s: c.plan.surfaces[m]!,
      side,
      plan: c.plan,
      planeOf: c.planes.planeOf[m][k],
      adjHard: c.edges.adjHard,
      stopAt: c.params.edges.stopAt,
      bleedAt: c.params.edges.bleedAt,
      light: c.L,
    }
    all[m][k] = ws
  }
  return ws
}

// ---- all of the surface strokes ----

export function buildSurfaceStrokes(c: StrokeCtx, sink: StrokeSink, progress?: (done: number) => void): SurfaceStrokeStats {
  const { scene, set, params, plan, perPx } = c
  const stats: SurfaceStrokeStats = { byRoleSide: ROLES.map(() => [0, 0, 0]), dropped: 0 }
  const d = params.detect
  const marks = scene.marks
  // the scumble masks of the figures' sides
  const scumble: (Uint8Array | null)[][] = marks.map(() => [null, null])
  for (let m = 0; m < marks.length; m++) {
    const s = plan.surfaces[m]
    if (!s || plan.veil[m] === 1 || plan.ground[m] === 1) continue
    ;([0, 1] as const).forEach((k) => {
      const sp = k === 0 ? plan.front[m] : plan.back[m]
      if (sp) scumble[m][k] = scumbleMaskOf(s, sp, perPx, params)
    })
  }
  // the particles of each mesh mark, for the dabs' nearest colour
  const byMark = new Map<number, number[]>()
  for (let i = 0; i < set.count; i++) {
    const m = set.mark[i]
    const list = byMark.get(m)
    if (list) list.push(i)
    else byMark.set(m, [i])
  }
  const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  const veilMesh = new Map<number, ReturnType<typeof veilOf>>()
  const at = AT
  const w = WHERE
  const tick = Math.max(1, Math.floor(set.count / 64))
  for (let i = 0; i < set.count; i++) {
    if (progress && i % tick === 0) progress(i / set.count)
    const m = set.mark[i]
    const s = plan.surfaces[m]
    if (!s) continue
    const px = set.position[3 * i], py = set.position[3 * i + 1], pz = set.position[3 * i + 2]
    if (!locate(s, px, py, pz, set.normal[3 * i], set.normal[3 * i + 1], set.normal[3 * i + 2], 2 * perPx, hit)) continue
    const veil = plan.veil[m] === 1
    const ground = plan.ground[m] === 1
    const slots: (0 | 1)[] = s.outsideOnly ? [0] : [0, 1]
    for (const k of slots) {
      const side: 1 | -1 = k === 0 ? 1 : -1
      const bakedSide: -1 | 0 | 1 = s.outsideOnly ? 0 : side
      const ws = walkSideOf(c, m, k, side)
      const made = (role: ParticleRole, pass: 0 | 1 | 2): void => {
        if (buildParticleStroke(c, sink, ws, i, hit, k, side, bakedSide, role, pass)) stats.byRoleSide[ROLE_INDEX[role]][bakedSide + 1]++
        else stats.dropped++
      }
      if (veil) {
        // a mesh with opacity under 1 is glazed and nothing else, with the dry strokes near the border of a sheet
        made('glaze', 0)
        let vm = veilMesh.get(m)
        if (!vm) {
          vm = veilOf(scene.marks[m] as MeshMark)
          veilMesh.set(m, vm)
        }
        if (vm.border(px, py, pz) > 0.86) made('glaze', 2)
        continue
      }
      whereOf(c, m, k, side, hit, at, w)
      // (the plan facts are read again by the stroke: they are cheap, and the stroke owns its scratch)
      const zone = w.zone
      const shadowW = w.shadowW
      const u = w.u
      const nl = w.nl
      const reflW = w.reflW
      if (!ground || zone === Z_CAST) made('block', 0)
      if (ground) {
        if (shadowW > 0.55 && u < d.glazeBelow) made('glaze', 0)
        continue
      }
      if (shadowW < 0.85 && Math.abs(nl) <= d.formBandNL) made('form', 0)
      const mask = scumble[m][k]
      if (mask) {
        // the vertex of the particle's triangle nearest to it
        const b0 = 1 - hit.b1 - hit.b2
        const v = b0 >= hit.b1 && b0 >= hit.b2 ? s.indices[3 * hit.tri] : hit.b1 >= hit.b2 ? s.indices[3 * hit.tri + 1] : s.indices[3 * hit.tri + 2]
        if (mask[v] === 1) made('scumble', 0)
      }
      if (shadowW > 0.55 && u < d.glazeBelow) made('glaze', 0)
      if (reflW > 0.35) {
        normalOf(s, hit, side, NRM)
        if (params.light.bounce * Math.max(-NRM[2], 0) >= d.reflectedMin) made('reflected', 0)
      }
    }
  }
  // the highlight dabs of the figures
  for (let m = 0; m < marks.length; m++) {
    const s = plan.surfaces[m]
    const list = byMark.get(m)
    if (!s || !list || plan.veil[m] === 1 || plan.ground[m] === 1) continue
    // (a cell of a few particles' spacing: the nearest particle is in the cell or its neighbours)
    const area = meshArea(marks[m] as MeshMark)
    const cell = Math.max(2 * Math.sqrt(area / list.length), 1e-6)
    const grid = new ParticleGrid(set.position, list, cell)
    for (const k of (s.outsideOnly ? [0] : [0, 1]) as (0 | 1)[]) {
      const side: 1 | -1 = k === 0 ? 1 : -1
      dabStrokes(c, sink, m, k, side, s.outsideOnly ? 0 : side, grid, stats)
    }
  }
  progress?.(1)
  return stats
}
