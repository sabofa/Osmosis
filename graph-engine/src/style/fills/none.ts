import type { FillType } from './types'

// NONE — no fill at all. The region's outline, when it has one, is still
// drawn by the pen; only the inside is left bare.

export const none: FillType = {
  draw: () => ({ marks: [] }),
}
