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
// mark and value family in it), and the image is filled from them: bilinear among the samples of the pixel's
// own mark AND family (never across meshes, and never across the terminator or a cast shadow's edge: the
// light and the shadow family are blended each within itself, so the bilinear fill cannot lift a shadow
// pixel into the half-tones, which it did, by up to 0.1 in lightness at N·L -0.05 to -0.1, more on a small
// figure), so a form's edge is exact (it comes from the full G-buffer) and its colour is smooth. What each
// sample's colour is made of is kept (a field), so a colour parameter changes the image with no analysis, as
// it does the strokes (recolourFrame). A sample's lightness is held on its family's side of the cap (shadow)
// or of the darkest half-tone (light), after the brush-load mix, as the strokes' is (strokes.ts packStrokes).
//
// THE TERMINATOR TURNS AS THE PLAN'S DOES. The plan has a soft edge there, terminatorSoftness wide and centred on
// N·L = 0 (the one place the two families meet, and the ordering rule exempts it): the pixels inside it (the BAND)
// are not blended from the lattice at all. Each is made at its own plan value (planSample at the pixel's own normal,
// at the full G-buffer's resolution), from the recipe of the nearest lattice sample on its own side of the
// terminator (its local colour, plane hue step, mix cell), so the underpainting's value runs through the band as the
// plan's does: neither crisper (a step at N·L = 0, where the families are keyed apart) nor blurrier (a 12 px
// blend). The samples themselves are taken from outside the band where a cell has any such pixel of the family. And a
// lattice pixel is only as good as its samples, which are up to 12 px away on a ramp: where the
// plan climbs fast (a form seen with the light at its edge) the pixels just outside the band would sit tens of
// hundredths over the plan and the band would meet them in a seam. So the band has a RING, as wide again, outside it:
// its pixels are made the same way, at the plan's value, and blended into the lattice's colour
// by their distance from the band (all of it at the band's edge, none at the ring's): in N·L, a band's width, and in the image, three pixels.

import type { PaintParams } from '../params'
import type { GBuffer, Oklab } from '../types'
import { holdLightness, oklabToLinear } from './colour'
import { LoadMixer } from './mix'
import { cellId } from './particles'
import { chamferDist, stepValue } from './planes'
import { colourOfRecipe, newRecipe, type RecipeEnv } from './recipe'
import { clamp, smooth } from './math'
import type { PaintCtx } from './strokes'
import { ambientShare, familyBound, FAM_LIGHT, FAM_SHADOW, holdFamily, lightWeight, newZoneSample, planSample } from './value'
import { toEye, unproject } from './view'

// The strength of the brush-load mix on the underpainting, against a block-in stroke's (the spec's "reduced").
export const UNDERPAINT_MIX = 0.5
// One colour sample per this many CSS px square.
export const UNDERPAINT_CELL_PX = 12
// The value of `ownerFam` for a pixel inside the plan's terminator band: made at its own plan value, not from the lattice.
export const FAM_BAND = 2
// A lattice sample is taken from a pixel of the band only where its cell has no other pixel of the mark and family.
const BAND_PENALTY = 1e9
// The ring about the band is, besides the plan's own N·L reach (a band's width more), this many pixels of the image: where the plan climbs a
// tenth in one pixel (a form's limb with the light at its edge) the ring in N·L is no pixel wide, and the band would meet the lattice, which
// is tens of hundredths off there, in a seam.
export const RING_PX = 3
// Distinct (mark, family) pairs sampled in one lattice cell (a cell holds a boundary of a few meshes at most, each
// with its terminator or shadow edge).
const MAX_KEYS_PER_CELL = 16

export interface UnderpaintField {
  // The full G-buffer's size, and its owner: the mark painted at each pixel, -1 where nothing is (the
  // table in the light is not painted: it is the canvas); and its value family (FAM_LIGHT or FAM_SHADOW), or
  // FAM_BAND for a pixel inside the plan's terminator band.
  width: number
  height: number
  owner: Int32Array
  ownerFam: Uint8Array
  // The pixels of the band and of its ring (indices into the image), the lattice sample whose recipe each is made from, the
  // value it is made at (the plan's, at the pixel's own normal, with the seeded deviation of the surface point), and how much of its
  // own colour it takes: 1 in the band, falling to 0 across the ring.
  bandPix: Int32Array
  bandDonor: Int32Array
  bandU: Float32Array
  bandW: Float32Array
  // The family of each (FAM_BAND for a pixel of the band itself: it is held to none, it is the plan's own edge) and the bound of its value
  // in plan values (value.ts familyBound at its pixel): a ring pixel's lightness is held to its family's side of the bound, as a sample's.
  bandFam: Uint8Array
  bandBound: Float32Array
  // The lattice: cells over the full G-buffer, `cell` full pixels on a side. The samples of cell c are
  // [cellStart[c], cellStart[c + 1]), each of one mark.
  lw: number
  lh: number
  cell: number
  cellStart: Int32Array
  // Per sample: its mark and its value family (a pixel takes the samples of its own mark and family), the bound
  // of its value in plan values (the cap, the darkest half-tone, or the plan's own where it is beyond them: value.ts
  // familyBound), and what its colour is made of (a recipe, in flat arrays).
  count: number
  mark: Int32Array
  fam: Uint8Array
  bound: Float32Array
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

  // what is painted: every covered pixel but the table in the light, and the value family of each (the plan's: the
  // weight of the light over a half, from the pixel's own N·L and shadow flag)
  const owner = new Int32Array(full.width * full.height)
  const ownerFam = new Uint8Array(full.width * full.height)
  const ts = Math.max(1e-4, params.value.terminatorSoftness)
  const lightDir = fc.view.lightDir
  for (let i = 0; i < owner.length; i++) {
    const m = full.mark[i]
    owner[i] = m < 0 || (fc.ground[m] === 1 && full.shadow[i] !== 1) ? -1 : m
    if (owner[i] < 0) continue
    const nl = full.normal[3 * i] * lightDir[0] + full.normal[3 * i + 1] * lightDir[1] + full.normal[3 * i + 2] * lightDir[2]
    // (the family a band pixel keeps if it ends with no recipe to be made from: its side of the terminator)
    ownerFam[i] = Math.abs(nl) < ts / 2 ? FAM_BAND : lightWeight(ts, nl, full.shadow[i] === 1) > 0.5 ? FAM_LIGHT : FAM_SHADOW
  }
  const inBand = (i: number): boolean => Math.abs(plan.nl[i]) < ts / 2
  const paints = (i: number): number => {
    const m = a.mark[i]
    return m < 0 || (fc.ground[m] === 1 && a.shadow[i] !== 1) ? -1 : m
  }

  // marks whose colour varies over the surface (a colormap) need the nearest particle's colour; the rest have one
  const mapped = new Uint8Array(fc.scene.marks.length)
  for (let k = 0; k < an.vis.count; k++) if (an.set.colormapped[an.vis.idx[k]] === 1) mapped[an.set.mark[an.vis.idx[k]]] = 1
  const grid = mapped.some((v) => v === 1) ? new MappedGrid(an, mapped) : null

  // pass 1: one sample per mark and family per cell, at the pixel of that mark and family nearest the cell's centre
  const picked: number[] = []
  const cellStart = new Int32Array(lw * lh + 1)
  const markIn = new Int32Array(MAX_KEYS_PER_CELL)
  const pixIn = new Int32Array(MAX_KEYS_PER_CELL)
  const distIn = new Float64Array(MAX_KEYS_PER_CELL)
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
          // the key: the mark, and its family here
          const key = 2 * m + plan.fam[i]
          const d = (x - centreX) ** 2 + (y - centreY) ** 2 + (inBand(i) ? BAND_PENALTY : 0)
          let s = -1
          for (let q = 0; q < n; q++) if (markIn[q] === key) s = q
          if (s < 0) {
            if (n >= MAX_KEYS_PER_CELL) continue
            s = n++
            markIn[s] = key
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
    ownerFam,
    bandPix: new Int32Array(0),
    bandDonor: new Int32Array(0),
    bandU: new Float32Array(0),
    bandW: new Float32Array(0),
    bandFam: new Uint8Array(0),
    bandBound: new Float32Array(0),
    lw,
    lh,
    cell: step * stride,
    cellStart,
    count,
    mark: new Int32Array(count),
    fam: new Uint8Array(count),
    bound: new Float32Array(count),
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
    f.fam[s] = plan.fam[i]
    f.bound[s] = familyBound(plan, i)
    f.u[s] = clamp(holdFamily(plan, i, stepped), 0.02, 0.99)
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

  // the band: each pixel inside the plan's terminator edge, at its own plan value, from the nearest sample on its side; and
  // the ring about it, the same, to be blended into the lattice's colour
  const pix: number[] = []
  const donors: number[] = []
  const values: number[] = []
  const weights: number[] = []
  const bandMask = new Uint8Array(owner.length)
  for (let i = 0; i < owner.length; i++) bandMask[i] = owner[i] >= 0 && ownerFam[i] === FAM_BAND ? 1 : 0
  const toBand = chamferDist(bandMask, full.width, full.height)
  const fams: number[] = []
  const bounds: number[] = []
  const zs = newZoneSample()
  const inv = 1 / f.cell
  const W = full.width
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0) continue
    const x = i % W
    const y = (i - x) / W
    const nx = full.normal[3 * i]
    const ny = full.normal[3 * i + 1]
    const nz = full.normal[3 * i + 2]
    const nl = nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]
    const inBandPx = ownerFam[i] === FAM_BAND
    // (a ring pixel is of a family, and takes a donor of it)
    if (!inBandPx && Math.abs(nl) >= ts * 1.5 && toBand[i] > RING_PX) continue
    const side = inBandPx ? (nl > 0 ? FAM_LIGHT : FAM_SHADOW) : ownerFam[i]
    const fx = (x + 0.5) * inv - 0.5
    const fy = (y + 0.5) * inv - 0.5
    let donor = nearestSample(f, fx, fy, owner[i], side)
    if (donor < 0) donor = nearestSample(f, fx, fy, owner[i], -1)
    if (donor < 0) {
      // nothing of this mark within reach: the pixel is filled from the lattice, as a pixel of its side
      if (inBandPx) ownerFam[i] = side
      continue
    }
    // the plan at the pixel's own normal, at the full G-buffer's resolution (the occlusion is the analysis'), and the surface
    // point's deviation: the value the strokes' plan gives it, before the plane's own step
    const ai = Math.min(ah - 1, Math.floor(y / stride)) * aw + Math.min(aw - 1, Math.floor(x / stride))
    planSample(params, plan.curves, nl, full.shadow[i] === 1, nx, ny, nz, plan.ao[ai], zs)
    unproject(fc, (x + 0.5) * full.scale, (y + 0.5) * full.scale, full.depth[i], pt)
    // (the plan's value itself, with the surface point's seeded deviation: no plane step, which would put the planes' own step
    // across the terminator back; the ring blends it into the lattice's)
    pix.push(i)
    donors.push(donor)
    values.push(clamp(zs.u + curve.devU(pt[0], pt[1], pt[2]), 0.02, 0.99))
    weights.push(inBandPx ? 1 : Math.max(1 - smooth(ts / 2, ts * 1.5, Math.abs(nl)), 1 - smooth(0, RING_PX + 1, toBand[i])))
    fams.push(inBandPx ? FAM_BAND : ownerFam[i])
    bounds.push(familyBound(plan, ai))
  }
  f.bandPix = Int32Array.from(pix)
  f.bandDonor = Int32Array.from(donors)
  f.bandU = Float32Array.from(values)
  f.bandW = Float32Array.from(weights)
  f.bandFam = Uint8Array.from(fams)
  f.bandBound = Float32Array.from(bounds)
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
// What sample s is made of, as a recipe (written into r).
function readSample(f: UnderpaintField, s: number, r: ReturnType<typeof newRecipe>): void {
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
}

const mixerOf = (params: PaintParams): LoadMixer => new LoadMixer({ ...params, mix: { ...params.mix, strength: params.mix.strength * UNDERPAINT_MIX } })

// The colour (linear-light sRGB, 3 per band pixel) of every pixel of the plan's terminator band and of its ring: the recipe of its
// donor sample made at the pixel's own plan value, then the donor cell's brush-load mix. A pixel of the band is held to no family: it
// is where the two meet, and its value is the plan's. A pixel of the ring is of a family, and its lightness is held on that family's
// side of the bound, after the mix and the gamut fit, as a lattice sample's is.
export function underpaintBandColours(f: UnderpaintField, params: PaintParams, env: RecipeEnv): Float32Array {
  const out = new Float32Array(3 * f.bandPix.length)
  const mixer = mixerOf(params)
  const r = newRecipe()
  for (let k = 0; k < f.bandPix.length; k++) {
    const s = f.bandDonor[k]
    readSample(f, s, r)
    r.u = f.bandU[k]
    const lab = colourOfRecipe(r, env)
    const mixed = mixer.mix({ role: 'block', cell: f.cellOf[s], u: r.u, x: 0, y: 0, lab, colormapped: r.colormapped, seed: f.cellOf[s], jitter: 0 })
    let held = mixed.lab as Oklab
    if (f.bandFam[k] !== FAM_BAND) {
      r.u = f.bandBound[k]
      held = holdLightness(held, f.bandFam[k] === FAM_SHADOW, colourOfRecipe(r, env)[0])
    }
    const lin = oklabToLinear(held)
    out[3 * k] = lin[0]
    out[3 * k + 1] = lin[1]
    out[3 * k + 2] = lin[2]
  }
  return out
}

export function underpaintColours(f: UnderpaintField, params: PaintParams, env: RecipeEnv): Float32Array {
  const out = new Float32Array(3 * f.count)
  const mixer = mixerOf(params)
  const r = newRecipe()
  for (let s = 0; s < f.count; s++) {
    readSample(f, s, r)
    const lab = colourOfRecipe(r, env)
    // the mix is keyed to the surface cell, so the underpainting keeps its patches as the camera orbits
    const mixed = mixer.mix({ role: 'block', cell: f.cellOf[s], u: f.u[s], x: 0, y: 0, lab, colormapped: r.colormapped, seed: f.cellOf[s], jitter: 0 })
    // the sample's lightness held on its family's side of the bound (what the same recipe is at the cap, or at the
    // darkest half-tone), after the mix and the gamut fit, as a stroke's is
    r.u = f.bound[s]
    const bound = colourOfRecipe(r, env)[0]
    const lin = oklabToLinear(holdLightness(mixed.lab, f.fam[s] === FAM_SHADOW, bound) as Oklab)
    out[3 * s] = lin[0]
    out[3 * s + 1] = lin[1]
    out[3 * s + 2] = lin[2]
  }
  return out
}

// ---- the image ----

// The sample of mark `m` and family `fam` in lattice cell c, or -1; with fam < 0, of mark `m` in either (the fallback).
function sampleOf(f: UnderpaintField, c: number, m: number, fam: number): number {
  for (let s = f.cellStart[c]; s < f.cellStart[c + 1]; s++) if (f.mark[s] === m && (fam < 0 || f.fam[s] === fam)) return s
  return -1
}

// The image: per G-buffer pixel the colour of the samples of its own mark and family about it (bilinear on the
// lattice: the light family and the shadow family are never blended into one another, as two meshes are not), NaN
// where nothing is painted.
export function fillUnderpaint(f: UnderpaintField, colours: Float32Array, bandColours?: Float32Array): Float32Array {
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
      const fam = f.ownerFam[y * W + x]
      if (fam === FAM_BAND) continue // (the band is filled below)
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
          const s = sampleOf(f, cy * lw + cx, m, fam)
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
      // no sample of this mark and family at the four corners (a sliver of mesh, or the edge of one, or of a shadow): the
      // nearest sample of the same family, and failing that of the same mark, so no pixel of a form is left bare
      let s = nearestSample(f, fx, fy, m, fam)
      if (s < 0) s = nearestSample(f, fx, fy, m, -1)
      if (s >= 0) {
        out[o] = colours[3 * s]
        out[o + 1] = colours[3 * s + 1]
        out[o + 2] = colours[3 * s + 2]
      }
    }
  }
  // the pixels of the plan's terminator band and of its ring: made at their own plan value (underpaintBandColours), or, without
  // those, the colour of the sample they are made from; the band takes all of it, the ring a share (the rest is the lattice's)
  for (let k = 0; k < f.bandPix.length; k++) {
    const o = 3 * f.bandPix[k]
    const src = bandColours ?? colours
    const at = bandColours ? 3 * k : 3 * f.bandDonor[k]
    const w = f.bandW[k]
    if (w >= 1 || Number.isNaN(out[o])) {
      out[o] = src[at]
      out[o + 1] = src[at + 1]
      out[o + 2] = src[at + 2]
    } else {
      out[o] += (src[at] - out[o]) * w
      out[o + 1] += (src[at + 1] - out[o + 1]) * w
      out[o + 2] += (src[at + 2] - out[o + 2]) * w
    }
  }
  return out
}

// The sample of mark m (and family fam, or either with fam < 0) nearest lattice position (fx, fy) (in cells, the centre of
// cell c at c), within 2 cells; -1 if none.
function nearestSample(f: UnderpaintField, fx: number, fy: number, m: number, fam: number): number {
  const cx0 = Math.round(fx)
  const cy0 = Math.round(fy)
  let best = -1
  let bd = Number.POSITIVE_INFINITY
  for (let cy = Math.max(0, cy0 - 2); cy <= Math.min(f.lh - 1, cy0 + 2); cy++) {
    for (let cx = Math.max(0, cx0 - 2); cx <= Math.min(f.lw - 1, cx0 + 2); cx++) {
      const s = sampleOf(f, cy * f.lw + cx, m, fam)
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
  return fillUnderpaint(f, underpaintColours(f, params, env), underpaintBandColours(f, params, env))
}
