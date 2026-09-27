// Damped Newton in one to three dimensions, and roots seeded from a grid
// (K4). For questions with no closed form: critical points (grad f = 0) and
// Lagrange systems. Every answer is approximate and flagged as converged or
// not; a caller shows it with "≈".

import { solve2, solve3 } from './linalg'
import {
  NEWTON_MAX_HALVINGS,
  NEWTON_MAX_ITERATIONS,
  NEWTON_RESIDUAL,
  NEWTON_RESIDUAL_LOOSE,
  NEWTON_STEP_SQRT_EPS,
  ROOT_DEDUP_REL,
} from './tolerance'

// The system F(x) = 0 and its Jacobian, over 1-3 unknowns.
export type SystemFn = (x: Float64Array) => ArrayLike<number>
export type JacobianFn = (x: Float64Array) => readonly (readonly number[])[]

export interface NewtonOptions {
  maxIterations?: number
}

export interface NewtonResult {
  x: Float64Array
  converged: boolean
  iterations: number
}

export interface SearchBox {
  min: readonly number[]
  max: readonly number[]
}

function maxAbs(v: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i])
    if (!(a <= m)) m = a // NaN propagates
  }
  return m
}

function sumSquares(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  return s
}

// Solves J step = -F; null when J is singular.
function newtonStep(j: readonly (readonly number[])[], f: ArrayLike<number>): number[] | null {
  const n = f.length
  if (n === 1) {
    const d = j[0][0]
    return d === 0 || !Number.isFinite(d) ? null : [-f[0] / d]
  }
  if (n === 2) return solve2(j, [-f[0], -f[1]])
  if (n === 3) return solve3(j, [-f[0], -f[1], -f[2]])
  throw new Error(`newton works in one to three dimensions, got ${n}`)
}

// The largest absolute row sum of a Jacobian.
function rowNorm(j: readonly (readonly number[])[]): number {
  let m = 0
  for (const row of j) {
    let s = 0
    for (const v of row) s += Math.abs(v)
    if (!(s <= m)) m = s
  }
  return m
}

// Newton's method, damped by backtracking: a step is halved until the
// residual's sum of squares decreases (Armijo, c = 1e-4).
//
// Convergence is relative, never an absolute residual, so it does not depend
// on the equations' scale (scaling F by a constant changes nothing):
// - primary: the residual is at most tol x ||J|| (1 + ||x||), the size of the
//   terms F is made of, which bounds its rounding floor at a simple root;
// - or, for a multiple root, whose Jacobian vanishes: the residual is at most
//   tol x the SEED's residual AND the full Newton step is below
//   sqrt(eps) (1 + ||x||). The step condition is what keeps a seed with a huge
//   residual from passing a large one (grad e^(x^2+y^2) far out, x e^x at 30,
//   x^2 + 1, which has no root).
export function newton(F: SystemFn, J: JacobianFn, x0: ArrayLike<number>, options: NewtonOptions = {}): NewtonResult {
  const maxIterations = options.maxIterations ?? NEWTON_MAX_ITERATIONS
  let x: Float64Array = Float64Array.from(x0)
  let f = Array.from(F(x))
  let phi = sumSquares(f)
  const seedScale = maxAbs(f)
  const converged = (residual: number[], jacobian: readonly (readonly number[])[], step: number[] | null, at: Float64Array, tol: number) => {
    const r = maxAbs(residual)
    const size = 1 + maxAbs(at)
    if (r <= tol * rowNorm(jacobian) * size) return true
    return step !== null && maxAbs(step) <= NEWTON_STEP_SQRT_EPS * size && r <= tol * seedScale
  }
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (!Number.isFinite(phi)) return { x, converged: false, iterations: iteration }
    const jacobian = J(x)
    const step = newtonStep(jacobian, f)
    if (converged(f, jacobian, step, x, NEWTON_RESIDUAL)) {
      // One full polishing step, kept if it does not raise the residual: a
      // simple root then lands to rounding, not merely within the tolerance.
      if (step) {
        const polished = x.map((xi, i) => xi + step[i])
        const fp = Array.from(F(polished))
        if (sumSquares(fp) <= phi) return { x: polished, converged: true, iterations: iteration + 1 }
      }
      return { x, converged: true, iterations: iteration }
    }
    if (!step) return { x, converged: false, iterations: iteration }

    let lambda = 1
    let accepted: { x: Float64Array; f: number[]; phi: number } | null = null
    for (let halving = 0; halving <= NEWTON_MAX_HALVINGS; halving++) {
      const trial = x.map((xi, i) => xi + lambda * step[i])
      const ft = Array.from(F(trial))
      const phiT = sumSquares(ft)
      if (Number.isFinite(phiT) && phiT <= (1 - 1e-4 * lambda) * phi) {
        accepted = { x: trial, f: ft, phi: phiT }
        break
      }
      lambda /= 2
    }
    // No descent along the Newton direction: a stall, which is a root only
    // by the same (looser) test.
    if (!accepted) return { x, converged: converged(f, jacobian, step, x, NEWTON_RESIDUAL_LOOSE), iterations: iteration + 1 }
    x = accepted.x
    f = accepted.f
    phi = accepted.phi
  }
  if (!Number.isFinite(phi)) return { x, converged: false, iterations: maxIterations }
  const jacobian = J(x)
  return { x, converged: converged(f, jacobian, newtonStep(jacobian, f), x, NEWTON_RESIDUAL), iterations: maxIterations }
}

function lexicographic(a: Float64Array, b: Float64Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

// Newton from every cell centre of a seedsPerAxis^n grid over the box. Keeps
// the converged points inside the box, merges any two closer than
// ROOT_DEDUP_REL x the box diagonal (the first found, in seed order, stands),
// and returns them in lexicographic order, so the result is deterministic.
export function seededRoots(F: SystemFn, J: JacobianFn, box: SearchBox, seedsPerAxis: number, options: NewtonOptions = {}): Float64Array[] {
  const n = box.min.length
  const diagonal = Math.hypot(...box.min.map((lo, i) => box.max[i] - lo))
  const mergeDistance = ROOT_DEDUP_REL * diagonal
  const found: Float64Array[] = []
  const seed = new Float64Array(n)
  const counters = new Array<number>(n).fill(0)

  for (;;) {
    for (let i = 0; i < n; i++) seed[i] = box.min[i] + ((counters[i] + 0.5) * (box.max[i] - box.min[i])) / seedsPerAxis
    const result = newton(F, J, seed, options)
    const inside = result.x.every((xi, i) => xi >= box.min[i] && xi <= box.max[i])
    if (result.converged && inside) {
      const duplicate = found.some((r) => Math.hypot(...r.map((ri, i) => ri - result.x[i])) <= mergeDistance)
      if (!duplicate) found.push(result.x)
    }
    // next seed, first axis slowest
    let axis = n - 1
    while (axis >= 0 && ++counters[axis] === seedsPerAxis) counters[axis--] = 0
    if (axis < 0) break
  }

  return found.sort(lexicographic)
}
