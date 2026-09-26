import { GEOM_EPS } from '../scene/geometry/types'
import { centroid3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import type { Solid3D, Vec3 } from './project3d'

// P3 — one exact convex-hull builder.
//
// Every polyhedron built from named points (a hull, a tetrahedron, a pyramid
// or a prism on points) comes through here and leaves as the `{vertices,
// faces}` polyhedron the convex hidden-edge rule already draws. So there is
// one place that decides what a face is, and every point-built solid is
// convex BY CONSTRUCTION — which is what keeps the convex-only visibility
// rule sound (the invariant solids.test.ts pins, now over hulls too).
//
// **Brute force, and exact.** A plane through three of the points is a face
// plane when every point lies on one side of it (within GEOM_EPS scaled to
// the points' extent). That is O(n^4) — n is a handful of named points —
// and it is an enumeration, not a search: no tolerance chooses an answer, and
// no iteration can converge somewhere else. Incremental hull algorithms are
// faster and famously fragile on exactly the degenerate inputs a competition
// figure is made of (four coplanar points on every face of a cube).
//
// **Coplanar supporting triples merge into ONE polygonal face.** A cube's
// face is one quad, never two triangles: a split face would draw its
// diagonal as a spurious edge.
//
// **Determinism.** Vertex order is the input order (so a solid's `labelOrder`
// is the identity: the names ARE the vertices). Each face is wound
// counter-clockwise seen from outside, starting at its lowest vertex index,
// and faces are sorted by that sequence.
//
// **Refusals** name the point: fewer than four points; all coplanar ("a
// solid needs volume"); two names at one place; and any named point that is
// not a corner — inside the solid, or on one of its edges or faces. A figure
// that names a point is claiming it is a vertex, and a hull that silently
// dropped it would draw a different solid from the one the names describe.

export function hullOf(points: Vec3[], names: string[]): Solid3D {
  const list = nameList(names)
  if (points.length < 4) {
    throw new Error(`A solid needs at least 4 corners, and ${list} ${points.length === 1 ? 'is' : 'are'} only ${points.length}`)
  }

  const centre = centroid3(points)
  let extent = 1
  for (const p of points) extent = Math.max(extent, length3(sub3(p, centre)), Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
  const tolerance = GEOM_EPS * extent

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (length3(sub3(points[j], points[i])) <= tolerance) {
        throw new Error(`${names[i]} and ${names[j]} are the same point, so they cannot both be corners of the solid on ${list}`)
      }
    }
  }

  // Every supporting plane, once, with the points on it.
  const planes: { normal: Vec3; offset: number; on: number[] }[] = []
  let spanning = false
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const raw = cross3(sub3(points[j], points[i]), sub3(points[k], points[i]))
        const size = length3(raw)
        // Collinear: no plane, or rather every plane, so no face.
        if (size <= tolerance * extent) continue
        const normal = scale3(raw, 1 / size)
        const offset = dot3(normal, points[i])
        let above = false
        let below = false
        for (const p of points) {
          const s = dot3(normal, p) - offset
          if (s > tolerance) above = true
          else if (s < -tolerance) below = true
        }
        if (above || below) spanning = true
        if (above && below) continue
        // Outward: away from the points that are off the plane. A plane with
        // no point off it means every point is coplanar — refused below.
        if (!above && !below) continue
        const outward = above ? scale3(normal, -1) : normal
        const outwardOffset = above ? -offset : offset
        if (planes.some((plane) => dot3(plane.normal, outward) > 1 - GEOM_EPS && Math.abs(plane.offset - outwardOffset) <= tolerance)) {
          continue
        }
        const on: number[] = []
        points.forEach((p, m) => {
          if (Math.abs(dot3(outward, p) - outwardOffset) <= tolerance) on.push(m)
        })
        planes.push({ normal: outward, offset: outwardOffset, on })
      }
    }
  }
  if (!spanning) throw new Error(`The points ${list} all lie in one plane — a solid needs volume`)

  // Each face plane's polygon: the convex hull of the points on it, which
  // drops any point lying along one of its edges or inside it.
  const faces = planes.map((plane) => facePolygon(points, plane.on, plane.normal, tolerance * extent))

  // P3's corner rule: every named point must be a vertex of some face.
  const corners = new Set(faces.flat())
  points.forEach((_, m) => {
    if (corners.has(m)) return
    const onFaces = planes.filter((plane) => plane.on.includes(m)).length
    const where = onFaces === 0 ? 'inside the solid' : onFaces === 1 ? 'on a face of the solid' : 'on an edge of the solid'
    throw new Error(`${names[m]} lies ${where} on ${list}, so it is not a corner — every named vertex must be a corner`)
  })

  const ordered = faces.map(fromLowest).sort(compareSequences)
  return { vertices: points.slice(), faces: ordered }
}

// ---------------------------------------------------------------------------
// A base polygon, for a pyramid or prism on points (P6)
// ---------------------------------------------------------------------------

// Checks that the named base is a planar, convex polygon in the order given,
// and returns its unit RIGHT-HAND normal — the direction (B - A) x (C - A)
// points, from which the base reads counter-clockwise. Each refusal names
// the offending point: one off the plane, one where the boundary turns the
// wrong way (reflex), or one on the straight line between its neighbours.
//
// The hull would quietly build the convex hull of a non-convex base, which is
// a different solid from the one the author named, so the base is checked
// here first and the hull only ever sees a base it will keep whole.
export function basePolygonNormal(points: Vec3[], names: string[]): Vec3 {
  const list = nameList(names)
  const n = points.length
  if (n < 3) throw new Error(`A base needs at least 3 corners, and ${list} ${n === 1 ? 'is' : 'are'} only ${n}`)
  const centre = centroid3(points)
  let extent = 1
  for (const p of points) extent = Math.max(extent, length3(sub3(p, centre)), Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
  const tolerance = GEOM_EPS * extent

  // Newell's normal: the polygon's area vector, sound for any planar loop.
  let newell: Vec3 = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    newell = {
      x: newell.x + (a.y - b.y) * (a.z + b.z),
      y: newell.y + (a.z - b.z) * (a.x + b.x),
      z: newell.z + (a.x - b.x) * (a.y + b.y),
    }
  }
  const size = length3(newell)
  if (size <= tolerance * extent) throw new Error(`The base ${list} has no area — its corners lie on one line`)
  const normal = scale3(newell, 1 / size)
  // Flatness, against the plane of A, B and the first corner after them not
  // on line A-B: which corner is "off the plane" of a warped quad is a
  // convention, and this one names the first corner that leaves the plane
  // the base's own first corners fix.
  let third = 2
  while (third < n && length3(cross3(sub3(points[1], points[0]), sub3(points[third], points[0]))) <= tolerance * extent) third++
  const frame = cross3(sub3(points[1], points[0]), sub3(points[third], points[0]))
  const frameUnit = scale3(frame, 1 / length3(frame))
  points.forEach((p, i) => {
    if (Math.abs(dot3(sub3(p, points[0]), frameUnit)) > tolerance) {
      throw new Error(`${names[i]} is not in the plane ${names[0]}-${names[1]}-${names[third]} of the base ${list} — a base must be flat`)
    }
  })

  let turning = 0
  for (let i = 0; i < n; i++) {
    const before = sub3(points[i], points[(i + n - 1) % n])
    const after = sub3(points[(i + 1) % n], points[i])
    const turn = dot3(cross3(before, after), normal)
    if (Math.abs(turn) <= tolerance * extent) {
      throw new Error(`${names[i]} lies on the straight line between its neighbours in the base ${list}, so it is not a corner`)
    }
    if (turn < 0) throw new Error(`The base ${list} is not convex: it turns back at ${names[i]}`)
    turning += Math.atan2(turn / (length3(before) * length3(after)), dot3(before, after) / (length3(before) * length3(after)))
  }
  // Every turn the same way and yet more than one full turn: a star. A
  // convex polygon turns exactly 2 pi in all, a star at least 4 pi, so the
  // threshold between them needs no tolerance.
  if (turning > 3 * Math.PI) throw new Error(`The base ${list} winds round more than once — name its corners in order round the edge`)

  const right = cross3(sub3(points[1], points[0]), sub3(points[2], points[0]))
  return scale3(right, 1 / length3(right))
}

// The polygon of one face: the 2D convex hull of the points on its plane, in
// a frame whose second axis is normal x first, so counter-clockwise in that
// frame is counter-clockwise seen from OUTSIDE (the normal toward the eye).
// Andrew's monotone chain, keeping only strict turns, so a point along an
// edge is not a vertex. `area` is the tolerance on a turn's cross product.
function facePolygon(points: Vec3[], on: number[], normal: Vec3, area: number): number[] {
  const origin = points[on[0]]
  // The first axis: toward the on-plane point farthest from `origin`, so it
  // is never a rounding-sized vector.
  let far = on[1]
  for (const m of on) if (length3(sub3(points[m], origin)) > length3(sub3(points[far], origin))) far = m
  const along = sub3(points[far], origin)
  const e1 = scale3(along, 1 / length3(along))
  const e2 = cross3(normal, e1)
  const flat = on.map((m) => {
    const d = sub3(points[m], origin)
    return { m, x: dot3(d, e1), y: dot3(d, e2) }
  })
  flat.sort((a, b) => a.x - b.x || a.y - b.y || a.m - b.m)
  const turn = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const chain = (sequence: typeof flat) => {
    const out: typeof flat = []
    for (const p of sequence) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= area) out.pop()
      out.push(p)
    }
    return out
  }
  const lower = chain(flat)
  const upper = chain(flat.slice().reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((p) => p.m)
}

// A face's cycle rotated to start at its lowest vertex index, winding kept.
function fromLowest(face: number[]): number[] {
  let start = 0
  for (let i = 1; i < face.length; i++) if (face[i] < face[start]) start = i
  return [...face.slice(start), ...face.slice(0, start)]
}

function compareSequences(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

function nameList(names: readonly string[]): string {
  return names.join('-')
}
