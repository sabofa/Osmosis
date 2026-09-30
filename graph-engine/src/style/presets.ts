import type { Look } from './tokens'

// The named looks. Each is COMPLETE — a value for every setting in every
// group — so "@style: pencil" means the same drawing wherever it is written.
//
// The numbers are a first guess, to be judged by eye in the style lab
// (review/style-lab.html). They follow the design's table where it speaks;
// the rest are this file's own calls, noted beside each.

export const PRESET_NAMES = ['clean', 'ink', 'pencil', 'marker'] as const
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
    colour: { ink: 'theme', saturation: 1 },
  },

  // A fountain pen on good paper. Blue-black ink; two passes available, of
  // which the ink line uses the second only now and then (its "occasional
  // doubling"). Hatching at a pen's spacing. Grain 0.55 (raised from the
  // first pass's 0.1, Ben's "rough ink brush" note): ragged edges and a dry,
  // splitting tail, not just a soft bled edge.
  ink: {
    line: { type: 'ink', looseness: 0.25, wobble: 0.3, passes: 2, width: 1, variation: 0.4, taper: 0.3, grain: 0.55, opacity: 1 },
    fill: { type: 'hatch', angle: 45, spacing: 8, opacity: 0.65, roughness: 0.35 },
    paper: { type: 'paper', tint: '#fbf8f0', texture: 0.45, grid: 24 },
    lettering: { face: 'math', size: 1.05, tilt: 0 },
    colour: { ink: '#1f2a44', saturation: 0.9 },
  },

  // Graphite on rough paper, lettered by hand: two soft passes, a little
  // heavier than the base weight (each pass is thinner than the line and
  // translucent, so two of them at 1.25 still read lighter than ink), in a
  // near-black graphite muted to grey.
  pencil: {
    line: { type: 'pencil', looseness: 0.3, wobble: 0.35, passes: 2, width: 1.25, variation: 0.3, taper: 0.4, grain: 0.6, opacity: 0.85 },
    fill: { type: 'hatch', angle: 55, spacing: 6.5, opacity: 0.9, roughness: 0.45 },
    paper: { type: 'rough-paper', tint: '#f6f3ec', texture: 0.6, grid: 24 },
    lettering: { face: 'hand', size: 1.2, tilt: 0.5 },
    colour: { ink: '#232327', saturation: 0.4 },
  },

  // A felt-tip on a ruled notebook page: blue marker, scribbled shading,
  // hand lettering a size up (markers write big).
  marker: {
    line: { type: 'marker', looseness: 0.2, wobble: 0.15, passes: 1, width: 1.8, variation: 0.2, taper: 0, grain: 0.1, opacity: 0.85 },
    fill: { type: 'scribble', angle: 35, spacing: 9, opacity: 0.45, roughness: 0.6 },
    paper: { type: 'ruled', tint: '#fdfdf8', texture: 0.2, grid: 26 },
    lettering: { face: 'hand', size: 1.25, tilt: 0.4 },
    colour: { ink: '#1b3f8f', saturation: 1.1 },
  },
}

export function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name)
}
