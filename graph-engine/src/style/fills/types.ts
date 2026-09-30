import type { Random } from '../random'
import type { Chain } from '../path'
import type { FillSettings, Point } from '../tokens'

// The contract every fill keeps.
//
// A fill takes a REGION — its outline as closed chains in drawing
// coordinates, outer loops and holes alike (the even-odd rule decides what is
// inside) — with the fill settings and a random source seeded by the
// region's identity, and returns MARKS. The pen that called it draws them:
// line marks in the current line type, everything clipped to the region's
// exact outline. Nothing here knows about SVG or colour.

export interface FillInput {
  outline: Chain[]
  settings: FillSettings
  random: Random
}

export type FillMark =
  // The region itself, filled; `texture` makes it uneven (a wash).
  | { kind: 'area'; texture?: 'wash' }
  // Lines to draw in the current line type: hatching, a scribble.
  | { kind: 'lines'; chains: Chain[] }
  // Dots: stipple. Every centre is inside the region.
  | { kind: 'dots'; dots: { at: Point; r: number }[] }
  // The region's own outline, drawn wide and soft and clipped to the inside,
  // so the fill darkens toward its edge (a wash's pooled pigment).
  | { kind: 'edge'; width: number; opacity: number }

export interface FillType {
  draw(input: FillInput): { marks: FillMark[] }
}
