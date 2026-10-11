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

/** Narrow row: the first `capacity` controls stay in the row, the rest overflow. */
export function overflowSplit<T>(items: readonly T[], capacity: number): { shown: T[]; overflow: T[] } {
  const cap = Math.max(0, Math.floor(capacity))
  if (items.length <= cap) return { shown: [...items], overflow: [] }
  // The overflow button takes one slot of its own.
  const keep = Math.max(0, cap - 1)
  return { shown: items.slice(0, keep), overflow: items.slice(keep) }
}

/** Container width under which the ribbon collapses to one icon row. */
export const NARROW_BELOW = 640

export function isNarrow(width: number): boolean {
  return width > 0 && width < NARROW_BELOW
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
