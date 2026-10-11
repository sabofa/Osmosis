import { offRegister } from './offRegister'
import type { FillType } from './types'

// FLAT — the region filled with one even tint at the fill's opacity. Clean's
// fill, and the quiet choice under any line type.
//
// At roughness > 0 the tint sits a touch off register (offRegister.ts)
// and carries a faint mottle (textures.ts): the tint no longer looks poured
// by machine. At roughness 0 it is the one mark it always was.

export const flat: FillType = {
  draw: ({ settings, random }) => {
    const r = settings.roughness
    if (r <= 0) return { marks: [{ kind: 'area' }] }
    return { marks: [{ kind: 'area', texture: 'mottle', strength: r, shift: offRegister(random, r) }] }
  },
}
