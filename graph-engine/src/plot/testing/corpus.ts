// The torture corpus (calc P2; spec "Testing and verification"): every acceptance case of the curve
// sampler, as data. A case is a whole spec as an author writes it, one or more views of it, and what must
// be true of the scene the engine builds from it: typed breaks and marks where the mathematics puts them,
// the curve on the curve, a pan sequence that does not flicker, and a pinned ceiling on the work done
// (evaluations are counted, not timed, so the test never flakes and a regression to brute force fails
// loudly). corpus.test.ts runs every case; scripts/calc-contact-sheet.ts draws them.
//
// Every later phase adds its own cases here. A case that records a KNOWN LIMIT (something the engine does
// today that a better one would not) says so in its comment and encodes the current behaviour in its
// `expect`: when the limit is fixed the case fails, and is rewritten to say what is now true.
//
// Ceilings: the evaluations (points and intervals, summed over the locator, the classifier and the core) the
// scene's stats count, measured at FULL, the worst over the case's views, and pinned at about 1.5 times that,
// rounded up. The measured numbers are in the comment beside each. To re-measure after a tuning change, build
// each case and read scene.stats.
import type { Bounds, Vec2 } from '../../scene/types'

export interface CorpusView {
  bounds: Bounds
  widthPx: number
  heightPx: number
}

export interface CorpusCase {
  name: string
  // a whole graph-engine spec, as an author writes it
  spec: string
  // the first view is the main one; more make a pan sequence
  views: CorpusView[]
  // 'full' (a settled view) unless the case is about the coarse pass a gesture runs
  quality?: 'full' | 'coarse'
  // test-only: forces the sampler's budget, so a curve is capped on purpose (buildScene's option)
  budget?: { points: number; intervals: number }
  // Each list is the exact set of what is in the MAIN view (marks inside the bounds; breaks of an explicit curve
  // inside its independent range; those of a polar or parametric curve over its whole range), and is not
  // checked where absent.
  expect: {
    // pole breaks: the independent coordinate of an explicit curve, theta or t of the others (sorted)
    poles?: number[]
    // jump breaks (found by the walk, or at a seam) and edge breaks (a domain's end), the same
    jumps?: number[]
    edges?: number[]
    // jump breaks that only the core's jump test found, where the walk placed none: it records the middle of the
    // floor interval it lifted at, so they are asked to within 1/16 px of the independent axis and not to 1e-9 (the
    // jumps of `jumps` are located, and are)
    jumpsFound?: number[]
    // open hole marks
    holes?: Vec2[]
    // endpoint marks, open or filled
    ends?: { at: Vec2; fill: 'open' | 'filled' }[]
    // filled value marks: a defined point whose value is neither of its limits
    values?: Vec2[]
    // at least one band (true) or none (false)
    bands?: boolean
    // true: nothing is drawn at all, no chain and no band (the curve is there, and the engine says why or does not
    // know). Marks and guides are not the curve.
    blank?: boolean
    // default true: every chain vertex is within a half pixel of the true curve (vertices at a classified
    // trouble spot are anchors, and vertices on the clip box where the sink cut the curve have a parameter
    // interpolated along the segment: both are skipped, with the chords that end at them), and no chord strays
    // more than a pixel from it
    onCurve?: boolean
    // pole positions and guide counts are equal in every pair of views, over the part of the independent
    // axis they both show
    panStable?: boolean
    // the notes on the scene's error list, in order, each a prefix of its message: none where absent
    notes?: string[]
    // each point is within a pixel of what is drawn (a chain or a band)
    drawn?: Vec2[]
    // none of these points is within a pixel of anything drawn
    undrawn?: Vec2[]
  }
  // pinned: about 1.5x the measured count (the most over the case's views), rounded up
  ceiling: { points: number; intervals: number }
}

// A view of x from xMin to xMax and y from yMin to yMax, drawn at widthPx wide; the height keeps the
// bounds' aspect unless it is given.
export function view(xMin: number, xMax: number, yMin: number, yMax: number, widthPx = 800, heightPx?: number): CorpusView {
  const height = heightPx ?? Math.max(1, Math.round((widthPx * (yMax - yMin)) / (xMax - xMin)))
  return { bounds: { xMin, xMax, yMin, yMax }, widthPx, heightPx: height }
}

// The same view panned right by `fraction` of its width, `count` views in all, the first as it is: a pan
// sequence. 0.37 is not a rational the pixel grid or the start grid is commensurate with.
export function panSequence(main: CorpusView, count = 5, fraction = 0.37): CorpusView[] {
  const width = main.bounds.xMax - main.bounds.xMin
  return Array.from({ length: count }, (_, i) => {
    const by = i * fraction * width
    return { ...main, bounds: { ...main.bounds, xMin: main.bounds.xMin + by, xMax: main.bounds.xMax + by } }
  })
}

// 40 px to a unit, [-10, 10] both ways
const STD = view(-10, 10, -10, 10)
const HALF_PI = Math.PI / 2
const NOTE_COARSE = 'drawn coarsely: '
const NOTE_BLANK = 'not drawn: '
const NOTE_STEEP = 'too steep to draw here: '

// The pairs of marks floor(x) leaves at each integer from -4 to 4: open at the bottom of a step, filled at the top.
const FLOOR_ENDS = Array.from({ length: 9 }, (_, i) => i - 4).flatMap((k) => [
  { at: { x: k, y: k - 1 }, fill: 'open' as const },
  { at: { x: k, y: k }, fill: 'filled' as const },
])

export const CORPUS: readonly CorpusCase[] = [
  // ---- poles ---------------------------------------------------------------------------------------------
  {
    name: 'tan x',
    spec: 'y = tan(x)',
    views: panSequence(STD),
    expect: { poles: [-5, -3, -1, 1, 3, 5].map((k) => k * HALF_PI), panStable: true },
    ceiling: { points: 9200, intervals: 2000 }, // measured 6071 / 1269 (the worst of 5 views)
  },
  {
    // the same poles in degrees: the unit of the document is the unit of the axis
    name: 'tan x, in degrees',
    spec: '@angle: degrees\ny = tan(x)',
    views: [view(-300, 300, -10, 10, 800, 400)],
    expect: { poles: [-270, -90, 90, 270] },
    ceiling: { points: 4100, intervals: 1200 }, // measured 2707 / 754
  },
  {
    // the main view has the pole near its right edge, so the pan sequence shows it three times
    name: '1/x^2',
    spec: 'y = 1/x^2',
    views: panSequence(view(-17, 3, -3, 17)),
    expect: { poles: [0], panStable: true },
    ceiling: { points: 2100, intervals: 620 }, // measured 1359 / 408 (the worst of 5 views)
  },
  {
    name: '1/(x - 1)',
    spec: 'y = 1/(x - 1)',
    views: panSequence(view(-16, 4, -10, 10)),
    expect: { poles: [1], panStable: true },
    ceiling: { points: 1800, intervals: 600 }, // measured 1154 / 395 (the worst of 5 views)
  },
  {
    // a pole of x = f(y) is a value of y, and its guide is horizontal
    name: 'x = 1/(y - 1)',
    spec: 'x = 1/(y - 1)',
    views: [STD],
    expect: { poles: [1] },
    ceiling: { points: 1800, intervals: 600 }, // measured 1154 / 395
  },
  {
    // x leaves to either side as t passes 1, and y is -2 there: a pole of the parametric curve, at the parameter
    name: 'a parametric pole',
    spec: '(1/(t - 1), t^2 - 3) for t in [-4, 6]',
    views: [STD],
    expect: { poles: [1] },
    ceiling: { points: 1600, intervals: 1300 }, // measured 1065 / 835
  },
  {
    name: 'r = 1/cos(theta)',
    spec: 'r = 1/cos(theta)',
    views: [view(-3, 5, -4, 4)],
    expect: { poles: [HALF_PI, 3 * HALF_PI], drawn: [{ x: 1, y: -3 }, { x: 1, y: 0 }, { x: 1, y: 3 }] },
    ceiling: { points: 3600, intervals: 3000 }, // measured 2369 / 1998
  },
  {
    // the default range is a full turn in the document's unit: the poles are at 90 and 270, and nowhere else
    name: 'r = 1/cos(theta), in degrees',
    spec: '@angle: degrees\nr = 1/cos(theta)',
    views: [view(-3, 5, -4, 4)],
    expect: { poles: [90, 270], drawn: [{ x: 1, y: -3 }, { x: 1, y: 0 }, { x: 1, y: 3 }] },
    ceiling: { points: 3600, intervals: 3100 }, // measured 2371 / 2038
  },

  // ---- holes ---------------------------------------------------------------------------------------------
  {
    name: '(x^2 - 1)/(x - 1)',
    spec: 'y = (x^2 - 1)/(x - 1)',
    views: [view(-4, 4, -2, 6)],
    expect: { holes: [{ x: 1, y: 2 }], poles: [] },
    ceiling: { points: 15000, intervals: 4300 }, // measured 9586 / 2813
  },
  {
    name: 'sin(x)/x',
    spec: 'y = sin(x)/x',
    views: [view(-15, 15, -1, 2)],
    expect: { holes: [{ x: 0, y: 1 }], poles: [] },
    ceiling: { points: 2100, intervals: 900 }, // measured 1398 / 597
  },
  {
    name: 'sin(x - pi)/(x - pi)',
    spec: 'y = sin(x - pi)/(x - pi)',
    views: [view(-4, 10, -1, 2)],
    expect: { holes: [{ x: Math.PI, y: 1 }], poles: [] },
    ceiling: { points: 3600, intervals: 1400 }, // measured 2346 / 868
  },

  // ---- jumps and ends ------------------------------------------------------------------------------------
  {
    name: 'floor(x)',
    spec: 'y = floor(x)',
    views: [view(-4.5, 4.5, -6, 6)],
    expect: { jumps: [-4, -3, -2, -1, 0, 1, 2, 3, 4], ends: FLOOR_ENDS },
    ceiling: { points: 3000, intervals: 950 }, // measured 1954 / 631
  },
  {
    name: '{x < 0: x^2, x + 1}',
    spec: 'y = {x < 0: x^2, x + 1}',
    views: [view(-3, 3, -1, 5)],
    expect: {
      jumps: [0],
      ends: [
        { at: { x: 0, y: 0 }, fill: 'open' },
        { at: { x: 0, y: 1 }, fill: 'filled' },
      ],
    },
    ceiling: { points: 1300, intervals: 830 }, // measured 804 / 549
  },
  {
    name: '{x <= 0: x^2, x + 1}',
    spec: 'y = {x <= 0: x^2, x + 1}',
    views: [view(-3, 3, -1, 5)],
    expect: {
      jumps: [0],
      ends: [
        { at: { x: 0, y: 0 }, fill: 'filled' },
        { at: { x: 0, y: 1 }, fill: 'open' },
      ],
    },
    ceiling: { points: 1300, intervals: 830 }, // measured 804 / 549
  },
  {
    // the seams are irrational, and no sample can tell < from <= there: the fill follows the condition's operator.
    // x^2 < 2 is false AT a seam, so each seam belongs to the outer piece (1): filled on the outer side, open on the
    // inner (0), at both.
    name: '{x^2 < 2: 0, 1}',
    spec: 'y = {x^2 < 2: 0, 1}',
    views: [view(-4, 4, -1, 2)],
    expect: {
      jumps: [-Math.SQRT2, Math.SQRT2],
      ends: [
        { at: { x: -Math.SQRT2, y: 0 }, fill: 'open' },
        { at: { x: -Math.SQRT2, y: 1 }, fill: 'filled' },
        { at: { x: Math.SQRT2, y: 0 }, fill: 'open' },
        { at: { x: Math.SQRT2, y: 1 }, fill: 'filled' },
      ],
    },
    ceiling: { points: 1300, intervals: 560 }, // measured 863 / 367
  },
  {
    name: 'y = 2 if 0 < x <= 3',
    spec: 'y = 2 if 0 < x <= 3',
    views: [view(-2, 5, -1, 4)],
    expect: {
      edges: [0, 3],
      ends: [
        { at: { x: 0, y: 2 }, fill: 'open' },
        { at: { x: 3, y: 2 }, fill: 'filled' },
      ],
    },
    ceiling: { points: 650, intervals: 210 }, // measured 429 / 139
  },
  {
    // A single point left undefined by the author's own condition: caught by STRUCTURE (the != is a seam the walk
    // reads), so the curve gets a hole at the limit, (1, 1), and a filled value at the one point it does take,
    // (1, 5). This answers the spec's open question 1 for P2: the residue the structure walk cannot see (a removable
    // singularity that is none of a zero denominator, a domain edge or a seam) is rare, and the jump test still
    // connects across a single undefined point without a mark, so a curve is never broken by it. This case
    // documents that the visible kinds are caught.
    name: 'y = {x != 1: x, 5}',
    spec: 'y = {x != 1: x, 5}',
    views: [view(-3, 4, -2, 6)],
    expect: { holes: [{ x: 1, y: 1 }], values: [{ x: 1, y: 5 }], poles: [] },
    ceiling: { points: 1100, intervals: 510 }, // measured 711 / 340
  },

  // ---- edges ---------------------------------------------------------------------------------------------
  {
    // ln dives off the picture at its edge: the chain is sampled to the last x it is defined at (ln of 0 is minus
    // infinity, so the core refines the edge on definedness) and the sink cuts it at the clip box, below the bottom of
    // the view. So it reaches the view's edge, (e^-8, -8), and nothing is marked. One edge break, at 0.
    name: 'ln x',
    spec: 'y = ln(x)',
    views: [view(-2, 10, -8, 4)],
    expect: { edges: [0], holes: [], ends: [], drawn: [{ x: 0.002, y: Math.log(0.002) }, { x: Math.exp(-8), y: -8 }] },
    ceiling: { points: 1200, intervals: 470 }, // measured 792 / 313 (700 / 282 when the chain stopped a floor's width short)
  },
  {
    // the same at a view where the dive is longer: log is base 10, and reaches the bottom of [-10, 10] at 1e-10
    name: 'log x',
    spec: 'y = log(x)',
    views: [STD],
    expect: { edges: [0], holes: [], ends: [], drawn: [{ x: 1e-10, y: -10 }] },
    ceiling: { points: 730, intervals: 350 }, // measured 484 / 232
  },
  {
    name: 'sqrt(x)',
    spec: 'y = sqrt(x)',
    views: [view(-2, 10, -2, 5)],
    expect: { edges: [0], holes: [], ends: [], drawn: [{ x: 0, y: 0 }] },
    ceiling: { points: 860, intervals: 390 }, // measured 572 / 258
  },
  {
    // odd real roots: both halves are drawn, in one chain through the origin
    name: 'x^(1/3)',
    spec: 'y = x^(1/3)',
    views: [view(-10, 10, -4, 4)],
    expect: { edges: [], drawn: [{ x: -8, y: -2 }, { x: 0, y: 0 }, { x: 8, y: 2 }] },
    ceiling: { points: 1100, intervals: 540 }, // measured 687 / 360
  },
  {
    name: 'x^(2/3)',
    spec: 'y = x^(2/3)',
    views: [view(-10, 10, -1, 7)],
    expect: { edges: [], drawn: [{ x: -8, y: 4 }, { x: 0, y: 0 }, { x: 8, y: 4 }] },
    ceiling: { points: 1100, intervals: 540 }, // measured 687 / 356
  },

  // ---- oscillation ---------------------------------------------------------------------------------------
  {
    name: 'sin(1/x)',
    spec: 'y = sin(1/x)',
    views: [view(-1, 1, -1.5, 1.5, 800, 1200)],
    expect: { bands: true },
    ceiling: { points: 7400, intervals: 1400 }, // measured 4908 / 888
  },
  {
    name: 'x sin(1/x)',
    spec: 'y = x sin(1/x)',
    views: [view(-1, 1, -1.5, 1.5, 800, 1200)],
    expect: { bands: true, holes: [{ x: 0, y: 0 }] },
    ceiling: { points: 3900, intervals: 1500 }, // measured 2586 / 983
  },
  {
    // a period of 5 px: a polyline, however many segments it takes, and no band
    name: 'sin(50x)',
    spec: 'y = sin(50x)',
    views: [STD],
    expect: { bands: false },
    ceiling: { points: 31000, intervals: 3200 }, // measured 20401 / 2101
  },
  {
    // two periods to a pixel: the extent the curve sweeps, not an aliased zig-zag
    name: 'sin(500x)',
    spec: 'y = sin(500x)',
    views: [STD],
    expect: { bands: true },
    ceiling: { points: 29000, intervals: 3200 }, // measured 19201 / 2101
  },

  // ---- steepness never breaks a curve --------------------------------------------------------------------
  {
    name: 'y = 1000x',
    spec: 'y = 1000x',
    views: [STD],
    expect: { drawn: [{ x: -0.005, y: -5 }, { x: 0.005, y: 5 }] },
    ceiling: { points: 510, intervals: 470 }, // measured 337 / 309
  },
  {
    name: 'y = 1e6 (x - 3)',
    spec: 'y = 1e6 (x - 3)',
    views: [STD],
    expect: { drawn: [{ x: 3.000005, y: 5 }] },
    ceiling: { points: 510, intervals: 470 }, // measured 337 / 309
  },

  // ---- the narrow spike ----------------------------------------------------------------------------------
  {
    // a peak under a pixel wide (its full width at half height is 0.02, which is 0.8 px at 40 px a unit), between two
    // start samples that both sit on its flanks: the twin's enclosure shows it where the samples do not
    name: 'a narrow spike',
    spec: 'y = 1/(1 + 10000 (x - 3.025)^2)',
    views: [STD],
    expect: { drawn: [{ x: 3.025, y: 1 }] },
    ceiling: { points: 1100, intervals: 470 }, // measured 671 / 312
  },

  // ---- what the twin cannot certify ----------------------------------------------------------------------
  {
    // the accumulation of sin: an integral with a variable bound, so the twin says nothing and the curve is drawn
    // through the jump test, within its ceiling
    name: 'y = integral(t = 0 to x, sin(t))',
    spec: 'y = integral(t = 0 to x, sin(t))',
    views: [STD],
    expect: { drawn: [{ x: 0, y: 0 }, { x: Math.PI, y: 2 }] },
    ceiling: { points: 40000, intervals: 6800 }, // measured 26401 / 4501
  },
  {
    // the example "Accumulation: the sine integral": the integral, and the curve it integrates, with its hole
    name: 'the sine integral',
    spec: 'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)\ny = sin(x)/x color: gray',
    views: [STD],
    expect: { holes: [{ x: 0, y: 1 }] },
    ceiling: { points: 43000, intervals: 7900 }, // measured 28211 / 5230
  },

  // ---- cost: forms the twin encloses loosely --------------------------------------------------------------
  {
    name: 'x^4 - 10x^2 + 9',
    spec: 'y = x^4 - 10x^2 + 9',
    views: [STD],
    expect: {},
    ceiling: { points: 7800, intervals: 2900 }, // measured 5191 / 1917 (was 7893 / 4669 before the spike test was bounded by depth)
  },
  {
    // The same as y = 1: the twin does not see the cancellation, so its enclosure is loose all the way down. The scalar
    // value is 1 plus rounding noise of about 1e-14, and the noise turns round more than twice in a pixel column:
    // taken for an oscillation, it was drawn as bands 1e-14 px tall (which the viewer fills at 0.18, so invisible) over
    // 92 % of the width, in a few short chains, with no message. A column whose samples span under flatPx is flat, not
    // a band (bandColumn in adaptive.ts): one chain, the whole line, no band. (Before: 19561 points, 2461 intervals.)
    name: '(x + 1)^2 - x^2 - 2x',
    spec: 'y = (x + 1)^2 - x^2 - 2x',
    views: [STD],
    expect: { bands: false, drawn: [{ x: -9, y: 1 }, { x: 0, y: 1 }, { x: 9, y: 1 }] },
    ceiling: { points: 40000, intervals: 14000 }, // measured 26401 / 9301
  },
  {
    // the same line, from a quotient with a hole at 1 (its value there is 1), minus x: the noise is 1e-14 over x
    name: '(x^2 - 1)/(x - 1) - x',
    spec: 'y = (x^2 - 1)/(x - 1) - x',
    views: [STD],
    expect: { bands: false, holes: [{ x: 1, y: 1 }], drawn: [{ x: -9, y: 1 }, { x: 0, y: 1 }, { x: 9, y: 1 }] },
    ceiling: { points: 37000, intervals: 11000 }, // measured 24084 / 6883
  },
  {
    // and from a hyperbolic identity: cosh^2 - sinh^2 is 1 with noise that grows with e^(2|x|) (1e-4 at 15, a hundredth of a pixel)
    name: 'cosh(x)^2 - sinh(x)^2',
    spec: 'y = cosh(x)^2 - sinh(x)^2',
    views: [STD],
    expect: { bands: false, drawn: [{ x: -9, y: 1 }, { x: 0, y: 1 }, { x: 9, y: 1 }] },
    ceiling: { points: 39000, intervals: 14000 }, // measured 25569 / 8973
  },
  {
    // The same as y = x, and a looser enclosure still (e^(x^2) is 1e43 at 10): before the spike test was bounded by
    // depth (tuning.ts spikeDepth) it was refined to the floor and capped the FULL budget (39036 points, 30133
    // intervals, and the note "drawn coarsely").
    name: 'exp(x^2) - exp(x^2) + x',
    spec: 'y = exp(x^2) - exp(x^2) + x',
    views: [STD],
    expect: {},
    ceiling: { points: 39000, intervals: 14000 }, // measured 25417 / 8933
  },

  // ---- notes ---------------------------------------------------------------------------------------------
  {
    // 40 cos(t) integrates to a curve that climbs 9000 px in the view, and no leaf of the jump test at the floor is
    // over a pixel: it does not fit its budget at FULL. It is drawn from the left as far as the budget goes, and says so.
    name: 'a curve that outgrows its budget',
    spec: 'y = integral(t = 0 to x, 40 cos(t))',
    views: [STD],
    expect: { notes: [NOTE_COARSE] },
    // measured 60001 / 10941: the budget (60000 points) is the ceiling, and a point more is the one that finds it spent
    ceiling: { points: 61000, intervals: 17000 },
  },
  {
    // the budget forced to 50 evaluations: the twin cannot certify an integral, so at the cap nothing is connected and
    // nothing is drawn, and the note says so ("drawn coarsely" over a blank would be false)
    name: 'a capped curve with nothing to draw',
    spec: 'y = integral(t = 0 to x, 2t)',
    views: [STD],
    budget: { points: 50, intervals: 50 },
    expect: { notes: [NOTE_BLANK], blank: true },
    ceiling: { points: 110, intervals: 77 }, // measured 70 / 51
  },
  {
    // a smooth curve steeper than 1024:1 on screen: every leaf of the jump test is still a pixel high, so it is lifted at
    // each floor interval and cannot be drawn; the note says it is the steepness
    name: 'a curve too steep to certify',
    spec: 'y = integral(t = 0 to x, 2000)',
    views: [STD],
    expect: { notes: [NOTE_STEEP], blank: true },
    ceiling: { points: 1100, intervals: 510 }, // measured 716 / 337
  },

  // ---- a break only the jump test finds ------------------------------------------------------------------
  {
    // gamma's poles at -12 and -11 are weak (residues 1/12! and 1/11!), and the classifier does not call them poles
    // (see the known limit below). Nothing structural places a break there; the core's jump test lifts the curve at
    // the floor interval where the gap does not close, and records the middle of it: at -11.99997 and -10.99997,
    // within 1/16 px (2e-4 here) of the poles, which is as exactly as that test can say. The curve is not bridged.
    name: 'gamma between its poles: breaks found by the jump test',
    spec: 'y = gamma(x)',
    views: [view(-12.9, -10.5, -4, 4, 800, 800)],
    expect: { jumpsFound: [-12, -11], poles: [] },
    ceiling: { points: 1600, intervals: 660 }, // measured 1007 / 439
  },

  // ---- known limits --------------------------------------------------------------------------------------
  {
    // KNOWN LIMIT. A curve the twin says NOTHING about (UNKNOWN: an integral with a variable bound) is culled where
    // its start samples and the midpoint between them are all beyond the same side of the clip box (farOff in
    // adaptive.ts), because refining all of an integral that is off screen costs a hundred evaluations a start
    // interval. A dip into the view that falls between the samples and is about a pixel wide (this one is 0.8 px at
    // the top of the view, and 1.8 px where it crosses the clip box) is hidden by it: the curve is above the view, and
    // nothing is drawn. A certified curve (no integral) is not culled so, and draws the dip.
    name: 'known limit: a 1 px dip of an uncertified curve is culled off screen',
    spec: 'y = integral(t = 0 to x, 0) + 17 - 22/(1 + 20000 (x - 3.025)^2)',
    views: [STD],
    expect: { blank: true, undrawn: [{ x: 3.025, y: -5 }] },
    ceiling: { points: 910, intervals: 460 }, // measured 602 / 302
  },
  {
    // KNOWN LIMIT. gamma has a pole at every negative integer, but its residue there is 1/n!, so left of about -11 the
    // curve is under a pixel high within the offsets the classifier looks at (limits.ts reaches 6e-9 of the spot): it
    // reads the pole as a hole, an open mark at (n, 0) that the curve runs through, and breaks nothing. (From -10 to
    // the right the poles are poles, and -11 and -12, between, are broken by the core as jumps without a type.)
    name: 'known limit: gamma reads as holes at its poles left of -11',
    spec: 'y = gamma(x)',
    views: [view(-16.5, -13.5, -1, 1, 800, 640)],
    expect: {
      poles: [],
      holes: [{ x: -16, y: 0 }, { x: -15, y: 0 }, { x: -14, y: 0 }],
    },
    ceiling: { points: 1900, intervals: 810 }, // measured 1210 / 538
  },
  {
    // KNOWN LIMIT. At COARSE (the pass a drag runs: 8 samples to a column, a start sample every 8 px) a curve like
    // x + 0.1 sin(500x), 4 px high and two periods to a pixel, is sampled at a spacing that aliases it: it draws as a
    // nearly straight polyline, with no band, and the crest of one wave, (0.0534, 0.1534), which is 4 px above the line
    // y = x, is not drawn: the amplitude is lost. (Its vertices and chords are still on the curve, which fills the
    // 4 px about that line: nothing it draws is false, and it draws less than there is.) At FULL it is bands. The
    // settled pass corrects it.
    name: 'known limit: x + 0.1 sin(500x) at COARSE draws as a line',
    spec: 'y = x + 0.1 sin(500 x)',
    views: [STD],
    quality: 'coarse',
    expect: { bands: false, undrawn: [{ x: (HALF_PI + 8 * Math.PI) / 500, y: (HALF_PI + 8 * Math.PI) / 500 + 0.1 }] },
    ceiling: { points: 910, intervals: 680 }, // measured 601 / 451
  },
  {
    // KNOWN LIMIT. (4 - x^2)^(1/4) meets the axis at +-2 with a vertical tangent: it rises as the fourth root of the
    // distance from the tip, so the last floor interval before it (1/16 px of x, 0.0016) is 0.28 high, which is 11 px
    // at this scale (40 px a unit), and the sampler does not draw that stretch: the chain ends there, with a jump break
    // just short of the tip. The edge break itself is typed at +-2, exactly: the curve stops a few px short of its tips.
    name: 'known limit: (4 - x^2)^(1/4) stops short of its tips',
    spec: 'y = (4 - x^2)^(1/4)',
    views: [view(-3, 3, -1, 2, 240, 120)],
    expect: { edges: [-2, 2], undrawn: [{ x: -2, y: 0 }, { x: 2, y: 0 }] },
    ceiling: { points: 800, intervals: 300 }, // measured 527 / 194
  },
]
