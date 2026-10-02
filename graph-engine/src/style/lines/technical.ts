import { chainLength, chainStart, type Chain, type Piece } from '../path'
import type { LineType, Primitive, StrokeInput } from './types'

// TECHNICAL — the draughtsman's line: uniform width, crisp, with the ends
// and dashes the figure asked for, and never wobbly. It is clean's line, and it lets any other look keep precise
// lines (pencil shading with technical outlines, say).
//
// Built as the exact geometry itself: straight pieces stay straight and arcs
// stay true arcs (SVG arc commands, not curves through samples). Looseness is
// the only freedom it takes — each end runs on a little past its point along
// its own direction, the way a ruled line overshoots a corner.

function extend(pieces: readonly Piece[], startBy: number, endBy: number): Piece[] {
  const out = pieces.slice()
  const first = out[0]
  const last = out.length - 1
  if (first.kind === 'line') {
    const length = Math.hypot(first.to.x - first.from.x, first.to.y - first.from.y) || 1
    const ux = (first.to.x - first.from.x) / length
    const uy = (first.to.y - first.from.y) / length
    out[0] = { ...first, from: { x: first.from.x - ux * startBy, y: first.from.y - uy * startBy } }
  } else if (first.kind === 'arc') {
    const direction = Math.sign(first.end - first.start) || 1
    out[0] = { ...first, start: first.start - (direction * startBy) / first.radius }
  }
  const end = out[last]
  if (end.kind === 'line') {
    const length = Math.hypot(end.to.x - end.from.x, end.to.y - end.from.y) || 1
    const ux = (end.to.x - end.from.x) / length
    const uy = (end.to.y - end.from.y) / length
    out[last] = { ...end, to: { x: end.to.x + ux * endBy, y: end.to.y + uy * endBy } }
  } else if (end.kind === 'arc') {
    const direction = Math.sign(end.end - end.start) || 1
    out[last] = { ...end, end: end.end + (direction * endBy) / end.radius }
  }
  return out
}

// The caller's ends and dashes are kept (review 1): technical is clean's line,
// so clean with one other setting changed — graph paper, say — keeps clean's
// round ends and its native "9 7" dashes rather than turning square and being
// re-cut. A loop closes on itself.
function draw({ chain, width, settings, random, cap, dash }: StrokeInput): Primitive[] {
  const pieces = runOn(chain, width, settings.looseness, random)
  return [
    {
      kind: 'stroke',
      start: chainStart({ pieces, closed: chain.closed }),
      pieces,
      width,
      opacity: settings.opacity,
      ...(cap ? { cap } : {}),
      ...(dash && dash.length > 0 ? { dash } : {}),
      ...(chain.closed ? { closed: true } : {}),
    },
  ]
}

// Each end's overshoot: always forward, never short, so a technical line
// only ever reaches past its corner.
function runOn(chain: Chain, width: number, looseness: number, random: StrokeInput['random']): Piece[] {
  if (looseness === 0 || chain.closed) return chain.pieces.slice()
  const reach = looseness * (1.4 * width + 0.02 * chainLength(chain))
  return extend(chain.pieces, random.range(0.4, 1) * reach, random.range(0.4, 1) * reach)
}

export const technical: LineType = {
  draw,
  texture: () => null,
  nativeDash: true,
}
