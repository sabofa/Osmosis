import { grain, sheet } from './common'
import type { PaperType } from './types'

// PAPER — good writing paper: the tint, with a fine, even grain you notice
// only up close. Built as the tint plus one sheet of fine speckle noise
// (common.ts's grain), darker with `texture`.

export const paper: PaperType = {
  draw(input) {
    const fine = grain(input, 'paper', '0.85', 2, 0.9 * input.settings.texture, 0.42, 11)
    return { defs: fine.defs, background: [sheet(input.view, input.tint), sheet(input.view, fine.fill)] }
  },
}
