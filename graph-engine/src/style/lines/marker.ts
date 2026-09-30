import { sampleChain, smoothThrough } from '../path'
import { handDrawn, sampleStep } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// MARKER — a felt-tip. A thick, round-ended, slightly see-through line: where
// two strokes cross the ink doubles up and reads darker, and where the tip
// sat still at the start and end a little extra ink soaked in (a blot).
//
// Built as ONE wide, translucent, round-capped STROKE along a gently
// hand-drawn line (a felt tip glides; it barely wobbles), drawn with multiply
// blending so overlaps darken the way real marker ink does, plus a round blot
// at each end, a touch wider than the line.

const WAVELENGTH = 60

function draw({ chain, width, settings, random, step }: StrokeInput): Primitive[] {
  const samples = sampleChain(chain, step ?? sampleStep(width))
  const line = handDrawn(samples, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.2 })
  // Markers write wide: the base weight, made felt-tip thick.
  const thick = width * 1.45 * (1 + 0.15 * settings.variation * random.range(-1, 1))
  const n = line.length
  return [
    { kind: 'stroke', start: line[0], pieces: smoothThrough(line), width: thick, opacity: settings.opacity * 0.82, cap: 'round', blend: 'multiply' },
    {
      kind: 'dots',
      dots: [
        { at: line[0], r: (thick / 2) * (1.08 + 0.2 * settings.variation * random.next()) },
        { at: line[n - 1], r: (thick / 2) * (1.08 + 0.2 * settings.variation * random.next()) },
      ],
      opacity: settings.opacity * 0.3,
    },
  ]
}

export const marker: LineType = {
  draw,
  texture: () => null,
}
