// Numerical scaffolding for feature detection.
//
// v1 found features by comparing consecutive entries of an already-sampled
// point array (see the deleted detectFeaturePoints.ts): a maximum was "y went
// up then down". That is wrong in two ways at once — it fires on numerical
// noise in flat stretches, and it can only ever report a location that happens
// to be a sample point, so a vertex between samples is reported at the wrong
// place. Finding roots of f' instead is indifferent to sample spacing and
// converges to the true location.

const DEFAULT_SAMPLES = 800
// Central-difference step. Small enough to be accurate, large enough that
// f(x+h) - f(x-h) does not vanish into floating-point cancellation.
const DERIV_H = 1e-5
const SECOND_DERIV_H = 1e-3
const BISECT_ITERATIONS = 60
// Two roots closer together than this are the same root found from adjacent
// brackets.
const DEDUPE_EPSILON = 1e-7
// How small |f(root)| must be, relative to the bracket's own magnitude, for a
// sign change to count as a crossing rather than a pole.
const ROOT_TOLERANCE = 1e-3

export function derivative(f: (x: number) => number, x: number, h: number = DERIV_H): number {
  return (f(x + h) - f(x - h)) / (2 * h)
}

export function secondDerivative(f: (x: number) => number, x: number, h: number = SECOND_DERIV_H): number {
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

// Plain bisection rather than Newton. Newton converges faster but can fly off
// a bracket entirely near a flat derivative, and these functions come from
// arbitrary user specs — guaranteed convergence inside a known bracket is
// worth more here than iteration count.
function bisect(f: (x: number) => number, a: number, b: number): number {
  let lo = a
  let hi = b
  let flo = f(lo)
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    const fmid = f(mid)
    if (fmid === 0) return mid
    if (!finite(fmid)) return mid
    if (flo < 0 !== fmid < 0) {
      hi = mid
    } else {
      lo = mid
      flo = fmid
    }
  }
  return (lo + hi) / 2
}

// Every x in [lo, hi] where f crosses zero, ascending, de-duplicated.
export function findRoots(
  f: (x: number) => number,
  lo: number,
  hi: number,
  samples: number = DEFAULT_SAMPLES
): number[] {
  const found: number[] = []
  const step = (hi - lo) / samples
  let prevX = lo
  let prevY = safeEval(f, lo)

  for (let i = 1; i <= samples; i++) {
    const x = lo + step * i
    const y = safeEval(f, x)

    if (prevY !== null && y !== null) {
      if (y === 0) {
        push(found, x)
      } else if (prevY < 0 !== y < 0) {
        // A pole changes sign too, without ever being zero — so the candidate
        // is validated rather than guessed at from the bracket's endpoints.
        // Bisection converges on a pole's own location, where |f| is enormous,
        // and on a root's location, where |f| is ~0. Judging from the endpoint
        // magnitudes instead would reject steep-but-genuine crossings:
        // y = 100x - 50 has a real root and huge values on both sides of it.
        const root = bisect(f, prevX, x)
        const value = safeEval(f, root)
        const scale = Math.max(Math.abs(prevY), Math.abs(y), 1)
        if (value !== null && Math.abs(value) <= scale * ROOT_TOLERANCE) push(found, root)
      }
    }
    prevX = x
    prevY = y
  }
  return found
}

function safeEval(f: (x: number) => number, x: number): number | null {
  try {
    const y = f(x)
    return finite(y) ? y : null
  } catch {
    return null
  }
}

function push(found: number[], x: number): void {
  if (found.length > 0 && Math.abs(found[found.length - 1] - x) < DEDUPE_EPSILON) return
  found.push(x)
}
