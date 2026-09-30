import { smoothNoise, type Random } from '../random'
import { normalsOf, sampleChain, smoothThrough } from '../path'
import type { Point } from '../tokens'
import { handChain, handDrawn, ribbon, ribbon2, sampleStep } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// INK — a fountain pen. The line wavers slowly (a long wavelength: the hand,
// not the nib), its width breathes with the pen's pressure, and where the
// nib rests at the start and lifts at the end a little ink pools and bleeds.
// Now and then — more often the tighter the hand — the line is gone over a
// second time, a thin pass beside the first.
//
// Built as a FILLED OUTLINE (a ribbon), because a pen line's width changes
// along its length and a stroked path cannot do that: the spine is the hand
// drawn line, and the half-width at each point is the base width scaled by
// smooth pressure noise and thinned toward the ends by `taper`. The bleed is
// two soft dots at the ends; the doubled pass is a thin stroke.
//
// `grain` drives a rough brush on top, entirely skipped at grain 0 (same
// outline, same random draws, byte for byte):
//   - ragged edges: the two sides of the ribbon stray independently, each
//     its own smooth noise (ribbon2, hand.ts);
//   - dry brush: on a long enough open stroke, the tail sometimes splits
//     into a few bristle strands with gaps, one of which always reaches the
//     true end (the faithfulness rule) — the end blot only applies when it
//     did not.

const WAVELENGTH = 70

function draw({ chain, width, settings, random, step }: StrokeInput): Primitive[] {
  const stepSize = step ?? sampleStep(width)
  const samples = sampleChain(chain, stepSize)
  const { points: spine, closed, loop } = handChain(chain, stepSize, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.35 })
  // A closed loop's pressure comes round to where it started, and it has no
  // ends to thin or to blot.
  const pressure = smoothNoise(random, Math.max(2, samples.length / 6), closed)
  const n = spine.length
  const half = spine.map((_, i) => {
    const t = n === 1 ? 0 : i / (n - 1)
    const ends = closed ? 1 : Math.min(1, Math.min(t, 1 - t) * 6)
    const thinning = 1 - 0.6 * settings.taper * (1 - ends)
    return (width / 2) * (1 + 0.55 * settings.variation * pressure(t)) * thinning
  })

  const out: Primitive[] = []
  // The spine index the main ribbon stops at when the brush ran dry: no end
  // blot there (the strands carry the tail instead).
  let dryFrom = -1

  if (settings.grain > 0) {
    // Ragged edges: each side of the ribbon strays by its own smooth noise,
    // a rough brush catching the paper unevenly.
    const knots = Math.max(4, samples.length / 1.5)
    const noiseLeft = smoothNoise(random, knots, closed)
    const noiseRight = smoothNoise(random, knots, closed)
    const at = (i: number) => (n === 1 ? 0 : i / (n - 1))
    const left = half.map((h, i) => h * (1 + 0.3 * settings.grain * noiseLeft(at(i))))
    const right = half.map((h, i) => h * (1 + 0.3 * settings.grain * noiseRight(at(i))))

    if (!loop && n >= 12 && random.next() < 0.25 + 0.6 * settings.grain) {
      dryFrom = drawDryBrush(out, spine, half, left, right, width, settings, random)
    } else {
      out.push({ kind: 'shape', outline: ribbon2(spine, left, right, closed), spine, opacity: settings.opacity })
    }
  } else {
    out.push({ kind: 'shape', outline: ribbon(spine, half, closed), spine, opacity: settings.opacity })
  }

  // The pool where the nib landed and lifted: a touch wider than the line.
  // Only at the end when the brush did not already run dry there.
  if (!loop) {
    const blot = (i: number) => ({ at: spine[i], r: half[i] * (1.05 + 0.25 * settings.grain) })
    const dots = [blot(0)]
    if (dryFrom < 0) dots.push(blot(n - 1))
    out.push({ kind: 'dots', dots, opacity: settings.opacity * 0.85 })
  }

  // The occasional second pass: likelier the tighter the hand, never on a
  // stroke too short to go over.
  const chance = 0.45 * (1 - 0.6 * settings.looseness)
  if (settings.passes >= 2 && n > 6 && random.next() < chance) {
    const from = Math.floor(n * random.range(0.05, 0.25))
    const to = Math.ceil(n * random.range(0.75, 0.95))
    const side = random.sign() * width * 0.3
    const pass = handDrawn(samples.slice(from, to), width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.1 })
    const offset = pass.map((p, i) => {
      const a = pass[Math.max(0, i - 1)]
      const b = pass[Math.min(pass.length - 1, i + 1)]
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: p.x + ((b.y - a.y) / length) * side, y: p.y - ((b.x - a.x) / length) * side }
    })
    out.push({ kind: 'stroke', start: offset[0], pieces: smoothThrough(offset), width: width * 0.45, opacity: settings.opacity * 0.7, cap: 'round', join: 'round' })
  }
  return out
}

// The dry-brush tail: the main ribbon cut short a little past the split, and
// a few thin bristle strands carrying on from there, spread across the
// stroke's width. Each strand's offset and its own width follow the
// ribbon's taper and pressure at that point (`half[i]`), capped at the
// stroke's nominal half-width (`width / 2`) so a strand never strays past
// the faithfulness bound every line type keeps, even where pressure has
// swollen `half[i]` past it. One strand, chosen at random, always runs to
// the stroke's true end, its offset faded to nothing over its last few
// samples — the faithfulness rule, kept even though the brush is running
// dry. Returns the spine index the main ribbon stopped at.
function drawDryBrush(
  out: Primitive[],
  spine: readonly Point[],
  half: readonly number[],
  left: readonly number[],
  right: readonly number[],
  width: number,
  settings: StrokeInput['settings'],
  random: Random
): number {
  const n = spine.length
  const splitIndex = Math.round(random.range(0.6, 0.85) * (n - 1))
  const mainEnd = Math.min(n - 1, splitIndex + 3)
  out.push({
    kind: 'shape',
    outline: ribbon2(spine.slice(0, mainEnd + 1), left.slice(0, mainEnd + 1), right.slice(0, mainEnd + 1), false),
    spine: spine.slice(0, mainEnd + 1),
    opacity: settings.opacity,
  })

  const normals = normalsOf(spine, false)
  const bounded = (i: number) => Math.min(half[i], width / 2)
  const k = random.int(3, 5)
  const chosen = random.int(0, k - 1)
  for (let j = 0; j < k; j++) {
    const offsetFactor = (-1 + (2 * j + 1) / k) * 0.9
    const widthFactor = random.range(0.55, 0.95)
    const endIndex = j === chosen ? n - 1 : Math.max(splitIndex + 1, Math.round(random.range(splitIndex + 0.3 * (n - 1 - splitIndex), n - 1)))
    const strandSpine: Point[] = []
    const strandWidths: number[] = []
    for (let i = splitIndex; i <= endIndex; i++) {
      // The chosen strand's offset fades to zero over its last three
      // samples, so its spine lands exactly on the true end.
      const fade = j === chosen ? Math.min(1, Math.max(0, (endIndex - i) / 3)) : 1
      const h = bounded(i)
      strandSpine.push({ x: spine[i].x + normals[i].x * h * offsetFactor * fade, y: spine[i].y + normals[i].y * h * offsetFactor * fade })
      strandWidths.push((h / k) * widthFactor)
    }
    out.push({ kind: 'shape', outline: ribbon(strandSpine, strandWidths, false), spine: strandSpine, opacity: settings.opacity })
  }
  return mainEnd
}

export const ink: LineType = {
  draw,
  // A faint softening at the edges, as ink wicks into paper, plus — the same
  // strength — a few pinholes knocked out of the line itself (textures.ts).
  texture: (settings) => ({ name: 'bleed', strength: 0.3 + 0.7 * settings.grain }),
}
