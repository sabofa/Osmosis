import { smoothNoise, type Random } from '../random'
import { cumulative, endTangents, normalsOf } from '../path'
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

export function handDrawn(points: readonly Point[], width: number, looseness: number, wobble: number, random: Random, character: HandCharacter): Point[] {
  const n = points.length
  if (n < 2) return points.slice()
  const lengths = cumulative(points)
  const total = lengths[n - 1]
  if (total === 0) return points.slice()
  const normals = normalsOf(points)
  const tangents = endTangents(points)

  const waver = smoothNoise(random, Math.max(2, Math.min(80, total / character.wavelength)))
  const wobbleSize = wobble * width * (character.budget + 1.6 * looseness)
  const bow = looseness * random.range(-1, 1) * Math.min(0.03 * total, 5 * width)
  const reach = looseness * (0.9 * width + 0.012 * total)
  const startOffset = { x: random.range(-1, 1) * reach, y: random.range(-1, 1) * reach }
  const endOffset = { x: random.range(-1, 1) * reach, y: random.range(-1, 1) * reach }
  const run = looseness * (1.2 * width + 0.02 * total)
  const startRun = random.range(-0.35, 1) * run
  const endRun = random.range(-0.35, 1) * run

  return points.map((p, i) => {
    const t = lengths[i] / total
    const arch = Math.sin(Math.PI * t)
    // Pinned at the ends at looseness 0; free to move there as it grows.
    const envelope = (1 - looseness) * arch + looseness
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
export function ribbon(spine: readonly Point[], half: readonly number[]): Point[] {
  const normals = normalsOf(spine)
  const n = spine.length
  const left = spine.map((p, i) => ({ x: p.x + normals[i].x * half[i], y: p.y + normals[i].y * half[i] }))
  const right = spine.map((p, i) => ({ x: p.x - normals[i].x * half[i], y: p.y - normals[i].y * half[i] }))
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
