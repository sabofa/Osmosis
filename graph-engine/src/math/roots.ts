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
  NEWTON_STEP_REL,
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

// Newton's method, damped by backtracking: a step is halved until the
// residual's sum of squares decreases (Armijo, c = 1e-4).
export function newton(F: SystemFn, J: JacobianFn, x0: ArrayLike<number>, options: NewtonOptions = {}): NewtonResult {
  const maxIterations = options.maxIterations ?? NEWTON_MAX_ITERATIONS
  let x: Float64Array = Float64Array.from(x0)
  let f = Array.from(F(x))
  let phi = sumSquares(f)
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (!Number.isFinite(phi)) return { x, converged: false, iterations: iteration }
    if (maxAbs(f) <= NEWTON_RESIDUAL) return { x, converged: true, iterations: iteration }
    const step = newtonStep(J(x), f)
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
    if (!accepted) return { x, converged: maxAbs(f) <= NEWTON_RESIDUAL_LOOSE, iterations: iteration + 1 }

    const moved = lambda * maxAbs(step)
    x = accepted.x
    f = accepted.f
    phi = accepted.phi
    if (moved <= NEWTON_STEP_REL * (1 + maxAbs(x)) && maxAbs(f) <= NEWTON_RESIDUAL_LOOSE) {
      return { x, converged: true, iterations: iteration + 1 }
    }
  }
  return { x, converged: maxAbs(f) <= NEWTON_RESIDUAL, iterations: maxIterations }
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
