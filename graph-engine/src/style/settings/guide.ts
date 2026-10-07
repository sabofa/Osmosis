// The settings guide's data: the registry's table joined to its prose.
//
// The registry (registry.ts) is the TABLE of every setting and carries no prose, so a renderer
// that reads it (the figure renderer, the parser, the stack) does not bundle the meanings. This
// module adds, to each setting, what it MEANS in the picture and which other settings it fights
// or amplifies (meanings/*.ts, keyed by path). Only the settings guide (docs/styles/GUIDE.md),
// the Style Lab and the tests import it, and nothing else may import meanings/ (proseBoundary.test.ts
// reads the sources to hold that).
//
// A missing meaning is empty and not an error here: registry.test.ts is what refuses it, so a
// setting added elsewhere never breaks the guide's other readers.

import { BOARD_MEANINGS } from './meanings/boards'
import { MEDIA_MEANINGS } from './meanings/media'
import { PAINT_MEANINGS } from './meanings/paint'
import { STYLE_MEANINGS } from './meanings/style'
import { REGISTRY } from './registry'
import type { GuideEntry, Meaning } from './types'

export type { GuideEntry, Meaning } from './types'

// Every meaning table, one per section (style, paint, media, board). registry.test.ts walks them to
// hold that each names a path the registry has.
export const MEANING_TABLES = Object.freeze({
  style: STYLE_MEANINGS,
  paint: PAINT_MEANINGS,
  media: MEDIA_MEANINGS,
  board: BOARD_MEANINGS,
})

const MEANINGS: ReadonlyMap<string, Meaning> = new Map(Object.values(MEANING_TABLES).flatMap((table) => Object.entries(table)))

// Interactions run both ways: when a setting names another, the other names it back. The meanings
// write each pair once, and this adds the reverse link, so the guide never shows a one-way pair. A name
// that is not a setting is left as it is (registry.test.ts refuses it).
function linked(entries: (GuideEntry & { interactions: string[] })[]): (GuideEntry & { interactions: string[] })[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  for (const entry of entries) {
    for (const other of [...entry.interactions]) {
      const target = byPath.get(other)
      if (target !== undefined && !target.interactions.includes(entry.path)) target.interactions.push(entry.path)
    }
  }
  return entries
}

// An entry nobody can edit: the guide is shared by its readers. (The registry's own specs are already
// frozen and are copied, so freezing an entry never freezes one of them.)
function frozen(entry: GuideEntry): GuideEntry {
  Object.freeze(entry.interactions)
  return Object.freeze(entry)
}

export const GUIDE: readonly GuideEntry[] = Object.freeze(
  linked(
    REGISTRY.map((spec) => {
      const found = MEANINGS.get(spec.path)
      return { ...spec, meaning: found?.meaning ?? '', interactions: [...(found?.interactions ?? [])] }
    })
  ).map(frozen)
)

const BY_PATH: ReadonlyMap<string, GuideEntry> = new Map(GUIDE.map((entry) => [entry.path, entry]))

// The guide entry at a path, or undefined. A path names one setting: a group such as `paint.value` is not one.
export function guideAt(path: string): GuideEntry | undefined {
  return BY_PATH.get(path)
}
