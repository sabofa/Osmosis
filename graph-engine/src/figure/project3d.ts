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
import { svgLine } from './svg'

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

// The direction from the scene toward the camera: the (1,1,1) corner, the
// standard isometric viewpoint. A face is turned toward the viewer exactly
// when its outward normal has a positive component along this.
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
export const VIEWPOINT_NAMES = ['isometric', 'front', 'top', 'side'] as const

export type ViewName = (typeof VIEWPOINT_NAMES)[number]

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
}

const INV_SQRT2 = 1 / Math.sqrt(2)
const INV_SQRT6 = 1 / Math.sqrt(6)

const CAMERAS: Record<ViewName, Camera> = {
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

export interface ProjectedEdge {
  a: Vec2
  b: Vec2
  // Dashed when drawn. An edge is hidden when **every** face meeting along it
  // turns away from the camera — the standard convex-solid rule, and the one
  // a textbook drawing follows. Depth alone would be the wrong test: a
  // squashed box has near-identical depths on both sides and would classify
  // at random.
  hidden: boolean
  vertices: [number, number]
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// Edges in first-seen order over the faces, which is a deterministic function
// of the solid's own face list — the property the byte-identical requirement
// rests on.
export function projectSolid(solid: Solid3D, camera: Camera = ISOMETRIC_CAMERA): ProjectedEdge[] {
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
export function renderSolidFigure(solid: Solid3D, palette: Palette, camera: Camera = ISOMETRIC_CAMERA): string {
  const theme = figureTheme(palette)
  const edges = projectSolid(solid, camera)

  const world = boundsOf(edges.flatMap((e) => [e.a, e.b])) ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  const projection = fitProjection(world)

  const layers = emptyFigureLayers()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const line = svgLine(projection.toView(edge.a), projection.toView(edge.b), {
      stroke: theme.ink,
      'stroke-width': edge.hidden ? STROKE_HIDDEN : STROKE_VISIBLE,
      'stroke-linecap': 'round',
      'stroke-dasharray': edge.hidden ? HIDDEN_DASH : null,
      opacity: edge.hidden ? HIDDEN_OPACITY : null,
      'data-statement': 0,
      'data-object': `edge-${edge.vertices[0]}-${edge.vertices[1]}`,
    })
    layers[edge.hidden ? 'auxiliary' : 'primary'].push(line)
  }

  const view = edges.flatMap((e) => [projection.toView(e.a), projection.toView(e.b)])
  const bounds = boundsOf(view)
  const rect: Rect = bounds
    ? { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
    : { x: 0, y: 0, width: 0, height: 0 }

  return figureDocument(layers, growRect(unionRects([rect]), FIGURE_PADDING), theme)
}
