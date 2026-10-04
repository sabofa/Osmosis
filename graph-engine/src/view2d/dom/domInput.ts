import { HOVER_TOLERANCE, TOUCH_TOLERANCE } from '../feel'
import type { Intent, PointerKind } from '../input'

// The decisions the DOM adapter makes about raw browser events, kept apart
// from the listeners so a node test can reach them.

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat: boolean
}

// Keys that make sense held down: zoom and pan keep going while the key does.
const REPEATABLE = new Set(['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

// Whether a key press should be offered to the view at all.
//
// Ctrl, meta or alt held means the reader is asking the *browser* for
// something (copy, reset the page zoom, a shortcut) and the view must neither
// act on it nor swallow it. Shift is allowed: `+` is a shifted key on most
// layouts. A held-down reset, clear or toggle acts once, not once per repeat.
export function keyReachesView(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.repeat && !REPEATABLE.has(event.key)) return false
  return true
}

// How near a pointer must be to point at something, in content units: the
// pixel tolerance for the kind of pointer, over the current pixels per unit
// (so it stays the same size on screen however far the view is zoomed).
export function toleranceInContent(kind: PointerKind, pxPerUnit: number): number {
  const px = kind === 'touch' ? TOUCH_TOLERANCE : HOVER_TOLERANCE
  return px / (Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 1)
}

export function pointerKindOf(pointerType: string): PointerKind {
  return pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse'
}

// Whether the view takes a key for its own, so the browser must not also act
// on it. A key that gave no intent is not the view's. Nor is the coordinate
// toggle when nothing listens for it (the tool is off): `c` then does nothing
// here and is left to the page.
export function swallowsKey(intents: readonly Intent[], toggleListened: boolean): boolean {
  return intents.some((intent) => intent.kind !== 'toggleCoordinates' || toggleListened)
}
