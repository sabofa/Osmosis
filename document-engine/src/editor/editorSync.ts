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
 * Offset conversion between a host text (any mix of LF, CRLF, lone CR) and the
 * editor's LF-only text, built from the exact host string.
 */
export function hostEditorMapper(host: string) {
  const edIdx: number[] = [] // editor index of each line break
  const hostPos: number[] = [] // host index where that break starts
  const lens: number[] = []
  const prefix: number[] = [0] // extra host units contributed by the first k breaks
  for (let i = 0; i < host.length; i++) {
    const c = host.charCodeAt(i)
    if (c !== 10 && c !== 13) continue
    const len = c === 13 && host.charCodeAt(i + 1) === 10 ? 2 : 1
    edIdx.push(i - prefix[prefix.length - 1])
    hostPos.push(i)
    lens.push(len)
    prefix.push(prefix[prefix.length - 1] + len - 1)
    i += len - 1
  }
  const lowerBound = (arr: number[], v: number) => {
    let lo = 0
    let hi = arr.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m }
    return lo
  }
  return {
    toHost: (e: number) => e + prefix[lowerBound(edIdx, e)],
    toEditor: (h: number) => {
      const k = lowerBound(hostPos, h) // breaks starting before h
      // inside a CRLF: land after the break
      if (k > 0 && lens[k - 1] === 2 && h === hostPos[k - 1] + 1) return edIdx[k - 1] + 1
      return h - prefix[k]
    },
  }
}

/**
 * Carry codepoint-offset highlights through an edit. Conversion to UTF-16 uses
 * the OLD text, remap runs in UTF-16, conversion back uses the NEW text.
 * `oldText`/`newText` are the EDITOR's (LF-only) texts; highlights are in the
 * HOST text. The remap itself runs in editor coordinates; the host texts are
 * `hosts` when known exactly (any line-ending mix), else rebuilt from `eol`.
 * Returns null when nothing changed (caller skips onHighlightsChange).
 */
export function remapHighlightsThroughChanges(
  oldText: string,
  newText: string,
  highlights: readonly DocumentHighlight[],
  changes: ChangeSet,
  eol: Eol = '\n',
  hosts?: { oldHost: string; newHost: string },
): DocumentHighlight[] | null {
  if (highlights.length === 0) return null
  const oldHost = hosts?.oldHost ?? toHostEol(oldText, eol)
  const newHost = hosts?.newHost ?? toHostEol(newText, eol)
  const oldMap = hostEditorMapper(oldHost)
  const newMap = hostEditorMapper(newHost)
  const textChanges = changesToTextChanges(changes)
  const internal = highlights.map((h) => {
    const r = toInternalRange(oldHost, h)
    return { ...r, start: oldMap.toEditor(r.start), end: oldMap.toEditor(r.end) }
  })
  const { kept } = remapHighlights(internal, textChanges)
  const back = kept.map((h) => fromInternalRange(newHost, { ...h, start: newMap.toHost(h.start), end: newMap.toHost(h.end) }))
  // Every survivor gets its quote re-read from the NEW text so re-anchoring stays accurate.
  const next = attachQuotes(newHost, back, new Set<string>())
  return sameHighlights(highlights, next) ? null : next
}

// ------------------------------------------------------------- glue state machine
//
// The React component's flush / retry / echo logic as a pure reducer. Timer
// scheduling comes back as data (`timer`); the component just executes it.
//
// Line endings: the editor works on LF-only text. `lastHost` is the exact last
// known host text (the prop value, or the text we last emitted) and converts
// offsets for highlight remaps, so mixed endings are never rebuilt from one
// uniform EOL. The first onChange of a mixed-EOL file normalises it to the
// majority EOL (a lone CR counts as a line break); highlights survive because
// the remap goes through editor coordinates, and their quotes are re-read from
// the normalised text afterwards (re-attached by quote).
// Review items 7, 9 and 10 are deliberately skipped in this last round.

export const RETRY_MS = 25
export const MAX_RETRIES = 40

export type TimerCmd = { kind: 'arm'; ms: number; tries: number } | { kind: 'clear' } | null

export interface GlueState {
  emitted: string[]
  queued: string | null
  lastHost: string
  eol: Eol
}

export interface GlueApply { internal: string; oldHost: string; newHost: string }
export interface GlueStep { state: GlueState; apply: GlueApply | null; timer: TimerCmd }

export const initGlue = (value: string): GlueState => ({ emitted: [], queued: null, lastHost: value, eol: detectEol(value) })

const applyStep = (s: GlueState, host: string): GlueStep => ({
  state: { emitted: [], queued: null, lastHost: host, eol: detectEol(host, s.eol) },
  apply: { internal: normalizeEol(host), oldHost: s.lastHost, newHost: host },
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
  if (d === 'noop') return { state: { ...s, queued: null, lastHost: value, eol: detectEol(value, s.eol) }, apply: null, timer: { kind: 'clear' } }
  return applyStep(s, value)
}

/** The editor emitted `out` through onChange. */
export function glueOnEmit(s: GlueState, out: string): GlueState {
  const emitted = s.emitted.slice()
  rememberEmitted(emitted, out)
  return { ...s, emitted, lastHost: out }
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
