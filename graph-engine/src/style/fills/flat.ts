import type { FillType } from './types'

// FLAT — the region filled with one even tint at the fill's opacity. Clean's
// fill, and the quiet choice under any line type.

export const flat: FillType = {
  draw: () => ({ marks: [{ kind: 'area' }] }),
}
