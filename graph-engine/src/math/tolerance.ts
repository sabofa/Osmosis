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
// fraction of the larger of the seed's residual and ||J|| (1 + ||x||) — a
// relative test, so scaling the equations changes nothing...
export const NEWTON_RESIDUAL = 1e-12
// ...or when the step is below this fraction of (1 + |x|) AND the residual is
// at most NEWTON_RESIDUAL_LOOSE of the same scale (a slowly converging
// multiple root stalls on its step before its residual reaches
// NEWTON_RESIDUAL).
export const NEWTON_STEP_REL = 1e-14
export const NEWTON_RESIDUAL_LOOSE = 1e-9
// The damped step is halved at most this many times before Newton gives up.
export const NEWTON_MAX_HALVINGS = 30
export const NEWTON_MAX_ITERATIONS = 60

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
