import { tag } from '../markup'
import { sheet } from './common'
import type { PaperType } from './types'

// GRAPH — engineering graph paper: fine minor lines every `grid`, and a
// heavier major line every fifth, in pale blue.
//
// Built as a pattern tile five grid squares wide, anchored to the drawing's
// origin: its four inner minor lines each way, and the major lines along two
// edges of the tile (which, repeated, become every fifth line).

export const MINOR = '#a9c7da'
export const MAJOR = '#7fa8c4'

export const graph: PaperType = {
  draw({ settings, view, tint, id, colour }) {
    const g = settings.grid
    const tile = 5 * g
    const lines: string[] = []
    for (let k = 1; k < 5; k++) {
      lines.push(tag('line', { x1: k * g, y1: 0, x2: k * g, y2: tile, stroke: colour(MINOR), 'stroke-width': 0.5 }))
      lines.push(tag('line', { x1: 0, y1: k * g, x2: tile, y2: k * g, stroke: colour(MINOR), 'stroke-width': 0.5 }))
    }
    lines.push(tag('line', { x1: 0, y1: 0, x2: 0, y2: tile, stroke: colour(MAJOR), 'stroke-width': 1 }))
    lines.push(tag('line', { x1: 0, y1: 0, x2: tile, y2: 0, stroke: colour(MAJOR), 'stroke-width': 1 }))
    const pattern = tag('pattern', { id: id('graph'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, lines)
    return { defs: [pattern], background: [sheet(view, tint), sheet(view, `url(#${id('graph')})`)] }
  },
}
