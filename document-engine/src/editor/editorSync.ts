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

export type QueuedDecision = 'apply' | 'retry' | 'drop'

/**
 * What to do with a value queued during composition once the deferred apply
 * runs. `echo` = the value is one of the texts the editor itself emitted via
 * onChange (a stale mirror of our own typing, not an external change).
 */
export function decideQueuedApply(queued: string, docText: string, composing: boolean, echo: boolean): QueuedDecision {
  if (composing) return 'retry'
  if (queued === docText || echo) return 'drop'
  return 'apply'
}

/** Remember a text the editor emitted; keeps only the newest `max` entries. */
export function rememberEmitted(ring: string[], text: string, max = 8): void {
  if (ring[ring.length - 1] === text) return
  ring.push(text)
  if (ring.length > max) ring.splice(0, ring.length - max)
}

// ---------------------------------------------------------------- minimal diff

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff

/**
 * Smallest single replacement turning `a` into `b` (UTF-16 offsets into `a`),
 * snapped so it never splits a surrogate pair. null when identical.
 */
export function diffRange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null
  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++
  // the common prefix must not end between the halves of a pair
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--
  let s = 0
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++
  // the common suffix must not start on the low half of a pair
  if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) }
}

// ------------------------------------------------------------------ line endings

export type Eol = '\n' | '\r\n'

/** CRLF when the text has CRLF breaks at least as often as bare LF; text without breaks keeps `fallback`. */
export function detectEol(text: string, fallback: Eol = '\n'): Eol {
  let crlf = 0
  let lf = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++
    else lf++
  }
  if (crlf + lf === 0) return fallback
  return crlf >= lf ? '\r\n' : '\n'
}

/** Host text -> the editor's LF-only text (CodeMirror splits on CRLF, CR and LF alike). */
export const normalizeEol = (text: string): string => (text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text)

/** Editor text -> host text with the host's line ending. */
export const toHostEol = (text: string, eol: Eol): string => (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)

/**
 * ChangeSet -> UTF-16 changes in OLD document coordinates (what mapOffset expects).
 * With `crlf` the changes are re-expressed in the HOST text, where every editor
 * line break is two units; `oldText` is the editor's (LF) pre-change text.
 */
export function changesToTextChanges(changes: ChangeSet, crlf?: { oldText: string }): TextChange[] {
  const out: TextChange[] = []
  let scanned = 0 // oldText scanned up to here
  let breaks = 0 // line breaks before `scanned`
  const breaksBefore = (pos: number): number => {
    const text = crlf!.oldText
    while (scanned < pos) {
      const i = text.indexOf('\n', scanned)
      if (i < 0 || i >= pos) { scanned = pos; break }
      breaks++
      scanned = i + 1
    }
    return breaks
  }
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!crlf) { out.push({ from: fromA, to: toA, insertLen: inserted.length }); return }
    const from = fromA + breaksBefore(fromA)
    const to = toA + breaksBefore(toA)
    out.push({ from, to, insertLen: inserted.length + (inserted.lines - 1) })
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
 * `oldText`/`newText` are the EDITOR's (LF-only) texts; highlights are in the
 * HOST text, so with eol '\r\n' everything is re-expressed in CRLF coordinates.
 * Returns null when nothing changed (caller skips onHighlightsChange).
 */
export function remapHighlightsThroughChanges(
  oldText: string,
  newText: string,
  highlights: readonly DocumentHighlight[],
  changes: ChangeSet,
  eol: Eol = '\n',
): DocumentHighlight[] | null {
  if (highlights.length === 0) return null
  const crlf = eol === '\r\n'
  const textChanges = changesToTextChanges(changes, crlf ? { oldText } : undefined)
  const oldHost = toHostEol(oldText, eol)
  const newHost = toHostEol(newText, eol)
  const internal = highlights.map((h) => toInternalRange(oldHost, h))
  const { kept } = remapHighlights(internal, textChanges)
  const back = kept.map((h) => fromInternalRange(newHost, h))
  // Every survivor gets its quote re-read from the NEW text so re-anchoring stays accurate.
  const next = attachQuotes(newHost, back, new Set<string>())
  return sameHighlights(highlights, next) ? null : next
}
