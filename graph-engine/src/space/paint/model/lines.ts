// Data marks (spec §3.7.8, §7, M10): LineMarks (curves, traces, intersection
// curves), ArrowMarks, PointMarks and the edges of BoxMarks become 'line'
// strokes along their EXACT projected geometry. A data mark is always FOUND:
// crisp, placed exactly, never smeared and never perturbed.
//
// - A stroke's path points lie ON the projected polyline: a polyline is split at
//   sharp corners, where it passes behind a surface (at the transition itself),
//   at a dash gap, and every `roles.line.length` px, and each piece is sampled
//   at equal arc length. Nothing is jittered, ever.
// - Where an opaque surface hides a line, `hidden: 'none'` leaves it out and
//   `hidden: 'dashed'` draws the hidden stretch dashed and faint.
// - Colour: the mark's colour through the lighting curve at u = 0.6 (lScale 0.55,
//   so its own value is kept), then the brush-load mix × roleLine, as the
//   mockup's umber is. The mark's colour is the one buildParticles kept.
// - A point is a short loaded dab centred exactly on the point; an arrowhead
//   is two short strokes meeting exactly at the tip.
//
// Ported from the approved mockup (figures2.js markJob, arrowMark, dabMark).

import { randomFor } from '../../../style/random'
import type { Mark } from '../../scene/types'
import { PATH_POINTS } from '../types'
import { clamp, hash3 } from './math'
import { colourOfDraft, newRecipe, type ColourRecipe, type DraftColour } from './recipe'
import { veilOf, type Veil } from './roles'
import { BEHIND_VEIL_LAYER, polylinePath, roleIndex, type PaintCtx } from './strokes'
import { project, pxPerUnit } from './view'

// The default dash of a hidden stretch drawn dashed, CSS px: on, off. (Exported: the renderer's hidden pass, gl/depthTest.ts,
// dashes the hidden parts of a baked frame's data lines the same way.)
export const HIDDEN_DASH: readonly number[] = [5, 4]
// A corner sharper than this ends a stroke (the corner is its end, exactly).
const CORNER = (30 * Math.PI) / 180
// The head of an arrow opens ±26 degrees from the shaft.
const HEAD_ANGLE = 0.46

type W3 = [number, number, number]

// A polyline in the screen with its world points, depth and a hash cell.
interface PL {
  x: number[]
  y: number[]
  d: number[]
  w: W3[]
}

function arcs(pl: PL): number[] {
  const c = [0]
  for (let i = 1; i < pl.x.length; i++) c.push(c[i - 1] + Math.hypot(pl.x[i] - pl.x[i - 1], pl.y[i] - pl.y[i - 1]))
  return c
}

// The part of the polyline between arc lengths s0 and s1, its ends exactly on it.
function slice(pl: PL, cum: number[], s0: number, s1: number): PL {
  const out: PL = { x: [], y: [], d: [], w: [] }
  const at = (s: number): [number, number, number, W3] => {
    let i = 1
    while (i < pl.x.length - 1 && cum[i] < s) i++
    const span = cum[i] - cum[i - 1]
    const f = span > 0 ? clamp((s - cum[i - 1]) / span, 0, 1) : 0
    return [
      pl.x[i - 1] + (pl.x[i] - pl.x[i - 1]) * f,
      pl.y[i - 1] + (pl.y[i] - pl.y[i - 1]) * f,
      pl.d[i - 1] + (pl.d[i] - pl.d[i - 1]) * f,
      [pl.w[i - 1][0] + (pl.w[i][0] - pl.w[i - 1][0]) * f, pl.w[i - 1][1] + (pl.w[i][1] - pl.w[i - 1][1]) * f, pl.w[i - 1][2] + (pl.w[i][2] - pl.w[i - 1][2]) * f],
    ]
  }
  const push = (p: [number, number, number, W3]) => {
    out.x.push(p[0])
    out.y.push(p[1])
    out.d.push(p[2])
    out.w.push(p[3])
  }
  push(at(s0))
  for (let i = 1; i < pl.x.length - 1; i++) {
    if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) {
      out.x.push(pl.x[i])
      out.y.push(pl.y[i])
      out.d.push(pl.d[i])
      out.w.push(pl.w[i])
    }
  }
  push(at(s1))
  return out
}

// Cut a polyline at its sharp corners.
function splitCorners(pl: PL): PL[] {
  const n = pl.x.length
  if (n < 3) return [pl]
  const cum = arcs(pl)
  const cuts: number[] = []
  for (let i = 1; i < n - 1; i++) {
    const ax = pl.x[i] - pl.x[i - 1], ay = pl.y[i] - pl.y[i - 1]
    const bx = pl.x[i + 1] - pl.x[i], by = pl.y[i + 1] - pl.y[i]
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    if (la < 1e-9 || lb < 1e-9) continue
    const cos = clamp((ax * bx + ay * by) / (la * lb), -1, 1)
    if (Math.acos(cos) > CORNER) cuts.push(cum[i])
  }
  if (cuts.length === 0) return [pl]
  const out: PL[] = []
  let s = 0
  for (const c of [...cuts, cum[n - 1]]) {
    if (c - s > 1e-6) out.push(slice(pl, cum, s, c))
    s = c
  }
  return out
}

// A line stroke is at most this long on the screen (CSS px): its PATH_POINTS (8) points are then at most 3 px apart, and the
// ribbon, a Catmull-Rom curve through them, lies on the polyline. A longer stroke strays from a curved one between its points:
// 0.2 to 0.5 px on a small circle, for strokes of the role's own length (36 px), where a data mark must be exact.
export const LINE_MAX_PX = 21

// Split into equal pieces no longer than maxLen.
function splitLength(pl: PL, maxLen: number): PL[] {
  const cum = arcs(pl)
  const total = cum[cum.length - 1]
  if (total <= maxLen) return [pl]
  const k = Math.ceil(total / maxLen)
  const out: PL[] = []
  for (let i = 0; i < k; i++) out.push(slice(pl, cum, (total * i) / k, (total * (i + 1)) / k))
  return out
}

// Apply a dash pattern [on, off, ...] along the polyline (CSS px), restarting at its start.
function dashed(pl: PL, pattern: readonly number[]): PL[] {
  const cum = arcs(pl)
  const total = cum[cum.length - 1]
  const sum = pattern.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || pattern.length === 0) return [pl]
  const out: PL[] = []
  let s = 0
  let k = 0
  while (s < total - 1e-9) {
    const len = pattern[k % pattern.length]
    if (k % 2 === 0 && len > 0) out.push(slice(pl, cum, s, Math.min(total, s + len)))
    s += Math.max(len, 1e-6)
    k++
  }
  return out
}

// Is a flat veil between the eye and the world point p? The segment from the point toward the eye
// (along the view direction for an orthographic camera) crosses the sheet's plane, inside its edges.
export function behindVeil(fc: PaintCtx['fc'], veils: readonly Veil[], p: readonly number[]): boolean {
  const view = fc.view
  for (const v of veils) {
    if (!v.plane) continue
    const { n, d } = v.plane
    const sp = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d
    let x: number
    let y: number
    let z: number
    if (fc.ortho) {
      // toward the eye is -viewDir: p - viewDir s meets the plane at s = sp / (n . viewDir), in front of p when s > 0
      const nd = n[0] * view.viewDir[0] + n[1] * view.viewDir[1] + n[2] * view.viewDir[2]
      if (Math.abs(nd) < 1e-6) continue
      const s = sp / nd
      if (s <= 1e-9) continue
      x = p[0] - view.viewDir[0] * s
      y = p[1] - view.viewDir[1] * s
      z = p[2] - view.viewDir[2] * s
    } else {
      const se = n[0] * view.eye[0] + n[1] * view.eye[1] + n[2] * view.eye[2] - d
      if (sp * se >= 0) continue
      const s = sp / (sp - se)
      x = p[0] + (view.eye[0] - p[0]) * s
      y = p[1] + (view.eye[1] - p[1]) * s
      z = p[2] + (view.eye[2] - p[2]) * s
    }
    if (v.inside(x, y, z)) return true
  }
  return false
}

export function lineStrokes(an: PaintCtx): void {
  const { fc, side } = an
  const params = fc.params
  const g = fc.g
  const rp = params.roles.line
  const out = [0, 0, 0]

  // is the world point hidden behind an opaque surface? (not behind the eye)
  const state = (p: W3): 0 | 1 | 2 => {
    if (!project(fc, p[0], p[1], p[2], out)) return 2 // cut: behind the eye
    const gx = Math.floor(out[0] / g.scale)
    const gy = Math.floor(out[1] / g.scale)
    if (gx < 0 || gy < 0 || gx >= g.width || gy >= g.height) return 0
    const gd = g.depth[gy * g.width + gx]
    if (!Number.isFinite(gd)) return 0
    // marks sit on their surfaces: be generous with the depth of a pixel and its slope
    const bias = (6 * g.scale) / pxPerUnit(fc, p[0], p[1], p[2])
    return gd >= out[2] - bias ? 0 : 1
  }

  // a long segment is looked at every few px, so a surface that hides its middle is found
  const densify = (pts: W3[]): W3[] => {
    const out: W3[] = []
    const a = [0, 0, 0]
    const b = [0, 0, 0]
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && project(fc, pts[i - 1][0], pts[i - 1][1], pts[i - 1][2], a) && project(fc, pts[i][0], pts[i][1], pts[i][2], b)) {
        const k = clamp(Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3), 1, 400)
        for (let j = 1; j < k; j++) {
          const f = j / k
          const q = pts[i - 1]
          const r = pts[i]
          out.push([q[0] + (r[0] - q[0]) * f, q[1] + (r[1] - q[1]) * f, q[2] + (r[2] - q[2]) * f])
        }
      }
      out.push(pts[i])
    }
    return out
  }

  // a world polyline cut into visible and hidden runs, the cuts exactly on the segments
  const runsOf = (input: W3[]): { pts: W3[]; hidden: boolean }[] => {
    const pts = densify(input)
    const runs: { pts: W3[]; hidden: boolean }[] = []
    let cur: { pts: W3[]; hidden: boolean } | null = null
    let prev: W3 | null = null
    let prevState = 2 as 0 | 1 | 2
    for (const p of pts) {
      const st = state(p)
      if (st === 2) {
        cur = null
        prev = null
        prevState = 2
        continue
      }
      if (prev && prevState !== 2) {
        if (st !== prevState) {
          // bisect the transition on the segment
          let lo = 0
          let hi = 1
          for (let it = 0; it < 10; it++) {
            const mid = (lo + hi) / 2
            const q: W3 = [prev[0] + (p[0] - prev[0]) * mid, prev[1] + (p[1] - prev[1]) * mid, prev[2] + (p[2] - prev[2]) * mid]
            if (state(q) === prevState) lo = mid
            else hi = mid
          }
          const t = (lo + hi) / 2
          const tp: W3 = [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t, prev[2] + (p[2] - prev[2]) * t]
          if (cur) cur.pts.push(tp)
          cur = { pts: [tp, p], hidden: st === 1 }
          runs.push(cur)
        } else if (cur) cur.pts.push(p)
      } else {
        cur = { pts: [p], hidden: st === 1 }
        runs.push(cur)
      }
      prev = p
      prevState = st
    }
    return runs.filter((r) => r.pts.length >= 2)
  }

  const toPL = (pts: W3[]): PL | null => {
    const pl: PL = { x: [], y: [], d: [], w: [] }
    for (const p of pts) {
      if (!project(fc, p[0], p[1], p[2], out)) return null
      pl.x.push(out[0])
      pl.y.push(out[1])
      pl.d.push(out[2])
      pl.w.push(p)
    }
    return pl
  }

  // the mark's colour through the curve at u = 0.6, with a small seeded jitter per stroke
  const recipeOf = (mark: number, rng: ReturnType<typeof randomFor>): ColourRecipe => {
    const local = side.markColour[mark] ?? [0.4, 0.04, 0.035]
    const r = newRecipe()
    r.lx = local[0]
    r.ly = local[1]
    r.lz = local[2]
    r.u = 0.6
    r.lScale = 0.55
    r.g0 = rng.gauss()
    r.g1 = rng.gauss()
    r.g2 = rng.gauss()
    r.c0 = 0.4
    r.c1 = 1 / 3
    r.c2 = 0.36
    return r
  }

  // the flat translucent sheets of the scene (a curved veil's lines lie on it, not behind it)
  const veilSheets: Veil[] = []
  for (const m of fc.scene.marks) if (m.kind === 'mesh' && m.style.opacity < 1) veilSheets.push(veilOf(m))

  const emit = (mark: number, tag: string, pl: PL, widthPx: number, hiddenRun: boolean) => {
    if (pl.x.length < 2) return
    const cum = arcs(pl)
    if (cum[cum.length - 1] < 0.05) return
    const mid = Math.floor(pl.x.length / 2)
    const w = pl.w[mid]
    const cell = hash3(Math.round(w[0] * 7), Math.round(w[1] * 7), Math.round(w[2] * 7))
    const seed = hash3(mark, cell, tag.length * 31 + tag.charCodeAt(0)) >>> 0
    const rng = randomFor(`paint/line/${mark}/${tag}/${cell}`, params.seed)
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const world = new Float32Array(3 * PATH_POINTS)
    polylinePath(pl.x, pl.y, pl.x.length, widthPx, false, false, path, width, world, pl.w)
    const colour: DraftColour = { a: recipeOf(mark, rng), b: null, t: 0 }
    // seen through a flat veil: painted before the glaze, so the veil tints it
    const behind = veilSheets.length > 0 && behindVeil(fc, veilSheets, w)
    an.drafts.push({
      ...(behind ? { layer: BEHIND_VEIL_LAYER } : {}),
      role: roleIndex('line'),
      path,
      width,
      world,
      depth: pl.d[mid],
      lab: colourOfDraft(colour, an.env),
      colour,
      u: 0.6,
      cell,
      mx: pl.x[mid],
      my: pl.y[mid],
      colormapped: false,
      alpha: hiddenRun ? 0.5 : 1,
      load: rp.load,
      impasto: rp.impasto,
      bristles: rp.bristles,
      bristleVar: rp.bristleVar,
      dry: rp.dry,
      wet: rp.wet,
      endSoft: 0,
      edge: 255,
      seed,
      jit0: rng.gauss(),
      jit1: rng.gauss(),
      order: an.nextOrder++,
    })
  }

  // a stretch of a mark: dashes, corners, length, then strokes
  const strokeRun = (mark: number, tag: string, pl: PL, widthPx: number, hiddenRun: boolean, dash: readonly number[] | null, hiddenStyle: 'dashed' | 'none') => {
    let parts: PL[]
    if (hiddenRun) {
      if (hiddenStyle === 'none') return
      parts = dashed(pl, dash && dash.length ? dash : HIDDEN_DASH)
    } else parts = dash && dash.length ? dashed(pl, dash) : [pl]
    for (const part of parts) {
      for (const c of splitCorners(part)) {
        for (const piece of splitLength(c, Math.min(Math.max(8, rp.length), LINE_MAX_PX))) emit(mark, tag, piece, widthPx, hiddenRun)
      }
    }
  }

  const widthFor = (style: number) => rp.width * clamp(style / 2, 0.5, 3)

  fc.scene.marks.forEach((mark: Mark, m: number) => {
    if (mark.kind === 'lines') {
      const starts = mark.starts
      for (let s = 0; s < starts.length; s++) {
        const a = starts[s]
        const b = s + 1 < starts.length ? starts[s + 1] : mark.positions.length / 3
        const pts: W3[] = []
        for (let i = a; i < b; i++) pts.push([mark.positions[3 * i], mark.positions[3 * i + 1], mark.positions[3 * i + 2]])
        runsOf(pts).forEach((run, r) => {
          const pl = toPL(run.pts)
          if (pl) strokeRun(m, `l${s}.${r}`, pl, widthFor(mark.style.width), run.hidden, mark.style.dash, mark.style.hidden)
        })
      }
    } else if (mark.kind === 'arrows') {
      for (let i = 0; i < mark.tails.length / 3; i++) {
        const tail: W3 = [mark.tails[3 * i], mark.tails[3 * i + 1], mark.tails[3 * i + 2]]
        const tip: W3 = [tail[0] + mark.vectors[3 * i], tail[1] + mark.vectors[3 * i + 1], tail[2] + mark.vectors[3 * i + 2]]
        const width = widthFor(mark.style.shaftWidth)
        runsOf([tail, tip]).forEach((run, r) => {
          const pl = toPL(run.pts)
          if (pl) strokeRun(m, `a${i}.${r}`, pl, width, run.hidden, null, mark.style.hidden)
        })
        // the head: two short strokes that meet exactly at the tip
        const tipState = state(tip)
        if (tipState === 2 || (tipState === 1 && mark.style.hidden === 'none')) continue
        const full = toPL([tail, tip])
        if (!full) continue
        const dx = full.x[1] - full.x[0], dy = full.y[1] - full.y[0]
        const l = Math.hypot(dx, dy)
        if (l < 1e-6) continue
        const ux = dx / l, uy = dy / l
        const head = Math.max(6, mark.style.headSize)
        for (const sgn of [-1, 1]) {
          const ang = sgn * HEAD_ANGLE
          const c = Math.cos(ang), s = Math.sin(ang)
          const hx = -(ux * c - uy * s) * head
          const hy = -(ux * s + uy * c) * head
          const pl: PL = {
            x: [full.x[1] + hx, full.x[1]],
            y: [full.y[1] + hy, full.y[1]],
            d: [full.d[1], full.d[1]],
            w: [tip, tip],
          }
          emit(m, `h${i}.${sgn}`, pl, width, tipState === 1)
        }
      }
    } else if (mark.kind === 'points') {
      for (let i = 0; i < mark.positions.length / 3; i++) {
        const p: W3 = [mark.positions[3 * i], mark.positions[3 * i + 1], mark.positions[3 * i + 2]]
        const st = state(p)
        if (st !== 0) continue
        project(fc, p[0], p[1], p[2], out)
        const size = Math.max(3, mark.style.size)
        const len = size * 0.5
        const pl: PL = { x: [out[0] - len / 2, out[0] + len / 2], y: [out[1], out[1]], d: [out[2], out[2]], w: [p, p] }
        emit(m, `p${i}`, pl, size, false)
      }
    } else if (mark.kind === 'boxes' && mark.style.edges) {
      for (let i = 0; i < mark.mins.length / 3; i++) {
        const lo = [mark.mins[3 * i], mark.mins[3 * i + 1], mark.mins[3 * i + 2]]
        const hi = [mark.maxs[3 * i], mark.maxs[3 * i + 1], mark.maxs[3 * i + 2]]
        const corner = (c: number): W3 => [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]
        for (let a = 0; a < 8; a++) {
          for (const bit of [1, 2, 4]) {
            if (a & bit) continue
            const b = a | bit
            runsOf([corner(a), corner(b)]).forEach((run, r) => {
              const pl = toPL(run.pts)
              if (pl) strokeRun(m, `b${i}.${a}.${bit}.${r}`, pl, widthFor(2), run.hidden, null, 'none')
            })
          }
        }
      }
    }
  })
}
