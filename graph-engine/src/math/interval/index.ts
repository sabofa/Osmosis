// The interval twin's public surface (calc P1b): the compiler and the decorated interval it
// answers with.
//
// compileInterval(expr, vars, scope) gives (out, xLo, xHi, yLo, yHi, zLo, zHi) => out: bounds [lo, hi]
// and a verdict that enclose every value compileScalar gives over the box. Soundness is strict: at every
// point of the box a finite scalar value lies inside [lo, hi]; an infinity needs the bound on its side to
// BE that infinity (so a finite hi means the scalar is never +Infinity there), whatever the verdict; a NaN
// needs a PARTIAL or UNKNOWN verdict; a CONTINUOUS verdict covers no NaN and no jump.
//
// WHAT A CONSUMER MUST KNOW
//
//  1. CONTINUOUS does not mean bounded. An infinite bound under CONTINUOUS is overflow (exp(x) over
//     [700, 800]), not a pole: never certify a stretch flat when a bound or a sample is infinite. Nor does
//     it make the compiled values step-free to the last bit: it is a claim about the real function, and
//     where an intermediate overflows or saturates and the next operation absorbs it, the scalar's own
//     floating point steps (log(x, x!) goes from 0.0072 to 0 at x = 170.62, where x! becomes Infinity;
//     atanh(tanh(x)) is a staircase of 1e-4 steps near -15), and so does a steep curve at the scale of the
//     subnormals, which have one double between their two sides (x^0.001 goes from 0 at 0 to 0.47 at
//     5e-324, over a box [0, 5e-324] that is CONTINUOUS), with no verdict to show it.
//  2. Empty (lo > hi, always PARTIAL; isEmpty tests it) means NaN at every point of the box: skip it,
//     do not bisect it.
//  3. PARTIAL does not mean "a pole is here". It also appears at defined points: gamma near its poles (a
//     few ulps above -1, -3, ...) and beyond |x| of about 333,000, within about 1e-9 * max(1, |x|) of a
//     tan, sec, csc or cot pole, and for a root or log of an expression that is not negative in the
//     scalar but whose bound dips below 0 because it repeats a variable (sqrt(x * x), sqrt(x^2 - 2x + 1);
//     sqrt(x^2) and sqrt(x^2 + y^2) are exact at their zero). Classify poles from the expression's
//     structure and one-sided limits, or by bisection: a sign change whose sub-edge stays PARTIAL with an
//     infinite bound down to machine width is a pole, one whose sub-edge becomes CONTINUOUS is a root.
//  4. UNKNOWN, with bounds [-inf, inf], is: an integral that is not constant (a constant one, with no
//     variable, no @param and no loop in a bound, is its number: with a loop in a bound it is UNKNOWN too);
//     a loop whose bounds depend on the variable, exceed the loop
//     budget or use a loop as a bound; choose, perm, gcd or lcm with a variable argument on a box that is
//     not a point; root with an index that is not one number.
//  5. A piecewise whose condition is not decided over the box is at most DEFINED, even where its pieces
//     agree at the seam ({x < 1: x, 1} is continuous and is DEFINED over a box holding 1). A condition
//     that is decided over the box (floor(x) < 5 over [1.5, 2.5]) caps nothing; one that may be NaN
//     makes the answer PARTIAL, and one that is UNKNOWN makes it UNKNOWN ({integral(t = 0 to x, t) > 1:
//     1, 2} over [1, 2] is UNKNOWN).
//  6. Bounds are loose where an expression repeats its variable: a polynomial that cancels is 1 to 2
//     times wider than its range, and much worse where the true range is tiny (x^3 - 2x + 1 over
//     [1, 1.01] is 4.9 times). Use scalar samples to judge flatness and the twin for the verdict and for
//     the caps on a band.
//  7. A zero bound carries a sign. lo === +0 asserts that no -0 occurs at the bottom, hi === -0 that no +0
//     occurs at the top, a -0 bottom under a positive top that no +0 does, a +0 top over a negative bottom
//     that no -0 does; a box end that is a zero is that signed zero, a zero strictly inside may be either.
//     A non-negative result can still dip a hair below 0 (about -1.5e-323: widening takes a bound that is
//     not an exact zero past it; x^2, abs and sums of them keep an exact +0), so test `lo > 0 || hi < 0
//     || lo > hi` to discard a cell, which is valid even under PARTIAL.
//  8. The twin is proven against compileScalar and holds the same names, errors and loop budget. The
//     budget is module-level (one evaluation at a time). Pass every declared variable's box: a variable
//     with none is an empty box, so what reads it is empty and PARTIAL, not a quiet point at 0. (A
//     variable the expression does not read does not matter, and y^0 is [1, 1], PARTIAL, for
//     Math.pow(NaN, 0) is 1.) Compiling
//     folds constants; a constant that reads no @param is computed by the first evaluation that reaches it
//     (so a constant integral in a branch no box reaches costs nothing), one that reads a @param is read
//     at call time, and evaluation makes no object or closure of its own (a few scalar functions box a
//     double; see compile.ts).
export { compileInterval, type CompiledInterval } from './compile'
export { CONTINUOUS, DEFINED, isEmpty, iv, type Iv, PARTIAL, setBox, UNKNOWN, type Verdict } from './core'
