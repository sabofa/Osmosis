// What SpaceRenderer reports to its host (plan E12, spec SP6 "Events"):
// exposure, never meaning. The engine says what the reader looked at,
// pinned or moved; what that means is the host's business (cross-cutting
// rule). Pure types.

import type { Hit } from './pick/types'

export type SpaceEvent =
  // The probe moved onto a different mark, or off every mark (hit null).
  | { type: 'hover'; hit: Hit | null }
  | { type: 'pin'; action: 'add' | 'remove' | 'clear'; hit: Hit | null }
  | { type: 'param'; name: string; value: number; source: 'slider' | 'play' | 'drag' }
