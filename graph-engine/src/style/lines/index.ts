import type { LineType as LineTypeName } from '../tokens'
import { brush } from './brush'
import { chalk } from './chalk'
import { ink } from './ink'
import { marker } from './marker'
import { pencil } from './pencil'
import { technical } from './technical'
import type { LineType } from './types'

// The line types, by name. A new line type is a new file beside these, and
// one entry here (plus its name in tokens.ts's LINE_TYPES).
export const LINES: Record<LineTypeName, LineType> = {
  technical,
  ink,
  brush,
  pencil,
  marker,
  chalk,
}

export type { LineType, Primitive, StrokeInput, Texture } from './types'
