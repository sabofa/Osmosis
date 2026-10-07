import { smoothNoise } from '../random'
import { cumulative } from '../path'
import { handChain, ribbon2 } from './hand'
import type { LineType, Primitive, StrokeInput } from './types'

// INK — a brush pen. The ink is solid: no grain, no speckle, no gaps. What
// makes it a hand-inked line is how its WIDTH changes along the way:
//   - it swells and thins with the hand's pressure, slowly — a few fat
//     stretches and thin necks along a stroke, not a flutter;
//   - it tapers to fine points where the brush lands and lifts;
//   - its edges are not quite smooth: each side has its own small bumps and
//     nicks, where the bristles caught the paper.
// All three follow `variation` (and the ends `taper`); at variation 0 the
// line is an even ribbon. `grain` is not read: ink has no texture of its own.
//
// Built as ONE FILLED OUTLINE (a ribbon, hand.ts's ribbon2) around the hand
// drawn spine, because a stroked path cannot change width along its length.
// The half-width on each side at a point is
//     base × taper(t) × pressure(t) × edge_side(t)
// The spine is the hand's (handChain), so the faithfulness rule is the
// hand's: at looseness 0 it starts and ends on the true ends.

const WAVELENGTH = 70
// The pressure's wavelength along the stroke, in drawing units: a swell every
// few times this, whatever the stroke's length.
const PRESSURE_WAVELENGTH = 60
// How far the pressure swings the width at variation 1, either way (so the
// thinnest a neck gets is a quarter of the base).
const PRESSURE = 0.75
// The edge's bumps: their spacing along the stroke, in drawing units (never
// finer than the samples they sit on), and their size at variation 1, as a
// fraction of the half-width.
const EDGE_WAVELENGTH = 5
const EDGE = 0.28
// The stretch at each end that tapers: this fraction of the stroke, but never
// more than TAPER_WIDTHS stroke widths (a long line keeps its body), and how
// thin the very tip gets at taper 1.
const TAPER_SPAN = 0.3
const TAPER_WIDTHS = 14
const TIP = 0.04
// The ink line samples its spine at least this finely, so the edge bumps
// have points to sit on (shading lines pass a coarser `step` of their own).
const FINE_STEP = 3

function draw({ chain, width, settings, random, step, strength }: StrokeInput): Primitive[] {
  const stepSize = step ?? FINE_STEP
  const { points: spine, closed, loop } = handChain(chain, stepSize, width, settings.looseness, settings.wobble, random, { wavelength: WAVELENGTH, budget: 0.35 })
  const n = spine.length
  const lengths = cumulative(spine)
  const total = lengths[n - 1] || 1
  const at = (i: number) => lengths[i] / total

  // A closed loop's noise comes round to where it started. A loop — closed,
  // or drawn round to meet itself (hand.ts) — has no ends to taper: tapering
  // it would pinch a neck into the seam.
  const pressure = smoothNoise(random, Math.max(2, total / PRESSURE_WAVELENGTH), closed)
  const edgeKnots = Math.max(4, Math.min(total / EDGE_WAVELENGTH, n / 1.5))
  const edgeLeft = smoothNoise(random, edgeKnots, closed)
  const edgeRight = smoothNoise(random, edgeKnots, closed)

  const base = width / 2
  const span = Math.min(TAPER_SPAN * total, TAPER_WIDTHS * width) || 1
  const middle = spine.map((_, i) => {
    // Rises from the tip to full width over the first `span` of the stroke
    // (and falls the same way into the last), eased so the point is fine
    // and the shoulder round.
    const along = Math.min(lengths[i], total - lengths[i])
    const reach = closed || loop ? 1 : Math.min(1, along / span)
    const eased = Math.sin((Math.PI / 2) * reach)
    const tapered = 1 - settings.taper * (1 - TIP) * (1 - eased)
    const pressed = 1 + PRESSURE * settings.variation * pressure(at(i))
    return base * tapered * pressed
  })
  const left = middle.map((h, i) => h * (1 + EDGE * settings.variation * edgeLeft(at(i))))
  const right = middle.map((h, i) => h * (1 + EDGE * settings.variation * edgeRight(at(i))))
  return [{ kind: 'shape', outline: ribbon2(spine, left, right, closed), spine, opacity: settings.opacity * (strength ?? 1) }]
}

export const ink: LineType = {
  draw,
  texture: () => null,
}
