// z = f(x, y): the existing surface statement and space's surface form, over
// the box or a domain (K8, K10). One MeshMark: (u, v) = (x, y), scalars and a
// colour scale by height unless the style says otherwise, mesh lines at the x
// and y nice steps (K9), analytic normals, and a pick that re-evaluates the
// true function and its partials.
//
// A polar domain is sampled in (r, theta): the body, with x = r cos(theta)
// and y = r sin(theta) substituted, may read r and theta itself. Its normal is
// (-f_x, -f_y, 1) by the chain rule from g_r and g_theta. When the body reads
// r or theta the surface need not be a graph over (x, y) (z = theta over a
// full turn is a helicoid), so its pick is parametric in (r, theta).

import type { GraphConfig } from '../../parser/config'
import type { Expr, Statement } from '../../parser/types'
import { compileScalar, type CompiledFn } from '../../math/compile'
import { diff } from '../../math/diff'
import { call, mul, substitute, variable, varNames } from '../../math/expr'
import type { MathScope } from '../../math/scope'
import { simplify } from '../../math/simplify'
import { stepFor } from '../frame/nice'
import type { Domain, RegionCondition, SpaceStyle } from '../grammar/types'
import type { MeshMark, Range, SurfacePick } from '../scene/types'
import {
  boundNames,
  boxX,
  boxY,
  checkBudget,
  colorScale,
  constant,
  Reads,
  renameBound,
  resolution,
  surfaceColormap,
} from './common'
import { inequalitySamples, iteratedSamples, rectSamples, type Condition, type DomainSamples } from './domain'
import { finishMesh } from './mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from './registry'

const DEFAULT_RES = 96

const NO_STYLE: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }

function surfaceParts(statement: Statement): { body: Expr; domain: Domain | null; style: SpaceStyle } {
  if (statement.kind === 'surface') return { body: statement.body, domain: null, style: NO_STYLE }
  if (statement.kind === 'space' && statement.form.form === 'surface') return statement.form
  throw new Error(`not a surface: ${statement.kind}`)
}

// d/d(bound i) of an expression already renamed to $0, $1, compiled.
function partial(expr: Expr, i: number, scope: MathScope): CompiledFn {
  const vars = boundNames(2)
  return compileScalar(simplify(diff(expr, vars[i], scope)), vars, scope)
}

// h(x, y) <= 0 inside, for each comparison of each condition.
function compileConditions(conditions: readonly RegionCondition[], scope: MathScope, reads: Reads): Condition[] {
  const out: Condition[] = []
  const side = (e: Expr) => {
    reads.add(e, ['x', 'y'])
    return compileScalar(e, ['x', 'y'], scope)
  }
  for (const c of conditions) {
    if (c.kind === 'region') {
      const left = side(c.left)
      const right = side(c.right)
      out.push({ h: c.op === '<' || c.op === '<=' ? (x, y) => left(x, y) - right(x, y) : (x, y) => right(x, y) - left(x, y) })
    } else {
      const low = side(c.low)
      const mid = side(c.mid)
      const high = side(c.high)
      out.push({ h: (x, y) => low(x, y) - mid(x, y) })
      out.push({ h: (x, y) => mid(x, y) - high(x, y) })
    }
  }
  return out
}

interface Sampler {
  samples(): DomainSamples
}

function prepareDomain(domain: Domain | null, config: GraphConfig, scope: MathScope, reads: Reads, n: number): Sampler {
  if (domain === null) return { samples: () => rectSamples(boxX(config), boxY(config), n) }
  switch (domain.kind) {
    case 'rect': {
      const [x0, x1, y0, y1] = [domain.x.from, domain.x.to, domain.y.from, domain.y.to].map((e) => {
        reads.add(e)
        return constant(e, scope)
      })
      return { samples: () => rectSamples({ min: x0(), max: x1() }, { min: y0(), max: y1() }, n) }
    }
    case 'iterated': {
      const { outer, inner, coords } = domain
      const u0 = constant(outer.from, scope)
      const u1 = constant(outer.to, scope)
      const lo = compileScalar(inner.from, [outer.param], scope)
      const hi = compileScalar(inner.to, [outer.param], scope)
      reads.add(outer.from).add(outer.to).add(inner.from, [outer.param]).add(inner.to, [outer.param])
      const polar = coords === 'polar' ? { outerIsR: outer.param === 'r', angle: scope.angle === 'degrees' ? Math.PI / 180 : 1 } : null
      return {
        samples: () =>
          iteratedSamples(
            { outer: outer.param, outerRange: { min: u0(), max: u1() }, lo: (u) => lo(u), hi: (u) => hi(u), polar, outerIsX: outer.param === 'x' },
            n
          ),
      }
    }
    case 'inequality': {
      const conditions = compileConditions(domain.conditions, scope, reads)
      return { samples: () => inequalitySamples(conditions, boxX(config), boxY(config), n) }
    }
    case 'named':
      throw new Error(`named regions arrive with region: (phase S5) — "over ${domain.name}" cannot be drawn yet`)
  }
}

function prepareSurface(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  const { body, domain, style } = surfaceParts(statement)
  const n = resolution(style.res, config, DEFAULT_RES)
  checkBudget(2 * n * n, n)

  const reads = new Reads(scope)
  const polar = domain?.kind === 'iterated' && domain.coords === 'polar'
  const vars = boundNames(2)
  const sampler = prepareDomain(domain, config, scope, reads, n)

  // z and its normal at a sample (a, b): (x, y) or (r, theta).
  let height: CompiledFn
  let normal: (a: number, b: number, out: Float64Array) => void
  let pick: SurfacePick
  const angle = scope.angle === 'degrees' ? Math.PI / 180 : 1
  if (polar) {
    reads.add(body, ['x', 'y', 'r', 'theta'])
    const polarBody = renameBound(
      substitute(
        body,
        new Map([
          ['x', mul(variable('r'), call('cos', variable('theta')))],
          ['y', mul(variable('r'), call('sin', variable('theta')))],
        ])
      ),
      ['r', 'theta']
    )
    height = compileScalar(polarBody, vars, scope)
    const gr = partial(polarBody, 0, scope)
    const gt = partial(polarBody, 1, scope)
    normal = (r, theta, out) => {
      const c = Math.cos(theta * angle)
      const s = Math.sin(theta * angle)
      const dr = gr(r, theta)
      const dt = gt(r, theta) / (r * angle)
      out[0] = -(dr * c - dt * s)
      out[1] = -(dr * s + dt * c)
      out[2] = 1
    }
    const names = varNames(body)
    if (names.has('r') || names.has('theta')) {
      pick = {
        kind: 'parametric',
        param: ['r', 'theta'],
        r: (r, theta) => [r * Math.cos(theta * angle), r * Math.sin(theta * angle), height(r, theta)],
      }
    } else {
      const xyBody = renameBound(body, ['x', 'y'])
      const f = compileScalar(xyBody, vars, scope)
      pick = { kind: 'graph', f: (x, y) => f(x, y), fx: partial(xyBody, 0, scope), fy: partial(xyBody, 1, scope) }
    }
  } else {
    reads.add(body, ['x', 'y'])
    const xyBody = renameBound(body, ['x', 'y'])
    height = compileScalar(xyBody, vars, scope)
    const fx = partial(xyBody, 0, scope)
    const fy = partial(xyBody, 1, scope)
    normal = (x, y, out) => {
      out[0] = -fx(x, y)
      out[1] = -fy(x, y)
      out[2] = 1
    }
    pick = { kind: 'graph', f: (x, y) => height(x, y), fx: (x, y) => fx(x, y), fy: (x, y) => fy(x, y) }
  }

  const clause = surfaceColormap(statement)
  let paint: CompiledFn | null = null
  if (clause.by.kind === 'expr') {
    reads.add(clause.by.expr, ['x', 'y', 'z'])
    paint = compileScalar(clause.by.expr, ['x', 'y', 'z'], scope)
  }

  const build = (): BuildResult => {
    const samples = sampler.samples()
    const count = samples.x.length
    const positions = new Float64Array(3 * count)
    const normals = new Float64Array(3 * count)
    const uv = new Float64Array(2 * count)
    const out = new Float64Array(3)
    for (let v = 0; v < count; v++) {
      const x = samples.x[v]
      const y = samples.y[v]
      positions[3 * v] = x
      positions[3 * v + 1] = y
      positions[3 * v + 2] = height(samples.a[v], samples.b[v])
      normal(samples.a[v], samples.b[v], out)
      normals[3 * v] = out[0]
      normals[3 * v + 1] = out[1]
      normals[3 * v + 2] = out[2]
      uv[2 * v] = x
      uv[2 * v + 1] = y
    }
    const mesh = finishMesh({ positions, normals, uv, indices: samples.indices }, true)
    if (mesh.indices.length === 0) return { marks: [], labels: [], errors: [], colorScale: null }

    const vertices = mesh.positions.length / 3
    let scalars: Float64Array | null = null
    let scale = null
    if (clause.by.kind !== 'none' && context.colorScaleId !== null) {
      scalars = new Float64Array(vertices)
      for (let v = 0; v < vertices; v++) {
        const z = mesh.positions[3 * v + 2]
        scalars[v] = paint ? paint(mesh.positions[3 * v], mesh.positions[3 * v + 1], z) : z
      }
      scale = colorScale(clause, scalars, config, context.colorScaleId)
    }

    let meshLines = null
    if (style.mesh !== false) {
      const xr: Range = { min: Infinity, max: -Infinity }
      const yr: Range = { min: Infinity, max: -Infinity }
      for (let v = 0; v < vertices; v++) {
        const x = mesh.positions[3 * v]
        const y = mesh.positions[3 * v + 1]
        if (x < xr.min) xr.min = x
        if (x > xr.max) xr.max = x
        if (y < yr.min) yr.min = y
        if (y > yr.max) yr.max = y
      }
      meshLines = {
        u0: 0,
        du: stepFor(xr.max - xr.min, 8, config.space.ticks.x),
        v0: 0,
        dv: stepFor(yr.max - yr.min, 8, config.space.ticks.y),
      }
    }

    const mark: MeshMark = {
      kind: 'mesh',
      source: context.source,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      scalars,
      uv: mesh.uv,
      style: { color: context.color, opacity: style.opacity ?? 1, colorScale: scale ? scale.id : null, meshLines },
      pick,
    }
    return { marks: [mark], labels: [], errors: [], colorScale: scale }
  }

  return { reads: reads.names, build }
}

export const SURFACE: BuilderEntry = {
  draws: true,
  prepare: prepareSurface,
  colorScale: (statement) => surfaceColormap(statement).by.kind !== 'none',
}
