// Volumes under and between surfaces (S5, C2):
//
//   volume: under f over R            the solid from z = 0 up to z = f
//   volume: between g and f over R    the solid from z = g up to z = f
//
// Drawn translucent (0.45 unless styled), in the statement's one colour:
// - the top z = f and the bottom z = g (or z = 0) over R, through S1's surface
//   builder, so their domain machinery is exactly a surface's;
// - a side wall along each boundary piece of R, the ruled patch
//   (s, w) -> (gamma(s), (1 - w) g(gamma(s)) + w f(gamma(s))). It is linear in
//   w, so one row of cells is exact. A wall of zero area (a dome meeting the
//   floor) is dropped, and a full turn's seam was never a boundary piece.
//
// The readout is the double integral of f - g over R in the region's own
// coordinates, with the polar Jacobian where it applies (regions.ts). Where
// f < g somewhere the solid is drawn as written and the readout says the
// integral counts that part negatively.

import type { GraphConfig } from '../../../parser/config'
import type { Expr, Statement } from '../../../parser/types'
import { compileScalar } from '../../../math/compile'
import { num, substitute } from '../../../math/expr'
import type { SpaceStyle } from '../../grammar/types'
import type { Mark, MeshMark, SceneError } from '../../scene/types'
import { checkBudget, Reads, resolution } from '../common'
import { finishMesh, reversedWinding } from '../mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { SURFACE } from '../surface'
import { approxText, approxTextFull, attempt, COLLAPSED_REL, determined, formOf, part, readoutLabel } from './common'
import type { VolumeSolid } from '../../grammar/keywords/integrals'
import { resolveDomain, resolveSolid } from './named'
import { prepareRegion2, type BoundaryPiece } from './regions'
import { compileOnRegion, POLAR_XY, targetExpr, targetText } from './target'
import { prepareIterated, type PreparedSolid } from './volumes3'

export const VOLUME_OPACITY = 0.45
const DEFAULT_RES = 96

// A wall along one boundary piece, from g (row 0) up to f (row 1).
function wallMark(
  piece: BoundaryPiece,
  f: (a: number, b: number) => number,
  g: (a: number, b: number) => number,
  context: BuildContext,
  object: string,
  opacity: number,
): MeshMark | null {
  const count = piece.xy.length / 2
  if (count < 2) return null
  const positions = new Float64Array(6 * count)
  const normals = new Float64Array(6 * count).fill(Number.NaN)
  const uv = new Float64Array(4 * count)
  for (let k = 0; k < count; k++) {
    const [x, y, a, b] = [piece.xy[2 * k], piece.xy[2 * k + 1], piece.ab[2 * k], piece.ab[2 * k + 1]]
    positions.set([x, y, g(a, b)], 3 * k)
    positions.set([x, y, f(a, b)], 3 * (count + k))
    uv.set([k / (count - 1), 0], 2 * k)
    uv.set([k / (count - 1), 1], 2 * (count + k))
  }
  const indices = new Uint32Array(6 * (count - 1))
  for (let k = 0; k + 1 < count; k++) indices.set([k, k + 1, count + k + 1, k, count + k + 1, count + k], 6 * k)
  const mesh = finishMesh({ positions, normals, uv, indices }, false)
  if (mesh.indices.length === 0) return null
  return {
    kind: 'mesh',
    source: { ...context.source, object },
    ...mesh,
    scalars: null,
    style: { color: context.color, opacity, colorScale: null, meshLines: null },
    pick: null,
  }
}

function area(mesh: MeshMark): number {
  const p = mesh.positions
  let sum = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [3 * mesh.indices[t], 3 * mesh.indices[t + 1], 3 * mesh.indices[t + 2]]
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    sum += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2
  }
  return sum
}

// The diagonal of the box around every finite vertex of the meshes.
function diagonal(meshes: readonly MeshMark[]): number {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = m.positions[i + c]
        if (!Number.isFinite(v)) continue
        lo[c] = Math.min(lo[c], v)
        hi[c] = Math.max(hi[c], v)
      }
    }
  }
  return hi[0] >= lo[0] ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0
}

function prepareBetween(statement: Statement, context: BuildContext, solid: Extract<VolumeSolid, { kind: 'between' }>, style: SpaceStyle): PreparedStatement {
  const { scope, config } = context
  const { domain, name: regionName } = resolveDomain(context, solid.region)
  const n = resolution(style.res, config, DEFAULT_RES)
  checkBudget(4 * n * n, n)
  const reads = new Reads(scope)
  const region = prepareRegion2(domain, context, reads)
  const topExpr = targetExpr(solid.top, scope)
  const bottomExpr = solid.bottom ? targetExpr(solid.bottom, scope) : num(0)
  const f = compileOnRegion(topExpr, region.coords, scope, reads)
  const g = compileOnRegion(bottomExpr, region.coords, scope, reads)
  const opacity = style.opacity ?? VOLUME_OPACITY

  // The top and bottom are surfaces over the same domain, in one flat colour.
  // An inequality region is meshed on its own box (regions.ts): the surfaces
  // sample on that box too, set before each build, so the walls meet them
  // vertex for vertex.
  const surfaceConfig: GraphConfig = { ...config, space: { ...config.space, bounds: { ...config.space.bounds } } }
  const surface = (body: typeof topExpr, object: string, mesh: boolean | null) => {
    const surfaceStyle: SpaceStyle = { opacity, colormap: { by: { kind: 'none' }, map: null, diverging: false }, mesh, res: n, width: null, dashed: false }
    const s: Statement = { kind: 'space', form: { form: 'surface', body, domain, style: surfaceStyle }, color: statement.color, statementName: statement.statementName }
    const prepared = SURFACE.prepare(s, { ...context, config: surfaceConfig, source: { ...context.source, object }, colorScaleId: null })
    for (const name of prepared.reads) reads.names.add(name)
    return prepared
  }
  const top = surface(topExpr, context.source.object, style.mesh)
  const bottom = surface(bottomExpr, part(context, 'bottom').object, solid.bottom ? style.mesh : false)

  const R = regionName ?? 'R'
  const integrand = solid.bottom ? `(${solid.top.text} − ${targetText(solid.bottom)})` : targetText(solid.top)
  const note = `${targetText(solid.top)} < ${solid.bottom ? targetText(solid.bottom) : '0'} on part of ${R}; the integral counts that part negatively`

  const build = (): BuildResult => {
    // Sides sampled at n, as the top and bottom are, so the walls meet them
    // vertex for vertex.
    const r = region.build(n, n)
    const errors: SceneError[] = []
    const value = attempt(context, errors, () => determined(r.integrate((a, b) => f(a, b) - g(a, b))))
    if (r.box) {
      surfaceConfig.space.bounds.x = r.box.x
      surfaceConfig.space.bounds.y = r.box.y
    }
    const surfaces = [...top.build().marks, ...bottom.build().marks.map(facingDown)].filter((m): m is MeshMark => m.kind === 'mesh')
    const candidates = r.boundary.map((piece, i) => wallMark(piece, f, g, context, part(context, `wall${i}`).object, opacity))
    const size = diagonal([...surfaces, ...candidates.filter((w) => w !== null)])
    const walls = candidates.filter((w): w is MeshMark => w !== null && area(w) > COLLAPSED_REL * size * size)

    // f < g anywhere on the floor samples or the boundary, beyond rounding.
    // S5 breaker follow-up 2: an inequality region's own `samples` array
    // keeps every grid vertex the box was meshed at, including ones a
    // clipped-away triangle left behind (a box corner well outside the
    // curve, never part of any surviving triangle) — scanning those too
    // could add a large, genuine-looking negative gap from a point that
    // was never part of the region at all (the dome over x^2+y^2<=4: a
    // corner (-2.104, -2.104) reads 4 - x^2 - y^2 = -4.86, swamping the
    // true ~1e-15 floating noise at the actual boundary). Only vertices a
    // surviving triangle actually references are real samples of the
    // region; an iterated region's own samples are already every vertex of
    // its rectangle, all of them used, so this changes nothing there.
    const used = new Set<number>()
    for (const idx of r.samples.indices) used.add(idx)
    const gaps: number[] = []
    for (const v of used) gaps.push(f(r.samples.a[v], r.samples.b[v]) - g(r.samples.a[v], r.samples.b[v]))
    for (const piece of r.boundary) for (let k = 0; k < piece.ab.length; k += 2) gaps.push(f(piece.ab[k], piece.ab[k + 1]) - g(piece.ab[k], piece.ab[k + 1]))
    const scale = gaps.reduce((m, d) => (Number.isFinite(d) ? Math.max(m, Math.abs(d)) : m), 0)
    const crosses = gaps.some((d) => d < -1e-9 * scale)

    const marks: Mark[] = [...surfaces, ...walls]
    const topMark = surfaces.find((m) => m.source.object === context.source.object)
    let anchor: [number, number, number] = [0, 0, 0]
    if (topMark) {
      const p = topMark.positions
      let [sx, sy, zmax] = [0, 0, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        sx += p[i]
        sy += p[i + 1]
        zmax = Math.max(zmax, p[i + 2])
      }
      anchor = [(3 * sx) / p.length, (3 * sy) / p.length, zmax]
    }
    const labels = value
      ? [
          readoutLabel(
            context,
            anchor,
            `∬_${R} ${integrand} dA ${approxText(value)}${crosses ? `; ${note}` : ''}`,
            `∬_${R} ${integrand} dA ${approxTextFull(value)}${crosses ? `; ${note}` : ''}`,
          ),
        ]
      : []
    return { marks, labels, errors, colorScale: null }
  }
  return { reads: reads.names, build }
}

// The bottom surface seen from below: the solid's outside there. Normals
// negated, winding reversed, so its lit (front) side faces down.
function facingDown(mark: Mark): Mark {
  if (mark.kind !== 'mesh') return mark
  return { ...mark, normals: mark.normals.map((v) => -v), indices: reversedWinding(mark.indices) }
}

// The span of a sample array (S5 fix round 5): Infinity where empty, never
// negative — a finite bounding size for a centroid coordinate to be judged
// negligible against (centroids.ts, positionOrZero).
function span(values: Float64Array): number {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi >= lo ? hi - lo : Infinity
}

// The solid between z = g and z = f over R as something to integrate over
// (centroid: of a named volume): one triple integral, over R's own ranges
// then z from g to f, sharing one evaluation budget (or the mesh sum over an
// inequality region, the z integral at each midpoint).
export function prepareBetweenSolid(solid: Extract<VolumeSolid, { kind: 'between' }>, context: BuildContext, reads: Reads): PreparedSolid {
  const { scope, config } = context
  const { domain } = resolveDomain(context, solid.region)
  const n = resolution(null, config, DEFAULT_RES)
  const region = prepareRegion2(domain, context, reads)
  const f = compileOnRegion(targetExpr(solid.top, scope), region.coords, scope, reads)
  const g = compileOnRegion(solid.bottom ? targetExpr(solid.bottom, scope) : num(0), region.coords, scope, reads)
  const vars = [...region.vars, 'z']
  return {
    integrals(exprs: readonly Expr[]) {
      const hs = exprs.map((expr) => {
        reads.add(expr, ['x', 'y', 'z', 'r', 'theta'])
        return compileScalar(region.coords === 'polar' ? substitute(expr, POLAR_XY) : expr, vars, scope)
      })
      return () => {
        const r = region.build(n)
        const values = hs.map((h) => r.integrateSolid(h, g, f, [solid.bottom ? solid.bottom.text : '0', solid.top.text]))
        // z's own span: the solid runs from g to f at every sample, so its
        // extreme z is the extreme of both surfaces over every sample point
        // (the region's own mesh vertices, in its own coordinates).
        let zlo = Infinity
        let zhi = -Infinity
        for (let v = 0; v < r.samples.a.length; v++) {
          const fz = f(r.samples.a[v], r.samples.b[v])
          const gz = g(r.samples.a[v], r.samples.b[v])
          for (const z of [fz, gz]) {
            if (!Number.isFinite(z)) continue
            if (z < zlo) zlo = z
            if (z > zhi) zhi = z
          }
        }
        const extent: [number, number, number] = [span(r.samples.x), span(r.samples.y), zhi >= zlo ? zhi - zlo : Infinity]
        return { values, extent }
      }
    },
  }
}

// "volume: ..." in any form; "volume: V" draws the named volume.
function prepareVolume(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'volume')
  const { solid, name } = resolveSolid(context, form.solid)
  return solid.kind === 'between' ? prepareBetween(statement, context, solid, form.style) : prepareIterated(context, solid, form.style, name)
}

// "V = volume ...": built in full, so a bad expression or an integral with
// no value is refused on its own line, and nothing drawn.
function prepareNamedVolume(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'namedVolume')
  const { solid } = resolveSolid(context, form.solid)
  const style: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }
  const prepared = solid.kind === 'between' ? prepareBetween(statement, context, solid, style) : prepareIterated(context, solid, style, form.name)
  return { reads: prepared.reads, build: () => ({ marks: [], labels: [], errors: prepared.build().errors, colorScale: null }) }
}

export const VOLUME: BuilderEntry = { draws: true, prepare: prepareVolume }

export const NAMED_VOLUME: BuilderEntry = {
  draws: false,
  prepare: prepareNamedVolume,
  binds: (statement) => (statement.kind === 'space' && statement.form.form === 'namedVolume' ? statement.form.name : null),
}
