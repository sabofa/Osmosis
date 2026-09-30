// Riemann sums for double integrals (S5, C3):
//
//   riemann: under f over x in [a, b], y in [c, d], n = 4 [by 3] [sample: mid]
//
// The rectangle is cut into nx by ny cells. Each cell [x_i, x_i+1] x
// [y_j, y_j+1] is a box from z = 0 to f at its sample point — the cell's
// centre (mid, the default), a corner, or a point drawn from a linear
// congruential generator seeded with 1 on every build (random), so the same
// spec always draws the same boxes. The boxes are one BoxMark (opacity 0.6,
// edges on), the sample points a PointMark on the box tops.
//
// The readout puts the sum beside the integral: "Σ f(x*, y*) ΔA ≈ ..." is
// plain arithmetic on the samples, printed with the readout formatter, and
// "∬_R f dA ≈ ..." is integrate2's, so the approximation reads against its
// limit. Both carry "≈": the formatter rounds, and nothing is shown as exact.
//
// n may read a binding ("n = n"): a slider or play refines the sum, and only
// this statement rebuilds.

import type { Statement } from '../../../parser/types'
import { varNames } from '../../../math/expr'
import { integrate2 } from '../../../math/quadrature'
import { formatApprox, formatPoint } from '../../pick/format'
import type { BoxMark, PointMark, SceneError } from '../../scene/types'
import { RIEMANN_RECTANGLE, readsOuter, type SampleRule } from '../../grammar/keywords/integrals'
import { constant, Reads } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { approxText, attempt, determined, errorFloor, formOf, part, quadrature, readoutLabel, ROUNDING_REL } from './common'
import { exprText } from './exprText'
import { resolveDomain } from './named'
import { compileOnRegion, targetExpr, targetName, targetText } from './target'

export const RIEMANN_OPACITY = 0.6
export const MAX_CELLS = 100
const SAMPLE_SIZE = 8

// The generator behind "sample: random": Numerical Recipes' LCG, reseeded
// with 1 on every build.
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// Where in its cell a sample falls, as fractions (s, t) of the cell's width
// and depth.
function sampler(rule: SampleRule): () => [number, number] {
  switch (rule) {
    case 'mid':
      return () => [0.5, 0.5]
    case 'lower-left':
      return () => [0, 0]
    case 'upper-right':
      return () => [1, 1]
    case 'lower-right':
      return () => [1, 0]
    case 'upper-left':
      return () => [0, 1]
    case 'random': {
      const next = lcg(1)
      return () => [next(), next()]
    }
  }
}

// `hint` names what to do when a slider feeds n.
function count(value: number, what: string, hint: string): number {
  const n = Math.round(value)
  if (!Number.isFinite(value) || Math.abs(value - n) > 1e-9 || n < 1 || n > MAX_CELLS) {
    throw new Error(`${what} must be a whole number from 1 to ${MAX_CELLS}, got ${Number.isFinite(value) ? String(Number(value.toPrecision(6))) : String(value)}${hint}`)
  }
  return n
}

function prepareRiemann(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope } = context
  const form = formOf(statement, 'riemann')
  const { domain, name: regionName } = resolveDomain(context, form.region)
  const rect = domain.kind === 'rect' ? { kind: 'iterated' as const, coords: 'cartesian' as const, outer: domain.x, inner: domain.y } : domain
  if (rect.kind !== 'iterated' || rect.coords !== 'cartesian' || readsOuter(rect)) throw new Error(RIEMANN_RECTANGLE)
  const reads = new Reads(scope)
  const [outer0, outer1, inner0, inner1] = [rect.outer.from, rect.outer.to, rect.inner.from, rect.inner.to].map((e) => {
    reads.add(e)
    return constant(e, scope)
  })
  const outerIsX = rect.outer.param === 'x'
  const f = compileOnRegion(targetExpr(form.target, scope), 'cartesian', scope, reads)
  const [nxf, nyf] = form.n.map((e) => {
    reads.add(e)
    return constant(e, scope)
  })
  // A @param feeding n that is not an integer one: say how to make it one.
  const counted = new Set([...varNames(form.n[0]), ...varNames(form.n[1])])
  const loose = context.config.bindings.filter((b) => counted.has(b.name) && !b.integer).map((b) => b.name)
  const hint = loose.length > 0 ? ` — add "integer" to ${loose.map((b) => `@param ${b}`).join(' and ')}` : ''
  const opacity = form.style.opacity ?? RIEMANN_OPACITY
  // "Σ f(x*, y*) ΔA" for a defined function; the expression itself otherwise.
  const named = targetName(form.target, scope)
  const summand = named ? `${named}(x*, y*)` : targetText(form.target)
  const integrand = named ?? targetText(form.target)
  const R = regionName ?? 'R'
  // The sample dots in a colour that stands out on the boxes: the accent
  // (slot 0), or the first series colour when the boxes are the accent. The
  // kernel cannot reach the palette's ink; a slot is what a mark can name.
  const dotColor = { author: null, slot: context.color.slot === 0 ? 1 : 0 }

  const build = (): BuildResult => {
    const [o0, o1, i0, i1] = [outer0(), outer1(), inner0(), inner1()]
    const [xa, xb, ya, yb] = outerIsX ? [o0, o1, i0, i1] : [i0, i1, o0, o1]
    // The rectangle is a set: its corners, whichever way the ranges run.
    const [x0, x1, y0, y1] = [Math.min(xa, xb), Math.max(xa, xb), Math.min(ya, yb), Math.max(ya, yb)]
    const nx = count(nxf(), form.n[0] === form.n[1] ? 'n' : 'n along x', hint)
    const ny = count(nyf(), form.n[0] === form.n[1] ? 'n' : 'n along y', hint)
    const dx = (x1 - x0) / nx
    const dy = (y1 - y0) / ny
    const cells = nx * ny
    const mins = new Float64Array(3 * cells)
    const maxs = new Float64Array(3 * cells)
    const points = new Float64Array(3 * cells)
    const at = sampler(form.sample)
    let sum = 0
    let absolute = 0
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const [s, t] = at()
        // A corner's coordinate is computed as the cell edge itself, so a
        // corner sample lies exactly on it.
        const cx0 = x0 + dx * i
        const cx1 = i + 1 === nx ? x1 : x0 + dx * (i + 1)
        const cy0 = y0 + dy * j
        const cy1 = j + 1 === ny ? y1 : y0 + dy * (j + 1)
        const x = s === 0 ? cx0 : s === 1 ? cx1 : cx0 + (cx1 - cx0) * s
        const y = t === 0 ? cy0 : t === 1 ? cy1 : cy0 + (cy1 - cy0) * t
        const h = f(x, y)
        if (!Number.isFinite(h)) throw new Error(`${integrand} is undefined at the sample ${formatPoint([x, y])} — move the samples or the rectangle`)
        sum += h
        absolute += Math.abs(h)
        mins.set([cx0, cy0, Math.min(0, h)], 3 * k)
        maxs.set([cx1, cy1, Math.max(0, h)], 3 * k)
        points.set([x, y, h], 3 * k)
      }
    }
    const riemann = sum * dx * dy
    const errors: SceneError[] = []
    const integral = attempt(context, errors, () => {
      const levels = (outerIsX ? [rect.outer, rect.inner] : [rect.inner, rect.outer]).map((r) => ({ name: r.param, lower: exprText(r.from), upper: exprText(r.to) }))
      const raw = quadrature(levels, () => integrate2((x, y) => f(x, y), x0, x1, () => y0, () => y1))
      return determined({ value: raw.value, error: errorFloor(raw.error, raw.absolute, ROUNDING_REL, raw.singular), scale: raw.absolute, singular: raw.singular })
    })
    const boxes: BoxMark = { kind: 'boxes', source: context.source, mins, maxs, style: { color: context.color, opacity, edges: true } }
    const dots: PointMark = {
      kind: 'points',
      source: part(context, 'samples'),
      positions: points,
      style: { color: dotColor, size: SAMPLE_SIZE, shape: 'dot' },
    }
    let top = 0
    for (let k = 0; k < cells; k++) top = Math.max(top, maxs[3 * k + 2])
    // The sum is plain arithmetic, shown to the formatter's 4 digits; a sum
    // that cancels to rounding noise shows as 0.
    const shownSum = Math.abs(riemann) <= ROUNDING_REL * absolute * dx * dy ? 0 : riemann
    const text = `Σ ${summand} ΔA ${formatApprox(shownSum)}${integral ? `; ∬_${R} ${integrand} dA ${approxText(integral)}` : ''}`
    return { marks: [boxes, dots], labels: [readoutLabel(context, [(x0 + x1) / 2, (y0 + y1) / 2, top], text)], errors, colorScale: null }
  }
  return { reads: reads.names, build }
}

export const RIEMANN: BuilderEntry = { draws: true, prepare: prepareRiemann }
