import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import { add3, centroid3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import { chartPoint, distanceFromApex, faceChart, faceFrame, moveChart, outwardNormal, placedNet, unrolledNet, unrollingOf, wrapAngle, type Net, type NetPiece, type Unrolling } from './nets'
import type { Solid3D, Vec3 } from './project3d'
import { toLocal } from './silhouette'
import type { SolidBody } from './solids'

// Phase 11 — the shortest path over a solid's surface (N3, N4).
//
// ---------------------------------------------------------------------------
// N3 — polyhedra: an exact, finite enumeration, never a search
// ---------------------------------------------------------------------------
//
// A shortest path over a CONVEX polyhedron crosses each face in at most one
// segment, so it is a straight line in the unfolding of the SIMPLE sequence
// of faces it crosses. Every such sequence is enumerated — depth first from
// each face holding P, neighbours in face order, no face twice — ending at
// the first face that holds Q. Each is unfolded into its first face's plane
// by the closed-form rigid motion nets.ts lays a net out with, so P and Q
// land at P' and Q'. The sequence is VALID when the straight segment P'Q'
// crosses every shared edge, in order, within the edge's extent (closed-form
// segment–segment intersection); its length is then |P'Q'|. The least valid
// length wins, ties to the first found. Two points on one face give the
// straight distance, which no longer path can beat.
//
// Stopping at the first face that holds Q loses nothing: a path that passed
// through such a face and went on would reach Q no sooner than the straight
// segment inside that face from where it entered.
//
// The enumeration is exponential in the face count, so solids of more than
// 12 faces are refused (a box, prisms to decagonal, pyramids to 11 sides,
// tetrahedra, the octahedron, frusta to decagonal).
//
// The path is drawn ON the solid as its per-face segments — each crossing
// carried back into space along its edge — split visible/hidden by the glass
// rule like any segment in space, and, with `unfold`, as one straight
// segment across the strip of faces it crosses, lifted beside the drawing.

export const MAX_PATH_FACES = 12

// A path found: its length, where it runs on the solid (P, each crossing, Q,
// internal frame), and the flat picture it is straight in, with P' and Q'.
export interface SurfacePath {
  length: number
  onSolid: Vec3[]
  faces: number[]
  flat: { net: Net; from: Vec2; to: Vec2 }
}

// The faces a point lies on (closed: a point on an edge is on both faces,
// a vertex on all of its faces), within GEOM_EPS of the solid's own size.
export function facesHolding(solid: Solid3D, p: Vec3, tolerance: number): number[] {
  const holding: number[] = []
  solid.faces.forEach((face, f) => {
    const n = outwardNormal(solid, f)
    const origin = solid.vertices[face[0]]
    if (Math.abs(dot3(n, sub3(p, origin))) > tolerance) return
    // In-plane signed distances to each edge line: all on one side.
    let positive = true
    let negative = true
    for (let i = 0; i < face.length; i++) {
      const a = solid.vertices[face[i]]
      const b = solid.vertices[face[(i + 1) % face.length]]
      const side = dot3(cross3(sub3(b, a), sub3(p, a)), n) / length3(sub3(b, a))
      if (side < -tolerance) positive = false
      if (side > tolerance) negative = false
    }
    if (positive || negative) holding.push(f)
  })
  return holding
}

// The size a tolerance is taken against: the solid's spread about its own
// centroid, at least 1 (GEOM_EPS is relative).
function extentOf(solid: Solid3D): number {
  const centre = centroid3(solid.vertices)
  let extent = 1
  for (const v of solid.vertices) extent = Math.max(extent, length3(sub3(v, centre)))
  return extent
}

// Faces sharing an edge with each face, in face order, with the edge.
function neighbours(solid: Solid3D): { face: number; edge: [number, number] }[][] {
  const byEdge = new Map<string, number[]>()
  solid.faces.forEach((face, f) => {
    face.forEach((v, i) => {
      const w = face[(i + 1) % face.length]
      const key = v < w ? `${v}:${w}` : `${w}:${v}`
      byEdge.set(key, [...(byEdge.get(key) ?? []), f])
    })
  })
  return solid.faces.map((face, f) => {
    const found: { face: number; edge: [number, number] }[] = []
    face.forEach((v, i) => {
      const w = face[(i + 1) % face.length]
      for (const g of byEdge.get(v < w ? `${v}:${w}` : `${w}:${v}`) ?? []) if (g !== f) found.push({ face: g, edge: [v, w] })
    })
    return found.sort((x, y) => x.face - y.face)
  })
}

interface Candidate {
  length: number
  faces: number[]
  edges: [number, number][]
  // Where the path crosses each shared edge: the fraction along it, a to b,
  // and the fraction along P'Q'.
  along: number[]
  at: number[]
  placed: Map<number, Map<number, Vec2>>
  from: Vec2
  to: Vec2
}

// N3 for a polyhedron. `word` and the names are the author's, for refusals.
export function polyhedronPath(
  solid: Solid3D,
  name: string,
  word: string,
  [p, q]: [Vec3, Vec3],
  [pName, qName]: [string, string],
  names: readonly (string | undefined)[]
): SurfacePath {
  if (solid.faces.length > MAX_PATH_FACES) {
    throw new Error(`"${name}" has ${solid.faces.length} faces — shortest paths are found over solids of at most ${MAX_PATH_FACES} faces`)
  }
  const extent = extentOf(solid)
  const tolerance = GEOM_EPS * extent
  const starts = facesHolding(solid, p, tolerance)
  const ends = new Set(facesHolding(solid, q, tolerance))
  for (const [point, faces] of [
    [pName, starts],
    [qName, [...ends]],
  ] as const) {
    if (faces.length === 0) {
      throw new Error(`${point} is not on the surface of "${name}" — a shortest path runs over the surface of the ${word}, so both its ends must lie on it`)
    }
  }
  const adjacent = neighbours(solid)

  let best: Candidate | null = null
  const consider = (faces: number[], edges: [number, number][]) => {
    const found = unfoldAndCheck(solid, faces, edges, p, q, tolerance)
    if (found && (best === null || found.length < best.length - tolerance)) best = found
  }
  const visit = (faces: number[], edges: [number, number][], used: Set<number>) => {
    const last = faces[faces.length - 1]
    if (ends.has(last)) {
      consider(faces, edges)
      return
    }
    for (const next of adjacent[last]) {
      if (used.has(next.face)) continue
      used.add(next.face)
      visit([...faces, next.face], [...edges, next.edge], used)
      used.delete(next.face)
    }
  }
  for (const start of starts) visit([start], [], new Set([start]))
  const found = best as Candidate | null
  if (!found) throw new Error(`No path over the surface of "${name}" joins ${pName} and ${qName}`)
  const path = trimmed(found, tolerance)

  const onSolid: Vec3[] = [p]
  path.edges.forEach(([a, b], i) => {
    const s = Math.min(1, Math.max(0, path.along[i]))
    onSolid.push(add3(solid.vertices[a], scale3(sub3(solid.vertices[b], solid.vertices[a]), s)))
  })
  onSolid.push(q)
  const children = path.edges.map((edge, i) => ({ face: path.faces[i + 1], parent: path.faces[i], edge }))
  const net = placedNet(solid, 'strip', path.faces[0], children, path.placed, names)
  return { length: path.length, onSolid: withoutRepeats(onSolid, tolerance), faces: path.faces, flat: turned(net, path.from, path.to) }
}

// A path from a point ON the edge it first crosses (a vertex, say) starts
// in a face it never enters: the crossing is at P itself. Likewise at Q.
// Those faces are dropped, so the path's faces are the ones it crosses and
// its strip is the strip it is straight across. The rest of the unfolding
// is rigid, so nothing else moves.
function trimmed(path: Candidate, tolerance: number): Candidate {
  const slack = tolerance / Math.max(1, path.length)
  let first = 0
  let last = path.faces.length - 1
  while (first < last && path.at[first] <= slack) first++
  while (last > first && path.at[last - 1] >= 1 - slack) last--
  return {
    ...path,
    faces: path.faces.slice(first, last + 1),
    edges: path.edges.slice(first, last),
    along: path.along.slice(first, last),
    at: path.at.slice(first, last),
  }
}

// One face sequence unfolded into its first face's plane, and checked.
function unfoldAndCheck(solid: Solid3D, faces: number[], edges: [number, number][], p: Vec3, q: Vec3, tolerance: number): Candidate | null {
  const placed = new Map<number, Map<number, Vec2>>()
  placed.set(faces[0], faceChart(solid, faces[0]))
  const from = chartPoint(faceFrame(solid, faces[0]), p)
  let to = faces.length === 1 ? chartPoint(faceFrame(solid, faces[0]), q) : from
  for (let i = 1; i < faces.length; i++) {
    const [a, b] = edges[i - 1]
    const chart = faceChart(solid, faces[i])
    // Q rides with the last face's chart, keyed -1.
    if (i === faces.length - 1) chart.set(-1, chartPoint(faceFrame(solid, faces[i]), q))
    const parent = placed.get(faces[i - 1])!
    const moved = moveChart(chart, [chart.get(a)!, chart.get(b)!], [parent.get(a)!, parent.get(b)!])
    if (i === faces.length - 1) {
      to = moved.get(-1)!
      moved.delete(-1)
    }
    placed.set(faces[i], moved)
  }

  // Validity: P'Q' crosses each shared edge, in order, within its extent.
  const d = { x: to.x - from.x, y: to.y - from.y }
  const along: number[] = []
  const at: number[] = []
  let last = -Infinity
  for (let i = 1; i < faces.length; i++) {
    const [a, b] = edges[i - 1]
    const pa = placed.get(faces[i])!.get(a)!
    const pb = placed.get(faces[i])!.get(b)!
    const e = { x: pb.x - pa.x, y: pb.y - pa.y }
    const denominator = d.x * e.y - d.y * e.x
    const span = Math.hypot(d.x, d.y) * Math.hypot(e.x, e.y)
    if (Math.abs(denominator) <= GEOM_EPS * span || span === 0) return null
    const w = { x: pa.x - from.x, y: pa.y - from.y }
    const t = (w.x * e.y - w.y * e.x) / denominator
    const s = (w.x * d.y - w.y * d.x) / denominator
    const slack = tolerance / Math.max(1, Math.hypot(e.x, e.y))
    const slackT = tolerance / Math.max(1, Math.hypot(d.x, d.y))
    if (s < -slack || s > 1 + slack || t < -slackT || t > 1 + slackT || t < last - slackT) return null
    last = t
    along.push(s)
    at.push(t)
  }
  return { length: Math.hypot(d.x, d.y), faces, edges, along, at, placed, from, to }
}

// Consecutive points closer than the tolerance merged: a path through a
// vertex, or from a point on the edge it first crosses, has zero-length
// pieces that draw nothing.
function withoutRepeats(points: Vec3[], tolerance: number): Vec3[] {
  const kept: Vec3[] = []
  for (const point of points) if (kept.length === 0 || length3(sub3(point, kept[kept.length - 1])) > tolerance) kept.push(point)
  return kept
}

// A flat picture turned about P' so the path runs left to right: the one
// rotation taking Q' - P' to +x (none when they coincide).
export function turned(net: Net, from: Vec2, to: Vec2): { net: Net; from: Vec2; to: Vec2 } {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length === 0) return { net, from, to }
  const cos = (to.x - from.x) / length
  const sin = -(to.y - from.y) / length
  const turn = (p: Vec2): Vec2 => ({
    x: from.x + cos * (p.x - from.x) - sin * (p.y - from.y),
    y: from.y + sin * (p.x - from.x) + cos * (p.y - from.y),
  })
  const piece = (pc: NetPiece): NetPiece => (pc.kind === 'segment' ? { kind: 'segment', a: turn(pc.a), b: turn(pc.b) } : { ...pc, center: turn(pc.center) })
  return {
    net: {
      ...net,
      faces: net.faces.map((f) => ({ ...f, corners: f.corners.map(turn) })),
      lines: net.lines.map((l) => ({ ...l, piece: piece(l.piece) })),
      letters: net.letters.map((l) => ({ ...l, at: turn(l.at), toward: turn(l.toward) })),
    },
    from: turn(from),
    to: turn(to),
  }
}

// ---------------------------------------------------------------------------
// N4 — round solids: closed form on the unrolled curved side
// ---------------------------------------------------------------------------
//
// Both points must be on the LATERAL surface (a rim counts); a point on a
// flat end is refused. The side unrolls isometrically (nets.ts), so the
// shortest path is the straight segment in the unrolling, in closed form:
//
//  - cylinder: arc position s = r theta, height y; the length is the least of
//    hypot(ds + 2 pi r k, dy) over k in {-1, 0, 1};
//  - cone: polar (rho from the apex, phi = theta r / l); the separation
//    alpha is |d theta| r / l wrapped modulo the sector angle and taken the
//    shorter way round, and the length is the law of cosines,
//    sqrt(rhoP^2 + rhoQ^2 - 2 rhoP rhoQ cos alpha).
//    **There is no through-the-apex case**, and no branch for one: the
//    shorter way round is at most half the sector angle, pi r / l, and that
//    is always less than pi because r < l. A branch for it could never run.
//  - conical frustum: as the cone, about the virtual apex, but the segment
//    must stay outside the top rim's radius; one that would cross it is
//    refused — the true path would run along the top rim, which is not
//    drawn.
//
// A geodesic on a curved surface is not a conic in projection, so it is
// drawn on the lifted UNROLLING only, never on the solid (P and Q are drawn
// on the solid by their own statements). The unrolling is cut along the
// generator opposite the path's middle, so the path is one straight segment
// centred in it; the side of the solid the path runs over is its middle.

const ROUND_PATHS = `shortest paths are found over polyhedra of at most ${MAX_PATH_FACES} faces and the curved sides of cylinders, cones and frusta`

function roundPath(body: SolidBody, name: string, word: string, [p, q]: [Vec3, Vec3], endNames: [string, string]): SurfacePath {
  const unrolling = unrollingOf(body)
  if (!unrolling) throw new Error(`"${name}" is ${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word} — ${ROUND_PATHS}`)
  const local = [toLocal(body.placement, p), toLocal(body.placement, q)] as const
  const tolerance = GEOM_EPS * Math.max(1, unrolling.radius, unrolling.height)
  local.forEach((point, i) => onCurvedSide(unrolling, point, tolerance, endNames[i], name, word))
  const [a, b] = local
  const thetaP = Math.atan2(a.z, a.x)
  const thetaQ = Math.atan2(b.z, b.x)

  if (unrolling.kind === 'cylinder') {
    const r = unrolling.radius
    const dy = b.y - a.y
    const ds = r * (thetaQ - thetaP)
    let best = { length: Infinity, turn: 0 }
    for (const k of [0, -1, 1]) {
      const length = Math.hypot(ds + 2 * Math.PI * r * k, dy)
      if (length < best.length - tolerance) best = { length, turn: ds + 2 * Math.PI * r * k }
    }
    // Centred on the path's middle generator; the reader's right is
    // decreasing theta (nets.ts), so P sits at +turn/2 and Q at -turn/2.
    const from = { x: best.turn / 2, y: a.y + unrolling.height / 2 }
    const to = { x: -best.turn / 2, y: b.y + unrolling.height / 2 }
    return { length: best.length, onSolid: [], faces: [], flat: { net: unrolledNet(unrolling, false), from, to } }
  }

  const rhoP = distanceFromApex(unrolling, a)
  const rhoQ = distanceFromApex(unrolling, b)
  const sector = unrolling.sector
  const scale = unrolling.radius / unrolling.slant
  // The separation, wrapped modulo the sector and taken the shorter way round.
  const unwrapped = (Math.abs(thetaQ - thetaP) * scale) % sector
  const alpha = Math.min(unwrapped, sector - unwrapped)
  const length = Math.sqrt(Math.max(0, rhoP * rhoP + rhoQ * rhoQ - 2 * rhoP * rhoQ * Math.cos(alpha)))
  // Which way round is shorter, for the layout: P to the right of the
  // middle when Q lies at larger theta (the reader's right is decreasing theta).
  const sign = wrapAngle(thetaQ - thetaP) >= 0 ? 1 : -1
  const from = polar(rhoP, -Math.PI / 2 + (sign * alpha) / 2)
  const to = polar(rhoQ, -Math.PI / 2 - (sign * alpha) / 2)
  if (unrolling.kind === 'frustum') {
    // The segment's nearest approach to the apex: at the foot of the
    // perpendicular when that falls inside it, else at an end.
    const d = { x: to.x - from.x, y: to.y - from.y }
    const t = length === 0 ? 0 : -(from.x * d.x + from.y * d.y) / (length * length)
    const nearest = t > 0 && t < 1 ? Math.abs(from.x * to.y - from.y * to.x) / length : Math.min(rhoP, rhoQ)
    if (nearest < unrolling.inner - tolerance) {
      throw new Error(
        `The shortest path from ${endNames[0]} to ${endNames[1]} over "${name}" would run along the top rim — not drawn ` +
          '(on the unrolled side the straight line passes inside the top rim)'
      )
    }
  }
  return { length, onSolid: [], faces: [], flat: { net: unrolledNet(unrolling, false), from, to } }
}

function polar(rho: number, phi: number): Vec2 {
  return { x: rho * Math.cos(phi), y: rho * Math.sin(phi) }
}

// A point in the round solid's local frame on its curved side (a rim
// counts), or a refusal: on a flat end, or not on the surface at all.
function onCurvedSide(unrolling: Unrolling, p: Vec3, tolerance: number, point: string, name: string, word: string): void {
  const half = unrolling.height / 2
  const across = Math.hypot(p.x, p.z)
  const radiusAt = unrolling.kind === 'cylinder' ? unrolling.radius : unrolling.radius + ((unrolling.top - unrolling.radius) * (p.y + half)) / unrolling.height
  const within = p.y >= -half - tolerance && p.y <= half + tolerance
  if (within && Math.abs(across - radiusAt) <= tolerance) return
  const endRadius = (y: number) => (unrolling.kind === 'cylinder' ? unrolling.radius : y < 0 ? unrolling.radius : unrolling.top)
  for (const y of [-half, half]) {
    if (Math.abs(p.y - y) <= tolerance && across <= endRadius(y) + tolerance && endRadius(y) > 0) {
      throw new Error(`${point} is on a flat end of "${name}" — a shortest path over ${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word} is found on the curved side only`)
    }
  }
  throw new Error(`${point} is not on the surface of "${name}" — a shortest path runs over the surface of the ${word}, so both its ends must lie on it`)
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

// The shortest path over a solid between two points in space (internal
// frame), or a refusal in the author's words.
export function shortestPath(
  body: SolidBody,
  name: string,
  word: string,
  ends: [Vec3, Vec3],
  endNames: [string, string],
  names: readonly (string | undefined)[] = []
): SurfacePath {
  if (body.polyhedron) return polyhedronPath(body.polyhedron, name, word, ends, endNames, names)
  return roundPath(body, name, word, ends, endNames)
}
