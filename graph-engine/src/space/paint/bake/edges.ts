// The world edges (the baked painting, spec §3.6 and §14; plan Task 2): the painter's edge decision at every transition
// between planes, at a form's creases and borders, and at a shadow's edge, made on the meshes in the world, once.
//
// The per-frame model (model/edges.ts extractEdges, model/contours.ts contourRuns) finds the edges in the picture: contours of
// each plane's mask on the G-buffer, the meshes' own lines clipped by it. The bake finds them on the refined surfaces
// (bake/surface.ts), so an edge is where it is on the surface whatever the view:
//
//   TERMINATOR AND CAST BOUNDARY ON A FIGURE. The iso line 0.5, per side, of the plan's own light-family weight (familyField:
//   lw = vis·lightWeight(ts, N·L, false) + (1 - vis)·lightWeight(ts, N·L, true), whose 0.5 is the plan's family boundary wherever
//   the shadow flag is settled), by marching triangles on the refined surface: where the surface turns from the light, and where
//   another form's shadow takes the light family's weight under a half, a lit strip between the two included. A stretch of it is
//   the TERMINATOR's where the turn from the light changes the weight more across its triangles than the shadow's vote does, else
//   a cast shadow's ('shadow', kind 0: an internal edge, as in the model).
//   TABLE CAST BOUNDARY. The iso line 0.5 of `vis` on a ground: 'shadow', kind 2.
//   PLANE BOUNDARIES. The chains of shared triangle edges between two planes of the same mesh and side and of the same
//   FAMILY (planes.ts): between families the iso lines above are the edge, so a plane chain never doubles one. Smoothed by two
//   Chaikin passes. 'plane', kind 0. (A ground's bands are not edges, as in the model.)
//   CREASES AND BORDERS. `staticLines(mesh)` (contours.ts), which is why the scene is an argument (the refined surface no longer
//   has the source mesh): the border of an open mesh and the creases over 50 degrees, cut at their sharp corners (a turn over 35
//   degrees, as the model's splitAtCorners), told apart by whether a sample is on a border edge of the refined surface. One run per
//   side of an open mesh. 'crease' and 'border', kind 1 (the model types these contour runs silhouette). A veil has none, as in the model.
//
// Every run is a polyline of samples ON the surface, every EDGE_STEP_PX × the reference world per px (a closed run, such as the
// terminator of a sphere, has equal spacing all round and its last sample one step before its first), with at each sample the
// side's normal (at a flat-shaded crease the bisector of the two faces') and `across`, the unit direction in the tangent plane from
// side A to side B. A is on the left of the run's direction of travel seen from the side's normal and B on the right: the runs are
// turned so that A is the light side of a terminator and a cast shadow's edge, the lower-numbered plane of a plane boundary, and the
// surface of a border or crease.
//
// THE SIDES' VALUES. By default (WorldEdgeOptions.sideValues 'planes') uA and uB of an edge between planes are the planes' mean values,
// as the model's (a stroke steps to its plane's value, so the step between planes is the contrast the picture shows); the plan's
// value at a probe PROBE_PX × the reference world per px either side of the sample along `across` (`locate` on the same surface)
// stands where a side has no plane, and always for a crease or border. A probe that lands past a border, or that does not leave
// the sample (the nearest point is the border itself), is no probe: the sample's own value stands for that side, and the sample is
// FLAGGED, which keeps it out of the run's contrast. Beyond a BORDER there is no surface at all: that side is the canvas (the
// model's own reading where nothing lies across an outline). Normals for the curvature term are read at the probes.
//
// HARDNESS per sample is the model's: edgeHardness(kind) of the terms c (value contrast), k (curvature), f (focal emphasis: exp(-(d/R)²)
// about the two focal points of the figure, below), s (light side) and, for a table's cast edge, x (the distance from the occluder, in px
// at the reference scale), plus the seeded noise, times the terminator's softness scale, lost where the contrast is under 0.03; for a crease
// or border, raised to a found edge where the outline of a form in shadow meets light (the model's floor); then the class and the median
// of 7. The depth term d (edges.wDepth: nearer is harder) is measured from the AUTHORED eye, as the focal points are (the bake composes for
// the authored framing, and the slider stays meaningful): fixed in the world, so it does not move as the camera orbits. WorldEdgeOptions.authoredDepth
// = false takes it out (d = 0).
//
// THE FOCAL POINTS are the per-frame model's two (findFocal), taken from the AUTHORED framing (the view the picture is composed for, the
// buildWorldEdges `authored` argument) and then fixed in the world: the terminator nearest the authored eye and the brightest highlight,
// so the terminator is firmest where the authored view looks at it and stays so as the camera orbits (focalPoints).
//
// THE EDGE FIELD. For each vertex of each side: the world distance to the nearest edge sample of a run whose contrast reaches
// detect.edgeMinContrast within detect.edgeReachPx × the reference world per px, and that sample's hardness and class
// (Infinity and 255 beyond). A multi-source Dijkstra over the surface's edge graph, seeded at the three vertices of each
// sample's triangle at their exact distance. strokeEdgeClass's world twin reads it: `edgeClassAlong`.

import { staticLines } from '../model/contours'
import { edgeClassOf, edgeHardness, edgeNoiseSeed, EDGE_NOISE_FREQ, isTerminatorPair, smoothClasses, terminatorEdgeScale, type EdgeType } from '../model/edges'
import { clamp, hash3, smooth, valueNoise3 } from '../model/math'
import { lightWeight, Z_CAST } from '../model/value'
import type { SpaceScene, MeshMark } from '../../scene/types'
import type { PaintParams } from '../params'
import type { AuthoredFraming } from './types'
import { newPlanAt, planAt, type SidePlan, type WorldPlan } from './plan'
import type { WorldPlanes } from './planes'
import { locate, normalOf, pointOf, type RefinedSurface, type SurfacePoint } from './surface'

// Samples along an edge every this many CSS px (as the model); a run needs at least EDGE_MIN_SAMPLES (16 px).
export const EDGE_STEP_PX = 2
export const EDGE_MIN_SAMPLES = 8
// How far either side of an edge the sides' values and normals are read, CSS px.
export const PROBE_PX = 3
// Chaikin corner-cutting passes on a plane boundary.
export const CHAIKIN_PASSES = 2

export type WorldEdgeType = 'terminator' | 'shadow' | 'plane' | 'crease' | 'border'

export interface WorldEdgeRun {
  type: WorldEdgeType
  mark: number
  // +1 or -1: the side of an open mesh the run is on; 0 on a closed opaque mesh (its outside).
  side: 1 | -1 | 0
  // Index into the edge weight arrays (edges.wContrast ...): 0 internal, 1 silhouette, 2 shadow.
  kind: 0 | 1 | 2
  // The run closes on itself (the last sample is one step before the first).
  closed: boolean
  // 3 per sample, world, on the surface.
  pts: Float64Array
  // 3 per sample: the side's unit normal.
  nrm: Float32Array
  // 3 per sample: the unit tangent-plane direction from side A to side B.
  across: Float32Array
  // A hash of the position, per sample (as the model's edge keys).
  keys: Uint32Array
  // The plane each side (-1 none: past a border, or a probe that found no surface).
  planeA: Int32Array
  planeB: Int32Array
  // The value each side: the mean value of the plane there (an edge between planes), else the plan's value at the probe (WorldEdgeOptions).
  uA: Float32Array
  uB: Float32Array
  // Hardness 0..1 and its median-smoothed class (an index into EDGE_CLASSES).
  h: Float32Array
  cls: Uint8Array
  // The mean |uA - uB| over the samples that have both sides (a flagged sample is left out).
  contrast: number
}

export interface WorldEdges {
  runs: WorldEdgeRun[]
  // The mean hardness of the samples between planes a and b (the runs that are between planes: a crease or border line is not one: the plane
  // boundary of the same place is); 0 where they do not meet.
  adjHard(a: number, b: number): number
  // The edge field per refined vertex per side ([mark][side index 0 = +1, 1 = -1]; a closed opaque mesh has index 0 only, and a mark
  // that is not an opaque mesh has none).
  field: { dist: Float32Array; hard: Float32Array; cls: Uint8Array }[][]
  // The focal points of each mark, as BakedPainting.focal: 2 per mark (x, y, z, R world each: 8 per mark), the terminator nearest the
  // authored eye then the brightest, NaN where a mark has fewer (a ground, a veil and a non-mesh have none).
  focal: Float64Array
  // The reach of the field, world units (detect.edgeReachPx × the reference world per px), and the params the bake was made with
  // (the class thresholds and the interior hardness fallback read them).
  reach: number
  params: PaintParams
}

export interface WorldEdgeOptions {
  // How the two sides' plan values of an edge between planes (kinds 0 and 2: a terminator, a cast boundary, a plane boundary) are read.
  //   'planes' (the default): the mean value of the plane on each side, as the model's (edges.ts buildEdgeRun: uA0, uB0 are the planes'
  //     means); the probe's plan value only where a side has no plane. A plane is what the stroke steps to (stepValueWorld), so the
  //     step between planes is the contrast the picture shows.
  //   'probes': the plan's own value at the probe PROBE_PX either side of the sample. A smooth ramp barely changes over 6 px, so a plane
  //     boundary inside a family has almost no contrast and the terminator, a 15 px edge at the default softness, a third of its step.
  // A crease or border (kind 1) always reads its probes (the model's contours read the pixels' own values).
  sideValues?: 'planes' | 'probes'
  // The model's depth term (edges.wDepth: nearer is harder) measured from the AUTHORED eye, fixed in the world: d = 1 - smooth(0, 1, (depth - zN) / zR),
  // depth along the authored view direction, zN and zR the near end and the span of the depth of what the authored view sees of the figures (and of
  // the cast shadows on the ground), as the per-frame model's. ON by default (ruled 2026-10-03: the bake composes for the authored framing, so the
  // depth term belongs there as the focal points do, and the edges.wDepth slider stays meaningful): the terminator is harder where it is nearer the
  // authored eye. `false` takes it out (d = 0).
  authoredDepth?: boolean
}

const EDGE_RADIX = 67_108_864 // 2^26, as surface.ts: canonical ids pair into a number exactly

export interface Chain {
  nodes: number[]
  // segs[j] is the segment between nodes[j] and nodes[j + 1] (and, on a closed chain, the last between the last node and the first).
  segs: number[]
  closed: boolean
}

// Chain segments (pairs of node ids) into polylines, closed where they close. Deterministic: from the first unused segment, forward then back.
export function chainSegments(nNodes: number, sa: ArrayLike<number>, sb: ArrayLike<number>): Chain[] {
  const nSeg = sa.length
  const start = new Int32Array(nNodes + 1)
  for (let j = 0; j < nSeg; j++) {
    start[sa[j] + 1]++
    start[sb[j] + 1]++
  }
  for (let i = 0; i < nNodes; i++) start[i + 1] += start[i]
  const fill = start.slice(0, nNodes)
  const inc = new Int32Array(2 * nSeg)
  for (let j = 0; j < nSeg; j++) {
    inc[fill[sa[j]]++] = j
    inc[fill[sb[j]]++] = j
  }
  const used = new Uint8Array(nSeg)
  const ptr = start.slice(0, nNodes)
  const nextUnused = (node: number): number => {
    while (ptr[node] < start[node + 1]) {
      const j = inc[ptr[node]]
      if (!used[j]) return j
      ptr[node]++
    }
    return -1
  }
  const chains: Chain[] = []
  for (let j0 = 0; j0 < nSeg; j0++) {
    if (used[j0]) continue
    used[j0] = 1
    // forward from the segment's second node, then back from its first (the back half is built in the order met and joined reversed: an
    // unshift per node would make a long chain quadratic)
    const fwdNodes = [sa[j0], sb[j0]]
    const fwdSegs = [j0]
    for (;;) {
      const end = fwdNodes[fwdNodes.length - 1]
      const j = nextUnused(end)
      if (j < 0) break
      used[j] = 1
      fwdNodes.push(sa[j] === end ? sb[j] : sa[j])
      fwdSegs.push(j)
    }
    const backNodes: number[] = []
    const backSegs: number[] = []
    for (;;) {
      const end = backNodes.length > 0 ? backNodes[backNodes.length - 1] : fwdNodes[0]
      const j = nextUnused(end)
      if (j < 0) break
      used[j] = 1
      backNodes.push(sa[j] === end ? sb[j] : sa[j])
      backSegs.push(j)
    }
    const nodes = backNodes.length > 0 ? backNodes.reverse().concat(fwdNodes) : fwdNodes
    const segs = backSegs.length > 0 ? backSegs.reverse().concat(fwdSegs) : fwdSegs
    const closed = nodes.length > 2 && nodes[0] === nodes[nodes.length - 1]
    if (closed) nodes.pop()
    chains.push({ nodes, segs, closed })
  }
  return chains
}

// Two Chaikin corner-cutting passes (the ends of an open polyline stay).
function chaikin(P: Float64Array, closed: boolean, passes: number): Float64Array {
  let cur = P
  for (let pass = 0; pass < passes; pass++) {
    const m = cur.length / 3
    if (m < 3) return cur
    const out: number[] = []
    const cut = (i: number, j: number, first: boolean, last: boolean): void => {
      if (!first) out.push(0.75 * cur[3 * i] + 0.25 * cur[3 * j], 0.75 * cur[3 * i + 1] + 0.25 * cur[3 * j + 1], 0.75 * cur[3 * i + 2] + 0.25 * cur[3 * j + 2])
      if (!last) out.push(0.25 * cur[3 * i] + 0.75 * cur[3 * j], 0.25 * cur[3 * i + 1] + 0.75 * cur[3 * j + 1], 0.25 * cur[3 * i + 2] + 0.75 * cur[3 * j + 2])
    }
    if (closed) {
      for (let i = 0; i < m; i++) cut(i, (i + 1) % m, false, false)
    } else {
      out.push(cur[0], cur[1], cur[2])
      for (let i = 0; i < m - 1; i++) cut(i, i + 1, i === 0, i === m - 2)
      out.push(cur[3 * (m - 1)], cur[3 * (m - 1) + 1], cur[3 * (m - 1) + 2])
    }
    cur = Float64Array.from(out)
  }
  return cur
}

// A polyline resampled at equal arc length: the samples' positions and, for each, the polyline segment it lies on. An open one starts at
// its first point and ends on its last when that is far enough from the previous sample; a closed one has equal spacing all round
// (the last sample is one step before the first).
function resamplePolyline(P: Float64Array, closed: boolean, step: number, xyz: number[], seg: number[]): void {
  const m = P.length / 3
  const ns = closed ? m : m - 1
  if (ns < 1) {
    xyz.push(P[0], P[1], P[2])
    seg.push(0)
    return
  }
  const lens = new Float64Array(ns)
  let total = 0
  for (let j = 0; j < ns; j++) {
    const k = (j + 1) % m
    lens[j] = Math.hypot(P[3 * k] - P[3 * j], P[3 * k + 1] - P[3 * j + 1], P[3 * k + 2] - P[3 * j + 2])
    total += lens[j]
  }
  if (!(total > 1e-12)) {
    xyz.push(P[0], P[1], P[2])
    seg.push(0)
    return
  }
  const at: number[] = []
  if (closed) {
    const n = Math.max(1, Math.round(total / step))
    for (let k = 0; k < n; k++) at.push((k * total) / n)
  } else {
    let s = 0
    while (s <= total + 1e-12) {
      at.push(s)
      s += step
    }
    if (total - at[at.length - 1] > 0.3 * step) at.push(total)
  }
  let j = 0
  let cum = 0
  for (const s of at) {
    while (j < ns - 1 && cum + lens[j] < s) {
      cum += lens[j]
      j++
    }
    const t = lens[j] > 0 ? clamp((s - cum) / lens[j], 0, 1) : 0
    const k = (j + 1) % m
    xyz.push(P[3 * j] + t * (P[3 * k] - P[3 * j]), P[3 * j + 1] + t * (P[3 * k + 1] - P[3 * j + 1]), P[3 * j + 2] + t * (P[3 * k + 2] - P[3 * j + 2]))
    seg.push(j)
  }
}

// ---- the samples of one run ----

// A chain's samples, located on the surface. `ok` is 0 where a sample was not found on it (it is then a gap in the run).
interface Geom {
  n: number
  closed: boolean
  xyz: Float64Array
  tri: Int32Array
  b1: Float64Array
  b2: Float64Array
  ok: Uint8Array
  // Per-sample attributes the chain's source gave (the iso segments' turn and shadow changes; a static line's border flag).
  a0: Float32Array
  a1: Float32Array
}

function newGeom(n: number, closed: boolean): Geom {
  return {
    n, closed, xyz: new Float64Array(3 * n), tri: new Int32Array(n), b1: new Float64Array(n), b2: new Float64Array(n), ok: new Uint8Array(n),
    a0: new Float32Array(n), a1: new Float32Array(n),
  }
}

// The samples at `idx` (in order) of g, as a geometry of their own.
function sliceGeom(g: Geom, idx: number[], closed: boolean): Geom {
  const out = newGeom(idx.length, closed)
  idx.forEach((i, k) => {
    out.xyz[3 * k] = g.xyz[3 * i]
    out.xyz[3 * k + 1] = g.xyz[3 * i + 1]
    out.xyz[3 * k + 2] = g.xyz[3 * i + 2]
    out.tri[k] = g.tri[i]
    out.b1[k] = g.b1[i]
    out.b2[k] = g.b2[i]
    out.ok[k] = g.ok[i]
    out.a0[k] = g.a0[i]
    out.a1[k] = g.a1[i]
  })
  return out
}

function reverseGeom(g: Geom): void {
  const n = g.n
  for (let i = 0; i < n >> 1; i++) {
    const j = n - 1 - i
    for (let k = 0; k < 3; k++) {
      const t = g.xyz[3 * i + k]
      g.xyz[3 * i + k] = g.xyz[3 * j + k]
      g.xyz[3 * j + k] = t
    }
    for (const a of [g.tri, g.ok] as (Int32Array | Uint8Array)[]) {
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    for (const a of [g.b1, g.b2] as Float64Array[]) {
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    for (const a of [g.a0, g.a1] as Float32Array[]) {
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
  }
}

// Maximal stretches of consecutive samples with the same non-negative label (labels below 0 are gaps). A closed geometry whose
// samples are all one label and all found is one closed stretch; otherwise it is cut where the label changes, the stretch that
// runs across the start joined.
function stretches(n: number, closed: boolean, label: Int32Array): { idx: number[]; closed: boolean }[] {
  if (n === 0) return []
  if (closed) {
    let uniform = label[0] >= 0
    for (let i = 1; i < n && uniform; i++) if (label[i] !== label[0]) uniform = false
    if (uniform) return [{ idx: Array.from({ length: n }, (_, i) => i), closed: true }]
    // start at a change of label
    let s = 0
    for (let i = 0; i < n; i++) {
      if (label[i] !== label[(i + n - 1) % n]) {
        s = i
        break
      }
    }
    return linear(n, label, s)
  }
  return linear(n, label, 0)
}

function linear(n: number, label: Int32Array, s0: number): { idx: number[]; closed: boolean }[] {
  const out: { idx: number[]; closed: boolean }[] = []
  let cur: number[] = []
  let curLabel = -1
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n
    const l = label[i]
    if (l < 0 || l !== curLabel) {
      if (cur.length > 0) out.push({ idx: cur, closed: false })
      cur = []
      curLabel = l
    }
    if (l >= 0) cur.push(i)
  }
  if (cur.length > 0) out.push({ idx: cur, closed: false })
  return out
}

// ---- the context ----

interface SideCtx {
  mark: number
  s: RefinedSurface
  // The side's plan and the side whose normal and plan are read (+1 for a closed opaque mesh).
  sp: SidePlan
  side: 1 | -1
  index: 0 | 1
  // The plane of every triangle on this side.
  pl: Int32Array | null
  ground: boolean
  runSide: 1 | -1 | 0
}

interface Ctx {
  plan: WorldPlan
  planes: WorldPlanes
  params: PaintParams
  perPx: number
  step: number
  delta: number
  snap: number
  noiseSeed: number
  focal: Float64Array
  nMarks: number
  sideValues: 'planes' | 'probes'
  // The authored view's depth range (null where options.authoredDepth is false): the eye, the unit view direction, the nearest depth and the span.
  depth: { eye: number[]; dir: number[]; zN: number; zR: number } | null
}

const KIND_TYPE: EdgeType[] = ['internal', 'silhouette', 'shadow']

// ---- focal points ----

// The two places a painter would make an edge firm, found as the per-frame model finds them (model/edges.ts findFocal) but for the
// AUTHORED framing (the view the picture is composed for) and fixed in the world: per figure mark, over the vertices of both its sides
// (an open mesh is seen from either), with the side's normal n and the key light's share at the vertex `key` (0 in shadow):
//   nz = n·toEye, counted only where it is over 0 (the authored view sees the vertex from this side); toEye is the direction to the eye
//   (the unit direction -viewDir for an orthographic view)
//   s1 = nz · smooth(0.1, 0.26, key) · (1 - smooth(0.3, 0.5, key))   the terminator nearest the authored eye
//   s2 = key + 0.1 · nz                                               the brightest highlight
// each point the argmax of its score, the first met winning a tie (the model's strict >), and none where the best score is 0 (the model
// would take the first pixel of the picture there). R = 0.55·√(A/π) with A the mark's area as the authored view sees it:
// Σ area·(n·toEye) over the triangles of both sides with n·toEye over 0, the model's visible projected area, so a sphere's R is 0.55 r.
// 8 numbers per mark (BakedPainting.focal): the s1 point (x, y, z, R), the s2 point; NaN where there is none (a ground, a veil, a non-mesh).
function focalPoints(plan: WorldPlan, authored: AuthoredFraming): Float64Array {
  const nMarks = plan.surfaces.length
  const out = new Float64Array(8 * nMarks).fill(Number.NaN)
  const vd = authored.viewDir
  const vl = Math.hypot(vd[0], vd[1], vd[2]) || 1
  const back = [-vd[0] / vl, -vd[1] / vl, -vd[2] / vl]
  const toEye = [0, 0, 0]
  const eyeOf = (x: number, y: number, z: number): void => {
    if (authored.ortho) {
      toEye[0] = back[0]
      toEye[1] = back[1]
      toEye[2] = back[2]
      return
    }
    const dx = authored.eye[0] - x
    const dy = authored.eye[1] - y
    const dz = authored.eye[2] - z
    const l = Math.hypot(dx, dy, dz) || 1
    toEye[0] = dx / l
    toEye[1] = dy / l
    toEye[2] = dz / l
  }
  for (let m = 0; m < nMarks; m++) {
    const s = plan.surfaces[m]
    if (!s || plan.veil[m] === 1 || plan.ground[m] === 1) continue
    const nv = s.positions.length / 3
    let b1 = 0
    let b2 = 0
    let v1 = -1
    let v2 = -1
    let area = 0
    ;[plan.front[m], plan.back[m]].forEach((sp, k) => {
      if (!sp) return
      const o = (k === 0 ? 1 : -1) * s.orient
      const p = s.positions
      const nor = s.normals
      for (let v = 0; v < nv; v++) {
        eyeOf(p[3 * v], p[3 * v + 1], p[3 * v + 2])
        const nz = o * (nor[3 * v] * toEye[0] + nor[3 * v + 1] * toEye[1] + nor[3 * v + 2] * toEye[2])
        if (!(nz > 0)) continue
        const key = sp.key[v]
        const s1 = nz * smooth(0.1, 0.26, key) * (1 - smooth(0.3, 0.5, key))
        const s2 = key + 0.1 * nz
        if (s1 > b1) {
          b1 = s1
          v1 = v
        }
        if (s2 > b2) {
          b2 = s2
          v2 = v
        }
      }
      // the area the authored view sees of this side
      for (let t = 0; t < s.indices.length / 3; t++) {
        const a = s.indices[3 * t]
        const b = s.indices[3 * t + 1]
        const cc = s.indices[3 * t + 2]
        eyeOf((p[3 * a] + p[3 * b] + p[3 * cc]) / 3, (p[3 * a + 1] + p[3 * b + 1] + p[3 * cc + 1]) / 3, (p[3 * a + 2] + p[3 * b + 2] + p[3 * cc + 2]) / 3)
        const nx = nor[3 * a] + nor[3 * b] + nor[3 * cc]
        const ny = nor[3 * a + 1] + nor[3 * b + 1] + nor[3 * cc + 1]
        const nzz = nor[3 * a + 2] + nor[3 * b + 2] + nor[3 * cc + 2]
        const l = Math.hypot(nx, ny, nzz)
        if (!(l > 1e-12)) continue
        const d = (o * (nx * toEye[0] + ny * toEye[1] + nzz * toEye[2])) / l
        if (d > 0) area += s.area[t] * d
      }
    })
    const R = 0.55 * Math.sqrt(area / Math.PI)
    ;[v1, v2].forEach((v, k) => {
      if (v < 0 || !(R > 0)) return
      out[8 * m + 4 * k] = s.positions[3 * v]
      out[8 * m + 4 * k + 1] = s.positions[3 * v + 1]
      out[8 * m + 4 * k + 2] = s.positions[3 * v + 2]
      out[8 * m + 4 * k + 3] = R
    })
  }
  return out
}

// The depth range the authored view sees (the model's zN, zR over what is painted: the figures, and the cast shadows on a ground), along its direction.
function authoredDepthRange(plan: WorldPlan, authored: AuthoredFraming): { eye: number[]; dir: number[]; zN: number; zR: number } {
  const vl = Math.hypot(authored.viewDir[0], authored.viewDir[1], authored.viewDir[2]) || 1
  const dir = [authored.viewDir[0] / vl, authored.viewDir[1] / vl, authored.viewDir[2] / vl]
  const eye = [authored.eye[0], authored.eye[1], authored.eye[2]]
  let zN = Infinity
  let zF = -Infinity
  plan.surfaces.forEach((s, m) => {
    if (!s || plan.veil[m] === 1) return
    const ground = plan.ground[m] === 1
    ;[plan.front[m], plan.back[m]].forEach((sp, k) => {
      if (!sp) return
      const o = (k === 0 ? 1 : -1) * s.orient
      for (let v = 0; v < s.positions.length / 3; v++) {
        if (ground && sp.zone[v] !== Z_CAST) continue
        const x = s.positions[3 * v]
        const y = s.positions[3 * v + 1]
        const z = s.positions[3 * v + 2]
        let tx = -dir[0]
        let ty = -dir[1]
        let tz = -dir[2]
        if (!authored.ortho) {
          tx = eye[0] - x
          ty = eye[1] - y
          tz = eye[2] - z
          const l = Math.hypot(tx, ty, tz) || 1
          tx /= l
          ty /= l
          tz /= l
        }
        if (!(o * (s.normals[3 * v] * tx + s.normals[3 * v + 1] * ty + s.normals[3 * v + 2] * tz) > 0)) continue
        const depth = (x - eye[0]) * dir[0] + (y - eye[1]) * dir[1] + (z - eye[2]) * dir[2]
        if (depth < zN) zN = depth
        if (depth > zF) zF = depth
      }
    })
  })
  return { eye, dir, zN: Number.isFinite(zN) ? zN : 0, zR: Math.max(1e-6, Number.isFinite(zF) ? zF - zN : 1) }
}

// f: max exp(-(d/R)²) over the focal points of the mark (of every figure, for a point on a ground).
function focalTerm(c: Ctx, mark: number, ground: boolean, x: number, y: number, z: number): number {
  let f = 0
  const lo = ground ? 0 : mark
  const hi = ground ? c.nMarks - 1 : mark
  for (let m = lo; m <= hi; m++) {
    for (let k = 0; k < 2; k++) {
      const fx = c.focal[8 * m + 4 * k]
      if (Number.isNaN(fx)) continue
      const R = c.focal[8 * m + 4 * k + 3]
      if (!(R > 0)) continue
      const d = Math.hypot(x - fx, y - c.focal[8 * m + 4 * k + 1], z - c.focal[8 * m + 4 * k + 2])
      f = Math.max(f, Math.exp(-((d / R) ** 2)))
    }
  }
  return f
}

// ---- geometry helpers ----

const SP: SurfacePoint = { tri: 0, b1: 0, b2: 0 }

// Locate each sample of a polyline on the surface (snapping it onto it).
function locateSamples(c: Ctx, sc: SideCtx, xyz: number[], closed: boolean): Geom {
  const n = xyz.length / 3
  const g = newGeom(n, closed)
  const p = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    if (!locate(sc.s, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2], 0, 0, 0, c.snap, SP)) continue
    pointOf(sc.s, SP, p)
    g.xyz[3 * i] = p[0]
    g.xyz[3 * i + 1] = p[1]
    g.xyz[3 * i + 2] = p[2]
    g.tri[i] = SP.tri
    g.b1[i] = SP.b1
    g.b2[i] = SP.b2
    g.ok[i] = 1
  }
  return g
}

// The unit tangent at sample i of g from its neighbours, in the tangent plane of normal n; false where there is none.
function tangentAt(g: Geom, i: number, n: ArrayLike<number>, out: number[]): boolean {
  const m = g.n
  const a = g.closed ? (i + m - 1) % m : Math.max(0, i - 1)
  const b = g.closed ? (i + 1) % m : Math.min(m - 1, i + 1)
  let tx = g.xyz[3 * b] - g.xyz[3 * a]
  let ty = g.xyz[3 * b + 1] - g.xyz[3 * a + 1]
  let tz = g.xyz[3 * b + 2] - g.xyz[3 * a + 2]
  const d = tx * n[0] + ty * n[1] + tz * n[2]
  tx -= d * n[0]
  ty -= d * n[1]
  tz -= d * n[2]
  const l = Math.hypot(tx, ty, tz)
  if (!(l > 1e-15)) return false
  out[0] = tx / l
  out[1] = ty / l
  out[2] = tz / l
  return true
}

// The unit normal of a surface point for `side`; where the point is on an edge shared with another triangle, the bisector of the two
// triangles' normals there (on a smooth surface they are the same normal, so nothing changes; at a sharp crease of a flat-shaded mesh the
// one face's normal would put every probe in that face's plane, off the other face).
const SP_U: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
const N_U = [0, 0, 0]
function normalAt(s: RefinedSurface, p: SurfacePoint, side: 1 | -1, out: number[]): void {
  normalOf(s, p, side, out)
  const w = [1 - p.b1 - p.b2, p.b1, p.b2]
  const t = p.tri
  for (let e = 0; e < 3; e++) {
    const u = s.adj[3 * t + e]
    if (u < 0 || w[(e + 2) % 3] >= 1e-6) continue
    // the point on triangle u: the weights of the edge's two canonical vertices, the third vertex none
    const ca = s.canon[s.indices[3 * t + e]]
    const cb = s.canon[s.indices[3 * t + ((e + 1) % 3)]]
    const wu = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const c = s.canon[s.indices[3 * u + k]]
      wu[k] = c === ca ? w[e] : c === cb ? w[(e + 1) % 3] : 0
    }
    SP_U.tri = u
    SP_U.b1 = wu[1]
    SP_U.b2 = wu[2]
    normalOf(s, SP_U, side, N_U)
    const x = out[0] + N_U[0]
    const y = out[1] + N_U[1]
    const z = out[2] + N_U[2]
    const l = Math.hypot(x, y, z)
    if (l > 1e-9) {
      out[0] = x / l
      out[1] = y / l
      out[2] = z / l
    }
    return
  }
}

// How strongly the samples of g (the side's normal and tangent giving "left") put `ref` on the left of the run: the sum over the samples of
// (n × t) · ref, ref the vector from the sample toward the side A should be on (or null for none).
function leftVote(sc: SideCtx, g: Geom, ref: (i: number, out: number[]) => boolean): number {
  const n = [0, 0, 0]
  const t = [0, 0, 0]
  const r = [0, 0, 0]
  let sum = 0
  for (let i = 0; i < g.n; i++) {
    if (!g.ok[i]) continue
    SP.tri = g.tri[i]
    SP.b1 = g.b1[i]
    SP.b2 = g.b2[i]
    normalAt(sc.s, SP, sc.side, n)
    if (!tangentAt(g, i, n, t) || !ref(i, r)) continue
    const lx = n[1] * t[2] - n[2] * t[1]
    const ly = n[2] * t[0] - n[0] * t[2]
    const lz = n[0] * t[1] - n[1] * t[0]
    sum += lx * r[0] + ly * r[1] + lz * r[2]
  }
  return sum
}

// The gradient (world, in the triangle's plane) of the linear interpolant of a per-vertex field over triangle t.
function triGradient(s: RefinedSurface, f: ArrayLike<number>, t: number, out: number[]): boolean {
  const p = s.positions
  const a = s.indices[3 * t]
  const b = s.indices[3 * t + 1]
  const c = s.indices[3 * t + 2]
  const e1x = p[3 * b] - p[3 * a], e1y = p[3 * b + 1] - p[3 * a + 1], e1z = p[3 * b + 2] - p[3 * a + 2]
  const e2x = p[3 * c] - p[3 * a], e2y = p[3 * c + 1] - p[3 * a + 1], e2z = p[3 * c + 2] - p[3 * a + 2]
  const d1 = f[b] - f[a]
  const d2 = f[c] - f[a]
  const g11 = e1x * e1x + e1y * e1y + e1z * e1z
  const g22 = e2x * e2x + e2y * e2y + e2z * e2z
  const g12 = e1x * e2x + e1y * e2y + e1z * e2z
  const det = g11 * g22 - g12 * g12
  if (!(det > 1e-30)) return false
  const al = (d1 * g22 - d2 * g12) / det
  const be = (d2 * g11 - d1 * g12) / det
  out[0] = al * e1x + be * e2x
  out[1] = al * e1y + be * e2y
  out[2] = al * e1z + be * e2z
  return true
}

function centroidDelta(s: RefinedSurface, t: number, x: number, y: number, z: number, out: number[]): void {
  const p = s.positions
  const a = 3 * s.indices[3 * t]
  const b = 3 * s.indices[3 * t + 1]
  const c = 3 * s.indices[3 * t + 2]
  out[0] = (p[a] + p[b] + p[c]) / 3 - x
  out[1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - y
  out[2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - z
}

// ---- scoring a run ----

interface RunSpec {
  type: WorldEdgeType
  kind: 0 | 1 | 2
  // A plane boundary's two planes (A the lower id), else null.
  pair: [number, number] | null
}

interface Scored {
  run: WorldEdgeRun
  // The triangle of each sample (the edge field seeds from its vertices).
  tri: Int32Array
}

const PA = newPlanAt()
const PB = newPlanAt()
const PS = newPlanAt()
const LOC_A: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
const LOC_B: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
const LOC_S: SurfacePoint = { tri: 0, b1: 0, b2: 0 }

// A probe at (x, y, z) from the sample p: a surface point of the same surface within reach that is not the sample's own neighbourhood
// (past a border the nearest point is the border itself, next to the sample: no probe).
function probe(c: Ctx, sc: SideCtx, x: number, y: number, z: number, px: number, py: number, pz: number, out: SurfacePoint, tmp: number[], delta = c.delta): boolean {
  if (!locate(sc.s, x, y, z, 0, 0, 0, 1.05 * delta, out)) return false
  pointOf(sc.s, out, tmp)
  return Math.hypot(tmp[0] - px, tmp[1] - py, tmp[2] - pz) >= 0.5 * delta
}

const PM = newPlanAt()
const LOC_M: SurfacePoint = { tri: 0, b1: 0, b2: 0 }

// The plan's value `px` CSS px from the sample along (dx, dy, dz) on the same surface, or NaN where there is none (past a border).
function valueAlong(c: Ctx, sc: SideCtx, x: number, y: number, z: number, dx: number, dy: number, dz: number, px: number, tmp: number[]): number {
  const d = px * c.perPx
  if (!probe(c, sc, x + d * dx, y + d * dy, z + d * dz, x, y, z, LOC_M, tmp, d)) return Number.NaN
  return planAt(c.plan, sc.mark, sc.side, LOC_M, PM).u
}

// The class of each sample of a run as the median of the 7 samples about it (model/edges.ts smoothClasses, whose ends repeat), the samples of a
// CLOSED run wrapping round: its first samples are next to its last, so a change of class across its start is smoothed like any other.
export function smoothRunClasses(raw: Uint8Array, closed: boolean): Uint8Array {
  const n = raw.length
  if (!closed || n < 7) return smoothClasses(raw)
  const ext = new Uint8Array(n + 6)
  for (let k = 0; k < n + 6; k++) ext[k] = raw[(k - 3 + n) % n]
  return smoothClasses(ext).slice(3, 3 + n)
}

function scoreRun(c: Ctx, sc: SideCtx, g: Geom, spec: RunSpec): Scored | null {
  const n = g.n
  if (n < EDGE_MIN_SAMPLES) return null
  const params = c.params
  const ep = params.edges
  const pts = new Float64Array(3 * n)
  const nrm = new Float32Array(3 * n)
  const across = new Float32Array(3 * n)
  const keys = new Uint32Array(n)
  const planeA = new Int32Array(n)
  const planeB = new Int32Array(n)
  const uA = new Float32Array(n)
  const uB = new Float32Array(n)
  const h = new Float32Array(n)
  const raw = new Uint8Array(n)
  const nv = [0, 0, 0]
  const nA = [0, 0, 0]
  const nB = [0, 0, 0]
  const t = [0, 0, 0]
  const tmp = [0, 0, 0]
  const kindType = KIND_TYPE[spec.kind]
  const ts = params.value.terminatorSoftness
  const tScaleAll = terminatorEdgeScale(ts)
  let csum = 0
  let ccount = 0
  const tris = Int32Array.from(g.tri)
  const tPrev = [0, 0, 0]
  let havePrev = false
  for (let i = 0; i < n; i++) {
    const x = g.xyz[3 * i]
    const y = g.xyz[3 * i + 1]
    const z = g.xyz[3 * i + 2]
    SP.tri = g.tri[i]
    SP.b1 = g.b1[i]
    SP.b2 = g.b2[i]
    normalAt(sc.s, SP, sc.side, nv)
    if (!tangentAt(g, i, nv, t)) {
      if (havePrev) {
        t[0] = tPrev[0]
        t[1] = tPrev[1]
        t[2] = tPrev[2]
      } else {
        // any direction in the tangent plane
        const ax = Math.abs(nv[0]) < 0.9 ? 1 : 0
        const ay = 1 - ax
        t[0] = ay * nv[2]
        t[1] = -ax * nv[2]
        t[2] = ax * nv[1] - ay * nv[0]
        const l = Math.hypot(t[0], t[1], t[2]) || 1
        t[0] /= l
        t[1] /= l
        t[2] /= l
      }
    }
    tPrev[0] = t[0]
    tPrev[1] = t[1]
    tPrev[2] = t[2]
    havePrev = true
    // across: from A (the left of the travel, n × t) to B (the right): t × n
    let ax = t[1] * nv[2] - t[2] * nv[1]
    let ay = t[2] * nv[0] - t[0] * nv[2]
    let az = t[0] * nv[1] - t[1] * nv[0]
    const al = Math.hypot(ax, ay, az) || 1
    ax /= al
    ay /= al
    az /= al
    pts[3 * i] = x
    pts[3 * i + 1] = y
    pts[3 * i + 2] = z
    nrm[3 * i] = nv[0]
    nrm[3 * i + 1] = nv[1]
    nrm[3 * i + 2] = nv[2]
    across[3 * i] = ax
    across[3 * i + 1] = ay
    across[3 * i + 2] = az

    // the sample's own plan, and the two probes'
    LOC_S.tri = g.tri[i]
    LOC_S.b1 = g.b1[i]
    LOC_S.b2 = g.b2[i]
    planAt(c.plan, sc.mark, sc.side, LOC_S, PS)
    const d = c.delta
    const okA = probe(c, sc, x - d * ax, y - d * ay, z - d * az, x, y, z, LOC_A, tmp)
    const okB = probe(c, sc, x + d * ax, y + d * ay, z + d * az, x, y, z, LOC_B, tmp)
    let ua = PS.u
    let ub = PS.u
    nA[0] = nB[0] = nv[0]
    nA[1] = nB[1] = nv[1]
    nA[2] = nB[2] = nv[2]
    let pa = -1
    let pb = -1
    if (okA) {
      planAt(c.plan, sc.mark, sc.side, LOC_A, PA)
      ua = PA.u
      normalOf(sc.s, LOC_A, sc.side, nA)
      pa = sc.pl ? sc.pl[LOC_A.tri] : -1
    }
    if (okB) {
      planAt(c.plan, sc.mark, sc.side, LOC_B, PB)
      ub = PB.u
      normalOf(sc.s, LOC_B, sc.side, nB)
      pb = sc.pl ? sc.pl[LOC_B.tri] : -1
    }
    // the plane each side: a plane boundary's own two, else the probes'
    if (spec.pair) {
      pa = spec.pair[0]
      pb = spec.pair[1]
    }
    planeA[i] = pa
    planeB[i] = pb
    // a side has a value where its probe found the surface, or (reading the planes' means) where it has a plane
    let hasA = okA
    let hasB = okB
    if (c.sideValues === 'planes' && spec.kind !== 1) {
      if (pa >= 0) {
        ua = c.planes.planes[pa].u
        hasA = true
      }
      if (pb >= 0) {
        ub = c.planes.planes[pb].u
        hasB = true
      }
    }
    // beyond a sheet's border lies the canvas (the model's reading where nothing is across an outline); any other side without a
    // value stands for its own side's, and the sample is flagged
    let flagged = false
    if (!hasA) flagged = true
    if (!hasB) {
      if (spec.type === 'border' && hasA) ub = c.plan.uCanvas
      else flagged = true
    }
    uA[i] = ua
    uB[i] = ub
    const con = Math.abs(ua - ub)
    if (!flagged) {
      csum += con
      ccount++
    }

    // the terms
    const cTerm = spec.kind === 0 ? smooth(0.06, 0.6, con) : smooth(0.04, 0.34, con)
    let kTerm = spec.kind === 1 ? 0.55 : 0.3
    if (spec.kind === 0) {
      const dot = clamp(nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2], -1, 1)
      kTerm = smooth(0.01, 0.06, (Math.acos(dot) / (2 * PROBE_PX)) * 0.875)
    }
    const fTerm = focalTerm(c, sc.mark, sc.ground, x, y, z)
    const sTerm = smooth(0.28, 0.8, (ua + ub) / 2)
    let xTerm = 0
    if (spec.kind === 2) xTerm = 1 - smooth(8, 110, PS.shadowDist / c.perPx)
    let tScale = 1
    if (spec.type === 'terminator') tScale = tScaleAll
    else if (spec.type === 'plane' && planeA[i] >= 0 && planeB[i] >= 0 && isTerminatorPair(c.planes.planes[planeA[i]].zone, c.planes.planes[planeB[i]].zone)) tScale = tScaleAll
    const noise = valueNoise3(x * EDGE_NOISE_FREQ, y * EDGE_NOISE_FREQ, z * EDGE_NOISE_FREQ, c.noiseSeed)
    let hh = (edgeHardness(kindType, { c: cTerm, k: kTerm, f: fTerm, s: sTerm, d: c.depth ? 1 - smooth(0, 1, ((x - c.depth.eye[0]) * c.depth.dir[0] + (y - c.depth.eye[1]) * c.depth.dir[1] + (z - c.depth.eye[2]) * c.depth.dir[2] - c.depth.zN) / c.depth.zR) : 0, x: xTerm }, params) + ep.noise * noise) * tScale
    if (con < 0.03) hh = Math.min(hh, ep.lostBelow - 0.01) // no visible transition: lost
    else if (spec.kind === 1) {
      // The outline of a form in shadow against light (the canvas, or the lit face of a crease) is where two families meet: a FOUND edge, whatever
      // the other terms say (the model's: a far limb's depth and focal weights could make it read soft, and a soft one is blended with the canvas).
      // The shadow side's lowest value is taken over the way in (1 and 2 px: at a limb the normal turns fast, so the pixel inside can be lit where
      // the outline itself is already in the shadow); a crease's two sides are alike, a border's other side is the canvas.
      let loA = ua
      let loB = ub
      for (const px of [1, 2]) {
        const va = valueAlong(c, sc, x, y, z, -ax, -ay, -az, px, tmp)
        if (va < loA) loA = va
        if (spec.type === 'crease') {
          const vb = valueAlong(c, sc, x, y, z, ax, ay, az, px, tmp)
          if (vb < loB) loB = vb
        }
      }
      if (Math.min(loA, loB) <= c.plan.capU && Math.max(ua, ub) >= c.plan.floorU) hh = Math.max(hh, ep.softBelow + 0.01)
    }
    h[i] = clamp(hh, 0, 1)
    raw[i] = edgeClassOf(h[i], params)
    keys[i] = hash3(Math.round(x * 7), Math.round(y * 7), Math.round(z * 7))
  }
  // the class: the median of the 7 samples about it (a closed run wraps)
  const cls = smoothRunClasses(raw, g.closed)
  const run: WorldEdgeRun = {
    type: spec.type, mark: sc.mark, side: sc.runSide, kind: spec.kind, closed: g.closed,
    pts, nrm, across, keys, planeA, planeB, uA, uB, h, cls, contrast: ccount > 0 ? csum / ccount : 0,
  }
  return { run, tri: tris }
}

// ---- iso lines ----

// A per-vertex field with the copies of one canonical vertex (a seam, a pole) given their mean where they agree to within rounding: the iso
// line then crosses an edge the same way from every triangle that has it, whatever the last digit the copies came with (a terminator through
// a pole is the case: the field there is the iso to the last digit, and the copies sit on either side of it). Copies that really differ
// (a flat-shaded crease, where the field is discontinuous) keep their own values: nothing is smeared across the discontinuity.
const AGREE = 1e-6
function canonMean(s: RefinedSurface, f: ArrayLike<number>): Float64Array {
  const nv = s.canon.length
  let nc = 0
  for (let v = 0; v < nv; v++) nc = Math.max(nc, s.canon[v] + 1)
  const sum = new Float64Array(nc)
  const cnt = new Uint32Array(nc)
  for (let v = 0; v < nv; v++) {
    sum[s.canon[v]] += f[v]
    cnt[s.canon[v]]++
  }
  const out = new Float64Array(nv)
  for (let v = 0; v < nv; v++) {
    const mean = sum[s.canon[v]] / cnt[s.canon[v]]
    out[v] = Math.abs(f[v] - mean) <= AGREE ? mean : f[v]
  }
  return out
}

export interface Iso {
  nodePos: Float64Array
  // The segments (pairs of crossing ids) and how many crossings there are, as chained.
  sa: number[]
  sb: number[]
  nNodes: number
  chains: Chain[]
  // Per segment: how much the turn from the light and the shadow's vote change across its triangle.
  dTurn: Float32Array
  dVote: Float32Array
}

// Marching triangles on the per-vertex field f at `iso` (a vertex counts as above where f > iso), the crossings keyed by the canonical
// ids of the edge they are on, so that two triangles that share an edge (across a seam too) share the crossing and chain.
export function marchTriangles(s: RefinedSurface, f: ArrayLike<number>, iso: number, turn: ArrayLike<number> | null, vote: ArrayLike<number> | null): Iso {
  const idx = s.indices
  const p = s.positions
  const nodeIndex = new Map<number, number>()
  const nodePos: number[] = []
  const sa: number[] = []
  const sb: number[] = []
  const dTurn: number[] = []
  const dVote: number[] = []
  const cross = (i: number, j: number): number => {
    const ci = s.canon[i]
    const cj = s.canon[j]
    const key = ci < cj ? ci * EDGE_RADIX + cj : cj * EDGE_RADIX + ci
    let id = nodeIndex.get(key)
    if (id === undefined) {
      id = nodePos.length / 3
      nodeIndex.set(key, id)
      const t = (iso - f[i]) / (f[j] - f[i])
      nodePos.push(p[3 * i] + t * (p[3 * j] - p[3 * i]), p[3 * i + 1] + t * (p[3 * j + 1] - p[3 * i + 1]), p[3 * i + 2] + t * (p[3 * j + 2] - p[3 * i + 2]))
    }
    return id
  }
  const range = (v: ArrayLike<number> | null, a: number, b: number, c: number): number => (v ? Math.max(v[a], v[b], v[c]) - Math.min(v[a], v[b], v[c]) : 0)
  const nt = idx.length / 3
  for (let t = 0; t < nt; t++) {
    const i0 = idx[3 * t]
    const i1 = idx[3 * t + 1]
    const i2 = idx[3 * t + 2]
    const p0 = f[i0] > iso
    const p1 = f[i1] > iso
    const p2 = f[i2] > iso
    if (p0 === p1 && p1 === p2) continue
    // the lone vertex of its side, and the two edges that leave it
    let lone: number
    let b: number
    let c: number
    if (p0 !== p1 && p0 !== p2) [lone, b, c] = [i0, i1, i2]
    else if (p1 !== p0 && p1 !== p2) [lone, b, c] = [i1, i2, i0]
    else [lone, b, c] = [i2, i0, i1]
    sa.push(cross(lone, b))
    sb.push(cross(lone, c))
    dTurn.push(range(turn, i0, i1, i2))
    dVote.push(range(vote, i0, i1, i2))
  }
  const chains = chainSegments(nodePos.length / 3, sa, sb)
  return { nodePos: Float64Array.from(nodePos), sa, sb, nNodes: nodePos.length / 3, chains, dTurn: Float32Array.from(dTurn), dVote: Float32Array.from(dVote) }
}

// ---- the whole ----

export function buildWorldEdges(plan: WorldPlan, planes: WorldPlanes, params: PaintParams, scene: SpaceScene, authored: AuthoredFraming, options: WorldEdgeOptions = {}): WorldEdges {
  const perPx = plan.referenceWorldPerPx
  const nMarks = plan.surfaces.length
  const ctx: Ctx = {
    plan, planes, params, perPx, step: EDGE_STEP_PX * perPx, delta: PROBE_PX * perPx, snap: 6 * perPx,
    noiseSeed: edgeNoiseSeed(params), focal: focalPoints(plan, authored), nMarks, sideValues: options.sideValues ?? 'planes', depth: options.authoredDepth === false ? null : authoredDepthRange(plan, authored),
  }
  const scored: Scored[] = []
  const sideMarks: SideCtx[] = []

  for (let m = 0; m < nMarks; m++) {
    const s = plan.surfaces[m]
    if (!s || plan.veil[m] === 1) continue
    const ground = plan.ground[m] === 1
    const sides: (1 | -1)[] = s.outsideOnly ? [1] : [1, -1]
    const sideCtxs: SideCtx[] = []
    sides.forEach((side, k) => {
      const sp = k === 0 ? plan.front[m] : plan.back[m]
      if (!sp) return
      sideCtxs.push({ mark: m, s, sp, side, index: k as 0 | 1, pl: planes.planeOf[m][k], ground, runSide: s.outsideOnly ? 0 : side })
    })
    for (const sc of sideCtxs) {
      sideMarks.push(sc)
      if (ground) tableCast(ctx, sc, scored)
      else {
        isoEdges(ctx, sc, scored)
        planeEdges(ctx, sc, scored)
      }
    }
    if (!ground) staticEdges(ctx, sideCtxs, scene.marks[m] as MeshMark, scored)
  }

  // the mean hardness between planes
  const nPlanes = planes.planes.length + 1
  const adj = new Map<number, { sum: number; n: number }>()
  for (const { run } of scored) {
    if (run.kind === 1) continue
    for (let i = 0; i < run.h.length; i++) {
      const a = run.planeA[i]
      const b = run.planeB[i]
      if (a < 0 || b < 0 || a === b) continue
      const key = a < b ? a * nPlanes + b : b * nPlanes + a
      const e = adj.get(key)
      if (e) {
        e.sum += run.h[i]
        e.n++
      } else adj.set(key, { sum: run.h[i], n: 1 })
    }
  }

  const reach = params.detect.edgeReachPx * perPx
  const out: WorldEdges['field'] = plan.surfaces.map(() => [])
  for (const sc of sideMarks) {
    const seeds = scored.filter((r) => r.run.mark === sc.mark && sc.index === (r.run.side === -1 ? 1 : 0) && r.run.contrast >= params.detect.edgeMinContrast)
    out[sc.mark][sc.index] = edgeField(sc.s, seeds, reach)
  }

  return {
    runs: scored.map((r) => r.run),
    adjHard: (a, b) => {
      const e = adj.get(a < b ? a * nPlanes + b : b * nPlanes + a)
      return e ? e.sum / e.n : 0
    },
    field: out,
    focal: ctx.focal,
    reach,
    params,
  }
}

// The plan's own family weight at the vertices of one side of a figure surface, as a continuous field whose 0.5 is the family boundary:
// the light family's weight with the shadow flag clear where the key light reaches the vertex (vis 1) and with it set where it does
// not (vis 0), blended by vis,  lw = vis·lightWeight(ts, nl, false) + (1 - vis)·lightWeight(ts, nl, true)  (value.ts lightWeight is the
// plan's own rule: planSample's family is "lw over a half", with the flag nl <= 0 || vis < 0.5). Where the flag is settled lw IS the
// plan's family weight, so its iso line is the family boundary there: a cast shadow's edge, which takes the weight under a half from
// N·L 0 over CAST_FADE, and the terminator's, which does it at N·L 0, including where the two meet or a lit strip lies between them.
// `turn` is the terminator's term alone (the light weight with the flag clear) and `vote` the shadow's (vis): which of them changes more
// across a triangle says what kind of edge it is. Copies of one canonical vertex are averaged where they agree (canonMean).
export function familyField(s: RefinedSurface, sp: SidePlan, ts: number): { lw: Float64Array; turn: Float64Array; vote: Float64Array } {
  const nv = s.positions.length / 3
  const lw0 = new Float64Array(nv)
  const turn0 = new Float64Array(nv)
  const vote0 = new Float64Array(nv)
  for (let v = 0; v < nv; v++) {
    const vis = sp.vis[v]
    const lit = lightWeight(ts, sp.nl[v], false)
    turn0[v] = lit
    vote0[v] = vis
    lw0[v] = vis * lit + (1 - vis) * lightWeight(ts, sp.nl[v], true)
  }
  return { lw: canonMean(s, lw0), turn: canonMean(s, turn0), vote: canonMean(s, vote0) }
}

// Which side of the run's chain a stretch of iso line has A on: the high side of the field.
function isoEdges(c: Ctx, sc: SideCtx, out: Scored[]): void {
  const { s, sp } = sc
  const ts = Math.max(1e-4, c.params.value.terminatorSoftness)
  const { lw, turn, vote } = familyField(s, sp, ts)
  const iso = marchTriangles(s, lw, 0.5, turn, vote)
  for (const chain of iso.chains) {
    const poly = new Float64Array(3 * chain.nodes.length)
    chain.nodes.forEach((id, k) => poly.set(iso.nodePos.subarray(3 * id, 3 * id + 3), 3 * k))
    const xyz: number[] = []
    const seg: number[] = []
    resamplePolyline(poly, chain.closed, c.step, xyz, seg)
    const g = locateSamples(c, sc, xyz, chain.closed)
    seg.forEach((j, i) => {
      g.a0[i] = iso.dTurn[chain.segs[j]]
      g.a1[i] = iso.dVote[chain.segs[j]]
    })
    // A is the lit side: the gradient of lw points to it
    const grad = [0, 0, 0]
    const vt = leftVote(sc, g, (i, r) => {
      if (!triGradient(s, lw, g.tri[i], grad)) return false
      r[0] = grad[0]
      r[1] = grad[1]
      r[2] = grad[2]
      return true
    })
    if (vt < 0) reverseGeom(g)
    // the type of each sample: the turn from the light where it changes lw more than the shadow's vote does, over a window of the samples about it
    const label = new Int32Array(g.n)
    const n = g.n
    for (let i = 0; i < n; i++) {
      if (!g.ok[i]) {
        label[i] = -1
        continue
      }
      let st = 0
      let sv = 0
      for (let k = -3; k <= 3; k++) {
        const j = g.closed ? (i + k + n) % n : clamp(i + k, 0, n - 1)
        st += g.a0[j]
        sv += g.a1[j]
      }
      label[i] = st >= sv ? 0 : 1
    }
    for (const piece of stretches(n, g.closed, label)) {
      const sub = sliceGeom(g, piece.idx, piece.closed)
      const type: WorldEdgeType = label[piece.idx[0]] === 0 ? 'terminator' : 'shadow'
      const r = scoreRun(c, sc, sub, { type, kind: 0, pair: null })
      if (r) out.push(r)
    }
  }
}

// The cast shadow's edge on a table: the iso line 0.5 of vis, A the lit table.
function tableCast(c: Ctx, sc: SideCtx, out: Scored[]): void {
  const { s, sp } = sc
  const vis = canonMean(s, sp.vis)
  const iso = marchTriangles(s, vis, 0.5, null, null)
  for (const chain of iso.chains) {
    const poly = new Float64Array(3 * chain.nodes.length)
    chain.nodes.forEach((id, k) => poly.set(iso.nodePos.subarray(3 * id, 3 * id + 3), 3 * k))
    const xyz: number[] = []
    const seg: number[] = []
    resamplePolyline(poly, chain.closed, c.step, xyz, seg)
    const g = locateSamples(c, sc, xyz, chain.closed)
    const grad = [0, 0, 0]
    const vt = leftVote(sc, g, (i, r) => {
      if (!triGradient(s, vis, g.tri[i], grad)) return false
      r[0] = grad[0]
      r[1] = grad[1]
      r[2] = grad[2]
      return true
    })
    if (vt < 0) reverseGeom(g)
    const label = new Int32Array(g.n)
    for (let i = 0; i < g.n; i++) label[i] = g.ok[i] ? 0 : -1
    for (const piece of stretches(g.n, g.closed, label)) {
      const r = scoreRun(c, sc, sliceGeom(g, piece.idx, piece.closed), { type: 'shadow', kind: 2, pair: null })
      if (r) out.push(r)
    }
  }
}

// The boundaries between planes of one family on one side of one mesh.
function planeEdges(c: Ctx, sc: SideCtx, out: Scored[]): void {
  const { s } = sc
  const pl = sc.pl
  if (!pl) return
  const planes = c.planes.planes
  const nt = s.indices.length / 3
  // canonical vertex positions
  let nc = 0
  for (let v = 0; v < s.canon.length; v++) nc = Math.max(nc, s.canon[v] + 1)
  const cpos = new Float64Array(3 * nc)
  const seen = new Uint8Array(nc)
  for (let v = 0; v < s.canon.length; v++) {
    const cv = s.canon[v]
    if (seen[cv]) continue
    seen[cv] = 1
    cpos[3 * cv] = s.positions[3 * v]
    cpos[3 * cv + 1] = s.positions[3 * v + 1]
    cpos[3 * cv + 2] = s.positions[3 * v + 2]
  }
  // the boundary edges, by the pair of planes they are between
  const groups = new Map<number, { a: number[]; b: number[]; lo: number; hi: number }>()
  const np = planes.length + 1
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const u = s.adj[3 * t + e]
      if (u <= t) continue
      const pt = pl[t]
      const pu = pl[u]
      if (pt === pu || planes[pt].fam !== planes[pu].fam) continue
      const lo = Math.min(pt, pu)
      const hi = Math.max(pt, pu)
      const key = lo * np + hi
      let grp = groups.get(key)
      if (!grp) {
        grp = { a: [], b: [], lo, hi }
        groups.set(key, grp)
      }
      grp.a.push(s.canon[s.indices[3 * t + e]])
      grp.b.push(s.canon[s.indices[3 * t + ((e + 1) % 3)]])
    }
  }
  const dense = new Map<number, number>()
  const c3 = [0, 0, 0]
  for (const grp of groups.values()) {
    // dense node ids for the group
    dense.clear()
    const nodeOf: number[] = []
    const id = (cv: number): number => {
      let d = dense.get(cv)
      if (d === undefined) {
        d = nodeOf.length
        dense.set(cv, d)
        nodeOf.push(cv)
      }
      return d
    }
    const sa = grp.a.map(id)
    const sb = grp.b.map(id)
    for (const chain of chainSegments(nodeOf.length, sa, sb)) {
      const poly = new Float64Array(3 * chain.nodes.length)
      chain.nodes.forEach((d, k) => {
        const cv = nodeOf[d]
        poly[3 * k] = cpos[3 * cv]
        poly[3 * k + 1] = cpos[3 * cv + 1]
        poly[3 * k + 2] = cpos[3 * cv + 2]
      })
      const smooth2 = chaikin(poly, chain.closed, CHAIKIN_PASSES)
      const xyz: number[] = []
      const seg: number[] = []
      resamplePolyline(smooth2, chain.closed, c.step, xyz, seg)
      if (xyz.length / 3 < EDGE_MIN_SAMPLES) continue
      const g = locateSamples(c, sc, xyz, chain.closed)
      // A is the lower plane: the triangle at a sample that is of that plane lies on the left
      const vt = leftVote(sc, g, (i, r) => {
        const p = pl[g.tri[i]]
        if (p !== grp.lo && p !== grp.hi) return false
        centroidDelta(s, g.tri[i], g.xyz[3 * i], g.xyz[3 * i + 1], g.xyz[3 * i + 2], c3)
        const sg = p === grp.lo ? 1 : -1
        r[0] = sg * c3[0]
        r[1] = sg * c3[1]
        r[2] = sg * c3[2]
        return true
      })
      if (vt < 0) reverseGeom(g)
      const label = new Int32Array(g.n)
      for (let i = 0; i < g.n; i++) label[i] = g.ok[i] ? 0 : -1
      for (const piece of stretches(g.n, g.closed, label)) {
        const r = scoreRun(c, sc, sliceGeom(g, piece.idx, piece.closed), { type: 'plane', kind: 0, pair: [grp.lo, grp.hi] })
        if (r) out.push(r)
      }
    }
  }
}

// A polyline cut at its sharp corners (a turn over 35 degrees: model/contours.ts splitAtCorners, in the world), each corner ending one piece
// and starting the next. A closed polyline (its vertices without the repeated first) with no corner stays closed.
const CORNER_COS = Math.cos((35 * Math.PI) / 180)
function splitAtCorners(poly: Float64Array, closed: boolean): { poly: Float64Array; closed: boolean }[] {
  const m = poly.length / 3
  const corner: number[] = []
  for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
    const a = (i + m - 1) % m
    const b = (i + 1) % m
    const ax = poly[3 * i] - poly[3 * a], ay = poly[3 * i + 1] - poly[3 * a + 1], az = poly[3 * i + 2] - poly[3 * a + 2]
    const bx = poly[3 * b] - poly[3 * i], by = poly[3 * b + 1] - poly[3 * i + 1], bz = poly[3 * b + 2] - poly[3 * i + 2]
    const la = Math.hypot(ax, ay, az)
    const lb = Math.hypot(bx, by, bz)
    if (la < 1e-12 || lb < 1e-12) continue
    if ((ax * bx + ay * by + az * bz) / (la * lb) < CORNER_COS) corner.push(i)
  }
  if (corner.length === 0) return [{ poly, closed }]
  const pick = (from: number, to: number): Float64Array => {
    // vertices from..to inclusive, going forward (wrapping on a closed polyline)
    const n = ((to - from + m) % m) + 1
    const out = new Float64Array(3 * n)
    for (let k = 0; k < n; k++) for (let q = 0; q < 3; q++) out[3 * k + q] = poly[3 * ((from + k) % m) + q]
    return out
  }
  const out: { poly: Float64Array; closed: boolean }[] = []
  if (closed) {
    for (let k = 0; k < corner.length; k++) out.push({ poly: pick(corner[k], corner[(k + 1) % corner.length]), closed: false })
  } else {
    const cuts = [0, ...corner, m - 1]
    for (let k = 0; k + 1 < cuts.length; k++) out.push({ poly: pick(cuts[k], cuts[k + 1]), closed: false })
  }
  return out.filter((o) => o.poly.length >= 6)
}

// The creases and borders of one mesh, a run per side of an open one.
function staticEdges(c: Ctx, sides: SideCtx[], mesh: MeshMark, out: Scored[]): void {
  if (sides.length === 0 || mesh.kind !== 'mesh') return
  const s = sides[0].s
  const cent = [0, 0, 0]
  for (const line of staticLines(mesh)) {
    const m = line.length / 3
    if (m < 2) continue
    const wasClosed = m > 3 && line[0] === line[3 * (m - 1)] && line[1] === line[3 * (m - 1) + 1] && line[2] === line[3 * (m - 1) + 2]
    for (const { poly, closed } of splitAtCorners(wasClosed ? line.subarray(0, 3 * (m - 1)) : line, wasClosed)) {
      const xyz: number[] = []
      const seg: number[] = []
      resamplePolyline(poly, closed, c.step, xyz, seg)
      const base = locateSamples(c, sides[0], xyz, closed)
      // a sample on a border edge (of the refined surface) is the border's, else a crease's
      const isBorder = new Uint8Array(base.n)
      for (let i = 0; i < base.n; i++) {
        if (!base.ok[i]) continue
        const t = base.tri[i]
        const w = [1 - base.b1[i] - base.b2[i], base.b1[i], base.b2[i]]
        for (let e = 0; e < 3; e++) if (s.adj[3 * t + e] === -1 && w[(e + 2) % 3] < 1e-6) isBorder[i] = 1
      }
      for (const sc of sides) {
        const g = sliceGeom(base, Array.from({ length: base.n }, (_, i) => i), closed)
        const border = Uint8Array.from(isBorder)
        // the surface is on the left: the triangle the sample is on lies to that side
        const vt = leftVote(sc, g, (i, r) => {
          centroidDelta(s, g.tri[i], g.xyz[3 * i], g.xyz[3 * i + 1], g.xyz[3 * i + 2], cent)
          r[0] = cent[0]
          r[1] = cent[1]
          r[2] = cent[2]
          return true
        })
        if (vt < 0) {
          reverseGeom(g)
          border.reverse()
        }
        // the kind of each sample: the majority of the five about it
        const n = g.n
        const label = new Int32Array(n)
        for (let i = 0; i < n; i++) {
          if (!g.ok[i]) {
            label[i] = -1
            continue
          }
          let b = 0
          for (let k = -2; k <= 2; k++) b += border[g.closed ? (i + k + n) % n : clamp(i + k, 0, n - 1)]
          label[i] = b >= 3 ? 1 : 0
        }
        for (const piece of stretches(n, g.closed, label)) {
          const type: WorldEdgeType = label[piece.idx[0]] === 1 ? 'border' : 'crease'
          const r = scoreRun(c, sc, sliceGeom(g, piece.idx, piece.closed), { type, kind: 1, pair: null })
          if (r) out.push(r)
        }
      }
    }
  }
}

// ---- the edge field ----

interface Heap {
  d: Float64Array
  node: Int32Array
  size: number
}

function heapPush(h: Heap, d: number, node: number): void {
  if (h.size === h.d.length) {
    const nd = new Float64Array(2 * h.d.length)
    nd.set(h.d)
    h.d = nd
    const nn = new Int32Array(2 * h.node.length)
    nn.set(h.node)
    h.node = nn
  }
  let i = h.size++
  while (i > 0) {
    const p = (i - 1) >> 1
    if (h.d[p] <= d) break
    h.d[i] = h.d[p]
    h.node[i] = h.node[p]
    i = p
  }
  h.d[i] = d
  h.node[i] = node
}

function heapPop(h: Heap, out: { d: number; node: number }): void {
  out.d = h.d[0]
  out.node = h.node[0]
  const d = h.d[--h.size]
  const node = h.node[h.size]
  let i = 0
  for (;;) {
    let ch = 2 * i + 1
    if (ch >= h.size) break
    if (ch + 1 < h.size && h.d[ch + 1] < h.d[ch]) ch++
    if (h.d[ch] >= d) break
    h.d[i] = h.d[ch]
    h.node[i] = h.node[ch]
    i = ch
  }
  h.d[i] = d
  h.node[i] = node
}

// The edge field of one side of a surface: the distance (along the surface's edge graph) to the nearest seed, within `reach`.
function edgeField(s: RefinedSurface, seeds: Scored[], reach: number): { dist: Float32Array; hard: Float32Array; cls: Uint8Array } {
  const nv = s.positions.length / 3
  const nt = s.indices.length / 3
  const dist = new Float32Array(nv).fill(Infinity)
  const hard = new Float32Array(nv)
  const cls = new Uint8Array(nv).fill(255)
  if (seeds.length === 0) return { dist, hard, cls }
  let nc = 0
  for (let v = 0; v < nv; v++) nc = Math.max(nc, s.canon[v] + 1)
  const cpos = new Float64Array(3 * nc)
  const seen = new Uint8Array(nc)
  for (let v = 0; v < nv; v++) {
    const cv = s.canon[v]
    if (seen[cv]) continue
    seen[cv] = 1
    for (let k = 0; k < 3; k++) cpos[3 * cv + k] = s.positions[3 * v + k]
  }
  // the edge graph on the canonical vertices
  const start = new Int32Array(nc + 1)
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      start[s.canon[s.indices[3 * t + e]] + 1]++
      start[s.canon[s.indices[3 * t + ((e + 1) % 3)]] + 1]++
    }
  }
  for (let i = 0; i < nc; i++) start[i + 1] += start[i]
  const fill = start.slice(0, nc)
  const nbr = new Int32Array(start[nc])
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = s.canon[s.indices[3 * t + e]]
      const b = s.canon[s.indices[3 * t + ((e + 1) % 3)]]
      nbr[fill[a]++] = b
      nbr[fill[b]++] = a
    }
  }
  // seeds: the three vertices of each sample's triangle at their exact distance, labelled with the sample's hardness and class
  const best = new Float64Array(nc).fill(Infinity)
  const label = new Int32Array(nc).fill(-1)
  const labelH: number[] = []
  const labelC: number[] = []
  const heap: Heap = { d: new Float64Array(1024), node: new Int32Array(1024), size: 0 }
  for (const { run, tri } of seeds) {
    for (let i = 0; i < run.h.length; i++) {
      const lab = labelH.length
      labelH.push(run.h[i])
      labelC.push(run.cls[i])
      const x = run.pts[3 * i]
      const y = run.pts[3 * i + 1]
      const z = run.pts[3 * i + 2]
      for (let k = 0; k < 3; k++) {
        const v = s.indices[3 * tri[i] + k]
        const d = Math.hypot(s.positions[3 * v] - x, s.positions[3 * v + 1] - y, s.positions[3 * v + 2] - z)
        const cv = s.canon[v]
        if (d <= reach && d < best[cv]) {
          best[cv] = d
          label[cv] = lab
          heapPush(heap, d, cv)
        }
      }
    }
  }
  const top = { d: 0, node: 0 }
  while (heap.size > 0) {
    heapPop(heap, top)
    const u = top.node
    if (top.d > best[u]) continue
    for (let q = start[u]; q < start[u + 1]; q++) {
      const w = nbr[q]
      const nd = top.d + Math.hypot(cpos[3 * u] - cpos[3 * w], cpos[3 * u + 1] - cpos[3 * w + 1], cpos[3 * u + 2] - cpos[3 * w + 2])
      if (nd <= reach && nd < best[w]) {
        best[w] = nd
        label[w] = label[u]
        heapPush(heap, nd, w)
      }
    }
  }
  for (let v = 0; v < nv; v++) {
    const cv = s.canon[v]
    if (label[cv] < 0) continue
    dist[v] = best[cv]
    hard[v] = labelH[label[cv]]
    cls[v] = labelC[label[cv]]
  }
  return { dist, hard, cls }
}

// ---- reading the field ----

// The class of the edge nearest a stroke (model strokeEdgeClass, from the field): the nearest within the reach of the points of its
// path, else the hardness a stroke has away from edges, 0.52 + 0.26·light − 0.28·shadow (held to 0.1..0.9), as a class. `pts` are the stroke's
// path points on the surface of `mark`, for `side`.
export function edgeClassAlong(edges: WorldEdges, plan: WorldPlan, mark: number, side: 1 | -1, pts: SurfacePoint[], light: number, shadow: number): number {
  const s = plan.surfaces[mark]
  const sides = edges.field[mark]
  const f = s && sides ? (side === -1 && sides.length > 1 ? sides[1] : sides[0]) : undefined
  let bestD = Infinity
  let bestCls = 255
  if (s && f) {
    for (const p of pts) {
      const a = s.indices[3 * p.tri]
      const b = s.indices[3 * p.tri + 1]
      const c = s.indices[3 * p.tri + 2]
      const w = [1 - p.b1 - p.b2, p.b1, p.b2]
      const vs = [a, b, c]
      // the distance: the vertices' own, weighted over those that have one (the others are beyond the reach), where half the weight does
      let sw = 0
      let sd = 0
      let heaviest = -1
      for (let k = 0; k < 3; k++) {
        const d = f.dist[vs[k]]
        if (!Number.isFinite(d)) continue
        sw += w[k]
        sd += w[k] * d
        if (heaviest < 0 || w[k] > w[heaviest]) heaviest = k
      }
      if (heaviest < 0 || sw < 0.5) continue
      const d = sd / sw
      if (d < edges.reach && d < bestD) {
        bestD = d
        bestCls = f.cls[vs[heaviest]]
      }
    }
  }
  if (bestD < edges.reach) return bestCls
  const interior = clamp(0.52 + 0.26 * light - 0.28 * shadow, 0.1, 0.9)
  return edgeClassOf(interior, edges.params)
}
