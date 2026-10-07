// The per-frame half of the baked painting (the baked painting, spec §14; plan Task 4): `frameFromBake` turns a BakedPainting into the StrokeBatch of
// one view, on the main thread, in a single pass over arrays.
//
// WHAT A FRAME DOES. For every baked stroke, cheap tests first:
//   side      the stroke's anchor normal n against the direction to the eye: a stroke of an open mesh's side is drawn when n·toEye > 0 (the
//             side that faces the eye), a closed mesh's (side 0) unless it faces away by more than 0.05 (the renderer's depth pre-pass hides the rest);
//   fade      facing = |n·toEye|, alpha × smooth(fadeLo, fadeHi, facing) (a veil's: view.ts VEIL_FADE_LO/HI), under 0.02 dropped; the strokes of
//             data marks and edges have none;
//   screen    a stroke whose anchor is off the screen by more than half its length and its width is not drawn (the model draws the particles the
//             G-buffer shows); it is tested only when a corner of the box of the anchors is off the screen (a figure wholly in view tests nothing);
//   density   a particle's stroke is drawn when its (role-shifted) rank is under view.ts drawChance of its screen area (the mark's area per
//             particle × px per world unit² × facing), with the model's drawFade ramp in alpha; an edge stroke when its rank is under roles.edge.density
//             and its spacing rank is under the thinning that gives the model's spacing at this zoom (see EDGE STROKES); a
//             veil's border pass only where the particle's own glaze (the scumble's rank shifted back to the glaze's, the veil's scale of the density) is drawn;
//   size      big = min(zoomGrow × zoomSizeScale, bigMax) (view.ts, the pure forms); the sub-arc of the baked path the zoom needs, sizedLength(basePx[0],
//             big) / ppu long about the anchor (clipped at the path's ends, never extrapolated), resampled to PATH_POINTS by linear interpolation
//             ALONG THE BAKED POLYLINE and projected; widths as pathFromWalk and reshapeWidths make them (pressure × the lateral direction's
//             foreshortening, read at four points of the path and interpolated between them); the loaded end of a 'hand' stroke by screen x;
//             an edge stroke's by its own rule (EDGE STROKES);
//   colour    the baked colour at the view's brush-load level (loadCellLevel, capped at BAKE_MIX_LEVELS - 1);
//   order     layer by layer, far to near by the anchor's view depth (a stable counting sort over DEPTH_BUCKETS buckets, ties in bake order).
// then adds this view's own strokes: the silhouettes (silhouettes.ts), the points and the arrowheads of the data marks (here), which are
// built on the screen. The result is an ordinary StrokeBatch, `worldPath` and `worldNormal` filled so that reproject.ts works on it, `hidden` filled.
//
// EDGE STROKES (SIZING_ALONG, SIZING_ACROSS). The model draws an edge stroke at a fixed size in px, and a fixed spacing in px, at any zoom: a crisp stroke or a drag
// as long as its stretch, a pull or a bridge of about 22 or 26 px every ~34 or ~42 px, all of a constant width. The bake has BAKE_EDGE_REFINE times as many
// strokes on the lattice of a stretch, each with a spacing rank (bake/edgeStrokes.ts), so the frame keeps what makes the model's spacing on the screen.
// THE PULLS AND BRIDGES (across the stretch, spaced along it): z = px per world unit at the stroke's anchor × the reference world per px (the zoom, and the depth of a
// perspective view) × the foreshortening of the direction along the stretch there (r: the surface tilted from the view packs its px, and the model spaces its strokes by px
// on the screen), and a stroke is kept when its spacing rank is under z / BAKE_EDGE_REFINE (more of them as the view zooms in, fewer as it zooms out, the model's spacing
// at the authored zoom and every zoom above it up to BAKE_EDGE_REFINE: beyond it the cells cannot be finer, and the strokes lengthen by z / BAKE_EDGE_REFINE). It is drawn
// as the sub-arc of basePx[0] px (the model's length) about its anchor, where the world length of a px is what the view's scale is there; a surface tilted from the view
// foreshortens the arc, and a stroke the tilt shortens by a tenth or more is taken a longer arc of the baked path (up to ARC_TILT_MAX times), so that the length on the
// screen is the model's.
// THE CRISP STROKES AND DRAGS (along the stretch, one stroke the stretch's length in the model) are not spaced by that rule: their cells would be thinned out (none left
// where z is under 1: the stretch's own stroke gone) and, between the powers of two, would not tile (a hole between two strokes). Their cells tile the stretch at the
// powers of two: the zoom z is read ONCE for the stretch, at the middle of its path (all its cells have the same path, so they all read the same number and decide alike),
// zl is the power of two at or under it (1 to BAKE_EDGE_REFINE), the cells kept are those whose spacing rank is under zl / BAKE_EDGE_REFINE (the stretch's middle at
// least, whatever the zoom; 1, 3, 5 or 9 of them, each 1 / zl of the stretch apart, its two ends among them), and each is drawn basePx[0] × z / zl px long: the stretch's
// share on the screen, 1 to 2 times the model's length (less where the view is zoomed out or the stretch tilted: z under 1). A stroke is never shorter than its cell's share
// of the path (selTile), whatever the tilt does along the stretch: the strokes of the cells that are drawn meet. Beyond the refinement the cells cannot be finer, and the
// strokes lengthen by z / BAKE_EDGE_REFINE, as the pulls'.
// The width is constant, as the model's, with the pressure's taper along the arc. The decision reads the stroke's own baked numbers (an along stroke's, the stretch's, which
// are the same for its cells) and the scale there, so a stroke that stays in view stays drawn, and the same, as the camera orbits.
//
// THE PATHS. The baked path's BAKE_PATH_POINTS points are at equal world arc length (bake/walk.ts resampleWalk, to the snap's sagitta), so a fraction
// t of its length is taken at the point t × (BAKE_PATH_POINTS - 1) of them: no arc lengths are summed per frame. (A test holds the deviation.)
//
// THE PASSES. A (select): one pass over the baked arrays in their own order, the cheap tests first; what is kept goes to the selection with its alpha, its
// size, its depth and its layer. B (order): a stable counting sort of the selection by layer and depth bucket gives each selected stroke its place. C (pack):
// the selected strokes are sized, projected and written, again in the baked painting's order, each to its place in the result (the baked arrays are read
// sequentially; the result's arrays are the ones just made, warm in the cache); a stroke too thin to see leaves a gap, which a last pass closes.
//
// ALLOCATION. The per-stroke work allocates nothing: every temporary is a module-level typed array, and the per-frame arrays (the selection, the
// sort, the frame's own strokes) are kept in a FrameScratch and grown by doubling. `frameFromBake` keeps one per bake in a WeakMap (keyed by the baked
// worldPath array, so a recolour of a bake shares it); `frameFromBakeWith` takes the caller's. The OUTPUT arrays are made afresh in every call, for the
// renderer may keep a batch; the scratch's own are never handed out, unless the caller asks (FrameScratch.reuseOutput: views of arrays kept in the scratch,
// good until the next call, for a caller that does not keep the batch). The first frame of a bake also makes, once, the per-stroke anchors, each
// surface's vertex index and each open sheet's BVH (prepareBake does it ahead of the first frame).

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { MAX_BRISTLES, PATH_POINTS, ROLES, type GBuffer, type PaintView, type Role, type StrokeBatch } from '../types'
import { CLOSE_UP_FROM, reshapeWidths, sizedBristles, sizedLength, sizedVariance } from '../model/brush'
import { behindVeil } from '../model/lines'
import { clamp, hash3, smooth } from '../model/math'
import { veilOf, VEIL_BORDER_ALPHA, VEIL_DENSITY, type Veil } from '../model/roles'
import { BEHIND_VEIL_LAYER, pressure } from '../model/strokes'
import { bigMax, drawChanceFor, drawChanceOf, drawFadeAt, loadCellLevel, makeFrameCtx, project, pxPerUnit, roleRank, VEIL_FADE_HI, VEIL_FADE_LO, zoomGrowFor, zoomSizeScaleAt, type FrameCtx } from '../model/view'
import { fnvInts } from './draft'
import { addSilhouettes, casterOf, indexOf } from './silhouettes'
import { StrokeList } from './strokeList'
import { BAKE_EDGE_REFINE, BAKE_MIX_LEVELS, BAKE_PATH_POINTS, HIDDEN_DASHED, HIDDEN_NONE, isEdgeSizing, SIZING_ALONG, SIZING_SURFACE, type BakedPainting, type FrameFromBake } from './types'

const P = PATH_POINTS
const BP = BAKE_PATH_POINTS
const BP3 = 3 * BP
const LAST = BP - 1
// Depth buckets of the painting order, per layer.
export const DEPTH_BUCKETS = 4096
const LAYERS = 8

const R_DAB = ROLES.indexOf('dab')
const R_EDGE = ROLES.indexOf('edge')
const R_LINE = ROLES.indexOf('line')
const R_GLAZE = ROLES.indexOf('glaze')
const LAYER_LINE = 6
// The most an edge stroke's arc is lengthened for the tilt of its surface from the view (see EDGE STROKES): the baked paths of the pulls and bridges are
// walked for it (bake/edgeStrokes.ts ARC_REACH).
const ARC_TILT_MAX = 2.5
// The least foreshortening that thins an edge stroke's spacing (below it the surface is seen edge on: the strokes are not thinned further).
const TILT_FLOOR = 0.15

// The kinds of a baked stroke (the density and the sizing read the kind): the particle roles 0..4 (block, form, scumble, glaze, reflected), then
// the dab, the edge and the data line (the roles' own indices), and the two passes of a veil's glaze.
const K_DAB = R_DAB
const K_EDGE = R_EDGE
const K_LINE = R_LINE
const K_VEIL = 8
const K_VEIL_BORDER = 9
const KINDS = 10

// ---- what a baked painting needs of the scene, once ----

interface Prep {
  // Which marks are veils (a mesh with opacity under 1) when the kinds were made: a scene that says otherwise makes them again.
  veilMask: Uint8Array
  // The kind of every stroke.
  kind: Uint8Array
  // The anchor of every stroke (3 each), and the unit normal there (zeros for a data line), interpolated along the baked path.
  anchorPos: Float32Array
  anchorNrm: Float32Array
  // What holds every anchor: the box (its least corner and its greatest) and the sphere about the box's centre (centre, radius).
  bound: Float64Array
}

const preps = new WeakMap<Float32Array, Prep>()

function prepOf(baked: BakedPainting, scene: SpaceScene): Prep {
  const marks = scene.marks
  const have = preps.get(baked.worldPath)
  if (have && have.kind.length === baked.count && have.veilMask.length === marks.length) {
    let same = true
    for (let m = 0; m < marks.length && same; m++) {
      const mk = marks[m]
      if ((mk.kind === 'mesh' && mk.style.opacity < 1 ? 1 : 0) !== have.veilMask[m]) same = false
    }
    if (same) return have
  }
  const n = baked.count
  const veilMark = new Uint8Array(marks.length)
  marks.forEach((m, i) => {
    if (m.kind === 'mesh' && m.style.opacity < 1) veilMark[i] = 1
  })
  const kind = new Uint8Array(n)
  const anchorPos = new Float32Array(3 * n)
  const anchorNrm = new Float32Array(3 * n)
  const wp = baked.worldPath
  const wn = baked.worldNormal
  const border = Math.fround(VEIL_BORDER_ALPHA)
  for (let i = 0; i < n; i++) {
    const role = baked.role[i]
    kind[i] = role === R_GLAZE && veilMark[baked.mark[i]] === 1 ? (Math.abs(baked.alpha[i] - border) < 1e-6 ? K_VEIL_BORDER : K_VEIL) : role
    const u = clamp(baked.anchor[i], 0, 1) * LAST
    const i0 = Math.min(LAST - 1, Math.floor(u))
    const f = u - i0
    const q = BP3 * i + 3 * i0
    for (let c = 0; c < 3; c++) {
      anchorPos[3 * i + c] = wp[q + c] + (wp[q + 3 + c] - wp[q + c]) * f
      anchorNrm[3 * i + c] = wn[q + c] + (wn[q + 3 + c] - wn[q + c]) * f
    }
    const l = Math.hypot(anchorNrm[3 * i], anchorNrm[3 * i + 1], anchorNrm[3 * i + 2])
    if (l > 1e-12) for (let c = 0; c < 3; c++) anchorNrm[3 * i + c] /= l
  }
  const bound = new Float64Array(10)
  if (n > 0) {
    bound.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        bound[c] = Math.min(bound[c], anchorPos[3 * i + c])
        bound[3 + c] = Math.max(bound[3 + c], anchorPos[3 * i + c])
      }
    }
    for (let c = 0; c < 3; c++) bound[6 + c] = (bound[c] + bound[3 + c]) / 2
    let r2 = 0
    for (let i = 0; i < n; i++) r2 = Math.max(r2, (anchorPos[3 * i] - bound[6]) ** 2 + (anchorPos[3 * i + 1] - bound[7]) ** 2 + (anchorPos[3 * i + 2] - bound[8]) ** 2)
    bound[9] = Math.sqrt(r2) * (1 + 1e-6) + 1e-9
  }
  const made: Prep = { veilMask: veilMark, kind, anchorPos, anchorNrm, bound }
  preps.set(baked.worldPath, made)
  return made
}

const veilLists = new WeakMap<SpaceScene, Veil[]>()
function veilsOf(scene: SpaceScene): Veil[] {
  let v = veilLists.get(scene)
  if (!v) {
    v = []
    for (const m of scene.marks) if (m.kind === 'mesh' && m.style.opacity < 1) v.push(veilOf(m))
    veilLists.set(scene, v)
  }
  return v
}

// ---- what a frame keeps between frames ----

export interface FrameStats {
  // Baked strokes looked at, selected for the view, and written (a selected stroke too thin to see is not), and the frame's own strokes
  // (silhouettes, points, arrowheads) among those written.
  considered: number
  selected: number
  written: number
  own: number
  silhouettes: number
  // Whether the baked strokes were tested against the screen (only when an anchor may be off it), and how many that test left out.
  screenTested: boolean
  offscreen: number
  // Where the time of the last frame went, ms: the frame's own strokes (silhouettes, points, arrowheads), the selection of the baked strokes, the
  // painting order, and the packing (a diagnostic: the bench reads it; it is not part of any result).
  msOwn: number
  msSelect: number
  msSort: number
  msPack: number
}

export class FrameScratch {
  // How many arrays it has had to make (a test counts them: after the first frames there are none).
  allocations = 0
  cap = 0
  // The selection: the stroke (an index into the baked painting, or `count + e` for the frame's own stroke e), what it is drawn with, its depth,
  // layer and sort key.
  sel = new Int32Array(0)
  selAlpha = new Float32Array(0)
  selBig = new Float32Array(0)
  selPpu = new Float32Array(0)
  // The half length of a stroke along its stretch's cell, as a fraction of the path (the stretch's cells tile it, a frame never draws one shorter), 0 for any other.
  selTile = new Float32Array(0)
  selDepth = new Float32Array(0)
  selLayer = new Uint8Array(0)
  key = new Int32Array(0)
  // Where in the painting order each selected stroke goes.
  pos = new Int32Array(0)
  alive = new Uint8Array(0)
  // For each stroke of the last result, by its place in it: the baked stroke it was made from (-1: one of the frame's own) and the size `big` it was
  // made at (valid until the next call: the tests and the parity harness read them).
  source = new Int32Array(0)
  bigOf = new Float32Array(0)
  readonly hist = new Int32Array(LAYERS * DEPTH_BUCKETS + 1)
  readonly own = new StrokeList()
  // Make the result's arrays in the scratch and hand out views of them (valid until the next call), in place of arrays of their own: no allocation
  // at all in a frame, for a caller that does not keep the batch (the default is arrays made afresh, which the renderer may keep).
  reuseOutput = false
  private output: Output | null = null
  private outputCap = 0
  readonly stats: FrameStats = { considered: 0, selected: 0, written: 0, own: 0, silhouettes: 0, screenTested: false, offscreen: 0, msOwn: 0, msSelect: 0, msSort: 0, msPack: 0 }

  // Room for `cap` selected strokes (the first `keep` of the selection are kept).
  ensure(cap: number, keep: number): void {
    if (cap <= this.cap) return
    const c = Math.max(cap, 2 * this.cap)
    const grow = <T extends Float32Array | Uint8Array | Int32Array>(a: T): T => {
      const out = new (a.constructor as new (n: number) => T)(c)
      out.set(a.subarray(0, keep))
      this.allocations++
      return out
    }
    this.sel = grow(this.sel)
    this.selAlpha = grow(this.selAlpha)
    this.selBig = grow(this.selBig)
    this.selPpu = grow(this.selPpu)
    this.selTile = grow(this.selTile)
    this.selDepth = grow(this.selDepth)
    this.selLayer = grow(this.selLayer)
    this.key = grow(this.key)
    this.pos = grow(this.pos)
    this.alive = grow(this.alive)
    this.source = grow(this.source)
    this.bigOf = grow(this.bigOf)
    this.cap = c
  }

  // The output arrays of the scratch, grown to hold `total` strokes (`reuseOutput`).
  outputFor(total: number): Output {
    if (this.output === null || total > this.outputCap) {
      this.outputCap = Math.max(total, 2 * this.outputCap, 256)
      this.output = makeOutput(this.outputCap)
      this.allocations++
    }
    return this.output
  }

  // Every array it has made, counting the frame's own strokes' (a test reads it to see that a frame made none).
  get arrays(): number {
    return this.allocations + this.own.allocations
  }
}

const scratches = new WeakMap<Float32Array, FrameScratch>()
const EMPTY_G: GBuffer = {
  width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0),
}

// ---- module-level temporaries (one stroke at a time) ----

const MID = [0, 0, 0]
const I0 = new Int32Array(P)
const F0 = new Float64Array(P)
const SW = new Float64Array(P)
const FNODE = new Float64Array(4)
const WT = new Float32Array(P)
// The foreshortening is read at these points of the path and interpolated between them (it is smooth along a stroke: the lateral direction
// turns with the surface). For each point q of the path: the two nodes it lies between and the weight of the second.
const FNODE_Q = [0, 2, 5, 7]
const FNODE_A = Int32Array.of(0, 0, 1, 1, 1, 2, 2, 3)
const FNODE_B = Int32Array.of(0, 1, 1, 2, 2, 2, 3, 3)
const FNODE_T = Float64Array.of(0, 0.5, 0, 1 / 3, 2 / 3, 0, 0.5, 0)
const TK = Float64Array.from({ length: P }, (_, k) => k / (P - 1))
const PRESSURE = Float64Array.from({ length: P }, (_, k) => pressure(k / (P - 1)))
// What a kind is drawn and grown as: the role the density reads, the share of it (a veil's glazes are thinned), and the role the growth reads (a veil's
// border pass is drawn at the scumble's density, and grown as a glaze).
const DRAW_ROLE: Role[] = [...ROLES.slice(0, 5), 'dab', 'edge', 'line', 'glaze', 'scumble']
const SHIFT_SCUMBLE = roleRank(0, 'scumble')
const DRAW_SCALE = Float64Array.from({ length: KINDS }, (_, k) => (k === K_VEIL ? VEIL_DENSITY : 1))
// (the roles' densities for drawing and for growing, each kind's, read at the start of a frame)
const KIND_DENSITY = new Float64Array(KINDS)
const KIND_GROW_DENSITY = new Float64Array(KINDS)
const GROW_ROLE: Role[] = [...ROLES.slice(0, 5), 'dab', 'edge', 'line', 'glaze', 'glaze']

// What the view fixes for a whole frame: viewProj's numbers and the like, read in the loops through locals.
class Consts {
  ortho = false
  m0 = 0; m1 = 0; m2 = 0; m3 = 0; m4 = 0; m5 = 0; m6 = 0; m7 = 0; m8 = 0; m9 = 0; m10 = 0; m11 = 0; m12 = 0; m13 = 0; m14 = 0; m15 = 0
  W = 0
  H = 0
}
const C = new Consts()

// ---- the frame ----

// The foreshortening of the direction an edge stroke is spaced in, at its anchor (a, with the unit normal n there and clip w `cw`): the length on the screen of a
// step along that direction over what a step of the same length in the screen's plane would be (1: square to the view), kept between TILT_FLOOR and 1.
// The direction is the baked path's own at the anchor for a stroke along its stretch, and at right angles to it in the surface (the normal × the path's
// direction) for one across it.
function alongScale(
  wp: Float32Array, anchor: number, i: number, across: boolean, ax: number, ay: number, az: number, nx: number, ny: number, nz: number,
  cw: number, ortho: boolean, ppu: number,
): number {
  const u = anchor * LAST
  const q = BP3 * i + 3 * Math.min(LAST - 1, Math.floor(u))
  let tx = wp[q + 3] - wp[q]
  let ty = wp[q + 4] - wp[q + 1]
  let tz = wp[q + 5] - wp[q + 2]
  if (across) {
    const cx = ny * tz - nz * ty
    const cy = nz * tx - nx * tz
    const cz = nx * ty - ny * tx
    tx = cx
    ty = cy
    tz = cz
  }
  const tl = Math.hypot(tx, ty, tz)
  if (!(tl > 1e-12)) return 1
  const { m0, m1, m3, m4, m5, m7, m8, m9, m11, m12, m13, W, H } = C
  const dcx = m0 * tx + m4 * ty + m8 * tz
  const dcy = m1 * tx + m5 * ty + m9 * tz
  let sx: number
  let sy: number
  if (ortho) {
    sx = (0.5 * W * dcx) / cw
    sy = (0.5 * H * dcy) / cw
  } else {
    const dcw = m3 * tx + m7 * ty + m11 * tz
    const cx = m0 * ax + m4 * ay + m8 * az + m12
    const cy = m1 * ax + m5 * ay + m9 * az + m13
    sx = (0.5 * W * (dcx * cw - cx * dcw)) / (cw * cw)
    sy = (0.5 * H * (dcy * cw - cy * dcw)) / (cw * cw)
  }
  const r = Math.hypot(sx, sy) / (tl * ppu)
  return r > 1 ? 1 : r < TILT_FLOOR ? TILT_FLOOR : r
}

// The sub-arc of a baked stroke [lo, hi] (fractions of its length) as PATH_POINTS world points on the baked polyline, written to `world` from `wo` and,
// projected, to `path` from `po`; and, for the widths, each point's clip w (SW) and where it lies on the baked path (I0, F0). False when a point is behind
// the eye.
function samplePath(baked: BakedPainting, i: number, lo: number, hi: number, path: Float32Array, po: number, world: Float32Array, wo: number): boolean {
  const wp = baked.worldPath
  const base = BP3 * i
  const { m0, m1, m3, m4, m5, m7, m8, m9, m11, m12, m13, m15, W, H } = C
  const u0 = lo * LAST
  const du = ((hi - lo) * LAST) / (P - 1)
  if (C.ortho) {
    // (an orthographic view: clip w is the same everywhere, no divide)
    const iw = 1 / m15
    for (let k = 0; k < P; k++) {
      const u = u0 + du * k
      let i0 = u | 0
      if (i0 > LAST - 1) i0 = LAST - 1
      const f = u - i0
      const q = base + 3 * i0
      const x = wp[q] + (wp[q + 3] - wp[q]) * f
      const y = wp[q + 1] + (wp[q + 4] - wp[q + 1]) * f
      const z = wp[q + 2] + (wp[q + 5] - wp[q + 2]) * f
      world[wo + 3 * k] = x
      world[wo + 3 * k + 1] = y
      world[wo + 3 * k + 2] = z
      I0[k] = i0
      F0[k] = f
      path[po + 2 * k] = ((((m0 * x + m4 * y + m8 * z + m12) * iw) + 1) * 0.5) * W
      path[po + 2 * k + 1] = ((1 - (m1 * x + m5 * y + m9 * z + m13) * iw) * 0.5) * H
    }
    return m15 > 1e-9
  }
  for (let k = 0; k < P; k++) {
    const u = u0 + du * k
    let i0 = u | 0
    if (i0 > LAST - 1) i0 = LAST - 1
    const f = u - i0
    const q = base + 3 * i0
    const x = wp[q] + (wp[q + 3] - wp[q]) * f
    const y = wp[q + 1] + (wp[q + 4] - wp[q + 1]) * f
    const z = wp[q + 2] + (wp[q + 5] - wp[q + 2]) * f
    world[wo + 3 * k] = x
    world[wo + 3 * k + 1] = y
    world[wo + 3 * k + 2] = z
    I0[k] = i0
    F0[k] = f
    const w = m3 * x + m7 * y + m11 * z + m15
    if (w <= 1e-9) return false
    SW[k] = w
    const iw = 1 / w
    path[po + 2 * k] = ((((m0 * x + m4 * y + m8 * z + m12) * iw) + 1) * 0.5) * W
    path[po + 2 * k + 1] = ((1 - (m1 * x + m5 * y + m9 * z + m13) * iw) * 0.5) * H
  }
  return true
}

export function frameFromBakeWith(
  scr: FrameScratch, baked: BakedPainting, scene: SpaceScene, view: PaintView, params: PaintParams, gbuffer: GBuffer | null,
): StrokeBatch {
  const n = baked.count
  const prep = prepOf(baked, scene)
  const vpm = view.viewProj
  const m0 = vpm[0], m1 = vpm[1], m2 = vpm[2], m3 = vpm[3], m4 = vpm[4], m5 = vpm[5], m6 = vpm[6], m7 = vpm[7]
  const m8 = vpm[8], m9 = vpm[9], m10 = vpm[10], m11 = vpm[11], m12 = vpm[12], m13 = vpm[13], m14 = vpm[14], m15 = vpm[15]
  C.m0 = m0; C.m1 = m1; C.m2 = m2; C.m3 = m3; C.m4 = m4; C.m5 = m5; C.m6 = m6; C.m7 = m7
  C.m8 = m8; C.m9 = m9; C.m10 = m10; C.m11 = m11; C.m12 = m12; C.m13 = m13; C.m14 = m14; C.m15 = m15
  const W = view.width
  const H = view.height
  C.W = W
  C.H = H
  const ortho = m3 === 0 && m7 === 0 && m11 === 0
  C.ortho = ortho
  const halfW = W / 2
  const halfH = H / 2
  const rowX = Math.hypot(m0, m4, m8)
  const ppuK = halfW * rowX
  const ppuOrtho = ppuK / Math.max(1e-9, m15)
  const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
  const vx = view.viewDir[0], vy = view.viewDir[1], vz = view.viewDir[2]
  const pp = params.particles
  const fadeLo = pp.fadeLo, fadeHi = pp.fadeHi
  const vLo = fadeLo * VEIL_FADE_LO, vHi = fadeHi * VEIL_FADE_HI
  const dragging = view.dragging === true
  const sizeScale = zoomSizeScaleAt(view.zoom, params)
  const bigCap = bigMax(params)
  // what drawChanceOf and zoomGrowOf read of the params, read once: the target per px, the share of a drag, each kind's density for drawing and for growing
  const perPx = params.particles.targetPer10kPx / 10000
  const drag = dragging ? params.particles.dragDensity : 1
  const growMax = params.particles.zoomGrowMax
  for (let kd = 0; kd < KINDS; kd++) {
    KIND_DENSITY[kd] = params.roles[DRAW_ROLE[kd]].density
    KIND_GROW_DENSITY[kd] = params.roles[GROW_ROLE[kd]].density
  }
  const level = Math.min(loadCellLevel(view.zoom), BAKE_MIX_LEVELS - 1)
  const edgeDensity = params.roles.edge.density

  const fc: FrameCtx = makeFrameCtx(scene, view, gbuffer ?? EMPTY_G, params)
  const veils = veilsOf(scene)
  const haveVeils = veils.length > 0

  // the frame's own strokes first (the selection has room for them)
  const t0 = performance.now()
  const own = scr.own
  own.clear()
  const nSil = addSilhouettes(own, baked, scene, view, params, gbuffer, fc)
  addDataMarks(own, baked, scene, view, params, fc, veils)
  scr.ensure(n + own.count, 0)
  const t1 = performance.now()

  // ---- pass A: select ----
  const sel = scr.sel, selAlpha = scr.selAlpha, selBig = scr.selBig, selPpu = scr.selPpu, selTile = scr.selTile, selDepth = scr.selDepth, selLayer = scr.selLayer
  const kindA = prep.kind, anchorPos = prep.anchorPos, anchorNrm = prep.anchorNrm
  const cull = anchorsMayBeOffscreen(fc, prep.bound)
  let offscreen = 0
  const sideA = baked.side, markA = baked.mark, rankA = baked.rank, alphaA = baked.alpha, layerA = baked.layer, area = baked.areaPerParticle
  const spacingA = baked.spacing, sizingA = baked.sizing, anchorA = baked.anchor
  const refPerPx = baked.referenceWorldPerPx
  const wp = baked.worldPath
  const wnA = baked.worldNormal
  const basePxA = baked.basePx
  let k = 0
  let dMin = Infinity
  let dMax = -Infinity
  for (let i = 0; i < n; i++) {
    const kind = kindA[i]
    const ax = anchorPos[3 * i], ay = anchorPos[3 * i + 1], az = anchorPos[3 * i + 2]
    const nx = anchorNrm[3 * i], ny = anchorNrm[3 * i + 1], nz = anchorNrm[3 * i + 2]
    let dot: number
    let lenSq = 1
    if (ortho) dot = -(nx * vx + ny * vy + nz * vz)
    else {
      const dx = ex - ax, dy = ey - ay, dz = ez - az
      dot = nx * dx + ny * dy + nz * dz
      lenSq = dx * dx + dy * dy + dz * dz
    }
    // 1. the side
    if (sideA[i] !== 0) {
      if (dot <= 0) continue
    } else if (dot < 0 && (ortho ? dot < -0.05 : dot * dot > 0.0025 * lenSq)) continue
    let alpha = alphaA[i]
    let big = 1
    let ppu = 0
    let tile = 0
    let layer = layerA[i]
    if (kind === K_EDGE) {
      if (rankA[i] >= edgeDensity) continue
      // the spacing: the zoom z is px per world unit × the reference world per px × the tilt of the stretch from the view (the direction the strokes are spaced in,
      // projected, over what the scale would make of it); a stroke across the stretch is kept when its spacing rank is under z over the refinement (the model's spacing on
      // the screen), and lengthened past it
      const cw = ortho ? m15 : m3 * ax + m7 * ay + m11 * az + m15
      ppu = ortho ? ppuOrtho : ppuK / Math.max(1e-9, cw)
      if (sizingA[i] === SIZING_ALONG) {
        // a stroke ALONG its stretch (a crisp stroke, a drag; its path is the stretch): z is read ONCE for the stretch, at the middle of its path, so that all its cells
        // (the same path) decide alike. zl is the power of two of cells that tile the stretch at that zoom (1 to BAKE_EDGE_REFINE; the stretch's middle is always one: its own
        // stroke is never dropped), and a cell is drawn z / zl × basePx[0] px long, its 1 / zl of the stretch on the screen (and never shorter than that in the world: selTile)
        const q = BP3 * i + 3 * (BP / 2 - 1)
        const mx = (wp[q] + wp[q + 3]) / 2, my = (wp[q + 1] + wp[q + 4]) / 2, mz = (wp[q + 2] + wp[q + 5]) / 2
        const cwM = ortho ? m15 : m3 * mx + m7 * my + m11 * mz + m15
        const ppuM = ortho ? ppuOrtho : ppuK / Math.max(1e-9, cwM)
        const zM = ppuM * refPerPx * alongScale(wp, 0.5, i, false, mx, my, mz, 0, 0, 0, cwM, ortho, ppuM)
        if (!(zM > 0)) continue
        let zl = 1
        while (zl < BAKE_EDGE_REFINE && 2 * zl <= zM) zl *= 2
        if (spacingA[i] * BAKE_EDGE_REFINE >= zl) continue
        big = zM / zl
        tile = 0.5 / zl
      } else {
        const z = ppu * refPerPx * alongScale(wp, anchorA[i], i, true, ax, ay, az, nx, ny, nz, cw, ortho, ppu)
        if (spacingA[i] * BAKE_EDGE_REFINE >= z) continue
        if (z > BAKE_EDGE_REFINE) big = z / BAKE_EDGE_REFINE
      }
    } else if (kind === K_LINE) {
      if (haveVeils) {
        const q = BP3 * i + 3 * (BP / 2 - 1)
        MID[0] = (wp[q] + wp[q + 3]) / 2
        MID[1] = (wp[q + 1] + wp[q + 4]) / 2
        MID[2] = (wp[q + 2] + wp[q + 5]) / 2
        if (behindVeil(fc, veils, MID)) layer = BEHIND_VEIL_LAYER
      }
    } else {
      // a stroke of a surface: sized for the view
      const wA = ortho ? m15 : m3 * ax + m7 * ay + m11 * az + m15
      ppu = ortho ? ppuOrtho : ppuK / Math.max(1e-9, wA)
      if (kind === K_DAB) big = sizeScale
      else {
        const facing = ortho ? Math.abs(dot) : Math.abs(dot) / Math.sqrt(lenSq)
        // 2. the fade
        const fade = kind >= K_VEIL ? smooth(vLo, vHi, facing) : smooth(fadeLo, fadeHi, facing)
        if (fade < 0.02) continue
        // 3. the density
        const pxArea = area[markA[i]] * ppu * ppu * facing
        const df = drawFadeAt(drawChanceFor(perPx, pxArea, KIND_DENSITY[kind], drag, DRAW_SCALE[kind]), rankA[i])
        if (!(df > 0.02)) continue
        if (kind === K_VEIL_BORDER) {
          // a veil's border pass is made only for a particle whose own glaze (at VEIL_DENSITY) is drawn (roles.ts particleStrokes): the glaze's rank is the
          // particle's, which the border's (shifted by the scumble's) gives back
          let rp = rankA[i] - SHIFT_SCUMBLE
          if (rp < 0) rp += 1
          const glaze = drawFadeAt(drawChanceOf(params, dragging, pxArea, 'glaze', VEIL_DENSITY), roleRank(rp, 'glaze'))
          if (!(glaze > 0.02)) continue
        }
        // 4. the growth and the brush
        big = Math.min(zoomGrowFor(perPx, pxArea, KIND_GROW_DENSITY[kind], drag, growMax) * sizeScale, bigCap)
        alpha *= fade * df
      }
    }
    if (cull && ppu > 0) {
      // off the screen: the model draws the particles the G-buffer shows (the anchor's pixel), and a stroke reaches half its length and its width beyond it
      const iw = 1 / Math.max(1e-9, ortho ? m15 : m3 * ax + m7 * ay + m11 * az + m15)
      const sx = (((m0 * ax + m4 * ay + m8 * az + m12) * iw + 1) * 0.5) * W
      const sy = ((1 - (m1 * ax + m5 * ay + m9 * az + m13) * iw) * 0.5) * H
      const arc = kind === K_EDGE
      const reach = 0.5 * (arc || big <= CLOSE_UP_FROM ? basePxA[2 * i] * big : sizedLength(basePxA[2 * i], big)) + basePxA[2 * i + 1] * (arc ? 1 : big)
      if (sx < -reach || sy < -reach || sx > W + reach || sy > H + reach) {
        offscreen++
        continue
      }
    }
    const depth = (ax - ex) * vx + (ay - ey) * vy + (az - ez) * vz
    sel[k] = i
    selAlpha[k] = alpha
    selBig[k] = big
    selPpu[k] = ppu
    selTile[k] = tile
    selDepth[k] = depth
    selLayer[k] = layer
    if (depth < dMin) dMin = depth
    if (depth > dMax) dMax = depth
    k++
  }
  // the frame's own strokes join the selection
  for (let e = 0; e < own.count; e++) {
    sel[k] = n + e
    selAlpha[k] = own.alpha[e]
    const depth = own.depth[e]
    selDepth[k] = depth
    selLayer[k] = own.layer[e]
    if (depth < dMin) dMin = depth
    if (depth > dMax) dMax = depth
    k++
  }
  const total = k
  const t2 = performance.now()

  // ---- pass B: the painting order (a stable counting sort: layer, then far to near) ----
  const hist = scr.hist
  hist.fill(0)
  const key = scr.key, pos = scr.pos
  const span = dMax - dMin
  const kScale = span > 0 ? (DEPTH_BUCKETS - 1) / span : 0
  for (let j = 0; j < total; j++) {
    let b = (dMax - selDepth[j]) * kScale
    if (!(b >= 0)) b = 0
    else if (b > DEPTH_BUCKETS - 1) b = DEPTH_BUCKETS - 1
    const kk = selLayer[j] * DEPTH_BUCKETS + (b | 0)
    key[j] = kk
    hist[kk + 1]++
  }
  for (let b = 0; b < LAYERS * DEPTH_BUCKETS; b++) hist[b + 1] += hist[b]
  for (let j = 0; j < total; j++) pos[j] = hist[key[j]]++
  const t3 = performance.now()

  // ---- pass C: the strokes, sized, projected and packed in order ----
  const out = scr.reuseOutput ? scr.outputFor(total) : makeOutput(total)
  const { role, layer: layerOut, path, width, depth: depthOut, colour, alpha: alphaOut, load, impasto, bristles, bristleVar, dry, wet, endSoft, edge, seed, worldPath, worldNormal, hidden } = out

  const bColour = baked.colour
  const sizing = baked.sizing
  const hand = baked.handStart
  const pathLength = baked.pathLength
  const anchorF = baked.anchor
  const basePx = baked.basePx
  // (the strokes are made in the order they were selected, which is the baked painting's own, so the baked arrays are read in order; each goes
  // to its place in the painting order, in the output arrays that were just made and are warm in the cache)
  const alive = scr.alive
  const source = scr.source
  const bigOf = scr.bigOf
  alive.fill(0, 0, total)
  let written = 0
  for (let j = 0; j < total; j++) {
    const o = pos[j]
    const i = sel[j]
    if (i >= n) {
      // a stroke of the frame's own
      const e = i - n
      role[o] = own.role[e]
      layerOut[o] = own.layer[e]
      for (let q = 0; q < 2 * P; q++) path[2 * P * o + q] = own.path[2 * P * e + q]
      for (let q = 0; q < P; q++) width[P * o + q] = own.width[P * e + q]
      depthOut[o] = own.depth[e]
      colour[3 * o] = own.colour[3 * e]
      colour[3 * o + 1] = own.colour[3 * e + 1]
      colour[3 * o + 2] = own.colour[3 * e + 2]
      alphaOut[o] = own.alpha[e]
      load[o] = own.load[e]
      impasto[o] = own.impasto[e]
      bristles[o] = own.bristles[e]
      bristleVar[o] = own.bristleVar[e]
      dry[o] = own.dry[e]
      wet[o] = own.wet[e]
      endSoft[o] = own.endSoft[e]
      edge[o] = own.edge[e]
      seed[o] = own.seed[e]
      for (let q = 0; q < 3 * P; q++) worldPath[3 * P * o + q] = own.worldPath[3 * P * e + q]
      worldNormal[3 * o] = own.worldNormal[3 * e]
      worldNormal[3 * o + 1] = own.worldNormal[3 * e + 1]
      worldNormal[3 * o + 2] = own.worldNormal[3 * e + 2]
      hidden[o] = own.hidden[e]
      source[o] = -1
      bigOf[o] = 1
      alive[o] = 1
      written++
      continue
    }
    const big = selBig[j]
    const fixed = sizing[i] !== SIZING_SURFACE
    const arc = isEdgeSizing(sizing[i])
    const rl = baked.role[i]
    let lo = 0
    let hi = 1
    let anchor = 0
    let half = 0
    if (!fixed || arc) {
      const L = pathLength[i]
      if (!(L > 1e-12)) continue
      anchor = anchorF[i]
      // (up to CLOSE_UP_FROM the brush is the role's own size times `big`: sizedLength without its close-up lengthening; an edge stroke's length is its
      // own px, lengthened by `big` where the zoom is past the refinement)
      half = (0.5 * (arc || big <= CLOSE_UP_FROM ? basePx[2 * i] * big : sizedLength(basePx[2 * i], big))) / selPpu[j] / L
      lo = anchor - half
      if (lo < 0) lo = 0
      hi = anchor + half
      if (hi > 1) hi = 1
      if (!(hi - lo > 1e-9)) continue
    }
    const po = 2 * P * o
    const wo = 3 * P * o
    if (!samplePath(baked, i, lo, hi, path, po, worldPath, wo)) continue
    if (arc && (lo > 0 || hi < 1)) {
      // an edge stroke is as long on the screen as the model's (basePx[0] × big), less what the path's end takes of it: a surface tilted from the view
      // foreshortens the arc, so the arc of the baked path that gives the length is longer (once is near enough: the tilt hardly changes along an arc of a
      // few px); the part of the arc that the path's end clips is no tilt's, and a stroke at the end of its stretch stays half the length
      const want = (basePx[2 * i] * big * (hi - lo)) / (2 * half)
      let have = 0
      for (let q = 1; q < P; q++) have += Math.hypot(path[po + 2 * q] - path[po + 2 * q - 2], path[po + 2 * q + 1] - path[po + 2 * q - 1])
      if (have < 0.9 * want && have > 1e-6) {
        const grow = Math.min(want / have, ARC_TILT_MAX)
        lo = Math.max(0, anchor - half * grow)
        hi = Math.min(1, anchor + half * grow)
        if (!samplePath(baked, i, lo, hi, path, po, worldPath, wo)) continue
      }
    }
    const tile = selTile[j]
    if (tile > 0) {
      // a stroke along its stretch is never shorter than its tile: the stretch's cells are `tile` × 2 of the path apart, so the strokes of the cells that are drawn meet
      // end to end whatever the surface's tilt does along the stretch (the length on the screen above is read at the stroke's own place: where the stretch is less tilted
      // there than the middle it falls short of the cell's share of it)
      const tlo = Math.max(0, anchor - tile)
      const thi = Math.min(1, anchor + tile)
      if (lo > tlo + 1e-6 || hi < thi - 1e-6) {
        lo = Math.min(lo, tlo)
        hi = Math.max(hi, thi)
        if (!samplePath(baked, i, lo, hi, path, po, worldPath, wo)) continue
      }
    }
    let reverse = false
    if (!fixed) {
      // the foreshortening of the width: the lateral direction (the normal × the path's tangent), projected, over the px per world unit at the anchor
      const ppuInv = 1 / selPpu[j]
      const nbase = BP3 * i
      for (let nd = 0; nd < 4; nd++) {
        const q = FNODE_Q[nd]
        const q0 = q > 0 ? q - 1 : 0
        const q1 = q < P - 1 ? q + 1 : P - 1
        const dx = worldPath[wo + 3 * q1] - worldPath[wo + 3 * q0]
        const dy = worldPath[wo + 3 * q1 + 1] - worldPath[wo + 3 * q0 + 1]
        const dz = worldPath[wo + 3 * q1 + 2] - worldPath[wo + 3 * q0 + 2]
        const t = nbase + 3 * I0[q]
        const f = F0[q]
        const nx = wnA[t] + (wnA[t + 3] - wnA[t]) * f
        const ny = wnA[t + 1] + (wnA[t + 4] - wnA[t + 1]) * f
        const nz = wnA[t + 2] + (wnA[t + 5] - wnA[t + 2]) * f
        const bx = ny * dz - nz * dy
        const by = nz * dx - nx * dz
        const bz = nx * dy - ny * dx
        const bl = Math.sqrt(bx * bx + by * by + bz * bz)
        if (bl > 1e-12) {
          const s = 1 / (bl * (ortho ? m15 : SW[q]))
          const lx = halfW * (m0 * bx + m4 * by + m8 * bz) * s
          const ly = halfH * (m1 * bx + m5 * by + m9 * bz) * s
          FNODE[nd] = Math.sqrt(lx * lx + ly * ly) * ppuInv
        } else FNODE[nd] = 0
      }
      reverse = hand[i] === 1 && path[po + 2 * (P - 1)] < path[po]
      const baseW = basePx[2 * i + 1] * big
      let mean = 0
      for (let q = 0; q < P; q++) {
        const kq = reverse ? P - 1 - q : q
        const fa = FNODE[FNODE_A[kq]]
        const fore = fa + (FNODE[FNODE_B[kq]] - fa) * FNODE_T[kq]
        const wq = Math.max(0.35, baseW * PRESSURE[q] * fore)
        width[P * o + q] = wq
        mean += width[P * o + q]
      }
      if (mean / P < 0.6) continue
      if (big > CLOSE_UP_FROM) {
        for (let q = 0; q < P; q++) WT[q] = width[P * o + q]
        reshapeWidths(WT, big)
        for (let q = 0; q < P; q++) width[P * o + q] = WT[q]
      }
    } else if (rl === R_EDGE) {
      const baseW = basePx[2 * i + 1]
      for (let q = 0; q < P; q++) width[P * o + q] = Math.max(0.35, baseW * PRESSURE[q])
    } else {
      const baseW = basePx[2 * i + 1]
      for (let q = 0; q < P; q++) width[P * o + q] = baseW
    }
    // a loaded end that is the other one: the path runs the other way
    if (reverse) {
      for (let q = 0; q < P / 2; q++) {
        const r = P - 1 - q
        const sx = path[po + 2 * q], sy = path[po + 2 * q + 1]
        path[po + 2 * q] = path[po + 2 * r]
        path[po + 2 * q + 1] = path[po + 2 * r + 1]
        path[po + 2 * r] = sx
        path[po + 2 * r + 1] = sy
        const wx = worldPath[wo + 3 * q], wy = worldPath[wo + 3 * q + 1], wz = worldPath[wo + 3 * q + 2]
        worldPath[wo + 3 * q] = worldPath[wo + 3 * r]
        worldPath[wo + 3 * q + 1] = worldPath[wo + 3 * r + 1]
        worldPath[wo + 3 * q + 2] = worldPath[wo + 3 * r + 2]
        worldPath[wo + 3 * r] = wx
        worldPath[wo + 3 * r + 1] = wy
        worldPath[wo + 3 * r + 2] = wz
      }
    }
    role[o] = rl
    layerOut[o] = selLayer[j]
    depthOut[o] = selDepth[j]
    const c = 12 * i + 3 * level
    colour[3 * o] = bColour[c]
    colour[3 * o + 1] = bColour[c + 1]
    colour[3 * o + 2] = bColour[c + 2]
    alphaOut[o] = selAlpha[j]
    load[o] = baked.load[i]
    impasto[o] = baked.impasto[i]
    if (fixed) {
      bristles[o] = baked.bristles[i]
      bristleVar[o] = baked.bristleVar[i]
    } else {
      bristles[o] = big === 1 ? Math.min(MAX_BRISTLES, Math.max(1, Math.round(baked.bristles[i]))) : sizedBristles(baked.bristles[i], big)
      bristleVar[o] = big <= CLOSE_UP_FROM ? Math.min(1, Math.max(0, baked.bristleVar[i])) : sizedVariance(baked.bristleVar[i], big)
    }
    dry[o] = baked.dry[i]
    wet[o] = baked.wet[i]
    endSoft[o] = baked.endSoft[i]
    edge[o] = baked.edge[i]
    seed[o] = baked.seed[i]
    // (a stroke that has no surface under it, an edge or a line, has no normal)
    worldNormal[3 * o] = fixed ? 0 : anchorNrm[3 * i]
    worldNormal[3 * o + 1] = fixed ? 0 : anchorNrm[3 * i + 1]
    worldNormal[3 * o + 2] = fixed ? 0 : anchorNrm[3 * i + 2]
    hidden[o] = baked.hidden[i]
    source[o] = i
    bigOf[o] = big
    alive[o] = 1
    written++
  }
  // a stroke too thin or too short to see leaves a gap: close it up
  let o = written
  if (written < total) {
    let w = 0
    for (let s = 0; s < total; s++) {
      if (alive[s] === 0) continue
      if (w !== s) {
        role[w] = role[s]
        layerOut[w] = layerOut[s]
        for (let q = 0; q < 2 * P; q++) path[2 * P * w + q] = path[2 * P * s + q]
        for (let q = 0; q < P; q++) width[P * w + q] = width[P * s + q]
        depthOut[w] = depthOut[s]
        for (let q = 0; q < 3; q++) colour[3 * w + q] = colour[3 * s + q]
        alphaOut[w] = alphaOut[s]
        load[w] = load[s]
        impasto[w] = impasto[s]
        bristles[w] = bristles[s]
        bristleVar[w] = bristleVar[s]
        dry[w] = dry[s]
        wet[w] = wet[s]
        endSoft[w] = endSoft[s]
        edge[w] = edge[s]
        seed[w] = seed[s]
        for (let q = 0; q < 3 * P; q++) worldPath[3 * P * w + q] = worldPath[3 * P * s + q]
        for (let q = 0; q < 3; q++) worldNormal[3 * w + q] = worldNormal[3 * s + q]
        hidden[w] = hidden[s]
        source[w] = source[s]
        bigOf[w] = bigOf[s]
      }
      w++
    }
    o = w
  }

  const s = scr.stats
  s.considered = n
  s.selected = total
  s.written = o
  s.own = own.count
  s.silhouettes = nSil
  s.screenTested = cull
  s.offscreen = offscreen
  s.msOwn = t1 - t0
  s.msSelect = t2 - t1
  s.msSort = t3 - t2
  s.msPack = performance.now() - t3
  // (a result that is shorter than what was made, by the strokes left out, is a view of it)
  const whole = o === total && !scr.reuseOutput
  const cut = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, per: number): T => (whole ? a : (a.subarray(0, per * o) as T))
  return {
    count: o,
    role: cut(role, 1),
    layer: cut(layerOut, 1),
    path: cut(path, 2 * P),
    width: cut(width, P),
    depth: cut(depthOut, 1),
    colour: cut(colour, 3),
    alpha: cut(alphaOut, 1),
    load: cut(load, 1),
    impasto: cut(impasto, 1),
    bristles: cut(bristles, 1),
    bristleVar: cut(bristleVar, 1),
    dry: cut(dry, 1),
    wet: cut(wet, 1),
    endSoft: cut(endSoft, 1),
    edge: cut(edge, 1),
    seed: cut(seed, 1),
    worldPath: cut(worldPath, 3 * P),
    worldNormal: cut(worldNormal, 3),
    hidden: cut(hidden, 1),
  }
}

// The nineteen arrays of a batch of `total` strokes (a stroke batch's own, made fresh: the renderer may keep them).
interface Output {
  role: Uint8Array
  layer: Uint8Array
  path: Float32Array
  width: Float32Array
  depth: Float32Array
  colour: Float32Array
  alpha: Float32Array
  load: Float32Array
  impasto: Float32Array
  bristles: Float32Array
  bristleVar: Float32Array
  dry: Float32Array
  wet: Float32Array
  endSoft: Float32Array
  edge: Uint8Array
  seed: Uint32Array
  worldPath: Float32Array
  worldNormal: Float32Array
  hidden: Uint8Array
}

function makeOutput(total: number): Output {
  return {
    role: new Uint8Array(total), layer: new Uint8Array(total), path: new Float32Array(2 * P * total), width: new Float32Array(P * total),
    depth: new Float32Array(total), colour: new Float32Array(3 * total), alpha: new Float32Array(total), load: new Float32Array(total),
    impasto: new Float32Array(total), bristles: new Float32Array(total), bristleVar: new Float32Array(total), dry: new Float32Array(total),
    wet: new Float32Array(total), endSoft: new Float32Array(total), edge: new Uint8Array(total), seed: new Uint32Array(total),
    worldPath: new Float32Array(3 * P * total), worldNormal: new Float32Array(3 * total), hidden: new Uint8Array(total),
  }
}

// Can an anchor of the baked painting lie off the screen in this view? Not when the box that holds them all (its eight corners projected) is wholly in the
// viewport, nor when the sphere that holds them all is (its circle, from the scale at its centre and, under a perspective, the sphere's apparent size): a
// figure that is wholly in view (the usual one) needs no stroke tested. A corner behind the eye counts as off. (The box is tight on a flat sheet and the
// sphere on a ball; either is enough.)
const CORNER = [0, 0, 0]
function anchorsMayBeOffscreen(fc: FrameCtx, b: Float64Array): boolean {
  let boxIn = true
  for (let k = 0; k < 8 && boxIn; k++) {
    if (!project(fc, b[k & 1 ? 3 : 0], b[k & 2 ? 4 : 1], b[k & 4 ? 5 : 2], CORNER) || CORNER[0] < 0 || CORNER[1] < 0 || CORNER[0] > fc.W || CORNER[1] > fc.H) boxIn = false
  }
  if (boxIn) return false
  if (!project(fc, b[6], b[7], b[8], CORNER)) return true
  let r = b[9] * pxPerUnit(fc, b[6], b[7], b[8])
  if (!fc.ortho) {
    const d = CORNER[2]
    if (!(d > 2 * b[9])) return true
    r *= d / (d - b[9])
  }
  return CORNER[0] - r < 0 || CORNER[1] - r < 0 || CORNER[0] + r > fc.W || CORNER[1] + r > fc.H
}

export const frameFromBake: FrameFromBake = (baked, scene, view, params, gbuffer) => {
  let scr = scratches.get(baked.worldPath)
  if (!scr) {
    scr = new FrameScratch()
    scratches.set(baked.worldPath, scr)
  }
  return frameFromBakeWith(scr, baked, scene, view, params, gbuffer)
}

// What a bake's first frame makes once and every later one reads: the per-stroke anchors and kinds, and the vertex index of each opaque surface that the
// silhouettes read (tens of milliseconds on a big bake). A caller that wants the first interactive frame to cost what the others do calls this when the
// bake arrives.
export function prepareBake(baked: BakedPainting, scene: SpaceScene): void {
  prepOf(baked, scene)
  scene.marks.forEach((mark, m) => {
    const s = baked.surfaces[m]
    if (s && mark.kind === 'mesh' && mark.style.opacity >= 1) {
      indexOf(s)
      // (an open sheet's outline is cast against its mesh's BVH, which the first cast would build)
      if (!s.closed && s.uBack) casterOf(mark)
    }
  })
}

// The scratch `frameFromBake` keeps for a baked painting (the one `frameFromBakeWith` can be given), made when there is none.
export function scratchOf(baked: BakedPainting): FrameScratch {
  let scr = scratches.get(baked.worldPath)
  if (!scr) {
    scr = new FrameScratch()
    scratches.set(baked.worldPath, scr)
  }
  return scr
}

// ---- the data marks' own shapes: points and arrowheads ----

// A point is a short loaded dab of max(3, size) px centred exactly on the point; an arrowhead is two short strokes of max(6, headSize) px that meet
// exactly at the tip, ±26 degrees from the shaft (model/lines.ts). Both are built on the screen and anchored in the world (the anchor repeated for
// every world point: the stroke moves with it and does not turn); their colour is the mark's own, before the brush-load mix (BakedPainting.dataColour).
const HEAD_ANGLE = 0.46

// The seeds of a data mark's strokes, made once for the mark and kept: a point's dab, and an arrow's two barbs (the -1 side first), each from the mark's number,
// the cell of the point it is anchored at (its place at 1/7 of a unit, so a mark that has not moved has the seeds it had) and its tag (`p<i>`, `h<i>.<side>`).
// A frame reads them and hashes no strings.
const dataSeeds = new WeakMap<object, { m: number; seeds: Uint32Array }>()

function seedOf(m: number, x: number, y: number, z: number, tag: string): number {
  const cell = hash3(Math.round(x * 7), Math.round(y * 7), Math.round(z * 7))
  return hash3(m, cell, fnvInts(...Array.from(tag, (ch) => ch.charCodeAt(0)))) >>> 0
}

function seedsOf(m: number, mark: SpaceScene['marks'][number]): Uint32Array {
  const have = dataSeeds.get(mark)
  if (have && have.m === m) return have.seeds
  let seeds: Uint32Array
  if (mark.kind === 'points') {
    const n = mark.positions.length / 3
    seeds = new Uint32Array(n)
    for (let i = 0; i < n; i++) seeds[i] = seedOf(m, mark.positions[3 * i], mark.positions[3 * i + 1], mark.positions[3 * i + 2], `p${i}`)
  } else if (mark.kind === 'arrows') {
    const n = mark.tails.length / 3
    seeds = new Uint32Array(2 * n)
    for (let i = 0; i < n; i++) {
      // (the tip: where both barbs meet and are anchored)
      const x = mark.tails[3 * i] + mark.vectors[3 * i], y = mark.tails[3 * i + 1] + mark.vectors[3 * i + 1], z = mark.tails[3 * i + 2] + mark.vectors[3 * i + 2]
      seeds[2 * i] = seedOf(m, x, y, z, `h${i}.-1`)
      seeds[2 * i + 1] = seedOf(m, x, y, z, `h${i}.1`)
    }
  } else seeds = new Uint32Array(0)
  dataSeeds.set(mark, { m, seeds })
  return seeds
}

function addDataMarks(list: StrokeList, baked: BakedPainting, scene: SpaceScene, view: PaintView, params: PaintParams, fc: FrameCtx, veils: readonly Veil[]): void {
  const rp = params.roles.line
  const vp = fc.vp
  const { W, H } = fc
  const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
  const vx = view.viewDir[0], vy = view.viewDir[1], vz = view.viewDir[2]
  const haveVeils = veils.length > 0
  const at = [0, 0, 0]
  const widthFor = (style: number): number => rp.width * clamp(style / 2, 0.5, 3)

  // one stroke along the screen segment (x0, y0) to (x1, y1), its world points all `p`
  const emit = (m: number, seed: number, p: readonly number[], x0: number, y0: number, x1: number, y1: number, widthPx: number, depth: number, hiddenStyle: number): void => {
    const e = list.push()
    list.role[e] = R_LINE
    list.layer[e] = haveVeils && behindVeil(fc, veils, p) ? BEHIND_VEIL_LAYER : LAYER_LINE
    for (let q = 0; q < P; q++) {
      list.path[2 * P * e + 2 * q] = x0 + (x1 - x0) * TK[q]
      list.path[2 * P * e + 2 * q + 1] = y0 + (y1 - y0) * TK[q]
      list.width[P * e + q] = widthPx
      list.worldPath[3 * P * e + 3 * q] = p[0]
      list.worldPath[3 * P * e + 3 * q + 1] = p[1]
      list.worldPath[3 * P * e + 3 * q + 2] = p[2]
    }
    list.depth[e] = depth
    list.colour[3 * e] = baked.dataColour[3 * m]
    list.colour[3 * e + 1] = baked.dataColour[3 * m + 1]
    list.colour[3 * e + 2] = baked.dataColour[3 * m + 2]
    list.alpha[e] = 1
    list.load[e] = rp.load
    list.impasto[e] = rp.impasto
    list.bristles[e] = rp.bristles
    list.bristleVar[e] = rp.bristleVar
    list.dry[e] = rp.dry
    list.wet[e] = rp.wet
    list.endSoft[e] = 0
    list.edge[e] = 255
    list.seed[e] = seed
    list.worldNormal[3 * e] = 0
    list.worldNormal[3 * e + 1] = 0
    list.worldNormal[3 * e + 2] = 0
    list.hidden[e] = hiddenStyle
  }
  // the screen position and view depth of a world point; false behind the eye
  const proj = (x: number, y: number, z: number): boolean => {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
    if (w <= 1e-9) return false
    at[0] = ((((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) + 1) / 2) * W
    at[1] = ((1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) / 2) * H
    at[2] = (x - ex) * vx + (y - ey) * vy + (z - ez) * vz
    return true
  }
  const p = [0, 0, 0]
  scene.marks.forEach((mark, m) => {
    if (mark.kind === 'points') {
      const seeds = seedsOf(m, mark)
      const size = Math.max(3, mark.style.size)
      const len = size * 0.5
      const reach = size + len
      for (let i = 0; i < mark.positions.length / 3; i++) {
        p[0] = mark.positions[3 * i]
        p[1] = mark.positions[3 * i + 1]
        p[2] = mark.positions[3 * i + 2]
        if (!proj(p[0], p[1], p[2])) continue
        const sx = at[0], sy = at[1]
        if (sx < -reach || sy < -reach || sx > W + reach || sy > H + reach) continue
        emit(m, seeds[i], p, sx - len / 2, sy, sx + len / 2, sy, size, at[2], HIDDEN_NONE)
      }
    } else if (mark.kind === 'arrows') {
      const seeds = seedsOf(m, mark)
      const width = widthFor(mark.style.shaftWidth)
      const head = Math.max(6, mark.style.headSize)
      const hiddenStyle = mark.style.hidden === 'dashed' ? HIDDEN_DASHED : HIDDEN_NONE
      const reach = head + width
      const tail = [0, 0, 0]
      for (let i = 0; i < mark.tails.length / 3; i++) {
        tail[0] = mark.tails[3 * i]
        tail[1] = mark.tails[3 * i + 1]
        tail[2] = mark.tails[3 * i + 2]
        p[0] = tail[0] + mark.vectors[3 * i]
        p[1] = tail[1] + mark.vectors[3 * i + 1]
        p[2] = tail[2] + mark.vectors[3 * i + 2]
        if (!proj(tail[0], tail[1], tail[2])) continue
        const tx = at[0], ty = at[1]
        if (!proj(p[0], p[1], p[2])) continue
        const px = at[0], py = at[1], pd = at[2]
        if (px < -reach || py < -reach || px > W + reach || py > H + reach) continue
        const dx = px - tx, dy = py - ty
        const l = Math.hypot(dx, dy)
        if (l < 1e-6) continue
        const ux = dx / l, uy = dy / l
        for (let side = 0; side < 2; side++) {
          const sgn = 2 * side - 1
          const ang = sgn * HEAD_ANGLE
          const c = Math.cos(ang), s = Math.sin(ang)
          const hx = -(ux * c - uy * s) * head
          const hy = -(ux * s + uy * c) * head
          emit(m, seeds[2 * i + side], p, px + hx, py + hy, px, py, width, pd, hiddenStyle)
        }
      }
    }
  })
}
