// Surface particles (spec §3.1): the anchors strokes grow from. Each mesh gets
// seeded blue-noise particles, computed once per scene and parameter set:
// sample triangles by area with seeded barycentrics, then thin by a
// Poisson-disc grid at radius 1/√maxPerUnit2 (a particle's neighbours are at
// least that far away). A particle keeps a fixed seeded rank, which is what
// makes density hold on screen without strokes cascading (view.ts).
//
// Every particle carries its world position, a unit normal, a tangent (the
// stroke direction), its local colour (the flat colour, or the colormap at its
// interpolated scalar), the mesh's opacity, a rank in [0, 1), a surface cell
// (a hash of floor(position / mix.loadCell), the key of a brush load) and its
// own seed. Everything is seeded through randomFor('paint/particles/' +
// markIndex, seed): never Math.random, never time.
//
// The tangent comes from the uv gradient (∂P/∂u, falling back to ∂P/∂v where
// ∂P/∂u vanishes, as at a pole); with no uv it is the direction of greatest
// change of the normal. The other candidate direction at a frame is n × tangent
// (view.ts and roles.ts pick between them by which crosses the light more).
//
// Space: positions and normals are in the scene's own coordinates, which is
// the space PaintView.viewProj, eye, viewDir and lightDir are expressed in.

import { randomFor } from '../../../style/random'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { BuildParticles, Oklab, ParticleSet, SceneColours } from '../types'
import { hash3, vcross, vdot, vlen, vnorm, type V3 } from './math'

// Total particles across the scene: the radius grows when a scene would need more.
const MAX_PARTICLES = 120_000
// Poisson-disc random sequential adsorption packs to about 0.70 of 1/r² points.
const PACKING = 0.7
// Candidate darts per particle slot (RSA reaches ~90% of the jamming limit at this).
const OVERSAMPLE = 6

interface Draft {
  mark: number
  tri: number
  w0: number
  w1: number
  w2: number
  x: number
  y: number
  z: number
}

// What paintFrame needs from the scene's colours but the contract hands it no
// SceneColours for: the flat colour of every mark (line, point and arrow marks
// have no particles to carry one). Kept beside the particle set, keyed by it;
// a copy of the set loses it and the marks fall back to umber (CONCERN: the
// contract's PaintFrameFn takes no SceneColours).
export interface ParticleSide {
  markColour: Oklab[]
}
const sides = new WeakMap<ParticleSet, ParticleSide>()
export const UMBER: Oklab = [0.4, 0.04, 0.035]
export function sideOf(set: ParticleSet, markCount: number): ParticleSide {
  return sides.get(set) ?? { markColour: Array.from({ length: markCount }, () => UMBER) }
}

export const buildParticles: BuildParticles = (scene: SpaceScene, colours: SceneColours, params: PaintParams): ParticleSet => {
  const meshes: { index: number; mesh: MeshMark; area: number; cum: Float64Array }[] = []
  let totalArea = 0
  scene.marks.forEach((mark, index) => {
    if (mark.kind !== 'mesh') return
    const { cum, area } = triangleAreas(mark)
    if (area > 0) {
      meshes.push({ index, mesh: mark, area, cum })
      totalArea += area
    }
  })
  const r0 = 1 / Math.sqrt(Math.max(1, params.particles.maxPerUnit2))
  const r = Math.max(r0, Math.sqrt((PACKING * totalArea) / MAX_PARTICLES))

  const drafts: Draft[] = []
  for (const m of meshes) samplePoisson(m.mesh, m.index, m.area, m.cum, r, params, drafts)

  const count = drafts.length
  const set: ParticleSet = {
    count,
    mark: new Uint32Array(count),
    position: new Float32Array(3 * count),
    normal: new Float32Array(3 * count),
    tangent: new Float32Array(3 * count),
    colour: new Float32Array(3 * count),
    colormapped: new Uint8Array(count),
    opacity: new Float32Array(count),
    rank: new Float32Array(count),
    cell: new Uint32Array(count),
    seed: new Uint32Array(count),
  }
  sides.set(set, { markColour: scene.marks.map((_, i) => colours.markColour(i)) })
  // ranks and seeds come from one stream per mesh, in particle order
  const streams = new Map<number, ReturnType<typeof randomFor>>()
  const cell = Math.max(1e-6, params.mix.loadCell)
  for (let i = 0; i < count; i++) {
    const d = drafts[i]
    const mesh = scene.marks[d.mark] as MeshMark
    let rng = streams.get(d.mark)
    if (!rng) {
      rng = randomFor(`paint/particles/${d.mark}/attributes`, params.seed)
      streams.set(d.mark, rng)
    }
    const i0 = mesh.indices[3 * d.tri]
    const i1 = mesh.indices[3 * d.tri + 1]
    const i2 = mesh.indices[3 * d.tri + 2]
    const n = interpolatedNormal(mesh, i0, i1, i2, d.w0, d.w1, d.w2)
    const t = tangentOf(mesh, i0, i1, i2, n)
    set.mark[i] = d.mark
    set.position.set([d.x, d.y, d.z], 3 * i)
    set.normal.set(n, 3 * i)
    set.tangent.set(t, 3 * i)
    let colour: Oklab = colours.markColour(d.mark)
    let mapped = 0
    if (mesh.style.colorScale !== null && mesh.scalars) {
      const v = d.w0 * mesh.scalars[i0] + d.w1 * mesh.scalars[i1] + d.w2 * mesh.scalars[i2]
      const c = colours.scaleColour(mesh.style.colorScale, v)
      if (c) {
        colour = c
        mapped = 1
      }
    }
    set.colour.set(colour, 3 * i)
    set.colormapped[i] = mapped
    set.opacity[i] = mesh.style.opacity
    set.rank[i] = rng.next()
    set.cell[i] = hash3(Math.floor(d.x / cell), Math.floor(d.y / cell), Math.floor(d.z / cell))
    set.seed[i] = Math.floor(rng.next() * 4294967296) >>> 0
  }
  return set
}

// Cumulative triangle areas (for area-weighted sampling) and the total.
function triangleAreas(mesh: MeshMark): { cum: Float64Array; area: number } {
  const nt = Math.floor(mesh.indices.length / 3)
  const cum = new Float64Array(nt)
  const p = mesh.positions
  let sum = 0
  for (let t = 0; t < nt; t++) {
    const a = 3 * mesh.indices[3 * t]
    const b = 3 * mesh.indices[3 * t + 1]
    const c = 3 * mesh.indices[3 * t + 2]
    const e1x = p[b] - p[a]
    const e1y = p[b + 1] - p[a + 1]
    const e1z = p[b + 2] - p[a + 2]
    const e2x = p[c] - p[a]
    const e2y = p[c + 1] - p[a + 1]
    const e2z = p[c + 2] - p[a + 2]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    const area = 0.5 * Math.hypot(cx, cy, cz)
    sum += Number.isFinite(area) ? area : 0
    cum[t] = sum
  }
  return { cum, area: sum }
}

// Seeded darts on one mesh, accepted when no earlier particle is within r.
function samplePoisson(
  mesh: MeshMark,
  markIndex: number,
  area: number,
  cum: Float64Array,
  r: number,
  params: PaintParams,
  out: Draft[],
): void {
  const rng = randomFor(`paint/particles/${markIndex}`, params.seed)
  const p = mesh.positions
  const slots = Math.max(1, Math.ceil((PACKING * area) / (r * r)))
  const darts = Math.ceil((OVERSAMPLE * area) / (r * r))
  // a chained spatial hash over the accepted points, cell size r
  const tableSize = 1 << Math.max(4, Math.ceil(Math.log2(slots * 2)))
  const head = new Int32Array(tableSize).fill(-1)
  const next = new Int32Array(slots + 16)
  const px = new Float64Array(slots + 16)
  const py = new Float64Array(slots + 16)
  const pz = new Float64Array(slots + 16)
  const inv = 1 / r
  const r2 = r * r
  const total = cum[cum.length - 1]
  let accepted = 0
  for (let dart = 0; dart < darts && accepted < slots + 8; dart++) {
    // a triangle by area, then seeded barycentrics
    const target = rng.next() * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < target) lo = mid + 1
      else hi = mid
    }
    const s = Math.sqrt(rng.next())
    const q = rng.next()
    const w0 = 1 - s
    const w1 = s * (1 - q)
    const w2 = s * q
    const a = 3 * mesh.indices[3 * lo]
    const b = 3 * mesh.indices[3 * lo + 1]
    const c = 3 * mesh.indices[3 * lo + 2]
    const x = w0 * p[a] + w1 * p[b] + w2 * p[c]
    const y = w0 * p[a + 1] + w1 * p[b + 1] + w2 * p[c + 1]
    const z = w0 * p[a + 2] + w1 * p[b + 2] + w2 * p[c + 2]
    if (!Number.isFinite(x + y + z)) continue
    const cx = Math.floor(x * inv)
    const cy = Math.floor(y * inv)
    const cz = Math.floor(z * inv)
    let clear = true
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          let k = head[hash3(cx + dx, cy + dy, cz + dz) & (tableSize - 1)]
          while (k >= 0) {
            const ex = px[k] - x
            const ey = py[k] - y
            const ez = pz[k] - z
            if (ex * ex + ey * ey + ez * ez < r2) {
              clear = false
              break search
            }
            k = next[k]
          }
        }
      }
    }
    if (!clear) continue
    const slot = accepted++
    px[slot] = x
    py[slot] = y
    pz[slot] = z
    const h = hash3(cx, cy, cz) & (tableSize - 1)
    next[slot] = head[h]
    head[h] = slot
    out.push({ mark: markIndex, tri: lo, w0, w1, w2, x, y, z })
  }
}

// The vertex normals interpolated and renormalised; a triangle whose normals
// are all undefined (zero) gets its face normal.
function interpolatedNormal(mesh: MeshMark, i0: number, i1: number, i2: number, w0: number, w1: number, w2: number): V3 {
  const n = mesh.normals
  const x = w0 * n[3 * i0] + w1 * n[3 * i1] + w2 * n[3 * i2]
  const y = w0 * n[3 * i0 + 1] + w1 * n[3 * i1 + 1] + w2 * n[3 * i2 + 1]
  const z = w0 * n[3 * i0 + 2] + w1 * n[3 * i1 + 2] + w2 * n[3 * i2 + 2]
  if (Math.hypot(x, y, z) > 1e-9) return vnorm([x, y, z])
  return faceNormal(mesh, i0, i1, i2)
}

function faceNormal(mesh: MeshMark, i0: number, i1: number, i2: number): V3 {
  const p = mesh.positions
  const e1: V3 = [p[3 * i1] - p[3 * i0], p[3 * i1 + 1] - p[3 * i0 + 1], p[3 * i1 + 2] - p[3 * i0 + 2]]
  const e2: V3 = [p[3 * i2] - p[3 * i0], p[3 * i2 + 1] - p[3 * i0 + 1], p[3 * i2 + 2] - p[3 * i0 + 2]]
  const c = vcross(e1, e2)
  return vlen(c) > 0 ? vnorm(c) : [0, 0, 1]
}

// The stroke direction at a particle on triangle (i0, i1, i2) whose normal is n.
function tangentOf(mesh: MeshMark, i0: number, i1: number, i2: number, n: V3): V3 {
  const p = mesh.positions
  const e1: V3 = [p[3 * i1] - p[3 * i0], p[3 * i1 + 1] - p[3 * i0 + 1], p[3 * i1 + 2] - p[3 * i0 + 2]]
  const e2: V3 = [p[3 * i2] - p[3 * i0], p[3 * i2 + 1] - p[3 * i0 + 1], p[3 * i2 + 2] - p[3 * i0 + 2]]
  const inPlane = (d: V3): V3 => {
    const k = vdot(d, n)
    return [d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k]
  }
  if (mesh.uv) {
    const uv = mesh.uv
    const du1 = uv[2 * i1] - uv[2 * i0]
    const dv1 = uv[2 * i1 + 1] - uv[2 * i0 + 1]
    const du2 = uv[2 * i2] - uv[2 * i0]
    const dv2 = uv[2 * i2 + 1] - uv[2 * i0 + 1]
    const det = du1 * dv2 - du2 * dv1
    if (Math.abs(det) > 1e-18) {
      const dPdu: V3 = [
        (e1[0] * dv2 - e2[0] * dv1) / det,
        (e1[1] * dv2 - e2[1] * dv1) / det,
        (e1[2] * dv2 - e2[2] * dv1) / det,
      ]
      const dPdv: V3 = [
        (e2[0] * du1 - e1[0] * du2) / det,
        (e2[1] * du1 - e1[1] * du2) / det,
        (e2[2] * du1 - e1[2] * du2) / det,
      ]
      // where ∂P/∂u all but vanishes (a pole), take ∂P/∂v
      const pick = vlen(dPdu) >= 0.05 * vlen(dPdv) ? dPdu : dPdv
      const t = inPlane(pick)
      if (vlen(t) > 1e-12) return vnorm(t)
    }
  }
  return greatestNormalChange(mesh, i0, i1, i2, n, e1, e2)
}

// The direction in the triangle along which the normal changes fastest (the
// principal curvature direction); the first edge where the normal does not
// change at all (a plane) or changes the same every way (a sphere).
function greatestNormalChange(mesh: MeshMark, i0: number, i1: number, i2: number, n: V3, e1: V3, e2: V3): V3 {
  const nn = mesh.normals
  const fallback = (): V3 => {
    const k = vdot(e1, n)
    const t: V3 = [e1[0] - n[0] * k, e1[1] - n[1] * k, e1[2] - n[2] * k]
    return vlen(t) > 1e-12 ? vnorm(t) : [1, 0, 0]
  }
  const l1 = vlen(e1)
  if (l1 < 1e-12) return fallback()
  const t1: V3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1]
  const fn = vcross(e1, e2)
  if (vlen(fn) < 1e-18) return fallback()
  const t2 = vcross(vnorm(fn), t1)
  const dn1: V3 = [nn[3 * i1] - nn[3 * i0], nn[3 * i1 + 1] - nn[3 * i0 + 1], nn[3 * i1 + 2] - nn[3 * i0 + 2]]
  const dn2: V3 = [nn[3 * i2] - nn[3 * i0], nn[3 * i2 + 1] - nn[3 * i0 + 1], nn[3 * i2 + 2] - nn[3 * i0 + 2]]
  const a = vdot(e2, t1)
  const b = vdot(e2, t2)
  if (Math.abs(b) < 1e-12) return fallback()
  const D1: V3 = [dn1[0] / l1, dn1[1] / l1, dn1[2] / l1]
  const D2: V3 = [(dn2[0] - a * D1[0] * l1) / b, (dn2[1] - a * D1[1] * l1) / b, (dn2[2] - a * D1[2] * l1) / b]
  const m11 = vdot(D1, D1)
  const m22 = vdot(D2, D2)
  const m12 = vdot(D1, D2)
  const lmax = 0.5 * (m11 + m22) + Math.hypot(0.5 * (m11 - m22), m12)
  const lmin = 0.5 * (m11 + m22) - Math.hypot(0.5 * (m11 - m22), m12)
  if (lmax < 1e-12 || lmax - lmin < 0.05 * lmax) return fallback() // flat, or the same change every way
  const th = 0.5 * Math.atan2(2 * m12, m11 - m22)
  const d: V3 = [
    t1[0] * Math.cos(th) + t2[0] * Math.sin(th),
    t1[1] * Math.cos(th) + t2[1] * Math.sin(th),
    t1[2] * Math.cos(th) + t2[2] * Math.sin(th),
  ]
  const k = vdot(d, n)
  const t: V3 = [d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k]
  return vlen(t) > 1e-12 ? vnorm(t) : fallback()
}
