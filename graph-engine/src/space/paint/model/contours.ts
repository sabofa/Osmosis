// Contours (spec §3.6, M7) and the edge strokes (§3.7 role 7).
//
// Silhouette and crease edges are CPU-extracted contour polylines from the
// MESHES, not from pixels: the zero crossings of n·v on the triangles (the
// silhouette of a smooth form), the border of an open mesh, and the creases
// where two faces meet at a sharp angle. They are chained into polylines, kept
// where the G-buffer shows them, resampled, and scored by the same hardness
// rules as every other edge (the contrast of the figure's value against what
// lies beyond, or against the canvas where nothing does). A segment of one
// class becomes 'edge' strokes: a crisp loaded line where it is found, a
// wide drag and scumbled pulls where it is soft, strokes bridging both sides
// where it is lost.
//
// The same stroke generator paints the internal and cast-shadow edges between
// planes (edges.ts), with the sides' colours from the planes.
//
// Vertices that coincide (a seam, the pole of a latitude-longitude sphere) are
// merged, so a closed form has no border.
//
// Ported from the approved mockup (edges.js edgeStrokeJobs, paint-math.js).

import { randomFor } from '../../../style/random'
import type { MeshMark } from '../../scene/types'
import { PATH_POINTS, type Oklab } from '../types'
import { mixLab as mixLabs } from './colour'
import { behaviourOf, resample, type EdgeRun, type Sample } from './edges'
import { clamp, vcross, vdot, vlen, type V3 } from './math'
import { polylinePath, roleIndex, type PaintCtx, type StrokeDraft } from './strokes'
import { project, pxPerUnit, toEye } from './view'

// ---- the meshes' own lines ----

interface Canon {
  // Canonical vertex id of every vertex (coincident vertices share one).
  id: Uint32Array
  // The count of canonical vertices and a position of each.
  count: number
}
const canons = new WeakMap<MeshMark, Canon>()

function canonOf(mesh: MeshMark): Canon {
  const have = canons.get(mesh)
  if (have) return have
  const n = mesh.positions.length / 3
  const id = new Uint32Array(n)
  const seen = new Map<string, number>()
  let count = 0
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(mesh.positions[3 * i] * 1e5)},${Math.round(mesh.positions[3 * i + 1] * 1e5)},${Math.round(mesh.positions[3 * i + 2] * 1e5)}`
    let c = seen.get(key)
    if (c === undefined) {
      c = count++
      seen.set(key, c)
    }
    id[i] = c
  }
  const out = { id, count }
  canons.set(mesh, out)
  return out
}

const lines = new WeakMap<MeshMark, Float64Array[]>()

// The border of an open mesh and its sharp creases, as polylines (xyz per vertex). Static per mesh.
function staticLines(mesh: MeshMark): Float64Array[] {
  const have = lines.get(mesh)
  if (have) return have
  const { id } = canonOf(mesh)
  const p = mesh.positions
  const nt = Math.floor(mesh.indices.length / 3)
  interface E {
    a: number
    b: number
    count: number
    t0: number
    t1: number
  }
  const edges = new Map<number, E>()
  const V = canonOf(mesh).count
  const faceNormal = (t: number): V3 => {
    const a = 3 * mesh.indices[3 * t], b = 3 * mesh.indices[3 * t + 1], c = 3 * mesh.indices[3 * t + 2]
    const e1: V3 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const e2: V3 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    const n = vcross(e1, e2)
    const l = vlen(n)
    return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]
  }
  for (let t = 0; t < nt; t++) {
    const v = [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]]
    for (let k = 0; k < 3; k++) {
      const a = id[v[k]]
      const b = id[v[(k + 1) % 3]]
      if (a === b) continue // a degenerate triangle (a pole)
      const key = Math.min(a, b) * V + Math.max(a, b)
      const e = edges.get(key)
      if (e) {
        e.count++
        e.t1 = t
      } else edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), count: 1, t0: t, t1: -1 })
    }
  }
  // border edges, and creases between faces more than 50 degrees apart
  const selected: [number, number][] = []
  const cosCrease = Math.cos((50 * Math.PI) / 180)
  for (const e of edges.values()) {
    if (e.count === 1) selected.push([e.a, e.b])
    else if (e.count === 2) {
      const n0 = faceNormal(e.t0)
      const n1 = faceNormal(e.t1)
      if (vlen(n0) > 0 && vlen(n1) > 0 && vdot(n0, n1) < cosCrease) selected.push([e.a, e.b])
    }
  }
  // a position for each canonical vertex
  const pos = new Map<number, V3>()
  for (let i = 0; i < id.length; i++) if (!pos.has(id[i])) pos.set(id[i], [p[3 * i], p[3 * i + 1], p[3 * i + 2]])
  const out = chainEdges(selected).map((chain) => {
    const f = new Float64Array(3 * chain.length)
    chain.forEach((v, i) => f.set(pos.get(v) as V3, 3 * i))
    return f
  })
  lines.set(mesh, out)
  return out
}

// Chain edges (pairs of vertex ids) into polylines of vertex ids.
function chainEdges(edges: [number, number][]): number[][] {
  const adj = new Map<number, number[]>()
  edges.forEach((e, i) => {
    for (const v of e) {
      const l = adj.get(v)
      if (l) l.push(i)
      else adj.set(v, [i])
    }
  })
  const used = new Uint8Array(edges.length)
  const out: number[][] = []
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const chain = [edges[i][0], edges[i][1]]
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? chain[chain.length - 1] : chain[0]
        const nxt = (adj.get(end) ?? []).find((q) => !used[q])
        if (nxt === undefined) break
        used[nxt] = 1
        const o = edges[nxt][0] === end ? edges[nxt][1] : edges[nxt][0]
        if (dir) chain.push(o)
        else chain.unshift(o)
      }
    }
    out.push(chain)
  }
  return out
}

// The silhouette of a mesh in this view: the zero crossings of n·v over its triangles.
function silhouetteLines(an: PaintCtx, mesh: MeshMark): Float64Array[] {
  const fc = an.fc
  const { id } = canonOf(mesh)
  const V = canonOf(mesh).count
  const p = mesh.positions
  const nv = p.length / 3
  const s = new Float64Array(nv)
  const ve = [0, 0, 0]
  for (let i = 0; i < nv; i++) {
    const nx = mesh.normals[3 * i], ny = mesh.normals[3 * i + 1], nz = mesh.normals[3 * i + 2]
    if (nx === 0 && ny === 0 && nz === 0) {
      s[i] = 1
      continue
    }
    toEye(fc, p[3 * i], p[3 * i + 1], p[3 * i + 2], ve)
    s[i] = nx * ve[0] + ny * ve[1] + nz * ve[2]
  }
  // each triangle that changes sign gives a segment between two edge crossings
  const pts = new Map<number, V3>()
  const segs: [number, number][] = []
  const cross = (i: number, j: number): number => {
    const a = id[i], b = id[j]
    const key = Math.min(a, b) * V + Math.max(a, b)
    if (!pts.has(key)) {
      const t = s[i] / (s[i] - s[j])
      pts.set(key, [p[3 * i] + (p[3 * j] - p[3 * i]) * t, p[3 * i + 1] + (p[3 * j + 1] - p[3 * i + 1]) * t, p[3 * i + 2] + (p[3 * j + 2] - p[3 * i + 2]) * t])
    }
    return key
  }
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t], i1 = mesh.indices[t + 1], i2 = mesh.indices[t + 2]
    const p0 = s[i0] > 0, p1 = s[i1] > 0, p2 = s[i2] > 0
    if (p0 === p1 && p1 === p2) continue
    // the lone vertex of its sign, and the two edges that leave it
    let lone: number, b: number, c: number
    if (p0 !== p1 && p0 !== p2) [lone, b, c] = [i0, i1, i2]
    else if (p1 !== p0 && p1 !== p2) [lone, b, c] = [i1, i2, i0]
    else [lone, b, c] = [i2, i0, i1]
    segs.push([cross(lone, b), cross(lone, c)])
  }
  // chain by the crossing's key
  const keys = [...pts.keys()]
  const index = new Map<number, number>()
  keys.forEach((k, i) => index.set(k, i))
  const chains = chainEdges(segs.map(([a, b]) => [index.get(a) as number, index.get(b) as number] as [number, number]))
  return chains.map((chain) => {
    const f = new Float64Array(3 * chain.length)
    chain.forEach((v, i) => f.set(pts.get(keys[v]) as V3, 3 * i))
    return f
  })
}

// ---- contours as edge runs ----

// Silhouette, border and crease runs for every opaque figure mesh in view,
// scored (edges.ts makeRun). Their class says how found or lost each stretch is.
export function contourRuns(an: PaintCtx): EdgeRun[] {
  const { fc, plan, planes, edges, set } = an
  const g = fc.g
  const scale = g.scale
  const probeIn = Math.max(2, 3 / scale)
  const out: EdgeRun[] = []
  const used = new Set<number>()
  for (let k = 0; k < an.vis.count; k++) used.add(set.mark[an.vis.idx[k]])
  const pt = [0, 0, 0]
  fc.scene.marks.forEach((mark, m) => {
    if (mark.kind !== 'mesh' || mark.style.opacity < 1 || fc.ground[m] === 1 || !used.has(m)) return
    const polylines = [...staticLines(mark), ...silhouetteLines(an, mark)]
    for (const poly of polylines) {
      const n = poly.length / 3
      if (n < 2) continue
      // project, and keep where the G-buffer shows this mesh
      const xs: number[] = []
      const ys: number[] = []
      const runs: [number[], number[]][] = []
      const flush = () => {
        if (xs.length >= 2) runs.push([xs.slice(), ys.slice()])
        xs.length = 0
        ys.length = 0
      }
      let prevVisible = false
      for (let i = 0; i < n; i++) {
        const x = poly[3 * i], y = poly[3 * i + 1], z = poly[3 * i + 2]
        if (!project(fc, x, y, z, pt)) {
          flush()
          prevVisible = false
          continue
        }
        const visible = seenBy(an, m, pt[0], pt[1], pt[2], x, y, z)
        if (visible) {
          // bring the run's ends to the transition by bisection along the segment
          if (!prevVisible && i > 0 && xs.length === 0) {
            const e = transition(an, m, poly, i - 1, i)
            if (e) {
              xs.push(e[0])
              ys.push(e[1])
            }
          }
          xs.push(pt[0])
          ys.push(pt[1])
        } else {
          if (prevVisible && xs.length > 0) {
            const e = transition(an, m, poly, i, i - 1)
            if (e) {
              xs.push(e[0])
              ys.push(e[1])
            }
          }
          flush()
        }
        prevVisible = visible
      }
      flush()
      for (const [rx0, ry0] of runs) for (const [rx, ry] of splitAtCorners(rx0, ry0)) {
        // resample every 2 CSS px
        const pts2: [number, number][] = rx.map((x, i) => [x, ry[i]])
        const rs = resample(pts2, 2)
        if (rs.length < 8) continue
        const S: Sample[] = []
        const uA: number[] = []
        const uB: number[] = []
        const flushRun = () => {
          if (S.length >= 8) {
            out.push(edges.makeRun({ type: 'silhouette', mark: m, id: -1, S: S.slice(), uA: uA.slice(), uB: uB.slice() }))
          }
          S.length = 0
          uA.length = 0
          uB.length = 0
        }
        for (let i = 0; i < rs.length; i++) {
          const a = rs[Math.max(0, i - 1)]
          const b = rs[Math.min(rs.length - 1, i + 1)]
          let tx = b[0] - a[0]
          let ty = b[1] - a[1]
          const l = Math.hypot(tx, ty) || 1
          tx /= l
          ty /= l
          const gx = rs[i][0] / scale
          const gy = rs[i][1] / scale
          let nx = -ty
          let ny = tx
          const pxA = [Math.round(gx + nx * probeIn), Math.round(gy + ny * probeIn)]
          const pxB = [Math.round(gx - nx * probeIn), Math.round(gy - ny * probeIn)]
          const idxOf = (q: number[]) => (q[0] < 0 || q[1] < 0 || q[0] >= g.width || q[1] >= g.height ? -1 : q[1] * g.width + q[0])
          const ia = idxOf(pxA)
          const ib = idxOf(pxB)
          const okA = ia >= 0 && g.mark[ia] === m
          const okB = ib >= 0 && g.mark[ib] === m
          if (!okA && !okB) {
            flushRun()
            continue
          }
          // the inside is the side of this mesh; where both are, the nearer
          let inside = ia
          let outside = ib
          if (okA && okB ? g.depth[ib] < g.depth[ia] : !okA) {
            inside = ib
            outside = ia
            nx = -nx
            ny = -ny
          }
          const q = outside >= 0 && g.mark[outside] >= 0 ? planes.plane[outside] : -1
          S.push({ p: [gx, gy], nx, ny, q, type: 'silhouette' })
          uA.push(plan.u[inside])
          uB.push(outside >= 0 && g.mark[outside] >= 0 ? plan.u[outside] : plan.uCanvas)
        }
        flushRun()
      }
    }
  })
  return out
}

// Cut a screen polyline at its sharp corners (a turn over 35 degrees), each corner ending one piece and starting the next.
function splitAtCorners(xs: number[], ys: number[]): [number[], number[]][] {
  const out: [number[], number[]][] = []
  let a = 0
  const cos = Math.cos((35 * Math.PI) / 180)
  for (let i = 1; i < xs.length - 1; i++) {
    const ax = xs[i] - xs[i - 1], ay = ys[i] - ys[i - 1]
    const bx = xs[i + 1] - xs[i], by = ys[i + 1] - ys[i]
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    if (la < 1e-9 || lb < 1e-9) continue
    if ((ax * bx + ay * by) / (la * lb) < cos) {
      out.push([xs.slice(a, i + 1), ys.slice(a, i + 1)])
      a = i
    }
  }
  out.push([xs.slice(a), ys.slice(a)])
  return out.filter((r) => r[0].length >= 2)
}

// Does the G-buffer show world point (x, y, z), projected to (sx, sy, depth), as this mesh?
function seenBy(an: PaintCtx, mark: number, sx: number, sy: number, depth: number, x: number, y: number, z: number): boolean {
  const fc = an.fc
  const g = fc.g
  const ppu = pxPerUnit(fc, x, y, z)
  // a contour lies where depth runs away fastest: be generous
  const eps = (g.scale / ppu) * 12 + 0.02
  const gx = Math.floor(sx / g.scale)
  const gy = Math.floor(sy / g.scale)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const qx = gx + dx, qy = gy + dy
      if (qx < 0 || qy < 0 || qx >= g.width || qy >= g.height) continue
      const q = qy * g.width + qx
      if (g.mark[q] === mark && Math.abs(g.depth[q] - depth) <= eps) return true
    }
  }
  return false
}

// Where along the polyline segment from vertex `from` (visibility changes at
// `to`) the view changes, by bisection; the CSS px point, or null.
function transition(an: PaintCtx, mark: number, poly: Float64Array, a: number, b: number): [number, number] | null {
  const fc = an.fc
  const out = [0, 0, 0]
  let lo = 0
  let hi = 1
  const at = (t: number): [number, number, number] => [
    poly[3 * a] + (poly[3 * b] - poly[3 * a]) * t,
    poly[3 * a + 1] + (poly[3 * b + 1] - poly[3 * a + 1]) * t,
    poly[3 * a + 2] + (poly[3 * b + 2] - poly[3 * a + 2]) * t,
  ]
  // a is one visibility, b the other: find the boundary
  const aVisible = (() => {
    const p = at(0)
    return project(fc, p[0], p[1], p[2], out) && seenBy(an, mark, out[0], out[1], out[2], p[0], p[1], p[2])
  })()
  for (let it = 0; it < 8; it++) {
    const mid = (lo + hi) / 2
    const p = at(mid)
    const vis = project(fc, p[0], p[1], p[2], out) && seenBy(an, mark, out[0], out[1], out[2], p[0], p[1], p[2])
    if (vis === aVisible) lo = mid
    else hi = mid
  }
  const p = at(aVisible ? lo : hi)
  return project(fc, p[0], p[1], p[2], out) ? [out[0], out[1]] : null
}

// ---- edge strokes ----

// The colour of one side of an edge: the curve at that side's value over its
// local colour (the plane's mean particle colour, the mesh's, or bare canvas).
function sideColour(an: PaintCtx, plane: number, mark: number, u: number, rng: ReturnType<typeof randomFor>, lScale?: number): Oklab {
  const { fc, curve, planes } = an
  const pl = plane >= 0 ? planes.planes[plane] : null
  let local: Oklab
  if (pl && pl.ground) local = an.groundLocal
  else if (pl && an.planeHasColour[plane] === 1) local = [an.planeColour[3 * plane], an.planeColour[3 * plane + 1], an.planeColour[3 * plane + 2]]
  else if (fc.ground[mark] === 1) local = an.groundLocal
  else local = [an.markColour[3 * mark], an.markColour[3 * mark + 1], an.markColour[3 * mark + 2]]
  const cp = fc.params.curve
  return curve.lab({
    local,
    u: clamp(u, 0.05, 0.98),
    nz: pl ? pl.nz : undefined,
    planeHue: pl && !pl.ground ? pl.hOff : 0,
    planeChroma: pl && !pl.ground ? pl.cOff : 0,
    lScale,
    j: [rng.gauss() * 0.5 * cp.devL, rng.gauss() * (5 / 12) * cp.devC, rng.gauss() * (6 / 11) * cp.devH],
  })
}

// Cut a run of edge samples into the stretches that each become strokes: at
// every change of class, at `maxSamples` at the latest, and in between at a
// sample whose surface-position hash (the keys) falls under `p` once the
// stretch is `minSeg` long, so the cuts stay where they are on the surface as
// the camera orbits. A stretch under 11 samples joins the one before it.
export function segmentRun(cls: Uint8Array, keys: Uint32Array, maxSamples: number, minSeg = 20, p = 0.12): [number, number, number][] {
  const n = cls.length
  const segs: [number, number, number][] = []
  let s0 = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || cls[i] !== cls[s0] || i - s0 >= maxSamples || (i - s0 >= minSeg && keys[i] / 4294967296 < p)) {
      segs.push([s0, i - 1, cls[s0]])
      s0 = i
    }
  }
  for (let k = segs.length - 1; k > 0; k--) {
    if (segs[k][1] - segs[k][0] < 11) {
      segs[k - 1][1] = segs[k][1]
      segs.splice(k, 1)
    }
  }
  return segs
}

// Paint every run as edge strokes (an 'edge'-role layer: after reflected light, before the lines).
export function edgeStrokes(an: PaintCtx, runs: EdgeRun[]): void {
  const { fc } = an
  const params = fc.params
  const g = fc.g
  const scale = g.scale
  const rp = params.roles.edge
  const minContrast = params.detect.edgeMinContrast
  const stepCss = 2
  // a crisp stroke runs up to three times the role's length; a pull or a bridge is shorter
  const maxSamples = Math.max(12, Math.round((3 * rp.length) / stepCss))
  for (const e of runs) {
    if (e.contrast < minContrast) continue
    const segs = segmentRun(e.cls, e.keys, maxSamples)
    for (const [a, b, cl] of segs) {
      if (b - a < 6) continue
      const mid = Math.floor((a + b) / 2)
      const rng = randomFor(`paint/edge/${e.keys[mid]}/${a}`, params.seed)
      // the role's density thins the edge strokes, by a seeded draw
      if (rng.next() >= rp.density) continue
      const beh = behaviourOf(cl)
      const mx = e.pts[2 * mid] * scale
      const my = e.pts[2 * mid + 1] * scale
      const gi = clamp(Math.round(e.pts[2 * mid + 1]), 0, g.height - 1) * g.width + clamp(Math.round(e.pts[2 * mid]), 0, g.width - 1)
      const depth = Number.isFinite(g.depth[gi]) ? g.depth[gi] : 0
      // the two sides' colours
      const planeA = e.a
      const uLo = Math.min(e.uA, e.uB)
      const labA = sideColour(an, planeA, e.mark, e.uA, rng)
      const labB: Oklab =
        e.type === 'silhouette' ? [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]] : sideColour(an, e.b, e.mark, e.uB, rng)
      const lighterIsA = e.uA >= e.uB
      const lighter = lighterIsA ? labA : labB
      const darker = lighterIsA ? labB : labA
      const baseDraft = (): Omit<StrokeDraft, 'path' | 'width' | 'lab' | 'alpha' | 'order' | 'jit0' | 'jit1'> => ({
        role: roleIndex('edge'),
        depth,
        u: e.uA,
        cell: e.keys[mid],
        mx,
        my,
        colormapped: false,
        load: rp.load * beh.loadMul * (0.9 + 0.2 * rng.next()),
        impasto: rp.impasto * beh.impastoMul,
        bristles: Math.max(1, Math.round(rp.bristles * rng.range(0.88, 1.12))),
        bristleVar: clamp(rp.bristleVar * beh.bristleVarMul, 0, 1),
        dry: Math.max(rp.dry * 0.5, beh.dryMin),
        wet: Math.max(rp.wet * beh.wetMul, beh.wetMin),
        endSoft: beh.endSoft,
        edge: cl,
        seed: (e.keys[mid] ^ (a * 0x9e3779b1)) >>> 0,
      })
      const push = (path: Float32Array, width: Float32Array, lab: Oklab, alpha: number) => {
        an.drafts.push({ ...baseDraft(), path, width, lab, alpha, jit0: rng.gauss(), jit1: rng.gauss(), order: an.nextOrder++ })
      }
      if (cl >= 2) {
        // distinct: a crisp, loaded stroke along the edge, darker than the darker side
        const uE = clamp(uLo - (cl === 3 ? 0.12 : 0.06), 0.1, 0.8)
        const lab = sideColour(an, planeA, e.mark, uE, rng, 0.9)
        const off = rng.range(-1, 1)
        const xs: number[] = []
        const ys: number[] = []
        for (let i = a; i <= b; i++) {
          xs.push(e.pts[2 * i] * scale + e.nrm[2 * i] * off)
          ys.push(e.pts[2 * i + 1] * scale + e.nrm[2 * i + 1] * off)
        }
        const path = new Float32Array(2 * PATH_POINTS)
        const width = new Float32Array(PATH_POINTS)
        polylinePath(xs, ys, xs.length, rp.width * (cl === 3 ? 0.7 : 0.475) * rng.range(0.88, 1.12), true, false, path, width)
        push(path, width, lab, cl === 3 ? 1 : 0.85)
      } else if (cl === 1) {
        // blended: a wide dragged stroke along the boundary, and short scumbled pulls from the lighter side into the darker
        const xs: number[] = []
        const ys: number[] = []
        for (let i = a; i <= b; i++) {
          xs.push(e.pts[2 * i] * scale)
          ys.push(e.pts[2 * i + 1] * scale)
        }
        const path = new Float32Array(2 * PATH_POINTS)
        const width = new Float32Array(PATH_POINTS)
        polylinePath(xs, ys, xs.length, rp.width * 2.6 * rng.range(0.88, 1.12), true, false, path, width)
        push(path, width, mixLabs(labA, labB, 0.5), 0.8)
        const nd = Math.max(1, Math.round(((b - a) * stepCss) / 34))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          const dir0: [number, number] = lighterIsA ? [-e.nrm[2 * ii], -e.nrm[2 * ii + 1]] : [e.nrm[2 * ii], e.nrm[2 * ii + 1]]
          const rot = rng.range(-0.35, 0.35)
          const dx = dir0[0] * Math.cos(rot) - dir0[1] * Math.sin(rot)
          const dy = dir0[0] * Math.sin(rot) + dir0[1] * Math.cos(rot)
          const len = rp.length * (22 / 30) * rng.range(0.8, 1.2)
          const cx = e.pts[2 * ii] * scale
          const cy = e.pts[2 * ii + 1] * scale
          const p2 = new Float32Array(2 * PATH_POINTS)
          const w2 = new Float32Array(PATH_POINTS)
          polylinePath([cx - dx * len * 0.45, cx + dx * len * 0.55], [cy - dy * len * 0.45, cy + dy * len * 0.55], 2, rp.width * 1.9 * rng.range(0.88, 1.12), true, false, p2, w2)
          push(p2, w2, mixLabs(lighter, darker, 0.3), 0.75)
        }
      } else {
        // lost: a few strokes that bridge both sides, carrying one colour into the other
        const nd = Math.max(1, Math.round(((b - a) * stepCss) / 42))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          const len = rp.length * (26 / 30) * rng.range(0.85, 1.15)
          const rot = rng.range(-0.3, 0.3)
          const dx = -e.nrm[2 * ii] * Math.cos(rot) + e.nrm[2 * ii + 1] * Math.sin(rot)
          const dy = -e.nrm[2 * ii] * Math.sin(rot) - e.nrm[2 * ii + 1] * Math.cos(rot)
          const cx = e.pts[2 * ii] * scale
          const cy = e.pts[2 * ii + 1] * scale
          const p2 = new Float32Array(2 * PATH_POINTS)
          const w2 = new Float32Array(PATH_POINTS)
          polylinePath([cx - dx * len * 0.5, cx + dx * len * 0.5], [cy - dy * len * 0.5, cy + dy * len * 0.5], 2, rp.width * 1.8 * rng.range(0.88, 1.12), true, false, p2, w2)
          push(p2, w2, mixLabs(labA, labB, 0.5), 0.6)
        }
      }
    }
  }
}
