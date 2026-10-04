// How the 2D view prints numbers: the coordinate readout, the zoom badge and
// the value an `@focus:` line is written back as. One place, so the readout
// and the directive never disagree about how a number looks.

// Up to three decimals, trailing zeros trimmed, and never "-0": a coordinate
// that rounds to nothing is 0, not a minus sign in front of a nothing.
export function formatCoordinate(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const s = n.toFixed(3).replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

export function formatPoint(values: readonly number[]): string {
  return `(${values.map(formatCoordinate).join(', ')})`
}

// Three significant figures, trimmed: "4×", "0.25×", "12.5×". Number() of the
// rounded value drops the zeros toPrecision pads on, and keeps a large zoom
// out of exponent form until it genuinely needs it.
export function formatZoom(zoom: number): string {
  return `${Number(zoom.toPrecision(3))}×`
}
