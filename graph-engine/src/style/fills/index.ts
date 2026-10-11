import type { FillType as FillTypeName } from '../tokens'
import { crosshatch } from './crosshatch'
import { flat } from './flat'
import { hatch } from './hatch'
import { none } from './none'
import { scribble } from './scribble'
import { stipple } from './stipple'
import type { FillType } from './types'
import { wash } from './wash'

// The fills, by name. A new fill is a new file beside these, and one entry
// here (plus its name in tokens.ts's FILL_TYPES).
export const FILLS: Record<FillTypeName, FillType> = {
  flat,
  hatch,
  crosshatch,
  stipple,
  scribble,
  wash,
  none,
}

export type { FillInput, FillMark, FillType } from './types'
