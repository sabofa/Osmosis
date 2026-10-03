// The world planes (the baked painting, spec §14; plan Task 2): the painter's planes (spec §3.6) found on the meshes
// themselves, in the world, once.
//
// The per-frame model (model/planes.ts segmentPlanes) clusters the VISIBLE G-buffer pixels by the view-space direction of
// their normal and by their value zone. The bake does it on the refined surface's triangles (bake/plan.ts), by the WORLD
// direction of the side's normal and the zone, so a plane is the same in every view and a stroke's step value does not
// move as the camera does.
//
//   THE KEY of a triangle (per mesh and side):
//     * figure: the side normal at the centroid, as a latitude-longitude cell of planeCellDeg degrees (the longitude cell
//       widened toward the poles), WORLD axes with z up, and the triangle's zone: the zone most of its vertices have (on a
//       three-way tie, the zone of the vertex whose plan value u is the median);
//     * ground (bare table): whether the triangle is cast shadow (its zone is the cast zone) and, for a cast shadow, how far
//       from the thing that casts it, in px at the reference scale (the mean shadow distance of the ray hits, thresholds 26
//       and 64: the model's bands, now measured from the occluder and not from the figure's silhouette on the screen).
//   COMPONENTS are the connected sets of equal key over the surface's triangle adjacency (across seams too: bake/surface.ts
//   keeps the adjacency on canonical vertices).
//   MERGE as the model's: a piece smaller than planeMinPx CSS px² (at the reference scale) that is not ground joins the
//   neighbour of the same mesh, side and FAMILY (light and half-tone; core, reflected and cast) it shares the longest border
//   with (a world length), a neighbour of its own zone counting double; a piece with no such neighbour stays, small. (A
//   core-shadow sliver merged into a half-tone plane would be painted at the half-tone's value: the value rule holds across
//   the planes.)
//
// SIDES. A plane lies on one side of one mesh: an open mesh has planes on both its sides, with the normal turned for side -1;
// a closed opaque mesh has side +1 (its outside) only, and its planes' `side` is 0 (the contract's convention for a stroke
// on a closed mesh). A veil has no planes: the per-frame model has none either (it is not in the G-buffer), and a stroke on
// it takes its plan value as it is (stepValueWorld with plane -1).

import type { Curve } from '../model/curve'
import { clamp, D2R } from '../model/math'
import type { PaintParams } from '../params'
import type { Oklab, ParticleSet, SceneColours } from '../types'
import { ZONES } from '../types'
import { zoneFamily, Z_CAST } from '../model/value'
import type { SidePlan, WorldPlan } from './plan'
import { locate, normalOf, type RefinedSurface, type SurfacePoint } from './surface'

// The model's two thresholds on a cast shadow's distance from what casts it (planes.ts: 26 and 64 CSS px).
export const GROUND_BAND_PX: readonly [number, number] = [26, 64]

export interface WorldPlane {
  id: number
  mark: number
  // +1 or -1 the side of an open mesh it lies on; 0 on a closed opaque mesh (its outside).
  side: 1 | -1 | 0
  // World area.
  area: number
  // The dominant zone (an index into ZONES, by area) and its family (value.ts FAM_LIGHT / FAM_SHADOW).
  zone: number
  fam: number
  // The area-weighted mean plan value.
  u: number
  // The area-weighted mean side normal, unit.
  nx: number
  ny: number
  nz: number
  // The area-weighted centroid.
  cx: number
  cy: number
  cz: number
  // Bare table (a ground mesh's plane) and, of that, a plane at least half of whose area is cast shadow.
  ground: boolean
  cast: boolean
  // The plane's hue step (degrees) and chroma step (relative): curve.planeStep(mean normal); 0 on a ground.
  hOff: number
  cOff: number
  // The mean local colour (OKLab) of the particles on the plane; the mark's colour where there are none.
  colour: [number, number, number]
}

export interface WorldPlanes {
  // The plane id of every refined triangle, per mark, per side index (0 = side +1, 1 = side -1): null for a mark that is not an
  // opaque mesh and for the side an opaque closed mesh does not have.
  planeOf: (Int32Array | null)[][]
  planes: WorldPlane[]
}

// A triangle's zone: the zone of most of its vertices; of three different ones, the zone of the vertex whose u is the median.
export function triangleZone(zone: Uint8Array, u: Float32Array, a: number, b: number, c: number): number {
  const za = zone[a]
  const zb = zone[b]
  const zc = zone[c]
  if (za === zb || za === zc) return za
  if (zb === zc) return zb
  const ua = u[a]
  const ub = u[b]
  const uc = u[c]
  if ((ua >= ub && ua <= uc) || (ua <= ub && ua >= uc)) return za
  if ((ub >= ua && ub <= uc) || (ub <= ua && ub >= uc)) return zb
  return zc
}

export function buildWorldPlanes(plan: WorldPlan, particles: ParticleSet, colours: SceneColours, curve: Curve, params: PaintParams): WorldPlanes {
  const nMarks = plan.surfaces.length
  const planeOf: (Int32Array | null)[][] = Array.from({ length: nMarks }, () => [null, null])
  const planes: WorldPlane[] = []
  for (let m = 0; m < nMarks; m++) {
    const s = plan.surfaces[m]
    if (!s || plan.veil[m] === 1) continue
    const ground = plan.ground[m] === 1
    const sides: (1 | -1)[] = s.outsideOnly ? [1] : [1, -1]
    sides.forEach((side, k) => {
      const sp = k === 0 ? plan.front[m] : plan.back[m]
      if (sp) planeOf[m][k] = planesOfSide(plan, m, s, sp, side, ground, curve, params, planes)
    })
  }

  // the mean local colour of the particles on each plane: a particle is on the plane of the refined triangle it stands on, on
  // each side (an open mesh is painted from both). A veil's particles lie on no plane.
  const sum = new Float64Array(3 * planes.length)
  const count = new Uint32Array(planes.length)
  const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  const reach = 0.5 * plan.referenceWorldPerPx
  for (let i = 0; i < particles.count; i++) {
    if (particles.opacity[i] < 1) continue
    const m = particles.mark[i]
    const s = plan.surfaces[m]
    const arrays = planeOf[m]
    if (!s || !arrays || (arrays[0] === null && arrays[1] === null)) continue
    const x = particles.position[3 * i]
    const y = particles.position[3 * i + 1]
    const z = particles.position[3 * i + 2]
    if (!locate(s, x, y, z, particles.normal[3 * i], particles.normal[3 * i + 1], particles.normal[3 * i + 2], reach, hit)) continue
    for (let k = 0; k < 2; k++) {
      const pid = arrays[k] ? arrays[k]![hit.tri] : -1
      if (pid < 0) continue
      sum[3 * pid] += particles.colour[3 * i]
      sum[3 * pid + 1] += particles.colour[3 * i + 1]
      sum[3 * pid + 2] += particles.colour[3 * i + 2]
      count[pid]++
    }
  }
  const markColours = new Map<number, Oklab>()
  for (const pl of planes) {
    if (count[pl.id] > 0) {
      pl.colour = [sum[3 * pl.id] / count[pl.id], sum[3 * pl.id + 1] / count[pl.id], sum[3 * pl.id + 2] / count[pl.id]]
    } else {
      let c = markColours.get(pl.mark)
      if (!c) {
        c = colours.markColour(pl.mark)
        markColours.set(pl.mark, c)
      }
      pl.colour = [c[0], c[1], c[2]]
    }
  }
  return { planeOf, planes }
}

// The planes of one side of one mesh's surface, appended to `out` (their ids are global); the plane id of every triangle.
function planesOfSide(
  plan: WorldPlan, mark: number, s: RefinedSurface, sp: SidePlan, side: 1 | -1, ground: boolean, curve: Curve, params: PaintParams, out: WorldPlane[],
): Int32Array {
  const nt = s.indices.length / 3
  const perPx = plan.referenceWorldPerPx
  const e = params.edges
  const cell = Math.max(1, e.planeCellDeg) * D2R // (a cell under a degree would crowd the key's longitude field; the slider stops at 5)
  const idx = s.indices

  // the key of every triangle
  const zoneT = new Uint8Array(nt)
  const key = new Float64Array(nt)
  const at: SurfacePoint = { tri: 0, b1: 1 / 3, b2: 1 / 3 }
  const n = [0, 0, 0]
  for (let t = 0; t < nt; t++) {
    const a = idx[3 * t]
    const b = idx[3 * t + 1]
    const c = idx[3 * t + 2]
    const zone = triangleZone(sp.zone, sp.u, a, b, c)
    zoneT[t] = zone
    if (ground) {
      if (zone !== Z_CAST) {
        key[t] = 0
        continue
      }
      // the occluder's distance in px at the reference scale: the mean over the vertices that have one (a vertex whose rays were not blocked has none)
      let sum = 0
      let cnt = 0
      for (const v of [a, b, c]) {
        const d = sp.shadowDist[v]
        if (Number.isFinite(d)) {
          sum += d
          cnt++
        }
      }
      const px = cnt > 0 ? sum / cnt / perPx : Infinity
      key[t] = 1 + (px < GROUND_BAND_PX[0] ? 0 : px < GROUND_BAND_PX[1] ? 1 : 2)
    } else {
      at.tri = t
      normalOf(s, at, side, n)
      const lat = Math.asin(clamp(n[2], -1, 1))
      const lon = Math.atan2(n[1], n[0])
      const latI = Math.floor((lat + Math.PI / 2) / cell)
      const step = cell / Math.max(0.35, Math.cos(lat))
      const lonI = Math.floor((lon + Math.PI) / step)
      key[t] = (latI * 4096 + lonI) * 8 + zone
    }
  }

  // connected components of equal key
  const comp = new Int32Array(nt).fill(-1)
  const stack = new Int32Array(nt)
  const compArea: number[] = []
  const compZone: number[] = []
  let nc = 0
  for (let t0 = 0; t0 < nt; t0++) {
    if (comp[t0] >= 0) continue
    let top = 0
    let area = 0
    stack[top++] = t0
    comp[t0] = nc
    const k0 = key[t0]
    while (top > 0) {
      const q = stack[--top]
      area += s.area[q]
      for (let k = 0; k < 3; k++) {
        const u = s.adj[3 * q + k]
        if (u >= 0 && comp[u] < 0 && key[u] === k0) {
          comp[u] = nc
          stack[top++] = u
        }
      }
    }
    compArea.push(area)
    compZone.push(zoneT[t0])
    nc++
  }

  // merge the small pieces into the neighbour they share most border with (the same zone preferred), never across a family
  const parent = Int32Array.from({ length: nc }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  if (!ground) {
    const minArea = e.planeMinPx * perPx * perPx
    const small: number[] = []
    for (let c = 0; c < nc; c++) if (compArea[c] < minArea) small.push(c)
    if (small.length > 0) {
      const isSmall = new Uint8Array(nc)
      for (const c of small) isSmall[c] = 1
      const nb = new Map<number, Map<number, number>>()
      const link = (a: number, b: number, len: number): void => {
        let m = nb.get(a)
        if (!m) {
          m = new Map()
          nb.set(a, m)
        }
        m.set(b, (m.get(b) ?? 0) + len)
      }
      const p = s.positions
      for (let t = 0; t < nt; t++) {
        for (let k = 0; k < 3; k++) {
          const u = s.adj[3 * t + k]
          if (u <= t) continue
          const ca = comp[t]
          const cb = comp[u]
          if (ca === cb || (!isSmall[ca] && !isSmall[cb])) continue
          const v0 = 3 * idx[3 * t + k]
          const v1 = 3 * idx[3 * t + ((k + 1) % 3)]
          const len = Math.hypot(p[v0] - p[v1], p[v0 + 1] - p[v1 + 1], p[v0 + 2] - p[v1 + 2])
          if (isSmall[ca]) link(ca, cb, len)
          if (isSmall[cb]) link(cb, ca, len)
        }
      }
      small.sort((a, b) => compArea[a] - compArea[b] || a - b)
      for (const c of small) {
        const rs = find(c)
        if (compArea[rs] >= minArea) continue
        let best = -1
        let bs = 0
        for (const [b, len] of nb.get(c) ?? []) {
          const rb = find(b)
          if (rb === rs) continue
          // (only a neighbour of the same family)
          if (zoneFamily(compZone[rb]) !== zoneFamily(compZone[rs])) continue
          const v = len * (compZone[rb] === compZone[rs] ? 2 : 1)
          if (v > bs || (v === bs && rb < best)) {
            bs = v
            best = rb
          }
        }
        if (best >= 0) {
          parent[rs] = best
          compArea[best] += compArea[rs]
        }
      }
    }
  }

  // number the planes (in order of their first triangle) and gather their statistics
  interface Acc {
    area: number
    su: number
    sn: [number, number, number]
    sc: [number, number, number]
    zones: number[]
    cast: number
  }
  const first = out.length
  const local = new Int32Array(nc).fill(-1)
  const accs: Acc[] = []
  const planeIds = new Int32Array(nt)
  const o = side * s.orient
  const pos = s.positions
  const nor = s.normals
  for (let t = 0; t < nt; t++) {
    const r = find(comp[t])
    let k = local[r]
    if (k < 0) {
      k = accs.length
      local[r] = k
      accs.push({ area: 0, su: 0, sn: [0, 0, 0], sc: [0, 0, 0], zones: [0, 0, 0, 0, 0], cast: 0 })
    }
    planeIds[t] = first + k
    const acc = accs[k]
    const A = s.area[t]
    const a = idx[3 * t]
    const b = idx[3 * t + 1]
    const c = idx[3 * t + 2]
    acc.area += A
    acc.su += (A * (sp.u[a] + sp.u[b] + sp.u[c])) / 3
    for (let q = 0; q < 3; q++) {
      acc.sn[q] += (A * o * (nor[3 * a + q] + nor[3 * b + q] + nor[3 * c + q])) / 3
      acc.sc[q] += (A * (pos[3 * a + q] + pos[3 * b + q] + pos[3 * c + q])) / 3
    }
    acc.zones[zoneT[t]] += A
    if (zoneT[t] === Z_CAST) acc.cast += A
  }
  accs.forEach((acc, k) => {
    const len = Math.hypot(acc.sn[0], acc.sn[1], acc.sn[2]) || 1
    const nx = acc.sn[0] / len
    const ny = acc.sn[1] / len
    const nz = acc.sn[2] / len
    let zone = 0
    for (let z = 1; z < ZONES.length; z++) if (acc.zones[z] > acc.zones[zone]) zone = z
    const step = ground ? [0, 0] : curve.planeStep(nx, ny, nz)
    const area = acc.area > 0 ? acc.area : 1
    out.push({
      id: first + k,
      mark,
      side: s.outsideOnly ? 0 : side,
      area: acc.area,
      zone,
      fam: zoneFamily(zone),
      u: acc.su / area,
      nx,
      ny,
      nz,
      cx: acc.sc[0] / area,
      cy: acc.sc[1] / area,
      cz: acc.sc[2] / area,
      ground,
      cast: ground && acc.cast / area >= 0.5,
      hOff: step[0],
      cOff: step[1],
      colour: [0, 0, 0],
    })
  })
  return planeIds
}

// A stroke's value: the plane's mean plus planeGradient of its own gradient (`u` is the plan value where the stroke stands), as
// model/planes.ts stepValue; planeId -1 (no plane: a veil) is the plan's own. `follow` (value.ts bandFollow, 0..1) takes the stroke
// from the plane's step to the plan's own value, as stepValue's.
export function stepValueWorld(planes: WorldPlanes, planeId: number, u: number, planeGradient: number, follow = 0): number {
  if (planeId < 0) return u
  const pu = planes.planes[planeId].u
  const stepped = pu + planeGradient * (u - pu)
  return follow > 0 ? stepped + follow * (u - stepped) : stepped
}
