// ----------------------------------------------------------------------------
// The session stream's rules, kept pure so they can be reasoned about without
// a DOM (spec §5.3, §5.5). The component below them does the fetching, the
// scrolling and the rendering; everything here is "given these entries, what
// should the page say".
//
// The reveal gate (§5.5) is deliberately a web-side rule and nothing more. It
// is not tamper-proof and is not meant to be: the server already withholds a
// deferred answer key, and this is about not putting an earlier item's answer
// on the same screen as the one Ben is currently thinking about.
// ----------------------------------------------------------------------------

export type ItemEntryStatus = 'pending' | 'answered' | 'abandoned' | 'paused'
export type ShowKind = 'text' | 'markdown' | 'graph'

export interface StreamContext {
  course?: string
  unit?: string
  node?: string
  step?: string
  timer_s?: number
}

export interface ItemEntry {
  kind: 'item'
  at: string
  attempt_id: string
  response_id: string | null
  reveal: 'immediate' | 'deferred'
  revealed: boolean
  status: ItemEntryStatus
  context: StreamContext | null
}

export interface ShowEntry {
  kind: 'show'
  at: string
  show_id: string
  show_kind: ShowKind
  payload: string
  caption: string | null
  context: StreamContext | null
  seen_at: string | null
  acknowledged_at: string | null
  updated_at: string | null
}

export type StreamEntry = ItemEntry | ShowEntry

export interface SessionStreamData {
  session: {
    id: string
    name: string
    status: 'open' | 'closed'
    summary: string | null
    context: StreamContext | null
  }
  entries: StreamEntry[]
}

// A stable identity per entry — the React key, and what the component tracks
// "is this new since the last read" by.
export function entryKey(entry: StreamEntry): string {
  return entry.kind === 'item' ? `item:${entry.attempt_id}` : `show:${entry.show_id}`
}

// An item whose outcome hasn't been recorded yet. A paused item counts: the
// learner stepped away from it and is coming back, so it is still open.
export function isOpenItem(entry: StreamEntry): entry is ItemEntry {
  return entry.kind === 'item' && (entry.status === 'pending' || entry.status === 'paused')
}

// Where the item the stream is waiting on sits, or -1. There is normally at
// most one — present_item is a handoff, not a queue — but if the tutor did
// somehow leave two open, the newest is the one on screen, so this scans
// backwards. Everything in the gate below indexes off this one answer, so the
// entry that renders as the open item and the entry that refuses to collapse
// can never be two different rows.
export function openItemIndex(entries: StreamEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isOpenItem(entries[i])) return i
  }
  return -1
}

export function openItem(entries: StreamEntry[]): ItemEntry | null {
  const index = openItemIndex(entries)
  return index === -1 ? null : (entries[index] as ItemEntry)
}

// §5.5, the whole rule in one function. Two independent reasons an entry
// collapses to a one-line stub:
//
//   1. An item is open, and this entry came before it. Nothing behind the
//      question Ben is currently answering should be readable over his
//      shoulder — including an earlier item's answer key and the show that
//      probably gave it away. The open item itself never collapses, and
//      neither does anything after it (there is nothing after it).
//   2. It is a deferred item whose key the server is still withholding. That
//      one holds whether or not anything else is open, and lifts only when the
//      session ends and `revealed` turns true. It cannot apply to an item that
//      is *itself* still open: an unanswered deferred item is unrevealed by
//      definition, and collapsing it would hide the very question Ben has been
//      asked to answer.
export function isCollapsed(entries: StreamEntry[], index: number): boolean {
  const entry = entries[index]
  if (!entry) return false

  const open = openItemIndex(entries)
  if (index === open) return false

  if (entry.kind === 'item' && entry.reveal === 'deferred' && !entry.revealed) return true

  return open !== -1 && index < open
}

// Why a stub is a stub, in the words the stub itself uses. Kept here rather
// than in the component so the two reasons can't drift from the rule above.
export function stubReason(entries: StreamEntry[], index: number): string | null {
  const entry = entries[index]
  if (!entry) return null

  const open = openItemIndex(entries)
  if (index === open) return null
  if (entry.kind === 'item' && entry.reveal === 'deferred' && !entry.revealed) {
    return 'held until the session ends'
  }
  if (open !== -1 && index < open) return 'collapsed while an item is open'
  return null
}

// The one line a collapsed entry shows in place of itself. A show gives up its
// caption (or a few words of its text); an item says what happened to it and
// nothing else — never the question, which is the point of collapsing it.
export function stubLabel(entry: StreamEntry): string {
  if (entry.kind === 'show') {
    if (entry.caption) return entry.caption
    if (entry.show_kind === 'graph') return 'Graph'
    const firstLine = entry.payload.split('\n').find((line) => line.trim() !== '') ?? ''
    const trimmed = firstLine.trim()
    return trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed || 'Shown'
  }
  switch (entry.status) {
    case 'answered':
      return 'Item — answered'
    case 'abandoned':
      return 'Item — not answered'
    case 'paused':
      return 'Item — paused'
    default:
      return 'Item'
  }
}

// The thin banner above the stream: where in the course this is. Empty when
// the tutor named nothing, and the component shows nothing rather than an
// empty bar.
export function bannerText(context: StreamContext | null | undefined): string {
  if (!context) return ''
  return [context.course, context.unit, context.node, context.step]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '')
    .join(' · ')
}

// The line under the banner. Only two things are ever true here: the app is
// waiting on Ben, or Ben is waiting on the tutor. A closed session is neither,
// and the component renders its ending instead of this.
export function stateLine(entries: StreamEntry[]): 'waiting on you' | 'tutor is thinking' {
  return openItem(entries) ? 'waiting on you' : 'tutor is thinking'
}

// The newest show Ben hasn't acknowledged, which is what Space acknowledges.
// Null while an item is open: the show is collapsed behind it, and Space
// belongs to the item's own keyboard map then.
export function pendingShow(entries: StreamEntry[]): ShowEntry | null {
  if (openItem(entries)) return null
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === 'show' && entry.acknowledged_at === null) return entry
  }
  return null
}

// How many seconds are left of the context's timer, counting from when the
// entry that carried it landed. Null when there is no timer to count, and
// never negative — a timer that ran out reads as 0, not as a growing
// negative number.
export function timerSecondsLeft(
  context: StreamContext | null | undefined,
  startedAtIso: string | null,
  now: number
): number | null {
  if (!context || typeof context.timer_s !== 'number' || !Number.isFinite(context.timer_s)) return null
  if (!startedAtIso) return null
  const started = Date.parse(startedAtIso.endsWith('Z') ? startedAtIso : `${startedAtIso.replace(' ', 'T')}Z`)
  if (Number.isNaN(started)) return null
  return Math.max(0, Math.round(context.timer_s - (now - started) / 1000))
}

// Where the timer counts from: the entry that supplied the context the banner
// is showing, which is the last one that carried any.
export function contextAt(entries: StreamEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].context) return entries[i].at
  }
  return null
}
