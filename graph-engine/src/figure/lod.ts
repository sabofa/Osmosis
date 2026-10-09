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

// When the view settles the hidden marks come back, but not all in one frame:
// drawing them all at once is itself a hitch. They return in this many batches,
// a frame apart.
export const RESTORE_BATCHES = 4

// The marks (by position in the skipped list of `count`) that return in each
// batch: `restoreBatches(10)` is [[0,1,2],[3,4,5],[6,7,8],[9]].
export function restoreBatches(count: number): number[][] {
  const size = Math.ceil(count / RESTORE_BATCHES)
  const out: number[][] = []
  for (let from = 0; from < count; from += size) {
    out.push(Array.from({ length: Math.min(size, count - from) }, (_, i) => from + i))
  }
  return out
}
