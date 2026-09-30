import { offRegister } from './region'
import type { FillType } from './types'

// WASH — watercolour: a soft, uneven tint, a little darker at its edges
// where the pigment pooled as it dried.
//
// Built as the region filled through the 'wash' texture (low-frequency noise
// that varies the tint's strength across the region; texture only, it never
// moves an edge), plus the region's own outline drawn wide, soft and faint,
// clipped to the inside, which is the darker rim.
//
// At roughness > 0 the whole patch — the tint and its rim together — sits a
// touch off register (offRegister, region.ts): the wash misses the true line
// on one side and runs under it on the other, both clipped to the exact
// outline so nothing spills past it.

export const wash: FillType = {
  draw: ({ settings, random }) => {
    const shift = offRegister(random, settings.roughness)
    return {
      marks: [
        { kind: 'area', texture: 'wash', shift },
        { kind: 'edge', width: Math.max(3, settings.spacing * 0.7), opacity: 0.45, shift },
      ],
    }
  },
}
