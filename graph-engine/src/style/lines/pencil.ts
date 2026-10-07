import { normalsOf, smoothThrough } from '../path'
import { handChain, sampleStep } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// PENCIL — graphite. Two or three light passes laid over one another, each a
// little off the last, each quick and slightly nervous (a short wobble
// wavelength), none of them solid: the grain of the paper breaks every pass,
// and where passes overlap the line reads darker.
//
// Built as `passes` separate thin, translucent STROKES, each its own
// hand-drawn line with its own seeded offset to one side — pinned to the
// true ends at looseness 0, drifting off them as looseness grows. The grain
// is a texture over everything drawn in pencil (textures.ts): noise that
// knocks out specks of each stroke, stronger with `grain`.

const WAVELENGTH = 24

// One pass's opacity, as a share of the line's own: 0.8 to 0.95 by chance, unless a medium's strength
// replaces it (every pass is then the medium's).
const passOpacity = (strength: number | undefined, chance: number): number => strength ?? 0.8 + 0.15 * chance

function draw({ chain, width, settings, random, step, strength }: StrokeInput): Primitive[] {
  const out: Primitive[] = []
  for (let pass = 0; pass < settings.passes; pass++) {
    const { points: line, closed, loop } = handChain(chain, step ?? sampleStep(width), width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.25 })
    // Each pass sits a seeded distance to one side, along the whole stroke
    // but easing to nothing at the ends when the hand is tight. A loop's pass
    // keeps its distance all the way round, so it closes on its own track.
    const side = random.range(-0.22, 0.22) * width * (1 + 2 * settings.looseness)
    const normals = normalsOf(line, closed)
    const n = line.length
    const shifted = line.map((p, i) => {
      const t = n === 1 ? 0 : i / (n - 1)
      const ease = closed || loop ? 1 : (1 - settings.looseness) * Math.sin(Math.PI * t) + settings.looseness
      return { x: p.x + normals[i].x * side * ease, y: p.y + normals[i].y * side * ease }
    })
    if (closed) shifted[n - 1] = shifted[0]
    out.push({
      kind: 'stroke',
      start: shifted[0],
      pieces: smoothThrough(shifted, closed),
      width: width * (0.7 + 0.2 * settings.variation * random.range(-1, 1)),
      // The pass's own opacity is drawn even when a medium's strength replaces it, so the random
      // source keeps its sequence and a pencil's strokes lie where they did.
      opacity: settings.opacity * passOpacity(strength, random.next()),
      cap: 'round',
      join: 'round',
      ...(closed ? { closed: true } : {}),
    })
  }
  return out
}

export const pencil: LineType = {
  draw,
  texture: (settings) => (settings.grain > 0 ? { name: 'grain', strength: settings.grain } : null),
}
