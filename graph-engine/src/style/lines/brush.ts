import { smoothNoise } from '../random'
import { cumulative } from '../path'
import { handChain, ribbon, sampleStep } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// BRUSH — a calligraphic stroke. A broad nib held at a fixed angle: the
// stroke is widest travelling across the nib and thinnest along it, it swells
// through the middle, and it tapers to points at both ends.
//
// Built as ONE FILLED OUTLINE around the hand-drawn spine. The half-width at
// each point is
//     peak × nib(direction) × swell(t) × (1 + pressure noise)
// where nib is |sin(direction − nib angle)| lifted off zero so a stroke along
// the nib still shows, and swell is sin(πt) raised to a power set by `taper`
// — zero at both ends, which is what makes the tips points (a closed chain,
// a circle, is drawn as one stroke that starts and ends at the same point).

// The nib's angle, in drawing coordinates: thirty degrees off horizontal.
const NIB = -Math.PI / 6
const PEAK = 1.3
const WAVELENGTH = 55

function draw({ chain, width, settings, random, step, strength }: StrokeInput): Primitive[] {
  const { points: spine, closed } = handChain(chain, step ?? sampleStep(width), width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.3 })
  const n = spine.length
  const lengths = cumulative(spine)
  const total = lengths[n - 1] || 1
  const pressure = smoothNoise(random, Math.max(2, n / 8), closed)
  const exponent = 0.25 + 1.25 * settings.taper
  const half = spine.map((_, i) => {
    // A loop's neighbours wrap round the seam, so its width does not jump there.
    const a = closed && i === 0 ? spine[n - 2] : spine[Math.max(0, i - 1)]
    const b = closed && i === n - 1 ? spine[1] : spine[Math.min(n - 1, i + 1)]
    const direction = Math.atan2(b.y - a.y, b.x - a.x)
    const nib = 0.15 + 0.85 * Math.abs(Math.sin(direction - NIB))
    const t = lengths[i] / total
    // A loop at looseness 0 has no ends to taper to points: its width is the
    // nib's alone, all the way round.
    const swell = closed ? 1 : Math.pow(Math.max(0, Math.sin(Math.PI * t)), exponent)
    return width * PEAK * nib * swell * (1 + 0.35 * settings.variation * pressure(t))
  })
  return [{ kind: 'shape', outline: ribbon(spine, half, closed), spine, opacity: settings.opacity * (strength ?? 1) }]
}

export const brush: LineType = {
  draw,
  texture: () => null,
}
