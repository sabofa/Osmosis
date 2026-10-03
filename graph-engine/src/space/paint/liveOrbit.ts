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
//              only the ones past a threshold.)
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
  return { pair, gone }
}

// ---- the crossfade ----

// The per-stroke arrays that are eased between the two bases' version of a stroke: [name, numbers per stroke].
const EASED: readonly (readonly [keyof StrokeBatch, number])[] = [
  ['path', 2 * PATH_POINTS],
  ['width', PATH_POINTS],
  ['depth', 1],
  ['colour', 3],
  ['alpha', 1],
  ['load', 1],
  ['impasto', 1],
  ['bristles', 1],
  ['bristleVar', 1],
  ['dry', 1],
  ['wet', 1],
  ['endSoft', 1],
]
const ALL: readonly (readonly [keyof StrokeBatch, number])[] = [
  ...EASED,
  ['role', 1],
  ['layer', 1],
  ['edge', 1],
  ['seed', 1],
  ['worldPath', 3 * PATH_POINTS],
  ['worldNormal', 3],
]

type Column = Float32Array | Uint8Array | Uint32Array
const column = (b: StrokeBatch, name: keyof StrokeBatch): Column => b[name] as Column

// The strokes to draw `weight` of the way (0..1) from the old base's to the new one's, both already re-projected into the
// view on screen:
//   a stroke the old base and the new one share   eased: every number of it (path, width, colour, opacity ...)
//                                                 `weight` of the way from the old frame's to the new one's
//   a stroke only the new base has                its opacity times `weight`: it fades in
//   a stroke only the old base has                its opacity times 1 - `weight`: it fades out
// At weight 1 that is the new base's strokes and nothing else. (`match` is made by matchStrokes for these two
// batches.) The arrays are new; nothing the batches hold is changed.
export function blendStrokes(old: StrokeBatch, neu: StrokeBatch, match: StrokeMatch, weight: number): StrokeBatch {
  const w = Math.min(1, Math.max(0, weight))
  const n = neu.count
  const gone = w < 1 ? match.gone : NO_STROKES
  const count = n + gone.length
  const out = { count } as unknown as Record<string, unknown>
  for (const [name, per] of ALL) {
    const src = column(neu, name)
    const dst = new (src.constructor as new (length: number) => Column)(count * per)
    dst.set(src.subarray(0, n * per))
    out[name] = dst
  }
  const result = out as unknown as StrokeBatch
  const pair = match.pair
  // a stroke only the new base has fades in; one both have is eased, a field at a time (tight loops over the arrays)
  for (let j = 0; j < n; j++) if (pair[j] < 0) result.alpha[j] = neu.alpha[j] * w
  if (w < 1) {
    for (const [name, per] of EASED) {
      const a = column(old, name)
      const b = column(neu, name)
      const dst = column(result, name)
      for (let j = 0; j < n; j++) {
        const i = pair[j]
        if (i < 0) continue
        for (let k = 0; k < per; k++) {
          const from = a[per * i + k]
          dst[per * j + k] = from + (b[per * j + k] - from) * w
        }
      }
    }
  }
  // the strokes only the old base has, after the new ones, fading out
  for (const [name, per] of ALL) {
    const src = column(old, name)
    const dst = column(result, name)
    for (let g = 0; g < gone.length; g++) {
      const i = gone[g]
      for (let k = 0; k < per; k++) dst[per * (n + g) + k] = src[per * i + k]
    }
  }
  for (let g = 0; g < gone.length; g++) result.alpha[n + g] = old.alpha[gone[g]] * (1 - w)
  return result
}

const NO_STROKES = new Int32Array(0)
