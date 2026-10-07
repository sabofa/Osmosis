// What the media's settings mean in the picture (the `settings` of style/media/*.ts).
//
// Written from the media themselves: the colour fitting (chroma, contrast and the
// chroma cap) is what each medium's colour() does with a theme colour; the grain
// settings are the numbers each medium hands the stroke engine in its GrainSpec.
//
// The COLOUR of a medium is drawn: the figure pens (figure/styledPen.ts) colour every role
// from it, so the settings that move a colour (ink's chroma and contrast, graphite's hint,
// coloured pencil's and chalk's chroma) say what they do. The GRAIN of a medium (the paper's
// tooth showing through a stroke: a soft edge, speckle, streaks, running dry) is not read by
// any renderer yet, so those four still open with "Not drawn yet:" and say what the setting
// WILL do, and the list in registry.test.ts holds them. The graph and the space engine do not
// read a medium yet either.

import type { Meanings } from '../types'

export const MEDIA_MEANINGS: Meanings = {
  'media.ink.chroma': {
    meaning:
      "How much of the theme colour's strength an ink keeps, as a multiplier. 0 turns every ink to a neutral black-grey; 1 keeps the theme colour's own chroma; above 1 is a more vivid ink than the theme gave, as far as the colours can go. The ink is then darkened or lightened until it keeps its contrast with the paper, so strong colour never costs legibility.",
    interactions: ['media.ink.contrast'],
  },
  'media.ink.contrast': {
    meaning:
      'The contrast an ink keeps with the paper, measured on a stroke as drawn. Higher pushes the ink toward the deepest black on a light paper (the brightest on a dark one): denser, more dramatic ink; the lowest values allow a mid-dark, lighter ink. A colour that already meets the bar is left where it is.',
    interactions: ['media.ink.chroma'],
  },
  'media.ink.edge': {
    meaning:
      "Not drawn yet: how much an ink stroke's edge will soften where it meets rough paper. 0 is crisp even on rough paper; larger lets the ink bleed a little into the tooth, so a line on rough paper has a slightly soft edge while on smooth paper it stays crisp. This is the only grain an ink has; the ink line itself never has speckle, pinholes or dry brush.",
    interactions: ['style.paper.texture'],
  },

  'media.graphite.hint': {
    meaning:
      'How much colour a graphite grey is allowed to carry, as a cap on chroma. 0 is a dead neutral grey; a little leaves a red role a warm grey and a blue one a cool grey; at the top of the range the grey starts to read as tinted rather than grey. Graphite is never saturated, whatever the theme colour. The grey is then fitted so a stroke keeps legible contrast with the paper.',
    interactions: [],
  },
  'media.graphite.grain': {
    meaning:
      "Not drawn yet: how much the graphite will speckle, as dusty grains inside and along the stroke. 0 is a smooth, soft pencil; the top of the range is a dry, dusty line like a hard pencil on rough paper. This is separate from the paper's tooth, which makes graphite skip strongly (about half skipped) whatever this is set to.",
    interactions: [],
  },

  'media.colouredPencil.chroma': {
    meaning:
      "How much of the theme colour's strength a coloured pencil keeps, as a multiplier: a waxy, slightly desaturated version of the theme colour. 0 is a grey pencil, 1 the theme colour's own strength, above 1 more vivid. The pencil is also held a little lighter than ink (a twentieth of lightness toward the paper), so it reads paler, then fitted so a stroke stays legible against the paper.",
    interactions: [],
  },

  'media.marker.streaks': {
    meaning:
      'Not drawn yet: how much lighter and darker lines will run along a marker stroke, the felt tip laying its ink unevenly. 0 is an even, flat tone; the top of the range is strongly streaked. This is the only grain a marker has; its colour stays saturated and mid-lightness whatever this is.',
    interactions: [],
  },

  'media.chalk.chroma': {
    meaning:
      "How much of the theme colour's strength chalk keeps, as a multiplier within a narrow range. Chalk is always a light, dusty version of its colour, so a red comes out a pastel chalk red. Lower is a paler, greyer chalk; higher is a more vivid pastel, within the narrow range chalk allows.",
    interactions: [],
  },

  'media.whiteboard.dry': {
    meaning:
      'Not drawn yet: how often a whiteboard marker will run dry, the white board showing through a stroke where the ink has run out. 0 is a fresh marker laying solid ink; the top of the range is a nearly dead one that skips along the stroke. The streaks inside the ink stay the same either way.',
    interactions: [],
  },
}
