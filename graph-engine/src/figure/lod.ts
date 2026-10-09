// Level of detail while the view moves.
//
// A hatch or cross-hatch fill is dozens of thin translucent slivers, and
// re-drawing them is what makes a zoom stutter (measured in Chrome: thinning
// them to a third removes every frame over 50 ms). So while the view moves, a
// group of many marks shows only every `THIN_EVERY`th of them, and all of them
// are back when the view settles. This only decides which marks; the view marks
// them (FigureView.tsx) and CSS hides them (FigureView.css).

// A group of fewer marks than this is not shading (a flat fill is one mark, an
// edge a handful): it is left whole.
export const THIN_MIN_MARKS = 6
// Show one mark in this many while moving.
export const THIN_EVERY = 3

// Which marks of a group of `count` are hidden while moving.
export function thinnedIndices(count: number): number[] {
  const out: number[] = []
  if (count < THIN_MIN_MARKS) return out
  for (let i = 0; i < count; i++) if (i % THIN_EVERY !== 0) out.push(i)
  return out
}
