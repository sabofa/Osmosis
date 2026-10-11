// Pure helpers behind the ribbon UI (no DOM): keyboard roving, shortcut
// spelling, the gallery's visible window, the narrow row's overflow split and
// the look of a style preview. Ribbon.tsx owns the DOM; this is what tests pin.
import type { RibbonPreview } from './ribbonModel'

/**
 * Where arrow keys move inside a group of `count` focusable controls.
 * Returns the next index, or null for keys the roving does not handle.
 * Left/Up go back, Right/Down go forward (both axes: a group may wrap), no
 * wrap-around at the ends (Word stops at the edge), Home/End jump.
 */
export function rovingIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  const at = Math.max(0, Math.min(current, count - 1))
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, at + 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, at - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * Arrow navigation among popover items where some may be disabled: `disabled[i]`
 * says item i cannot take focus. Returns the next ENABLED index (no wrap), or
 * null for keys that are not navigation / when nothing is enabled. A current
 * index of -1 (focus not on an item) enters from the matching end.
 */
export function nextEnabledIndex(key: string, current: number, disabled: readonly boolean[]): number | null {
  const enabled: number[] = []
  disabled.forEach((d, i) => {
    if (!d) enabled.push(i)
  })
  if (!enabled.length) return null
  const pos = enabled.indexOf(current)
  if (pos < 0) {
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Home':
        return enabled[0]
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'End':
        return enabled[enabled.length - 1]
      default:
        return null
    }
  }
  const next = rovingIndex(key, pos, enabled.length)
  return next === null ? null : enabled[next]
}

/** Which item takes focus when a popover opens: the selected one, else the first enabled; -1 if none. */
export function firstFocusIndex(disabled: readonly boolean[], selected = -1): number {
  if (selected >= 0 && selected < disabled.length && !disabled[selected]) return selected
  return disabled.findIndex((d) => !d)
}

/** Tab leaves a menu/listbox popover (closing it) but moves within a dialog popover, which only Esc closes. */
export function tabClosesPopover(role: string): boolean {
  return role !== 'dialog'
}

/** "Mod-Shift-z" -> "Ctrl+Shift+Z" (or the Mac spelling). */
export function prettyShortcut(shortcut: string, mac = false): string {
  return shortcut
    .split('-')
    .map((p) => {
      if (p === 'Mod') return mac ? 'Cmd' : 'Ctrl'
      return p.length === 1 ? p.toUpperCase() : p
    })
    .join('+')
}

/** The hover text of a control: its tooltip, else "Label (Shortcut)". */
export function controlTitle(item: { label: string; shortcut?: string; tooltip?: string }, mac = false): string {
  if (item.tooltip) return item.tooltip
  return item.shortcut ? `${item.label} (${prettyShortcut(item.shortcut, mac)})` : item.label
}

/**
 * The slice of `count` options the gallery strip shows: from the start, moved
 * forward just far enough that the selected option is the last one visible.
 */
export function galleryWindow<T extends { value: string }>(options: readonly T[], value: string, count: number): T[] {
  const n = Math.max(1, Math.min(count, options.length))
  const at = options.findIndex((o) => o.value === value)
  const start = at < n ? 0 : at - n + 1
  return options.slice(start, start + n)
}

/** How many gallery tiles fit a ribbon of this width. */
export function galleryTileCount(width: number): number {
  if (width >= 1180) return 4
  if (width >= 960) return 3
  return 2
}

/** Slots a control takes in the narrow row: wide controls count double. */
export function controlSlots(kind: string): number {
  return kind === 'select' || kind === 'gallery' || kind === 'number' || kind === 'color' ? 2 : 1
}

/**
 * Narrow row: items stay in the row while their slots fit `capacity`, the rest
 * overflow. When anything overflows, the overflow button takes one slot too.
 */
export function overflowSplit<T>(items: readonly T[], capacity: number, weight: (item: T) => number = () => 1): { shown: T[]; overflow: T[] } {
  const cap = Math.max(0, Math.floor(capacity))
  const total = items.reduce((n, i) => n + weight(i), 0)
  if (total <= cap) return { shown: [...items], overflow: [] }
  const room = Math.max(0, cap - 1)
  let used = 0
  let keep = 0
  for (const i of items) {
    const w = weight(i)
    if (used + w > room) break
    used += w
    keep++
  }
  return { shown: items.slice(0, keep), overflow: items.slice(keep) }
}

/** Container width under which the ribbon collapses to one icon row. */
export const NARROW_BELOW = 640
/** Once narrow, it stays narrow until the width reaches this (hysteresis against flicker). */
export const WIDE_FROM = 664

export function isNarrow(width: number, wasNarrow = false): boolean {
  if (width <= 0) return false
  return wasNarrow ? width < WIDE_FROM : width < NARROW_BELOW
}

/** The CSS-free look of a preview option in the gallery strip / list. */
export interface PreviewLook {
  fontSizeEm: number
  fontWeight: number
  italic: boolean
  mono: boolean
}

/**
 * Preview scales (Heading 1 is 2x body) are compressed so a heading still
 * fits a tile: the size grows by `strength` of the way to its real scale.
 */
export function previewLook(p: RibbonPreview | undefined, strength: number): PreviewLook {
  const scale = p?.fontScale ?? 1
  return {
    fontSizeEm: Math.round((1 + (scale - 1) * strength) * 1000) / 1000,
    fontWeight: p?.weight ?? 400,
    italic: !!p?.italic,
    mono: !!p?.mono,
  }
}

/** Clamp to [min, max]; a non-finite number gives null (the input keeps its old value). */
export function clampNumber(n: number, min: number, max: number): number | null {
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

/** The slice of an element rovingOwner needs (so it is testable without a DOM). */
export interface RovingNode {
  hasAttribute(name: string): boolean
  parentElement: RovingNode | null
}

/**
 * The element a roving/popover key event belongs to: walking up from `target`,
 * the first node carrying one of `attrs` ("data-rv", "data-pop"). Adapter
 * territory ends the walk: a node inside `[data-adapter-slot]` / `[data-adapter]`
 * that does not carry the attribute itself is NOT part of the roving set, even
 * when a roving control encloses it (adapter-injected buttons opt in with
 * data-rv). Returns null for "not ours: leave the key alone".
 */
export function rovingOwner<T extends RovingNode>(target: T | null, attrs: readonly string[] = ['data-rv']): T | null {
  for (let el: RovingNode | null = target; el; el = el.parentElement) {
    if (attrs.some((a) => el!.hasAttribute(a))) return el as T
    if (el.hasAttribute('data-adapter-slot') || el.hasAttribute('data-adapter')) return null
  }
  return null
}
