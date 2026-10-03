// The per-frame view of the model (spec §3.2): the camera as numbers the model
// can use, and the selection of which particles are painted in this view.
//
// - Visibility: a particle is visible when its projected depth is within ε of
//   the G-buffer depth at its pixel (and the pixel is its mesh).
// - Constant screen density: a particle is drawn when its (role-shifted) rank
//   is below clamp(target/10000 · pxArea · role density · drag, 0, 1), where
//   pxArea is the screen area of the surface its share of the mesh covers:
//   world area per particle × (px per world unit)² × |n·v|. The rank is
//   fixed, so a particle's threshold moves smoothly with the camera and a
//   rotation of 12° keeps at least 80% of the strokes.
// - Silhouette fade: alpha over |n·v| ∈ [fadeLo, fadeHi].
//
// All coordinates are the scene's own: the space viewProj, eye, viewDir and
// lightDir are expressed in (see particles.ts).

import { invert } from '../../camera/mat4'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { ROLES, type GBuffer, type PaintView, type ParticleSet, type Role } from '../types'
import { clamp, scratchF32, scratchI32, smooth } from './math'

export interface FrameCtx {
  scene: SpaceScene
  view: PaintView
  g: GBuffer
  params: PaintParams
  // viewProj as Float64 (the contract's Float32 values, widened).
  vp: Float64Array
  invVp: Float64Array
  ortho: boolean
  // CSS px width and height of the view, CSS px per G-buffer pixel.
  W: number
  H: number
  scale: number
  // |first row of the linear part of viewProj|: with the viewport width, px per world unit along screen right.
  rowX: number
  // 1 where a mark is bare table (flat, horizontal, opaque).
  ground: Uint8Array
  // What the view's zoom asks of every stroke's size: zoom^particles.zoomStrokeScale, never below 1 and never past
  // particles.zoomBigMax.
  sizeScale: number
  // How many times the brush-load cell is halved for this zoom (brush.ts loadCellLevel): 0 at the tuned framing.
  loadLevel: number
}

export function makeFrameCtx(scene: SpaceScene, view: PaintView, g: GBuffer, params: PaintParams): FrameCtx {
  const vp = new Float64Array(view.viewProj)
  const inv = invert(vp) ?? new Float64Array(16)
  return {
    scene,
    view,
    g,
    params,
    vp,
    invVp: inv,
    ortho: vp[3] === 0 && vp[7] === 0 && vp[11] === 0,
    W: view.width,
    H: view.height,
    scale: g.scale,
    rowX: Math.hypot(vp[0], vp[4], vp[8]),
    ground: groundMarks(scene),
    sizeScale: zoomSizeScale(view, params),
    loadLevel: loadCellLevel(view.zoom),
  }
}

// What the view's zoom asks of the strokes' size (spec addendum: "a bigger brush up close"): the
// view's zoom (1 when the view says nothing) to the power particles.zoomStrokeScale, never
// below 1 (zooming out does not shrink the brush under the size the roles were tuned at) and never
// past particles.zoomBigMax.
export function zoomSizeScale(view: PaintView, params: PaintParams): number {
  return zoomSizeScaleAt(view.zoom, params)
}

// zoomSizeScale at a zoom (the pure form: the baked painting's length scan reads it too).
export function zoomSizeScaleAt(zoom: number | undefined, params: PaintParams): number {
  const z = zoom !== undefined && Number.isFinite(zoom) ? Math.max(1, zoom) : 1
  return Math.min(z ** clamp(params.particles.zoomStrokeScale, 0, 1), bigMax(params))
}

// The most a stroke is made bigger than the size the roles were tuned at, by the growth that keeps the
// strokes overlapping and the brush that follows the zoom together (at 8x they would multiply to 6.2, and a
// stroke that size is a leaf, not a brush stroke).
export const bigMax = (params: PaintParams): number => Math.max(1, params.particles.zoomBigMax)

// ---- projection ----

// Project a world point to CSS px. Writes [x, y, depth] into `out` and returns
// false when the point is behind the eye.
export function project(fc: FrameCtx, x: number, y: number, z: number, out: Float64Array | number[]): boolean {
  const m = fc.vp
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  if (w <= 1e-9) return false
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[0] = ((cx / w + 1) / 2) * fc.W
  out[1] = ((1 - cy / w) / 2) * fc.H
  const v = fc.view
  out[2] = (x - v.eye[0]) * v.viewDir[0] + (y - v.eye[1]) * v.viewDir[1] + (z - v.eye[2]) * v.viewDir[2]
  return true
}

// CSS px per world unit along screen right at a world point.
export function pxPerUnit(fc: FrameCtx, x: number, y: number, z: number): number {
  const m = fc.vp
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  return (fc.W / 2) * (fc.rowX / Math.max(1e-9, w))
}

// The on-screen length, in CSS px, of a world vector b (any direction) at a world point.
export function projectedLength(fc: FrameCtx, px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const m = fc.vp
  const w = Math.max(1e-9, m[3] * px + m[7] * py + m[11] * pz + m[15])
  const sx = ((fc.W / 2) * (m[0] * bx + m[4] * by + m[8] * bz)) / w
  const sy = ((fc.H / 2) * (m[1] * bx + m[5] * by + m[9] * bz)) / w
  return Math.hypot(sx, sy)
}

// The unit vector from a world point toward the eye.
export function toEye(fc: FrameCtx, x: number, y: number, z: number, out: number[]): void {
  const v = fc.view
  if (fc.ortho) {
    out[0] = -v.viewDir[0]
    out[1] = -v.viewDir[1]
    out[2] = -v.viewDir[2]
    return
  }
  const dx = v.eye[0] - x
  const dy = v.eye[1] - y
  const dz = v.eye[2] - z
  const l = Math.hypot(dx, dy, dz) || 1
  out[0] = dx / l
  out[1] = dy / l
  out[2] = dz / l
}

// The G-buffer pixel index of a CSS px position, or -1 outside.
export function gIndex(fc: FrameCtx, sx: number, sy: number): number {
  const gx = Math.floor(sx / fc.scale)
  const gy = Math.floor(sy / fc.scale)
  if (gx < 0 || gy < 0 || gx >= fc.g.width || gy >= fc.g.height) return -1
  return gy * fc.g.width + gx
}

// A point at CSS px (sx, sy) and view depth `depth`, in world space.
export function unproject(fc: FrameCtx, sx: number, sy: number, depth: number, out: number[]): void {
  const m = fc.invVp
  const nx = (sx / fc.W) * 2 - 1
  const ny = 1 - (sy / fc.H) * 2
  const at = (z: number, o: number[]): void => {
    const w = m[3] * nx + m[7] * ny + m[11] * z + m[15]
    o[0] = (m[0] * nx + m[4] * ny + m[8] * z + m[12]) / w
    o[1] = (m[1] * nx + m[5] * ny + m[9] * z + m[13]) / w
    o[2] = (m[2] * nx + m[6] * ny + m[10] * z + m[14]) / w
  }
  const a = [0, 0, 0]
  const b = [0, 0, 0]
  at(-1, a)
  at(1, b)
  let dx = b[0] - a[0]
  let dy = b[1] - a[1]
  let dz = b[2] - a[2]
  const l = Math.hypot(dx, dy, dz) || 1
  dx /= l
  dy /= l
  dz /= l
  const v = fc.view
  const t = (depth - ((a[0] - v.eye[0]) * v.viewDir[0] + (a[1] - v.eye[1]) * v.viewDir[1] + (a[2] - v.eye[2]) * v.viewDir[2])) /
    (dx * v.viewDir[0] + dy * v.viewDir[1] + dz * v.viewDir[2])
  out[0] = a[0] + dx * t
  out[1] = a[1] + dy * t
  out[2] = a[2] + dz * t
}

// Move a world point along its view ray to view depth `target` (it lands on
// the same pixel).
export function slideToDepth(fc: FrameCtx, p: number[], depth: number, target: number): void {
  const v = fc.view
  if (fc.ortho) {
    const d = target - depth
    p[0] += v.viewDir[0] * d
    p[1] += v.viewDir[1] * d
    p[2] += v.viewDir[2] * d
    return
  }
  const k = target / Math.max(1e-9, depth)
  p[0] = v.eye[0] + (p[0] - v.eye[0]) * k
  p[1] = v.eye[1] + (p[1] - v.eye[1]) * k
  p[2] = v.eye[2] + (p[2] - v.eye[2]) * k
}

// ---- ground ----

const groundCache = new WeakMap<SpaceScene, Uint8Array>()

// A mesh that is bare table: opaque, with every normal pointing straight up
// (a flat horizontal surface). Lit, it is canvas; the figure is what is painted.
export function groundMarks(scene: SpaceScene): Uint8Array {
  const have = groundCache.get(scene)
  if (have) return have
  const out = new Uint8Array(scene.marks.length)
  scene.marks.forEach((mark, i) => {
    if (mark.kind === 'mesh' && mark.style.opacity >= 1 && isFlatUp(mark)) out[i] = 1
  })
  groundCache.set(scene, out)
  return out
}

function isFlatUp(mesh: MeshMark): boolean {
  const n = mesh.normals
  if (n.length === 0) return false
  for (let i = 0; i < n.length; i += 3) if (n[i + 2] < 0.9995) return false
  return true
}

// ---- mesh areas ----

const areaCache = new WeakMap<MeshMark, number>()
export function meshArea(mesh: MeshMark): number {
  const have = areaCache.get(mesh)
  if (have !== undefined) return have
  const p = mesh.positions
  let sum = 0
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = 3 * mesh.indices[t]
    const b = 3 * mesh.indices[t + 1]
    const c = 3 * mesh.indices[t + 2]
    const e1x = p[b] - p[a]
    const e1y = p[b + 1] - p[a + 1]
    const e1z = p[b + 2] - p[a + 2]
    const e2x = p[c] - p[a]
    const e2y = p[c + 1] - p[a + 1]
    const e2z = p[c + 2] - p[a + 2]
    const area = 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x)
    if (Number.isFinite(area)) sum += area
  }
  areaCache.set(mesh, sum)
  return sum
}

// ---- selection ----

// The particles that are visible in this view, with what the model needs to
// know about each. Arrays are scratch: valid until the next call.
// How much of the surfaces' fade band (particles.fadeLo..fadeHi of |n·v|) a veil fades over.
export const VEIL_FADE_LO = 0.25
export const VEIL_FADE_HI = 0.5

export interface Visible {
  count: number
  // Index into the ParticleSet.
  idx: Int32Array
  // CSS px, view depth, |n·v|, silhouette fade alpha, screen area of the share of surface it stands for (px²).
  sx: Float32Array
  sy: Float32Array
  depth: Float32Array
  facing: Float32Array
  fade: Float32Array
  pxArea: Float32Array
  // The G-buffer pixel of the particle.
  gi: Int32Array
  // The normal turned toward the viewer, 3 per entry.
  normal: Float32Array
}

export function visibleParticles(fc: FrameCtx, set: ParticleSet): Visible {
  const n = set.count
  const idx = scratchI32('vis.idx', n)
  const sx = scratchF32('vis.sx', n)
  const sy = scratchF32('vis.sy', n)
  const depthA = scratchF32('vis.depth', n)
  const facingA = scratchF32('vis.facing', n)
  const fadeA = scratchF32('vis.fade', n)
  const pxArea = scratchF32('vis.pxArea', n)
  const giA = scratchI32('vis.gi', n)
  const normalA = scratchF32('vis.normal', 3 * n)
  const p = fc.params.particles
  const g = fc.g

  // world area each particle stands for, per mesh
  const marks = fc.scene.marks
  const perMark = new Float64Array(marks.length)
  const counts = new Uint32Array(marks.length)
  for (let i = 0; i < n; i++) counts[set.mark[i]]++
  marks.forEach((m, i) => {
    if (m.kind === 'mesh' && counts[i] > 0) perMark[i] = meshArea(m) / counts[i]
  })

  const out = [0, 0, 0]
  const v = [0, 0, 0]
  let k = 0
  for (let i = 0; i < n; i++) {
    const x = set.position[3 * i]
    const y = set.position[3 * i + 1]
    const z = set.position[3 * i + 2]
    if (!project(fc, x, y, z, out)) continue
    const gi = gIndex(fc, out[0], out[1])
    if (gi < 0) continue
    toEye(fc, x, y, z, v)
    let nx = set.normal[3 * i]
    let ny = set.normal[3 * i + 1]
    let nz = set.normal[3 * i + 2]
    let facing = nx * v[0] + ny * v[1] + nz * v[2]
    if (facing < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
      facing = -facing
    }
    const ppu = pxPerUnit(fc, x, y, z)
    const mark = set.mark[i]
    // depth tolerance: a G-buffer pixel covers `scale` CSS px, and the surface
    // slopes away at a grazing angle faster than the pixel is wide
    const slope = Math.sqrt(Math.max(0, 1 - facing * facing)) / Math.max(facing, 0.1)
    const eps = (fc.scale / ppu) * (1.5 + 1.5 * slope)
    // the G-buffer pixel the particle is read at: its own, or (at a rim) the neighbour that shows its mesh
    let at = gi
    let seen = false
    if (set.opacity[i] < 1) {
      // a veil is visible unless an opaque surface stands in front of it
      seen = !(g.depth[gi] < out[2] - eps)
    } else {
      seen = g.mark[gi] === mark && Math.abs(g.depth[gi] - out[2]) <= eps
      if (!seen) {
        // the particle may sit a hair outside its pixel; try the four neighbours
        const W = g.width
        const gx = gi % W
        const gy = (gi - gx) / W
        const tryPx = (qx: number, qy: number): boolean => {
          if (qx < 0 || qy < 0 || qx >= W || qy >= g.height) return false
          const q = qy * W + qx
          if (g.mark[q] === mark && Math.abs(g.depth[q] - out[2]) <= eps) {
            at = q
            return true
          }
          return false
        }
        seen = tryPx(gx - 1, gy) || tryPx(gx + 1, gy) || tryPx(gx, gy - 1) || tryPx(gx, gy + 1)
      }
    }
    if (!seen) continue
    // A veil is a thin film, seen through at any angle and with no limb of its own to turn away at: it fades
    // over a quarter and a half of the surface's band (a form's strokes fade as it turns from the viewer).
    const veil = set.opacity[i] < 1
    const fade = veil ? smooth(p.fadeLo * VEIL_FADE_LO, p.fadeHi * VEIL_FADE_HI, facing) : smooth(p.fadeLo, p.fadeHi, facing)
    // right at the limb a stroke is invisible, and a particle just behind it can pass the depth test
    if (fade < 0.02) continue
    idx[k] = i
    sx[k] = out[0]
    sy[k] = out[1]
    depthA[k] = out[2]
    facingA[k] = facing
    fadeA[k] = fade
    pxArea[k] = perMark[mark] * ppu * ppu * facing
    giA[k] = at
    normalA[3 * k] = nx
    normalA[3 * k + 1] = ny
    normalA[3 * k + 2] = nz
    k++
  }
  return { count: k, idx, sx, sy, depth: depthA, facing: facingA, fade: fadeA, pxArea, gi: giA, normal: normalA }
}

// Each role draws a different subset of the particles: its rank is the
// particle's own, rotated by a fixed per-role amount (the golden ratio steps),
// so block, form and scumble strokes do not all sit on the same anchors.
const ROLE_SHIFT: Record<Role, number> = (() => {
  const out = {} as Record<Role, number>
  ROLES.forEach((r, i) => {
    out[r] = (0.6180339887 * (i + 1)) % 1
  })
  return out
})()

export const roleRank = (rank: number, role: Role): number => (rank + ROLE_SHIFT[role]) % 1

// The chance a visible particle is drawn for a role: the screen-density rule. `scale` thins the role further
// (a veil's glazes: roles.ts VEIL_DENSITY).
export function drawChance(fc: FrameCtx, pxArea: number, role: Role, scale = 1): number {
  return drawChanceOf(fc.params, fc.view.dragging, pxArea, role, scale)
}

// drawChance from the params and whether the camera is being dragged (the pure form: the baked painting's frame reads it too).
export function drawChanceOf(p: PaintParams, dragging: boolean, pxArea: number, role: Role, scale = 1): number {
  const drag = dragging ? p.particles.dragDensity : 1
  return clamp((p.particles.targetPer10kPx / 10000) * pxArea * p.roles[role].density * drag * scale, 0, 1)
}

// A load of paint is a patch of the surface (mix.loadCell world units across), and a painter mixes a new
// load every few strokes: patches about a brush's reach, on the canvas, whatever the zoom. The cell is in
// world units, so zoomed in it would swallow the whole view and every stroke would share one mix. Zooming
// in halves it, in whole steps (a power of two, so a finer cell lies inside a coarser one, and the loads
// do not drift between zooms): level 0 up to a zoom of 1.41, 1 up to 2.83, 2 up to 5.66, and so on.
export function loadCellLevel(zoom: number | undefined): number {
  const z = zoom !== undefined && Number.isFinite(zoom) ? Math.max(1, zoom) : 1
  return Math.min(6, Math.floor(Math.log2(z) + 0.5))
}

// How much bigger a stroke of `role` is made where the particles fall short of the screen target. The
// particles are capped by particles.maxPerUnit2, so zoomed in there are fewer on screen than
// targetPer10kPx asks for (drawChance would be above 1): the strokes grow, width and length together, by
// sqrt(target / available) = sqrt(drawChance before its clamp), up to particles.zoomGrowMax, so they
// still overlap and cover the form. 1 while the particles are plentiful.
export function zoomGrow(fc: FrameCtx, pxArea: number, role: Role): number {
  return zoomGrowOf(fc.params, fc.view.dragging, pxArea, role)
}

// zoomGrow from the params and whether the camera is being dragged (the pure form: the baked painting's length scan reads it too).
export function zoomGrowOf(p: PaintParams, dragging: boolean, pxArea: number, role: Role): number {
  const drag = dragging ? p.particles.dragDensity : 1
  const need = (p.particles.targetPer10kPx / 10000) * pxArea * p.roles[role].density * drag
  return clamp(Math.sqrt(Math.max(1, need)), 1, Math.max(1, p.particles.zoomGrowMax))
}

// Is visible entry k drawn for `role`?
export function drawn(fc: FrameCtx, vis: Visible, set: ParticleSet, k: number, role: Role): boolean {
  return roleRank(set.rank[vis.idx[k]], role) < drawChance(fc, vis.pxArea[k], role)
}

// How much of its alpha a drawn particle has: whole, except within a fifth of
// its threshold, where it fades in (or out) as the camera moves and the
// threshold crosses it, so strokes do not pop. 0 when it is not drawn.
export function drawFade(fc: FrameCtx, vis: Visible, set: ParticleSet, k: number, role: Role, scale = 1): number {
  const chance = drawChance(fc, vis.pxArea[k], role, scale)
  const r = roleRank(set.rank[vis.idx[k]], role)
  return drawFadeAt(chance, r)
}

// The fade of a drawn particle from its chance and its (role-shifted) rank: 0 when it is not drawn (the pure form: the baked painting's frame reads it too).
export function drawFadeAt(chance: number, rank: number): number {
  if (rank >= chance) return 0
  return chance >= 1 ? 1 : smooth(0, 0.2, 1 - rank / chance)
}

// A per-role cache-free helper for tests and the lab's readout: the indices of
// the visible entries drawn for a role.
export function drawnEntries(fc: FrameCtx, vis: Visible, set: ParticleSet, role: Role): number[] {
  const out: number[] = []
  for (let k = 0; k < vis.count; k++) if (drawn(fc, vis, set, k, role)) out.push(k)
  return out
}

