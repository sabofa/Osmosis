// The baked edge strokes (the baked painting, spec §3.6, §3.7 role 7 and §14; plan Task 3b): the painter's brushwork ALONG the world edges (bake/edges.ts
// WorldEdgeRun: the terminator, the cast shadows, the plane boundaries, the creases and the borders), made once, in the world.
//
// The per-frame model (model/contours.ts edgeStrokes) cuts every edge run into stretches (segmentRun: at a change of class, at `maxSamples`, and in
// between where the position hash falls under a threshold, so the cuts stay put as the camera orbits) and paints each stretch by its class:
//
//   firm / hard   a crisp, loaded stroke ALONG the stretch, darker than the darker side (the run's own samples);
//   soft          a wide drag along the stretch carrying one side into the other, and scumbled pulls every ~34 px ACROSS it, from the lighter side into
//                 the darker;
//   lost          bridges every ~42 px across the stretch, carrying one colour into the other.
//
// The bake does the same on the runs, in the world. THE PATHS: an along-run stroke's path is the run's own samples (they lie on the refined surface),
// resampled to BAKE_PATH_POINTS at equal world arc length and snapped back onto the surface; a pull or a bridge is WALKED across the run on the surface
// (walk.ts, a fixed direction ±across), so it stops at a border the way a surface stroke does. THE SIZES are CSS px, never zoomed
// (SIZING_FIXED): lengths and spacings are px × the reference world per px, `basePx` is [the path's length, the width] in px at the reference scale.
// The edge's brush TAPERS (the model's polylinePath taper), the data lines' does not: the frame shapes a stroke by its role.
//
// THE COLOURS are the model's: each side's recipe (the plane's mean colour at the side's value, bare table, or the canvas where nothing lies across a
// border), blended for a drag, a pull or a bridge, held to the shadow family's ceiling where the stretch is the outline of a form in shadow (the
// family hold, draft.ts: `hold` is the figure's own side, so a blend is held to the colour of the side it is on, not to the blend's). The colour is
// the same at every brush-load level: the edge strokes take the SEQUENTIAL mix, in the order they are made here (runs in the order of
// WorldEdges.runs, stretches along each run), a load breaking where the next stroke's middle is over `mix.loadBreakPx` away in the world or where the run
// changes (draft.ts LoadChain).
//
// THE DENSITY. `roles.edge.density` thins the model's stretches by a seeded draw. Every stretch is baked and the draw is each of its strokes' `rank`
// (the same for the whole stretch, in [0, 1)): a frame that wants the slider keeps a stroke when `rank < density` (the strokes have no particle, so
// they are never thinned by the particle rank).
//
// WHAT THE PER-FRAME MODEL HAS AND THIS DOES NOT: the silhouette (a view's own outline: the frame's), the ±1 px offset of a crisp stroke (the path IS the
// edge), the pull's 45/55 split about the sample (a pull is centred), the model's `uAmin` (the lowest value on the way in from a silhouette: a crease or
// border here reads the value of its own side at the sample).

import { randomFor } from '../../../style/random'
import { groundRecipe, segmentRun, sideRecipeOf } from '../model/contours'
import { behaviourOf } from '../model/edges'
import { clamp, rotateAbout, type V3 } from '../model/math'
import type { ColourRecipe, ColourSource, DraftColour } from '../model/recipe'
import { FAM_SHADOW } from '../model/value'
import type { SceneColours } from '../types'
import { fnvInts, layerOfRole, LoadChain, NO_PARTICLE, pathMid, StrokeSink } from './draft'
import { EDGE_STEP_PX, type WorldEdgeRun } from './edges'
import { ROLE_INDEX, walkSideOf, type StrokeCtx } from './strokes'
import { closestOnTriangle, locate, normalOf, pointOf, type RefinedSurface, type SurfacePoint } from './surface'
import { BAKE_PATH_POINTS, HIDDEN_NA, SIZING_FIXED } from './types'
import { resampleWalk, snapNear, WALK_STEPS, walkStroke, type Walked, type WalkSide, type WalkSpec } from './walk'

const P3 = 3 * BAKE_PATH_POINTS
// A stretch whose run has fewer samples than this makes no stroke (12 px).
const MIN_STRETCH = 6
// A path shorter than this world length makes no stroke.
const MIN_LENGTH = 1e-12

export interface EdgeStrokeStats {
  // Runs over the contrast floor, the stretches cut from them, and the strokes made.
  runs: number
  stretches: number
  strokes: number
  // Strokes by the class of their edge (0 lost, 1 soft, 2 firm, 3 hard), and by kind.
  byClass: number[]
  crisp: number
  drags: number
  pulls: number
  bridges: number
  // Stretches too short to paint, and strokes that had nowhere to go (a pull or a bridge whose walk left the surface at once).
  skipped: number
  dropped: number
}

const meanOver = (a: ArrayLike<number>, from: number, to: number): number => {
  let s = 0
  for (let i = from; i <= to; i++) s += a[i]
  return s / (to - from + 1)
}

// The mean local colour (OKLab) of each mark's particles, for a side with no plane (the model's `markColour`); a mark with no particle has its own flat colour.
export function markMeans(c: Pick<StrokeCtx, 'scene' | 'set'>, colours: SceneColours): Float64Array {
  const nMarks = c.scene.marks.length
  const sum = new Float64Array(3 * nMarks)
  const count = new Uint32Array(nMarks)
  const set = c.set
  for (let i = 0; i < set.count; i++) {
    const m = set.mark[i]
    sum[3 * m] += set.colour[3 * i]
    sum[3 * m + 1] += set.colour[3 * i + 1]
    sum[3 * m + 2] += set.colour[3 * i + 2]
    count[m]++
  }
  for (let m = 0; m < nMarks; m++) {
    if (count[m] > 0) for (let k = 0; k < 3; k++) sum[3 * m + k] /= count[m]
    else {
      const own = colours.markColour(m)
      for (let k = 0; k < 3; k++) sum[3 * m + k] = own[k]
    }
  }
  return sum
}

// ---- the colours ----

type Rng = ReturnType<typeof randomFor>

// The recipe of one side of an edge's colour (model/contours.ts sideRecipeOf, the model's own builder): the curve at that side's value over its local colour
// (the plane's mean particle colour, bare table, or the mesh's mean colour where the side has no plane).
function sideRecipe(c: StrokeCtx, means: Float64Array, plane: number, mark: number, u: number, rng: Rng, lScale?: number): ColourRecipe {
  const pl = plane >= 0 ? c.planes.planes[plane] : null
  return sideRecipeOf(pl, pl ? pl.colour : null, c.plan.ground[mark] === 1, [means[3 * mark], means[3 * mark + 1], means[3 * mark + 2]], u, rng, lScale)
}

// ---- the paths ----

const HIT: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
const WHERE = [0, 0, 0]
const NRM = [0, 0, 0]
const CUM = new Float64Array(4096)

// The path of an along-run stroke: samples a..b of the run resampled to BAKE_PATH_POINTS at equal world arc length, every point snapped back onto the
// surface (the first by the BVH, each next from the triangle of the one before), with the side's unit normal there. Written at slot `idx` of the sink;
// returns the path's chord length, or 0 when the stretch has none.
function alongPath(sink: StrokeSink, idx: number, run: WorldEdgeRun, a: number, b: number, s: RefinedSurface, side: 1 | -1, reach: number): number {
  const n = b - a + 1
  if (n < 2) return 0
  const cum = n <= CUM.length ? CUM : new Float64Array(n)
  cum[0] = 0
  const p = run.pts
  for (let j = 1; j < n; j++) cum[j] = cum[j - 1] + Math.hypot(p[3 * (a + j)] - p[3 * (a + j - 1)], p[3 * (a + j) + 1] - p[3 * (a + j - 1) + 1], p[3 * (a + j) + 2] - p[3 * (a + j - 1) + 2])
  const total = cum[n - 1]
  if (!(total > MIN_LENGTH)) return 0
  const o = side * s.orient
  const off = P3 * idx
  let seg = 1
  let hint = -1
  let length = 0
  for (let q = 0; q < BAKE_PATH_POINTS; q++) {
    const at = (q / (BAKE_PATH_POINTS - 1)) * total
    while (seg < n - 1 && cum[seg] < at) seg++
    const span = cum[seg] - cum[seg - 1]
    const f = span > 0 ? clamp((at - cum[seg - 1]) / span, 0, 1) : 0
    const i0 = 3 * (a + seg - 1)
    const i1 = 3 * (a + seg)
    const x = p[i0] + (p[i1] - p[i0]) * f
    const y = p[i0 + 1] + (p[i1 + 1] - p[i0 + 1]) * f
    const z = p[i0 + 2] + (p[i1 + 2] - p[i0 + 2]) * f
    // (the side's normal of the nearer sample stands for the tie-break of a point on a crease)
    const near = f < 0.5 ? a + seg - 1 : a + seg
    const nx = o * run.nrm[3 * near]
    const ny = o * run.nrm[3 * near + 1]
    const nz = o * run.nrm[3 * near + 2]
    if (snapNear(s, hint, x, y, z, nx, ny, nz, reach, HIT)) {
      pointOf(s, HIT, WHERE)
      hint = HIT.tri
      normalOf(s, HIT, side, NRM)
    } else {
      WHERE[0] = x
      WHERE[1] = y
      WHERE[2] = z
      NRM[0] = run.nrm[3 * near]
      NRM[1] = run.nrm[3 * near + 1]
      NRM[2] = run.nrm[3 * near + 2]
    }
    sink.worldPath[off + 3 * q] = WHERE[0]
    sink.worldPath[off + 3 * q + 1] = WHERE[1]
    sink.worldPath[off + 3 * q + 2] = WHERE[2]
    sink.worldNormal[off + 3 * q] = NRM[0]
    sink.worldNormal[off + 3 * q + 1] = NRM[1]
    sink.worldNormal[off + 3 * q + 2] = NRM[2]
    if (q > 0) {
      length += Math.hypot(
        sink.worldPath[off + 3 * q] - sink.worldPath[off + 3 * q - 3],
        sink.worldPath[off + 3 * q + 1] - sink.worldPath[off + 3 * q - 2],
        sink.worldPath[off + 3 * q + 2] - sink.worldPath[off + 3 * q - 1],
      )
    }
  }
  return length
}

// ---- across a crease ----

// A pull or a bridge over a CREASE (two faces meeting at an angle: a flat-shaded box's edge, a plane boundary on one): the bisector's tangent plane,
// which `across` lies in, is on neither face, so a walk straight along it leaves the surface at once. Each half walks on its OWN face, from the crease
// away from it (in the face's plane, at right angles to the crease), and the two are joined at the crease point: the stroke wraps round the edge, from
// the face on the `-dir` side to the one on the `+dir` side. Null where the point is not on an edge shared by two triangles.
const FOLD: Walked = {
  n: 0, start: 0, x: new Float64Array(2 * WALK_STEPS + 1), y: new Float64Array(2 * WALK_STEPS + 1), z: new Float64Array(2 * WALK_STEPS + 1),
  tri: new Int32Array(2 * WALK_STEPS + 1), b1: new Float64Array(2 * WALK_STEPS + 1), b2: new Float64Array(2 * WALK_STEPS + 1), endA: 0, endB: 0,
}
const FACE_HIT: SurfacePoint[] = [{ tri: 0, b1: 0, b2: 0 }, { tri: 0, b1: 0, b2: 0 }]
const CLOSEST = { b1: 0, b2: 0, d2: 0 }
const FACE_N = [0, 0, 0]

function foldWalk(ws: WalkSide, s: RefinedSurface, side: 1 | -1, hit: SurfacePoint, p: V3, dir: V3, length: number): Walked | null {
  const idx = s.indices
  const pos = s.positions
  const t0 = hit.tri
  const w0 = 1 - hit.b1 - hit.b2
  // the edge of the triangle the point is on: the vertex whose weight is the smallest is opposite it (slot 0: v0v1, 1: v1v2, 2: v2v0)
  const least = Math.min(w0, hit.b1, hit.b2)
  if (!(least < 1e-4)) return null
  const e = w0 === least ? 1 : hit.b1 === least ? 2 : 0
  const t1 = s.adj[3 * t0 + e]
  if (t1 < 0) return null
  const va = idx[3 * t0 + e]
  const vb = idx[3 * t0 + ((e + 1) % 3)]
  const ex = pos[3 * vb] - pos[3 * va], ey = pos[3 * vb + 1] - pos[3 * va + 1], ez = pos[3 * vb + 2] - pos[3 * va + 2]
  const el = Math.hypot(ex, ey, ez)
  if (!(el > 1e-12)) return null
  const ux = ex / el, uy = ey / el, uz = ez / el
  // the two faces: this triangle, and the one across the edge (the point on it)
  FACE_HIT[0].tri = t0
  FACE_HIT[0].b1 = hit.b1
  FACE_HIT[0].b2 = hit.b2
  closestOnTriangle(
    p[0], p[1], p[2], pos[3 * idx[3 * t1]], pos[3 * idx[3 * t1] + 1], pos[3 * idx[3 * t1] + 2], pos[3 * idx[3 * t1 + 1]], pos[3 * idx[3 * t1 + 1] + 1], pos[3 * idx[3 * t1 + 1] + 2],
    pos[3 * idx[3 * t1 + 2]], pos[3 * idx[3 * t1 + 2] + 1], pos[3 * idx[3 * t1 + 2] + 2], CLOSEST,
  )
  FACE_HIT[1].tri = t1
  FACE_HIT[1].b1 = CLOSEST.b1
  FACE_HIT[1].b2 = CLOSEST.b2
  // each face's way in: from the edge toward the triangle's third vertex, in its plane, at right angles to the edge
  const way: V3[] = []
  for (let f = 0; f < 2; f++) {
    const t = FACE_HIT[f].tri
    let third = -1
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * t + k]
      if (s.canon[v] !== s.canon[va] && s.canon[v] !== s.canon[vb]) third = v
    }
    if (third < 0) return null
    const vx = pos[3 * third] - p[0], vy = pos[3 * third + 1] - p[1], vz = pos[3 * third + 2] - p[2]
    const k = vx * ux + vy * uy + vz * uz
    const dx = vx - ux * k, dy = vy - uy * k, dz = vz - uz * k
    const dl = Math.hypot(dx, dy, dz)
    if (!(dl > 1e-12)) return null
    way.push([dx / dl, dy / dl, dz / dl])
  }
  // the half on the `-dir` side comes first
  const first = way[0][0] * dir[0] + way[0][1] * dir[1] + way[0][2] * dir[2] <= way[1][0] * dir[0] + way[1][1] * dir[1] + way[1][2] * dir[2] ? 0 : 1
  const halves: { n: number; x: number[]; y: number[]; z: number[]; tri: number[]; b1: number[]; b2: number[] }[] = []
  for (const f of [first, 1 - first]) {
    normalOf(s, FACE_HIT[f], side, FACE_N)
    const spec: WalkSpec = {
      hit: FACE_HIT[f], px: p[0], py: p[1], pz: p[2], nx: FACE_N[0], ny: FACE_N[1], nz: FACE_N[2], dx: way[f][0], dy: way[f][1], dz: way[f][2],
      mode: 'fixed', fixed: way[f], rot: 0, length, bend: 0, stopBelow: -1, planeId: -1, castOnly: false,
    }
    const w = walkStroke(ws, spec)
    // (the forward half only: the backward one runs off the face, beyond the edge)
    const h = { n: 0, x: [] as number[], y: [] as number[], z: [] as number[], tri: [] as number[], b1: [] as number[], b2: [] as number[] }
    for (let k = w.start + 1; k < w.n; k++) {
      h.x.push(w.x[k]); h.y.push(w.y[k]); h.z.push(w.z[k]); h.tri.push(w.tri[k]); h.b1.push(w.b1[k]); h.b2.push(w.b2[k])
    }
    h.n = h.x.length
    halves.push(h)
  }
  // join: the first half reversed, the crease, the second half
  let n = 0
  const put = (x: number, y: number, z: number, tri: number, b1: number, b2: number): void => {
    FOLD.x[n] = x; FOLD.y[n] = y; FOLD.z[n] = z; FOLD.tri[n] = tri; FOLD.b1[n] = b1; FOLD.b2[n] = b2
    n++
  }
  const a = halves[0]
  for (let k = a.n - 1; k >= 0; k--) put(a.x[k], a.y[k], a.z[k], a.tri[k], a.b1[k], a.b2[k])
  FOLD.start = n
  put(p[0], p[1], p[2], FACE_HIT[first].tri, FACE_HIT[first].b1, FACE_HIT[first].b2)
  const b = halves[1]
  for (let k = 0; k < b.n; k++) put(b.x[k], b.y[k], b.z[k], b.tri[k], b.b1[k], b.b2[k])
  FOLD.n = n
  FOLD.endA = 0
  FOLD.endB = 0
  return n >= 3 ? FOLD : null
}

// ---- all of the edge strokes ----

export function buildEdgeStrokes(c: StrokeCtx, sink: StrokeSink, colours: SceneColours): EdgeStrokeStats {
  const { params, plan, edges, perPx } = c
  const rp = params.roles.edge
  const minContrast = params.detect.edgeMinContrast
  const capU = plan.capU
  const floorU = plan.floorU
  // a crisp stroke runs up to three times the role's length; a pull or a bridge is shorter
  const maxSamples = Math.max(12, Math.round((3 * rp.length) / EDGE_STEP_PX))
  const roleIdx = ROLE_INDEX.edge
  const layer = layerOfRole('edge')
  const stats: EdgeStrokeStats = { runs: 0, stretches: 0, strokes: 0, byClass: [0, 0, 0, 0], crisp: 0, drags: 0, pulls: 0, bridges: 0, skipped: 0, dropped: 0 }
  const means = markMeans(c, colours)
  const canvas: ColourSource = [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]]
  const chain = new LoadChain(perPx)
  const mid3 = [0, 0, 0]
  const snapReach = 0.5 * EDGE_STEP_PX * perPx
  let lastRun = -1

  edges.runs.forEach((run, runIndex) => {
    if (run.contrast < minContrast) return
    const s = plan.surfaces[run.mark]
    if (!s) return
    stats.runs++
    const k: 0 | 1 = run.side === -1 ? 1 : 0
    const side: 1 | -1 = run.side === -1 ? -1 : 1
    const bakedSide = run.side
    const o = side * s.orient
    const ws = walkSideOf(c, run.mark, k, side)
    // a stretch is of one family on the figure's side: the cut falls where the outline leaves the shadow family (its own side's value under the cap),
    // so what a stretch is held to, and what it is bridged to, is true of all of it (a crease or border: the model's silhouette contours)
    const sideU = run.kind === 1 ? run.uA : null
    const kinds = sideU ? Uint8Array.from(run.cls, (cl, i) => cl | (sideU[i] <= capU ? 4 : 0)) : run.cls
    const segs = segmentRun(kinds, run.keys, maxSamples)
    for (const [a, b, cl0k] of segs) {
      const cl0 = cl0k & 3
      if (b - a < MIN_STRETCH) {
        stats.skipped++
        continue
      }
      stats.stretches++
      const mid = Math.floor((a + b) / 2)
      let cl = cl0
      const rng = randomFor(`paint/edge/${run.keys[mid]}/${runIndex}`, params.seed)
      // the role's density: the seeded draw is the stretch's rank, and the frame thins by it
      const rank = rng.next()
      const beh = behaviourOf(cl)
      // the two sides' colours, at the values of the stretch this stroke lies on
      const planeA = run.planeA[mid]
      const planeB = run.planeB[mid]
      const uA = meanOver(run.uA, a, b)
      const uB = meanOver(run.uB, a, b)
      // the outline of a form in the SHADOW family: held to its own side's family ceiling (the cap's lightness in the figure's own colour) whatever
      // it is bridged to; against light canvas (the two families meet) a FOUND edge, dark as its own side, never bridged to the canvas (an edge
      // between two planes of the figure that are both in the shadow family is in it too; between a shadow plane and a lit one it is the terminator's own)
      const shadowSide = sideU ? sideU[mid] <= capU : run.kind === 0 && uA <= capU && uB <= capU
      const shadowEdge = shadowSide && run.kind === 1 && run.uB[mid] >= floorU
      if (shadowEdge) cl = Math.max(cl, 2)
      const uLo = Math.min(uA, uB)
      const recA = sideRecipe(c, means, planeA, run.mark, uA, rng)
      // across a border: the canvas where it is light (the values of the lit side and the canvas can match, and then the edge is lost, bridged toward
      // it), or the table in the figure's own cast shadow, as dark as the table is there. Across any other edge: the plane on the other side.
      const srcB: ColourSource =
        run.type !== 'border'
          ? sideRecipe(c, means, planeB, run.mark, uB, rng)
          : uB >= floorU
            ? canvas
            : groundRecipe(uB, rng)
      const lighterIsA = uA >= uB
      const lighter = lighterIsA ? recA : srcB
      const darker = lighterIsA ? srcB : recA
      // the colour of the figure's own side alone: what a bridging stroke of this stretch is held to
      const own: DraftColour = { a: recA, b: null, t: 0 }
      const seedOf = (kk: number): number => ((run.keys[mid] ^ (a * 0x9e3779b1)) ^ Math.imul(kk, 0x85ebca6b)) >>> 0
      const cell = run.keys[mid]

      // one stroke made: its brush, colour and place in the mix, given the path already in the sink at `idx`
      const finish = (idx: number, kk: number, length: number, anchor: number, widthPx: number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined, held: boolean): void => {
        const load = rp.load * beh.loadMul * (0.9 + 0.2 * rng.next())
        const bristles = Math.max(1, Math.round(rp.bristles * rng.range(0.88, 1.12)))
        const jit0 = rng.gauss()
        const jit1 = rng.gauss()
        pathMid(sink, idx, mid3)
        const dist = chain.next(mid3[0], mid3[1], mid3[2], lastRun !== runIndex)
        lastRun = runIndex
        const seed = seedOf(kk)
        sink.set(idx, {
          role: roleIdx, layer, mark: run.mark, particle: NO_PARTICLE, rank, side: bakedSide, sizing: SIZING_FIXED, hidden: HIDDEN_NA, handStart: 0,
          pathLength: length, anchor, basePx0: length / perPx, basePx1: widthPx, alpha, load, impasto: rp.impasto * beh.impastoMul, bristles,
          bristleVar: clamp(rp.bristleVar * beh.bristleVarMul, 0, 1), dry: Math.max(rp.dry * 0.5, beh.dryMin), wet: Math.max(rp.wet * beh.wetMul, beh.wetMin),
          endSoft: beh.endSoft, edge: cl, seed, key: fnvInts(run.mark, runIndex, roleIdx, bakedSide, a * 16 + kk),
        })
        sink.setRecipe(idx, {
          draft: colour, ...(held ? { hold: ownHold, fam: FAM_SHADOW, uBound: capU } : {}), mixRole: roleIdx, u: uA, colormapped: false, seed, jit0, jit1,
          cells: null, cell, mx: dist,
        })
        stats.strokes++
        stats.byClass[cl]++
      }

      // a stroke ALONG the stretch (the run's own samples)
      const along = (kk: number, widthPx: number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined, held = shadowSide): boolean => {
        const idx = sink.alloc()
        const length = alongPath(sink, idx, run, a, b, s, side, snapReach)
        if (!(length > MIN_LENGTH)) {
          sink.drop()
          stats.dropped++
          return false
        }
        finish(idx, kk, length, 0.5, widthPx, colour, alpha, ownHold, held)
        return true
      }

      // a stroke walked ACROSS the run from sample `ii` along `dir` (the unit tangent-plane direction, from the lighter side into the darker for a
      // pull), `lenPx` long, on the surface
      const across = (kk: number, ii: number, dir: V3, lenPx: number, widthPx: number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined): boolean => {
        const px = run.pts[3 * ii], py = run.pts[3 * ii + 1], pz = run.pts[3 * ii + 2]
        const nx = run.nrm[3 * ii], ny = run.nrm[3 * ii + 1], nz = run.nrm[3 * ii + 2]
        if (!locate(s, px, py, pz, o * nx, o * ny, o * nz, snapReach, HIT)) {
          stats.dropped++
          return false
        }
        const spec: WalkSpec = {
          hit: HIT, px, py, pz, nx, ny, nz, dx: dir[0], dy: dir[1], dz: dir[2], mode: 'fixed', fixed: dir, rot: 0,
          length: lenPx * perPx, bend: 0, stopBelow: -1, planeId: -1, castOnly: false,
        }
        let walk: Walked | null = walkStroke(ws, spec)
        // (a walk that left the surface at once is a crease's: each face's half, joined)
        if (walk.n < 3) walk = foldWalk(ws, s, side, HIT, [px, py, pz], dir, lenPx * perPx)
        if (!walk) {
          stats.dropped++
          return false
        }
        const idx = sink.alloc()
        const meta = resampleWalk(ws, walk, false, sink.worldPath, sink.worldNormal, P3 * idx)
        if (!meta || !(meta.length > MIN_LENGTH)) {
          sink.drop()
          stats.dropped++
          return false
        }
        finish(idx, kk, meta.length, meta.anchor, widthPx, colour, alpha, ownHold, shadowSide)
        return true
      }
      // the sample's across direction (from side A to side B), turned about the side's normal
      const acrossAt = (ii: number, sign: number, rot: number): V3 => {
        const d: V3 = [sign * run.across[3 * ii], sign * run.across[3 * ii + 1], sign * run.across[3 * ii + 2]]
        return rotateAbout(d, [run.nrm[3 * ii], run.nrm[3 * ii + 1], run.nrm[3 * ii + 2]], rot)
      }

      if (cl >= 2) {
        // distinct: a crisp, loaded stroke along the edge, darker than the darker side
        const uE = Math.min(clamp(uLo - (cl === 3 ? 0.12 : 0.06), 0.1, 0.8), shadowEdge ? capU : 1)
        const colour: DraftColour = { a: sideRecipe(c, means, planeA, run.mark, uE, rng, 0.9), b: null, t: 0 }
        const width = rp.width * (cl === 3 ? 0.7 : 0.475) * rng.range(0.88, 1.12)
        // (a crease’s two faces are alike, and which is A is the run’s direction: a crisp stroke in the shadow family by its value is held to the cap
        // whichever face is A, as it is where A is the face in shadow)
        const held = shadowSide || (run.type === 'crease' && uE <= capU)
        if (along(0, width, colour, cl === 3 ? 1 : 0.85, undefined, held)) stats.crisp++
      } else if (cl === 1) {
        // blended: a wide dragged stroke along the boundary, and short scumbled pulls from the lighter side into the darker
        if (along(0, rp.width * 2.6 * rng.range(0.88, 1.12), { a: recA, b: srcB, t: 0.5 }, 0.8, own)) stats.drags++
        const nd = Math.max(1, Math.round(((b - a) * EDGE_STEP_PX) / 34))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          const rot = rng.range(-0.35, 0.35)
          const len = rp.length * (22 / 30) * rng.range(0.8, 1.2)
          const width = rp.width * 1.9 * rng.range(0.88, 1.12)
          if (across(1 + d, ii, acrossAt(ii, lighterIsA ? 1 : -1, rot), len, width, { a: lighter, b: darker, t: 0.3 }, 0.75, own)) stats.pulls++
        }
      } else {
        // lost: a few strokes that bridge both sides, carrying one colour into the other
        const nd = Math.max(1, Math.round(((b - a) * EDGE_STEP_PX) / 42))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          const len = rp.length * (26 / 30) * rng.range(0.85, 1.15)
          const rot = rng.range(-0.3, 0.3)
          const width = rp.width * 1.8 * rng.range(0.88, 1.12)
          if (across(1 + d, ii, acrossAt(ii, 1, rot), len, width, { a: recA, b: srcB, t: 0.5 }, 0.6, own)) stats.bridges++
        }
      }
    }
  })
  return stats
}
