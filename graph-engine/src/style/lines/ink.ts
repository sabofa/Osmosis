import { smoothNoise } from '../random'
import { sampleChain, smoothThrough } from '../path'
import { handDrawn, ribbon, sampleStep } from './hand'
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

const WAVELENGTH = 70

function draw({ chain, width, settings, random }: StrokeInput): Primitive[] {
  const samples = sampleChain(chain, sampleStep(width))
  const spine = handDrawn(samples, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.35 })
  const pressure = smoothNoise(random, Math.max(2, samples.length / 6))
  const n = spine.length
  const half = spine.map((_, i) => {
    const t = n === 1 ? 0 : i / (n - 1)
    const ends = Math.min(1, Math.min(t, 1 - t) * 6)
    const thinning = 1 - 0.6 * settings.taper * (1 - ends)
    return (width / 2) * (1 + 0.55 * settings.variation * pressure(t)) * thinning
  })
  const out: Primitive[] = [{ kind: 'shape', outline: ribbon(spine, half), spine, opacity: settings.opacity }]

  // The pool where the nib landed and lifted: a touch wider than the line.
  const blot = (i: number) => ({ at: spine[i], r: half[i] * (1.05 + 0.25 * settings.grain) })
  out.push({ kind: 'dots', dots: [blot(0), blot(n - 1)], opacity: settings.opacity * 0.85 })

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
    out.push({ kind: 'stroke', start: offset[0], pieces: smoothThrough(offset), width: width * 0.45, opacity: settings.opacity * 0.7, cap: 'round' })
  }
  return out
}

export const ink: LineType = {
  draw,
  // A faint softening at the edges, as ink wicks into paper.
  texture: (settings) => ({ name: 'bleed', strength: 0.3 + 0.7 * settings.grain }),
}
