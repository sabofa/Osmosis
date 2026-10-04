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
// (walk.ts, a fixed direction ±across), so it stops at a border the way a surface stroke does.
//
// THE SIZES are CSS px, never zoomed, in WIDTH and in LENGTH: what the model draws at any zoom is a crisp stroke or a drag as long as its stretch
// (about 20 to 90 px), a pull of about 22 px every ~34 px and a bridge of about 26 px every ~42 px, all of a constant width. A baked path is fixed in the
// world, so the bake keeps the model's sizes on the screen by the way a surface stroke does (SIZING_ALONG and SIZING_ACROSS, basePx = [the model's length, the
// width] in px):
//   the length   a path long enough for BAKE_ZOOM_MIN (a pull is walked ARC_REACH times the model's length; an along stroke's is the whole stretch, which
//                is what the model's stroke is), and a frame draws the sub-arc about the stroke's anchor of the px the model's stroke has, at the zoom and
//                the tilt of the view (frame.ts);
//   the spacing  BAKE_EDGE_REFINE times as many strokes as the model has, on a lattice of cells (a pull every 34 / BAKE_EDGE_REFINE px, a bridge every
//                42 / BAKE_EDGE_REFINE, an along stroke every 1 / BAKE_EDGE_REFINE of its stretch), each with a SPACING RANK that encodes the level of its
//                cell (a bit-reversal order from the stretch's middle), and a frame keeps those whose rank passes the thinning that gives the model's
//                spacing at its zoom: at the authored zoom the cells BAKE_EDGE_REFINE apart, at twice it every fourth, and so on.
// The strokes the model has at the authored zoom (the cells BAKE_EDGE_REFINE apart: the stretch's middle and the ones a model's spacing off it) are
// MEMBERS of the brush-load chain; the others RIDE the load of the member before them (draft.ts ColourRecipes.follow), so the loads along an edge are the
// model's however fine the cells are, and a stroke a zoomed-in view adds takes the colour of the load it lies in.
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
// they are never thinned by the particle rank). The spacing rank (above) thins the strokes of a kept stretch.
//
// WHAT THE PER-FRAME MODEL HAS AND THIS DOES NOT: the silhouette (a view's own outline: the frame's), the ±1 px offset of a crisp stroke (the path IS the
// edge), the pull's 45/55 split about the sample (a pull is centred), the model's `uAmin` (the lowest value on the way in from a silhouette: a crease or
// border here reads the value of its own side at the sample). Its stretches are cut where the AUTHORED view's px put them (segmentRun on the run's
// samples), not where the view in hand would: at another zoom a stretch is as many px longer or shorter as the figure is, and the strokes along it are
// the model's length all the same (the cells above).

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
import { BAKE_EDGE_REFINE, BAKE_PATH_POINTS, BAKE_ZOOM_MIN, HIDDEN_NA, SIZING_ACROSS, SIZING_ALONG } from './types'
import { resampleWalk, snapNear, WALK_STEPS, walkStroke, type Walked, type WalkSide, type WalkSpec } from './walk'

const P3 = 3 * BAKE_PATH_POINTS
// A stretch whose run has fewer samples than this makes no stroke (12 px).
const MIN_STRETCH = 6
// A path shorter than this world length makes no stroke.
const MIN_LENGTH = 1e-12
// How much longer than the model's length a pull or a bridge is walked: long enough for a view zoomed out to BAKE_ZOOM_MIN, and half as long again for the
// foreshortening of a surface tilted from the view (the frame lengthens the sub-arc of a stroke that the tilt shortens on the screen).
const ARC_REACH = 1.5 / BAKE_ZOOM_MIN
// The model's spacing of the pulls of a soft edge and of the bridges of a lost one, px (model/contours.ts edgeStrokes).
const PULL_SPACING_PX = 34
const BRIDGE_SPACING_PX = 42
// The cells of an along stroke: BAKE_EDGE_REFINE of them cover a stretch, the first at its start and the last at its end (so ±BAKE_EDGE_REFINE / 2 about
// the middle's), and the stroke of a cell at an end is half the length, which is what the stretch has left of it.
const ALONG_HALF = BAKE_EDGE_REFINE / 2
// log2(BAKE_EDGE_REFINE): the bits a spacing rank reverses.
const REFINE_BITS = Math.round(Math.log2(BAKE_EDGE_REFINE))

// The spacing rank of the stroke at cell `i` of a stretch (0 is the cell at its middle; cell i is i cells along it), `u` a seeded draw in [0, 1): the
// bit-reversal order of the cell's number's low bits (its two's complement, so that every run of BAKE_EDGE_REFINE cells holds each rank band once, and the
// ranks of a stretch are as uniform as the stretch is long), which makes the cells BAKE_EDGE_REFINE apart come first (rank under 1 / BAKE_EDGE_REFINE: the
// middle's and the ones a multiple of BAKE_EDGE_REFINE from it), then the ones halfway between them, then those between, and so on: a frame that keeps the
// ranks under t has strokes about 1 / t cells apart, evenly spread where t is a power of two of 1 / BAKE_EDGE_REFINE, and at a seeded irregular spacing of
// that mean between. The draw spreads a level's ranks over its band, so that a view zoomed out past the authored one thins the strokes of the first level
// at random.
export function spacingRank(i: number, u: number): number {
  let x = i & (BAKE_EDGE_REFINE - 1)
  let r = 0
  for (let b = 0; b < REFINE_BITS; b++) {
    r = (r << 1) | (x & 1)
    x >>= 1
  }
  // (under 1 in the Float32 that holds it)
  return Math.min((r + u) / BAKE_EDGE_REFINE, 0.9999999)
}

// Is the stroke at cell `i` one the model has at the authored zoom (the cells BAKE_EDGE_REFINE apart, from the middle)? It is a member of the brush-load
// chain; the others ride a load.
export const isModelCell = (i: number): boolean => (i & (BAKE_EDGE_REFINE - 1)) === 0

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
  // The strokes the model has at the authored zoom (the cells that are members of the load chain); the others, which a zoomed-in view adds, ride a load.
  members: number
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

// The arc length along the run's samples a..b (the world length from sample a to each of them), in `cum` (a scratch of the length it needs).
function runArc(run: WorldEdgeRun, a: number, b: number): Float64Array {
  const n = b - a + 1
  const cum = n <= CUM.length ? CUM : new Float64Array(n)
  cum[0] = 0
  const p = run.pts
  for (let j = 1; j < n; j++) cum[j] = cum[j - 1] + Math.hypot(p[3 * (a + j)] - p[3 * (a + j - 1)], p[3 * (a + j) + 1] - p[3 * (a + j - 1) + 1], p[3 * (a + j) + 2] - p[3 * (a + j - 1) + 2])
  return cum
}

// The path of an along-run stroke: samples a..b of the run resampled to BAKE_PATH_POINTS at equal world arc length, every point snapped back onto the
// surface (the first by the BVH, each next from the triangle of the one before), with the side's unit normal there. Written at slot `idx` of the sink;
// returns the path's chord length, or 0 when the stretch has none. `cum` is the run's arc length (runArc).
function alongPath(sink: StrokeSink, idx: number, run: WorldEdgeRun, a: number, b: number, cum: Float64Array, s: RefinedSurface, side: 1 | -1, reach: number): number {
  const n = b - a + 1
  if (n < 2) return 0
  const total = cum[n - 1]
  if (!(total > MIN_LENGTH)) return 0
  const p = run.pts
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

// The order the cells of a stretch are made in, from its middle: 0, 1, -1, 2, -2, ... up to `h`.
function cellOrder(h: number): number[] {
  const out = [0]
  for (let k = 1; k <= h; k++) out.push(k, -k)
  return out
}
const ALONG_CELLS = cellOrder(ALONG_HALF)

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
  const stats: EdgeStrokeStats = { runs: 0, stretches: 0, strokes: 0, byClass: [0, 0, 0, 0], crisp: 0, drags: 0, pulls: 0, bridges: 0, skipped: 0, dropped: 0, members: 0 }
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
      // the stretch's arc length along the run's samples, world and px: the model's stretch is this many px long (the length of a crisp stroke or a drag)
      const cum = runArc(run, a, b)
      const total = cum[b - a]
      const stretchPx = total / perPx

      // one stroke made: its brush, colour and place in the mix, given the path already in the sink at `idx`. `length` is the path's world length,
      // `anchor` the arc-length fraction its cell lies at, `lengthPx` the model's length of the stroke on the screen, `spacing` its rank, and a stroke
      // that is not one of the model's at the authored zoom (`ride`) rides the load of the stroke before it in the chain.
      const finish = (sizing: number, idx: number, kk: number, length: number, anchor: number, lengthPx: number, widthPx: number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined, held: boolean, spacing: number, ride: boolean): void => {
        const load = rp.load * beh.loadMul * (0.9 + 0.2 * rng.next())
        const bristles = Math.max(1, Math.round(rp.bristles * rng.range(0.88, 1.12)))
        const jit0 = rng.gauss()
        const jit1 = rng.gauss()
        let dist = 0
        if (!ride) {
          pathMid(sink, idx, mid3)
          dist = chain.next(mid3[0], mid3[1], mid3[2], lastRun !== runIndex)
          lastRun = runIndex
          stats.members++
        }
        const seed = seedOf(kk)
        sink.set(idx, {
          role: roleIdx, layer, mark: run.mark, particle: NO_PARTICLE, rank, side: bakedSide, sizing, hidden: HIDDEN_NA, handStart: 0,
          pathLength: length, anchor, basePx0: lengthPx, basePx1: widthPx, spacing, alpha, load, impasto: rp.impasto * beh.impastoMul, bristles,
          bristleVar: clamp(rp.bristleVar * beh.bristleVarMul, 0, 1), dry: Math.max(rp.dry * 0.5, beh.dryMin), wet: Math.max(rp.wet * beh.wetMul, beh.wetMin),
          endSoft: beh.endSoft, edge: cl, seed, key: fnvInts(run.mark, runIndex, roleIdx, bakedSide, a, kk),
        })
        sink.setRecipe(idx, {
          draft: colour, ...(held ? { hold: ownHold, fam: FAM_SHADOW, uBound: capU } : {}), mixRole: roleIdx, u: uA, colormapped: false, seed, jit0, jit1,
          cells: null, cell, mx: dist, follow: ride,
        })
        stats.strokes++
        stats.byClass[cl]++
      }

      // the strokes ALONG the stretch (the run's own samples): one for each cell of the stretch, the same path (the whole stretch) with its own anchor.
      // `members` makes the cells the model has (the middle's), else the finer ones.
      let alongFirst = -1
      let alongDead = false
      const along = (members: boolean, widthPx: () => number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined, held: boolean, made: () => void): void => {
        for (const i of ALONG_CELLS) {
          if (isModelCell(i) !== members || alongDead) continue
          const u = rng.next()
          const width = widthPx()
          const idx = sink.alloc()
          let length: number
          if (alongFirst < 0) {
            length = alongPath(sink, idx, run, a, b, cum, s, side, snapReach)
            if (!(length > MIN_LENGTH)) {
              sink.drop()
              stats.dropped++
              alongDead = true
              continue
            }
            alongFirst = idx
          } else {
            sink.worldPath.copyWithin(P3 * idx, P3 * alongFirst, P3 * alongFirst + P3)
            sink.worldNormal.copyWithin(P3 * idx, P3 * alongFirst, P3 * alongFirst + P3)
            length = sink.pathLength[alongFirst]
          }
          finish(SIZING_ALONG, idx, i, length, 0.5 + i / BAKE_EDGE_REFINE, stretchPx, width, colour, alpha, ownHold, held, spacingRank(i, u), !members)
          made()
        }
      }

      // a stroke walked ACROSS the run from sample `ii` along `dir` (the unit tangent-plane direction, from the lighter side into the darker for a
      // pull), `lenPx` long on the screen (the model's length), on the surface: walked ARC_REACH times as long, for a frame draws the sub-arc it needs
      const across = (kk: number, ii: number, dir: V3, lenPx: number, widthPx: number, colour: DraftColour, alpha: number, ownHold: DraftColour | undefined, spacing: number, ride: boolean): boolean => {
        const px = run.pts[3 * ii], py = run.pts[3 * ii + 1], pz = run.pts[3 * ii + 2]
        const nx = run.nrm[3 * ii], ny = run.nrm[3 * ii + 1], nz = run.nrm[3 * ii + 2]
        if (!locate(s, px, py, pz, o * nx, o * ny, o * nz, snapReach, HIT)) {
          stats.dropped++
          return false
        }
        const reach = lenPx * perPx * ARC_REACH
        const spec: WalkSpec = {
          hit: HIT, px, py, pz, nx, ny, nz, dx: dir[0], dy: dir[1], dz: dir[2], mode: 'fixed', fixed: dir, rot: 0,
          length: reach, bend: 0, stopBelow: -1, planeId: -1, castOnly: false,
        }
        let walk: Walked | null = walkStroke(ws, spec)
        // (a walk that left the surface at once is a crease's: each face's half, joined)
        if (walk.n < 3) walk = foldWalk(ws, s, side, HIT, [px, py, pz], dir, reach)
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
        finish(SIZING_ACROSS, idx, kk, meta.length, meta.anchor, lenPx, widthPx, colour, alpha, ownHold, shadowSide, spacing, ride)
        return true
      }
      // the sample's across direction (from side A to side B), turned about the side's normal
      const acrossAt = (ii: number, sign: number, rot: number): V3 => {
        const d: V3 = [sign * run.across[3 * ii], sign * run.across[3 * ii + 1], sign * run.across[3 * ii + 2]]
        return rotateAbout(d, [run.nrm[3 * ii], run.nrm[3 * ii + 1], run.nrm[3 * ii + 2]], rot)
      }
      // the strokes ACROSS the stretch: one for each cell of a lattice a 1 / BAKE_EDGE_REFINE of the model's spacing apart, centred on the stretch (the
      // cell is a sample of the run: the nearest to its place along it). `make` makes one of a cell and says whether it is made.
      const acrossCells = (members: boolean, spacingPx: number, make: (i: number, ii: number, ride: boolean) => boolean): void => {
        const cellW = (spacingPx / BAKE_EDGE_REFINE) * perPx
        const h = Math.floor((0.5 * total) / cellW)
        const n = b - a + 1
        for (const i of cellOrder(h)) {
          if (isModelCell(i) !== members) continue
          const at = 0.5 * total + i * cellW
          let j = 0
          while (j < n - 1 && cum[j + 1] - at < at - cum[j]) j++
          make(i, a + j, !members)
        }
      }

      if (cl >= 2) {
        // distinct: a crisp, loaded stroke along the edge, darker than the darker side
        const uE = Math.min(clamp(uLo - (cl === 3 ? 0.12 : 0.06), 0.1, 0.8), shadowEdge ? capU : 1)
        const colour: DraftColour = { a: sideRecipe(c, means, planeA, run.mark, uE, rng, 0.9), b: null, t: 0 }
        // (a crease’s two faces are alike, and which is A is the run’s direction: a crisp stroke in the shadow family by its value is held to the cap
        // whichever face is A, as it is where A is the face in shadow)
        const held = shadowSide || (run.type === 'crease' && uE <= capU)
        for (const members of [true, false]) {
          along(members, () => rp.width * (cl === 3 ? 0.7 : 0.475) * rng.range(0.88, 1.12), colour, cl === 3 ? 1 : 0.85, undefined, held, () => stats.crisp++)
        }
      } else if (cl === 1) {
        // blended: a wide dragged stroke along the boundary, and short scumbled pulls from the lighter side into the darker
        for (const members of [true, false]) {
          along(members, () => rp.width * 2.6 * rng.range(0.88, 1.12), { a: recA, b: srcB, t: 0.5 }, 0.8, own, shadowSide, () => stats.drags++)
          acrossCells(members, PULL_SPACING_PX, (i, ii, ride) => {
            const u = rng.next()
            const rot = rng.range(-0.35, 0.35)
            const len = rp.length * (22 / 30) * rng.range(0.8, 1.2)
            const width = rp.width * 1.9 * rng.range(0.88, 1.12)
            const made = across(100 + i, ii, acrossAt(ii, lighterIsA ? 1 : -1, rot), len, width, { a: lighter, b: darker, t: 0.3 }, 0.75, own, spacingRank(i, u), ride)
            if (made) stats.pulls++
            return made
          })
        }
      } else {
        // lost: strokes that bridge both sides, carrying one colour into the other
        for (const members of [true, false]) {
          acrossCells(members, BRIDGE_SPACING_PX, (i, ii, ride) => {
            const u = rng.next()
            const len = rp.length * (26 / 30) * rng.range(0.85, 1.15)
            const rot = rng.range(-0.3, 0.3)
            const width = rp.width * 1.8 * rng.range(0.88, 1.12)
            const made = across(100 + i, ii, acrossAt(ii, 1, rot), len, width, { a: recA, b: srcB, t: 0.5 }, 0.6, own, spacingRank(i, u), ride)
            if (made) stats.bridges++
            return made
          })
        }
      }
    }
  })
  return stats
}
