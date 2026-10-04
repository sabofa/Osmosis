// The seven media, by name.

import type { MediumName } from '../theme/types'
import { chalk } from './chalk'
import { clean } from './clean'
import { colouredPencil } from './colouredPencil'
import { defaultsOf } from './fit'
import { graphite } from './graphite'
import { ink } from './ink'
import { marker } from './marker'
import type { Medium, MediumSettings } from './types'
import { whiteboard } from './whiteboard'

export type { GrainSpec, Medium, MediumColour, MediumSettingSpec, MediumSettings, Overlap, Role } from './types'

export const MEDIA: Record<MediumName, Medium> = Object.freeze({ clean, ink, graphite, colouredPencil, marker, chalk, whiteboard })

export function mediumOf(name: MediumName): Medium {
  const medium = MEDIA[name]
  if (medium === undefined) throw new RangeError(`no such medium: ${String(name)}`)
  return medium
}

// A medium's settings at their defaults, keyed by the setting's short name.
export function defaultMediumSettings(name: MediumName): MediumSettings {
  return defaultsOf(mediumOf(name).settings)
}
