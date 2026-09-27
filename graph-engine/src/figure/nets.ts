import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import { centroid3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import { DEFAULT_CAMERA, type Solid3D, type Vec3 } from './project3d'
import { rotateToLocal } from './silhouette'
import { frustumRadii, type SolidBody } from './solids'

// Phase 11 — nets: a solid unfolded flat, fold lines dashed.
//
// ---------------------------------------------------------------------------
// N1 — a net is 2D geometry, built by a per-primitive TEMPLATE
// ---------------------------------------------------------------------------
//
// A net is the spec's "3D input, 2D figure output", exactly as a lifted
// section is (H5): this module hands back plane geometry at the solid's own
// scale, and the renderer lifts it beside the drawing through the ordinary 2D
// path. Nothing here knows a camera, so a net never turns with `@view:`.
//
// **Templates, never a search.** General polyhedron unfolding is a spec
// non-goal. Each primitive has ONE template (N2): which face is the root, and
// which face hangs off which along which edge — a spanning tree of faces.
// The tree is written down per primitive; only the solid's own dimensions
// vary, and they are carried exactly.
//
// **One unfolding, in closed form.** Every face is laid into the plane as it
// is SEEN FROM OUTSIDE (its outward normal toward the reader), in its own
// orthonormal chart. The root is turned so its first edge is horizontal with
// the face above it. A child face is then placed by the one rigid motion (a
// rotation and a translation, never a reflection) that puts its shared edge
// onto its parent's copy of that edge — which is the rotation about the
// shared edge into the parent's plane, done in the plane. Because both charts
// are seen from outside, and two faces of a closed surface run their shared
// edge in opposite directions, the child always lands on the far side of the
// edge from its parent. The same machinery unfolds a shortest path's face
// sequence (shortestPath.ts, N3).
//
// **Line styles.** A tree edge is a FOLD (dashed); every other face edge is
// a CUT, the net's boundary (solid).
//
// **Letters are display labels, not points.** A net repeats a vertex's
// letter at each of its copies (a cube's cross shows A three times), so a
// copy cannot be a named point: which A would "label: AB" mean? Each copy is
// one class of (face, vertex) pairs joined across fold lines — the faces that
// stay attached at that corner once the net is cut out.
//
// **Overlap is refused, exactly (N2).** Every polyhedral net is checked for
// self-overlap before it is drawn: a proper crossing between two edges of
// different faces that share no corner copy, or a face's corner or centroid
// strictly inside another face — "this pyramid's star net overlaps itself".
//
// **Correction to the plan, recorded: no template net reachable from the
// grammar overlaps.** The plan expected an obtuse six-edge tetrahedron's star
// to. It cannot: any two of a tetrahedron's lateral faces share a base
// vertex, where the base angle and the two face angles sum to less than 360
// degrees (a convex corner), so the three wedges at that vertex are disjoint
// and so are the triangles inside them. A prism's strip is rectangles (every
// prism here is a right prism) with its caps wholly above and below it; the
// regular frustum's star and the octahedron's strip are fixed shapes; and a
// pyramid's star — the petal unfolding — did not overlap on any of 20000
// seeded pyramids on points, apexes leaning far out and low over bases of 4
// to 8 corners. So the check stays as the guard every template passes
// through (it costs nothing, and a future template or an oblique prism would
// meet it), and the tests pin the INVARIANT — every reachable net, over
// seeded random solids, passes — beside a hand-built overlapping net the
// check must refuse, so it cannot pass vacuously. The phase 5 precedent: the
// convexity invariant, pinned beside a dented cube.

// ---------------------------------------------------------------------------
// The flat pieces
// ---------------------------------------------------------------------------

// A net's drawn piece: a segment, or an arc of the circle `center`, `radius`
// from angle `from` to `to` (counter-clockwise when to > from). Arcs serve
// the round solids' nets (task 2): sectors, rims.
export type NetPiece =
  | { kind: 'segment'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; center: Vec2; radius: number; from: number; to: number }

export interface NetLine {
  piece: NetPiece
  // Dashed: the net folds here. Otherwise a cut edge, solid.
  fold: boolean
  // What the emitted element's data-object says: "fold-B-F", "cut-A-B".
  object: string
}

// One copy of a vertex in the net, and the solid vertex it is a copy of.
export interface NetLetter {
  at: Vec2
  vertex: number
  // Where the faces meeting at this copy lie, for the label to point away from.
  toward: Vec2
}

// A face of a polyhedral net, laid flat: its solid face index and its
// vertices (solid indices, in the face's own order) at their net positions.
export interface NetFace {
  face: number
  vertices: number[]
  corners: Vec2[]
}

export interface Net {
  // What the net is called in a refusal: a prism's or octahedron's "strip",
  // a pyramid's, tetrahedron's or frustum's "star", a round solid's "net".
  shape: 'strip' | 'star' | 'net'
  faces: NetFace[]
  lines: NetLine[]
  letters: NetLetter[]
  // The copy (an index into `letters`) each "face:vertex" pair belongs to.
  copies: Map<string, number>
}

// ---------------------------------------------------------------------------
// Charts and the rigid motion
// ---------------------------------------------------------------------------

// A face's unit outward normal: Newell's normal, turned away from the
// solid's vertex centroid so no builder's winding matters (as spheres.ts does).
export function outwardNormal(solid: Solid3D, faceIndex: number): Vec3 {
  const face = solid.faces[faceIndex]
  let n: Vec3 = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < face.length; i++) {
    const a = solid.vertices[face[i]]
    const b = solid.vertices[face[(i + 1) % face.length]]
    n = { x: n.x + (a.y - b.y) * (a.z + b.z), y: n.y + (a.z - b.z) * (a.x + b.x), z: n.z + (a.x - b.x) * (a.y + b.y) }
  }
  const out = sub3(centroid3(face.map((v) => solid.vertices[v])), centroid3(solid.vertices))
  const unit = scale3(n, 1 / length3(n))
  return dot3(unit, out) < 0 ? scale3(unit, -1) : unit
}

// A face in its own chart, seen from outside: origin at its first vertex,
// x along its first edge, y = normal x x. Right-handed with the normal toward
// the reader, so a face's outside-counter-clockwise winding stays
// counter-clockwise in the chart.
export function faceChart(solid: Solid3D, faceIndex: number): Map<number, Vec2> {
  const frame = faceFrame(solid, faceIndex)
  const chart = new Map<number, Vec2>()
  for (const v of solid.faces[faceIndex]) chart.set(v, chartPoint(frame, solid.vertices[v]))
  return chart
}

// The chart's frame: its origin and two in-plane unit axes.
export interface FaceFrame {
  origin: Vec3
  e1: Vec3
  e2: Vec3
}

export function faceFrame(solid: Solid3D, faceIndex: number): FaceFrame {
  const face = solid.faces[faceIndex]
  const origin = solid.vertices[face[0]]
  const along = sub3(solid.vertices[face[1]], origin)
  const e1 = scale3(along, 1 / length3(along))
  return { origin, e1, e2: cross3(outwardNormal(solid, faceIndex), e1) }
}

// A point of the face, in the face's chart.
export function chartPoint(frame: FaceFrame, p: Vec3): Vec2 {
  const d = sub3(p, frame.origin)
  return { x: dot3(d, frame.e1), y: dot3(d, frame.e2) }
}

// The rigid motion (rotation then translation) taking `from` a -> b onto
// `to` a -> b, applied to a whole chart. The two edges are the same edge of
// the solid, so their lengths agree; the rotation is read off their unit
// directions in closed form (cos = u . w, sin = w x u).
export function moveChart(chart: Map<number, Vec2>, from: [Vec2, Vec2], to: [Vec2, Vec2]): Map<number, Vec2> {
  const w = unit2({ x: from[1].x - from[0].x, y: from[1].y - from[0].y })
  const u = unit2({ x: to[1].x - to[0].x, y: to[1].y - to[0].y })
  const cos = u.x * w.x + u.y * w.y
  const sin = w.x * u.y - w.y * u.x
  const moved = new Map<number, Vec2>()
  for (const [v, p] of chart) {
    const dx = p.x - from[0].x
    const dy = p.y - from[0].y
    moved.set(v, { x: to[0].x + cos * dx - sin * dy, y: to[0].y + sin * dx + cos * dy })
  }
  return moved
}

function unit2(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y)
  return { x: v.x / length, y: v.y / length }
}

// The root face's chart, turned so the edge p-q is horizontal with the face
// above it (N1's orientation), its left end at the origin. Which of p and q
// is on the left is not a choice: seen from outside, the face lies to the
// left of the direction its winding runs the edge in.
export function rootChart(solid: Solid3D, faceIndex: number, p: number, q: number): Map<number, Vec2> {
  const chart = faceChart(solid, faceIndex)
  const face = solid.faces[faceIndex]
  const i = face.indexOf(p)
  const [left, right] = face[(i + 1) % face.length] === q ? [p, q] : [q, p]
  const a = chart.get(left)!
  const b = chart.get(right)!
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return moveChart(chart, [a, b], [
    { x: 0, y: 0 },
    { x: length, y: 0 },
  ])
}

// A child face placed against its parent's copy of their shared edge a-b.
export function attachChart(solid: Solid3D, faceIndex: number, a: number, b: number, parent: Map<number, Vec2>): Map<number, Vec2> {
  const chart = faceChart(solid, faceIndex)
  return moveChart(chart, [chart.get(a)!, chart.get(b)!], [parent.get(a)!, parent.get(b)!])
}

// ---------------------------------------------------------------------------
// N2 — the templates
// ---------------------------------------------------------------------------

// A face tree: the root, its first edge, and each other face with the face
// it hangs off and the edge they share, parents before children.
interface Template {
  // What the net is called in a refusal: "strip" or "star".
  shape: 'strip' | 'star'
  root: number
  rootEdge: [number, number]
  children: { face: number; parent: number; edge: [number, number] }[]
}

// The solid's face whose vertex set is exactly `vertices`.
function faceWith(solid: Solid3D, vertices: number[]): number {
  const want = new Set(vertices)
  const found = solid.faces.findIndex((face) => face.length === want.size && face.every((v) => want.has(v)))
  if (found < 0) throw new Error(`No face on the vertices ${vertices.join(', ')}`)
  return found
}

// N2: prisms — the lateral faces in ONE strip, left to right in base order
// from face AB; both caps on lateral face ceil(n/2) - 1, below and above it.
// For a box, the cross.
function prismTemplate(solid: Solid3D, base: number[], top: number[]): Template {
  const n = base.length
  const lateral = base.map((_, i) => faceWith(solid, [base[i], base[(i + 1) % n], top[(i + 1) % n], top[i]]))
  const k = Math.ceil(n / 2) - 1
  const children: Template['children'] = []
  for (let i = 1; i < n; i++) children.push({ face: lateral[i], parent: lateral[i - 1], edge: [base[i], top[i]] })
  children.push({ face: faceWith(solid, base), parent: lateral[k], edge: [base[k], base[(k + 1) % n]] })
  children.push({ face: faceWith(solid, top), parent: lateral[k], edge: [top[k], top[(k + 1) % n]] })
  return { shape: 'strip', root: lateral[0], rootEdge: [base[0], base[1]], children }
}

// N2: pyramids and tetrahedra — the base as root, each lateral triangle
// unfolded outward about its base edge: the star. A pyramidal frustum is the
// same star of trapezoids, its top on trapezoid ceil(n/2) - 1's top edge.
function starTemplate(solid: Solid3D, base: number[], apexOrTop: number | number[]): Template {
  const n = base.length
  const root = faceWith(solid, base)
  const children: Template['children'] = []
  const lateral = base.map((_, i) => {
    const j = (i + 1) % n
    const face = Array.isArray(apexOrTop) ? faceWith(solid, [base[i], base[j], apexOrTop[j], apexOrTop[i]]) : faceWith(solid, [base[i], base[j], apexOrTop])
    children.push({ face, parent: root, edge: [base[i], base[j]] })
    return face
  })
  if (Array.isArray(apexOrTop)) {
    const k = Math.ceil(n / 2) - 1
    children.push({ face: faceWith(solid, apexOrTop), parent: lateral[k], edge: [apexOrTop[k], apexOrTop[(k + 1) % n]] })
  }
  return { shape: 'star', root, rootEdge: [base[0], base[1]], children }
}

// N2: the octahedron — a zig-zag strip of all eight triangles round the
// equator, crossing each equator edge once, upper and lower faces in turn:
// L0 U0 U1 L1 L2 U2 U3 L3 (U_i over equator edge i, L_i under it). It is
// three fans of four triangles, about the equator corners B, C and D.
//
// Correction to the plan's wording, recorded: a chain alternating single
// upper and lower faces does not exist (an upper face meets exactly one lower
// face across an edge, the one under the same equator edge), so the strip
// alternates in pairs. It is still one strip of eight, seven folds.
function octahedronTemplate(solid: Solid3D, order: number[]): Template {
  const [a, b, c, d, top, bottom] = order
  const ring = [a, b, c, d]
  const upper = ring.map((v, i) => faceWith(solid, [v, ring[(i + 1) % 4], top]))
  const lower = ring.map((v, i) => faceWith(solid, [v, ring[(i + 1) % 4], bottom]))
  return {
    shape: 'strip',
    root: upper[0],
    rootEdge: [a, b],
    children: [
      { face: lower[0], parent: upper[0], edge: [a, b] },
      { face: upper[1], parent: upper[0], edge: [b, top] },
      { face: lower[1], parent: upper[1], edge: [b, c] },
      { face: lower[2], parent: lower[1], edge: [c, bottom] },
      { face: upper[2], parent: lower[2], edge: [c, d] },
      { face: upper[3], parent: upper[2], edge: [d, top] },
      { face: lower[3], parent: upper[3], edge: [d, a] },
    ],
  }
}

// What an author calls a solid, for a message.
const WORDS: Partial<Record<SolidBody['spec']['kind'], string>> = {
  prism: 'prism',
  regularPrism: 'prism',
  pyramid: 'pyramid',
  regularPyramid: 'pyramid',
  rectanglePyramid: 'pyramid',
  regularFrustum: 'frustum',
}

export function netSolidWord(body: SolidBody): string {
  return body.spec.kind === 'hull' ? body.spec.shape : (WORDS[body.spec.kind] ?? body.spec.kind)
}

export const NET_SOLIDS = 'nets are drawn for prisms, pyramids, tetrahedra, octahedra, frusta, cylinders and cones'

// The template for a polyhedron, read off its lettering (labelOrder), which
// every polyhedral builder writes in textbook order: a prism's base then its
// top, a pyramid's base then its apex, the octahedron's equator then its two
// apexes. Null for a round solid (task 2).
function templateOf(body: SolidBody, name: string): Template | null {
  const solid = body.polyhedron
  const spec = body.spec
  if (!solid) return null
  const order = body.labelOrder
  switch (spec.kind) {
    case 'prism':
    case 'cube':
    case 'regularPrism': {
      const n = order.length / 2
      return prismTemplate(solid, order.slice(0, n), order.slice(n))
    }
    case 'pyramid':
    case 'regularPyramid':
    case 'rectanglePyramid':
    case 'tetrahedron':
      return starTemplate(solid, order.slice(0, -1), order[order.length - 1])
    case 'regularFrustum': {
      const n = order.length / 2
      return starTemplate(solid, order.slice(0, n), order.slice(n))
    }
    case 'octahedron':
      return octahedronTemplate(solid, order)
    case 'hull':
      switch (spec.shape) {
        case 'prism': {
          const n = order.length / 2
          return prismTemplate(solid, order.slice(0, n), order.slice(n))
        }
        case 'pyramid':
        case 'tetrahedron':
          return starTemplate(solid, order.slice(0, -1), order[order.length - 1])
        case 'hull':
          // The spec's non-goal: general polyhedron unfolding.
          throw new Error(`"${name}" is a hull of named points, which has no template net — ${NET_SOLIDS}`)
      }
      break
  }
  return null
}

// ---------------------------------------------------------------------------
// Unfolding a template
// ---------------------------------------------------------------------------

// A net of a polyhedron, or a refusal in words. `names` are the author's
// letters by vertex index, for the lines' identities.
export function polyhedronNet(body: SolidBody, name: string, names: readonly (string | undefined)[] = []): Net | null {
  const template = templateOf(body, name)
  if (!template || !body.polyhedron) return null
  const solid = body.polyhedron
  const net = unfoldTree(solid, template, names)
  refuseOverlap(net, netSolidWord(body), name)
  return net
}

// N2's guard: a net that overlaps itself is refused, never drawn.
export function refuseOverlap(net: Net, word: string, name: string): void {
  if (netOverlaps(net.faces, net.copies)) {
    throw new Error(`"${name}": this ${word}'s ${net.shape} net overlaps itself, so it cannot be drawn flat in one piece`)
  }
}

function unfoldTree(solid: Solid3D, template: Template, names: readonly (string | undefined)[]): Net {
  const placed = new Map<number, Map<number, Vec2>>()
  placed.set(template.root, rootChart(solid, template.root, template.rootEdge[0], template.rootEdge[1]))
  for (const child of template.children) {
    placed.set(child.face, attachChart(solid, child.face, child.edge[0], child.edge[1], placed.get(child.parent)!))
  }
  return placedNet(solid, template.shape, template.root, template.children, placed, names)
}

// A net from faces already placed flat: the root, then each child with the
// face it hangs off and the edge they share (its fold). Serves a template's
// net and a shortest path's strip of faces (N3's `unfold`).
export function placedNet(
  solid: Solid3D,
  shape: Net['shape'],
  root: number,
  children: readonly { face: number; parent: number; edge: [number, number] }[],
  placed: ReadonlyMap<number, ReadonlyMap<number, Vec2>>,
  names: readonly (string | undefined)[]
): Net {
  const template = { children }
  const order = [root, ...children.map((c) => c.face)]
  const faces: NetFace[] = order.map((face) => ({
    face,
    vertices: solid.faces[face].slice(),
    corners: solid.faces[face].map((v) => placed.get(face)!.get(v)!),
  }))

  // Copies: (face, vertex) pairs joined across every fold line.
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  for (const f of faces) for (const v of f.vertices) parent.set(`${f.face}:${v}`, `${f.face}:${v}`)
  const folds = new Set<string>()
  for (const child of template.children) {
    for (const v of child.edge) {
      const a = find(`${child.face}:${v}`)
      const b = find(`${child.parent}:${v}`)
      if (a !== b) parent.set(a, b)
    }
    folds.add(foldKey(child.face, child.edge))
    folds.add(foldKey(child.parent, child.edge))
  }
  const copyIndex = new Map<string, number>()
  const copyKeys = new Map<string, number>()
  const letters: NetLetter[] = []
  const touching: Vec2[][] = []
  for (const f of faces) {
    const centre = centroid2(f.corners)
    f.vertices.forEach((v, i) => {
      const root = find(`${f.face}:${v}`)
      let index = copyIndex.get(root)
      if (index === undefined) {
        index = letters.length
        copyIndex.set(root, index)
        letters.push({ at: f.corners[i], vertex: v, toward: centre })
        touching.push([])
      }
      touching[index].push(centre)
      copyKeys.set(`${f.face}:${v}`, index)
    })
  }
  letters.forEach((letter, i) => (letter.toward = centroid2(touching[i])))

  const label = (v: number) => names[v] ?? String(v)
  const lines: NetLine[] = []
  for (const child of template.children) {
    const at = placed.get(child.face)!
    lines.push({
      piece: { kind: 'segment', a: at.get(child.edge[0])!, b: at.get(child.edge[1])! },
      fold: true,
      object: `fold-${label(child.edge[0])}-${label(child.edge[1])}`,
    })
  }
  for (const f of faces) {
    f.vertices.forEach((v, i) => {
      const w = f.vertices[(i + 1) % f.vertices.length]
      if (folds.has(foldKey(f.face, [v, w]))) return
      lines.push({ piece: { kind: 'segment', a: f.corners[i], b: f.corners[(i + 1) % f.corners.length] }, fold: false, object: `cut-${label(v)}-${label(w)}` })
    })
  }
  return { shape, faces, lines, letters, copies: copyKeys }
}

function foldKey(face: number, [a, b]: readonly [number, number] | number[]): string {
  return `${face}:${Math.min(a, b)}-${Math.max(a, b)}`
}

export function centroid2(points: readonly Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x / points.length
    y += p.y / points.length
  }
  return { x, y }
}

// ---------------------------------------------------------------------------
// The overlap check (N2), exact
// ---------------------------------------------------------------------------

// Whether any two faces of a flat net overlap with positive area. Two faces
// may touch where they share a corner copy (along a fold, or at one corner);
// anything else is an overlap: two edges that share no copy crossing
// properly, or a corner (not shared) or the centroid of one face strictly
// inside another. The faces are convex, so these cover every way two of them
// can overlap. Tolerances are GEOM_EPS scaled to the net's own size.
export function netOverlaps(faces: readonly NetFace[], copies: ReadonlyMap<string, number>): boolean {
  let size = 1
  for (const f of faces) for (const p of f.corners) size = Math.max(size, Math.abs(p.x), Math.abs(p.y))
  const tolerance = GEOM_EPS * size
  const copyOf = (f: NetFace, i: number) => copies.get(`${f.face}:${f.vertices[i]}`)
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const f = faces[i]
      const g = faces[j]
      const fCopies = new Set(f.vertices.map((_, k) => copyOf(f, k)))
      const gCopies = new Set(g.vertices.map((_, k) => copyOf(g, k)))
      for (let a = 0; a < f.corners.length; a++) {
        const a2 = (a + 1) % f.corners.length
        for (let b = 0; b < g.corners.length; b++) {
          const b2 = (b + 1) % g.corners.length
          const shared = [copyOf(f, a), copyOf(f, a2)].some((c) => c === copyOf(g, b) || c === copyOf(g, b2))
          if (shared) continue
          if (properlyCross(f.corners[a], f.corners[a2], g.corners[b], g.corners[b2], tolerance)) return true
        }
      }
      for (const [inner, outer, outerCopies] of [
        [g, f, fCopies],
        [f, g, gCopies],
      ] as const) {
        for (let k = 0; k < inner.corners.length; k++) {
          if (outerCopies.has(copyOf(inner, k))) continue
          if (strictlyInside(inner.corners[k], outer.corners, tolerance)) return true
        }
        if (strictlyInside(centroid2(inner.corners), outer.corners, tolerance)) return true
      }
    }
  }
  return false
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

// Two segments crossing at a point interior to both (not at an end, not
// merely touching, not collinear).
function properlyCross(p: Vec2, q: Vec2, r: Vec2, s: Vec2, tolerance: number): boolean {
  const scale = Math.max(Math.hypot(q.x - p.x, q.y - p.y), Math.hypot(s.x - r.x, s.y - r.y))
  const eps = tolerance * scale
  const d1 = cross2(p, q, r)
  const d2 = cross2(p, q, s)
  const d3 = cross2(r, s, p)
  const d4 = cross2(r, s, q)
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

// Strictly inside a convex polygon, whichever way it is wound.
function strictlyInside(p: Vec2, polygon: readonly Vec2[], tolerance: number): boolean {
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const c = cross2(a, b, p)
    const eps = tolerance * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
    if (Math.abs(c) <= eps) return false
    const s = c > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Round solids (task 2): the lateral surface unrolled, in closed form
// ---------------------------------------------------------------------------
//
// A cylinder's lateral surface unrolls to a rectangle 2 pi r by h; a cone's
// to a sector of radius l (the slant) and angle 2 pi r / l; a conical
// frustum's to an annular sector cut from its extended cone's. Each is exact:
// arc length along a rim is preserved, and so is distance along a generator.
//
// Everything is read in the solid's LOCAL frame (P1: axis +y, the base rim at
// y = -h/2), through its placement, so a tilted cone unrolls as an upright
// one does. A point's angle round the axis is theta = atan2(z, x), local.
//
// **The seam** runs along the generator directly AWAY from the default
// camera (N2), so the side of the surface facing the viewer lands in the
// middle of the net. Fixed against the DEFAULT camera, never the active view
// (V2), like every placement: the net never turns with "@view:".
//
// **Seen from outside**, as a polyhedron's net is: standing outside the
// surface, axis up, the reader's right is DECREASING theta (the tangent of
// increasing theta is (-sin, 0, cos), and facing in, right = facing x up =
// (sin, 0, -cos)). So a net's horizontal runs with (middle - theta).

// The local angle of the generator facing the default camera: the camera's
// direction in the solid's frame, projected across the axis. A camera
// looking straight down the axis sees no front; the local +x is taken then.
export function frontAngle(body: SolidBody): number {
  const d = rotateToLocal(body.placement, DEFAULT_CAMERA.direction)
  return Math.hypot(d.x, d.z) <= GEOM_EPS ? 0 : Math.atan2(d.z, d.x)
}

// An angle wrapped into [-pi, pi).
export function wrapAngle(t: number): number {
  const turn = 2 * Math.PI
  return t - turn * Math.floor((t + Math.PI) / turn)
}

// A round solid's lateral surface, as it unrolls.
//  - cylinder: radius and height; unrolled as a rectangle.
//  - cone and frustum: radius (the base rim, the wider), top (0 for a cone)
//    and height; slant is the extended cone's slant, from the apex (virtual
//    for a frustum) to the base rim, and inner the top rim's distance from
//    it; sector = 2 pi radius / slant, the angle unrolled; apexY the apex's
//    local height.
export type Unrolling =
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'cone' | 'frustum'; radius: number; top: number; height: number; slant: number; inner: number; sector: number; apexY: number }

export function unrollingOf(body: SolidBody): Unrolling | null {
  const spec = body.spec
  switch (spec.kind) {
    case 'cylinder':
      return { kind: 'cylinder', radius: spec.radius, height: spec.height }
    case 'cone': {
      const slant = Math.hypot(spec.radius, spec.height)
      return { kind: 'cone', radius: spec.radius, top: 0, height: spec.height, slant, inner: 0, sector: (2 * Math.PI * spec.radius) / slant, apexY: spec.height / 2 }
    }
    case 'frustum': {
      // P2: the wider rim is always the LOCAL base.
      const { bottom, top } = frustumRadii(spec)
      // The extended cone: its slant from the virtual apex to the base rim is
      // the frustum's slant scaled by R / (R - r); the top rim sits r / R of
      // the way along it from the apex.
      const slant = (Math.hypot(bottom - top, spec.height) * bottom) / (bottom - top)
      const apexY = -spec.height / 2 + (spec.height * bottom) / (bottom - top)
      return { kind: 'frustum', radius: bottom, top, height: spec.height, slant, inner: (slant * top) / bottom, sector: (2 * Math.PI * bottom) / slant, apexY }
    }
    default:
      return null
  }
}

// Where the generator at local angle theta runs in an unrolling cut along
// the generator at `seam`: its horizontal position (a cylinder) or its polar
// angle about the apex (a cone or frustum, opening downward), measured from
// the unrolling's middle — the generator opposite the seam.
export function unrolledAngle(unrolling: Unrolling, seam: number, theta: number): number {
  const around = wrapAngle(seam + Math.PI - theta)
  if (unrolling.kind === 'cylinder') return unrolling.radius * around
  return -Math.PI / 2 + (around * unrolling.radius) / unrolling.slant
}

// A local point of the lateral surface, unrolled: (x, height above the base
// rim) for a cylinder; about the apex at the origin for a cone or frustum.
export function unrolledPoint(unrolling: Unrolling, seam: number, p: Vec3): Vec2 {
  const theta = Math.atan2(p.z, p.x)
  if (unrolling.kind === 'cylinder') return { x: unrolledAngle(unrolling, seam, theta), y: p.y + unrolling.height / 2 }
  const rho = distanceFromApex(unrolling, p)
  // The apex has no angle round the axis; it unrolls to the origin.
  if (rho === 0) return { x: 0, y: 0 }
  const phi = unrolledAngle(unrolling, seam, theta)
  return { x: rho * Math.cos(phi), y: rho * Math.sin(phi) }
}

// A lateral point's distance from the (virtual) apex, along its generator.
export function distanceFromApex(unrolling: Extract<Unrolling, { kind: 'cone' | 'frustum' }>, p: Vec3): number {
  return Math.hypot(p.x, p.y - unrolling.apexY, p.z)
}

// N2: the round templates, the seam behind (front + pi).
function roundNet(body: SolidBody): Net | null {
  const unrolling = unrollingOf(body)
  return unrolling ? unrolledNet(unrolling, true) : null
}

// The unrolled lateral surface, centred on its middle generator, and — for a
// net — the rims' circles, tangent at the middle of the edges they fold on.
// With `withRims` the rim edges are folds (dashed); without them (a shortest
// path's unrolling, task 4) the rims are the boundary, drawn solid.
export function unrolledNet(unrolling: Unrolling, withRims: boolean): Net {
  const lines: NetLine[] = []
  const rim = (piece: NetPiece, object: string) => lines.push({ piece, fold: withRims, object: `${withRims ? 'fold' : 'cut'}-${object}` })
  const cut = (piece: NetPiece, object: string) => lines.push({ piece, fold: false, object: `cut-${object}` })
  if (unrolling.kind === 'cylinder') {
    // A rectangle 2 pi r wide and h tall, centred on x = 0; the base circle
    // tangent under the bottom edge's midpoint, the top's over the top edge's.
    const { radius: r, height: h } = unrolling
    const half = Math.PI * r
    rim({ kind: 'segment', a: { x: -half, y: 0 }, b: { x: half, y: 0 } }, 'base')
    rim({ kind: 'segment', a: { x: -half, y: h }, b: { x: half, y: h } }, 'top')
    cut({ kind: 'segment', a: { x: -half, y: 0 }, b: { x: -half, y: h } }, 'seam')
    cut({ kind: 'segment', a: { x: half, y: 0 }, b: { x: half, y: h } }, 'seam')
    if (withRims) {
      cut({ kind: 'arc', center: { x: 0, y: -r }, radius: r, from: 0, to: 2 * Math.PI }, 'base')
      cut({ kind: 'arc', center: { x: 0, y: h + r }, radius: r, from: 0, to: 2 * Math.PI }, 'top')
    }
    return { shape: 'net', faces: [], lines, letters: [], copies: new Map() }
  }
  // A sector (annular for a frustum) about the apex at the origin, symmetric
  // about the vertical and opening downward: polar angles -pi/2 -/+ half the
  // sector angle. The base circle is tangent at the outer arc's midpoint,
  // (0, -slant), from outside; a frustum's top circle at the inner arc's
  // midpoint, (0, -inner), from inside the hole — it fits, its far side
  // exactly inner from the apex.
  const { slant, inner, sector, radius, top } = unrolling
  const from = -Math.PI / 2 - sector / 2
  const to = -Math.PI / 2 + sector / 2
  const at = (rho: number, phi: number): Vec2 => ({ x: rho * Math.cos(phi), y: rho * Math.sin(phi) })
  rim({ kind: 'arc', center: { x: 0, y: 0 }, radius: slant, from, to }, 'base')
  if (unrolling.kind === 'frustum') rim({ kind: 'arc', center: { x: 0, y: 0 }, radius: inner, from, to }, 'top')
  cut({ kind: 'segment', a: at(inner, from), b: at(slant, from) }, 'seam')
  cut({ kind: 'segment', a: at(inner, to), b: at(slant, to) }, 'seam')
  if (withRims) {
    cut({ kind: 'arc', center: { x: 0, y: -slant - radius }, radius, from: 0, to: 2 * Math.PI }, 'base')
    if (unrolling.kind === 'frustum') cut({ kind: 'arc', center: { x: 0, y: -inner + top }, radius: top, from: 0, to: 2 * Math.PI }, 'top')
  }
  return { shape: 'net', faces: [], lines, letters: [], copies: new Map() }
}

// The seam of a round solid's NET: the generator directly away from the
// default camera.
export function netSeam(body: SolidBody): number {
  return frontAngle(body) + Math.PI
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

// The net of a solid, or a refusal naming why there is none.
export function netOf(body: SolidBody, name: string, names: readonly (string | undefined)[] = []): Net {
  if (body.spec.kind === 'sphere') throw new Error(`"${name}" is a sphere, and a sphere has no net — ${NET_SOLIDS}`)
  const net = polyhedronNet(body, name, names) ?? roundNet(body)
  if (net) return net
  throw new Error(`"${name}" is ${netSolidWord(body)}, and ${NET_SOLIDS}`)
}
