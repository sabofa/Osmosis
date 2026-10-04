// Every tuned number of the adaptive sampler (calc P2) lives here, so tuning
// against the corpus is one file and no number hides in a stage. Each stage adds
// its own block; this is the first.

// The zero locator (locate.ts): isolating the zeros of the trouble-spot
// generators in the sampled range, in two phases. The twin brackets them coarsely;
// scalar samples inside each bracket say what is there.
export const LOCATE = {
  // The most zeros one range reports. Past it the ones nearest the centre of the
  // range are kept, and the result says it was cut. (The same number, times 8, is
  // the most separate brackets one generator may have before its search is cut.)
  maxZeros: 64,
  // The twin evaluations one generator may spend on its search: 2 / coarseRel, which
  // bisecting the whole range down to the coarse width takes at most (2 * 2^12 - 1),
  // so a generator's own budget never cuts the search short: the whole of a narrow
  // window can be one hard zero's band (an expanded double root, zoomed in on). It
  // stops a search that has not got to the coarse width because the call's total ran out.
  intervalsPerGenerator: 8192,
  // The twin evaluations one call may spend, over all its generators and the checks
  // after them. This is the real limit.
  intervalsTotal: 20000,
  // The scalar evaluations one call may spend (phase 1's checks of a stretch of zeros, then phase 2's samples, bisections
  // and golden-section searches), counted from the call's start and checked between clusters: once it is spent the
  // clusters not yet resolved are left, the result says it was cut, and a cluster in the middle of its own search is
  // finished (under 2500 points: 16 samples, 16 bisections of 64 steps, 16 searches of about 75). The clusters
  // nearest the centre of the range are resolved first, which is what is on screen. Without a limit
  // sqrt(sin(350 x)), whose 3000 zeros make 512 clusters, spent 105000 points here (64000 to 169000 for 311 to 410),
  // and those points were counted against the core's budget, which was then found spent: the curve drew nothing, and
  // said nothing. The zeros that are left unresolved are the twin's and the core's: they break at what they find.
  pointsTotal: 20000,
  // A zero is located to tolRel * max(1, |t|): the width the bisections and the
  // golden-section search stop at.
  tolRel: 1e-12,
  // The twin stops bisecting a box that may hold a zero at this fraction of the
  // range: a bracket narrow enough that the scalar samples inside it, not more
  // twin evaluations, decide what it holds. Sub-pixel is enough (about 0.2 px
  // across a view-sized range), because phase 2 restores the precision; a finer
  // width only costs: the twin cannot exclude zero in a band around a hard double
  // zero, which holds about 2 sqrt(2/w) boxes of width w (an expanded square
  // x^2 - 2x + 1, on [0.9, 1.1], used the whole budget at 2^-20). The width is also
  // the narrowest stretch of exact zeros that is reported as a stretch.
  coarseRel: 2 ** -12,
  // The scalar samples taken evenly over each bracket, its ends included.
  clusterSamples: 16,
  // A bracket wider than this many coarse boxes in which the samples show two sign
  // changes or more may hold more zeros than 16 samples count (cos(1/x) near 0, or
  // tan(1000 x) over a view): the result says it was cut. Zeros further apart than a
  // coarse box are told apart by the twin, so brackets that wide hold crowds.
  unresolvedLeaves: 4,
}

// The one-sided limits (limits.ts): what a trouble spot is, read from the curve's
// values at a geometric run of offsets on each side of it. Distances are screen
// pixels throughout, so a limit is "reached" when the eye cannot tell the samples
// from it.
export const LIMITS = {
  // The offsets are h0 / shrink^k for k = 0 … steps. From the step worth 4 px, 4^12
  // takes the last one to about 6e-9 in a 20-unit view: far enough in for any
  // limit that converges at a pixel-visible rate, and not so far that the offsets
  // reach the cancellation noise. Each step is a factor of 4, so 12 cover seven decades.
  steps: 12,
  shrink: 4,
  // The offsets stop at minRel * max(1, |tc|): below it cancellation noise, which
  // grows like machine epsilon / h, is no longer under a pixel's tenth. For
  // (x^2 - 1)/(x - 1) it is 4e-6 px at 1e-9 and reaches a tenth of a pixel near 4e-14;
  // a worse-conditioned function, or a more zoomed view, reaches it at a larger offset,
  // which is the reason for the margin.
  minRel: 1e-9,
  // A side converges when its last `window` finite samples lie within convergePx of
  // each other: a shrinking oscillation (x sin(1/x)) is inside the window when its
  // amplitude is. Four samples are a factor of 64 apart in offset. sqrt(x) at 0, the
  // slowest edge that is common, spreads 0.022 px over them in a 20-unit view: under
  // half of convergePx, and a window of six samples would fail it.
  window: 4,
  // A twentieth of a pixel: a limit and a sample this close are drawn on the same dot.
  // It is also what "equal" means when two limits, or a limit and a value, are compared.
  convergePx: 0.05,
  // The geometric test: the last 3 differences must each be at most this much of the
  // one before. A smooth limit shrinks them 4-fold (0.25); x^0.1 shrinks them 0.87-fold
  // and is rejected by it (its tail is six pixels), so this is not where slow
  // convergence is let in. The tail it estimates is d r / (1 - r): bounded by 9 d here.
  convergeRatio: 0.9,
  // The divergence test: each step of the distance from the first sample is at least
  // this much of the one before. ln(x) holds it constant (1.0), 1/x grows it 4-fold,
  // and x^0.1, whose steps shrink 0.87-fold, is left out. Slower convergence than
  // about x^0.03 cannot be told from ln(x) by 13 samples; it reads as divergence.
  divergeRatio: 0.95,
  // The run of steps (divergeRun + 1 samples) the divergence test looks at: 5 steps of
  // ln(x) are 5 * 55 px, past any noise, and 5 steps of 1/x are 4^5-fold.
  divergeRun: 5,
  // And the growth of those steps must be steady: the largest ratio of one step's growth
  // to the one before is at most this many times the smallest. A pole's are alike (1/x:
  // 4 4 4 4; 1/x^2: 16 16 16 16; ln: 1 1 1 1; 1/x^30, tan, 1/x + 1/x^2, sin(x)/x^2 the
  // same) and measure a spread of 1.00. Higher-order cancellation noise (x - sin x over
  // x^3, at the smallest offsets) grows the run's distance every step too, but by ratios
  // of 18, 4.4, 80, 1.2: a spread of 68. The noise that comes closest to steady is
  // exp(x) - 1 - x over x^2 at 100 and 400 px (9.2 8.8 24 25, a spread of 2.8): it grows
  // about 16-fold a step like a pole of order 2, because its numerator is a few ulps. So
  // 2: well above a pole's 1.00, which leaves room for rounding, and under noise's 2.8.
  divergeSpread: 2,
  // The last this-many samples all NaN make a side undefined. Fewer is not enough: a
  // function defined on a scatter of points (sqrt(sin(1/x)) near 0) is NaN at some
  // offsets and finite at others, and a stray NaN at the end is not a domain edge.
  undefinedRun: 3,
  // The confirming samples of a converging side are taken at these multiples of the
  // last offset, each between it and the one before (1 < factor < shrink), and BOTH must
  // agree. They have to be off the lattice h0 / shrink^k, and irrational is how: every
  // offset has 1/x = shrink^k / h0, so a function periodic in 1/x with a period that
  // divides that (sin(pi/x), cos(pi/x), 1/x - floor(1/x), at h0 = 0.1 and 0.08 from
  // k = 2) reads the same everywhere on the lattice and looks like a hole. A rational
  // factor can land on it again: at f = 2 the sample sits at 1/x = shrink^k / (2 h0),
  // which for sin(pi/x) at h0 = 0.1 is pi * 5 * 4^k, a whole number of periods again, so
  // it reads 0 like the lattice. With sqrt 2 the step from the lattice,
  // (1/f - 1) shrink^k / h0, is irrational for a rational h0, so it is never a whole
  // number of periods of any rational period. (A view whose h0 is itself a multiple of
  // pi is not covered by that argument.)
  // One sample is not enough. A function that sits at a maximum on the lattice
  // (cos(pi/x), cos(2 pi/x)) agrees with a given off-lattice sample whenever the phase
  // lands within 0.05 rad of a multiple of 2 pi, about one time in sixty, and with
  // enough views some do: cos(pi/x) read as a hole at h0 = 0.2 and on 11 of 96 round
  // views (2 to 100 units wide, 400 to 1920 px), cos(2 pi/x) on 6, cos(3 pi/x) on 5,
  // and sign(x) cos(pi/x) as a jump. A second sample at the golden ratio is independent
  // of the first: the factors are not related by a power of 2 (phi / sqrt 2 is not one),
  // as they would have to be for the second sample to be the first one halved or doubled,
  // or for it to be a lattice point (4^m times a lattice offset). Both agreeing is about
  // one in thousands; none of the 96 views gets through (0 of 96 for each of those).
  confirmFactors: [Math.SQRT2, (1 + Math.sqrt(5)) / 2],
  // Two limits count as equal when they are within convergePx on screen (and so does a
  // limit and the point's own value). A limit read from a retried tail (above) carries
  // noise of about convergePx, so two of them can be nearly twice that apart:
  // (exp(x) - 1 - x)/x^2 at 1600 px read as a jump between 0.50000001 and 0.50004066,
  // 0.065 px. This many times convergePx when either limit came from a retried tail: 2,
  // because each is within about convergePx of the true one. Measured over the five
  // cancellation families at 15 zooms (75 cases, 59 of them holes), the worst limit is
  // 0.068 px off ((tan(x) - x)/x^3 at 2500 px) and the next 0.044; so 2 has room. A limit
  // from the whole sequence keeps convergePx (a clean 0.07 px step is a jump).
  retriedEqualFactor: 2,
  // A side that is neither converged nor steadily diverged, and has no tight tail,
  // retries the convergence tests (window, geometric, the confirming sample) on its
  // sequence with the last 1, then 2, then up to this many samples dropped, and takes
  // the first that holds. The floor minRel covers noise of order eps/h; a numerator that
  // cancels to a higher order (x - sin x, exp(x) - 1 - x, 1 - cos x, tan x - x, over x^3
  // or x^2) has noise of eps/h^2 or worse, which is under a pixel's twentieth for most
  // of the offsets and then jumps: it is at the last few, and they are what is dropped.
  // How many is a matter of zoom: the noise is a fixed size in the function and a pixel
  // is smaller the further in the view is, so more offsets are over it. At 40 px per unit
  // dropping 3 is enough, at 400 and 4000 px per unit it takes 5. Swept over four such
  // functions at 14 zooms from 20 to 40000 px per unit: 4 gives 29 holes of 56, 5 gives
  // 44, 6 gives 46, 7 gives the same 46. The ten left are at 2000 px per unit and over,
  // where the noise is the function and unknown is honest. 6: the first where more
  // dropping changes nothing.
  noiseDrop: 6,
}

// Assembling a curve (curve.ts).
export const CURVE = {
  // A one-sided limit from limits.ts is the curve's value at the last offset it looked at
  // (6e-9 from the spot in a 20-unit view): right to far under a pixel and not to the digits
  // (x + 1 at 0 reads 1.000000006). The ends the sampler marks, and the points it anchors a chain
  // at, are exact, so a jump's side and a domain edge's limit are read once more this many
  // locator tolerances (LOCATE.tolRel) from the spot: the located zero is within one tolerance of
  // the real one, so a sample 4 away is on the side it is meant for, and its error (the curve's
  // slope times 4e-12) is under any digit a mark is read to. The new reading is taken only if it
  // agrees with the old one to settleAgreePx, so a function whose rounding noise is loud that close
  // in keeps the limit it had.
  settleTols: 4,
  // A twentieth of convergePx, in px: a re-reading may move a limit this far and no more. The
  // marks' fills compare a limit with the curve's own value at LIMITS.convergePx (0.05), and a
  // limit read from a retried tail is already within about that of the truth, so a re-reading
  // that was let move it by twice that (0.1) could carry a limit that equals the value across the
  // line the fill draws at (the left end of {x < 7: (x^2 - 49)/(x - 7), x > 7: x + 5, 14} at 1333
  // px per unit moved 0.085 px and its end read open). 0.005 corrects what it should (the 6e-9
  // that limits.ts stops at is a millionth of a pixel) and no more.
  settleAgreePx: 0.005,
  // A polar or parametric curve has no view span to lay a start grid along: its parameter range
  // is the author's. The grid is sized as if the path were this many view widths long (so
  // 1.5 widths of start-grid intervals, and never fewer than CORE.minStartIntervals): a circle
  // or a loop winds, so its path is longer than the width it spans.
  pathPerWidth: 1.5,
}

// Bands (band.ts, and the hook in adaptive.ts): an oscillation faster than a pixel is drawn as the
// extent the curve sweeps over each pixel column, instead of as a zig-zag. It is declared before the
// presets, which take their sample counts from it.
export const BAND = {
  // The oscillation coordinate is sampled this many times over a column, evenly spaced, the ends
  // included: what a column costs is these less the two ends, which the core already has. A column
  // with a couple of periods in it (sin(500x), 2 per pixel at 40 px per unit) reaches 0.993 of the
  // amplitude on average and 0.975 at worst; one with twenty (sin(5000x)) 0.93 and 0.73. The samples
  // are inside the curve, so a band is never taller than the curve is, and it is held inside the
  // twin's enclosure as well. This is FULL's count; COARSE's is coarseSamples.
  samples: 16,
  // But not evenly: the inner samples sit off their even places by jitterSpread / 2 of a spacing at most,
  // sample i at (i + J) / (n - 1) of the column with J = (frac(i * jitter) - 1/2) * jitterSpread, the
  // two ends where they are. Equally spaced samples are resonant with every oscillation whose period
  // divides their spacing (16 a pixel: sin(w x) near w = 3770 and 7540 at 40 px per unit, 8 at COARSE:
  // near 1759 and multiples), step over whole periods, and see no turn at all: no band, an aliased
  // curve, and the core, which samples at the same spacing, refines it to the cap. Without jitter, of
  // sin(w x) for w = 1800 to 8000 at FULL, 20 of 239 were capped and 21 had false segments in the view
  // (up to 80 px off); at COARSE 92 of 539 capped, 83 false. The golden ratio's fractional parts are
  // the spread that no lattice can be resonant with (LIMITS.confirmFactors, the same idea).
  // The spread is 0.35 (an inner sample is off its even place by 0.175 of a spacing at most), where it was 0.5. The
  // narrower one loses nothing to resonance (539 of 539 frequencies clean at COARSE, as at 0.5) and cuts the shortfall of
  // a spike a pixel wide at FULL from 3.79 px to 3.35, because the samples stay nearer where an even spacing put them.
  jitter: 0.618034,
  jitterSpread: 0.35,
  // COARSE takes these: a band across a 1200 px range is 1200 columns, and 14 evaluations each is
  // more than COARSE's whole 15000-point budget with the rest of the curve, where 6 are not (sin(500x)
  // at COARSE: 7200 points for the columns, and the 8 samples still show the turns of a column of two
  // periods, 3.5 a period).
  coarseSamples: 8,
  // An interval at most this wide (px) that is still unresolved, because it is not flat or the twin
  // cannot certify it, is a column to try. Wider, the samples are too far apart to show an
  // oscillation (they would alias it), and the core bisects instead.
  columnPx: 1,
  // Interval widths are halved from the start grid's, so a pixel is a pixel to rounding only: this
  // much (relative) is allowed over columnPx, which is a billionth.
  columnSlack: 1e-9,
  // The column is a band's only if the samples change direction this often. One turn is a peak,
  // which the polyline draws well; a steep monotone stretch has none, and is drawn as the samples
  // when the twin certifies it, and refined to the floor when it does not (steepness never breaks a
  // curve).
  minTurns: 2,
  // A column that starts where a band's last one ended needs only this many turns: at a period of one
  // to two pixels about half the columns hold two, and the rest one, and a band that stops at each of
  // those is a hundred bands with a chain between them (sin(200x) was 446 of each and capped).
  joinTurns: 1,
  // An interval the twin cannot certify is a steep stroke, and not tried, when its enclosure on the
  // oscillation axis is within the span of its two ends and this many px: nothing lies between them
  // for a band to show. The slack is the twin's looseness over an interval (x + sin(20x) is a pixel
  // looser than it is high), 2 px as spikeSlackPx is for the same thing in the flat test.
  strokeSlackPx: 2,
  // Where, as a fraction of a column, the one more sample is taken that checks the polyline of a
  // certified column that did not turn: (3 - sqrt 5) / 2, irrational so that no lattice of equally
  // spaced samples, whatever its spacing, is resonant with it (LIMITS.confirmFactors, the same idea).
  probeAt: (3 - Math.sqrt(5)) / 2,
  // How far (px) that probe sample may be from the polyline there for the polyline to be the curve. It was the core's
  // gapPx (1 px), a number about two ends of an interval being the same point, and not about a polyline's error
  // between samples a seventh of a pixel apart: at COARSE sin(w x) for w of about 104 to 146 (a period of one to two
  // pixels) is further than that from its own polyline, so true polylines were refused, the core refined them to the
  // cap, and the cap drew false chords 8 px long. An alias, which this check is for, is tens of pixels off (a slow wave
  // where there is a fast one), so 4 px keeps it out and lets the polyline in.
  probePx: 4,
}

// The adaptive core (adaptive.ts): every number of the screen-space subdivision. Two
// presets share the shape: FULL for a settled view, COARSE for one being dragged (the
// interaction budget), which draws the same curve a little looser and spends a quarter
// of the evaluations.
export interface Tuning {
  // One start sample per this many screen px of parameter range: the coarse floor every
  // curve is drawn from, and the spacing a feature narrower than it must be caught by
  // the twin (the spike test below) instead of by sampling.
  startPx: number
  // An interval is flat when its parameter midpoint is within this many px of the chord's
  // midpoint (so within it of the chord). A quarter of a pixel is under the width of the
  // stroke, so a polyline of such chords reads as a curve.
  flatPx: number
  // No accepted chord is longer than this many px, so a curve's smooth bends are drawn
  // by enough segments and a slowly varying curve is not one long line.
  maxSegPx: number
  // An interval this narrow (in px of parameter range) is not bisected any further. At
  // 1/16 px a steep curve may take a long chord: steepness never breaks a curve.
  floorPx: number
  // An interval the twin does NOT certify is not bisected any further at this width, which is floorPx
  // for FULL and coarser for a drag. What the twin cannot certify is all that can only be decided by
  // bisecting to the floor and testing there (an integral, a cancelling quotient, a seam the walk did
  // not find). A coarser floor is fewer intervals to test and a coarser place for a jump break, and it
  // saves what is spent on a gentle curve; a steep one costs what its vertical travel costs (see
  // CORE.subFloorPx), wherever bisecting stops. Certified intervals keep floorPx: they are accepted
  // flat long before it.
  uncertifiedFloorPx: number
  // Two ends this close on screen, the twin unable to certify the interval, are connected
  // if the jump test shows the gap closing; a pixel is what the eye can tell apart. (At the floor
  // the gap need not be small, only to close: CORE.subFloorPx.)
  gapPx: number
  // The jump test: this many successive halvings (3 take a 1 px gap to 1/8 px), keeping
  // the half with the larger gap, and each gap must be at most halvingShrink times the
  // one before. A continuous seam halves its gap (0.5 to 0.71); a jump keeps it (1.0).
  halvings: number
  halvingShrink: number
  // The same test, as it is asked of the floor interval that ends at an anchor (a limit the
  // structure walk read: curve.ts). There the curve is known to arrive, and what is asked is only
  // that nothing in the stretch is hiding: the ends within flatPx of each other, or gaps that close.
  // Looser than halvingShrink because that stretch is a tip: a root's gaps close by 2^-p a halving
  // (0.76 for p = 0.4, (1 - x^2)^0.4 at its ends, which 0.75 refused and drew short), and
  // 0.9 takes a root down to p = 0.15. A gap that does not close at all keeps its 1.0.
  anchorShrink: number
  // The spike test: a certified interval is flat only if the twin's enclosure of it is
  // no taller or wider than spikeFactor times the span the three samples cover, plus
  // spikeSlackPx. A spike narrower than the sample spacing shows in the enclosure and
  // nowhere in the samples; the slack is for the twin's looseness over a flat interval.
  // 2, not 8: with 8 a spike a pixel wide (1/(1 + 10^4 (x - c)^2)) hid behind samples
  // that all sat on its flank, drawn 32.6 px short at one offset of 50, because the
  // enclosure (40 px) was within 8 times the samples' span (5 px) plus the slack. At 2
  // the worst of the same offsets is 0.24 px short. A peak narrower than the floor
  // (1/16 px) cannot be promised at any factor: only a sample that lands on it shows it.
  spikeFactor: number
  spikeSlackPx: number
  // The samples taken over a column of a band (BAND.samples, and why COARSE takes fewer).
  bandSamples: number
  // The clip box is the view widened by this fraction of its size on each side: a curve
  // leaves the picture, not the sampled region, at the edge you can see.
  overscan: number
  // Evaluations the core may spend on one statement (curve.ts counts it apart from locating and
  // classifying, which have limits of their own: LOCATE.pointsTotal, LOCATE.intervalsTotal and
  // LOCATE.maxZeros classified spots; the stats report all three). Past either, refinement stops:
  // the start grid is still drawn, and an interval is connected only if the twin certified it.
  budget: { points: number; intervals: number }
}

export const FULL: Tuning = { startPx: 4, flatPx: 0.25, maxSegPx: 8, floorPx: 1 / 16, uncertifiedFloorPx: 1 / 16, gapPx: 1, halvings: 3, halvingShrink: 0.75, anchorShrink: 0.9, spikeFactor: 2, spikeSlackPx: 2, bandSamples: BAND.samples, overscan: 0.25, budget: { points: 60000, intervals: 30000 } }
// COARSE trades spike fidelity for drag speed: spikeFactor 8, the loose test, where FULL has 2. At 2 it
// cost as much as FULL on curves the twin encloses loosely (a cancelling quotient capped its budget).
export const COARSE: Tuning = { ...FULL, startPx: 8, flatPx: 0.5, uncertifiedFloorPx: 0.5, spikeFactor: 8, bandSamples: BAND.coarseSamples, budget: { points: 15000, intervals: 7500 } }

// The parts of the core that are not a quality knob, so not in Tuning but still numbers
// that were chosen.
export const CORE = {
  // The start grid has at least this many intervals, however short the range is on screen.
  minStartIntervals: 8,
  // The most halvings of an edge search, between a defined end and an undefined one. The
  // adjacent doubles are usually reached first; this stops a search towards 0, where
  // adjacent doubles are 1e-324 apart, at about 1e-22 of the floor interval, which is
  // far under any screen.
  edgeSteps: 64,
  // The jump test at the floor (adaptive.ts): an interval the twin does not certify, at the width it stops
  // being bisected at, with both ends finite, its enclosure bounded (or the verdict UNKNOWN) and a gap of a
  // pixel or more, is bisected BELOW the floor: every sub-interval whose gap is still a pixel or more, down to
  // subFloorPx, and then each leaf (a gap under gapPx) must pass the old test, gap under gapPx and
  // closing (halvings, halvingShrink). If any leaf fails, or a sub-interval is still a pixel at the last
  // level, the interval is lifted and a jump is recorded at that leaf. So any jump the test bridges is under a
  // pixel: a jump of a pixel keeps its sub-interval's gap over a pixel at every level, and one set against the
  // slope makes its own half's gap smaller, which is why every half is looked at (following only the half
  // with the larger gap bridged a 2 px jump against a slope of 200 at 40 offsets of 40). A smooth curve's
  // gaps halve however steep it is, so it is joined, down to a slope of 1024:1 (a leaf of 1/1024 px is under
  // a pixel there), past which the last level is still a pixel and the interval is not: it is lifted, and
  // the curve says it was the steepness that did it (the gaps were still halving at the last level, where a
  // jump's are not), which is a note to the author. The old precondition (a
  // gap under gapPx) refused every interval of a curve steeper than 16:1, which was broken at every floor
  // interval (y = integral(t = 0 to x, 40 cos(t)): 8091 jump breaks, nothing drawn in view). The price is
  // evaluations: the leaves are a gap of under a pixel each, so a curve costs about 6 evaluations for each
  // pixel it climbs, and a steep integral can cap (40 cos(t) climbs 9000 px in the box at 800 px: 60000
  // points, drawn as far as that goes, with the note).
  // A WIDTH and not a count of halvings: the floor is 1/16 px at FULL and 1/2 px at COARSE, and six halvings
  // from each stops at 1/1024 px and 1/128 px, so a smooth curve steeper than 128:1 was broken at every floor
  // interval at COARSE (y = integral(t = 0 to x, 200): nothing drawn, no cap, no message), where FULL drew it.
  // The leaves are the same at both, 1/1024 px (FULL's floorPx / 64), and COARSE bisects 9 levels to them: the
  // number of leaves follows the curve's climb on screen, so the cost does not change.
  subFloorPx: 1 / 1024,
}
