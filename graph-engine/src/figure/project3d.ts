import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import {
  boundsOf,
  emptyFigureLayers,
  FIGURE_PADDING,
  figureDocument,
  figureTheme,
  fitProjection,
  growRect,
  unionRects,
  type Rect,
} from './document'
import { authorToWorld } from './authorFrame'
import { ellipsePoint, ellipticalArcCommand, lineCommand, svgClosedPath, svgEllipticalArc, svgLine, type SvgAttrs } from './svg'

// 3D solids, drawn through the same SVG renderer.
//
// The spec's decision — test-style solids are *drawings*, not 3D scenes —
// is what this module implements: geometry is computed in 3D, projected
// through a **fixed** axonometric camera, and handed to the figure renderer
// as 2D lines plus a visible/hidden classification. There is no orbit and no
// perspective, and neither is a missing feature. A drawing of a prism in a
// textbook is always drawn from the same corner, and perspective converges
// parallel lines, which is exactly what makes a dimension unreadable.
//
// This phase builds **the pipeline and one primitive** — a rectangular prism
// — to prove the path end to end. The rest of the solid vocabulary (cylinder,
// cone, sphere, pyramid, cross-sections, nets, composites) is a later phase
// and none of it changes what is here; it only changes what feeds it.

export interface Vec3 {
  x: number
  y: number
  z: number
}

// A solid as vertices plus faces. A face is a loop of vertex indices wound
// **counter-clockwise as seen from outside**, which is what makes the
// outward normal computable and therefore what makes hidden-edge
// classification possible at all.
export interface Solid3D {
  vertices: Vec3[]
  faces: number[][]
}

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

// The direction from the scene toward the ISOMETRIC camera: the (1,1,1)
// corner. No longer the default view (see DEFAULT_VIEW); kept because the
// isometric view still looks along it.
export const CAMERA_DIRECTION: Vec3 = { x: 1, y: 1, z: 1 }

const COS30 = Math.sqrt(3) / 2

// ---------------------------------------------------------------------------
// Named viewpoints
// ---------------------------------------------------------------------------

// **The camera is fixed, but not to one direction.** Free orbit stays
// rejected — these are drawings — but a single fixed viewpoint is degenerate
// for a solid whose features align with the view direction, so the engine
// offers a small NAMED set. Determinism is untouched (a name is not a
// control) and an author can escape a bad projection.
export const VIEWPOINT_NAMES = ['standard', 'isometric', 'front', 'top', 'side'] as const

export type ViewName = (typeof VIEWPOINT_NAMES)[number]

// V1 — **the default view is not isometric** (decided 2026-09-26). Exact
// isometric looks along a cube's space diagonal, so a cube's front and back
// corners project to ONE point, and a regular tetrahedron flattens until its
// altitude lies under an edge: the two most common competition solids, both
// drawn wrong. The default is `standard` instead, an orthographic view in
// general position. `isometric` stays, by name and with its exact bytes.
export const DEFAULT_VIEW: ViewName = 'standard'

// The standard view's direction, in the AUTHOR frame (z up): azimuth measured
// from +X toward +Y, elevation up from the XY-plane, both in degrees.
// Measured at this camera, the closest two unit-cube vertices sit 0.49 apart
// on the page, and every face of a regular tetrahedron (placed as solids.ts
// places it) stays at least 21 degrees from edge-on.
export const STANDARD_AZIMUTH = 30
export const STANDARD_ELEVATION = 25

// A camera is an ORTHOGRAPHIC frame plus one uniform scale.
//
// `right` and `up` are unit vectors spanning the picture plane and `direction`
// is the unit vector from the scene toward the viewer, with
// right x up = direction. `project` is (scale * p.right, scale * p.up) — the
// *same* uniform factor on both axes, which is exactly the property that makes
// a projected circle an ellipse whose axes can be computed in closed form.
// Curved silhouettes (phase 5, task 4) rest on it; without it they would each
// be an unknown conic.
//
// `project` is given explicitly rather than derived from the frame so that the
// isometric camera keeps the arithmetic it has always had, to the last bit.
// The byte-identical requirement is a statement about output, and re-deriving
// `(x - z) * cos30` as `scale * dot(p, right)` would change the last digit of
// some coordinates and therefore the bytes.
export interface Camera {
  name: ViewName
  direction: Vec3
  right: Vec3
  up: Vec3
  scale: number
  project(p: Vec3): Vec2
  // The LINEAR part of `project`, for a camera whose `project` carries a
  // translation: a round solid's local camera (silhouette.ts, P1), whose
  // `project(p)` is the world camera's projection of the placed point. A
  // radius VECTOR must not pick up that translation, so projecting one goes
  // through this. Absent on every world camera, whose `project` is itself
  // linear — which is what keeps their arithmetic, and their bytes, as they
  // were.
  projectVector?(v: Vec3): Vec2
}

const INV_SQRT2 = 1 / Math.sqrt(2)
const INV_SQRT6 = 1 / Math.sqrt(6)

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

// An orthographic camera built from its FRAME: looking from `azimuth` and
// `elevation` (degrees, author frame), with author Z drawn page-up, so every
// vertical edge draws vertical. `up` is author Z with its component along the
// view removed; `right` is up x direction, which is what keeps
// (right, up, direction) right-handed. The whole frame is then carried into
// the internal frame through authorFrame.ts, the one module that knows both.
//
// `project` is the frame itself — (scale * p.right, scale * p.up) — because a
// camera built this way has no legacy bytes to protect. Only `isometric`
// keeps a hand-written route, and only for that reason.
function orthographicCamera(name: ViewName, azimuth: number, elevation: number, scale: number): Camera {
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  const direction: Vec3 = { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) }
  const along = direction.z
  const raw: Vec3 = { x: -along * direction.x, y: -along * direction.y, z: 1 - along * direction.z }
  const length = Math.hypot(raw.x, raw.y, raw.z)
  const up: Vec3 = { x: raw.x / length, y: raw.y / length, z: raw.z / length }
  const right: Vec3 = {
    x: up.y * direction.z - up.z * direction.y,
    y: up.z * direction.x - up.x * direction.z,
    z: up.x * direction.y - up.y * direction.x,
  }
  const frame = { direction: authorToWorld(direction), right: authorToWorld(right), up: authorToWorld(up) }
  return {
    name,
    ...frame,
    scale,
    project: (p) => ({ x: scale * dot3(p, frame.right), y: scale * dot3(p, frame.up) }),
  }
}

const CAMERAS: Record<ViewName, Camera> = {
  // V1: the default. General position, so no two vertices of a cube and no
  // edge of a regular tetrahedron line up with the view.
  standard: orthographicCamera('standard', STANDARD_AZIMUTH, STANDARD_ELEVATION, 1),
  // The (1,1,1) corner. right = (1,0,-1)/sqrt2, up = (-1,2,-1)/sqrt6, and the
  // uniform scale is sqrt(6)/2 — which is precisely what `projectPoint`
  // computes, by a route chosen for its bytes rather than its symmetry.
  isometric: {
    name: 'isometric',
    direction: { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
    right: { x: INV_SQRT2, y: 0, z: -INV_SQRT2 },
    up: { x: -INV_SQRT6, y: 2 * INV_SQRT6, z: -INV_SQRT6 },
    scale: Math.sqrt(6) / 2,
    project: (p) => projectPoint(p),
  },
  // Straight down -z. The page IS the xy-plane, so a front elevation reads
  // its width and height off the drawing directly.
  front: {
    name: 'front',
    direction: { x: 0, y: 0, z: 1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    scale: 1,
    project: (p) => ({ x: p.x, y: p.y }),
  },
  // Down -y, the plan view. +z runs DOWN the page, the convention a plan
  // drawing uses, which is why `up` is -z.
  top: {
    name: 'top',
    direction: { x: 0, y: 1, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
    scale: 1,
    project: (p) => ({ x: p.x, y: -p.z }),
  },
  // Along -x, the side elevation. +z runs LEFT, which is what keeps
  // (right, up, direction) right-handed and the drawing un-mirrored.
  side: {
    name: 'side',
    direction: { x: 1, y: 0, z: 0 },
    right: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    scale: 1,
    project: (p) => ({ x: -p.z, y: p.y }),
  },
}

export function cameraFor(name: ViewName): Camera {
  return CAMERAS[name]
}

export const ISOMETRIC_CAMERA = CAMERAS.isometric

// The camera a spec with no `@view:` is drawn through — and the one every
// placement convention in solids.ts is fixed against (V2), whatever view is
// active.
export const DEFAULT_CAMERA = CAMERAS[DEFAULT_VIEW]

// Isometric projection onto the plane perpendicular to (1,1,1):
//
//   u = (x - z) * cos30
//   v = y - (x + z) / 2
//
// y stays up (the figure projection flips it for SVG later), so the vertical
// axis of the drawing is the solid's own height — which is what makes a
// height dimension readable off the page.
//
// The kernel of this map is exactly the (1,1,1) direction, which is the
// formal statement of "this is the view axis".
export function projectPoint(p: Vec3): Vec2 {
  return { x: (p.x - p.z) * COS30, y: p.y - (p.x + p.z) / 2 }
}

// ---------------------------------------------------------------------------
// Faces and edges
// ---------------------------------------------------------------------------

// Newell's method: sums the cross terms around the whole loop rather than
// taking one corner's cross product, so a face with a near-degenerate corner
// (or more than three vertices that are not exactly coplanar) still gets a
// sensible normal instead of numerical noise.
export function faceNormal(solid: Solid3D, faceIndex: number): Vec3 {
  const face = solid.faces[faceIndex]
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < face.length; i++) {
    const a = solid.vertices[face[i]]
    const b = solid.vertices[face[(i + 1) % face.length]]
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return { x: nx, y: ny, z: nz }
}

function facesCamera(normal: Vec3, camera: Camera): boolean {
  return normal.x * camera.direction.x + normal.y * camera.direction.y + normal.z * camera.direction.z > 0
}

// ---------------------------------------------------------------------------
// The drawn-edge type (H3)
// ---------------------------------------------------------------------------
//
// **An outline is not made only of straight segments.** A cylinder's is two
// lines and two elliptical arcs, a cone's is two lines and an ellipse, a
// sphere's is a circle. None of that is vertices-and-faces, and none of it
// fits a type carrying two endpoints.
//
// So the drawn-edge type is a union, and the two members are the two things a
// solid's outline is ever made of. Faceting the curves into fine polyhedra so
// one member would do was considered and rejected: silhouettes go visibly
// polygonal under the zoom the figure view now offers, faceting generates
// dozens of spurious edges that then have to be suppressed, and it discards
// the crispness that chose SVG in the first place.

export interface ProjectedSegment {
  kind: 'segment'
  a: Vec2
  b: Vec2
  // Dashed when drawn. An edge is hidden when **every** face meeting along it
  // turns away from the camera — the standard convex-solid rule, and the one
  // a textbook drawing follows. Depth alone would be the wrong test: a
  // squashed box has near-identical depths on both sides and would classify
  // at random.
  hidden: boolean
  vertices: [number, number]
  // An explicit name for the emitted element, for a segment that joins no
  // pair of vertices — a cylinder's silhouette line, a cone's generator.
  // Absent for a polyhedron's edge, which names itself by its endpoints.
  object?: string
}

// A piece of the ellipse a circle in space projects to.
//
// `rotation`, `startAngle` and `endAngle` are radians and the angles are the
// ELLIPSE PARAMETER, not a polar angle — the parametrisation an orthographic
// projection of a circle hands over directly (see svg.ts's svgEllipticalArc).
// Everything is in the same projected, y-up space a ProjectedSegment's
// endpoints are in; the figure's own projection flips it for SVG later.
//
// `object` is what the emitted element's `data-object` says, since an arc has
// no pair of vertex indices to name itself with.
export interface ProjectedArc {
  kind: 'arc'
  center: Vec2
  rx: number
  ry: number
  rotation: number
  startAngle: number
  endAngle: number
  hidden: boolean
  object: string
}

export type ProjectedEdge = ProjectedSegment | ProjectedArc

// Every point that bounds a drawn edge — exact, never sampled.
//
// For an arc that means its two ends plus whichever of the four parameters
// where the ellipse turns back on itself the sweep actually passes through.
// Exact in both directions: an arc bounded by its whole ellipse would leave
// most of a figure empty, and one bounded by its endpoints alone would be
// cropped through its own bulge.
export function edgeExtremes(edge: ProjectedEdge): Vec2[] {
  if (edge.kind === 'segment') return [edge.a, edge.b]
  const at = (t: number) => ellipsePoint(edge.center, edge.rx, edge.ry, edge.rotation, t)
  const points = [at(edge.startAngle), at(edge.endAngle)]
  const cos = Math.cos(edge.rotation)
  const sin = Math.sin(edge.rotation)
  // x(t) = cx + rx cos(rot) cos t - ry sin(rot) sin t, stationary where its
  // derivative vanishes; likewise y. Two parameters each, half a turn apart.
  const stationary = [Math.atan2(-edge.ry * sin, edge.rx * cos), Math.atan2(edge.ry * cos, edge.rx * sin)]
  const sweep = edge.endAngle - edge.startAngle
  for (const base of stationary) {
    for (const t of [base, base + Math.PI]) {
      // How far along the sweep's own direction of travel this parameter is.
      const along = sweep >= 0 ? t - edge.startAngle : edge.startAngle - t
      const wrapped = ((along % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      if (wrapped <= Math.abs(sweep)) points.push(at(sweep >= 0 ? edge.startAngle + wrapped : edge.startAngle - wrapped))
    }
  }
  return points
}

// One drawn edge, emitted. **The single place either member of the union
// becomes markup**, so a caller never dispatches on the kind itself and the
// two can never drift apart in stroke, order or identity.
//
// `toView` and `scale` are the figure's own projection: an arc's radii scale
// with it, and its rotation and parameters NEGATE, because view space flips y
// — the same conversion a circular arc already makes in render.ts, and doing
// it to the rotation and both angles at once converts the whole ellipse.
export function drawEdge(edge: ProjectedEdge, toView: (p: Vec2) => Vec2, scale: number, style: SvgAttrs): string {
  if (edge.kind === 'segment') return svgLine(toView(edge.a), toView(edge.b), style)
  // `fill: none` belongs to the arc and not to the caller's style: a `<path>`
  // fills by default and a `<line>` has nothing to fill, so putting it in the
  // shared style would paint a solid black lens under every curved outline
  // OR add a dead attribute to every straight edge. Callers pass stroke.
  return svgEllipticalArc(
    toView(edge.center),
    edge.rx * scale,
    edge.ry * scale,
    -edge.rotation,
    -edge.startAngle,
    -edge.endAngle,
    { fill: 'none', ...style }
  )
}

// A closed chain of drawn edges — a section's region (phase 8) — as ONE
// filled path, through the same conversions `drawEdge` makes: an arc's radii
// scale with the figure and its rotation and parameters negate, because view
// space flips y.
export function drawClosedEdges(edges: readonly ProjectedEdge[], toView: (p: Vec2) => Vec2, scale: number, style: SvgAttrs): string {
  let start: Vec2 | null = null
  const commands: string[] = []
  for (const edge of edges) {
    if (edge.kind === 'segment') {
      start ??= toView(edge.a)
      commands.push(lineCommand(toView(edge.b)))
      continue
    }
    const { from, command } = ellipticalArcCommand(toView(edge.center), edge.rx * scale, edge.ry * scale, -edge.rotation, -edge.startAngle, -edge.endAngle)
    start ??= from
    commands.push(command)
  }
  return svgClosedPath(start ?? { x: 0, y: 0 }, commands, style)
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// Edges in first-seen order over the faces, which is a deterministic function
// of the solid's own face list — the property the byte-identical requirement
// rests on.
export function projectSolid(solid: Solid3D, camera: Camera = DEFAULT_CAMERA): ProjectedSegment[] {
  const frontFacing = solid.faces.map((_, i) => facesCamera(faceNormal(solid, i), camera))
  const order: [number, number][] = []
  const anyFront = new Map<string, boolean>()

  for (let f = 0; f < solid.faces.length; f++) {
    const face = solid.faces[f]
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = edgeKey(a, b)
      if (!anyFront.has(key)) {
        anyFront.set(key, false)
        order.push([Math.min(a, b), Math.max(a, b)])
      }
      if (frontFacing[f]) anyFront.set(key, true)
    }
  }

  const projected = solid.vertices.map((v) => camera.project(v))
  return order.map(([a, b]) => ({
    kind: 'segment' as const,
    a: projected[a],
    b: projected[b],
    hidden: !anyFront.get(edgeKey(a, b)),
    vertices: [a, b] as [number, number],
  }))
}

// ---------------------------------------------------------------------------
// The one primitive
// ---------------------------------------------------------------------------

// Centred on the origin. Vertex order is a binary count over (x, y, z) at
// min/max, and the six faces are wound counter-clockwise from outside — see
// faceNormal for why the winding is load-bearing rather than cosmetic.
export function rectangularPrism(width: number, height: number, depth: number): Solid3D {
  const x = width / 2
  const y = height / 2
  const z = depth / 2
  const vertices: Vec3[] = [
    { x: -x, y: -y, z: -z },
    { x: x, y: -y, z: -z },
    { x: x, y: y, z: -z },
    { x: -x, y: y, z: -z },
    { x: -x, y: -y, z: z },
    { x: x, y: -y, z: z },
    { x: x, y: y, z: z },
    { x: -x, y: y, z: z },
  ]
  const faces = [
    [4, 5, 6, 7], // +z, toward the viewer
    [1, 0, 3, 2], // -z
    [5, 1, 2, 6], // +x
    [0, 4, 7, 3], // -x
    [3, 7, 6, 2], // +y
    [0, 1, 5, 4], // -y
  ]
  return { vertices, faces }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const STROKE_VISIBLE = 2.4
const STROKE_HIDDEN = 1.8
const HIDDEN_DASH = '9 7'
const HIDDEN_OPACITY = 0.6

// The solid, drawn by the figure renderer: visible edges in the primary
// layer, hidden ones dashed in the auxiliary layer beneath them. Nothing here
// is specific to a prism — feed it any Solid3D.
// What an emitted edge's `data-object` says. A segment names the two
// vertices it joins; an arc carries its own name, because it has none.
export function edgeObject(edge: ProjectedEdge): string {
  if (edge.kind === 'arc') return edge.object
  return edge.object ?? `edge-${edge.vertices[0]}-${edge.vertices[1]}`
}

export function renderSolidFigure(solid: Solid3D, palette: Palette, camera: Camera = DEFAULT_CAMERA): string {
  const theme = figureTheme(palette)
  const edges = projectSolid(solid, camera)

  const world = boundsOf(edges.flatMap(edgeExtremes)) ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  const projection = fitProjection(world)

  const layers = emptyFigureLayers()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const line = drawEdge(edge, projection.toView, projection.scale, {
      stroke: theme.ink,
      'stroke-width': edge.hidden ? STROKE_HIDDEN : STROKE_VISIBLE,
      'stroke-linecap': 'round',
      'stroke-dasharray': edge.hidden ? HIDDEN_DASH : null,
      opacity: edge.hidden ? HIDDEN_OPACITY : null,
      'data-statement': 0,
      'data-object': edgeObject(edge),
    })
    layers[edge.hidden ? 'auxiliary' : 'primary'].push(line)
  }

  const view = edges.flatMap((e) => edgeExtremes(e).map(projection.toView))
  const bounds = boundsOf(view)
  const rect: Rect = bounds
    ? { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
    : { x: 0, y: 0, width: 0, height: 0 }

  return figureDocument(layers, growRect(unionRects([rect]), FIGURE_PADDING), theme)
}
