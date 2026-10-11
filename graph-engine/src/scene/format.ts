// Shared 2-decimal display formatter for on-screen coordinates/magnitudes
// (hover readout, regression stats, vector labels) — distinct from
// buildTable.ts's formatNumber, which rounds to 4 decimals and has its own
// Infinity/NaN handling for table cells.
export function formatCoord(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// Digits that match the zoom: enough decimals that one screen pixel (about
// span / 1000) is resolved, never fewer than formatCoord's two (so the default
// view prints exactly what it always did), at most 15. Trailing zeros are
// trimmed like formatCoord's. Chosen over view2d/readout.ts (fixed 3
// decimals, would change default outputs) and plot/frame/labels.ts (formats
// tick values against a step, not free coordinates).
export function formatForSpan(value: number, span: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(span) || span <= 0) return formatCoord(value)
  const decimals = Math.min(15, Math.ceil(-Math.log10(span / 1000)))
  if (decimals <= 2) return formatCoord(value)
  const text = value.toFixed(decimals).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}
