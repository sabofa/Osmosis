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

import { DEFAULT_BINDINGS, type KeyBindings } from './keybinds'

export type Confidence = 'unsure' | 'somewhat' | 'confident'

export type KeyAction =
  | { type: 'choice'; ordinal: number }
  | { type: 'submit' }
  | { type: 'blank' }
  | { type: 'toggle-idk' }
  | { type: 'confidence'; level: Confidence }
  | { type: 'advance' }
  | { type: 'acknowledge' }
  | { type: 'pause' }

export interface KeyContext {
  // The caret is in a textarea/input/contenteditable.
  inTextField: boolean
  kind: 'mc' | 'written'
  choiceCount: number
  // A "recorded" card is showing — the item is answered and the learner is
  // looking at the acknowledgement, not at an answerable item.
  recorded: boolean
  // A show is on screen waiting to be acknowledged (§5.1). Only ever true
  // when no item is open: while one is, the show is collapsed behind it and
  // Space belongs to the item's own card.
  showPending?: boolean
}

// The shape this map needs from a KeyboardEvent, and nothing more.
export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

// The learner-facing legend, kept next to the map it describes so the two
// cannot drift apart. The written variant drops only the ordinals: blank, idk
// and confidence are properties of an answer, not of a choice (§2.2, §2.4).
export const KEY_HINTS = "1–5 pick · Enter next · b blank · ? don't know · u/s/c how sure"

export const WRITTEN_KEY_HINTS =
  "Ctrl + Enter next · b blank · ? don't know · u/s/c how sure"

// The same legends, spelled with whatever the learner bound.
export function keyHints(kind: 'mc' | 'written', b: KeyBindings = DEFAULT_BINDINGS): string {
  const tail = `${b.blank} blank · ${b.idk} don't know · ${b.unsure}/${b.somewhat}/${b.confident} how sure · ${b.pause} pause`
  return kind === 'mc' ? `1–5 pick · Enter next · ${tail}` : `Ctrl + Enter next · ${tail}`
}

// The stream's own legend, for when a show is the thing on screen.
export const SHOW_KEY_HINT = 'Space to acknowledge'

export function resolveKey(event: KeyLike, ctx: KeyContext, b: KeyBindings = DEFAULT_BINDINGS): KeyAction | null {
  const ctrl = event.ctrlKey === true
  const meta = event.metaKey === true
  const alt = event.altKey === true

  // Ctrl+Enter is the one combination the app claims, and the one key that
  // works while typing.
  const ctrlEnter = event.key === 'Enter' && ctrl && !meta && !alt && event.shiftKey !== true
  if (!ctrlEnter) {
    if (ctrl || meta || alt) return null
    if (ctx.inTextField) return null
  }

  // A show is not answerable, so Space is free to mean the one thing there is
  // to do with it. Above the rest of the map because the stream's own keyboard
  // is only enabled when nothing else wants these keys.
  if (ctx.showPending && event.key === ' ') return { type: 'acknowledge' }

  // A recorded card has nothing left to answer, so every way out of it agrees:
  // Enter, Ctrl+Enter and Space all move on, and nothing else does anything —
  // the rest would be editing an answer that is already with the tutor. This
  // sits above the Enter case below precisely so `submit` never wins here.
  if (ctx.recorded) return event.key === 'Enter' || event.key === ' ' ? { type: 'advance' } : null

  if (event.key === 'Enter') return { type: 'submit' }

  // The ordinals are the one part of the map that is choice-shaped: a written
  // item has nothing numbered to pick, so they stop here. Everything below —
  // blank, idk, confidence — is about the answer rather than about a choice,
  // and so applies to every kind of item (§2.2, §2.4, §7.1).
  if (event.key >= '1' && event.key <= '5' && event.key.length === 1) {
    if (ctx.kind !== 'mc') return null
    const ordinal = Number(event.key)
    return ordinal <= ctx.choiceCount ? { type: 'choice', ordinal } : null
  }

  const key = event.key
  const same = (bound: string) => bound.length === 1 && (key === bound || key.toLowerCase() === bound.toLowerCase())
  if (same(b.blank)) return { type: 'blank' }
  if (same(b.idk)) return { type: 'toggle-idk' }
  if (same(b.unsure)) return { type: 'confidence', level: 'unsure' }
  if (same(b.somewhat)) return { type: 'confidence', level: 'somewhat' }
  if (same(b.confident)) return { type: 'confidence', level: 'confident' }
  if (same(b.pause)) return { type: 'pause' }
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
