// What the media's settings mean in the picture (the `settings` of style/media/*.ts).
//
// Written from the media themselves: the colour fitting (chroma, contrast and the
// chroma cap) is what each medium's colour() does with a theme colour; the grain
// settings are the numbers each medium hands the stroke engine in its GrainSpec.

import type { Meanings } from '../types'

export const MEDIA_MEANINGS: Meanings = {
  'media.ink.chroma': {
    meaning:
      "How much of the theme colour's strength an ink keeps, as a multiplier (0 to 1.5, default 0.9). 0 turns every ink to a neutral black-grey; 1 keeps the theme colour's own chroma; above 1 is a more vivid ink than the theme gave. The ink is then darkened or lightened until it keeps its contrast with the paper, so strong colour never costs legibility.",
    unit: '×',
    interactions: ['media.ink.contrast'],
  },
  'media.ink.contrast': {
    meaning:
      "The contrast an ink must keep with the paper, measured on a stroke as drawn (4.5 to 15, default 7, the strictest common legibility bar). Higher pushes the ink toward the deepest black on a light paper (the brightest on a dark one): denser, more dramatic ink. 4.5 allows a mid-dark, lighter ink. A colour that already meets the bar is left where it is.",
    unit: ': 1',
    interactions: ['media.ink.chroma'],
  },
  'media.ink.edge': {
    meaning:
      "How much an ink stroke's edge softens where it meets rough paper (0 to 0.5, default 0.15): the ink bleeds a little into the tooth, so a line on rough paper has a slightly soft edge while on smooth paper it stays crisp. This is the only grain an ink has; the ink line itself never has speckle, pinholes or dry brush.",
    interactions: ['style.paper.texture'],
  },

  'media.graphite.hint': {
    meaning:
      "How much colour a graphite grey may carry, as a cap on chroma (0 to 0.05, default 0.02). 0 is a dead neutral grey; at 0.02 a red role comes out a warm grey and a blue one a cool grey; at 0.05 the grey starts to read as tinted. Graphite is never saturated, whatever the theme colour. The grey is then fitted so a stroke keeps legible contrast with the paper.",
    unit: 'chroma',
    interactions: [],
  },
  'media.graphite.grain': {
    meaning:
      "How much the graphite speckles: dusty grains inside and along the stroke (0 to 1, default 0.2). 0 is a smooth, soft pencil; 1 a dry, dusty line like a hard pencil on rough paper. This is separate from the tooth of the paper, which makes graphite skip strongly (half skipped) whatever this is set to.",
    interactions: [],
  },

  'media.colouredPencil.chroma': {
    meaning:
      "How much of the theme colour's strength a coloured pencil keeps, as a multiplier (0 to 1.2, default 0.8): a waxy, slightly desaturated version of the theme colour. 0 is a grey pencil, 1 the theme colour's own strength, above 1 more vivid. The pencil is also held a little lighter than ink (a twentieth of lightness toward the paper), so it reads paler, then fitted so a stroke stays legible against the paper.",
    unit: '×',
    interactions: [],
  },

  'media.marker.streaks': {
    meaning:
      "How much lighter and darker lines run along a marker stroke (0 to 1, default 0.4): the felt tip laying its ink unevenly. 0 is an even, flat tone; 1 is strongly streaked. This is the only grain a marker has; its colour stays saturated and mid-lightness whatever this is.",
    interactions: [],
  },

  'media.chalk.chroma': {
    meaning:
      "How much of the theme colour's strength chalk keeps, as a multiplier (0.5 to 0.7, default 0.6). Chalk is always a light, dusty version of its colour, so a red comes out a pastel chalk red. Lower is a paler, greyer chalk; higher is a more vivid pastel, within the narrow range chalk allows.",
    unit: '×',
    interactions: [],
  },

  'media.whiteboard.dry': {
    meaning:
      "How often a whiteboard marker runs dry (0 to 1, default 0.3): the white board showing through a stroke where the ink has run out. 0 is a fresh marker laying solid ink; 1 is a nearly dead one that skips along the stroke. The streaks inside the ink stay the same either way.",
    interactions: [],
  },
}
