import { mixOklab } from '../theme/derive'
import { num, tag } from '../markup'
import { smoothNoise, type Random } from '../random'
import { cover, sheet } from './common'
import type { PaperInput, PaperOutput } from './types'

// What is drawn BY HAND over a paper's grain: the lines of a notebook, the squares of graph paper, the dots of a
// dot grid. They are SVG (a pattern of lines that waver a little, and are pinned at the edge of the pattern tile so
// the tiles join), laid over the generated tile (generated.ts), in the theme's own line colours: `line` for the
// rulings, `lineStrong` for the heavier lines and the margin's red mixed from the theme's `bad`.
//
// The waver is a seeded smooth noise along each line, a hair's breadth, and no two lines agree on their
// spacing or their weight. SLIGHT is the hand of a ruled notebook or printed graph paper (it grows a little
// with texture); ROUGH is the old rough-graph, a grid ruled by hand.

export type Rulings = 'notebook' | 'graph' | 'dotted'
export type Waver = 'slight' | 'rough'

// How far a line strays from true, in drawing units, at texture 0 and the most it adds at texture 1.
const WAVER: Record<Waver, readonly [number, number]> = { slight: [0.12, 0.3], rough: [0.25, 1.1] }

// A line across a pattern tile of `length` at `at`, wavering by up to `waver` units, its ends pinned to `at`
// so the next tile carries on from it. Written as a polyline. An SVG pattern clips to its tile, so a line whose
// stroke reaches the tile's edge would show only the half inside it: such a line is drawn again a whole tile
// over (the same line, shifted), and the two halves that show are the stroke's two sides, joined across the wrap.
function wavering(random: Random, length: number, at: number, vertical: boolean, stroke: string, width: number, waver: number): string[] {
  const noise = smoothNoise(random, 5)
  const offset = random.range(-0.25, 0.25) * waver
  const drawn = width * random.range(0.75, 1.25)
  const reach = drawn / 2 + Math.abs(offset) + waver
  const ats = [at]
  if (at - reach < 0) ats.push(at + length)
  if (at + reach > length) ats.push(at - length)
  const steps = Math.max(8, Math.ceil(length / 12))
  return ats.map((base) => {
    const points: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const d = base + (offset + waver * noise(t)) * Math.sin(Math.PI * t)
      const s = t * length
      points.push(vertical ? `${num(d)},${num(s)}` : `${num(s)},${num(d)}`)
    }
    return tag('polyline', { points: points.join(' '), fill: 'none', stroke, 'stroke-width': drawn, 'stroke-linecap': 'round' })
  })
}

// The pattern tile spans this many squares each way: a rule's waver repeats only that often, so a notebook's
// rules differ from one another, and graph paper's two heavier squares are not the same two.
const SQUARES = 10

export function rulingsOf(kind: Rulings, waverKind: Waver, input: PaperInput): PaperOutput {
  const { settings, view, tint, id, colour, random, theme } = input
  const g = settings.grid
  const waver = WAVER[waverKind][0] + WAVER[waverKind][1] * settings.texture
  const line = colour(theme.colours.line)
  const strong = colour(theme.colours.lineStrong)
  const tile = SQUARES * g

  if (kind === 'graph') {
    const lines: string[] = []
    for (let k = 0; k < SQUARES; k++) {
      const major = k % 5 === 0
      const stroke = major ? strong : line
      const width = major ? 1 : 0.55
      lines.push(...wavering(random, tile, k * g, true, stroke, width, waver))
      lines.push(...wavering(random, tile, k * g, false, stroke, width, waver))
    }
    const pattern = tag('pattern', { id: id('rules'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, lines)
    return { defs: [pattern], background: [sheet(view, `url(#${id('rules')})`, { 'data-paper': 'rules' })] }
  }

  if (kind === 'dotted') {
    // A dot in every square, set by a hand that does not quite hit the same place twice.
    const dots: string[] = []
    const radius = Math.max(0.8, g * 0.045)
    for (let j = 0; j < SQUARES; j++) {
      for (let i = 0; i < SQUARES; i++) {
        const reach = 0.04 * g
        dots.push(
          tag('circle', {
            cx: (i + 0.5) * g + random.range(-reach, reach) * (0.4 + waver),
            cy: (j + 0.5) * g + random.range(-reach, reach) * (0.4 + waver),
            r: radius * random.range(0.85, 1.15),
            fill: strong,
          })
        )
      }
    }
    // The tile is shifted half a square, so the dots land on the grid's own points (a graph's lines cross there).
    const pattern = tag('pattern', { id: id('rules'), patternUnits: 'userSpaceOnUse', x: -g / 2, y: -g / 2, width: tile, height: tile }, dots)
    return { defs: [pattern], background: [sheet(view, `url(#${id('rules')})`, { 'data-paper': 'rules' })] }
  }

  // A notebook: a rule in every square, each its own; and a red margin down the left, a little in from the figure's
  // edge (a notebook's margin sits just inside the writing), drawn the height of the cover.
  const rules: string[] = []
  for (let k = 0; k < SQUARES; k++) rules.push(...wavering(random, tile, (k + 1) * g - 0.5, false, line, 0.8, waver))
  const pattern = tag('pattern', { id: id('rules'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, rules)
  const box = cover(view)
  const x = view.x + 0.06 * view.width
  const margin = tag('line', {
    x1: x,
    y1: box.y,
    x2: x,
    y2: box.y + box.height,
    stroke: colour(mixOklab(theme.colours.bad, tint, 0.45)),
    'stroke-width': 1.1,
    'data-paper': 'margin',
  })
  return { defs: [pattern], background: [sheet(view, `url(#${id('rules')})`, { 'data-paper': 'rules' }), margin] }
}
