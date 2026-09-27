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

// K10 — an inequality domain's boundary crossing is refined by bisection along
// the grid edge until the bracket is shorter than this fraction of the edge.
export const BISECTION_REL = 1e-10

// K10 — a triangle is degenerate (dropped) when twice its area is at most this
// fraction of its longest edge squared: two coincident vertices give exactly
// zero, and a real sliver is many orders above it.
export const DEGENERATE_REL = 1e-14
