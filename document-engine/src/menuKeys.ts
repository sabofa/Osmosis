// Pure keyboard mapping for a roving-focus menu (no DOM).

export type MenuKeyAction =
  | { kind: 'focus'; index: number }
  // Close the menu; `refocus` returns focus to the trigger button.
  | { kind: 'close'; refocus: boolean }

// `current` is the index of the focused item (-1: none). Returns null for keys
// the menu does not handle (Enter/Space activate the focused button natively).
export function menuKeyAction(key: string, current: number, count: number): MenuKeyAction | null {
  if (key === 'Escape') return { kind: 'close', refocus: true }
  // Tab closes and lets the browser carry focus on from the trigger.
  if (key === 'Tab') return { kind: 'close', refocus: true }
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: current < 0 || current >= count - 1 ? 0 : current + 1 }
    case 'ArrowUp':
      return { kind: 'focus', index: current <= 0 ? count - 1 : current - 1 }
    case 'Home':
      return { kind: 'focus', index: 0 }
    case 'End':
      return { kind: 'focus', index: count - 1 }
    default:
      return null
  }
}

// Index to focus when the menu opens: the checked item, else the first.
export function initialMenuIndex(checked: readonly boolean[]): number {
  const i = checked.findIndex(Boolean)
  return i < 0 ? 0 : i
}
