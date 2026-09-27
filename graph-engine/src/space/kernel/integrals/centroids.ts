// Centroids and centres of mass (S5, C5):
//
//   centroid: R [density <expr>]    R a named region or volume
//
// The mass M is the integral of the density (1 when none is given) over the
// shape, and each moment the integral of x, y (and z) times it, by the same
// quadrature as the shape's own readout: integrate2 over an iterated region,
// the mesh sum over an inequality region, integrate3 over an iterated
// volume, and the double-then-single integral over a volume under or between
// surfaces. The centre is the moments over M. A mass that is zero against
// the total |density| (1e-9 of it) leaves the centre undefined, and is
// refused.
//
// Drawn: a diamond at the centre, always, with dashed drop lines to the floor
// and to the planes x = 0 and y = 0 (a line of no length is left out: a
// region's centre lies on the floor). The readout, at the centre, is
// "centroid ≈ (x, y[, z]); M ≈ m" — "centre of mass" with a density — each
// value to the digits its error estimate supports.

import type { Expr, Statement } from '../../../parser/types'
import { call, mul, num, variable } from '../../../math/expr'
import type { LineMark, PointMark, SceneError } from '../../scene/types'
import { DASH, Reads, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { approxText, approxTupleText, attempt, determined, floorHeight, formOf, IntegralRefusal, part, readoutLabel, type Approx } from './common'
import { namedShape } from './named'
import { prepareRegion2 } from './regions'
import { compileOnRegion } from './target'
import { prepareBetweenSolid } from './volumes2'
import { prepareIteratedSolid } from './volumes3'

const CENTRE_SIZE = 11
const DROP_WIDTH = 1
const DEFAULT_RES = 96
export const ZERO_MASS_REL = 1e-9

// M, the moments, the integral of |density|, and whether the centre lies on
// the floor (a region). Each carries its method's own error: a mesh region's
// from two resolutions, which also covers its odd moments' grid asymmetry
// (the half-disc's x̄ comes out 5×10⁻⁵, inside its error, so it reads 0).
// `extent`: the shape's own size along each moment's axis, for a coordinate
// that is negligible against it (M4) — Infinity where not known, inert.
type Measure = () => { mass: Approx; moments: Approx[]; total: number; floor: boolean; extent: number[] }

function span(values: Float64Array): number {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi >= lo ? hi - lo : Infinity
}

function prepareMeasure(context: BuildContext, of: string, density: Expr | null, reads: Reads): Measure {
  const { scope, config } = context
  const shape = namedShape(context, of)
  const delta = density ?? num(1)
  if (shape.kind === 'region') {
    const region = prepareRegion2(shape.domain, context, reads)
    const n = resolution(null, config, DEFAULT_RES)
    const d = compileOnRegion(delta, region.coords, scope, reads)
    return () => {
      const r = region.build(n)
      const xy = new Float64Array(2)
      const moment = (axis: number) =>
        r.integrate((a, b) => {
          r.toXY(a, b, xy)
          return xy[axis] * d(a, b)
        })
      return {
        mass: r.integrate(d),
        moments: [moment(0), moment(1)],
        total: r.integrate((a, b) => Math.abs(d(a, b))).value,
        floor: true,
        extent: [span(r.samples.x), span(r.samples.y)],
      }
    }
  }
  const solid = shape.solid.kind === 'iterated' ? prepareIteratedSolid(shape.solid, context, reads) : prepareBetweenSolid(shape.solid, context, reads)
  const exprs = [delta, ...['x', 'y', 'z'].map((axis) => mul(variable(axis), delta)), call('abs', delta)]
  const run = solid.integrals(exprs)
  return () => {
    const [mass, mx, my, mz, total] = run()
    return { mass, moments: [mx, my, mz], total: total.value, floor: false, extent: [Infinity, Infinity, Infinity] }
  }
}

// moment / mass, with the error of a quotient, and the moment's scale
// carried over, so a coordinate that is negligible reads ≈ 0 and one known to
// no digit is refused (common.ts).
function quotient(moment: Approx, mass: Approx): Approx {
  const value = moment.value / mass.value
  return {
    value,
    error: (moment.error + Math.abs(value) * mass.error) / Math.abs(mass.value),
    scale: moment.scale / Math.abs(mass.value),
    singular: moment.singular || mass.singular,
  }
}

// A centroid coordinate is a position, not a general integral: it reads 0
// when it is within its error and that error is at most this fraction of
// the shape's own extent on that axis (S5 fix round 4, M4) — the general
// "≈ 0" rule (common.ts) compares against the integral of |density|, which
// for an annulus's x̄ near a fixed centre can be far larger than the ring's
// own diameter, so a position at the float noise floor (6×10⁻¹⁸ ± 1.3×10⁻³)
// was refused as "not determined" instead of read as 0.
export const POSITION_ZERO_REL = 1e-3

export function positionOrZero(a: Approx, extent: number): Approx {
  return Math.abs(a.value) <= a.error && a.error <= POSITION_ZERO_REL * extent ? { value: 0, error: 0, scale: 1 } : a
}

function prepareCentroid(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'centroid')
  const reads = new Reads(context.scope)
  const measure = prepareMeasure(context, form.of, form.density, reads)
  const name = form.density ? 'centre of mass' : 'centroid'
  const z0 = floorHeight(context.config)

  const build = (): BuildResult => {
    const errors: SceneError[] = []
    const measured = attempt(context, errors, measure)
    if (!measured) return { marks: [], labels: [], errors, colorScale: null }
    const { mass, moments, total, floor, extent } = measured
    if (!(Math.abs(mass.value) > ZERO_MASS_REL * total) || !Number.isFinite(mass.value)) {
      throw new Error('the mass is zero; the centre is undefined')
    }
    let centre: Approx[]
    try {
      determined(mass)
      centre = moments.map((m, i) => determined(positionOrZero(quotient(m, mass), extent[i])))
    } catch (err) {
      if (!(err instanceof IntegralRefusal)) throw err
      return { marks: [], labels: [], errors: [...errors, { line: context.line, message: err.message }], colorScale: null }
    }
    const p: [number, number, number] = [centre[0].value, centre[1].value, floor ? z0 : centre[2].value]
    const point: PointMark = {
      kind: 'points',
      source: context.source,
      positions: Float64Array.from(p),
      style: { color: context.color, size: CENTRE_SIZE, shape: 'diamond' },
    }
    const feet: [number, number, number][] = [
      [p[0], p[1], z0],
      [0, p[1], p[2]],
      [p[0], 0, p[2]],
    ]
    const drops = feet.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 1e-12 * (1 + Math.hypot(...p)))
    const marks: (PointMark | LineMark)[] = [point]
    if (drops.length > 0) {
      const positions = new Float64Array(drops.length * 6)
      drops.forEach((q, i) => positions.set([...p, ...q], 6 * i))
      marks.push({
        kind: 'lines',
        source: part(context, 'drops'),
        positions,
        starts: Uint32Array.from(drops.map((_, i) => 2 * i)),
        params: null,
        style: { color: context.color, width: DROP_WIDTH, dash: DASH, hidden: 'dashed' },
        pick: null,
      })
    }
    const text = `${name} ${approxTupleText(centre)}; M ${approxText(mass)}`
    return { marks, labels: [readoutLabel(context, p, text)], errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

export const CENTROID: BuilderEntry = { draws: true, prepare: prepareCentroid }
