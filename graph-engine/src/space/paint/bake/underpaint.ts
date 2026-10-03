// The baked underpainting (the baked painting, spec §14; plan Task 3): "no bare canvas inside a form, ever" (Ben, 2026-10-02), per vertex of the
// refined surfaces, once.
//
// The per-frame model (model/underpaint.ts) makes the colour of every covered pixel of a form on a 12 px lattice of samples and fills the image
// from them. The bake has the surfaces: the underpainting is the colour at every VERTEX of every opaque mesh's refined surface, for each side that
// is painted, and the renderer interpolates it over the triangles. The refinement of bake/plan.ts has already put the vertices where the plan
// changes (the terminator's band to a 3 px ring, a cast shadow's edge), so a vertex IS the sample that matters.
//
// A vertex's colour is the model's sample's: the curve colour of its local colour (the mark's, or the colormap at the vertex's scalar) at its
// value, with the plane's hue step and the bounce and ambient shares, moved by the brush-load mix of its surface cell (level 0) at UNDERPAINT_MIX
// of the strokes' strength (role block, no personal jitter), its lightness held on its family's side of the bound after the mix.
//   * the value u is the plan's plus the seeded deviation, stepped to the vertex's plane (the plane of the incident triangles of its own family with
//     the largest summed area) by planeGradient and held in the family (holdFamily); a vertex INSIDE THE TERMINATOR'S BAND (|N·L| < the softness / 2,
//     not on the table, not in a cast shadow) is made at the plan's own value with no plane step and no family hold, as the per-frame band pixels
//     are, so the underpainting's value runs through the band as the plan's does;
//   * alpha is 0 for lit bare table (the canvas the figure is painted on), else 1; a veil is not underpainted (alpha 0 everywhere).
//
// What a colour is made of is kept per vertex (a recipe in flat arrays), so a colour parameter changes the underpainting with no analysis
// (recolourBake), by the same `underpaintColours` the bake used.

import { holdLightness, oklabToLinear } from '../model/colour'
import type { Curve } from '../model/curve'
import { clamp } from '../model/math'
import { cellId } from '../model/particles'
import { colourOfRecipe, newRecipe, type RecipeEnv } from '../model/recipe'
import { castWeight, ambientShare, FAM_SHADOW, Z_CAST } from '../model/value'
import { mixerOf, UNDERPAINT_MIX } from '../model/underpaint'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { SceneColours } from '../types'
import { familyBoundAt, holdFamilyAt, newPlanAt, type SidePlan, type WorldPlan } from './plan'
import { stepValueWorld, type WorldPlanes } from './planes'
import type { RefinedSurface } from './surface'
import type { BakedSurface } from './types'

export { UNDERPAINT_MIX }

// What the underpainting colour of one side of one surface is made of, per vertex.
export interface SideUnder {
  u: Float32Array
  nz: Float32Array
  bounce: Float32Array
  amb: Float32Array
  // The plane's mean normal, 3 per vertex (NaN where the vertex is on no plane of its family, or on the table).
  plane: Float32Array
  fam: Uint8Array
  bound: Float32Array
  // 1 where the vertex is inside the terminator's band: held to no family.
  band: Uint8Array
  alpha: Float32Array
}

export interface SurfaceUnder {
  mark: number
  nv: number
  ground: boolean
  veil: boolean
  // The vertices' world positions (the baked surface's own Float32 ones) and the local colour of each (OKLab) and whether it came from a colormap.
  positions: Float32Array
  local: Float32Array
  colormapped: Uint8Array
  // The surface cell at level 0, the key of the brush-load mix.
  cell: Uint32Array
  front: SideUnder
  back: SideUnder | null
}

const newSide = (nv: number): SideUnder => ({
  u: new Float32Array(nv), nz: new Float32Array(nv), bounce: new Float32Array(nv), amb: new Float32Array(nv),
  plane: new Float32Array(3 * nv).fill(Number.NaN), fam: new Uint8Array(nv), bound: new Float32Array(nv), band: new Uint8Array(nv), alpha: new Float32Array(nv),
})

// The plane of each vertex on one side: of the planes of its incident triangles in the vertex's own family, the one with the largest summed area
// (the lowest id on a tie); -1 where there is none.
function vertexPlanes(s: RefinedSurface, planeOf: Int32Array, planes: WorldPlanes, sp: SidePlan): Int32Array {
  const nv = s.positions.length / 3
  const nt = s.indices.length / 3
  const start = new Int32Array(nv + 1)
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) start[s.indices[3 * t + k] + 1]++
  for (let v = 0; v < nv; v++) start[v + 1] += start[v]
  const fill = start.slice(0, nv)
  const tris = new Int32Array(3 * nt)
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) tris[fill[s.indices[3 * t + k]]++] = t
  const out = new Int32Array(nv).fill(-1)
  const ids: number[] = []
  const areas: number[] = []
  for (let v = 0; v < nv; v++) {
    ids.length = 0
    areas.length = 0
    for (let q = start[v]; q < start[v + 1]; q++) {
      const t = tris[q]
      const pid = planeOf[t]
      if (pid < 0 || planes.planes[pid].fam !== sp.fam[v]) continue
      const at = ids.indexOf(pid)
      if (at < 0) {
        ids.push(pid)
        areas.push(s.area[t])
      } else areas[at] += s.area[t]
    }
    let best = -1
    for (let q = 0; q < ids.length; q++) if (best < 0 || areas[q] > areas[best] || (areas[q] === areas[best] && ids[q] < ids[best])) best = q
    if (best >= 0) out[v] = ids[best]
  }
  return out
}

// The recipes of one mark's surface, and the BakedSurface with the underpainting's non-colour arrays filled (the colours are `underpaintColours`').
export function buildSurfaceUnder(
  scene: SpaceScene, colours: SceneColours, params: PaintParams, curve: Curve, plan: WorldPlan, planes: WorldPlanes, mark: number,
): { under: SurfaceUnder; surface: BakedSurface } {
  const s = plan.surfaces[mark]!
  const mesh = scene.marks[mark] as MeshMark
  const nv = s.positions.length / 3
  const veil = plan.veil[mark] === 1
  const ground = plan.ground[mark] === 1
  const positions = Float32Array.from(s.positions)
  const o = s.orient
  const normals = new Float32Array(3 * nv)
  for (let i = 0; i < 3 * nv; i++) normals[i] = o * s.normals[i]
  const ts = Math.max(1e-4, params.value.terminatorSoftness)
  const loadCell = Math.max(1e-6, params.mix.loadCell)

  // the local colour of each vertex: the mark's, or the colormap at the vertex's scalar
  const flat = colours.markColour(mark)
  const local = new Float32Array(3 * nv)
  const colormapped = new Uint8Array(nv)
  const scaled = mesh.style.colorScale !== null && s.scalars !== null
  const cell = new Uint32Array(nv)
  for (let v = 0; v < nv; v++) {
    let c = flat
    if (scaled) {
      const m = colours.scaleColour(mesh.style.colorScale!, s.scalars![v])
      if (m) {
        c = m
        colormapped[v] = 1
      }
    }
    local[3 * v] = c[0]
    local[3 * v + 1] = c[1]
    local[3 * v + 2] = c[2]
    cell[v] = cellId(Math.floor(positions[3 * v] / loadCell), Math.floor(positions[3 * v + 1] / loadCell), Math.floor(positions[3 * v + 2] / loadCell))
  }

  const sides: (SidePlan | null)[] = [plan.front[mark], plan.back[mark]]
  const filled: (SideUnder | null)[] = [null, null]
  const at = newPlanAt()
  sides.forEach((sp, k) => {
    if (!sp) return
    const su = newSide(nv)
    filled[k] = su
    const planeOf = planes.planeOf[mark][k]
    const vplane = !veil && planeOf ? vertexPlanes(s, planeOf, planes, sp) : null
    for (let v = 0; v < nv; v++) {
      const fam = sp.fam[v]
      su.fam[v] = fam
      su.u[v] = sp.u[v]
      if (veil) continue
      const nz = k === 0 ? normals[3 * v + 2] : -normals[3 * v + 2]
      su.nz[v] = nz
      su.bounce[v] = sp.lift[v]
      su.amb[v] = ambientShare(params, nz, sp.value[v])
      const dev = curve.devU(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2])
      at.fam = fam
      at.u = sp.u[v]
      const band = Math.abs(sp.nl[v]) < ts / 2 && !ground && castWeight(sp.nl[v], sp.shadow[v] === 1) < 0.5
      su.band[v] = band ? 1 : 0
      su.bound[v] = familyBoundAt(plan, at)
      if (band) {
        // the plan's own value, with the seeded deviation: no plane step, no family hold
        su.u[v] = clamp(sp.u[v] + dev, 0.02, 0.99)
      } else {
        const pid = vplane ? vplane[v] : -1
        const stepped = pid >= 0 ? stepValueWorld(planes, pid, sp.u[v] + dev, params.edges.planeGradient) : sp.u[v] + dev
        su.u[v] = clamp(holdFamilyAt(plan, at, stepped), 0.02, 0.99)
      }
      const pid = vplane ? vplane[v] : -1
      if (pid >= 0 && !ground) {
        const p = planes.planes[pid]
        su.plane[3 * v] = p.nx
        su.plane[3 * v + 1] = p.ny
        su.plane[3 * v + 2] = p.nz
      }
      // bare table in the light is the canvas the figure is painted on: nothing is laid there
      su.alpha[v] = ground && sp.zone[v] !== Z_CAST ? 0 : 1
    }
  })

  const front = filled[0]!
  const back = filled[1]
  const surface: BakedSurface = {
    mark,
    positions,
    normals,
    indices: s.indices.slice(),
    closed: s.outsideOnly,
    underFront: new Float32Array(3 * nv),
    underBack: back ? new Float32Array(3 * nv) : null,
    alphaFront: front.alpha,
    alphaBack: back ? back.alpha : null,
    uFront: front.u,
    uBack: back ? back.u : null,
    famFront: front.fam,
    famBack: back ? back.fam : null,
    local,
  }
  return { under: { mark, nv, ground, veil, positions, local, colormapped, cell, front, back }, surface }
}

// The colours (linear-light sRGB, 3 per vertex) of one side of a surface under `params`: the curve colour of what each vertex is made of, then its
// cell's brush-load mix at UNDERPAINT_MIX of the strokes' strength, then the lightness held on the family's side of the bound (not in the band).
export function underpaintSide(su: SurfaceUnder, side: SideUnder, params: PaintParams, env: RecipeEnv, mixer = mixerOf(params)): Float32Array {
  const out = new Float32Array(3 * su.nv)
  if (su.veil) return out
  const r = newRecipe()
  for (let v = 0; v < su.nv; v++) {
    r.ground = su.ground
    r.lx = su.local[3 * v]
    r.ly = su.local[3 * v + 1]
    r.lz = su.local[3 * v + 2]
    r.u = side.u[v]
    r.nz = side.nz[v]
    r.bounce = side.bounce[v]
    r.ambientShare = side.amb[v]
    r.hasPlane = !Number.isNaN(side.plane[3 * v])
    r.pnx = r.hasPlane ? side.plane[3 * v] : 0
    r.pny = r.hasPlane ? side.plane[3 * v + 1] : 0
    r.pnz = r.hasPlane ? side.plane[3 * v + 2] : 0
    r.colormapped = su.colormapped[v] === 1
    r.field = true
    r.px = su.positions[3 * v]
    r.py = su.positions[3 * v + 1]
    r.pz = su.positions[3 * v + 2]
    const lab = colourOfRecipe(r, env)
    // the mix is keyed to the surface cell, so the underpainting keeps its patches as the camera orbits
    const mixed = mixer.mix({ role: 'block', cell: su.cell[v], u: r.u, x: 0, y: 0, lab, colormapped: r.colormapped, seed: su.cell[v], jitter: 0 })
    let held = mixed.lab
    if (side.band[v] === 0) {
      // (what the same recipe is at the family's bound, after the mix and the gamut fit, as a stroke's is)
      r.u = side.bound[v]
      held = holdLightness(held, side.fam[v] === FAM_SHADOW, colourOfRecipe(r, env)[0])
    }
    const lin = oklabToLinear(held)
    out[3 * v] = lin[0]
    out[3 * v + 1] = lin[1]
    out[3 * v + 2] = lin[2]
  }
  return out
}

// A baked surface with its underpainting colours made (or made again) from the recipes.
export function withUnderColours(surface: BakedSurface, su: SurfaceUnder, params: PaintParams, env: RecipeEnv, mixer = mixerOf(params)): BakedSurface {
  return {
    ...surface,
    underFront: underpaintSide(su, su.front, params, env, mixer),
    underBack: su.back ? underpaintSide(su, su.back, params, env, mixer) : null,
  }
}
