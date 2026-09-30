import { smoothNoise } from '../random'
import { cumulative, sampleChain } from '../path'
import { handDrawn, ribbon, sampleStep } from './hand'
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

function draw({ chain, width, settings, random }: StrokeInput): Primitive[] {
  const samples = sampleChain(chain, sampleStep(width))
  const spine = handDrawn(samples, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.3 })
  const lengths = cumulative(spine)
  const total = lengths[lengths.length - 1] || 1
  const pressure = smoothNoise(random, Math.max(2, spine.length / 8))
  const exponent = 0.25 + 1.25 * settings.taper
  const half = spine.map((_, i) => {
    const a = spine[Math.max(0, i - 1)]
    const b = spine[Math.min(spine.length - 1, i + 1)]
    const direction = Math.atan2(b.y - a.y, b.x - a.x)
    const nib = 0.15 + 0.85 * Math.abs(Math.sin(direction - NIB))
    const t = lengths[i] / total
    const swell = Math.pow(Math.max(0, Math.sin(Math.PI * t)), exponent)
    return width * PEAK * nib * swell * (1 + 0.35 * settings.variation * pressure(t))
  })
  return [{ kind: 'shape', outline: ribbon(spine, half), spine, opacity: settings.opacity }]
}

export const brush: LineType = {
  draw,
  texture: () => null,
}
