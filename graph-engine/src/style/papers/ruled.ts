import { tag } from '../markup'
import { cover, sheet } from './common'
import type { PaperType } from './types'

// RULED — a notebook page: pale blue lines every `grid`, and a red margin
// line down the left.
//
// Built as a pattern tile one line tall holding one rule, and the margin as
// a single line the height of the cover, a little in from the figure's left
// edge (a notebook's margin sits just inside the writing).

export const ruled: PaperType = {
  draw({ settings, view, tint, id, colour }) {
    const g = settings.grid
    const rule = tag('line', { x1: 0, y1: g - 0.5, x2: g, y2: g - 0.5, stroke: colour('#9dbbd8'), 'stroke-width': 0.8 })
    const pattern = tag('pattern', { id: id('ruled'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: g, height: g }, [rule])
    const box = cover(view)
    const x = view.x + 0.06 * view.width
    const margin = tag('line', { x1: x, y1: box.y, x2: x, y2: box.y + box.height, stroke: colour('#e08a8a'), 'stroke-width': 1.1, 'data-paper': 'margin' })
    return { defs: [pattern], background: [sheet(view, tint), sheet(view, `url(#${id('ruled')})`), margin] }
  },
}
