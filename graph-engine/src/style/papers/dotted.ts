import { tag } from '../markup'
import { sheet } from './common'
import type { PaperType } from './types'

// DOTTED — a bullet-journal dot grid: a small grey dot every `grid`, each way.
//
// Built as a pattern tile one grid square wide holding one dot at its corner.

export const dotted: PaperType = {
  draw({ settings, view, tint, id, colour }) {
    const g = settings.grid
    const dot = tag('circle', { cx: 0, cy: 0, r: Math.max(0.8, g * 0.045), fill: colour('#9a9a94') })
    // The dot sits on the tile's corner, so it is drawn at all four corners
    // (each shows one quarter), which keeps it whole where tiles meet.
    const corners = [dot, dot.replace('cx="0"', `cx="${g}"`), dot.replace('cy="0"', `cy="${g}"`), dot.replace('cx="0" cy="0"', `cx="${g}" cy="${g}"`)]
    const pattern = tag('pattern', { id: id('dotted'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: g, height: g }, corners)
    return { defs: [pattern], background: [sheet(view, tint), sheet(view, `url(#${id('dotted')})`)] }
  },
}
