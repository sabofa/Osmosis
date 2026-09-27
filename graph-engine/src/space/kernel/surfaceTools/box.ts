// The box a surface tool draws into, and the marks it draws with (S4b).
//
// A floor copy, a slicing plane and a tangent line must reach the walls of
// the box the frame draws. Since the box pass (integration J1) every tool is
// box-dependent: the kernel resolves the box from the statements that define
// the scene (the surface z = f the author draws beside the tool, above all)
// and hands it to the tool, and toolBox returns it. With nothing else drawn
// it is @bounds3d, else [-5, 5] on each axis.
//
// Slicing planes are box-clipped patches built here. A vertical plane meets
// the box in a rectangle, which rectPatch draws exactly; a general plane (the
// tangent plane) is clipped as a convex polygon. S4a owns the exact
// plane-and-box polygon (kernel/geometry/planes.ts); at the merge a
// general-plane patch here can be drawn by it instead.

import type { ArrowMark, Box3, ColorSpec, LabelAnchor, LineMark, MarkSource, MeshMark, PointMark, PointShape, Range, Vec3 } from '../../scene/types'
import { DASH } from '../common'
import { boxOf, type BuildContext } from '../registry'

// THE box a tool draws into: every surface tool calls this. It is the box
// the kernel resolved from the other statements (J1), or the renderer's
// frozen box during play and drag.
export function toolBox(context: BuildContext): Box3 {
  return boxOf(context)
}

export function largestSpan(box: Box3): number {
  return Math.max(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min)
}

// The parameter interval [s0, s1] over which p + s d lies in the box (slab
// clipping), or null when the line misses it.
export function clipLine(p: Vec3, d: Vec3, box: Box3): [number, number] | null {
  let s0 = -Infinity
  let s1 = Infinity
  const ranges = [box.x, box.y, box.z]
  for (let k = 0; k < 3; k++) {
    const r = ranges[k]
    if (d[k] === 0) {
      if (p[k] < r.min || p[k] > r.max) return null
      continue
    }
    let a = (r.min - p[k]) / d[k]
    let b = (r.max - p[k]) / d[k]
    if (a > b) [a, b] = [b, a]
    s0 = Math.max(s0, a)
    s1 = Math.min(s1, b)
  }
  return s0 <= s1 ? [s0, s1] : null
}

// A convex polygon clipped to the box (Sutherland-Hodgman against its six
// faces); vertices move only along edges, so a planar polygon stays planar.
export function clipPolygon(polygon: readonly Vec3[], box: Box3): Vec3[] {
  let out: Vec3[] = [...polygon]
  const ranges = [box.x, box.y, box.z]
  for (let k = 0; k < 3; k++) {
    for (const [bound, keep] of [
      [ranges[k].min, 1],
      [ranges[k].max, -1],
    ] as const) {
      const inside = (p: Vec3) => keep * (p[k] - bound) >= 0
      const next: Vec3[] = []
      for (let i = 0; i < out.length; i++) {
        const a = out[i]
        const b = out[(i + 1) % out.length]
        if (inside(a)) next.push(a)
        if (inside(a) !== inside(b)) {
          const t = (bound - a[k]) / (b[k] - a[k])
          next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])])
        }
      }
      out = next
      if (out.length === 0) return out
    }
  }
  return out
}

// Sampled polylines (flat xyz, with a parameter per vertex) cut to the box's
// z range exactly where they cross it — where the renderer clips too — with
// the parameter interpolated alike. A tool draws nothing outside the box it
// draws into: a curve through a pole would otherwise stretch the frame.
export function clipToZ(runs: readonly (readonly number[])[], params: readonly (readonly number[])[], z: Range): { runs: number[][]; params: number[][] } {
  const out: number[][] = []
  const outParams: number[][] = []
  runs.forEach((run, r) => {
    const ps = params[r]
    let cur: number[] = []
    let curParams: number[] = []
    const flush = () => {
      if (curParams.length > 1) {
        out.push(cur)
        outParams.push(curParams)
      }
      cur = []
      curParams = []
    }
    const at = (i: number, u: number) => {
      for (let c = 0; c < 3; c++) cur.push(run[3 * i + c] + u * (run[3 * i + 3 + c] - run[3 * i + c]))
      curParams.push(ps[i] + u * (ps[i + 1] - ps[i]))
    }
    for (let i = 0; i + 1 < ps.length; i++) {
      const za = run[3 * i + 2]
      const zb = run[3 * i + 5]
      let u0 = 0
      let u1 = 1
      if (za === zb) {
        if (za < z.min || za > z.max) u0 = 2
      } else {
        const a = (z.min - za) / (zb - za)
        const b = (z.max - za) / (zb - za)
        u0 = Math.max(0, Math.min(a, b))
        u1 = Math.min(1, Math.max(a, b))
      }
      if (u0 > u1) {
        flush()
        continue
      }
      if (curParams.length === 0 || u0 > 0) {
        flush()
        at(i, u0)
      }
      at(i, u1)
      if (u1 < 1) flush()
    }
    flush()
  })
  return { runs: out, params: outParams }
}

export function part(context: BuildContext, name: string): MarkSource {
  return { ...context.source, object: `${context.source.object}.${name}` }
}

export interface LineOptions {
  width: number
  dashed?: boolean
  color?: ColorSpec
  params?: Float64Array | null
}

// Polylines, each a flat xyz list.
export function lineMark(source: MarkSource, polylines: readonly (readonly number[] | Float64Array)[], context: BuildContext, options: LineOptions): LineMark {
  const total = polylines.reduce((n, p) => n + p.length, 0)
  const positions = new Float64Array(total)
  const starts = new Uint32Array(polylines.length)
  let at = 0
  polylines.forEach((p, i) => {
    starts[i] = at / 3
    positions.set(p, at)
    at += p.length
  })
  return {
    kind: 'lines',
    source,
    positions,
    starts,
    params: options.params ?? null,
    style: { color: options.color ?? context.color, width: options.width, dash: options.dashed ? DASH : null, hidden: 'dashed' },
    pick: null,
  }
}

export function pointMark(source: MarkSource, points: readonly Vec3[], context: BuildContext, shape: PointShape = 'dot', size = 8): PointMark {
  return { kind: 'points', source, positions: Float64Array.from(points.flat()), style: { color: context.color, size, shape } }
}

export function arrowMark(source: MarkSource, arrows: readonly { tail: Vec3; vector: Vec3 }[], context: BuildContext, color?: ColorSpec): ArrowMark {
  return {
    kind: 'arrows',
    source,
    tails: Float64Array.from(arrows.flatMap((a) => [...a.tail])),
    vectors: Float64Array.from(arrows.flatMap((a) => [...a.vector])),
    style: { color: color ?? context.color, shaftWidth: 2, headSize: 10, hidden: 'dashed' },
  }
}

// A flat convex polygon as a fan of triangles, lit by its plane's normal.
export function polygonMesh(source: MarkSource, polygon: readonly Vec3[], normal: Vec3, context: BuildContext, opacity: number): MeshMark | null {
  if (polygon.length < 3) return null
  const len = Math.hypot(normal[0], normal[1], normal[2])
  const n: Vec3 = len > 0 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1]
  const indices: number[] = []
  for (let i = 1; i + 1 < polygon.length; i++) indices.push(0, i, i + 1)
  return {
    kind: 'mesh',
    source,
    positions: Float64Array.from(polygon.flat()),
    normals: Float64Array.from(polygon.flatMap(() => [...n])),
    indices: Uint32Array.from(indices),
    scalars: null,
    uv: null,
    style: { color: context.color, opacity, colorScale: null, meshLines: null },
    pick: null,
  }
}

// The vertical plane through (a, b) along the unit direction u, where it meets
// the box: a rectangle, [s0, s1] along u by the box's z range. Null when the
// line in the floor misses the box.
export function verticalPlane(a: number, b: number, u: readonly [number, number], box: Box3): { corners: Vec3[]; normal: Vec3; s: [number, number] } | null {
  const span = clipLine([a, b, (box.z.min + box.z.max) / 2], [u[0], u[1], 0], box)
  if (!span) return null
  const [s0, s1] = span
  const p0: Vec3 = [a + s0 * u[0], b + s0 * u[1], 0]
  const p1: Vec3 = [a + s1 * u[0], b + s1 * u[1], 0]
  return {
    corners: [
      [p0[0], p0[1], box.z.min],
      [p1[0], p1[1], box.z.min],
      [p1[0], p1[1], box.z.max],
      [p0[0], p0[1], box.z.max],
    ],
    normal: [-u[1], u[0], 0],
    s: span,
  }
}

export function annotation(source: MarkSource, position: Vec3, text: string): LabelAnchor {
  return { source, position, text, kind: 'annotation' }
}
