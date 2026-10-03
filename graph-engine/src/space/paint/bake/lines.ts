// The baked data marks' strokes (the baked painting, spec §3.7.8, §7, §14; plan Task 3b): LineMarks (curves, traces, intersection curves), the SHAFTS
// of ArrowMarks and the edges of BoxMarks as 'line' strokes along their EXACT world geometry, made once. Points and arrowheads are not baked strokes:
// they are shapes a frame builds on screen (Task 4), in the mark's `dataColour` (below).
//
// The per-frame model (model/lines.ts lineStrokes) cuts a mark's polyline where it is hidden behind a surface, at a dash gap, at a sharp corner and
// every `roles.line.length` px, and lays a stroke on each piece. The bake has no view, so it has no hidden test: every part of the polyline is baked, and
// `hidden` says what the renderer does where a surface stands in front (HIDDEN_NONE: nothing; HIDDEN_DASHED: draws it dashed, HIDDEN_DASH, at half the
// stroke's alpha: the stroke's alpha here is its VISIBLE one, never pre-halved). The pieces are cut in WORLD units: the style's dash pattern in px × the
// reference world per px (it restarts at the polyline's start), corners where the polyline turns by more than 30 degrees in the world, and pieces at most
// min(max(8, roles.line.length), LINE_MAX_PX) px long, so that the 16 points of a piece lie on it within a fraction of a px. Every path point is ON the
// polyline, at equal world arc length; nothing is jittered, ever. A stroke's tag is `l${polyline}.${piece}` (an arrow's shaft `a${arrow}.${piece}`, a
// box's edge `b${box}.${corner}.${bit}.${piece}`), the piece counted along the whole polyline: the seed and the load cell follow from it and the
// piece's middle vertex, as the model's.
//
// THE COLOURS. The mark's colour through the curve at u = 0.6 (lScale 0.55, so its own value is kept), a small seeded jitter per stroke, then the
// SEQUENTIAL brush-load mix × roleLine (draft.ts: in the order the strokes are made here, polylines in the order of the scene, a load breaking where the
// next stroke's middle is over `mix.loadBreakPx` away in the world). `dataColour` is the same recipe without the jitter and without the mix, in linear
// sRGB, for each data mark (every mark that is not a mesh: a point's dab and an arrowhead's barbs are drawn in it by the frame).
//
// WHAT STAYS FOR THE FRAME. A line seen through a flat veil is painted before the glaze, so the veil tints it (model BEHIND_VEIL_LAYER): that depends
// on the eye, so the baked stroke is in the line layer and the frame moves it (model/lines.ts behindVeil at the stroke's middle).

import { randomFor } from '../../../style/random'
import type { SpaceScene } from '../../scene/types'
import { oklabToLinear } from '../model/colour'
import { LINE_MAX_PX } from '../model/lines'
import { clamp, hash3 } from '../model/math'
import { colourOfRecipe, newRecipe, type ColourRecipe, type DraftColour, type RecipeEnv } from '../model/recipe'
import type { PaintParams } from '../params'
import type { Oklab, SceneColours } from '../types'
import { fnvInts, layerOfRole, LoadChain, NO_PARTICLE, pathMid, StrokeSink } from './draft'
import { ROLE_INDEX } from './strokes'
import { BAKE_PATH_POINTS, HIDDEN_DASHED, HIDDEN_NONE, SIZING_FIXED } from './types'

const P3 = 3 * BAKE_PATH_POINTS
// A corner sharper than this ends a stroke (the corner is its end, exactly): the world turn between two segments of a polyline.
const CORNER = (30 * Math.PI) / 180
// The line recipe's u and lightness scale: the mark's colour through the curve at u = 0.6, its own value kept.
export const LINE_U = 0.6

// ---- the colour ----

// The recipe of a line stroke (model/lines.ts recipeOf): the mark's colour through the curve at u = 0.6. `rng` gives the small seeded jitter of a stroke;
// without it the jitter is zero (the mark's own colour: `dataColour`).
export function lineRecipe(local: Oklab, rng?: ReturnType<typeof randomFor>): ColourRecipe {
  const r = newRecipe()
  r.lx = local[0]
  r.ly = local[1]
  r.lz = local[2]
  r.u = LINE_U
  r.lScale = 0.55
  if (rng) {
    r.g0 = rng.gauss()
    r.g1 = rng.gauss()
    r.g2 = rng.gauss()
  }
  r.c0 = 0.4
  r.c1 = 1 / 3
  r.c2 = 0.36
  return r
}

// A data mark's colour, linear sRGB: the line recipe of its local colour before the mix, without the jitter.
export function dataColourOf(local: Oklab, env: RecipeEnv): [number, number, number] {
  return oklabToLinear(colourOfRecipe(lineRecipe(local), env)) as [number, number, number]
}

// The local colour of each data mark (OKLab; null for a mesh), kept beside the painting for the recolour.
export function dataLocals(scene: SpaceScene, colours: SceneColours): (Oklab | null)[] {
  return scene.marks.map((m, i) => {
    if (m.kind === 'mesh') return null
    const c = colours.markColour(i)
    return [c[0], c[1], c[2]] as Oklab
  })
}

// The 3 linear-sRGB numbers of each mark's `dataColour` (0 for a mesh).
export function dataColours(locals: (Oklab | null)[], env: RecipeEnv): Float32Array {
  const out = new Float32Array(3 * locals.length)
  locals.forEach((l, i) => {
    if (!l) return
    const c = dataColourOf(l, env)
    out[3 * i] = c[0]
    out[3 * i + 1] = c[1]
    out[3 * i + 2] = c[2]
  })
  return out
}

// ---- world polylines (flat xyz) ----

const arcs = (p: ArrayLike<number>): number[] => {
  const n = p.length / 3
  const c = [0]
  for (let i = 1; i < n; i++) c.push(c[i - 1] + Math.hypot(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]))
  return c
}

// The smallest vertex index i >= 1 with cum[i] >= s (the last vertex where none): the segment (i - 1, i) holds arc length s.
function indexAt(cum: number[], s: number): number {
  let lo = 1
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < s) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The point at arc length s of the polyline (its vertices' cumulative arc lengths cum), appended to `out`.
function pointAt(p: ArrayLike<number>, cum: number[], s: number, out: number[]): void {
  const i = indexAt(cum, s)
  const span = cum[i] - cum[i - 1]
  const f = span > 0 ? clamp((s - cum[i - 1]) / span, 0, 1) : 0
  for (let k = 0; k < 3; k++) out.push(p[3 * (i - 1) + k] + (p[3 * i + k] - p[3 * (i - 1) + k]) * f)
}

// The part of the polyline between arc lengths s0 and s1, its ends exactly on it.
function slice(p: ArrayLike<number>, cum: number[], s0: number, s1: number): number[] {
  const n = p.length / 3
  const out: number[] = []
  pointAt(p, cum, s0, out)
  const tol = 1e-12 * (1 + s1)
  for (let i = indexAt(cum, s0); i < n - 1 && cum[i] < s1 - tol; i++) {
    if (cum[i] > s0 + tol) out.push(p[3 * i], p[3 * i + 1], p[3 * i + 2])
  }
  pointAt(p, cum, s1, out)
  return out
}

// Cut a polyline at its sharp corners: a turn of more than CORNER between two segments, in the world.
export function splitCorners(p: number[], eps: number): number[][] {
  const n = p.length / 3
  if (n < 3) return [p]
  const cum = arcs(p)
  const cuts: number[] = []
  for (let i = 1; i < n - 1; i++) {
    const ax = p[3 * i] - p[3 * i - 3], ay = p[3 * i + 1] - p[3 * i - 2], az = p[3 * i + 2] - p[3 * i - 1]
    const bx = p[3 * i + 3] - p[3 * i], by = p[3 * i + 4] - p[3 * i + 1], bz = p[3 * i + 5] - p[3 * i + 2]
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz)
    if (la < eps || lb < eps) continue
    const cos = clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1)
    if (Math.acos(cos) > CORNER) cuts.push(cum[i])
  }
  if (cuts.length === 0) return [p]
  const out: number[][] = []
  let s = 0
  for (const c of [...cuts, cum[n - 1]]) {
    if (c - s > 1e-6 * eps) out.push(slice(p, cum, s, c))
    s = c
  }
  return out
}

// Split into equal pieces no longer than maxLen.
export function splitLength(p: number[], maxLen: number): number[][] {
  const cum = arcs(p)
  const total = cum[cum.length - 1]
  if (total <= maxLen) return [p]
  const k = Math.ceil(total / maxLen)
  const out: number[][] = []
  for (let i = 0; i < k; i++) out.push(slice(p, cum, (total * i) / k, (total * (i + 1)) / k))
  return out
}

// Apply a dash pattern [on, off, ...] (world units) along the polyline, restarting at its start.
export function dashed(p: number[], pattern: readonly number[]): number[][] {
  const cum = arcs(p)
  const total = cum[cum.length - 1]
  const sum = pattern.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || pattern.length === 0) return [p]
  const out: number[][] = []
  let s = 0
  let k = 0
  // (the guard against a pattern of zeros and a polyline so long that the dashes are a million)
  const floor = Math.max(1e-9, total * 1e-7)
  while (s < total - 1e-12 * (1 + total) && k < 4_000_000) {
    const len = pattern[k % pattern.length]
    if (k % 2 === 0 && len > 0) out.push(slice(p, cum, s, Math.min(total, s + len)))
    s += Math.max(len, floor)
    k++
  }
  return out
}

// A polyline cut at the vertices that are not finite (a curve that left its domain), each run of two points or more kept.
export function finiteRuns(p: ArrayLike<number>): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  const n = p.length / 3
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2]
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) cur.push(x, y, z)
    else {
      if (cur.length >= 6) out.push(cur)
      cur = []
    }
  }
  if (cur.length >= 6) out.push(cur)
  return out
}

export interface DataStrokeStats {
  // Strokes made, in all and by the kind of mark.
  strokes: number
  lines: number
  arrows: number
  boxes: number
  // Strokes the renderer draws dashed where hidden.
  hiddenDashed: number
  // The strokes of each mark.
  perMark: number[]
}

// ---- all of the data strokes ----

export function buildDataStrokes(scene: SpaceScene, locals: (Oklab | null)[], params: PaintParams, perPx: number, sink: StrokeSink): DataStrokeStats {
  const rp = params.roles.line
  const roleIdx = ROLE_INDEX.line
  const layer = layerOfRole('line')
  const stats: DataStrokeStats = { strokes: 0, lines: 0, arrows: 0, boxes: 0, hiddenDashed: 0, perMark: scene.marks.map(() => 0) }
  const chain = new LoadChain(perPx)
  const mid3 = [0, 0, 0]
  const maxLen = Math.min(Math.max(8, rp.length), LINE_MAX_PX) * perPx
  const eps = 1e-9 * perPx
  const widthFor = (style: number): number => rp.width * clamp(style / 2, 0.5, 3)

  // a stroke on the piece `p` (flat xyz) of a mark's polyline `poly` (its key), the `piece`-th along it
  const emit = (m: number, tag: string, poly: number, piece: number, p: number[], widthPx: number, hidden: number, kind: 'lines' | 'arrows' | 'boxes'): void => {
    const cum = arcs(p)
    const total = cum[cum.length - 1]
    if (total < 0.05 * perPx) return
    const mid = Math.floor(p.length / 3 / 2)
    const cell = hash3(Math.round(p[3 * mid] * 7), Math.round(p[3 * mid + 1] * 7), Math.round(p[3 * mid + 2] * 7))
    // (the model's seed read only the tag's length and first character: pieces ending at one corner of a box shared it; this reads all of it)
    const seed = hash3(m, cell, fnvInts(...Array.from(tag, (ch) => ch.charCodeAt(0)))) >>> 0
    const rng = randomFor(`paint/line/${m}/${tag}/${cell}`, params.seed)
    const idx = sink.alloc()
    // the path: BAKE_PATH_POINTS points at equal world arc length, every one exactly on the polyline; no surface normal (zeros)
    const off = P3 * idx
    const at: number[] = []
    for (let q = 0; q < BAKE_PATH_POINTS; q++) {
      at.length = 0
      pointAt(p, cum, (q / (BAKE_PATH_POINTS - 1)) * total, at)
      for (let k = 0; k < 3; k++) {
        sink.worldPath[off + 3 * q + k] = at[k]
        sink.worldNormal[off + 3 * q + k] = 0
      }
    }
    let length = 0
    for (let q = 1; q < BAKE_PATH_POINTS; q++) {
      length += Math.hypot(
        sink.worldPath[off + 3 * q] - sink.worldPath[off + 3 * q - 3], sink.worldPath[off + 3 * q + 1] - sink.worldPath[off + 3 * q - 2],
        sink.worldPath[off + 3 * q + 2] - sink.worldPath[off + 3 * q - 1],
      )
    }
    const local = locals[m] ?? [0.4, 0.04, 0.035]
    const colour: DraftColour = { a: lineRecipe(local, rng), b: null, t: 0 }
    const jit0 = rng.gauss()
    const jit1 = rng.gauss()
    pathMid(sink, idx, mid3)
    const dist = chain.next(mid3[0], mid3[1], mid3[2])
    sink.set(idx, {
      role: roleIdx, layer, mark: m, particle: NO_PARTICLE, rank: 0, side: 0, sizing: SIZING_FIXED, hidden, handStart: 0, pathLength: length, anchor: 0.5,
      basePx0: length / perPx, basePx1: widthPx, alpha: 1, load: rp.load, impasto: rp.impasto, bristles: rp.bristles, bristleVar: rp.bristleVar, dry: rp.dry,
      wet: rp.wet, endSoft: 0, edge: 255, seed, key: fnvInts(m, poly, roleIdx, 0, piece),
    })
    sink.setRecipe(idx, { draft: colour, mixRole: roleIdx, u: LINE_U, colormapped: false, seed, jit0, jit1, cells: null, cell, mx: dist })
    stats.strokes++
    stats[kind]++
    stats.perMark[m]++
    if (hidden === HIDDEN_DASHED) stats.hiddenDashed++
  }

  // a polyline of a mark: dashes, corners, length, then strokes (`count.piece` counts the pieces along the whole polyline, whatever runs it is cut into)
  const strokeRun = (m: number, tagBase: string, poly: number, p: number[], widthPx: number, dash: readonly number[] | null, hidden: number, kind: 'lines' | 'arrows' | 'boxes', count: { piece: number }): void => {
    const parts = dash && dash.length ? dashed(p, dash.map((d) => d * perPx)) : [p]
    for (const part of parts) {
      for (const c of splitCorners(part, eps)) {
        for (const seg of splitLength(c, maxLen)) {
          emit(m, `${tagBase}.${count.piece}`, poly, count.piece, seg, widthPx, hidden, kind)
          count.piece++
        }
      }
    }
  }

  scene.marks.forEach((mark, m) => {
    if (mark.kind === 'lines') {
      const hidden = mark.style.hidden === 'dashed' ? HIDDEN_DASHED : HIDDEN_NONE
      const starts = mark.starts
      for (let s = 0; s < starts.length; s++) {
        const a = starts[s]
        const b = s + 1 < starts.length ? starts[s + 1] : mark.positions.length / 3
        // (a polyline cut where it is not finite is several runs: they share the polyline's tag and its count of pieces)
        const count = { piece: 0 }
        for (const run of finiteRuns(mark.positions.subarray(3 * a, 3 * b))) strokeRun(m, `l${s}`, s, run, widthFor(mark.style.width), mark.style.dash, hidden, 'lines', count)
      }
    } else if (mark.kind === 'arrows') {
      const hidden = mark.style.hidden === 'dashed' ? HIDDEN_DASHED : HIDDEN_NONE
      for (let i = 0; i < mark.tails.length / 3; i++) {
        const shaft = [mark.tails[3 * i], mark.tails[3 * i + 1], mark.tails[3 * i + 2], mark.tails[3 * i] + mark.vectors[3 * i], mark.tails[3 * i + 1] + mark.vectors[3 * i + 1], mark.tails[3 * i + 2] + mark.vectors[3 * i + 2]]
        const count = { piece: 0 }
        for (const run of finiteRuns(shaft)) strokeRun(m, `a${i}`, i, run, widthFor(mark.style.shaftWidth), null, hidden, 'arrows', count)
      }
    } else if (mark.kind === 'boxes' && mark.style.edges) {
      for (let i = 0; i < mark.mins.length / 3; i++) {
        const lo = [mark.mins[3 * i], mark.mins[3 * i + 1], mark.mins[3 * i + 2]]
        const hi = [mark.maxs[3 * i], mark.maxs[3 * i + 1], mark.maxs[3 * i + 2]]
        const corner = (c: number): number[] => [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]
        for (let a = 0; a < 8; a++) {
          for (const bit of [1, 2, 4]) {
            if (a & bit) continue
            const e = [...corner(a), ...corner(a | bit)]
            const count = { piece: 0 }
            for (const run of finiteRuns(e)) strokeRun(m, `b${i}.${a}.${bit}`, i * 64 + a * 4 + (bit >> 1), run, widthFor(2), null, HIDDEN_NONE, 'boxes', count)
          }
        }
      }
    }
  })
  return stats
}
