// Planes (spec §3.6): the visible surface clustered by normal direction and
// value zone, so a rounded form turns through several planes, each with its
// own short gradient: "many gradients, not one".
//
// A plane is a connected component of (quantised normal cell × zone) on the
// G-buffer. The cell is a latitude-longitude bin of planeCellDeg degrees (26°)
// on the view-space normal, with the longitude bins widened toward the poles.
// Pieces smaller than planeMinPx CSS px² merge into the neighbour (of the same
// mesh AND of the same family: light, half-tone and highlight; or core, reflected
// and cast shadow) they share the longest border with, preferring the same zone;
// a piece with no neighbour of its family is kept, small. (A core-shadow sliver
// merged into a half-tone plane was painted at the half-tone's value: the value
// rule holds across the planes.) Bare table is split by shadow and by distance
// from the figure (a cast shadow is harder and darker near what casts it).
//
// A stroke's value is the plane's mean plus planeGradient (0.45) of its own
// gradient: stepValue().
//
// Ported from the approved mockup (edges.js segmentPlanes, chamferDist).

import { ZONES } from '../types'
import type { Curve } from './curve'
import { clamp, D2R } from './math'
import type { PlanMap } from './value'
import { zoneFamily, Z_CAST } from './value'
import type { FrameCtx } from './view'

export interface Plane {
  id: number
  // The mesh (mark index) it lies on.
  mark: number
  // Area in G-buffer pixels.
  area: number
  // The dominant zone (an index into ZONES) and the mean plan value.
  zone: number
  u: number
  // The mean world normal, unit.
  nx: number
  ny: number
  nz: number
  // Centroid and bounding box in G-buffer pixels.
  cx: number
  cy: number
  x0: number
  y0: number
  x1: number
  y1: number
  ground: boolean
  // Bare table in the shadow.
  cast: boolean
  // The plane's hue step (degrees) and chroma step (relative), a smooth function of its normal.
  hOff: number
  cOff: number
}

export interface PlaneMap {
  // The plane id of every G-buffer pixel, -1 where empty. Fresh each frame (it is handed to the debug views).
  plane: Int32Array
  planes: Plane[]
  // Distance in G-buffer pixels to the nearest pixel of the figure (not table), 0 on it.
  dObj: Float32Array
}

// Two-pass chamfer distance (1, 1.414) from the set pixels of `mask`.
export function chamferDist(mask: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : 1e4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.414)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.414)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414)
      }
      d[i] = v
    }
  }
  return d
}

export function segmentPlanes(fc: FrameCtx, plan: PlanMap, curve: Curve): PlaneMap {
  const g = fc.g
  const w = g.width
  const h = g.height
  const n = w * h
  const e = fc.params.edges
  const cell = e.planeCellDeg * D2R
  const minArea = Math.max(1, e.planeMinPx / (g.scale * g.scale))
  const view = fc.view.view
  // view-space axes of the normal: right, up, back
  const rx = view[0], ry = view[4], rz = view[8]
  const ux = view[1], uy = view[5], uz = view[9]
  const bx = view[2], by = view[6], bz = view[10]

  // distance from the figure, for the table's bands
  const figure = new Uint8Array(n)
  for (let i = 0; i < n; i++) figure[i] = g.mark[i] >= 0 && fc.ground[g.mark[i]] !== 1 ? 1 : 0
  const dObj = chamferDist(figure, w, h)
  // bands in G px: the mockup's 26 and 64 CSS px
  const band1 = 26 / g.scale
  const band2 = 64 / g.scale

  const key = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const m = g.mark[i]
    if (m < 0) continue
    if (fc.ground[m] === 1) {
      const cast = plan.zone[i] === Z_CAST ? 1 : 0
      const d = dObj[i]
      const band = cast ? (d < band1 ? 0 : d < band2 ? 1 : 2) : 0
      key[i] = 9_000_000 + (m * 3 + band) * 2 + cast
    } else {
      const nxw = g.normal[3 * i]
      const nyw = g.normal[3 * i + 1]
      const nzw = g.normal[3 * i + 2]
      let nx = nxw * rx + nyw * ry + nzw * rz
      let ny = nxw * ux + nyw * uy + nzw * uz
      let nz = nxw * bx + nyw * by + nzw * bz
      if (nz < 0) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      const lat = Math.asin(clamp(ny, -1, 1))
      const lon = Math.atan2(nx, nz)
      const latI = Math.floor((lat + Math.PI / 2) / cell)
      const step = cell / Math.max(0.35, Math.cos(lat))
      const lonI = Math.floor((lon + Math.PI / 2) / step)
      key[i] = ((m * 64 + latI) * 64 + clamp(lonI, 0, 63)) * 8 + plan.zone[i]
    }
  }

  // connected components of equal key
  const lab = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const compArea: number[] = []
  const compMark: number[] = []
  const compZone: number[] = []
  let nc = 0
  for (let i = 0; i < n; i++) {
    if (key[i] < 0 || lab[i] >= 0) continue
    let sp = 0
    let area = 0
    stack[sp++] = i
    lab[i] = nc
    const k0 = key[i]
    while (sp) {
      const q = stack[--sp]
      area++
      const x = q % w
      const y = (q - x) / w
      if (x > 0 && lab[q - 1] < 0 && key[q - 1] === k0) { lab[q - 1] = nc; stack[sp++] = q - 1 }
      if (x < w - 1 && lab[q + 1] < 0 && key[q + 1] === k0) { lab[q + 1] = nc; stack[sp++] = q + 1 }
      if (y > 0 && lab[q - w] < 0 && key[q - w] === k0) { lab[q - w] = nc; stack[sp++] = q - w }
      if (y < h - 1 && lab[q + w] < 0 && key[q + w] === k0) { lab[q + w] = nc; stack[sp++] = q + w }
    }
    compArea.push(area)
    compMark.push(g.mark[i])
    compZone.push(plan.zone[i])
    nc++
  }

  // merge the tiny pieces into the neighbour they share most border with (the same zone preferred)
  const parent = Array.from({ length: nc }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const nb: Map<number, number>[] = Array.from({ length: nc }, () => new Map())
  const link = (a: number, b: number) => {
    if (b < 0 || a === b || compMark[a] !== compMark[b]) return
    nb[a].set(b, (nb[a].get(b) ?? 0) + 1)
    nb[b].set(a, (nb[b].get(a) ?? 0) + 1)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = lab[i]
      if (a < 0) continue
      if (x < w - 1) link(a, lab[i + 1])
      if (y < h - 1) link(a, lab[i + w])
    }
  }
  const small: number[] = []
  for (let i = 0; i < nc; i++) if (compArea[i] < minArea && fc.ground[compMark[i]] !== 1) small.push(i)
  small.sort((a, b) => compArea[a] - compArea[b] || a - b)
  for (const s of small) {
    const rs = find(s)
    if (compArea[rs] >= minArea) continue
    let best = -1
    let bs = 0
    for (const [b, cnt] of nb[s]) {
      const rb = find(b)
      if (rb === rs) continue
      // (only a neighbour of the same family: a piece of the shadow family never joins a plane of the light family)
      if (zoneFamily(compZone[rb]) !== zoneFamily(compZone[rs])) continue
      const v = cnt * (compZone[rb] === compZone[rs] ? 2 : 1)
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

  // number the planes and gather their statistics
  const idMap = new Map<number, number>()
  const plane = new Int32Array(n).fill(-1)
  interface Acc {
    mark: number
    area: number
    su: number
    snx: number
    sny: number
    snz: number
    sx: number
    sy: number
    x0: number
    y0: number
    x1: number
    y1: number
    zones: number[]
    shadow: number
  }
  const accs: Acc[] = []
  for (let i = 0; i < n; i++) {
    if (lab[i] < 0) continue
    const r = find(lab[i])
    let pid = idMap.get(r)
    if (pid === undefined) {
      pid = accs.length
      idMap.set(r, pid)
      accs.push({ mark: g.mark[i], area: 0, su: 0, snx: 0, sny: 0, snz: 0, sx: 0, sy: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1, zones: [0, 0, 0, 0, 0], shadow: 0 })
    }
    plane[i] = pid
    const a = accs[pid]
    const x = i % w
    const y = (i - x) / w
    a.area++
    a.su += plan.u[i]
    a.snx += g.normal[3 * i]
    a.sny += g.normal[3 * i + 1]
    a.snz += g.normal[3 * i + 2]
    a.sx += x
    a.sy += y
    a.zones[plan.zone[i]]++
    if (plan.zone[i] === Z_CAST) a.shadow++
    if (x < a.x0) a.x0 = x
    if (x > a.x1) a.x1 = x
    if (y < a.y0) a.y0 = y
    if (y > a.y1) a.y1 = y
  }
  const planes: Plane[] = accs.map((a, id) => {
    const ground = fc.ground[a.mark] === 1
    const len = Math.hypot(a.snx, a.sny, a.snz) || 1
    const nx = a.snx / len
    const ny = a.sny / len
    const nz = a.snz / len
    let zone = 0
    for (let k = 1; k < ZONES.length; k++) if (a.zones[k] > a.zones[zone]) zone = k
    const step = ground ? [0, 0] : curve.planeStep(nx, ny, nz)
    return {
      id,
      mark: a.mark,
      area: a.area,
      zone,
      u: a.su / a.area,
      nx,
      ny,
      nz,
      cx: a.sx / a.area,
      cy: a.sy / a.area,
      x0: a.x0,
      y0: a.y0,
      x1: a.x1,
      y1: a.y1,
      ground,
      cast: ground && a.shadow / a.area >= 0.5,
      hOff: step[0],
      cOff: step[1],
    }
  })
  return { plane, planes, dObj }
}

// A stroke's value: the plane's mean plus planeGradient of its own gradient
// (`u` is the plan value where the stroke stands). The caller holds the result inside the pixel's family
// (value.ts holdFamily): the plane's mean may belong to a neighbour pixel's side of the terminator's edge. `follow` (value.ts
// bandFollow, 0..1) takes the stroke from the plane's step to the plan's own value: 1 in the middle of the terminator's soft edge,
// where a plane's step would be a step across it, falling to 0 at the edge's two sides.
export function stepValue(map: PlaneMap, planeId: number, u: number, planeGradient: number, follow = 0): number {
  if (planeId < 0) return u
  const pu = map.planes[planeId].u
  const stepped = pu + planeGradient * (u - pu)
  return follow > 0 ? stepped + follow * (u - stepped) : stepped
}
