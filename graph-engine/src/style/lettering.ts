import type { Random } from './random'
import type { LetteringFace } from './tokens'

// Lettering: the face labels are set in, and the slight tilt of a hand.
//
// Each face is a font STACK with fallbacks, ending in a generic family, so a
// page that has not loaded the web font degrades to a system serif, sans or
// script — never to nothing. The engine loads no fonts itself; the review
// harness pages (the style lab, the contact sheet) load Caveat and STIX Two
// Text from Google Fonts.
//
// Labels are never MOVED by a style: a tilt is a rotation about the label's
// own anchor, and a size is a scale about it. What the label layout placed
// stays placed.

export const FACES: Record<LetteringFace, string> = {
  // A clean serif for mathematics.
  math: "'STIX Two Text', 'Cambria Math', Cambria, 'Latin Modern Roman', 'Times New Roman', serif",
  // A clean sans: exactly the stack clean figures are lettered in.
  textbook: 'ui-sans-serif, system-ui, sans-serif',
  // Handwriting.
  hand: "Caveat, 'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive",
}

// The most a label is ever turned, at tilt 1.
export const MAX_TILT_DEGREES = 4

// A label's tilt in degrees: seeded (by the label's identity, through
// `random`), anywhere in ±4° × tilt.
export function tiltFor(tilt: number, random: Random): number {
  if (tilt <= 0) return 0
  return random.range(-1, 1) * MAX_TILT_DEGREES * Math.min(1, tilt)
}
