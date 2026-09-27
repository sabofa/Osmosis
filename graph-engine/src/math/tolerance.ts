// Every tolerance math/ and space/ use, in one place (K4). Each constant says
// what it bounds. GEOM_EPS belongs to solid figures and is not used here.

// solve2 / solve3: a matrix is singular when |det| is below this fraction of
// the product of its row norms (Hadamard's bound on |det|), so the test does
// not depend on the matrix's scale.
export const SINGULAR_REL = 1e-12

// symEig3 (Jacobi): stop when the off-diagonal mass is below this fraction of
// the whole matrix's Frobenius norm.
export const JACOBI_REL = 1e-15

// newton: converged when the largest residual component is at most this
// fraction of ||J|| (1 + ||x||) — relative, so scaling the equations changes
// nothing — or, at a multiple root (vanishing Jacobian), at most this fraction
// of the seed's residual while the full Newton step is below
// NEWTON_STEP_SQRT_EPS (1 + ||x||).
export const NEWTON_RESIDUAL = 1e-12
// sqrt of the double's epsilon (2^-26): a step this small relative to x is
// lost in rounding, so there is nowhere left to go.
export const NEWTON_STEP_SQRT_EPS = Math.sqrt(Number.EPSILON)
// The same tests after a failed line search (a stall), a little looser.
export const NEWTON_RESIDUAL_LOOSE = 1e-9
// The damped step is halved at most this many times before Newton gives up.
export const NEWTON_MAX_HALVINGS = 30
export const NEWTON_MAX_ITERATIONS = 60
// Multiple roots: when the last NEWTON_LINEAR_WINDOW ratios of successive full
// Newton step lengths agree within NEWTON_LINEAR_SPREAD and the latest, rho,
// lies in [NEWTON_LINEAR_MIN, NEWTON_LINEAR_MAX), Newton is converging
// linearly, as it does at a root of multiplicity m = round(1 / (1 - rho)):
// 2 at the low end, at most 100 at the high end.
export const NEWTON_LINEAR_WINDOW = 3
export const NEWTON_LINEAR_SPREAD = 0.02
export const NEWTON_LINEAR_MIN = 0.5
export const NEWTON_LINEAR_MAX = 0.99

// seededRoots: two converged points closer than this fraction of the search
// box's diagonal are the same root.
export const ROOT_DEDUP_REL = 1e-7

// integrate1: the default absolute error target, and the most panels one
// adaptive integral may split into before it returns with the error it has.
export const QUAD_TOL = 1e-10
export const QUAD_MAX_PANELS = 2000
// Nested (iterated) integrals: the inner integral's target is this fraction of
// the outer one's, divided by the outer interval's length, so the noise an
// inner result carries stays below the outer target.
export const QUAD_INNER_FRACTION = 0.1
export const QUAD_INNER_MAX_PANELS = 200
// Every level's error target is also relative: at most this fraction of its
// own value (an inner level chases the digits its value has, not an absolute
// 1e-12), and never below rounding (QUAD_ROUNDING).
export const QUAD_REL = 1e-10
// The cross-check pass (quadrature.ts, rule 4) runs from one-panel starts to
// this looser relative target.
export const QUAD_CHECK_REL = 1e-9
// integrate2 and integrate3: the most evaluations one integral may spend (a
// node at any level counts one), every level, pass and rung included.
// Running out is "did not settle", never divergence. Measured costs are in
// the S5 fix-round-3 commit.
export const QUAD_BUDGET = 6_000_000
// The first rung (QUAD_REL) may spend this share of it; what is left goes to
// the second, looser rung, whose pass and cross-check run to these targets
// (a triple integral with two nested kinks, max(x, y, z) over the cube, runs
// the first rung's 4 million out and settles on the second in 1.2 million).
export const QUAD_FIRST_RUNG_SHARE = 2 / 3
export const QUAD_COARSE_REL = 1e-5
export const QUAD_COARSE_CHECK_REL = 1e-4
// Where a level that did not settle was refining: its worst panel is reported
// when at most this fraction of the level's range wide.
export const QUAD_NARROW_REL = 1e-3
// 50 ulps of the panel sums: no target is tighter, so a large, constant
// integrand does not refine forever chasing an absolute target below its own
// rounding (QUADPACK's floor).
export const QUAD_ROUNDING = 50 * Number.EPSILON
// A guarded level that spends its panels with its error still above this
// fraction of |value| has not settled, and is refused as such.
export const QUAD_UNSETTLED_REL = 1e-6
// Divergence, by decay: halving toward a singular point, each shell shed
// ([h/2, h]) must shrink for an integrable singularity (x^-p sheds 2^(p-1) of
// the last, below 1 for p < 1). QUAD_DIVERGE_RUN shells in a row each at
// least QUAD_DECAY of the one before (1/x sheds exactly ln 2 each time) is
// divergence. x^-0.999 sheds 0.9993 of the last: not divergence.
export const QUAD_DIVERGE_RUN = 30
export const QUAD_DECAY = 1 - 1e-6
// A shell's value is only as exact as its nodes: near x, nodes sit within an
// ulp of x of where they belong, so a shell h wide is noisy to about
// ulp(x)/h. Shrinking by less than this many times that is not shrinking
// (sec to the float pi/2: at h = 1e-12 the noise is 1e-4).
export const QUAD_NODE_NOISE = 64
// A singular point still unsettled when its panel reaches float resolution
// (or its integrand overflows) is judged by its shells' ratio: below this,
// the rest is a geometric tail at most shell * r / (1 - r), its error; at or
// above it, the rest is too large to judge and the integral is refused as
// not settling (x^-0.99: 0.993; 1/(x ln^2 x): about 0.998).
export const QUAD_SLOW_RATIO = 0.9
// A singular end whose last two shell ratios agree to this fraction has a
// steady ratio q = 2^(p-1), naming its exponent p; the power rule on a limit
// (quadrature.ts, rule 7) is then also tried with the m that makes x^-p
// smooth, m = 1 / (1 - p), up to QUAD_POWER_MAX (x^(-2/3) at 0: m = 3, where
// halving to 1e-10 would take 100 steps; nearer p = 1 the substitution
// crowds every node against the limit, and the lineage judges instead).
export const QUAD_STEADY_REL = 0.1
export const QUAD_POWER_MAX = 8
// A shell ratio within this of 1/2 is a regular function's (a constant sheds
// half of the last shell, a kink or a jump about as much), not a singular
// end's: x^-p sheds 2^(p-1) > 1/2.
export const QUAD_REGULAR_BAND = 0.05
// A lineage around a point inside a panel, narrowed this many halvings onto
// a number of at most this many significant digits (0, 0.5), is split there.
export const QUAD_ANCHOR_STEPS = 8
export const QUAD_ANCHOR_DIGITS = 3
// A panel this many floats wide or fewer is float resolution: its qk15 nodes
// can collapse onto one or two values, so its own K - G says nothing near a
// singular anchor (S5 fix round 4, C1) — its error is floored by its
// lineage's tail instead, at the end of every level's run, not only for
// whichever panel happened to be worst.
export const QUAD_ANCHOR_FLOATS = 64
// A divergence found within this fraction of the range of a limit is placed
// at the limit (exp(1/x) overflows at x = 0.0011, but it is 0 that is wrong).
export const QUAD_DIVERGE_NEAR_REL = 1e-2
// At most this many splits at infinite interior nodes per level.
export const QUAD_POLE_SPLITS = 16
// A NaN at a node whose neighbours agree to this is a removable point.
export const QUAD_REMOVABLE_REL = 1e-6
// A single-panel start's own centre node, exactly on a pole by coincidence
// (a symmetric range's midpoint, where a singular integrand often sits: 1 /
// sqrt|y| for y in [-1, 1]) has no "one float toward the centre" to move by
// — it is the centre. It is retried at a doubling ladder of floats from it
// instead (1, 2, 4, ...), up to this many, until one is finite: some
// integrands amplify smallness (y^2 in ln(y^2) underflows to 0 at a y many
// orders of magnitude above where y itself would), so one float is not
// always enough (S5 fix round 4, I1a). 2^1024 floats from a denormal
// reaches well past the largest double; no genuine escape needs more.
export const QUAD_CENTRE_NUDGE_MAX = 2n ** 1024n

// K10 — an inequality domain's boundary crossing is refined by bisection along
// the grid edge until the bracket is shorter than this fraction of the edge.
export const BISECTION_REL = 1e-10

// K10 — a triangle is degenerate (dropped) when twice its area is at most this
// fraction of its longest edge squared: two coincident vertices give exactly
// zero, and a real sliver is many orders above it.
export const DEGENERATE_REL = 1e-14
