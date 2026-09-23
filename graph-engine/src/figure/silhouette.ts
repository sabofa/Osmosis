import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import type { Camera, ProjectedArc, ProjectedEdge, ProjectedSegment, Vec3 } from './project3d'

// Analytic silhouettes for the curved primitives (H2).
//
// A cylinder has no edges in the vertices-and-faces sense. Its outline is two
// lines and two elliptical arcs; a sphere's is a circle; a cone's is two lines
// and an ellipse. This module computes those **exactly**, from the primitive's
// own parameters, and hands back the same `ProjectedEdge` union a polyhedron
// produces — one outline contract, two representations behind it.
//
// Nothing here samples anything. The alternative — facet the curves into fine
// polyhedra so the existing code path serves everything — was considered and
// rejected: a faceted silhouette goes visibly polygonal the moment a reader
// zooms, which the figure view now lets them do; it generates dozens of
// spurious facet edges that then have to be suppressed; and it discards the
// crispness that chose SVG in the first place.

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

// ---------------------------------------------------------------------------
// A circle in space, projected
// ---------------------------------------------------------------------------

// What a circle becomes on the page.
//
// `center`, `rx`, `ry` and `rotation` are the drawn ellipse. `parameter(t)`
// converts the CIRCLE's own angle — the one the silhouette maths solves in —
// into the ELLIPSE parameter an arc is drawn with. The two differ by a phase
// and possibly a reflection, and keeping the conversion here is what lets
// every caller reason in circle angles and still draw the right arc.
export interface ProjectedCircle {
  center: Vec2
  rx: number
  ry: number
  rotation: number
  parameter(circleAngle: number): number
}

// An orthographic camera maps a circle to an ellipse and nothing else, which
// is the whole reason `Camera` promises ONE uniform scale on both axes. The
// image is `C + A cos t + B sin t` with A and B the projected radius vectors
// — generally neither perpendicular nor equal in length — so the work here is
// turning that into the axis-and-rotation form SVG's `A` command wants.
//
// The standard rotation: find the phase t0 at which the two coefficient
// vectors become perpendicular, which is half the argument of
// `(2 A·B, |A|² − |B|²)`.
export function projectCircle(camera: Camera, center: Vec3, u: Vec3, v: Vec3): ProjectedCircle {
  // The camera's projection is linear, so it maps the radius VECTORS the same
  // way it maps points — no subtraction of the centre needed.
  const a = camera.project(u)
  const b = camera.project(v)
  const t0 = 0.5 * Math.atan2(2 * (a.x * b.x + a.y * b.y), a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))
  const cos = Math.cos(t0)
  const sin = Math.sin(t0)
  const major = { x: a.x * cos + b.x * sin, y: a.y * cos + b.y * sin }
  const minor = { x: -a.x * sin + b.x * cos, y: -a.y * sin + b.y * cos }
  const rx = Math.hypot(major.x, major.y)
  const ry = Math.hypot(minor.x, minor.y)
  // The minor axis is perpendicular to the major one, so it is either a
  // quarter turn ahead of it or a quarter turn behind. Behind means the
  // circle's angle runs backwards along the drawn ellipse, and the sign is
  // where that gets recorded rather than being lost.
  const sign = cross2(major, minor) < 0 ? -1 : 1
  const rotation = Math.atan2(major.y, major.x)
  return {
    center: camera.project(center),
    rx,
    ry,
    rotation,
    parameter: (circleAngle: number) => sign * (circleAngle - t0),
  }
}

// One arc of a projected circle, between two of its own angles.
function arcOfCircle(circle: ProjectedCircle, from: number, to: number, hidden: boolean, object: string): ProjectedArc {
  return {
    kind: 'arc',
    center: circle.center,
    rx: circle.rx,
    ry: circle.ry,
    rotation: circle.rotation,
    startAngle: circle.parameter(from),
    endAngle: circle.parameter(to),
    hidden,
    object,
  }
}

// ---------------------------------------------------------------------------
// The primitives
// ---------------------------------------------------------------------------

// Every curved primitive here has its axis along +y (see solids.ts's H1
// convention), so its circles lie in xz-planes and these are their radius
// vectors.
const AXIS: Vec3 = { x: 0, y: 1, z: 0 }

function radiusX(r: number): Vec3 {
  return { x: r, y: 0, z: 0 }
}

function radiusZ(r: number): Vec3 {
  return { x: 0, y: 0, z: r }
}

// The two angles at which a cylinder's surface turns away from the camera:
// where the outward normal `(cos t, 0, sin t)` is perpendicular to the view.
// Null when the camera looks along the axis, where there is no such angle
// because the whole rim is the silhouette.
function cylinderSilhouetteAngles(camera: Camera): [number, number] | null {
  const ax = camera.direction.x
  const az = camera.direction.z
  if (Math.hypot(ax, az) <= GEOM_EPS) return null
  const first = Math.atan2(-ax, az)
  return [first, first + Math.PI]
}

// A cylinder: two silhouette lines and two rims.
//
// The near rim is a complete ellipse — nothing of the solid is in front of
// it. The far rim is split at the silhouette angles: the half whose surface
// turns toward the camera is drawn, and the half behind the body is dashed.
// That is exactly the textbook drawing, and it falls out of the same
// normal-versus-view test the polyhedron rule uses.
export function cylinderOutline(radius: number, height: number, camera: Camera): ProjectedEdge[] {
  const y = height / 2
  const u = radiusX(radius)
  const v = radiusZ(radius)
  const axisTowardCamera = dot3(AXIS, camera.direction)
  const top = projectCircle(camera, { x: 0, y, z: 0 }, u, v)
  const bottom = projectCircle(camera, { x: 0, y: -y, z: 0 }, u, v)
  const angles = cylinderSilhouetteAngles(camera)

  // Looking straight down the axis: the cylinder IS its own rim, the two
  // rims coincide exactly, and there are no silhouette lines to draw. One
  // circle is the honest picture; two would be the same ink twice.
  if (!angles) {
    const near = axisTowardCamera >= 0 ? top : bottom
    return fullEllipse(near, 'rim-near')
  }

  const [first, second] = angles
  // Which rim is nearer the camera. When the axis is perpendicular to the
  // view neither is, both rims project to the same straight segment, and the
  // drawing is a rectangle — so nothing is hidden and either choice of
  // "near" gives the same ink.
  const edgeOn = Math.abs(axisTowardCamera) <= GEOM_EPS
  const near = axisTowardCamera >= 0 ? top : bottom
  const far = axisTowardCamera >= 0 ? bottom : top

  // Of the two halves of the far rim, the one whose surface faces the camera
  // is **always the one that follows `first`**, and that is a fact about how
  // `first` is chosen rather than a coincidence worth branching on. With
  // `first = atan2(-dx, dz)`, the surface normal a quarter turn later is
  // `(dx, 0, dz) / |(dx, dz)|`, whose dot with the view direction is
  // `|(dx, dz)|` — positive for every camera that has a silhouette at all.
  // A branch here would be dead code, and dead code that looks like a
  // decision is worse than none.
  const nearY = axisTowardCamera >= 0 ? y : -y
  const farY = -nearY

  return [
    arcOfCircle(far, first, first + Math.PI, false, 'rim-far-front'),
    arcOfCircle(far, second, second + Math.PI, edgeOn ? false : true, 'rim-far-back'),
    ...fullEllipse(near, 'rim-near'),
    silhouetteLine(camera, first, radius, nearY, farY, 'silhouette-0'),
    silhouetteLine(camera, second, radius, nearY, farY, 'silhouette-1'),
  ]
}

function silhouetteLine(camera: Camera, angle: number, radius: number, fromY: number, toY: number, object: string): ProjectedSegment {
  const x = radius * Math.cos(angle)
  const z = radius * Math.sin(angle)
  return {
    kind: 'segment',
    a: camera.project({ x, y: fromY, z }),
    b: camera.project({ x, y: toY, z }),
    hidden: false,
    // A silhouette line joins no pair of vertices, so it carries its own
    // name the way an arc does. The indices stay for the shape's sake.
    vertices: [0, 0],
    object,
  }
}

// A whole ellipse, as two halves. One `A` command cannot sweep a full turn —
// its start and end points would coincide and the curve would be undefined —
// so a closed rim is two arcs, which is also what lets one half be dashed
// when only one of them is hidden.
function fullEllipse(circle: ProjectedCircle, object: string): ProjectedArc[] {
  return [
    arcOfCircle(circle, 0, Math.PI, false, `${object}-0`),
    arcOfCircle(circle, Math.PI, 2 * Math.PI, false, `${object}-1`),
  ]
}

// A cone: two lines from the apex, each tangent to the base ellipse, plus the
// base itself.
//
// The tangency is solved on the PROJECTED ellipse rather than by rotating the
// cone's surface normal, because "the line from the apex touches the base
// exactly once" is the property the drawing has to have, and solving for it
// directly means it holds by construction rather than by agreement between
// two derivations.
//
// With the base written as `C + A cos t + B sin t` and `D = C − apex`, the
// line from the apex to the point at t is tangent when that point's own
// velocity is parallel to it:
//
//   (D×B) cos t − (D×A) sin t + (A×B) = 0
//
// which is `p cos t + q sin t = k` — two solutions, a phase apart by the
// same angle either side.
export function coneOutline(radius: number, height: number, camera: Camera): ProjectedEdge[] {
  const y = height / 2
  const center: Vec3 = { x: 0, y: -y, z: 0 }
  const u = radiusX(radius)
  const v = radiusZ(radius)
  const base = projectCircle(camera, center, u, v)
  const apex = camera.project({ x: 0, y, z: 0 })

  const a = camera.project(u)
  const b = camera.project(v)
  const d = { x: base.center.x - apex.x, y: base.center.y - apex.y }
  const p = cross2(d, b)
  const q = -cross2(d, a)
  const k = -cross2(a, b)
  const magnitude = Math.hypot(p, q)

  // No tangent line exists when the apex projects inside the base ellipse —
  // the camera is looking along the axis, and the cone IS its own base
  // circle. Drawing lines from the apex there would draw radii, not an
  // outline.
  if (magnitude <= GEOM_EPS || Math.abs(k) > magnitude) {
    return fullEllipse(base, 'base')
  }

  const phase = Math.atan2(q, p)
  const spread = Math.acos(Math.max(-1, Math.min(1, k / magnitude)))
  const first = phase - spread
  const second = phase + spread

  // The base rim is split at the two tangency angles. The half a reader sees
  // is the one whose LATERAL surface faces the camera — the same test the
  // cylinder makes, with the cone's slope folded in: the outward normal
  // along the generator at t is `h (cos t, 0, sin t) + r * axis`.
  const lateralTowardCamera = (t: number): number =>
    height * (Math.cos(t) * camera.direction.x + Math.sin(t) * camera.direction.z) + radius * dot3(AXIS, camera.direction)
  const midpoint = (first + second) / 2
  const firstArcVisible = lateralTowardCamera(midpoint) > 0
  // A cone seen from below shows its whole base: the disc itself faces the
  // camera, so nothing of the rim is behind the body.
  const baseTowardCamera = -dot3(AXIS, camera.direction)
  const wholeBaseVisible = baseTowardCamera > 0

  return [
    arcOfCircle(base, first, second, wholeBaseVisible ? false : !firstArcVisible, 'base-0'),
    arcOfCircle(base, second, first + 2 * Math.PI, wholeBaseVisible ? false : firstArcVisible, 'base-1'),
    apexLine(apex, base, first, 'silhouette-0'),
    apexLine(apex, base, second, 'silhouette-1'),
  ]
}

function apexLine(apex: Vec2, base: ProjectedCircle, angle: number, object: string): ProjectedSegment {
  return {
    kind: 'segment',
    a: apex,
    b: ellipseAt(base, angle),
    hidden: false,
    vertices: [0, 0],
    object,
  }
}

// The drawn point of a projected circle at one of the CIRCLE's own angles.
// Exported because a test that checks tangency has to evaluate the very
// curve that gets drawn, not a second description of it.
export function ellipseAt(circle: ProjectedCircle, circleAngle: number): Vec2 {
  const t = circle.parameter(circleAngle)
  const cos = Math.cos(circle.rotation)
  const sin = Math.sin(circle.rotation)
  const x = circle.rx * Math.cos(t)
  const y = circle.ry * Math.sin(t)
  return { x: circle.center.x + x * cos - y * sin, y: circle.center.y + x * sin + y * cos }
}

// The velocity of the drawn curve at one of the circle's own angles — the
// tangent direction, which is what "tangent line" means.
export function ellipseTangentAt(circle: ProjectedCircle, circleAngle: number): Vec2 {
  const t = circle.parameter(circleAngle)
  const cos = Math.cos(circle.rotation)
  const sin = Math.sin(circle.rotation)
  const x = -circle.rx * Math.sin(t)
  const y = circle.ry * Math.cos(t)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

// A sphere: a circle, of the camera's own scale times the radius.
//
// Under an orthographic projection the silhouette of a sphere is exactly a
// circle, for every viewpoint — which is why a sphere needs no visibility
// classification and has no hidden part to dash.
export function sphereOutline(radius: number, camera: Camera): ProjectedEdge[] {
  const scaled = radius * camera.scale
  const circle: ProjectedCircle = {
    center: camera.project({ x: 0, y: 0, z: 0 }),
    rx: scaled,
    ry: scaled,
    rotation: 0,
    parameter: (t) => t,
  }
  return fullEllipse(circle, 'outline')
}
