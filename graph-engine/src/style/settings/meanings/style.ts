// What the figure styles' settings mean in the picture (the TOKENS of style/tokens.ts).
//
// Each entry was written by reading the code that consumes the setting:
// style/lines/*.ts, style/fills/*.ts, style/papers/*.ts, style/lettering.ts,
// style/color.ts and figure/styledPen.ts. They say what changes on the page, in
// a painter's terms (value, edge, stroke, colour, roughness, grain), which way is
// stronger, and which pens or fills ignore the setting altogether.

import type { Meanings } from '../types'

export const STYLE_MEANINGS: Meanings = {
  'style.line.type': {
    meaning:
      "Which pen draws every line of the figure. technical is the draughtsman's ruled line, even in width, exact arcs, nothing wavers. ink is a brush pen: solid, swelling and thinning with pressure, tapering to fine points, and never grainy. brush is a broad calligraphic nib held at a fixed angle, thick across the nib and thin along it. pencil is two or three light graphite passes, broken by the paper's tooth. marker is a thick, round-ended, see-through felt tip that doubles up where strokes cross and pools at its ends. chalk skips in broken runs with dusty edges and loose specks. The type decides which of the other line settings the pen reads at all.",
    interactions: ['style.line.looseness', 'style.line.passes', 'style.line.variation', 'style.line.taper', 'style.line.grain'],
  },
  'style.line.looseness': {
    meaning:
      "How far a stroke strays from the true geometry, like a hand that does not quite land on its marks: each end lands off its point, runs past it or stops short, and the whole stroke bows. At 0 every stroke starts and ends exactly on its true endpoints; at 1 the ends miss by about a stroke width or more and a long line bows by up to a few percent of its length. It also lets the wobble swing far wider, and makes a technical line overshoot its corners the way a ruled line does.",
    interactions: ['style.line.wobble', 'style.line.width'],
  },
  'style.line.wobble': {
    meaning:
      "The small, quick waviness along a stroke, a nervous hand. With the hand tight (looseness 0) it is held to a fraction of a stroke width and pinned to nothing at both ends; turning looseness up lets it swing several times wider and run right out to the ends. A pen wavers slowly and pencil and chalk quickly. The technical pen ignores it completely.",
    interactions: ['style.line.looseness', 'style.line.width'],
  },
  'style.line.passes': {
    meaning:
      "How many times a stroke is drawn over itself. Only pencil reads it: each pass is a thin, translucent line laid a little to one side of the last, so two or three passes build a darker, sketchier line where they overlap, with the offset growing as the hand loosens. Every other pen draws one pass whatever this says, and so does shading drawn in any pen.",
    interactions: ['style.line.type', 'style.line.opacity', 'style.line.looseness'],
  },
  'style.line.width': {
    meaning:
      "A multiplier on every stroke weight the figure asks for, so 1 is the figure's own weight. Hatch and scribble lines are drawn at 1.1 times it, and the dashes of a hidden line grow with it (above 1) so that a thick marker line still reads as dashes. Everything the hand does, the end misses and the wobble, scales with it.",
    unit: '×',
    interactions: ['style.line.looseness', 'style.line.wobble', 'style.line.opacity'],
  },
  'style.line.variation': {
    meaning:
      "How much the width swells and thins along one stroke, like changing pressure on the pen. 0 is an even ribbon. Ink swings its width by up to three quarters either way at 1 (the thinnest neck a quarter of the base) and gives both edges small bumps and nicks. Brush swells less (about a third). Pencil varies the thickness of each pass a little, and marker varies its thickness and how much ink pools at the ends. Technical and chalk ignore it.",
    interactions: ['style.line.taper', 'style.line.type'],
  },
  'style.line.taper': {
    meaning:
      "How much the ends of a stroke thin out, the way a brush lands and lifts. Ink thins the first and last third of a stroke (never more than fourteen widths of it) toward a fine point, down to 4% of full width at 1. Brush uses it for the shape of the points, from nearly full width almost to the very ends at 0 to a sharp lens shape at 1. A closed loop has no ends to taper. The other pens ignore it.",
    interactions: ['style.line.variation', 'style.line.type'],
  },
  'style.line.grain': {
    meaning:
      "Texture broken into the line: the paper's tooth in graphite and the dust in chalk. Pencil knocks more specks out of every pass as it rises, so the line looks drier and greyer. Chalk scatters more loose dust specks within the line's width and breaks its edge up more. Ink ignores it by design (an ink line has variance, never grain), and so do the technical, brush and marker pens. Hatching drawn in the style gets 30% of it, so a region of chalk hatching is not mostly dust.",
    interactions: ['style.line.type'],
  },
  'style.line.opacity': {
    meaning:
      "How opaque one stroke is, from faint to solid. Each pen multiplies it by its own factor first (a pencil pass about 0.8 to 0.95, marker 0.82, chalk 0.85), so 1 is the pen's natural strength and not full black. Strokes that overlap add up beneath it. It also lightens hatch and scribble lines, which are drawn in the same pen.",
    interactions: ['style.line.passes', 'style.fill.opacity'],
  },

  'style.fill.type': {
    meaning:
      "How the inside of a region is shaded. flat is one even tint. hatch is parallel lines at the fill angle, drawn in the figure's pen. crosshatch is two hatch families a quarter turn apart, denser and darker at the same spacing. stipple is dots, the engraver's way. scribble is one continuous back-and-forth pen zigzag, the way a hand fills a shape without lifting. wash is watercolour: a soft uneven tint that pools darker at its edge. none leaves the region bare, though its outline is still drawn.",
    interactions: ['style.fill.angle', 'style.fill.spacing', 'style.fill.opacity', 'style.fill.roughness'],
  },
  'style.fill.angle': {
    meaning:
      "The direction of hatch and scribble lines, in degrees anticlockwise from horizontal (a small positive angle rises from lower left to upper right). Crosshatch lays its second family a quarter turn further round. Flat, stipple, wash and none have no direction and ignore it. At roughness 0 hatching is anchored to the page, so two regions that touch hatch as one set of lines at the same angle. Above 0, each line leans off the angle a little, the family is no longer anchored, and a scribble drifts across the region.",
    unit: '°',
    interactions: ['style.fill.type', 'style.fill.roughness'],
  },
  'style.fill.spacing': {
    meaning:
      "The gap between hatch or scribble lines or stipple dots, in drawing units (a figure is fitted into 640 of them). Smaller packs the marks tighter, so the shading reads darker; larger opens it out, lighter. A large region caps how much shading it will hold and opens the spacing out to fit, so on a big region very small values stop getting darker. It also sets how wide a wash's darker rim is (0.7 times the spacing, never under 3). Flat ignores it.",
    unit: 'drawing units',
    interactions: ['style.fill.type', 'style.fill.opacity', 'style.fill.roughness'],
  },
  'style.fill.opacity': {
    meaning:
      "How strong the fill is. Hatch lines, scribbles and dots are drawn at this opacity in a deeper shade of the region's colour, and a solid area (flat or wash) at half of it, because a solid area reads about twice as heavy as lines at the same opacity. 0 hides the fill; raising it darkens the shading without adding a single mark. Lines are also lightened by the line opacity, since they are drawn in the same pen.",
    interactions: ['style.fill.spacing', 'style.line.opacity'],
  },
  'style.fill.roughness': {
    meaning:
      "How far a fill's marks stray from perfect placement: a hand, not a plotter. Hatch lines move off their spot, lean a few degrees, stop short or run long, now and then skip or break, and the spacing bunches and opens. A scribble gets wild turns, bent legs, small loops and a drifting direction, and above 0.3 a second sparser pass over a patch of the first. Stipple clumps, with uneven dots and the odd pair. Flat and wash slip off register by a unit or two, the colour missing the outline on one side, and flat gains a faint mottle. At 0 every fill is exact.",
    interactions: ['style.fill.type', 'style.fill.spacing', 'style.fill.angle'],
  },

  'style.paper.type': {
    meaning:
      "The sheet the figure is drawn on, laid under everything. none is transparent, for a page that has its own background. clean is flat colour. paper is good writing paper with a faint grain. rough-paper is cartridge paper, a coarse blotchy tooth with long pale fibres. canvas is woven cloth. graph is blue engineering grid paper with a heavier line every fifth. rough-graph is a grid ruled by hand on grainy paper. dotted is a dot grid. ruled is a notebook page with a red margin. Only some of them read the texture (paper, rough-paper, canvas, rough-graph) and the grid (graph, rough-graph, dotted, ruled).",
    interactions: ['style.paper.tint', 'style.paper.texture', 'style.paper.grid'],
  },
  'style.paper.tint': {
    meaning:
      "The colour of the paper: theme follows the viewer's own page colour, or a six digit hex colour such as #fbf8f0. Everything drawn is fitted to it, so a pale paper in a dark app puts the figure's ink, its theme roles and its named colours back to the colours that suit a light page (dark ink on pale paper), and the reverse for a dark paper. The style's saturation applies to the tint as well.",
    interactions: ['style.paper.type', 'style.colour.saturation', 'style.colour.ink'],
  },
  'style.paper.texture': {
    meaning:
      "How strong the paper's tooth is. It is the fine speckle on paper, the coarse blotches and fibres on rough-paper, the weave's contrast and the yarn's fuzz on canvas, and how much the hand-ruled lines of rough-graph waver. 0 is a smooth sheet. Clean, none, graph, dotted and ruled have no tooth and ignore it.",
    interactions: ['style.paper.type'],
  },
  'style.paper.grid': {
    meaning:
      "The spacing of the grid, dots or ruled lines, in drawing units. Smaller is a finer grid. Graph and rough-graph put a heavier line every fifth square, dotted puts one dot per square, and ruled sets its lines this far apart. Clean, paper, rough-paper, canvas and none ignore it.",
    unit: 'drawing units',
    interactions: ['style.paper.type'],
  },

  'style.lettering.face': {
    meaning:
      "The hand the labels are set in. math is a clean serif for mathematics. textbook is a plain sans, exactly what clean figures use. hand is handwriting. Each is a stack of fonts that falls back to a system serif, sans or script, so a missing font never leaves labels blank. A style never moves a label: it only restyles it about the point the layout placed it at.",
    interactions: ['style.lettering.size', 'style.lettering.tilt'],
  },
  'style.lettering.size': {
    meaning:
      "A multiplier on the size of every label (points, measures, angle captions). Labels are laid out at that size, so a bigger hand keeps its distance from the lines instead of crowding them. 1 is the normal size. The givens table keeps its own size and only changes face.",
    unit: '×',
    interactions: ['style.lettering.face'],
  },
  'style.lettering.tilt': {
    meaning:
      "A slight seeded turn of each label about its own anchor, like handwriting that is not quite level: up to 4 degrees either way at 1, none at 0, a different turn for every label. Labels never move, they only turn, and the givens table is set straight.",
    interactions: ['style.lettering.face'],
  },

  'style.colour.ink': {
    meaning:
      "The colour of lines and labels: theme uses the viewer's own ink colour, or a six digit hex colour such as #1f2a44 for a blue-black ink. It replaces the theme's ink wherever the figure draws with it, and leaves an author's own colours (color: red) alone, except for the saturation.",
    interactions: ['style.colour.saturation', 'style.paper.tint'],
  },
  'style.colour.saturation': {
    meaning:
      "Scales the colour strength of everything the figure draws, ink, fills, the paper tint and an author's own colours, holding each one's lightness and hue. 0 is greyscale at the same lightness, 1 changes nothing, above 1 is vivid (a colour pushed out of range loses chroma and does not clip, so hue stays honest).",
    unit: '×',
    interactions: ['style.colour.ink', 'style.paper.tint'],
  },

  'style.seed': {
    meaning:
      "Rerolls every random choice the style makes at once: which way each stroke wobbles, where a hatch line breaks, which dots clump, how each label tilts. The same seed always gives the same drawing, byte for byte; a new seed is a different hand at the same settings. Clean has nothing random in it, so it ignores the seed.",
    interactions: [],
  },
}
