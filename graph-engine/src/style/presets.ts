import type { Look } from './tokens'

// The named looks. Each is COMPLETE — a value for every setting in every
// group — so "@style: pencil" means the same drawing wherever it is written.
//
// The numbers are a first guess, to be judged by eye in the style lab
// (review/style-lab.html). They follow the design's table where it speaks;
// the rest are this file's own calls, noted beside each.
//
// A look's COLOURS are its medium's (style/media/): the ink, pencil and marker follow the
// theme (colour.ink and paper.tint are "theme"), and the medium fits each role's colour to the
// theme's paper. A board look (blackboard, greenboard, whiteboard) brings its own surface.
//
// A medium also says how strongly it lays a stroke (its opacity), and that REPLACES the line
// type's own factor (style/lines/types.ts, `strength`); `line.opacity` multiplies on top, as the
// author's own dial. So the four looks that came with their medium (coloured pencil and the three
// boards) leave it at 1, and the medium's contrast floors hold for what they draw. The ink,
// pencil and marker keep the opacity they were given before there were media (pencil and marker
// 0.85): that is the look's own choice to be lighter than its medium, and no floor is promised below it.

export const PRESET_NAMES = ['clean', 'ink', 'pencil', 'marker', 'colouredPencil', 'blackboard', 'greenboard', 'whiteboard'] as const
export type PresetName = (typeof PRESET_NAMES)[number]

export const PRESETS: Record<PresetName, Look> = {
  // Today's figure, byte for byte: the renderer draws this look through its
  // clean pen, straight to the existing emitters, and none of the numbers
  // below are read. They are what the lab shows as clean's settings, and the
  // point every other look is measured from.
  //
  // Lettering is "textbook", not the design table's "math": clean is today's
  // output, and today's labels are set in a sans, which is textbook's stack.
  // Fill opacity 0.44: a styled pen lays a solid area at half the fill
  // opacity, so a flat fill in a styled figure is today's REGION_OPACITY,
  // 0.22 — the same backdrop.
  clean: {
    line: { type: 'technical', looseness: 0, wobble: 0, passes: 1, width: 1, variation: 0, taper: 0, grain: 0, opacity: 1 },
    fill: { type: 'flat', angle: 45, spacing: 9, opacity: 0.44, roughness: 0 },
    paper: { type: 'clean', tint: 'theme', texture: 0, grid: 24 },
    lettering: { face: 'textbook', size: 1, tilt: 0 },
    colour: { ink: 'theme', saturation: 1, medium: 'clean' },
  },

  // A brush pen on good paper, in blue-black ink. The line is solid and
  // lives in its width (Ben's reference, 2026-09-30: "the pen should not
  // have grain, it should have variance"): strong pressure variation, fine
  // tapered ends, slightly bumpy edges. Grain is not read by ink. Hatching
  // at a pen's spacing, a little loose.
  ink: {
    line: { type: 'ink', looseness: 0.25, wobble: 0.3, passes: 1, width: 1.7, variation: 0.75, taper: 0.8, grain: 0, opacity: 1 },
    fill: { type: 'hatch', angle: 45, spacing: 8, opacity: 0.65, roughness: 0.45 },
    paper: { type: 'paper', tint: 'theme', texture: 0.45, grid: 24 },
    lettering: { face: 'math', size: 1.05, tilt: 0 },
    colour: { ink: 'theme', saturation: 0.9, medium: 'ink' },
  },

  // Graphite on rough paper, lettered by hand: two soft passes, a little
  // heavier than the base weight (each pass is thinner than the line and
  // translucent, so two of them at 1.25 still read lighter than ink), in the
  // greys of graphite (a hint of each role's hue, never saturated).
  pencil: {
    line: { type: 'pencil', looseness: 0.3, wobble: 0.35, passes: 2, width: 1.25, variation: 0.3, taper: 0.4, grain: 0.6, opacity: 0.85 },
    fill: { type: 'hatch', angle: 55, spacing: 6.5, opacity: 0.9, roughness: 0.5 },
    paper: { type: 'rough-paper', tint: 'theme', texture: 0.6, grid: 24 },
    lettering: { face: 'hand', size: 1.2, tilt: 0.5 },
    colour: { ink: 'theme', saturation: 0.4, medium: 'graphite' },
  },

  // A felt-tip on a ruled notebook page: saturated marker, scribbled shading,
  // hand lettering a size up (markers write big).
  marker: {
    line: { type: 'marker', looseness: 0.2, wobble: 0.15, passes: 1, width: 1.8, variation: 0.2, taper: 0, grain: 0.1, opacity: 0.85 },
    fill: { type: 'scribble', angle: 35, spacing: 9, opacity: 0.45, roughness: 0.6 },
    paper: { type: 'ruled', tint: 'theme', texture: 0.2, grid: 26 },
    lettering: { face: 'hand', size: 1.25, tilt: 0.4 },
    colour: { ink: 'theme', saturation: 1.1, medium: 'marker' },
  },

  // Coloured pencil on good paper: the pencil line, a little lighter and less
  // dusty than graphite (the wax fills the tooth), layered hatching in the
  // role's own colour, lettered by hand. The colours are the theme's, slightly
  // desaturated and held light (the colouredPencil medium).
  colouredPencil: {
    line: { type: 'pencil', looseness: 0.3, wobble: 0.3, passes: 2, width: 1.2, variation: 0.3, taper: 0.4, grain: 0.45, opacity: 1 },
    fill: { type: 'hatch', angle: 50, spacing: 5.5, opacity: 0.9, roughness: 0.5 },
    paper: { type: 'paper', tint: 'theme', texture: 0.5, grid: 24 },
    lettering: { face: 'hand', size: 1.15, tilt: 0.5 },
    colour: { ink: 'theme', saturation: 1, medium: 'colouredPencil' },
  },

  // Chalk on a blackboard: broken, dusty lines in pastel chalk, the side of
  // the chalk for shading (a scribble), chalk lettering a size up. Everything
  // drawn is chalk, an author's own colours too (the chalk medium), on the
  // board whatever the app's light or dark.
  blackboard: {
    line: { type: 'chalk', looseness: 0.3, wobble: 0.3, passes: 1, width: 1.7, variation: 0.3, taper: 0.2, grain: 0.7, opacity: 1 },
    fill: { type: 'scribble', angle: 40, spacing: 9, opacity: 0.5, roughness: 0.6 },
    paper: { type: 'blackboard', tint: 'theme', texture: 0.5, grid: 24 },
    lettering: { face: 'hand', size: 1.3, tilt: 0.4 },
    colour: { ink: 'theme', saturation: 1, medium: 'chalk' },
  },

  // The blackboard's look on a green board (the same chalk: it keeps its
  // contrast against both).
  greenboard: {
    line: { type: 'chalk', looseness: 0.3, wobble: 0.3, passes: 1, width: 1.7, variation: 0.3, taper: 0.2, grain: 0.7, opacity: 1 },
    fill: { type: 'scribble', angle: 40, spacing: 9, opacity: 0.5, roughness: 0.6 },
    paper: { type: 'greenboard', tint: 'theme', texture: 0.5, grid: 24 },
    lettering: { face: 'hand', size: 1.3, tilt: 0.4 },
    colour: { ink: 'theme', saturation: 1, medium: 'chalk' },
  },

  // A dry-erase marker on a whiteboard. Until the whiteboard brushes arrive (a
  // chisel-tip outline and a back-and-forth fill-in), the marker line and the
  // scribble stand in for them (the design's named placeholders).
  whiteboard: {
    line: { type: 'marker', looseness: 0.2, wobble: 0.15, passes: 1, width: 1.8, variation: 0.25, taper: 0, grain: 0.1, opacity: 1 },
    fill: { type: 'scribble', angle: 35, spacing: 9, opacity: 0.45, roughness: 0.6 },
    paper: { type: 'whiteboard', tint: 'theme', texture: 0.3, grid: 24 },
    lettering: { face: 'hand', size: 1.25, tilt: 0.4 },
    colour: { ink: 'theme', saturation: 1, medium: 'whiteboard' },
  },
}

export function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name)
}
