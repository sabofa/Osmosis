import { grain, sheet } from './common'
import type { PaperType } from './types'

// ROUGH-PAPER — sketchbook or cartridge paper: a coarse, blotchy tooth, and
// long pale fibres running through it.
//
// Built as the tint plus two sheets of noise: a coarse grain (low frequency,
// several octaves) and fibres (noise stretched a hundred to one, so its peaks
// are long streaks). Both darker with `texture`.

export const roughPaper: PaperType = {
  draw(input) {
    const t = input.settings.texture
    const tooth = grain(input, 'rough-paper', '0.22', 4, 1.1 * t, 0.45, 23)
    const fibres = grain(input, 'rough-paper-fibres', '0.008 0.4', 1, 2.4 * t, 0.66, 31)
    return {
      defs: [...tooth.defs, ...fibres.defs],
      background: [sheet(input.view, input.tint), sheet(input.view, tooth.fill), sheet(input.view, fibres.fill)],
    }
  },
}
