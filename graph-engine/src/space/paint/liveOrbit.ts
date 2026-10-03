// What the Paint Lab keeps painting with while the camera drags (spec §3.2 and the orbit of §2.6): the rules that
// are plain arithmetic, apart from the engine that drives them (review/src/paintLabEngine.ts) and the renderer.
//
// While the pointer drags, every animation frame re-projects the strokes of the newest model frame (reproject.ts, a
// couple of milliseconds), and the model keeps running in its worker behind it, one request at a time and always
// for the newest view. When a result comes back it becomes the base the next frames re-project from: its strokes
// were made for the view the camera had a few hundred milliseconds ago, and are moved to where it is now. Three
// rules keep that from showing:
//
//   adopt      a result is adopted only when it is for a newer request than the base it would replace
//              (shouldAdopt): a late answer for an older drag position is dropped, never shown.
//   crossfade  the picture does not pop to the new base. The strokes of the old base and the new one are matched by
//              what they are painted from (the particle's seed and the role, matchStrokes), so the strokes both
//              frames have, which is most of the picture (the spatial mix gives a stroke the same seed and mix in
//              every view), are one and the same stroke: its path, width, colour and the rest are eased from the old
//              frame's to the new one's, a little each, while the strokes that appeared fade in and the ones that
//              went fade out, over CROSSFADE_MS (crossfadeWeight; at once under reduced motion, blendStrokes).
//              (Measured on a sphere turned 6 degrees: the median stroke is 0.2 px from where the new frame has it,
//              but a stroke's width and colour move more than that in the model between two views, with the light
//              fixed in the world too (the plane steps, the G-buffer's pixels), so every pair is eased and not
//              only the ones past a threshold.) A pair is only eased when its two strokes lie on the same bit of
//              the picture (refineMatch): the model walks a particle's stroke along the surface in either direction,
//              so a pair can run the other way (it is eased against its reversed points, or the two would collapse
//              to a point at mid-fade), and a pair that lies further apart than the stroke is wide is not one
//              stroke but two (the old one fades out where it was, the new one fades in where it is).
//   age        an edge stroke (a silhouette, a crease, a plane boundary) is where the form's outline was in the
//              view it was made for, and turning the camera moves the outline but not the stroke: it fades out
//              as the base ages, over EDGE_FADE_MS, so a stale outline never hangs inside the form (edgeFade, applied
//              by reprojectStrokes).
//
// Nothing here reads a clock: the caller says how much time has passed.

import { PATH_POINTS, ROLES, type StrokeBatch } from './types'

// How long a new base takes to take over from the old one, and how long an edge stroke lasts once the camera has
// left the view it was made for.
export const CROSSFADE_MS = 120
export const EDGE_FADE_MS = 200

// How much of the new base is shown `elapsedMs` after it was adopted: 0 at once, 1 after CROSSFADE_MS, a straight ramp
// between; and 1 always when the user asked for no motion.
export function crossfadeWeight(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1
  const t = elapsedMs / CROSSFADE_MS
  return t >= 1 ? 1 : t > 0 ? t : 0
}

// The share of an edge stroke's opacity left when its base is `ageMs` old, counted from when the camera left the
// base's view: all of it at 0 and none from EDGE_FADE_MS on, a straight ramp between.
export function edgeFade(ageMs: number): number {
  const t = ageMs / EDGE_FADE_MS
  return t >= 1 ? 0 : t > 0 ? 1 - t : 1
}

// May a result of request `resultSeq` replace the base made by request `baseSeq` (null: no base)? Only a newer one: an
// answer that comes late, for an older drag position than the base on screen, is never adopted.
export function shouldAdopt(baseSeq: number | null, resultSeq: number): boolean {
  return baseSeq === null || resultSeq > baseSeq
}

// ---- matching two bases ----

export const EDGE_ROLE = ROLES.indexOf('edge')

export interface StrokeMatch {
  // For stroke j of the new batch, the stroke of the old one it continues (the same particle, the same role), or -1:
  // it appeared. An edge stroke is never matched: it is the outline of the view it was made for, and a new view's
  // is another stroke, not the old one moved.
  pair: Int32Array
  // The old strokes no new stroke continues: they went (the particle turned away, or took another role).
  gone: Int32Array
  // Set by refineMatch, once both bases are in one view: per new stroke, 1 when its old stroke runs the other way
  // (they are eased point to opposite point), and 1 when both have a world path to ease (else the new stroke's is kept).
  reversed: Uint8Array
  world: Uint8Array
  refined: boolean
}

// What a stroke is painted from: its role and its particle's seed (a number below 2^35, so exact as a key).
const keyOf = (batch: StrokeBatch, i: number): number => batch.role[i] * 4294967296 + batch.seed[i]

// Which strokes of `neu` are strokes of `old`. A particle can have more than one stroke of a role (a veil's passes); the
// k-th of them in one batch is matched with the k-th in the other.
export function matchStrokes(old: StrokeBatch, neu: StrokeBatch): StrokeMatch {
  const next = new Int32Array(old.count).fill(-1)
  const head = new Map<number, number>()
  // the chain of old strokes of each key, in batch order
  for (let i = old.count - 1; i >= 0; i--) {
    if (old.role[i] === EDGE_ROLE) continue
    const key = keyOf(old, i)
    next[i] = head.get(key) ?? -1
    head.set(key, i)
  }
  const pair = new Int32Array(neu.count).fill(-1)
  const used = new Uint8Array(old.count)
  for (let j = 0; j < neu.count; j++) {
    if (neu.role[j] === EDGE_ROLE) continue
    const key = keyOf(neu, j)
    const i = head.get(key)
    if (i === undefined || i < 0) continue
    pair[j] = i
    used[i] = 1
    head.set(key, next[i])
  }
  let n = 0
  for (let i = 0; i < old.count; i++) if (!used[i]) n++
  const gone = new Int32Array(n)
  n = 0
  for (let i = 0; i < old.count; i++) if (!used[i]) gone[n++] = i
  return { pair, gone, reversed: new Uint8Array(0), world: new Uint8Array(0), refined: false }
}

// A pair is one stroke only when its two strokes lie on the same bit of the picture: no further apart (their mean distance,
// point to point) than the larger of PAIR_MIN_PX and PAIR_WIDTH_SHARE of the stroke's width, and the stroke half way between
// them (every point the mean of the two) is not squeezed: at least PAIR_KEEP_LENGTH of the shorter one's length (a short
// stroke that bends one way in one frame and the other way in the next would be eased to a straight one).
export const PAIR_MIN_PX = 3
export const PAIR_WIDTH_SHARE = 0.5
export const PAIR_KEEP_LENGTH = 0.8
// (strokes shorter than this are not asked to keep their length)
const SHORT_PX = 2

const hasWorld = (b: StrokeBatch, i: number): boolean => {
  const n = 3 * PATH_POINTS
  for (let k = 0; k < n; k++) if (b.worldPath[n * i + k] !== 0) return true
  return false
}

// Is the stroke half way between old stroke i and new stroke j (its points in the new one's order, or the old one's reversed)
// shorter than PAIR_KEEP_LENGTH of the shorter of the two?
function squeezed(old: StrokeBatch, i: number, neu: StrokeBatch, j: number, turned: boolean): boolean {
  const P = PATH_POINTS
  let lengthOld = 0
  let lengthNew = 0
  let lengthMid = 0
  let px = 0
  let py = 0
  let qx = 0
  let qy = 0
  let mx = 0
  let my = 0
  for (let k = 0; k < P; k++) {
    const ox = old.path[2 * P * i + 2 * (turned ? P - 1 - k : k)]
    const oy = old.path[2 * P * i + 2 * (turned ? P - 1 - k : k) + 1]
    const nx = neu.path[2 * P * j + 2 * k]
    const ny = neu.path[2 * P * j + 2 * k + 1]
    const hx = (ox + nx) / 2
    const hy = (oy + ny) / 2
    if (k > 0) {
      lengthOld += Math.hypot(ox - px, oy - py)
      lengthNew += Math.hypot(nx - qx, ny - qy)
      lengthMid += Math.hypot(hx - mx, hy - my)
    }
    px = ox
    py = oy
    qx = nx
    qy = ny
    mx = hx
    my = hy
  }
  const shortest = Math.min(lengthOld, lengthNew)
  return shortest >= SHORT_PX && lengthMid < PAIR_KEEP_LENGTH * shortest
}

// Looks at the pairs of `match` with both bases in the same view (re-projected into the view on screen), and:
//   - notes a pair whose old stroke runs the other way (the reversed points are the nearer: the model walks a particle's
//     stroke in either direction, and which one it takes can differ from view to view);
//   - unpairs one that lies further apart than max(PAIR_MIN_PX, PAIR_WIDTH_SHARE of its width), or whose half-way stroke is
//     shorter than PAIR_KEEP_LENGTH of the shorter end: the old stroke goes (fades out where it was) and the new one appears
//     (fades in where it is);
//   - notes which pairs have a world path on both sides.
// `match` is changed in place (pair, gone, reversed, world); the batches are not.
export function refineMatch(match: StrokeMatch, old: StrokeBatch, neu: StrokeBatch): void {
  const P = PATH_POINTS
  const n = neu.count
  const reversed = new Uint8Array(n)
  const world = new Uint8Array(n)
  const used = new Uint8Array(old.count)
  for (let j = 0; j < n; j++) {
    const i = match.pair[j]
    if (i < 0) continue
    let direct = 0
    let flipped = 0
    let width = 0
    for (let k = 0; k < P; k++) {
      const ox = old.path[2 * P * i + 2 * k]
      const oy = old.path[2 * P * i + 2 * k + 1]
      direct += Math.hypot(ox - neu.path[2 * P * j + 2 * k], oy - neu.path[2 * P * j + 2 * k + 1])
      flipped += Math.hypot(ox - neu.path[2 * P * j + 2 * (P - 1 - k)], oy - neu.path[2 * P * j + 2 * (P - 1 - k) + 1])
      width += neu.width[P * j + k]
    }
    const turned = flipped < direct
    const distance = (turned ? flipped : direct) / P
    if (distance > Math.max(PAIR_MIN_PX, (PAIR_WIDTH_SHARE * width) / P) || squeezed(old, i, neu, j, turned)) {
      match.pair[j] = -1
      continue
    }
    used[i] = 1
    reversed[j] = turned ? 1 : 0
    world[j] = hasWorld(old, i) && hasWorld(neu, j) ? 1 : 0
  }
  let count = 0
  for (let i = 0; i < old.count; i++) if (!used[i]) count++
  const gone = new Int32Array(count)
  count = 0
  for (let i = 0; i < old.count; i++) if (!used[i]) gone[count++] = i
  match.gone = gone
  match.reversed = reversed
  match.world = world
  match.refined = true
}

// ---- the crossfade ----

// A per-stroke array: `per` numbers for each of `points` points of the stroke (a path's (x, y) pairs, a width's one
// number; points 1 for what a stroke has once).
interface Field {
  name: keyof StrokeBatch
  per: number
  points: number
}
const field = (name: keyof StrokeBatch, per: number, points = 1): Field => ({ name, per, points })

// The arrays eased between the two bases' version of a stroke.
const EASED: readonly Field[] = [
  field('path', 2, PATH_POINTS),
  field('width', 1, PATH_POINTS),
  field('depth', 1),
  field('colour', 3),
  field('alpha', 1),
  field('load', 1),
  field('impasto', 1),
  field('bristles', 1),
  field('bristleVar', 1),
  field('dry', 1),
  field('wet', 1),
  field('endSoft', 1),
]
// The world path is eased too, where both strokes have one, so the depth test of the renderer reads the points of the
// stroke that is drawn (the path eases on the screen, and the world path with it).
const WORLD_PATH = field('worldPath', 3, PATH_POINTS)
const ALL: readonly Field[] = [...EASED, field('role', 1), field('layer', 1), field('edge', 1), field('seed', 1), WORLD_PATH, field('worldNormal', 3)]

type Column = Float32Array | Uint8Array | Uint32Array
const column = (b: StrokeBatch, name: keyof StrokeBatch): Column => b[name] as Column

// The strokes to draw `weight` of the way (0..1) from the old base's to the new one's, both already re-projected into the
// view on screen:
//   a stroke the old base and the new one share   eased: every number of it (path, width, colour, opacity, the world
//                                                 path ...) `weight` of the way from the old frame's to the new one's, a
//                                                 path that runs the other way against its reversed points
//   a stroke only the new base has                its opacity times `weight`: it fades in
//   a stroke only the old base has                its opacity times 1 - `weight`: it fades out
// At weight 1 that is the new base's strokes and nothing else. (`match` is made by matchStrokes for these two batches
// and refined by refineMatch.) The arrays are new; nothing the batches hold is changed.
export function blendStrokes(old: StrokeBatch, neu: StrokeBatch, match: StrokeMatch, weight: number): StrokeBatch {
  const w = Math.min(1, Math.max(0, weight))
  const n = neu.count
  const gone = w < 1 ? match.gone : NO_STROKES
  const count = n + gone.length
  const out = { count } as unknown as Record<string, unknown>
  for (const { name, per, points } of ALL) {
    const src = column(neu, name)
    const dst = new (src.constructor as new (length: number) => Column)(count * per * points)
    dst.set(src.subarray(0, n * per * points))
    out[name] = dst
  }
  const result = out as unknown as StrokeBatch
  const pair = match.pair
  const reversed = match.reversed
  const world = match.world
  // a stroke only the new base has fades in; one both have is eased, a field at a time (tight loops over the arrays)
  for (let j = 0; j < n; j++) if (pair[j] < 0) result.alpha[j] = neu.alpha[j] * w
  if (w < 1) {
    for (const f of [...EASED, WORLD_PATH]) {
      const { per, points } = f
      const stride = per * points
      const a = column(old, f.name)
      const b = column(neu, f.name)
      const dst = column(result, f.name)
      const ofWorld = f === WORLD_PATH
      for (let j = 0; j < n; j++) {
        const i = pair[j]
        if (i < 0 || (ofWorld && world[j] !== 1)) continue
        const turned = points > 1 && reversed[j] === 1
        for (let q = 0; q < points; q++) {
          const from = stride * i + per * (turned ? points - 1 - q : q)
          const to = stride * j + per * q
          for (let k = 0; k < per; k++) dst[to + k] = a[from + k] + (b[to + k] - a[from + k]) * w
        }
      }
    }
  }
  // the strokes only the old base has, after the new ones, fading out
  for (const { name, per, points } of ALL) {
    const stride = per * points
    const src = column(old, name)
    const dst = column(result, name)
    for (let g = 0; g < gone.length; g++) {
      const i = gone[g]
      for (let k = 0; k < stride; k++) dst[stride * (n + g) + k] = src[stride * i + k]
    }
  }
  for (let g = 0; g < gone.length; g++) result.alpha[n + g] = old.alpha[gone[g]] * (1 - w)
  return result
}

const NO_STROKES = new Int32Array(0)
