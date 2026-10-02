// The underpainting (paint-zoom; spec addendum, Ben 2026-10-02): "no bare canvas inside a form, ever".
//
// Zoomed in, the strokes (capped by the particle supply) leave bare canvas between them. A painter lays a
// thin, scumbled imprimatura first, in the colour the form is going to be, and paints over it. So the
// model hands the renderer, with the strokes, an IMAGE at G-buffer resolution: for every covered pixel,
// the curve colour of that pixel (its plan value through the value plan and the lighting curve, from its
// mark's local colour, a colormap included, with the plane's hue step), moved by the brush-load mix of the
// surface cell it lies on at UNDERPAINT_MIX of the strokes' strength, so the underpainting is a little
// patchy in the way the strokes over it are. Where nothing is drawn, and on bare table in the light
// (which is canvas, the ground the figure is painted on), it is NaN. The renderer lays it first, behind a
// brushy mask (gl/underpaint.ts).
//
// A colour per pixel would cost more than the whole of the rest of a frame, and an imprimatura is
// smooth, so the colours are made on a lattice, one sample per UNDERPAINT_CELL_PX CSS px square (one per
// mark in it), and the image is filled from them: bilinear among the samples of the pixel's own mark
// (never across meshes), so a form's edge is exact (it comes from the full G-buffer) and its colour is
// smooth. What each sample's colour is made of is kept (a field), so a colour parameter changes the image
// with no analysis, as it does the strokes (recolourFrame).

import type { PaintParams } from '../params'
import type { GBuffer, Oklab } from '../types'
import { oklabToLinear } from './colour'
import { LoadMixer } from './mix'
import { cellId } from './particles'
import { stepValue } from './planes'
import { colourOfRecipe, newRecipe, type RecipeEnv } from './recipe'
import { clamp } from './math'
import type { PaintCtx } from './strokes'
import { ambientShare } from './value'
import { toEye, unproject } from './view'

// The strength of the brush-load mix on the underpainting, against a block-in stroke's (the spec's "reduced").
export const UNDERPAINT_MIX = 0.5
// One colour sample per this many CSS px square.
export const UNDERPAINT_CELL_PX = 12
// Distinct marks sampled in one lattice cell (a cell holds a boundary of a few meshes at most).
const MAX_MARKS_PER_CELL = 8

export interface UnderpaintField {
  // The full G-buffer's size, and its owner: the mark painted at each pixel, -1 where nothing is (the
  // table in the light is not painted: it is the canvas).
  width: number
  height: number
  owner: Int32Array
  // The lattice: cells over the full G-buffer, `cell` full pixels on a side. The samples of cell c are
  // [cellStart[c], cellStart[c + 1]), each of one mark.
  lw: number
  lh: number
  cell: number
  cellStart: Int32Array
  // Per sample: its mark, and what its colour is made of (a recipe, in flat arrays).
  count: number
  mark: Int32Array
  lab: Float32Array // the local colour, 3 per sample
  u: Float32Array // the value it is made at
  nz: Float32Array
  bounce: Float32Array
  amb: Float32Array
  plane: Float32Array // the plane's mean normal, 3 per sample (NaN when the sample is on no plane)
  pos: Float32Array // the world point, 3 per sample
  flags: Uint8Array // 1: colormapped, 2: bare table (the ground's own local colour)
  cellOf: Uint32Array // the surface cell of the point, the key of the brush-load mix
}

// ---- building the field ----

const FLAG_MAPPED = 1
const FLAG_GROUND = 2

export function buildUnderpaintField(an: PaintCtx, full: GBuffer): UnderpaintField {
  const { fc, plan, planes, curve } = an
  const params = fc.params
  const a = fc.g
  const aw = a.width
  const ah = a.height
  const stride = an.stride
  const step = Math.max(1, Math.round(UNDERPAINT_CELL_PX / a.scale))
  const lw = Math.ceil(aw / step)
  const lh = Math.ceil(ah / step)

  // what is painted: every covered pixel but the table in the light
  const owner = new Int32Array(full.width * full.height)
  for (let i = 0; i < owner.length; i++) {
    const m = full.mark[i]
    owner[i] = m < 0 || (fc.ground[m] === 1 && full.shadow[i] !== 1) ? -1 : m
  }
  const paints = (i: number): number => {
    const m = a.mark[i]
    return m < 0 || (fc.ground[m] === 1 && a.shadow[i] !== 1) ? -1 : m
  }

  // marks whose colour varies over the surface (a colormap) need the nearest particle's colour; the rest have one
  const mapped = new Uint8Array(fc.scene.marks.length)
  for (let k = 0; k < an.vis.count; k++) if (an.set.colormapped[an.vis.idx[k]] === 1) mapped[an.set.mark[an.vis.idx[k]]] = 1
  const grid = mapped.some((v) => v === 1) ? new MappedGrid(an, mapped) : null

  // pass 1: one sample per mark per cell, at the pixel of that mark nearest the cell's centre
  const picked: number[] = []
  const cellStart = new Int32Array(lw * lh + 1)
  const markIn = new Int32Array(MAX_MARKS_PER_CELL)
  const pixIn = new Int32Array(MAX_MARKS_PER_CELL)
  const distIn = new Float64Array(MAX_MARKS_PER_CELL)
  for (let cy = 0; cy < lh; cy++) {
    for (let cx = 0; cx < lw; cx++) {
      const centreX = cx * step + (step - 1) / 2
      const centreY = cy * step + (step - 1) / 2
      let n = 0
      for (let y = cy * step; y < Math.min(ah, (cy + 1) * step); y++) {
        for (let x = cx * step; x < Math.min(aw, (cx + 1) * step); x++) {
          const i = y * aw + x
          const m = paints(i)
          if (m < 0) continue
          const d = (x - centreX) ** 2 + (y - centreY) ** 2
          let s = -1
          for (let q = 0; q < n; q++) if (markIn[q] === m) s = q
          if (s < 0) {
            if (n >= MAX_MARKS_PER_CELL) continue
            s = n++
            markIn[s] = m
            pixIn[s] = i
            distIn[s] = d
          } else if (d < distIn[s]) {
            pixIn[s] = i
            distIn[s] = d
          }
        }
      }
      for (let q = 0; q < n; q++) picked.push(pixIn[q])
      cellStart[cy * lw + cx + 1] = picked.length
    }
  }

  // pass 2: what each sample's colour is made of
  const count = picked.length
  const f: UnderpaintField = {
    width: full.width,
    height: full.height,
    owner,
    lw,
    lh,
    cell: step * stride,
    cellStart,
    count,
    mark: new Int32Array(count),
    lab: new Float32Array(3 * count),
    u: new Float32Array(count),
    nz: new Float32Array(count),
    bounce: new Float32Array(count),
    amb: new Float32Array(count),
    plane: new Float32Array(3 * count).fill(Number.NaN),
    pos: new Float32Array(3 * count),
    flags: new Uint8Array(count),
    cellOf: new Uint32Array(count),
  }
  // the brush-load cell follows the zoom, as the strokes' do (brush.ts loadCellLevel)
  const loadCell = Math.max(1e-6, params.mix.loadCell) / 2 ** fc.loadLevel
  const pt = [0, 0, 0]
  const ve = [0, 0, 0]
  for (let s = 0; s < count; s++) {
    const i = picked[s]
    const m = a.mark[i]
    const ax = i % aw
    const ay = (i - ax) / aw
    const sx = (ax + 0.5) * a.scale
    const sy = (ay + 0.5) * a.scale
    unproject(fc, sx, sy, a.depth[i], pt)
    toEye(fc, pt[0], pt[1], pt[2], ve)
    let nx = a.normal[3 * i]
    let ny = a.normal[3 * i + 1]
    let nz = a.normal[3 * i + 2]
    if (nx * ve[0] + ny * ve[1] + nz * ve[2] < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const nl = Math.hypot(nx, ny, nz) || 1
    nz /= nl
    const ground = fc.ground[m] === 1
    const plane = planes.plane[i]
    // the plane's own short gradient, as the strokes take it
    const dev = curve.devU(pt[0], pt[1], pt[2])
    const stepped = plane >= 0 ? stepValue(planes, plane, plan.u[i] + dev, params.edges.planeGradient) : plan.u[i] + dev
    f.mark[s] = m
    f.u[s] = clamp(stepped, 0.02, 0.99)
    f.nz[s] = nz
    f.bounce[s] = plan.bounce[i]
    f.amb[s] = ambientShare(params, nz, plan.value[i])
    f.pos[3 * s] = pt[0]
    f.pos[3 * s + 1] = pt[1]
    f.pos[3 * s + 2] = pt[2]
    f.cellOf[s] = cellId(Math.floor(pt[0] / loadCell), Math.floor(pt[1] / loadCell), Math.floor(pt[2] / loadCell))
    if (plane >= 0 && !ground) {
      const p = planes.planes[plane]
      f.plane[3 * s] = p.nx
      f.plane[3 * s + 1] = p.ny
      f.plane[3 * s + 2] = p.nz
    }
    let flags = ground ? FLAG_GROUND : 0
    let local: ArrayLike<number> = [an.markColour[3 * m], an.markColour[3 * m + 1], an.markColour[3 * m + 2]]
    if (mapped[m] === 1 && grid) {
      const k = grid.nearest(sx, sy, m)
      if (k >= 0) {
        const p = an.vis.idx[k]
        local = [an.set.colour[3 * p], an.set.colour[3 * p + 1], an.set.colour[3 * p + 2]]
        if (an.set.colormapped[p] === 1) flags |= FLAG_MAPPED
      }
    }
    f.flags[s] = flags
    f.lab[3 * s] = local[0]
    f.lab[3 * s + 1] = local[1]
    f.lab[3 * s + 2] = local[2]
  }
  return f
}

// The visible particles of the colour-mapped marks, bucketed by screen position: the nearest one gives a
// pixel's local colour (the colormap at the surface point's own value, which only the particles carry).
class MappedGrid {
  private readonly bw: number
  private readonly bh: number
  private readonly head: Int32Array
  private readonly next: Int32Array
  private readonly an: PaintCtx
  private static readonly BUCKET = 12

  constructor(an: PaintCtx, mapped: Uint8Array) {
    this.an = an
    const B = MappedGrid.BUCKET
    this.bw = Math.ceil(an.fc.W / B) + 1
    this.bh = Math.ceil(an.fc.H / B) + 1
    this.head = new Int32Array(this.bw * this.bh).fill(-1)
    this.next = new Int32Array(an.vis.count).fill(-1)
    for (let k = 0; k < an.vis.count; k++) {
      if (mapped[an.set.mark[an.vis.idx[k]]] !== 1) continue
      const b = this.bucket(an.vis.sx[k], an.vis.sy[k])
      this.next[k] = this.head[b]
      this.head[b] = k
    }
  }

  private bucket(x: number, y: number): number {
    const B = MappedGrid.BUCKET
    return clamp(Math.floor(y / B), 0, this.bh - 1) * this.bw + clamp(Math.floor(x / B), 0, this.bw - 1)
  }

  // The visible entry of `mark` nearest (sx, sy): within a few buckets, else -1.
  nearest(sx: number, sy: number, mark: number): number {
    const B = MappedGrid.BUCKET
    const bx = clamp(Math.floor(sx / B), 0, this.bw - 1)
    const by = clamp(Math.floor(sy / B), 0, this.bh - 1)
    const { vis, set } = this.an
    let best = -1
    let bd = Number.POSITIVE_INFINITY
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let y = Math.max(0, by - r); y <= Math.min(this.bh - 1, by + r); y++) {
        for (let x = Math.max(0, bx - r); x <= Math.min(this.bw - 1, bx + r); x++) {
          for (let k = this.head[y * this.bw + x]; k >= 0; k = this.next[k]) {
            if (set.mark[vis.idx[k]] !== mark) continue
            const d = (vis.sx[k] - sx) ** 2 + (vis.sy[k] - sy) ** 2
            if (d < bd || (d === bd && k < best)) {
              bd = d
              best = k
            }
          }
        }
      }
    }
    return best
  }
}

// ---- the colours ----

// The colour (linear-light sRGB, 3 per sample) of every sample under `params`: the curve colour of what
// it is made of, then the cell's brush-load mix at UNDERPAINT_MIX of its strength.
export function underpaintColours(f: UnderpaintField, params: PaintParams, env: RecipeEnv): Float32Array {
  const out = new Float32Array(3 * f.count)
  const mixer = new LoadMixer({ ...params, mix: { ...params.mix, strength: params.mix.strength * UNDERPAINT_MIX } })
  const r = newRecipe()
  for (let s = 0; s < f.count; s++) {
    r.ground = (f.flags[s] & FLAG_GROUND) !== 0
    r.lx = f.lab[3 * s]
    r.ly = f.lab[3 * s + 1]
    r.lz = f.lab[3 * s + 2]
    r.u = f.u[s]
    r.nz = f.nz[s]
    r.bounce = f.bounce[s]
    r.ambientShare = f.amb[s]
    r.hasPlane = !Number.isNaN(f.plane[3 * s])
    r.pnx = r.hasPlane ? f.plane[3 * s] : 0
    r.pny = r.hasPlane ? f.plane[3 * s + 1] : 0
    r.pnz = r.hasPlane ? f.plane[3 * s + 2] : 0
    r.colormapped = (f.flags[s] & FLAG_MAPPED) !== 0
    r.field = true
    r.px = f.pos[3 * s]
    r.py = f.pos[3 * s + 1]
    r.pz = f.pos[3 * s + 2]
    const lab = colourOfRecipe(r, env)
    // the mix is keyed to the surface cell, so the underpainting keeps its patches as the camera orbits
    const mixed = mixer.mix({ role: 'block', cell: f.cellOf[s], u: f.u[s], x: 0, y: 0, lab, colormapped: r.colormapped, seed: f.cellOf[s], jitter: 0 })
    const lin = oklabToLinear(mixed.lab as Oklab)
    out[3 * s] = lin[0]
    out[3 * s + 1] = lin[1]
    out[3 * s + 2] = lin[2]
  }
  return out
}

// ---- the image ----

// The sample of mark `m` in lattice cell c, or -1.
function sampleOf(f: UnderpaintField, c: number, m: number): number {
  for (let s = f.cellStart[c]; s < f.cellStart[c + 1]; s++) if (f.mark[s] === m) return s
  return -1
}

// The image: per G-buffer pixel the colour of the samples of its own mark about it (bilinear on the
// lattice), NaN where nothing is painted.
export function fillUnderpaint(f: UnderpaintField, colours: Float32Array): Float32Array {
  const { width: W, height: H, owner, lw, lh, cell } = f
  const out = new Float32Array(3 * W * H).fill(Number.NaN)
  const inv = 1 / cell
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * inv - 0.5
    const y0 = Math.floor(fy)
    const ty = fy - y0
    for (let x = 0; x < W; x++) {
      const m = owner[y * W + x]
      if (m < 0) continue
      const fx = (x + 0.5) * inv - 0.5
      const x0 = Math.floor(fx)
      const tx = fx - x0
      let r = 0
      let g = 0
      let b = 0
      let ws = 0
      for (let dy = 0; dy < 2; dy++) {
        const cy = y0 + dy
        if (cy < 0 || cy >= lh) continue
        for (let dx = 0; dx < 2; dx++) {
          const cx = x0 + dx
          if (cx < 0 || cx >= lw) continue
          const s = sampleOf(f, cy * lw + cx, m)
          if (s < 0) continue
          const w = (dx === 1 ? tx : 1 - tx) * (dy === 1 ? ty : 1 - ty)
          r += colours[3 * s] * w
          g += colours[3 * s + 1] * w
          b += colours[3 * s + 2] * w
          ws += w
        }
      }
      const o = 3 * (y * W + x)
      if (ws > 1e-4) {
        out[o] = r / ws
        out[o + 1] = g / ws
        out[o + 2] = b / ws
        continue
      }
      // no sample of this mark at the four corners (a sliver of mesh, or the edge of one): the nearest sample of it
      const s = nearestSample(f, fx, fy, m)
      if (s >= 0) {
        out[o] = colours[3 * s]
        out[o + 1] = colours[3 * s + 1]
        out[o + 2] = colours[3 * s + 2]
      }
    }
  }
  return out
}

// The sample of mark m nearest lattice position (fx, fy) (in cells, the centre of cell c at c), within 2 cells; -1 if none.
function nearestSample(f: UnderpaintField, fx: number, fy: number, m: number): number {
  const cx0 = Math.round(fx)
  const cy0 = Math.round(fy)
  let best = -1
  let bd = Number.POSITIVE_INFINITY
  for (let cy = Math.max(0, cy0 - 2); cy <= Math.min(f.lh - 1, cy0 + 2); cy++) {
    for (let cx = Math.max(0, cx0 - 2); cx <= Math.min(f.lw - 1, cx0 + 2); cx++) {
      const s = sampleOf(f, cy * f.lw + cx, m)
      if (s < 0) continue
      const d = (cx - fx) ** 2 + (cy - fy) ** 2
      if (d < bd) {
        bd = d
        best = s
      }
    }
  }
  return best
}

// The whole underpainting of a field under `params`.
export function underpaintImage(f: UnderpaintField, params: PaintParams, env: RecipeEnv): Float32Array {
  return fillUnderpaint(f, underpaintColours(f, params, env))
}
