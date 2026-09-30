import { smoothNoise, type Random } from '../random'
import { cumulative, endTangents, normalsOf, sampleChain, type Chain } from '../path'
import type { Point } from '../tokens'

// The hand: how a drawn line strays from the true one. Shared by the sketchy
// line types, each of which calls it with its own character (a pen wavers
// slowly, pencil quickly) and builds its own look on top.
//
// Four movements, all smooth and all seeded:
//   - WOBBLE, the small waver along the stroke. Its size is capped by
//     `budget` (a fraction of the stroke width) at looseness 0, and its
//     envelope pins it to zero at both ends there;
//   - BOWING, one gentle bulge across the whole stroke;
//   - END OFFSETS, each end landing a little off its true point;
//   - OVERSHOOT, each end running on (or stopping short) along its tangent.
// The last three scale with looseness and vanish at 0, which is the
// faithfulness rule: at looseness 0 the ends are exact and nothing moves
// more than `budget` stroke widths off the true line.

export interface HandCharacter {
  // The wobble's wavelength, in drawing units: long for a pen, short for
  // graphite or chalk.
  wavelength: number
  // The most the wobble may move a point at looseness 0, as a fraction of the
  // stroke width.
  budget: number
}

// How far along a run a point is allowed to move, 0 to 1. On an open run at
// looseness 0 it is pinned at both ends (sin πt) and free as looseness grows.
// On a LOOP at looseness 0 it is sin² πt: zero at the seam AND flat there, so
// the two sides of the seam meet with one tangent — no corner, no notch.
export function envelopeAt(t: number, looseness: number, loop: boolean): number {
  const arch = Math.sin(Math.PI * t)
  if (loop) return arch * arch
  return (1 - looseness) * arch + looseness
}

export function handDrawn(
  points: readonly Point[],
  width: number,
  looseness: number,
  wobble: number,
  random: Random,
  character: HandCharacter,
  // A loop at looseness 0: the points go round and end where they began, and
  // stay closed. `onCurve` keeps both ends ON the curve — no overshoot along
  // the end tangents and no end offsets — for a loop that carries on along
  // its own curve instead (see handChain): an end set off the curve beside
  // the start reads as a tick.
  options: { loop?: boolean; onCurve?: boolean } = {}
): Point[] {
  const n = points.length
  if (n < 2) return points.slice()
  const lengths = cumulative(points)
  const total = lengths[n - 1]
  if (total === 0) return points.slice()
  const loop = options.loop === true
  const normals = normalsOf(points, loop)
  const tangents = endTangents(points)

  const waver = smoothNoise(random, Math.max(2, Math.min(80, total / character.wavelength)), loop)
  const wobbleSize = wobble * width * (character.budget + 1.6 * looseness)
  const bow = looseness * random.range(-1, 1) * Math.min(0.03 * total, 5 * width)
  const reach = options.onCurve ? 0 : looseness * (0.9 * width + 0.012 * total)
  const startOffset = { x: random.range(-1, 1) * reach, y: random.range(-1, 1) * reach }
  const endOffset = { x: random.range(-1, 1) * reach, y: random.range(-1, 1) * reach }
  const run = options.onCurve ? 0 : looseness * (1.2 * width + 0.02 * total)
  const startRun = random.range(-0.35, 1) * run
  const endRun = random.range(-0.35, 1) * run

  const out = points.map((p, i) => {
    const t = lengths[i] / total
    const arch = Math.sin(Math.PI * t)
    // A loop's overlap pins its wobble to nothing at both ends too, so the
    // end comes back exactly onto the start's track (re-review 1).
    const envelope = options.onCurve ? arch : envelopeAt(t, looseness, loop)
    const across = wobbleSize * envelope * waver(t) + bow * arch
    const a = (1 - t) * (1 - t)
    const b = t * t
    let x = p.x + normals[i].x * across + startOffset.x * a + endOffset.x * b
    let y = p.y + normals[i].y * across + startOffset.y * a + endOffset.y * b
    if (i === 0) {
      x -= tangents.start.x * startRun
      y -= tangents.start.y * startRun
    }
    if (i === n - 1) {
      x += tangents.end.x * endRun
      y += tangents.end.y * endRun
    }
    return { x, y }
  })
  // A loop closes on its first point exactly, not on a rounding of it.
  if (loop) out[n - 1] = out[0]
  return out
}

// A whole chain drawn by hand, sampled every `step`.
//
// An open chain is handDrawn as it is. A CLOSED chain (a circle, a rim) is
// where a naive hand leaves a notch: the stroke's two ends meet at the seam
// with different tangents, and an overshoot along the end tangent pokes out
// as a tick. So:
//   - at looseness 0 the loop is drawn as a loop — wobble flat at the seam,
//     normals and smoothing wrapped round it — and `closed` comes back true:
//     the caller draws it without ends (no caps, no blots) and it closes
//     exactly and smoothly;
//   - above 0 the hand carries on PAST the start, following the curve, for a
//     short overlap (as a hand closing a circle does), both ends on the curve
//     and no overshoot along a tangent: the looseness shows in the bowing and
//     the wobble, and the overlap reads as the ink going over itself.
// `loop` says the chain was closed either way: its ends, where it has any,
// lie on the curve itself, so a line type does not blot or cap them into a
// bump at the seam.
export function handChain(
  chain: Chain,
  step: number,
  width: number,
  looseness: number,
  wobble: number,
  random: Random,
  character: HandCharacter
): { points: Point[]; closed: boolean; loop: boolean } {
  const samples = sampleChain(chain, step)
  if (!chain.closed) return { points: handDrawn(samples, width, looseness, wobble, random, character), closed: false, loop: false }
  if (looseness === 0) return { points: handDrawn(samples, width, 0, wobble, random, character, { loop: true }), closed: true, loop: true }
  const lengths = cumulative(samples)
  const total = lengths[lengths.length - 1]
  const overlap = Math.min(0.2 * total, looseness * (2 * width + 0.06 * total))
  const extended = samples.slice()
  for (let i = 1; i < samples.length && lengths[i] <= overlap; i++) extended.push(samples[i])
  return { points: handDrawn(extended, width, looseness, wobble, random, character, { onCurve: true }), closed: false, loop: true }
}

// The sample spacing a line type uses for a stroke of `width`: fine enough
// that a smooth curve through the samples follows an arc to well under a
// stroke width, coarse enough that a figure's markup stays small.
export function sampleStep(width: number): number {
  return Math.max(4, Math.min(9, 2.5 * width))
}

// A ribbon around a spine: the outline of a stroke whose half-width at each
// spine point is `half[i]`, with round caps where the half-width is not zero.
// Laid out as the left side forward, the end cap, the right side back, the
// start cap — so `outline[i]` is the left edge beside `spine[i]` for every i,
// and a zero half-width at an end makes that end a point.
//
// A CLOSED spine (a loop, its last point its first) has no ends: no caps, and
// normals wrapped round the seam. Its left side forward and right side back
// make one ring, which the nonzero fill rule fills as a band with a hole.
export function ribbon(spine: readonly Point[], half: readonly number[], closed = false): Point[] {
  const normals = normalsOf(spine, closed)
  const n = spine.length
  const left = spine.map((p, i) => ({ x: p.x + normals[i].x * half[i], y: p.y + normals[i].y * half[i] }))
  const right = spine.map((p, i) => ({ x: p.x - normals[i].x * half[i], y: p.y - normals[i].y * half[i] }))
  if (closed) return [...left, ...right.reverse()]
  // Half a turn from one side to the other about the spine's end, bulging
  // along the direction of travel there. In y-down coordinates the travel
  // direction is the left normal turned a quarter turn the positive way.
  const cap = (centre: Point, from: Point, radius: number): Point[] => {
    if (radius <= 1e-9) return []
    const out: Point[] = []
    const base = Math.atan2(from.y, from.x)
    for (let k = 1; k < 6; k++) {
      const angle = base + (Math.PI * k) / 6
      out.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) })
    }
    return out
  }
  const endNormal = normals[n - 1]
  const startNormal = normals[0]
  return [
    ...left,
    ...cap(spine[n - 1], endNormal, half[n - 1]),
    ...right.reverse(),
    ...cap(spine[0], { x: -startNormal.x, y: -startNormal.y }, half[0]),
  ]
}
