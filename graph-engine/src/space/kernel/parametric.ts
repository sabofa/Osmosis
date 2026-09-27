// (fx, fy, fz) for u in [..], v in [..]: the existing parametric surface and
// space's styled one (K8). One MeshMark: (u, v) per vertex, normals r_u x r_v
// from symbolic derivatives (the face fallback at a pole), mesh lines at the
// nice u and v steps (target 12), a flat colour unless the style colours it,
// and a parametric pick.

import type { Expr, Statement } from '../../parser/types'
import { compileMany, compileScalar, compileVector, type CompiledFn } from '../../math/compile'
import { diff } from '../../math/diff'
import { simplify } from '../../math/simplify'
import { niceStep } from '../frame/nice'
import type { SpaceStyle } from '../grammar/types'
import type { MeshMark } from '../scene/types'
import { boundNames, checkBudget, colorScale, constant, parametricColormap, Reads, renameBound, resolution } from './common'
import { finishMesh, gridIndices, reversedWinding } from './mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from './registry'

const DEFAULT_RES = 96

interface Parts {
  f: [Expr, Expr, Expr]
  u: { param: string; from: Expr; to: Expr }
  v: { param: string; from: Expr; to: Expr }
  style: SpaceStyle | null
}

function parts(statement: Statement): Parts {
  if (statement.kind === 'parametricSurface') {
    return {
      f: [statement.fx, statement.fy, statement.fz],
      u: { param: statement.paramU, from: statement.uFrom, to: statement.uTo },
      v: { param: statement.paramV, from: statement.vFrom, to: statement.vTo },
      style: null,
    }
  }
  if (statement.kind === 'space' && statement.form.form === 'parametricSurface') {
    const { fx, fy, fz, u, v, style } = statement.form
    return { f: [fx, fy, fz], u, v, style }
  }
  throw new Error(`not a parametric surface: ${statement.kind}`)
}

function preparedParametric(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  const { f, u, v, style } = parts(statement)
  const n = resolution(style?.res ?? null, config, DEFAULT_RES)
  checkBudget(2 * n * n, n)

  const reads = new Reads(scope)
  const vars = boundNames(2)
  const renamed = f.map((e) => {
    reads.add(e, [u.param, v.param])
    return renameBound(e, [u.param, v.param])
  }) as [Expr, Expr, Expr]
  // r (for the pick), and r, r_u, r_v in one frame for sampling: they share
  // most of their terms, which compileMany computes once per vertex.
  const r = compileVector(renamed, vars, scope)
  const partial = (i: number) => renamed.map((e) => simplify(diff(e, vars[i], scope)))
  const sample = compileMany([...renamed, ...partial(0), ...partial(1)], vars, scope)
  const [u0, u1, v0, v1] = [u.from, u.to, v.from, v.to].map((e) => {
    reads.add(e)
    return constant(e, scope)
  })

  const clause = parametricColormap(statement)
  let paint: CompiledFn | null = null
  if (clause.by.kind === 'expr') {
    reads.add(clause.by.expr, ['x', 'y', 'z'])
    paint = compileScalar(clause.by.expr, ['x', 'y', 'z'], scope)
  }

  const build = (): BuildResult => {
    const [ua, ub, va, vb] = [u0(), u1(), v0(), v1()]
    const count = (n + 1) * (n + 1)
    const positions = new Float64Array(3 * count)
    const normals = new Float64Array(3 * count)
    const uv = new Float64Array(2 * count)
    // x y z, then r_u, then r_v
    const s = new Float64Array(9)
    for (let j = 0; j <= n; j++) {
      const vv = va + (vb - va) * (j / n)
      for (let i = 0; i <= n; i++) {
        const uu = ua + (ub - ua) * (i / n)
        const k = j * (n + 1) + i
        sample(s, uu, vv)
        positions[3 * k] = s[0]
        positions[3 * k + 1] = s[1]
        positions[3 * k + 2] = s[2]
        // r_u x r_v
        normals[3 * k] = s[4] * s[8] - s[5] * s[7]
        normals[3 * k + 1] = s[5] * s[6] - s[3] * s[8]
        normals[3 * k + 2] = s[3] * s[7] - s[4] * s[6]
        uv[2 * k] = uu
        uv[2 * k + 1] = vv
      }
    }
    // The grid winds counter-clockwise in (u, v), which r_u x r_v follows; a
    // range written high-to-low reverses one axis, and so the winding.
    const grid = (ub - ua) * (vb - va) < 0 ? reversedWinding(gridIndices(n)) : gridIndices(n)
    const mesh = finishMesh({ positions, normals, uv, indices: grid }, false)
    if (mesh.indices.length === 0) return { marks: [], labels: [], errors: [], colorScale: null }

    const vertices = mesh.positions.length / 3
    let scalars: Float64Array | null = null
    let scale = null
    if (clause.by.kind !== 'none' && context.colorScaleId !== null) {
      scalars = new Float64Array(vertices)
      for (let k = 0; k < vertices; k++) {
        const [x, y, z] = [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]]
        scalars[k] = paint ? paint(x, y, z) : z
      }
      scale = colorScale(clause, scalars, config, context.colorScaleId)
    }

    const mark: MeshMark = {
      kind: 'mesh',
      source: context.source,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      scalars,
      uv: mesh.uv,
      style: {
        color: context.color,
        opacity: style?.opacity ?? 1,
        colorScale: scale ? scale.id : null,
        meshLines: style?.mesh === false ? null : { u0: 0, du: niceStep(Math.abs(ub - ua), 12), v0: 0, dv: niceStep(Math.abs(vb - va), 12) },
      },
      pick: {
        kind: 'parametric',
        param: [u.param, v.param],
        r: (a, b) => {
          const out = r(new Float64Array(3), a, b)
          return [out[0], out[1], out[2]]
        },
      },
    }
    return { marks: [mark], labels: [], errors: [], colorScale: scale }
  }

  return { reads: reads.names, build }
}

export const PARAMETRIC_SURFACE: BuilderEntry = {
  draws: true,
  prepare: preparedParametric,
  colorScale: (statement) => parametricColormap(statement).by.kind !== 'none',
}
