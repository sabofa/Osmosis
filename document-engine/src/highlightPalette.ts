export interface HighlightColor {
  id: string
  label: string
}

// A fixed small palette rather than an arbitrary color picker — keeps the
// CSS Custom Highlight API registration bounded (one `::highlight()` rule
// per color, generated from the tokens: see tokenVars.highlightCss).
// Colours come from the theme: entry i uses tokens.colors.highlight[i].
export const HIGHLIGHT_PALETTE: HighlightColor[] = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'pink', label: 'Pink' },
  { id: 'blue', label: 'Blue' },
]

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_PALETTE[0].id

export function colorById(id: string | undefined): HighlightColor {
  return HIGHLIGHT_PALETTE.find((c) => c.id === id) ?? HIGHLIGHT_PALETTE[0]
}
