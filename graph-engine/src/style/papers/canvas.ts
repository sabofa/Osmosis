import { tag } from '../markup'
import { grain, sheet } from './common'
import type { PaperType } from './types'

// CANVAS — woven cloth: threads over and under in a fine basket weave, with
// a little noise in the yarn.
//
// Built as the tint, then a pattern tile of the weave — each cell two short
// thread segments, one running across and one down, the one on top shaded a
// touch darker, alternating cell to cell so the threads read as over and
// under — then a grain for the yarn's fuzz. The weave's contrast and the
// fuzz both grow with `texture`.

const CELL = 6

export const canvas: PaperType = {
  draw(input) {
    const s = 0.3 + 0.7 * input.settings.texture
    const thread = input.colour('#6b5b45')
    const tile = 2 * CELL
    const across = (x: number, y: number, top: boolean) =>
      tag('rect', { x: x + 0.3, y: y + 1, width: CELL - 0.6, height: CELL - 2, rx: 1.2, fill: thread, opacity: (top ? 0.16 : 0.07) * s })
    const down = (x: number, y: number, top: boolean) =>
      tag('rect', { x: x + 1, y: y + 0.3, width: CELL - 2, height: CELL - 0.6, rx: 1.2, fill: thread, opacity: (top ? 0.16 : 0.07) * s })
    const weave = tag('pattern', { id: input.id('canvas'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, [
      across(0, 0, true),
      down(CELL, 0, false),
      down(0, CELL, false),
      across(CELL, CELL, true),
      down(0, 0, false),
      across(CELL, 0, true),
      across(0, CELL, true),
      down(CELL, CELL, false),
    ])
    const fuzz = grain(input, 'canvas-fuzz', '0.7', 2, 0.6 * input.settings.texture, 0.45, 41)
    return {
      defs: [weave, ...fuzz.defs],
      background: [sheet(input.view, input.tint), sheet(input.view, `url(#${input.id('canvas')})`), sheet(input.view, fuzz.fill)],
    }
  },
}
