// ----------------------------------------------------------------------------
// The answering keyboard map (spec §7.1), kept pure so the whole thing is
// testable without a DOM: a key plus the context it landed in resolves to an
// action, or to nothing. `useKeyboard` is the only place this meets a real
// KeyboardEvent.
//
// Two rules hold everywhere and are the reason the map is a single function
// rather than a scatter of handlers:
//   1. While the caret is in a text field the app takes no keys at all —
//      except Ctrl+Enter, which is the documented way to submit from there.
//   2. Nothing with Ctrl/Meta/Alt is ours (again except Ctrl+Enter). Those
//      belong to the browser, and stealing them is how a web app earns a
//      reputation for breaking find-in-page.
// ----------------------------------------------------------------------------

export type Confidence = 'unsure' | 'somewhat' | 'confident'

export type KeyAction =
  | { type: 'choice'; ordinal: number }
  | { type: 'submit' }
  | { type: 'blank' }
  | { type: 'toggle-idk' }
  | { type: 'confidence'; level: Confidence }
  | { type: 'advance' }

export interface KeyContext {
  // The caret is in a textarea/input/contenteditable.
  inTextField: boolean
  kind: 'mc' | 'written'
  choiceCount: number
  // A "recorded" card is showing — the item is answered and the learner is
  // looking at the acknowledgement, not at an answerable item.
  recorded: boolean
}

// The shape this map needs from a KeyboardEvent, and nothing more.
export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

const CONFIDENCE_KEYS: Record<string, Confidence> = {
  u: 'unsure',
  s: 'somewhat',
  c: 'confident',
}

// The learner-facing legend, kept next to the map it describes so the two
// cannot drift apart.
export const KEY_HINTS = "1–5 pick · Enter next · b blank · ? don't know · u/s/c how sure"

export function resolveKey(event: KeyLike, ctx: KeyContext): KeyAction | null {
  const ctrl = event.ctrlKey === true
  const meta = event.metaKey === true
  const alt = event.altKey === true

  // Ctrl+Enter is the one combination the app claims, and the one key that
  // works while typing.
  if (event.key === 'Enter' && ctrl && !meta && !alt && event.shiftKey !== true) return { type: 'submit' }
  if (ctrl || meta || alt) return null
  if (ctx.inTextField) return null

  if (event.key === 'Enter') return { type: 'submit' }

  // A recorded card has nothing left to answer: Space moves on, everything
  // else would be editing an answer that is already with the tutor.
  if (ctx.recorded) return event.key === ' ' ? { type: 'advance' } : null

  if (ctx.kind !== 'mc') return null

  if (event.key >= '1' && event.key <= '5' && event.key.length === 1) {
    const ordinal = Number(event.key)
    return ordinal <= ctx.choiceCount ? { type: 'choice', ordinal } : null
  }

  const lower = event.key.toLowerCase()
  if (lower === 'b') return { type: 'blank' }
  if (event.key === '?') return { type: 'toggle-idk' }
  const level = CONFIDENCE_KEYS[lower]
  if (level) return { type: 'confidence', level }
  return null
}

// Whether a keystroke's target is somewhere the learner is typing. Structural
// (a tag name and a flag), so it is testable without a DOM.
export function isTextEntry(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false
  const tag = (target.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true
  return target.isContentEditable === true
}
