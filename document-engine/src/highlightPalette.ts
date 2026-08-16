export interface HighlightColor {
  id: string
  label: string
  light: string
  dark: string
}

// A fixed small palette rather than an arbitrary color picker — keeps the
// CSS Custom Highlight API registration bounded (one `::highlight()` rule
// per color, declared statically in DocumentViewer.css) instead of needing
// to inject a rule per unique color a user might pick.
export const HIGHLIGHT_PALETTE: HighlightColor[] = [
  { id: 'yellow', label: 'Yellow', light: '#f4d35e', dark: '#8a6d1a' },
  { id: 'green', label: 'Green', light: '#a8d4a0', dark: '#3f6b3a' },
  { id: 'pink', label: 'Pink', light: '#f0a8c0', dark: '#7a3552' },
  { id: 'blue', label: 'Blue', light: '#9ec5e8', dark: '#2d5a7a' },
]

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_PALETTE[0].id

export function colorById(id: string | undefined): HighlightColor {
  return HIGHLIGHT_PALETTE.find((c) => c.id === id) ?? HIGHLIGHT_PALETTE[0]
}
