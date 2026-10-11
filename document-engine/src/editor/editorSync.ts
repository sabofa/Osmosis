// Pure pieces of the editor's React glue: when to push a prop value into the
// view, and how to carry codepoint-offset highlights through a ChangeSet.
import type { ChangeSet } from '@codemirror/state'
import type { DocumentHighlight } from '../types'
import { remapHighlights, type TextChange } from './anchorRemap'
import { toInternalRange, fromInternalRange, attachQuotes } from '../offsetBoundary'

export type ValueSyncDecision = 'noop' | 'apply' | 'queue'

/** Whether a controlled `value` prop must be written into the view. */
export function decideValueSync(value: string, docText: string, composing: boolean): ValueSyncDecision {
  if (value === docText) return 'noop'
  return composing ? 'queue' : 'apply'
}

/** ChangeSet -> UTF-16 changes in OLD document coordinates (what mapOffset expects). */
export function changesToTextChanges(changes: ChangeSet): TextChange[] {
  const out: TextChange[] = []
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({ from: fromA, to: toA, insertLen: inserted.length })
  })
  return out
}

function sameHighlights(a: readonly DocumentHighlight[], b: readonly DocumentHighlight[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (x.id !== y.id || x.start !== y.start || x.end !== y.end || x.quote !== y.quote || x.prefix !== y.prefix || x.suffix !== y.suffix) return false
  }
  return true
}

/**
 * Carry codepoint-offset highlights through an edit. Conversion to UTF-16 uses
 * the OLD text, remap runs in UTF-16, conversion back uses the NEW text.
 * Returns null when nothing changed (caller skips onHighlightsChange).
 */
export function remapHighlightsThroughChanges(
  oldText: string,
  newText: string,
  highlights: readonly DocumentHighlight[],
  changes: ChangeSet,
): DocumentHighlight[] | null {
  if (highlights.length === 0) return null
  const internal = highlights.map((h) => toInternalRange(oldText, h))
  const { kept } = remapHighlights(internal, changesToTextChanges(changes))
  const back = kept.map((h) => fromInternalRange(newText, h))
  // Every survivor gets its quote re-read from the NEW text so re-anchoring stays accurate.
  const next = attachQuotes(newText, back, new Set<string>())
  return sameHighlights(highlights, next) ? null : next
}
