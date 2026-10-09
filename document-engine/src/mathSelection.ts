export interface SourceRange {
  start: number
  end: number
}

// A selection that begins or ends inside a rendered math node covers that
// node's whole TeX source (the rendered glyphs have no 1:1 mapping to source
// characters). Ranges are raw-source offsets; math ranges are the TeX bodies.
export function snapRangeToMath(range: SourceRange, math: SourceRange[]): SourceRange {
  let { start, end } = range
  for (const m of math) {
    if (start > m.start && start < m.end) start = m.start
    if (end > m.start && end < m.end) end = m.end
  }
  return { start, end }
}
