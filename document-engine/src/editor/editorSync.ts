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

/**
 * Remember a text the editor emitted; keeps only the newest `max` entries.
 * Only the newest two can still be in flight back from a mirroring parent;
 * an older one coming back is a genuinely external value.
 */
export function rememberEmitted(ring: string[], text: string, max = 2): void {
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
 * Offset convention: highlights are codepoint offsets into the LF-NORMALISED
 * text (every CRLF and lone CR counts as one "\n"), i.e. the editor's own
 * document, whatever line ending the host text uses. `oldText`/`newText` are
 * the editor's texts. Returns null when nothing changed (caller skips
 * onHighlightsChange).
 */
export function remapHighlightsThroughChanges(
  oldText: string,
  newText: string,
  highlights: readonly DocumentHighlight[],
  changes: ChangeSet,
): DocumentHighlight[] | null {
  if (highlights.length === 0) return null
  const textChanges = changesToTextChanges(changes)
  const internal = highlights.map((h) => toInternalRange(oldText, h))
  const { kept } = remapHighlights(internal, textChanges)
  const back = kept.map((h) => fromInternalRange(newText, h))
  // Every survivor gets its quote re-read from the NEW text so re-anchoring stays accurate.
  const next = attachQuotes(newText, back, new Set<string>())
  return sameHighlights(highlights, next) ? null : next
}

// ------------------------------------------------------------- glue state machine
//
// The React component's flush / retry / echo logic as a pure reducer. Timer
// scheduling comes back as data (`timer`); the component just executes it.
//
// Line endings: the editor works on LF-only text and highlight offsets are
// against that text (see remapHighlightsThroughChanges), so line endings never
// touch them. `eol` is only the ending re-added to the TEXT we emit: the first
// onChange of a mixed-EOL file normalises it to the majority EOL (a lone CR
// counts as a line break).
// Review items 7, 9 and 10 are deliberately skipped in this last round.

export const RETRY_MS = 25
export const MAX_RETRIES = 40

export type TimerCmd = { kind: 'arm'; ms: number; tries: number } | { kind: 'clear' } | null

export interface GlueState {
  emitted: string[]
  queued: string | null
  eol: Eol
}

export interface GlueApply { internal: string }
export interface GlueStep { state: GlueState; apply: GlueApply | null; timer: TimerCmd }

export const initGlue = (value: string): GlueState => ({ emitted: [], queued: null, eol: detectEol(value) })

const applyStep = (s: GlueState, host: string): GlueStep => ({
  state: { emitted: [], queued: null, eol: detectEol(host, s.eol) },
  apply: { internal: normalizeEol(host) },
  timer: { kind: 'clear' },
})

/** The `value` prop changed (or mounted). */
export function glueOnProp(s: GlueState, value: string, docText: string, composingRef: boolean, viewComposing: boolean): GlueStep {
  const d = decideValueSync(normalizeEol(value), docText, composingRef || viewComposing)
  if (d === 'queue') {
    const last = s.emitted[s.emitted.length - 1]
    let queued = s.queued
    let emitted = s.emitted
    if (last === value) queued = null // our newest typing coming back around
    else if (!s.emitted.includes(value)) { queued = value; emitted = [] } // genuinely external
    // an older echo leaves an existing queued external value alone
    const timer: TimerCmd = queued !== null && !composingRef && viewComposing ? { kind: 'arm', ms: RETRY_MS, tries: 0 } : null
    return { state: { ...s, queued, emitted }, apply: null, timer }
  }
  if (d === 'noop') return { state: { ...s, queued: null, eol: detectEol(value, s.eol) }, apply: null, timer: { kind: 'clear' } }
  return applyStep(s, value)
}

/** The editor emitted `out` through onChange. */
export function glueOnEmit(s: GlueState, out: string): GlueState {
  const emitted = s.emitted.slice()
  rememberEmitted(emitted, out)
  return { ...s, emitted }
}

/** The deferred flush of a queued value fired; `tries` retries have happened. */
export function glueOnFlush(s: GlueState, docText: string, composingRef: boolean, viewComposing: boolean, tries: number): GlueStep {
  const q = s.queued
  if (q === null) return { state: s, apply: null, timer: null }
  const d = decideQueuedApply(normalizeEol(q), docText, composingRef || viewComposing, s.emitted.includes(q))
  if (d === 'retry') {
    // A live composition's own compositionend re-arms the flush; so does the
    // next one after the retries ran out with the view still composing.
    const timer: TimerCmd = !composingRef && tries < MAX_RETRIES ? { kind: 'arm', ms: RETRY_MS, tries: tries + 1 } : null
    return { state: s, apply: null, timer }
  }
  if (d === 'drop') return { state: { ...s, queued: null }, apply: null, timer: null }
  return applyStep(s, q)
}

/** Composition ended: flush on the next tick, after CodeMirror settled. */
export const glueOnCompositionEnd = (): TimerCmd => ({ kind: 'arm', ms: 0, tries: 0 })

/** Unmount: nothing queued, no timer. */
export const glueOnUnmount = (s: GlueState): GlueStep => ({ state: { ...s, queued: null }, apply: null, timer: { kind: 'clear' } })
