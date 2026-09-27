// lagrange: max|min|extrema f subject to g = c (S4b, B9; OpenStax 4.8).
//
// Two variables:
// - the constraint g = c is traced on the floor (contours.ts at level c);
// - up to 64 of its vertices, evenly spaced along the traced polylines, seed
//   Newton on F(x, y, λ) = (f_x − λ g_x, f_y − λ g_y, g − c) = 0, with λ
//   seeded by least squares, λ0 = (∇f·∇g)/(∇g·∇g);
// - solutions inside the domain are deduplicated (two closer than
//   ROOT_DEDUP_REL of the domain's diagonal are one; the first, in seed order,
//   stands), sorted lexicographically, and f is evaluated at each;
// - max keeps the greatest f (every solution within 1e-9 · max(1, |f|) of it),
//   min the least, extrema both;
// - each kept solution is judged against f sampled over the whole traced
//   constraint (judge): Lagrange finds only where ∇f ∥ ∇g, so when the
//   constraint runs out of the domain, f may be larger (or smaller) toward the
//   domain's edge. A solution that is not the sampled extreme is labelled by
//   its neighbourhood on the constraint — local max, local min, or critical
//   point on the constraint — with the note "f is larger toward the domain's
//   edge".
// Drawn: the constraint on the floor and lifted onto z = f; f's level curve
// through each kept point, on the floor; the kept points on the floor and
// lifted; ∇f and ∇g at each floor point, of fixed lengths — ∇f 0.15 of the
// domain's larger span (the arrows lie in the floor), ∇g 0.6 of that — so
// their parallelism reads, and both heads show when they point the same way
// (λ > 0). Readout per point: the point, f and λ, all ≈.
//
// Three variables (f or g reads z): seeds are points on g = c (the vertices
// of S4a's level-surface mesh once it merges; until then the crossings of
// g − c on the edges of a grid over the box, bisected onto g = c, which are
// where such a mesh's vertices lie), then Newton on the 4x4 system in
// (x, y, z, λ). All those points are the samples a solution is judged
// against. The points are marked with ∇f and ∇g (0.15 of the box's largest
// span); the constraint surface is drawn when levelSurface.ts has a mesher.
//
// Nothing found is an error on the line.

import type { Statement } from '../../../parser/types'
import { newton } from '../../../math/roots'
import { BISECTION_REL, ROOT_DEDUP_REL } from '../../../math/tolerance'
import type { Box3, LabelAnchor, Mark, MeshMark, Range, Vec3 } from '../../scene/types'
import { boundNames, constant, Reads, resolution } from '../common'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, arrowMark, clipToZ, largestSpan, lineMark, part, pointMark, toolBox } from './box'
import type { Rect } from './target'
import { LEVEL_RES, levelCurves, lift } from './contours'
import { MESH_LEVEL_SURFACE } from './levelSurface'
import { approx, approxPoint } from './readout'
import { prepareDomain, resolveTarget, surface2, surface3, type Target } from './target'

export const MAX_SEEDS = 64
const ARROW = 0.15
// ∇g's length as a fraction of ∇f's: at equal lengths two arrows pointing the
// same way would be one arrow.
const GRAD_G = 0.6
const TIE = 1e-9
// Newton's answers below this fraction of the domain's span print ≈ 0.
const RESOLVED = 1e-10
// Cubes per axis for the three-variable seeds, before S4a's mesh.
const SEED_GRID = 24
// A solution's neighbourhood on the constraint, for "local max" or "local
// min": the samples within this fraction of the domain's larger span.
const NEIGHBOURHOOD = 0.05
const CONSTRAINT_WIDTH = 2
const LEVEL_WIDTH = 1.5
const SURFACE_OPACITY = 0.35

export const NOTHING_FOUND = 'lagrange: no constrained extremum found; try a tighter @bounds3d'

interface Solution {
  at: number[]
  lambda: number
  f: number
}

// Up to `count` items, evenly spaced through the list.
export function evenly<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items]
  return Array.from({ length: count }, (_, k) => items[Math.floor((k * items.length) / count)])
}

// Solutions in seed order: converged, inside the domain, not a duplicate of an
// earlier one; then sorted lexicographically. "Inside" has the merge distance
// as slack — a solution on the domain's edge lands a rounding error either
// side of it — and one within the slack is clamped onto the edge.
function collect(candidates: readonly Solution[], ranges: readonly Range[], merge: number): Solution[] {
  const kept: Solution[] = []
  for (const candidate of candidates) {
    if (!candidate.at.every(Number.isFinite) || !Number.isFinite(candidate.lambda) || !Number.isFinite(candidate.f)) continue
    if (!candidate.at.every((v, i) => v >= ranges[i].min - merge && v <= ranges[i].max + merge)) continue
    const s = { ...candidate, at: candidate.at.map((v, i) => Math.min(ranges[i].max, Math.max(ranges[i].min, v))) }
    if (kept.some((k) => Math.hypot(...k.at.map((v, i) => v - s.at[i])) <= merge)) continue
    kept.push(s)
  }
  return kept.sort((a, b) => {
    for (let i = 0; i < a.at.length; i++) if (a.at[i] !== b.at[i]) return a.at[i] - b.at[i]
    return 0
  })
}

export type Kept = 'max' | 'min' | 'extremum'
export type Kind = Kept | 'local max' | 'local min' | 'critical point on the constraint'

interface Sample {
  at: readonly number[]
  f: number
}

// Each kept solution judged against f sampled over the constraint: a max
// stands when no sample exceeds it (within the tie tolerance), a min when
// none is below it. One that does not stand is named by the samples within
// `radius` of it — all no greater: a local max; all no less: a local min;
// otherwise a critical point on the constraint — with a note saying which
// way f goes toward the domain's edge.
export function judge(kept: readonly { s: Solution; kind: Kept }[], samples: readonly Sample[], radius: number): { s: Solution; kind: Kind; note: string }[] {
  const values = samples.map((p) => p.f)
  const tie = TIE * Math.max(1, ...values.map(Math.abs), ...kept.map(({ s }) => Math.abs(s.f)))
  const high = Math.max(...values)
  const low = Math.min(...values)
  return kept.map(({ s, kind }) => {
    const isMax = !(high > s.f + tie)
    const isMin = !(low < s.f - tie)
    if (kind === 'extremum' && isMax && isMin) return { s, kind, note: '' }
    if (kind !== 'min' && isMax) return { s, kind: 'max', note: '' }
    if (kind !== 'max' && isMin) return { s, kind: 'min', note: '' }
    const near = samples.filter((p) => Math.hypot(...p.at.map((v, i) => v - s.at[i])) <= radius)
    const local: Kind =
      near.length === 0
        ? 'critical point on the constraint'
        : near.every((p) => p.f <= s.f + tie)
          ? 'local max'
          : near.every((p) => p.f >= s.f - tie)
            ? 'local min'
            : 'critical point on the constraint'
    const way = kind === 'max' ? 'larger' : kind === 'min' ? 'smaller' : 'larger and smaller'
    return { s, kind: local, note: ` — f is ${way} toward the domain's edge` }
  })
}

// The solutions the goal keeps, each with the kind it is. Under extrema, when
// every solution has the same f (one solution, say), each is the greatest and
// the least at once: an extremum, not a max or a min.
export function choose(solutions: readonly Solution[], goal: 'max' | 'min' | 'extrema'): { s: Solution; kind: Kept }[] {
  if (solutions.length === 0) return []
  const values = solutions.map((s) => s.f)
  const tie = TIE * Math.max(1, ...values.map(Math.abs))
  const high = Math.max(...values)
  const low = Math.min(...values)
  const out: { s: Solution; kind: Kept }[] = []
  for (const s of solutions) {
    if (goal === 'extrema' && high - low <= tie) out.push({ s, kind: 'extremum' })
    else if (goal !== 'min' && s.f >= high - tie) out.push({ s, kind: 'max' })
    else if (goal !== 'max' && s.f <= low + tie) out.push({ s, kind: 'min' })
  }
  return out
}

// Points on h = 0: the crossings of h's sign on the edges of an n^3 grid over
// the box, bisected along their edge to BISECTION_REL of it, in grid order.
export function crossingSeeds(h: (x: number, y: number, z: number) => number, box: Box3, n: number): number[][] {
  const axes = [box.x, box.y, box.z].map((r) => Array.from({ length: n + 1 }, (_, i) => r.min + ((r.max - r.min) * i) / n))
  const at = (i: number, j: number, k: number) => h(axes[0][i], axes[1][j], axes[2][k])
  const values: number[] = []
  for (let k = 0; k <= n; k++) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) values.push(at(i, j, k))
  const value = (i: number, j: number, k: number) => values[(k * (n + 1) + j) * (n + 1) + i]
  const out: number[][] = []
  for (let k = 0; k <= n; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = value(i, j, k)
        const p = [axes[0][i], axes[1][j], axes[2][k]]
        for (const [di, dj, dk, axis] of [
          [1, 0, 0, 0],
          [0, 1, 0, 1],
          [0, 0, 1, 2],
        ] as const) {
          if (i + di > n || j + dj > n || k + dk > n) continue
          const w = value(i + di, j + dj, k + dk)
          if (!Number.isFinite(v) || !Number.isFinite(w) || v > 0 === w > 0) continue
          const q = [...p]
          const next = axes[axis][[i, j, k][axis] + 1]
          const along = (u: number) => {
            q[axis] = p[axis] + u * (next - p[axis])
            return h(q[0], q[1], q[2])
          }
          let lo = 0
          let hi = 1
          let hlo = v
          while (hi - lo > BISECTION_REL) {
            const m = (lo + hi) / 2
            const hm = along(m)
            if (hm > 0 === hlo > 0) {
              lo = m
              hlo = hm
            } else {
              hi = m
            }
          }
          along((lo + hi) / 2)
          out.push(q)
        }
      }
    }
  }
  return out
}

function within3(t: Target): Target {
  return { arity: 3, body: t.body, vars: boundNames(3) }
}

function prepareLagrange(statement: Statement, context: BuildContext): PreparedStatement {
  if (statement.kind !== 'space' || statement.form.form !== 'lagrange') throw new Error(`not a lagrange: ${statement.kind}`)
  const form = statement.form
  const { scope, config } = context
  const reads = new Reads(scope)
  const fTarget = resolveTarget(form.target, scope, reads, 'lagrange')
  const gTarget = resolveTarget(form.constraint, scope, reads, 'lagrange')
  reads.add(form.level)
  const level = constant(form.level, scope)
  const domain = prepareDomain(form.over, config, scope, reads)
  const readout = (kind: string, s: Solution, span: number, scale: number, note: string) =>
    `${kind} ${approxPoint(s.at, RESOLVED * span)}, f ${approx(s.f, RESOLVED * scale)}, λ ${approx(s.lambda, RESOLVED * Math.max(1, Math.abs(s.lambda)))}${note}`
  const larger = (rect: Rect) => Math.max(rect.x.max - rect.x.min, rect.y.max - rect.y.min)

  if (fTarget.arity === 2 && gTarget.arity === 2) {
    const F = surface2(fTarget, scope)
    const G = surface2(gTarget, scope)
    const res = resolution(form.style.res, config, LEVEL_RES)
    const build = (): BuildResult => {
      const rect = domain()
      const c = level()
      const constraint = levelCurves((x, y) => G.f(x, y) - c, rect, res)
      const vertices: [number, number][] = []
      for (const line of constraint) {
        const closed = line.length > 2 && line[0] === line[line.length - 2] && line[1] === line[line.length - 1]
        for (let i = 0; i < line.length - (closed ? 2 : 0); i += 2) vertices.push([line[i], line[i + 1]])
      }
      const candidates: Solution[] = []
      for (const [x0, y0] of evenly(vertices, MAX_SEEDS)) {
        const gx = G.fx(x0, y0)
        const gy = G.fy(x0, y0)
        const gg = gx * gx + gy * gy
        const lambda0 = gg > 0 ? (F.fx(x0, y0) * gx + F.fy(x0, y0) * gy) / gg : 0
        const result = newton(
          (v) => [F.fx(v[0], v[1]) - v[2] * G.fx(v[0], v[1]), F.fy(v[0], v[1]) - v[2] * G.fy(v[0], v[1]), G.f(v[0], v[1]) - c],
          (v) => {
            const [x, y, l] = v
            const b = F.fxy(x, y) - l * G.fxy(x, y)
            return [
              [F.fxx(x, y) - l * G.fxx(x, y), b, -G.fx(x, y)],
              [b, F.fyy(x, y) - l * G.fyy(x, y), -G.fy(x, y)],
              [G.fx(x, y), G.fy(x, y), 0],
            ]
          },
          [x0, y0, lambda0]
        )
        if (result.converged) candidates.push({ at: [result.x[0], result.x[1]], lambda: result.x[2], f: F.f(result.x[0], result.x[1]) })
      }
      const span = larger(rect)
      const chosen = choose(collect(candidates, [rect.x, rect.y], ROOT_DEDUP_REL * Math.hypot(rect.x.max - rect.x.min, rect.y.max - rect.y.min)), form.goal)
      if (chosen.length === 0) throw new Error(NOTHING_FOUND)
      const samples: Sample[] = []
      for (const [x, y] of vertices) {
        const value = F.f(x, y)
        if (Number.isFinite(value)) samples.push({ at: [x, y], f: value })
      }
      const kept = judge(chosen, samples, NEIGHBOURHOOD * span)

      const box = toolBox(context, rect, (x, y) => F.f(x, y))
      const floor = box.z.min
      const marks: Mark[] = []
      const labels: LabelAnchor[] = []
      marks.push(lineMark(part(context, 'constraint'), constraint.map((l) => lift(l, () => floor)), context, { width: CONSTRAINT_WIDTH }))
      // The constraint lifted onto z = f, split where f is undefined. It is
      // sampled, carrying its arc length in the plane as its parameter, and
      // cut to the box: a pole on the constraint does not stretch the frame.
      const lifted: number[][] = []
      const arcs: number[][] = []
      let arc = 0
      for (const line of constraint) {
        let run: number[] = []
        let runArcs: number[] = []
        const close = () => {
          if (runArcs.length > 1) {
            lifted.push(run)
            arcs.push(runArcs)
          }
          run = []
          runArcs = []
        }
        for (let i = 0; i < line.length; i += 2) {
          if (i > 0) arc += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1])
          const z = F.f(line[i], line[i + 1])
          if (!Number.isFinite(z)) {
            close()
            continue
          }
          run.push(line[i], line[i + 1], z)
          runArcs.push(arc)
        }
        close()
      }
      const onBox = clipToZ(lifted, arcs, box.z)
      if (onBox.runs.length > 0) {
        marks.push(lineMark(context.source, onBox.runs, context, { width: CONSTRAINT_WIDTH, params: Float64Array.from(onBox.params.flat()) }))
      }
      // The arrows lie in the floor: sized by its span, not the box's height.
      const length = ARROW * span
      const scale = Math.max(1, ...kept.map(({ s }) => Math.abs(s.f)))
      kept.forEach(({ s, kind, note }, k) => {
        const [x, y] = s.at
        const through = levelCurves((u, v) => F.f(u, v) - s.f, rect, res)
        if (through.length > 0) marks.push(lineMark(part(context, `level${k}`), through.map((l) => lift(l, () => floor)), context, { width: LEVEL_WIDTH }))
        const tail: Vec3 = [x, y, floor]
        for (const [name, gx, gy, size] of [
          ['∇f', F.fx(x, y), F.fy(x, y), length],
          ['∇g', G.fx(x, y), G.fy(x, y), GRAD_G * length],
        ] as const) {
          const norm = Math.hypot(gx, gy)
          if (!(norm > 0)) continue
          const vector: Vec3 = [(gx / norm) * size, (gy / norm) * size, 0]
          const object = name === '∇f' ? 'gradf' : 'gradg'
          marks.push(arrowMark(part(context, `${object}${k}`), [{ tail, vector }], context))
          labels.push({ source: part(context, `${object}${k}.label`), position: [x + vector[0], y + vector[1], floor], text: name, kind: 'point' })
        }
        labels.push(annotation(part(context, `p${k}`), [x, y, s.f], readout(kind, s, span, scale, note)))
      })
      marks.push(pointMark(part(context, 'floorPoints'), kept.map(({ s }) => [s.at[0], s.at[1], floor]), context))
      marks.push(pointMark(part(context, 'points'), kept.map(({ s }) => [s.at[0], s.at[1], s.f]), context))
      return { marks, labels, errors: [], colorScale: null }
    }
    return { reads: reads.names, build }
  }

  const F = surface3(within3(fTarget), scope)
  const G = surface3(within3(gTarget), scope)
  const build = (): BuildResult => {
    const box = toolBox(context, domain(), null)
    const c = level()
    const h = (x: number, y: number, z: number) => G.F(x, y, z) - c
    const mesh = MESH_LEVEL_SURFACE ? MESH_LEVEL_SURFACE(h, 0, box, SEED_GRID) : null
    const points: number[][] = []
    if (mesh) for (let i = 0; i < mesh.positions.length; i += 3) points.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]])
    else points.push(...crossingSeeds(h, box, SEED_GRID))
    const candidates: Solution[] = []
    for (const [x0, y0, z0] of evenly(points, MAX_SEEDS)) {
      const g = G.grad.map((d) => d(x0, y0, z0))
      const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
      const lambda0 = gg > 0 ? F.grad.reduce((sum, d, i) => sum + d(x0, y0, z0) * g[i], 0) / gg : 0
      const result = newton(
        (v) => [0, 1, 2].map((i) => F.grad[i](v[0], v[1], v[2]) - v[3] * G.grad[i](v[0], v[1], v[2])).concat(h(v[0], v[1], v[2])),
        (v) => {
          const [x, y, z, l] = v
          const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => F.hessian[i][j](x, y, z) - l * G.hessian[i][j](x, y, z)).concat(-G.grad[i](x, y, z)))
          return [...rows, [G.grad[0](x, y, z), G.grad[1](x, y, z), G.grad[2](x, y, z), 0]]
        },
        [x0, y0, z0, lambda0]
      )
      if (result.converged) candidates.push({ at: [result.x[0], result.x[1], result.x[2]], lambda: result.x[3], f: F.F(result.x[0], result.x[1], result.x[2]) })
    }
    const diagonal = Math.hypot(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min)
    const chosen = choose(collect(candidates, [box.x, box.y, box.z], ROOT_DEDUP_REL * diagonal), form.goal)
    if (chosen.length === 0) throw new Error(NOTHING_FOUND)
    const samples: Sample[] = []
    for (const at of points) {
      const value = F.F(at[0], at[1], at[2])
      if (Number.isFinite(value)) samples.push({ at, f: value })
    }
    const kept = judge(chosen, samples, NEIGHBOURHOOD * largestSpan(box))

    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    if (mesh) {
      const surface: MeshMark = {
        kind: 'mesh',
        source: part(context, 'constraint'),
        ...mesh,
        scalars: null,
        uv: null,
        style: { color: context.color, opacity: SURFACE_OPACITY, colorScale: null, meshLines: null },
        pick: null,
      }
      marks.push(surface)
    }
    marks.push(pointMark(context.source, kept.map(({ s }): Vec3 => [s.at[0], s.at[1], s.at[2]]), context))
    const length = ARROW * largestSpan(box)
    const scale = Math.max(1, ...kept.map(({ s }) => Math.abs(s.f)))
    kept.forEach(({ s, kind, note }, k) => {
      const tail: Vec3 = [s.at[0], s.at[1], s.at[2]]
      for (const [name, grad, size] of [
        ['∇f', F.grad, length],
        ['∇g', G.grad, GRAD_G * length],
      ] as const) {
        const d = grad.map((fn) => fn(tail[0], tail[1], tail[2]))
        const norm = Math.hypot(...d)
        if (!(norm > 0)) continue
        const vector: Vec3 = [(d[0] / norm) * size, (d[1] / norm) * size, (d[2] / norm) * size]
        const object = name === '∇f' ? 'gradf' : 'gradg'
        marks.push(arrowMark(part(context, `${object}${k}`), [{ tail, vector }], context))
        labels.push({ source: part(context, `${object}${k}.label`), position: [tail[0] + vector[0], tail[1] + vector[1], tail[2] + vector[2]], text: name, kind: 'point' })
      }
      labels.push(annotation(part(context, `p${k}`), tail, readout(kind, s, diagonal, scale, note)))
    })
    return { marks, labels, errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

export const LAGRANGE: BuilderEntry = { draws: true, prepare: prepareLagrange }
