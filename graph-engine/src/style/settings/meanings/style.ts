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
      "How opaque one stroke is, from faint to solid, laid on top of the strength the pen draws at. In a medium that strength is the medium's own (ink full, chalk and marker a tenth under, graphite and coloured pencil more), and it replaces the pen's own factor rather than adding to it, so 1 here is the medium at its natural strength and not full black; the medium's colours keep their contrast with the paper at 1, and a lower value is the author's choice to go fainter than that. Without a medium (clean) the pen's own factor applies (a pencil pass about 0.8 to 0.95, marker 0.82, chalk 0.85). Strokes that overlap add up beneath it. It also lightens hatch and scribble lines, which are drawn in the same pen.",
    interactions: ['style.line.passes', 'style.fill.opacity', 'style.colour.medium'],
  },

  'style.fill.type': {
    meaning:
      "How the inside of a region is shaded. flat is one even tint. hatch is parallel lines at the fill angle, drawn in the figure's pen. crosshatch is two hatch families a quarter turn apart, denser and darker at the same spacing. stipple is dots, the engraver's way. scribble is one continuous back-and-forth pen zigzag, the way a hand fills a shape without lifting. wash is watercolour: a soft uneven tint that pools darker at its edge. none leaves the region bare, though its outline is still drawn.",
    interactions: ['style.fill.angle', 'style.fill.spacing', 'style.fill.opacity', 'style.fill.roughness'],
  },
  'style.fill.angle': {
    meaning:
      "The direction of hatch and scribble lines, in degrees anticlockwise from horizontal (a small positive angle rises from lower left to upper right). Crosshatch lays its second family a quarter turn further round. Flat, stipple, wash and none have no direction and ignore it. At roughness 0 hatching is anchored to the page, so two regions that touch hatch as one set of lines at the same angle. Above 0, each line leans off the angle a little, the family is no longer anchored, and a scribble drifts across the region.",
    interactions: ['style.fill.type', 'style.fill.roughness'],
  },
  'style.fill.spacing': {
    meaning:
      "The gap between hatch or scribble lines or stipple dots, in drawing units (a figure is fitted into 640 of them). Smaller packs the marks tighter, so the shading reads darker; larger opens it out, lighter. A large region caps how much shading it will hold and opens the spacing out to fit, so on a big region very small values stop getting darker. It also sets how wide a wash's darker rim is (0.7 times the spacing, never under 3). Flat ignores it.",
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
      "The sheet the figure is drawn on, laid under everything. none is transparent, for a page that has its own background; clean is flat colour. Every other sheet is generated: a seeded tile of real structure (the same seed always makes the same sheet) in the paper's tint, with any rulings hand-drawn over it. paper is good writing paper with a faint tooth. rough-paper is cartridge paper, a coarse blotchy tooth with long pale fibres. canvas is woven cloth, and linen a finer, looser weave. kraft is brown wrapping paper, the tint drawn most of the way to brown. graph is blue engineering grid paper with a heavier line every fifth, and rough-graph is the same grid ruled by a rougher hand. dotted is a dot grid. ruled is a notebook page with a red margin. blackboard, greenboard and whiteboard are the boards chalk and the whiteboard marker are drawn on: slate grain and erased haze, with a chalk tray's dust along the bottom of the dark two, in the board's colour from the theme, the same in the app's light and dark. The texture reads on every generated sheet, the grid on graph, rough-graph, dotted and ruled, and the tile size on all of them.",
    interactions: ['style.paper.tint', 'style.paper.texture', 'style.paper.grid', 'style.paper.tile'],
  },
  'style.paper.tint': {
    meaning:
      "The colour of the paper: theme follows the theme, or a six digit hex colour such as #fbf8f0. Everything drawn is fitted to the paper it sits on, so a pale tint in a dark app puts the figure's ink, its theme roles and its named colours back to the colours that suit a pale page (dark ink on pale paper), and the reverse for a dark tint. With theme, a medium draws on its own surface: the theme's paper for ink, graphite, coloured pencil and marker, and a board for chalk and the whiteboard marker. The style's saturation applies to the tint as well.",
    interactions: ['style.paper.type', 'style.colour.saturation', 'style.colour.ink', 'style.colour.medium'],
  },
  'style.paper.texture': {
    meaning:
      "How strongly the sheet's own structure shows. It is the tooth on paper, the blotches and fibres on rough-paper, the weave on canvas and linen, the fibre of kraft, the slate grain and the haze of an erased board, and how far the hand-ruled lines of graph paper stray. 0 is a smooth sheet, and 1 the full structure (the boards look right near 1, where half of it halves the slate grain and the haze). Clean and none have no structure and ignore it.",
    interactions: ['style.paper.type'],
  },
  'style.paper.grid': {
    meaning:
      "The spacing of the grid, dots or ruled lines, in drawing units. Smaller is a finer grid. Graph and rough-graph put a heavier line every fifth square, dotted puts one dot per square, and ruled sets its lines this far apart. The rulings are drawn in the theme's own line colours (its line and its stronger line, and the margin's red from the theme), so they change with the theme. Clean, none, the other papers and the boards ignore it.",
    interactions: ['style.paper.type'],
  },
  'style.paper.tile': {
    meaning:
      "The side of one repeating square of the sheet's generated structure, in drawing units. A bigger tile repeats less often, so the pattern is harder to spot, but it is a bigger bitmap to make and to hold, and a smaller one is cheaper but shows its repeats sooner as the figure grows. It zooms with the drawing: the tile is laid in drawing units, so zooming in enlarges the structure with the figure instead of keeping it a fixed size on the screen. Whole numbers only. Clean and none have no tile and ignore it.",
    interactions: ['style.paper.type', 'style.paper.texture'],
  },

  'style.lettering.face': {
    meaning:
      "The hand the labels are set in. math is a clean serif for mathematics. textbook is a plain sans, exactly what clean figures use. hand is handwriting. Each is a stack of fonts that falls back to a system serif, sans or script, so a missing font never leaves labels blank. A style never moves a label: it only restyles it about the point the layout placed it at.",
    interactions: ['style.lettering.size', 'style.lettering.tilt'],
  },
  'style.lettering.size': {
    meaning:
      "A multiplier on the size of every label (points, measures, angle captions). Labels are laid out at that size, so a bigger hand keeps its distance from the lines instead of crowding them. 1 is the normal size. The givens table keeps its own size and only changes face.",
    interactions: ['style.lettering.face'],
  },
  'style.lettering.tilt': {
    meaning:
      "A slight seeded turn of each label about its own anchor, like handwriting that is not quite level: up to 4 degrees either way at 1, none at 0, a different turn for every label. Labels never move, they only turn, and the givens table is set straight.",
    interactions: ['style.lettering.face'],
  },

  'style.colour.ink': {
    meaning:
      "The colour of lines and labels: theme uses the ink of the medium, or a six digit hex colour such as #1f2a44 for a blue-black ink. It replaces the theme's ink wherever the figure draws with it; in a medium it is the colour the medium starts from, and still fits (a blue-black ink comes out chalk-pale on a blackboard). An author's own colours (color: red) are left alone, except for the saturation and, in a medium, the medium's fit.",
    interactions: ['style.colour.saturation', 'style.paper.tint', 'style.colour.medium'],
  },
  'style.colour.saturation': {
    meaning:
      "Scales the colour strength of everything the figure draws, ink, fills, the paper tint and an author's own colours, holding each one's lightness and hue. 0 is greyscale at the same lightness, 1 changes nothing, above 1 is vivid (a colour pushed out of range loses chroma and does not clip, so hue stays honest). In a medium it works on the colours the medium has already fitted, so it is a second dial on the same strength.",
    interactions: ['style.colour.ink', 'style.paper.tint', 'style.colour.medium'],
  },
  'style.colour.medium': {
    meaning:
      "The colouring engine every colour of the figure goes through: clean draws the theme's exact colours, as a figure always has; every other medium fits each colour to its own range and to its surface. ink is deep and dense, in high contrast with the paper. graphite is greys with only a hint of each colour's hue, never saturated. colouredPencil is the theme colour a little desaturated and held a little light, waxy. marker is saturated colour of middle lightness, with a near-black for its lines. chalk is pastel and light, always, on a dark board. whiteboard is dry-erase ink, saturated and mid to dark, on a white board. It colours everything the figure draws: lines, hidden and auxiliary lines, points, labels, measures, the givens table, fills and their shading, and an author's own colours (color: red comes out a pastel chalk red on a blackboard). Each medium also lays a stroke at its own opacity, a little under full strength, and a hidden or auxiliary line is not faded on top of it (its muted colour and its dashes already mark it as secondary; clean still fades it). The ink and the muted colour follow the page: on a page on the other side of the lightness scale from the theme's own paper (a dark tint under a light theme, a board, a light tint under a dark theme) they are the ones that read there.",
    interactions: ['style.colour.ink', 'style.colour.saturation', 'style.paper.type', 'style.paper.tint', 'style.line.opacity', 'media.ink.chroma', 'media.ink.contrast', 'media.graphite.hint', 'media.colouredPencil.chroma', 'media.chalk.chroma'],
  },

  'style.seed': {
    meaning:
      "Rerolls every random choice the style makes at once: which way each stroke wobbles, where a hatch line breaks, which dots clump, how each label tilts. The same seed always gives the same drawing, byte for byte; a new seed is a different hand at the same settings. Clean has nothing random in it, so it ignores the seed.",
    interactions: [],
  },
}
