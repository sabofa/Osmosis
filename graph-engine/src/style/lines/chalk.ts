import { cumulative, normalsOf, sampleChain, smoothThrough } from '../path'
import { handDrawn, sampleStep } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// CHALK — a stick of chalk dragged across a board. The line skips: it breaks
// into runs with small gaps where the chalk lifted off the grain, its edges
// are soft and dusty, and loose dust is scattered along it.
//
// Built as SEVERAL STROKES — the hand-drawn line cut into runs at seeded
// break points, the first run starting exactly at the true start and the last
// ending exactly at the true end — plus a spray of small DOTS of dust within
// the line's own width. The chalky, speckled edge is a texture over
// everything drawn in chalk (textures.ts).

const WAVELENGTH = 30

function draw({ chain, width, settings, random }: StrokeInput): Primitive[] {
  const samples = sampleChain(chain, sampleStep(width) * 0.7)
  const line = handDrawn(samples, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.2 })
  const lengths = cumulative(line)
  const total = lengths[lengths.length - 1]
  const n = line.length

  // Where the chalk lifts: short, uneven gaps (under a width, so a broken
  // chalk line never reads as a dashed hidden edge), every 35 to 90 units.
  const runs: [number, number][] = []
  let from = 0
  let i = 0
  while (i < n - 1) {
    let j = i + 1
    const want = lengths[i] + random.range(35, 90)
    while (j < n - 1 && lengths[j] < want) j++
    if (j >= n - 2) {
      runs.push([from, n - 1])
      break
    }
    runs.push([from, j])
    // Skip a gap, keeping at least a point to start the next run on.
    let k = j + 1
    const gap = lengths[j] + width * random.range(0.3, 0.9)
    while (k < n - 2 && lengths[k] < gap) k++
    from = k
    i = k
  }
  if (runs.length === 0) runs.push([0, n - 1])

  const out: Primitive[] = runs
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const run = line.slice(a, b + 1)
      return { kind: 'stroke' as const, start: run[0], pieces: smoothThrough(run), width: width * (1.15 + 0.25 * random.next()), opacity: settings.opacity * 0.85, cap: 'round' as const }
    })

  // Dust: specks within the stroke's own width, more of them with grain.
  const normals = normalsOf(line)
  const count = Math.max(12, Math.round((total / 4) * (0.3 + settings.grain)))
  const dots: { at: { x: number; y: number }; r: number }[] = []
  for (let d = 0; d < count; d++) {
    const at = random.range(0, total)
    let k = 1
    while (k < n - 1 && lengths[k] < at) k++
    const span = lengths[k] - lengths[k - 1] || 1
    const f = (at - lengths[k - 1]) / span
    const p = { x: line[k - 1].x + (line[k].x - line[k - 1].x) * f, y: line[k - 1].y + (line[k].y - line[k - 1].y) * f }
    // Within the stroke: the wobble takes at most a fifth of a width, the
    // dust the rest of the half-width.
    const across = random.range(-0.28, 0.28) * width
    dots.push({ at: { x: p.x + normals[k].x * across, y: p.y + normals[k].y * across }, r: width * random.range(0.08, 0.22) })
  }
  out.push({ kind: 'dots', dots, opacity: settings.opacity * 0.7 })
  return out
}

export const chalk: LineType = {
  draw,
  texture: (settings) => ({ name: 'chalk', strength: 0.35 + 0.65 * settings.grain }),
}
