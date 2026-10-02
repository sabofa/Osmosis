// Edge control (spec §3.6): the edge decision at every transition between
// planes, at the outline, and at a cast shadow's edge. One HARDNESS score,
// from the rules a painter uses, is quantised to LOST / SOFT / FIRM / HARD.
//
//   H = Σ wᵢ·termᵢ, terms in 0..1, weights per kind of transition
//   (params.edges.w*: internal, silhouette, shadow):
//     c  value contrast between the two sides     (internal: smooth(0.06, 0.60); outline and shadow: smooth(0.04, 0.34))
//     k  curvature of the form, normals 4 px either side   smooth(0.010, 0.060)
//     f  focal emphasis: exp(−(d/R)²) around the terminator point nearest the viewer
//        and the brightest point, R = 0.55·√(area/π)
//     s  light side: smooth(0.28, 0.80, mean value of the two sides)
//     d  depth: nearer is harder
//     x  distance from the occluder (shadow only): 1 − smooth(8, 110 px)
//   plus edges.noise × seeded noise along the edge, a median of 7 samples, and
//   LOST forced where the contrast is under 0.03.
//
// Classes: LOST below lostBelow (0.24), SOFT below softBelow (0.46), FIRM
// below firmBelow (0.68), HARD above. They change what a brush does (§3.6):
// behaviourOf().
//
// Everything here is in G-buffer pixels; the CSS-px constants of the mockup
// (8..110 for the shadow distance, 20 for the reach of an edge on a stroke,
// the probe distances) are divided by the G-buffer scale.
//
// Ported from the approved mockup (edges.js extractEdges, buildEdgeRun,
// strokeEnv, CLS_MODS; paint-math.js contoursOf).

import type { PaintParams } from '../params'
import { clamp, hash3, mix2, smooth, valueNoise3 } from './math'
import type { PlaneMap } from './planes'
import type { PlanMap } from './value'
import type { FrameCtx } from './view'
import { unproject } from './view'

// Noise on the edge's hardness runs this many cycles to a world unit: a long, gentle waver (a period of two thirds of a unit,
// about 130 px at 200 px a unit), not jitter.
const EDGE_NOISE_FREQ = 1.5

export type EdgeType = 'internal' | 'silhouette' | 'shadow'
const EDGE_KIND: Record<EdgeType, number> = { internal: 0, silhouette: 1, shadow: 2 }

export interface EdgeRun {
  // The plane on the inside, and the plane across (-1: background).
  a: number
  b: number
  type: EdgeType
  // Samples along the edge, G-buffer pixels: x, y per sample, and the inward normal.
  pts: Float32Array
  nrm: Float32Array
  // Hardness 0..1 and its class (an index into EDGE_CLASSES) per sample.
  h: Float32Array
  cls: Uint8Array
  // A hash of the surface position under each sample, for seeding.
  keys: Uint32Array
  // The two sides' plan values, their contrast, and the mesh the edge lies on.
  uA: number
  uB: number
  contrast: number
  mark: number
}

export interface EdgeMap {
  edges: EdgeRun[]
  // The reach of an edge on a stroke in G pixels; the distance to the nearest
  // edge with contrast ≥ 0.05 (R where none) and that edge's hardness.
  reach: number
  dist: Float32Array
  hard: Float32Array
  // The class (EDGE_CLASSES index) of that nearest edge sample: the MEDIAN-SMOOTHED class, not the class of the raw hardness
  // (which flickers as the camera moves). A stroke takes its behaviour from this.
  cls: Uint8Array
  focal: { pts: [number, number][]; R: number } | null
  // The mean hardness of the boundary between two planes, or undefined where they do not meet.
  adjHard(a: number, b: number): number | undefined
  // Score a run of boundary samples (contours.ts builds silhouette runs from the meshes with it).
  makeRun(spec: RunSpec): EdgeRun
}

export interface Sample {
  // G-buffer pixels.
  p: [number, number]
  // The unit normal toward the inside (the figure's side).
  nx: number
  ny: number
  // The plane across the edge (-1 background).
  q: number
  type: EdgeType | null
}

export interface RunSpec {
  type: EdgeType
  mark: number
  // The plane on the inside, or -1 for a run built from a mesh contour.
  id: number
  S: Sample[]
  // Per-sample plan values of the two sides (a contour, whose sides are pixels, not planes).
  uA?: ArrayLike<number>
  uB?: ArrayLike<number>
}

export const edgeClassOf = (h: number, p: PaintParams): number =>
  h < p.edges.lostBelow ? 0 : h < p.edges.softBelow ? 1 : h < p.edges.firmBelow ? 2 : 3

export interface EdgeTerms {
  c: number
  k: number
  f: number
  s: number
  d: number
  x: number
}

export function edgeHardness(type: EdgeType, t: EdgeTerms, p: PaintParams): number {
  const e = p.edges
  const i = EDGE_KIND[type]
  return e.wContrast[i] * t.c + e.wCurvature[i] * t.k + e.wFocal[i] * t.f + e.wLight[i] * t.s + e.wDepth[i] * t.d + (type === 'shadow' ? e.wShadowDist * t.x : 0)
}

// ---- how a class changes the brush (§3.6) ----

export interface Behaviour {
  // wet pickup: max(base·wetMul, wetMin)
  wetMul: number
  wetMin: number
  loadMul: number
  impastoMul: number
  bristleVarMul: number
  // 0 crisp end .. 1 dissolved end (HARD ends at 0.98 of the path, LOST at 0.66)
  endSoft: number
  // a coverage multiplier
  alphaMul: number
  // the dry-brush fraction is at least this
  dryMin: number
}

const BEHAVIOUR: Behaviour[] = [
  { wetMul: 2.2, wetMin: 0.32, loadMul: 0.85, impastoMul: 0.5, bristleVarMul: 0.45, endSoft: 1, alphaMul: 0.8, dryMin: 0.45 }, // lost: dissolves
  { wetMul: 1.6, wetMin: 0.22, loadMul: 0.95, impastoMul: 0.7, bristleVarMul: 0.6, endSoft: 0.625, alphaMul: 0.9, dryMin: 0.35 }, // soft: blended
  { wetMul: 0.6, wetMin: 0, loadMul: 1, impastoMul: 1.15, bristleVarMul: 1, endSoft: 0.1875, alphaMul: 0.97, dryMin: 0.15 }, // firm: distinct
  { wetMul: 0, wetMin: 0, loadMul: 1.12, impastoMul: 1.4, bristleVarMul: 1.15, endSoft: 0, alphaMul: 1, dryMin: 0.1 }, // hard: crisp, loaded
]
export const behaviourOf = (cls: number): Behaviour => BEHAVIOUR[clamp(cls, 0, 3)]

// ---- geometry helpers ----

// A 3×3-ish box blur of radius r (separable), non-periodic.
function blurMask(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(a.length)
  const o = new Float32Array(a.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) {
          s += a[y * w + xx]
          n++
        }
      }
      t[y * w + x] = s / n
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) {
          s += t[yy * w + x]
          n++
        }
      }
      o[y * w + x] = s / n
    }
  }
  return o
}

export interface Loop {
  pts: [number, number][]
  closed: boolean
}

// Marching squares at level `iso`, chained into polylines (closed where they close).
export function contoursOf(f: Float32Array, W: number, H: number, iso: number): Loop[] {
  const px = new Map<number, number>()
  const py = new Map<number, number>()
  const segs: [number, number][] = []
  const reg = (id: number, x: number, y: number): number => {
    if (!px.has(id)) {
      px.set(id, x)
      py.set(id, y)
    }
    return id
  }
  const hId = (i: number, j: number) => (j * (W + 1) + i) * 2
  const vId = (i: number, j: number) => (j * (W + 1) + i) * 2 + 1
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = f[j * W + i]
      const b = f[j * W + i + 1]
      const c = f[(j + 1) * W + i + 1]
      const d = f[(j + 1) * W + i]
      const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const T = () => reg(hId(i, j), i + (iso - a) / (b - a), j)
      const B = () => reg(hId(i, j + 1), i + (iso - d) / (c - d), j + 1)
      const L = () => reg(vId(i, j), i, j + (iso - a) / (d - a))
      const R = () => reg(vId(i + 1, j), i + 1, j + (iso - b) / (c - b))
      switch (idx) {
        case 1: segs.push([L(), B()]); break
        case 2: segs.push([B(), R()]); break
        case 3: segs.push([L(), R()]); break
        case 4: segs.push([T(), R()]); break
        case 5: segs.push([T(), L()], [B(), R()]); break
        case 6: segs.push([T(), B()]); break
        case 7: segs.push([T(), L()]); break
        case 8: segs.push([T(), L()]); break
        case 9: segs.push([T(), B()]); break
        case 10: segs.push([T(), R()], [L(), B()]); break
        case 11: segs.push([T(), R()]); break
        case 12: segs.push([L(), R()]); break
        case 13: segs.push([B(), R()]); break
        case 14: segs.push([L(), B()]); break
      }
    }
  }
  const adj = new Map<number, number[]>()
  segs.forEach((sg, si) => {
    for (const k of sg) {
      const list = adj.get(k)
      if (list) list.push(si)
      else adj.set(k, [si])
    }
  })
  const used = new Uint8Array(segs.length)
  const loops: Loop[] = []
  for (let si = 0; si < segs.length; si++) {
    if (used[si]) continue
    used[si] = 1
    const chain = [segs[si][0], segs[si][1]]
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? chain[chain.length - 1] : chain[0]
        const nxt = (adj.get(end) ?? []).find((q) => !used[q])
        if (nxt === undefined) break
        used[nxt] = 1
        const o = segs[nxt][0] === end ? segs[nxt][1] : segs[nxt][0]
        if (dir) chain.push(o)
        else chain.unshift(o)
      }
    }
    const closed = chain.length > 2 && chain[0] === chain[chain.length - 1]
    if (closed) chain.pop()
    loops.push({ pts: chain.map((k) => [px.get(k) as number, py.get(k) as number]), closed })
  }
  return loops
}

// Resample a polyline at equal arc length (the last point kept when far enough from the previous).
export function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [[pts[0][0], pts[0][1]]]
  let carry = 0
  let prev = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]
    const a = prev
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const d = Math.hypot(dx, dy)
    if (d === 0) continue
    let pos = step - carry
    while (pos <= d) {
      out.push([a[0] + (dx * pos) / d, a[1] + (dy * pos) / d])
      pos += step
    }
    carry = d - (pos - step)
    prev = b
  }
  const last = pts[pts.length - 1]
  const lo = out[out.length - 1]
  if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > step * 0.3) out.push([last[0], last[1]])
  return out
}

// ---- the extraction ----

interface Focal {
  pts: [number, number][]
  R: number
}

// Where the light side meets the terminator closest to the viewer, and the
// brightest highlight: the two places a painter would make an edge firm.
function findFocal(fc: FrameCtx, plan: PlanMap): Focal | null {
  const g = fc.g
  const m = fc.view.view
  const bx = m[2], by = m[6], bz = m[10]
  let b1 = -1, i1 = -1, b2 = -1, i2 = -1, area = 0
  for (let i = 0; i < g.width * g.height; i++) {
    const mk = g.mark[i]
    if (mk < 0 || fc.ground[mk] === 1) continue
    area++
    const nz = Math.abs(g.normal[3 * i] * bx + g.normal[3 * i + 1] * by + g.normal[3 * i + 2] * bz)
    const key = plan.key[i]
    const s1 = nz * smooth(0.1, 0.26, key) * (1 - smooth(0.3, 0.5, key))
    const s2 = key + 0.1 * nz
    if (s1 > b1) { b1 = s1; i1 = i }
    if (s2 > b2) { b2 = s2; i2 = i }
  }
  if (i1 < 0) return null
  return {
    pts: [[i1 % g.width, Math.floor(i1 / g.width)], [i2 % g.width, Math.floor(i2 / g.width)]],
    R: 0.55 * Math.sqrt(area / Math.PI),
  }
}

export function extractEdges(fc: FrameCtx, plan: PlanMap, planes: PlaneMap): EdgeMap {
  const g = fc.g
  const w = g.width
  const h = g.height
  const scale = g.scale
  const list = planes.planes
  const focal = findFocal(fc, plan)
  // depth range of what is painted: the figure and the cast shadows
  let zN = Number.POSITIVE_INFINITY
  let zF = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w * h; i++) {
    const mk = g.mark[i]
    if (mk < 0) continue
    if (fc.ground[mk] !== 1 || plan.zone[i] === 4) {
      if (g.depth[i] < zN) zN = g.depth[i]
      if (g.depth[i] > zF) zF = g.depth[i]
    }
  }
  const zR = Math.max(1e-6, zF - zN)
  const labelAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -2 : planes.plane[y * w + x])
  const probeIn = Math.max(2, 3 / scale)
  const probeOut = Math.max(2.5, 3.5 / scale)
  const stepG = Math.max(0.75, 2 / scale) // samples every 2 CSS px
  const minRun = 8 // samples: 16 CSS px
  const minPlane = Math.max(8, 45 / (scale * scale))
  const adj = new Map<string, { sum: number; n: number }>()
  const edges: EdgeRun[] = []
  const params = fc.params
  const world = [0, 0, 0]
  // The world point of the surface under a G-buffer position (written into `out`), false where nothing is drawn.
  const surfacePoint = (x: number, y: number, out: number[]): boolean => {
    const ix = clamp(Math.round(x), 0, w - 1)
    const iy = clamp(Math.round(y), 0, h - 1)
    const i = iy * w + ix
    if (!Number.isFinite(g.depth[i])) return false
    unproject(fc, (ix + 0.5) * scale, (iy + 0.5) * scale, g.depth[i], out)
    return true
  }
  const posHash = (x: number, y: number): number => {
    if (!surfacePoint(x, y, world)) return 0
    return hash3(Math.round(world[0] * 7), Math.round(world[1] * 7), Math.round(world[2] * 7))
  }
  // The seeded noise on an edge's hardness (params.edges.noise): a smooth function of the SURFACE POINT under the sample,
  // so it is the same whichever way the camera looks at that bit of edge. (It was a noise along the run, keyed on its first
  // sample and its length, which moves with where the contour tracing starts, so an edge flickered as the camera turned.)
  const noiseSeed = mix2(params.seed, 0x6ed9eba1)
  const surfaceNoise = (x: number, y: number): number => (surfacePoint(x, y, world) ? valueNoise3(world[0] * EDGE_NOISE_FREQ, world[1] * EDGE_NOISE_FREQ, world[2] * EDGE_NOISE_FREQ, noiseSeed) : 0)

  const rc: RunCtx = { fc, plan, planes, focal, zN, zR, probeIn, probeOut, posHash, surfaceNoise, adj }
  for (const pl of list) {
    if (pl.area < minPlane) continue
    const x0 = Math.max(0, pl.x0 - 3)
    const y0 = Math.max(0, pl.y0 - 3)
    const x1 = Math.min(w - 1, pl.x1 + 3)
    const y1 = Math.min(h - 1, pl.y1 + 3)
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const m = new Float32Array(bw * bh)
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) m[y * bw + x] = planes.plane[(y0 + y) * w + x0 + x] === pl.id ? 1 : 0
    const loops = contoursOf(blurMask(m, bw, bh, 1), bw, bh, 0.5)
    for (const loop of loops) {
      if (loop.pts.length < 14) continue
      const n0 = loop.pts.length
      const sm: [number, number][] = loop.pts.map((_, i) => {
        let sx = 0
        let sy = 0
        let c = 0
        for (let k = -3; k <= 3; k++) {
          const j = loop.closed ? (i + k + n0) % n0 : clamp(i + k, 0, n0 - 1)
          sx += loop.pts[j][0]
          sy += loop.pts[j][1]
          c++
        }
        return [sx / c + x0, sy / c + y0]
      })
      const rs = resample(sm, stepG)
      if (rs.length < 8) continue
      // per sample: the inward normal, the plane across, and the kind of transition
      const S = rs.map((p, i) => {
        const a = rs[Math.max(0, i - 1)]
        const b = rs[Math.min(rs.length - 1, i + 1)]
        let tx = b[0] - a[0]
        let ty = b[1] - a[1]
        const l = Math.hypot(tx, ty) || 1
        tx /= l
        ty /= l
        let nx = -ty
        let ny = tx
        const probe = (s: number) => (labelAt(Math.round(p[0] + nx * s), Math.round(p[1] + ny * s)) === pl.id ? 1 : 0)
        if (probe(probeIn) < probe(-probeIn)) {
          nx = -nx
          ny = -ny
        }
        const q = labelAt(Math.round(p[0] - nx * probeOut), Math.round(p[1] - ny * probeOut))
        let type: EdgeType | null = null
        if (p[0] < 3 || p[1] < 3 || p[0] > w - 4 || p[1] > h - 4 || q === -2) type = null
        else if (!pl.ground) {
          if (q < 0 || list[q].mark !== pl.mark) type = 'silhouette'
          else if (q > pl.id) type = 'internal'
        } else if (q >= 0 && list[q].ground && pl.cast && !list[q].cast) type = 'shadow'
        return { p, nx, ny, q, type }
      })
      // runs of the same (type, neighbour)
      let s0 = 0
      while (s0 < S.length) {
        if (!S[s0].type) {
          s0++
          continue
        }
        let s1 = s0
        while (s1 + 1 < S.length && S[s1 + 1].type === S[s0].type && S[s1 + 1].q === S[s0].q) s1++
        if (s1 - s0 + 1 >= minRun) {
          edges.push(buildEdgeRun(rc, { type: S[s0].type as EdgeType, mark: pl.mark, id: pl.id, S: S.slice(s0, s1 + 1) }))
        }
        s0 = s1 + 1
      }
    }
  }

  // the hardness field: what is the nearest edge, how hard, how far
  const reach = params.detect.edgeReachPx / scale
  const reach2 = reach * reach
  const dist = new Float32Array(w * h).fill(99)
  const hard = new Float32Array(w * h)
  const clsField = new Uint8Array(w * h)
  for (const e of edges) {
    if (e.contrast < params.detect.edgeMinContrast) continue // no visible transition: the brush just carries on across it
    const n = e.h.length
    for (let k = 0; k < n; k++) {
      const x = e.pts[2 * k]
      const y = e.pts[2 * k + 1]
      const hv = e.h[k]
      const r = Math.ceil(reach)
      const cx = Math.round(x)
      const cy = Math.round(y)
      // the square of the reach, clipped to the image once, and a square root only for a cell that is inside it
      const xa = Math.max(0, cx - r)
      const xb = Math.min(w - 1, cx + r)
      const ya = Math.max(0, cy - r)
      const yb = Math.min(h - 1, cy + r)
      for (let yy = ya; yy <= yb; yy++) {
        const dy = yy - cy
        const dy2 = dy * dy
        const row = yy * w
        for (let xx = xa; xx <= xb; xx++) {
          const dx = xx - cx
          const d2 = dx * dx + dy2
          if (d2 >= reach2) continue
          const d = Math.sqrt(d2)
          const i = row + xx
          if (d < dist[i]) {
            dist[i] = d
            hard[i] = hv
            clsField[i] = e.cls[k]
          }
        }
      }
    }
  }
  return {
    edges,
    reach,
    dist,
    hard,
    cls: clsField,
    focal,
    adjHard: (a, b) => {
      const e = adj.get(a < b ? `${a},${b}` : `${b},${a}`)
      return e ? e.sum / e.n : undefined
    },
    makeRun: (spec) => buildEdgeRun(rc, spec),
  }
}

interface RunCtx {
  fc: FrameCtx
  plan: PlanMap
  planes: PlaneMap
  focal: Focal | null
  zN: number
  zR: number
  probeIn: number
  probeOut: number
  posHash: (x: number, y: number) => number
  surfaceNoise: (x: number, y: number) => number
  adj: Map<string, { sum: number; n: number }>
}

function buildEdgeRun(rc: RunCtx, spec: RunSpec): EdgeRun {
  const { fc, plan, planes, focal, zN, zR, probeIn, probeOut, posHash, surfaceNoise, adj } = rc
  const { S, id } = spec
  const params = fc.params
  const g = fc.g
  const w = g.width
  const h = g.height
  const scale = g.scale
  const pl = id >= 0 ? planes.planes[id] : null
  const n = S.length
  const type = spec.type
  const q = S[0].q
  // the two sides' values: the planes' means, or (a contour) the pixels' own
  const uAs = spec.uA
  const uBs = spec.uB
  const uA0 = uAs ? meanOf(uAs, n) : pl ? pl.u : 0
  const uB0 = uBs ? meanOf(uBs, n) : q >= 0 ? planes.planes[q].u : plan.uCanvas
  const contrast = uAs || uBs ? meanAbsDiff(uAs, uBs, uA0, uB0, n) : Math.abs(uA0 - uB0)
  const hv = new Float32Array(n)
  const raw = new Uint8Array(n)
  const keys = new Uint32Array(n)
  const pts = new Float32Array(2 * n)
  const nrm = new Float32Array(2 * n)
  for (let i = 0; i < n; i++) {
    const s = S[i]
    const x = s.p[0]
    const y = s.p[1]
    const ix = clamp(Math.round(x + s.nx * probeIn), 0, w - 1)
    const iy = clamp(Math.round(y + s.ny * probeIn), 0, h - 1)
    const ox = clamp(Math.round(x - s.nx * probeOut), 0, w - 1)
    const oy = clamp(Math.round(y - s.ny * probeOut), 0, h - 1)
    const ii = iy * w + ix
    const oi = oy * w + ox
    // a transition inside one form needs a bigger value jump to read as hard than an outline does
    const uA = uAs ? uAs[i] : uA0
    const uB = uBs ? uBs[i] : uB0
    const con = Math.abs(uA - uB)
    const t: { c: number; k: number; f: number; s: number; d: number; x: number } = {
      c: type === 'internal' ? smooth(0.06, 0.6, con) : smooth(0.04, 0.34, con),
      k: 0,
      f: 0,
      s: smooth(0.28, 0.8, (uA + uB) / 2),
      d: 0,
      x: 0,
    }
    // curvature of the form where the transition happens (the normals either side of the edge)
    if (type === 'internal') {
      const d = clamp(
        g.normal[3 * ii] * g.normal[3 * oi] + g.normal[3 * ii + 1] * g.normal[3 * oi + 1] + g.normal[3 * ii + 2] * g.normal[3 * oi + 2],
        -1,
        1,
      )
      const distCss = (Math.hypot(ix - ox, iy - oy) || 1) * scale
      t.k = smooth(0.01, 0.06, (Math.acos(d) / distCss) * 0.875)
    } else t.k = type === 'silhouette' ? 0.55 : 0.3
    // focal emphasis
    if (focal) for (const fp of focal.pts) t.f = Math.max(t.f, Math.exp(-((Math.hypot(x - fp[0], y - fp[1]) / focal.R) ** 2)))
    t.d = Number.isFinite(g.depth[ii]) ? 1 - smooth(0, 1, (g.depth[ii] - zN) / zR) : 0
    t.x = type === 'shadow' ? 1 - smooth(8, 110, planes.dObj[ii] * scale) : 0
    let hh = edgeHardness(type, t, params) + params.edges.noise * surfaceNoise(x + s.nx * probeIn, y + s.ny * probeIn) // a long edge can go firm, soft, firm
    if (con < 0.03) hh = Math.min(hh, params.edges.lostBelow - 0.01) // no visible transition: lost
    hv[i] = clamp(hh, 0, 1)
    raw[i] = edgeClassOf(hv[i], params)
    // the surface under the sample, on the figure's side of the edge (the other side of a silhouette is the background, which has no
    // surface: it was keyed there, and every silhouette sample got the key 0)
    keys[i] = posHash(x + s.nx * probeIn, y + s.ny * probeIn)
    pts[2 * i] = x
    pts[2 * i + 1] = y
    nrm[2 * i] = s.nx
    nrm[2 * i + 1] = s.ny
  }
  const cls = smoothClasses(raw)
  if (id >= 0 && q >= 0 && !uAs) {
    const key = q < id ? `${q},${id}` : `${id},${q}`
    const a = adj.get(key) ?? { sum: 0, n: 0 }
    for (let i = 0; i < n; i++) {
      a.sum += hv[i]
      a.n++
    }
    adj.set(key, a)
  }
  return { a: id, b: q, type, pts, nrm, h: hv, cls, keys, uA: uA0, uB: uB0, contrast, mark: spec.mark }
}

// The class of each sample as the median of the 7 samples about it (the ends
// repeat), so an edge does not flicker between classes.
export function smoothClasses(raw: Uint8Array): Uint8Array {
  const n = raw.length
  const out = new Uint8Array(n)
  const win = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let k = -3; k <= 3; k++) win[k + 3] = raw[clamp(i + k, 0, n - 1)]
    win.sort((a, b) => a - b)
    out[i] = win[3]
  }
  return out
}

function meanOf(a: ArrayLike<number>, n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += a[i]
  return s / n
}

function meanAbsDiff(uAs: ArrayLike<number> | undefined, uBs: ArrayLike<number> | undefined, uA0: number, uB0: number, n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs((uAs ? uAs[i] : uA0) - (uBs ? uBs[i] : uB0))
  return s / n
}

// ---- a stroke's environment ----

// The class of the edge nearest the stroke (with contrast ≥ 0.05, within
// `reach`), else the hardness a stroke has away from edges: 0.52 + 0.26·light
// − 0.28·shadow. `xs`/`ys` sample the stroke's path in CSS px.
export function strokeEdgeClass(
  fc: FrameCtx,
  map: EdgeMap,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  light: number,
  shadow: number,
): { cls: number; hardness: number; nearEdge: boolean } {
  const g = fc.g
  let bestD = Number.POSITIVE_INFINITY
  let bestH = 0
  let bestI = 0
  for (let q = 0; q < count; q++) {
    const gx = Math.floor(xs[q] / g.scale)
    const gy = Math.floor(ys[q] / g.scale)
    if (gx < 0 || gy < 0 || gx >= g.width || gy >= g.height) continue
    const i = gy * g.width + gx
    const d = map.dist[i]
    if (d < map.reach && d < bestD) {
      bestD = d
      bestH = map.hard[i]
      bestI = i
    }
  }
  // the class is the nearest sample's smoothed one (the hardness is its raw value)
  if (bestD < map.reach) return { cls: map.cls[bestI], hardness: bestH, nearEdge: true }
  const interior = clamp(0.52 + 0.26 * light - 0.28 * shadow, 0.1, 0.9)
  return { cls: edgeClassOf(interior, fc.params), hardness: interior, nearEdge: false }
}
