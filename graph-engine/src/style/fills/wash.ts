import type { FillType } from './types'

// WASH — watercolour: a soft, uneven tint, a little darker at its edges
// where the pigment pooled as it dried.
//
// Built as the region filled through the 'wash' texture (low-frequency noise
// that varies the tint's strength across the region; texture only, it never
// moves an edge), plus the region's own outline drawn wide, soft and faint,
// clipped to the inside, which is the darker rim.

export const wash: FillType = {
  draw: ({ settings }) => ({
    marks: [
      { kind: 'area', texture: 'wash' },
      { kind: 'edge', width: Math.max(3, settings.spacing * 0.7), opacity: 0.45 },
    ],
  }),
}
