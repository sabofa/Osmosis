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
import type { LineMark, PointMark } from '../../scene/types'
import { DASH, Reads, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { approxText, approxTupleText, floorHeight, formOf, MESH_REL, part, readoutLabel, type Approx } from './common'
import { namedShape } from './named'
import { prepareRegion2 } from './regions'
import { compileOnRegion } from './target'
import { prepareBetweenSolid } from './volumes2'
import { prepareIteratedSolid } from './volumes3'

const CENTRE_SIZE = 11
const DROP_WIDTH = 1
const DEFAULT_RES = 96
export const ZERO_MASS_REL = 1e-9

// M, the moments, the integral of |density|, whether the centre lies on the
// floor (a region), and the least error a coordinate carries: a mesh region
// places its centre to 1e-4 of its size (MESH_REL), since its odd moments
// carry the grid's asymmetry (the half-disc's x̄ comes out 5×10⁻⁵).
type Measure = () => { mass: Approx; moments: Approx[]; total: number; floor: boolean; placed: number }

function prepareMeasure(context: BuildContext, of: string, density: Expr | null, reads: Reads): Measure {
  const { scope, config } = context
  const shape = namedShape(context, of)
  const delta = density ?? num(1)
  if (shape.kind === 'region') {
    const region = prepareRegion2(shape.domain, context, reads)
    const n = resolution(null, config, DEFAULT_RES)
    const d = compileOnRegion(delta, region.coords, scope, reads)
    const mesh = shape.domain.kind === 'inequality'
    return () => {
      const r = region.build(n)
      const xy = new Float64Array(2)
      const moment = (axis: number) =>
        r.integrate((a, b) => {
          r.toXY(a, b, xy)
          return xy[axis] * d(a, b)
        })
      // The size of the region itself: the grid's vertices outside it are
      // not in any triangle.
      let size = 0
      if (mesh) {
        const { x, y, indices } = r.samples
        let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
        for (const v of indices) {
          x0 = Math.min(x0, x[v])
          x1 = Math.max(x1, x[v])
          y0 = Math.min(y0, y[v])
          y1 = Math.max(y1, y[v])
        }
        if (x1 >= x0) size = Math.hypot(x1 - x0, y1 - y0)
      }
      return {
        mass: r.integrate(d),
        moments: [moment(0), moment(1)],
        total: r.integrate((a, b) => Math.abs(d(a, b)), true).value,
        floor: true,
        placed: MESH_REL * size,
      }
    }
  }
  const solid = shape.solid.kind === 'iterated' ? prepareIteratedSolid(shape.solid, context, reads) : prepareBetweenSolid(shape.solid, context, reads)
  const exprs = [delta, ...['x', 'y', 'z'].map((axis) => mul(variable(axis), delta)), call('abs', delta)]
  const run = solid.integrals(exprs)
  return () => {
    const [mass, mx, my, mz, total] = run()
    return { mass, moments: [mx, my, mz], total: total.value, floor: false, placed: 0 }
  }
}

// moment / mass, with the error of a quotient.
function quotient(moment: Approx, mass: Approx): Approx {
  const value = moment.value / mass.value
  if (moment.error === null || mass.error === null) return { value, error: null }
  return { value, error: (moment.error + Math.abs(value) * mass.error) / Math.abs(mass.value) }
}

function prepareCentroid(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'centroid')
  const reads = new Reads(context.scope)
  const measure = prepareMeasure(context, form.of, form.density, reads)
  const name = form.density ? 'centre of mass' : 'centroid'
  const z0 = floorHeight(context.config)

  const build = (): BuildResult => {
    const { mass, moments, total, floor, placed } = measure()
    if (!(Math.abs(mass.value) > ZERO_MASS_REL * total) || !Number.isFinite(mass.value)) {
      throw new Error('the mass is zero; the centre is undefined')
    }
    const centre = moments.map((m) => {
      const q = quotient(m, mass)
      return { value: q.value, error: q.error === null ? null : Math.max(q.error, placed) }
    })
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
