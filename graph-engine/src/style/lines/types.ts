import type { Random } from '../random'
import type { Chain, Piece } from '../path'
import type { LineSettings, Point } from '../tokens'

// The contract every line type keeps.
//
// A line type takes ONE abstract stroke — a chain in drawing coordinates —
// with the width the renderer asked for (already scaled by the style's
// `width`), the line settings, and a random source seeded by the stroke's
// identity. It returns drawing PRIMITIVES, and nothing about SVG, layers or
// colour: the pen that called it decides those.
//
// The rules every line type honours (tests in lines.test.ts):
//   - deterministic: the same input and random source give the same output;
//   - faithful at looseness 0: the output reaches both true ends exactly, and
//     nothing strays more than half a stroke width from the true geometry —
//     so an arc stays on its circle and nothing overshoots;
//   - looseness only ever ADDS deviation on top of that.

export interface StrokeInput {
  chain: Chain
  width: number
  settings: LineSettings
  random: Random
  // The sample spacing, when the caller wants coarser detail than the line
  // type's own (hand.ts's sampleStep): shading lines, which are many, long
  // and straight, are drawn with fewer samples to keep a figure's markup small.
  step?: number
  // The caller's line cap, for a line type that keeps the caller's ends
  // (technical); the sketchy types choose their own.
  cap?: 'round' | 'butt' | 'square'
  // A dash pattern, given only to a line type that dashes natively
  // (LineType.nativeDash); every other type is handed its dashes one by one.
  dash?: readonly number[]
}

export type Primitive =
  // A stroked path: a start point and pieces (lines, exact arcs, or smooth
  // cubics through samples), drawn with a pen of `width`.
  | {
      kind: 'stroke'
      start: Point
      pieces: Piece[]
      width: number
      opacity: number
      // Absent: the renderer's default (butt).
      cap?: 'round' | 'butt' | 'square'
      // Round joins for a hand-drawn line; absent keeps the default.
      join?: 'round'
      // A native dash pattern (technical).
      dash?: readonly number[]
      // The path closes on its start (a loop at looseness 0): no ends.
      closed?: boolean
      // Overlaps darken, as felt-tip ink does where two strokes cross.
      blend?: 'multiply'
    }
  // A filled outline: a stroke drawn as its own shape, which is how a line
  // whose width changes along its length is drawn. `spine` is the centre
  // line it was built around.
  | { kind: 'shape'; outline: Point[]; spine: Point[]; opacity: number }
  // Filled dots: a blot of ink, chalk dust.
  | { kind: 'dots'; dots: { at: Point; r: number }[]; opacity: number }

// A texture is an effect laid over everything drawn in the line type — grain
// broken into graphite, dust into chalk. Texture only: it changes how ink
// covers the page, never where the lines are. `strength` is 0 to 1.
export interface Texture {
  // grain and chalk belong to line types; wash (an uneven tint),
  // mottle (flat's fainter cousin) and soften (a blur for a wash's pooled
  // edge) to the fills.
  name: 'grain' | 'chalk' | 'wash' | 'mottle' | 'soften'
  strength: number
}

export interface LineType {
  draw(input: StrokeInput): Primitive[]
  texture(settings: LineSettings): Texture | null
  // Whether it dashes itself from a pattern (StrokeInput.dash) rather than
  // being handed each dash as its own stroke.
  nativeDash?: boolean
}
