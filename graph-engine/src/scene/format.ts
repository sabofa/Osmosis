// Shared 2-decimal display formatter for on-screen coordinates/magnitudes
// (hover readout, regression stats, vector labels) — distinct from
// buildTable.ts's formatNumber, which rounds to 4 decimals and has its own
// Infinity/NaN handling for table cells.
export function formatCoord(n: number): string {
  return String(Math.round(n * 100) / 100)
}
