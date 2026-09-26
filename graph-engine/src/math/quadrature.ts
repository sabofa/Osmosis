// Adaptive Gauss-Kronrod 7-15 quadrature, nested for iterated integrals (K4).
// Every result carries `error`, an estimate of |value - true value|; a display
// prints only the digits it supports, prefixed "≈". An exact form is never
// inferred from the float.
//
// A panel's error is |K15 - G7|, the error of the 7-point Gauss rule, which
// is a deliberately conservative bound on the 15-point Kronrod value the panel
// reports. The panel with the largest error is split in half until the sum is
// within the target or the panel budget is spent; either way the reported
// error is the honest sum.

import { QUAD_INNER_FRACTION, QUAD_INNER_MAX_PANELS, QUAD_MAX_PANELS, QUAD_TOL } from './tolerance'

export interface QuadResult {
  value: number
  error: number
}

// Kronrod nodes on [-1, 1] (non-negative half, largest first), and the
// Kronrod and Gauss weights (QUADPACK's qk15). The Gauss nodes are the
// odd-indexed Kronrod nodes and the centre.
const XGK = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
  0.586087235467691130294144845693013, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0,
]
const WGK = [
  0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
  0.16900472663926790282658342659855, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
]
const WG = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327]

interface Panel {
  a: number
  b: number
  value: number
  error: number
}

function kronrod(f: (x: number) => number, a: number, b: number): Panel {
  const centre = (a + b) / 2
  const half = (b - a) / 2
  const fc = f(centre)
  let k = WGK[7] * fc
  let g = WG[3] * fc
  for (let i = 0; i < 7; i++) {
    const dx = half * XGK[i]
    const sum = f(centre - dx) + f(centre + dx)
    k += WGK[i] * sum
    // XGK[1], XGK[3], XGK[5] are the Gauss nodes.
    if (i % 2 === 1) g += WG[(i - 1) / 2] * sum
  }
  const value = k * half
  return { a, b, value, error: Math.abs((k - g) * half) }
}

function adapt(f: (x: number) => number, a: number, b: number, tol: number, maxPanels: number): QuadResult {
  const panels: Panel[] = [kronrod(f, a, b)]
  let error = panels[0].error
  while (error > tol && panels.length < maxPanels) {
    let worst = 0
    for (let i = 1; i < panels.length; i++) if (panels[i].error > panels[worst].error) worst = i
    const { a: pa, b: pb } = panels[worst]
    const mid = (pa + pb) / 2
    const left = kronrod(f, pa, mid)
    const right = kronrod(f, mid, pb)
    panels.splice(worst, 1, left, right)
    error = 0
    for (const panel of panels) error += panel.error
    if (!Number.isFinite(error)) break
  }
  // Panels stay in interval order, so the sum's order is deterministic.
  let value = 0
  error = 0
  for (const panel of panels) {
    value += panel.value
    error += panel.error
  }
  return { value, error }
}

// The integral of f from a to b, to an absolute error target `tol`.
export function integrate1(f: (x: number) => number, a: number, b: number, tol: number = QUAD_TOL): QuadResult {
  if (a === b) return { value: 0, error: 0 }
  return adapt(f, a, b, tol, QUAD_MAX_PANELS)
}

// The target an inner integral is held to, so the noise it feeds the outer
// integrand stays below the outer target.
function innerTolerance(tol: number, a: number, b: number): number {
  return (QUAD_INNER_FRACTION * tol) / Math.max(Math.abs(b - a), 1e-300)
}

// The iterated integral of f(x, y) for x from a to b and y from c(x) to d(x).
export function integrate2(
  f: (x: number, y: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  tol: number = QUAD_TOL
): QuadResult {
  const inner = innerTolerance(tol, a, b)
  let innerError = 0
  const outer = integrate1(
    (x) => {
      const r = adapt((y) => f(x, y), c(x), d(x), inner, QUAD_INNER_MAX_PANELS)
      innerError = Math.max(innerError, r.error)
      return r.value
    },
    a,
    b,
    tol
  )
  return { value: outer.value, error: outer.error + Math.abs(b - a) * innerError }
}

// The iterated integral of f(x, y, z) for x from a to b, y from c(x) to d(x),
// and z from e(x, y) to g(x, y).
export function integrate3(
  f: (x: number, y: number, z: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  e: (x: number, y: number) => number,
  g: (x: number, y: number) => number,
  tol: number = QUAD_TOL
): QuadResult {
  const middle = innerTolerance(tol, a, b)
  let middleError = 0
  const outer = integrate1(
    (x) => {
      const r = integrate2Inner((y, z) => f(x, y, z), c(x), d(x), (y) => e(x, y), (y) => g(x, y), middle)
      middleError = Math.max(middleError, r.error)
      return r.value
    },
    a,
    b,
    tol
  )
  return { value: outer.value, error: outer.error + Math.abs(b - a) * middleError }
}

// integrate2 with the inner panel budget, for the middle level of integrate3.
function integrate2Inner(
  f: (y: number, z: number) => number,
  c: number,
  d: number,
  e: (y: number) => number,
  g: (y: number) => number,
  tol: number
): QuadResult {
  if (c === d) return { value: 0, error: 0 }
  const inner = innerTolerance(tol, c, d)
  let innerError = 0
  const middle = adapt(
    (y) => {
      const r = adapt((z) => f(y, z), e(y), g(y), inner, QUAD_INNER_MAX_PANELS)
      innerError = Math.max(innerError, r.error)
      return r.value
    },
    c,
    d,
    tol,
    QUAD_INNER_MAX_PANELS
  )
  return { value: middle.value, error: middle.error + Math.abs(d - c) * innerError }
}
