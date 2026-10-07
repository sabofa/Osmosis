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
    // jump breaks that the core found where the walk placed none, as an exact set of those in view that have none of the
    // marks a walk-typed jump has at its parameter: the core lifts the curve at an interval it will not connect (the jump
    // test, or an enclosure with an unbounded end) and records the middle of what it lifted, so they are asked to within
    // 1/16 px of the independent axis and not to 1e-9 (the jumps of `jumps` are located, and are)
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
    // default: checked. No segment of a chain spans a jump of the true curve: the true curve is sampled densely over each
    // segment's parameter span, and a gap between neighbours that bisecting does not close is a discontinuity (dense.ts, which
    // catches a bridge that the polyline-distance check of onCurve passes). `false` where a case's segments are not meant to
    // be the curve (an alias, a known limit): the comment says why. `{ segments }`: at most this many segments a view (by a
    // stride, and every long one), for a case whose points are dear (an integral costs a quadrature).
    dense?: false | { segments: number }
    // pole positions and guide counts are equal in every pair of views, over the part of the independent
    // axis they both show
    panStable?: boolean
    // the notes on the scene's error list, in order, each a prefix of its message: none where absent
    notes?: string[]
    // each point is within a pixel of what is drawn (a chain or a band)
    drawn?: Vec2[]
    // none of these points is within a pixel of anything drawn
    undrawn?: Vec2[]
    // ---- P3 (implicit curves and regions) ----
    // the even-odd area of all the region outlines of the main view, clipped to the view's bounds (by a scanline sum, 600
    // rows), within `rel` of `value`
    area?: { value: number; rel: number }
    // no region fill anywhere in these boxes of the main view: a grid of points is tested for even-odd containment
    unfilled?: Bounds[]
    // every boundary curve (an object whose id.object starts 'boundary.') of the main view has this `dashed`
    dashed?: boolean
    // the numbers of boundary curves of the main view that are dashed and that are solid
    boundaries?: { dashed: number; solid: number }
    // in every view no curve segment spans more than half the view's height while within 1 px of vertical: the defect
    // of joining the two sides of a pole
    noVerticalJoins?: true
    // an expression H(x, y): every curve vertex of the main view is within 1 px of its zero set, by |H| / |grad H| with
    // central differences
    curvesOn?: string
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
// the height the logs of the corpus are asked at: ln(u) = -10 where u = e^-10
const E10 = Math.exp(-10)
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
    ceiling: { points: 4100, intervals: 1200 }, // measured 2719 / 778
  },
  {
    // zoomed out to +-1000: the core starts a floor (1/16 px, 0.16 here) inside the pole, where 1/x is 6, and it stopped there:
    // 397 px short of the top of the view. The last stretch is walked in certified pieces and the curve leaves through the box.
    name: '1/x, zoomed out to +-1000',
    spec: 'y = 1/x',
    views: [view(-1000, 1000, -1000, 1000)],
    expect: { poles: [0], drawn: [{ x: 0.001, y: 1000 }, { x: -0.001, y: -1000 }, { x: 0.002, y: 500 }, { x: -0.04, y: -25 }] },
    ceiling: { points: 1100, intervals: 600 }, // measured 701 / 373
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
    ceiling: { points: 15000, intervals: 4300 }, // measured 9610 / 2837
  },
  {
    name: 'sin(x)/x',
    spec: 'y = sin(x)/x',
    views: [view(-15, 15, -1, 2)],
    expect: { holes: [{ x: 0, y: 1 }], poles: [] },
    ceiling: { points: 2200, intervals: 940 }, // measured 1422 / 621
  },
  {
    name: 'sin(x - pi)/(x - pi)',
    spec: 'y = sin(x - pi)/(x - pi)',
    views: [view(-4, 10, -1, 2)],
    expect: { holes: [{ x: Math.PI, y: 1 }], poles: [] },
    ceiling: { points: 3600, intervals: 1400 }, // measured 2370 / 892
  },
  // Holes at zeros that are not exact doubles. At the double nearest k pi, sin(x) is 1.2e-16, so the scalar was "defined" there and equal
  // to the limit, and the hole was classified regular: no ring, and an untyped jump a sixteenth of a pixel wide (sin(x)/sin(x) kept only
  // the one at 0); (x - pi)/sin(x) had a filled value dot at (pi, 0). A zero of a denominator is asked of the twin (curve.ts pointAt).
  {
    name: 'sin(x)/sin(x)',
    spec: 'y = sin(x)/sin(x)',
    views: [view(-10, 10, -2, 3)],
    expect: { holes: [-3, -2, -1, 0, 1, 2, 3].map((k) => ({ x: k * Math.PI, y: 1 })), values: [], poles: [], jumps: [], bands: false },
    ceiling: { points: 20200, intervals: 6750 }, // measured 13453 / 4495
  },
  {
    name: '(x^2 - 2)/(x^2 - 2)',
    spec: 'y = (x^2 - 2)/(x^2 - 2)',
    views: [view(-4, 4, -1, 3)],
    expect: { holes: [{ x: -Math.SQRT2, y: 1 }, { x: Math.SQRT2, y: 1 }], values: [], poles: [], jumps: [] },
    ceiling: { points: 14200, intervals: 5100 }, // measured 9411 / 3393 (a cancelling form: the twin's enclosure of it is loose all the way down)
  },
  {
    // a pole at every k pi but pi, where the numerator vanishes too: a hole at (pi, -1), and no value dot at (pi, 0)
    name: '(x - pi)/sin(x)',
    spec: 'y = (x - pi)/sin(x)',
    views: [view(-10, 10, -4, 4)],
    expect: { holes: [{ x: Math.PI, y: -1 }], values: [], poles: [-3, -2, -1, 0, 2, 3].map((k) => k * Math.PI) },
    ceiling: { points: 3900, intervals: 1400 }, // measured 2578 / 931
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
  {
    // A curve that is a point: undefined either side of x = 1, and 5 there. It is the point (a filled value mark), is defined, and
    // draws no chain: it was silent (the grid hit it) or "undefined everywhere in view" (when the grid missed: y = {x = 1.05: 5})
    // depending on the pan. No note.
    name: 'y = {x = 1: 5}',
    spec: 'y = {x = 1: 5}',
    views: [view(-3, 4, -2, 6)],
    expect: { values: [{ x: 1, y: 5 }], holes: [], blank: true },
    ceiling: { points: 130, intervals: 45 }, // measured 82 / 27
  },
  {
    name: 'y = {x = 1.05: 5}',
    spec: 'y = {x = 1.05: 5}',
    views: [view(-3, 4, -2, 6), view(-2.9, 4.1, -2, 6), view(-2.77, 4.23, -2, 6)],
    expect: { values: [{ x: 1.05, y: 5 }], holes: [], blank: true },
    ceiling: { points: 130, intervals: 45 }, // measured 82 / 27 (the worst of 3 views)
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
  // ln of a quadratic: the edges are zeros of 1 - x^2, 4 - x^2, x^2 - 1 and x^2 - 4x + 3, and the twin's enclosure of each is
  // loose next to its zero (x^2 - 4x + 3 mentions x twice: its lower bound over a stretch from 3 + a to 3 + b is
  // 6a + a^2 - 4b, so it is not positive, and ln of it is minus infinity, for a stretch that halves the distance to the
  // edge at any scale). The stretch the twin would not certify whole was lifted a floor's width from the edge, and the
  // curve stopped 142 px (ln(1 - x^2)) to 197 px (ln(4 - x^2)) above the bottom of the view; it is walked in certified
  // pieces now, and reaches the clip box. Each case checks the curve at y = -10, which e^-10 below the edge's zero is at:
  // 1 - x^2 = e^-10 and so on.
  {
    name: 'ln(1 - x^2)',
    spec: 'y = ln(1 - x^2)',
    views: [STD],
    expect: { edges: [-1, 1], jumps: [], drawn: [{ x: -Math.sqrt(1 - E10), y: -10 }, { x: Math.sqrt(1 - E10), y: -10 }] },
    ceiling: { points: 990, intervals: 310 }, // measured 655 / 202
  },
  {
    name: 'ln(4 - x^2)',
    spec: 'y = ln(4 - x^2)',
    views: [STD],
    expect: { edges: [-2, 2], jumps: [], drawn: [{ x: -Math.sqrt(4 - E10), y: -10 }, { x: Math.sqrt(4 - E10), y: -10 }] },
    ceiling: { points: 1100, intervals: 330 }, // measured 687 / 218
  },
  {
    name: 'ln(x^2 - 1)',
    spec: 'y = ln(x^2 - 1)',
    views: [STD],
    expect: { edges: [-1, 1], jumps: [], drawn: [{ x: -Math.sqrt(1 + E10), y: -10 }, { x: Math.sqrt(1 + E10), y: -10 }] },
    ceiling: { points: 1800, intervals: 710 }, // measured 1182 / 468
  },
  {
    // the edge at 3 had a jump break a floor interval and a half from it besides its edge (3.0023): the interval next to the
    // one the walk draws, which the twin left unbounded, was lifted whole. Bisected below the floor it is certified, and the
    // curve is one stroke from the clip box at each edge: no jump break, two edge breaks.
    name: 'ln(x^2 - 4x + 3)',
    spec: 'y = ln(x^2 - 4x + 3)',
    views: [STD],
    expect: { edges: [1, 3], jumps: [], drawn: [{ x: 2 - Math.sqrt(1 + E10), y: -10 }, { x: 2 + Math.sqrt(1 + E10), y: -10 }] },
    ceiling: { points: 2800, intervals: 1400 }, // measured 1840 / 871
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
  // Steep root tips, which classify cannot call converged (a tail a little too long for convergePx, limits.ts approaching) and
  // which the core, with no anchor, stopped a floor interval short of: x sqrt(9 - x^2) has its tips ON the start grid here
  // (18 px short at FULL, 52 at COARSE; off the grid they were reached), and (4 - x^2)^(1/4), which rises as the fourth root of
  // the distance, 11 px short at this scale. Each tip is anchored at its extrapolated limit, and the stretch to it certified by
  // the floor test (every half).
  {
    name: '(4 - x^2)^(1/4)',
    spec: 'y = (4 - x^2)^(1/4)',
    views: [view(-3, 3, -1, 2, 240, 120)],
    expect: { edges: [-2, 2], jumps: [], drawn: [{ x: -2, y: 0 }, { x: 2, y: 0 }] },
    ceiling: { points: 670, intervals: 190 }, // measured 445 / 122 (527 / 194 when it stopped short, a known limit)
  },
  {
    name: 'x sqrt(9 - x^2), its tips on the start grid',
    spec: 'y = x sqrt(9 - x^2)',
    views: [view(-4, 4, -4, 4)],
    expect: { edges: [-3, 3], jumps: [], drawn: [{ x: -3, y: 0 }, { x: 3, y: 0 }] },
    ceiling: { points: 5400, intervals: 1600 }, // measured 3587 / 1052
  },
  {
    name: 'x sqrt(9 - x^2), its tips on the start grid, at COARSE',
    spec: 'y = x sqrt(9 - x^2)',
    views: [view(-4, 4, -4, 4)],
    quality: 'coarse',
    expect: { edges: [-3, 3], jumps: [], drawn: [{ x: -3, y: 0 }, { x: 3, y: 0 }] },
    ceiling: { points: 3100, intervals: 1100 }, // measured 2008 / 707
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
  // A staircase of a thousand steps a unit: the treads are 0.04 px wide and the risers 40 px, so nothing of it can be drawn and be true.
  // At COARSE the exemption for the last stretch to an anchor drew a 480 px chord from (-0.0122, -13) to the anchor of the jump at 0,
  // across twelve jumps, and the dense check of the corpus (testing/dense.ts) sees it; at FULL it drew nothing and said nothing.
  // Now it draws nothing at either and says why.
  {
    name: 'a dense staircase, floor(1000x), at FULL',
    spec: 'y = floor(1000x)',
    views: [STD],
    expect: { blank: true, notes: [NOTE_BLANK] },
    ceiling: { points: 2200, intervals: 12600 }, // measured 1450 / 8347
  },
  {
    name: 'a dense staircase, floor(1000x), at COARSE',
    spec: 'y = floor(1000x)',
    views: [STD],
    quality: 'coarse',
    expect: { blank: true, notes: [NOTE_BLANK] },
    ceiling: { points: 1650, intervals: 12400 }, // measured 1098 / 8265
  },
  // Denser than the leaves of the floor test (1/1024 px): a leaf at the depth limit holds more than one step, 2.4 of floor(100000x)'s,
  // and its gap against its parent's closed by a half, so the exemption for the stretch to an anchor passed it and drew a 600 px
  // stroke to the anchor of the jump at 0, at both qualities (floor(50000x) to floor(1000000x)). A leaf the twin calls DEFINED, that
  // may step, does not pass. It says "too steep": at the depth limit the gaps of such a staircase halve like a steep curve's, and the
  // two cannot be told apart there (both are what 1/1024 px cannot resolve).
  {
    name: 'a staircase denser than the leaves, floor(100000x), at FULL',
    spec: 'y = floor(100000x)',
    views: [STD],
    expect: { blank: true, notes: [NOTE_STEEP] },
    ceiling: { points: 1000, intervals: 12800 }, // measured 665 / 8501
  },
  {
    name: 'a staircase denser than the leaves, floor(100000x), at COARSE',
    spec: 'y = floor(100000x)',
    views: [STD],
    quality: 'coarse',
    expect: { blank: true, notes: [NOTE_STEEP] },
    ceiling: { points: 710, intervals: 12600 }, // measured 469 / 8355
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
    // measured 9649 / 4489. It was 26401 / 4501 (22 evaluations a pixel, 14 of them a band tried on each column): the columns of
    // a twin that says nothing are tried only where their midpoint is out of order, and a tried one that closes is drawn from its samples
    ceiling: { points: 14500, intervals: 6800 },
  },
  {
    // the example "Accumulation: the sine integral": the integral, and the curve it integrates, with its hole
    name: 'the sine integral',
    spec: 'F(x) = integral(t = 0 to x, sin(t)/t)\ny = F(x)\ny = sin(x)/x color: gray',
    views: [STD],
    expect: { holes: [{ x: 0, y: 1 }] },
    ceiling: { points: 17300, intervals: 7900 }, // measured 11484 / 5242 (28235 / 5254 before the columns of an integral were screened)
  },
  {
    // One point of this is a quadrature of about 23000 integrand evaluations (50 sin(100x) is 160 periods across the range), and the
    // settled view took 533 s with the budget unspent. The budget is charged what a point costs (CORE.innerPerPoint integrand
    // evaluations a point): the start grid alone is over it, so nothing is certified, nothing is refined, nothing is drawn, and the
    // note says why. 2.4 s. The ceiling is the budget (60000 points) and the grid's few more.
    name: 'an integral that costs thousands of evaluations a point',
    spec: 'y = integral(t = 0 to x, 5000 cos(100t))',
    views: [STD],
    expect: { blank: true, notes: [NOTE_BLANK] },
    ceiling: { points: 63000, intervals: 520 }, // measured 61150 / 345
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
    ceiling: { points: 37000, intervals: 11000 }, // measured 24106 / 6905
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
    ceiling: { points: 1230, intervals: 510 }, // measured 816 / 337 (716 before the start grid was scanned for a point in view: 100 points)
  },

  // ---- breaks the core finds on its own ------------------------------------------------------------------
  {
    // The jump test (the pixel-scale test that connects two ends whose gap closes as the interval is halved, and breaks where
    // it does not) is asked of an interval with ends it can reach and a bounded enclosure: for one the twin leaves unbounded,
    // "where a pole may sit", it is not asked at all, and the interval is never connected. gamma's poles at -12 and -11 are weak
    // (residues 1/12! and 1/11!): the classifier does not call them poles (see the known limit below), the twin's enclosure
    // of the interval over each is unbounded, and that rule is what breaks the curve there, at the middle of what it lifted
    // (within 1/16 px of the pole). Forcing the jump test to always connect leaves this case as it is. No end mark: a break
    // the walk typed at -12 would have two.
    name: 'gamma between its poles: an unbounded enclosure is never connected across',
    spec: 'y = gamma(x)',
    views: [view(-12.9, -10.5, -4, 4, 800, 800)],
    expect: { jumpsFound: [-12, -11], poles: [], ends: [] },
    ceiling: { points: 1600, intervals: 740 }, // measured 1055 / 487
  },
  {
    // The jump test finds these. floor(50x) has a zero every 0.02, 1501 of them in the sampled range, and the locator keeps
    // 256 (typed jumps, with their marks, within 2.6 of the centre); the steps of 0.05 (2 px) that the curve has in view, from 5.00
    // to 5.12 (the view and its overscan: seven of them), are on a slope of 200:1 that the twin cannot certify across them,
    // and are found only because the gap across each does not close as its interval is halved. A break at each, within 1/16
    // px, and no chain across one (checked of every case). With the jump test forced to always connect this case fails: one chain
    // runs up the stairs.
    name: 'a staircase the jump test alone finds',
    spec: 'y = 200(x - 5) - 0.05 floor(50x)',
    views: [STD],
    expect: { jumpsFound: [250, 251, 252, 253, 254, 255, 256].map((k) => k / 50) },
    ceiling: { points: 43800, intervals: 11600 }, // measured 29116 / 7691 (22753 / 2891 with 64 zeros kept: the locator clusters 2048 brackets before it is cut, not 512)
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
    ceiling: { points: 1210, intervals: 460 }, // measured 802 / 302 (602 before the start grid was scanned for a point in view, which this curve has none of: 200 points)
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
    ceiling: { points: 2000, intervals: 970 }, // measured 1318 / 646
  },
  {
    // KNOWN LIMIT. At COARSE (the pass a drag runs: 8 samples to a column, a start sample every 8 px) a curve like
    // x + 0.1 sin(500x), 4 px high and two periods to a pixel, is sampled at a spacing that aliases it: the 8 px start grid
    // steps 100 rad of the wave, which is -0.53 rad a sample, so the samples are a slow wave about the line y = x (a period of
    // about 95 px, 4 px high), and that is what it draws, one chain of the grid's own samples, with no band. The crest of one
    // wave, (0.0534, 0.1534), which is 4 px above the line, is not drawn: the amplitude is lost. (Its vertices are on the curve and
    // its chords are inside the 4 px the curve fills about the line: it draws less than there is, and a slow wave that is
    // not there.) At FULL it is bands. The settled pass corrects it.
    name: 'known limit: x + 0.1 sin(500x) at COARSE draws as an aliased slow wave',
    spec: 'y = x + 0.1 sin(500 x)',
    views: [STD],
    quality: 'coarse',
    expect: { bands: false, undrawn: [{ x: (HALF_PI + 8 * Math.PI) / 500, y: (HALF_PI + 8 * Math.PI) / 500 + 0.1 }] },
    ceiling: { points: 460, intervals: 230 }, // measured 301 / 151 (601 / 451 when COARSE's chords were 8 px, and every start interval was bisected)
  },
  // ---- P3: implicit curves and regions ---------------------------------------------------------------------
  {
    name: 'P3: an annulus, 1 < x^2 + y^2 < 4',
    spec: '1 < x^2+y^2 < 4',
    views: [STD],
    expect: { area: { value: 3 * Math.PI, rel: 0.01 }, unfilled: [view(-0.5, 0.5, -0.5, 0.5).bounds], dashed: true, boundaries: { dashed: 2, solid: 0 } },
    ceiling: { points: 18600, intervals: 7500 }, // measured 12360 / 4981
  },
  {
    name: 'P3: a half disc, x^2 + y^2 < 4 if y > 0',
    spec: 'x^2+y^2 < 4 if y > 0',
    views: [STD],
    expect: { area: { value: 2 * Math.PI, rel: 0.01 }, unfilled: [view(-1, 1, -1.5, -0.05).bounds], dashed: true },
    ceiling: { points: 6850, intervals: 3700 }, // measured 4541 / 2465
  },
  {
    name: 'P3: y < ln(x)',
    spec: 'y < ln(x)',
    views: [STD],
    expect: { unfilled: [{ xMin: -9.5, xMax: -0.05, yMin: -9.5, yMax: 9.5 }], dashed: true },
    ceiling: { points: 27800, intervals: 10250 }, // measured 18491 / 6823
  },
  {
    name: 'P3: x*y > 1, two components',
    spec: 'x*y > 1',
    views: [STD],
    expect: { unfilled: [view(-0.9, 0.9, -0.9, 0.9).bounds, view(-0.1, 0.1, -9, 9).bounds], dashed: true, boundaries: { dashed: 1, solid: 0 } },
    ceiling: { points: 45900, intervals: 15200 }, // measured 30600 / 10131 (one boundary object of two chains, one a branch)
  },
  {
    name: 'P3: y >= x^2, a solid boundary',
    spec: 'y >= x^2',
    views: [STD],
    expect: { unfilled: [view(-3, 3, -9, -0.5).bounds], dashed: false },
    ceiling: { points: 28700, intervals: 9900 }, // measured 19125 / 6583
  },
  {
    name: 'P3: a restricted disc, x^2 + y^2 < 1 if x > 0',
    spec: 'x^2+y^2 < 1 if x > 0',
    views: [STD],
    expect: { area: { value: Math.PI / 2, rel: 0.01 }, unfilled: [view(-1, -0.05, -1, 1).bounds] },
    ceiling: { points: 3450, intervals: 1870 }, // measured 2297 / 1241
  },
  {
    // the upper half circle only: nothing is drawn below y = 0 (the points below are asked undrawn; curvesOn puts every
    // vertex on the circle, so the vertices are on the upper half or there is a stray one)
    name: 'P3: a half circle, x^2 + y^2 = 4 if y > 0',
    spec: 'x^2+y^2 = 4 if y > 0',
    views: [STD],
    expect: { curvesOn: 'x^2+y^2-4', drawn: [{ x: 0, y: 2 }, { x: 1.9, y: Math.sqrt(4 - 1.9 * 1.9) }], undrawn: [{ x: 0, y: -2 }, { x: 1.5, y: -Math.sqrt(4 - 2.25) }, { x: -1.5, y: -Math.sqrt(4 - 2.25) }] },
    ceiling: { points: 15700, intervals: 4220 }, // measured 10424 / 2811
  },
  {
    name: 'P3: a lemniscate',
    spec: '(x^2+y^2)^2 - 4*(x^2-y^2) = 0',
    views: [view(-4, 4, -3, 3)],
    expect: { curvesOn: '(x^2+y^2)^2 - 4*(x^2-y^2)', drawn: [{ x: 2, y: 0 }, { x: -2, y: 0 }] },
    ceiling: { points: 43100, intervals: 16500 }, // measured 28693 / 10997
  },
  {
    name: 'P3: sin(x) = cos(y)',
    spec: 'sin(x) - cos(y) = 0',
    views: [STD],
    expect: { curvesOn: 'sin(x)-cos(y)' },
    ceiling: { points: 556000, intervals: 112500 }, // measured 370650 / 74997 (20 chains)
  },
  {
    name: 'P3: x^y = y^x',
    spec: 'x^y = y^x',
    views: [view(-1, 7, -1, 7)],
    expect: { curvesOn: 'y*ln(x)-x*ln(y)', drawn: [{ x: 2, y: 4 }, { x: 4, y: 2 }, { x: 3, y: 3 }] },
    ceiling: { points: 183300, intervals: 77700 }, // measured 122181 / 51783
  },
  {
    // the poles of tan are where the implicit curve leaves: no segment joins the two sides of one
    name: 'P3: y - tan(x) = 0, panned',
    spec: 'y - tan(x) = 0',
    views: panSequence(STD),
    expect: { noVerticalJoins: true },
    ceiling: { points: 1099500, intervals: 203800 }, // measured 732945 / 135857 (the worst of 5 views)
  },
  {
    // KNOWN LIMIT. y = +-sin(3x) are two arms that cross at every multiple of pi/3 and run nearly parallel near the axis.
    // At COARSE they are drawn as 2 chains over the whole view (not joined into an X at the crossings), and the nearest
    // vertex to the crest (pi/6, 1) is 2.3 px off (0.15 px at FULL). Pinned today: the crossings are drawn.
    name: 'KNOWN LIMIT: P3: y^2 = sin(3x)^2 at COARSE',
    spec: 'y^2 = sin(3*x)^2',
    views: [STD],
    quality: 'coarse',
    expect: { drawn: [{ x: 0, y: 0 }, { x: Math.PI / 3, y: 0 }, { x: -Math.PI / 3, y: 0 }] },
    ceiling: { points: 45500, intervals: 7300 }, // measured 30284 / 4805
  },
  {
    // KNOWN LIMIT. A lemniscate with a = 0.02 (0.8 px wide at 40 px a unit) at COARSE: the engine draws nothing and says
    // nothing (0 chains, no note).
    name: 'KNOWN LIMIT: P3: a tiny lemniscate at COARSE vanishes',
    spec: '(x^2+y^2)^2 - 0.0004*(x^2-y^2) = 0',
    views: [STD],
    quality: 'coarse',
    expect: { blank: true },
    ceiling: { points: 210, intervals: 176 }, // measured 140 / 117
  },
  {
    // KNOWN LIMIT. (x - y)^2 = 0 written expanded is a double root: the expression touches 0 along y = x with no sign
    // change. The engine spends its whole budget (about 213000 points), draws one chain of 1019 vertices and says "drawn
    // coarsely". Pinned: that note, and that the origin and (5, 5) are drawn.
    name: 'KNOWN LIMIT: P3: x^2 - 2*x*y + y^2 = 0, an expanded double root, large window',
    spec: 'x^2 - 2*x*y + y^2 = 0',
    views: [STD],
    expect: { notes: [NOTE_COARSE], drawn: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    ceiling: { points: 320600, intervals: 65900 }, // measured 212257 / 43901
  },
  {
    // KNOWN LIMIT: the same at a window 1000 times smaller; it fails the same way (the same note, the same work)
    name: 'KNOWN LIMIT: P3: x^2 - 2*x*y + y^2 = 0, an expanded double root, small window',
    spec: 'x^2 - 2*x*y + y^2 = 0',
    views: [view(-0.01, 0.01, -0.01, 0.01)],
    expect: { notes: [NOTE_COARSE], drawn: [{ x: 0, y: 0 }, { x: 0.005, y: 0.005 }] },
    ceiling: { points: 320600, intervals: 65900 }, // measured 213715 / 43901
  },
]
