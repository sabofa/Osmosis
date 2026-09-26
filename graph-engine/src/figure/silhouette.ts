import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import { add3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
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

function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

// ---------------------------------------------------------------------------
// P1 — a round solid has a placement, and the maths below runs in its frame
// ---------------------------------------------------------------------------
//
// Every outline in this module (and every occlusion candidate in
// occlusion.ts) is written for H1's placement: centred on the origin, axis
// along +y. A round solid placed by points — a cylinder from A to B, a cone
// on an apex and a base centre, a sphere on a centre — sits anywhere, tilted
// any way. Rather than write every silhouette a second time for a general
// axis, the solid carries a PLACEMENT: an origin and an orthonormal,
// right-handed frame whose local y is the axis. Local coordinates map to
// world as `origin + x u + y axis + z w`.
//
// To draw it, the world camera is re-expressed in that frame — a LOCAL
// camera — and the y-axis maths runs unchanged against it. A rigid motion
// preserves everything a silhouette is made of (tangency, facing, the
// uniform scale), so this is exact, not an approximation of a tilted solid.

export interface Frame3 {
  u: Vec3
  axis: Vec3
  w: Vec3
}

export interface Placement {
  origin: Vec3
  frame: Frame3
}

// H1's placement, and every round primitive's placement before phase 7.
export const IDENTITY_PLACEMENT: Placement = {
  origin: { x: 0, y: 0, z: 0 },
  frame: { u: { x: 1, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, w: { x: 0, y: 0, z: 1 } },
}

function same(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

// Exactly the identity — compared exactly, because what hangs on it is byte
// identity: an identity placement draws through the world camera itself.
export function isIdentityPlacement(placement: Placement): boolean {
  const { origin, frame } = placement
  const id = IDENTITY_PLACEMENT.frame
  return same(origin, IDENTITY_PLACEMENT.origin) && same(frame.u, id.u) && same(frame.axis, id.axis) && same(frame.w, id.w)
}

// The deterministic frame for an axis (internal coordinates; need not be
// unit). A round solid's silhouette does not depend on its rotation about
// its own axis, but the start angles of the arcs that draw it do, so the
// rotation is FIXED: u = normalize(axis x ref), with ref internal author-X
// (internal +z) unless the axis is within GEOM_EPS of it, then internal
// author-Y (internal +x); w = u x axis, which makes (u, axis, w)
// right-handed. For a vertical axis this is exactly the identity frame.
export function frameForAxis(axis: Vec3): Frame3 {
  const unit = scale3(axis, 1 / length3(axis))
  const authorX: Vec3 = { x: 0, y: 0, z: 1 }
  const ref = Math.abs(dot3(unit, authorX)) > 1 - GEOM_EPS ? { x: 1, y: 0, z: 0 } : authorX
  const raw = cross3(unit, ref)
  const u = scale3(raw, 1 / length3(raw))
  return { u, axis: unit, w: cross3(u, unit) }
}

export function placementAlong(origin: Vec3, axis: Vec3): Placement {
  return { origin, frame: frameForAxis(axis) }
}

// A local direction, in world coordinates.
export function rotateToWorld(placement: Placement, v: Vec3): Vec3 {
  const { u, axis, w } = placement.frame
  return add3(add3(scale3(u, v.x), scale3(axis, v.y)), scale3(w, v.z))
}

// A world direction, in local coordinates: its components along the frame.
export function rotateToLocal(placement: Placement, v: Vec3): Vec3 {
  const { u, axis, w } = placement.frame
  return { x: dot3(v, u), y: dot3(v, axis), z: dot3(v, w) }
}

export function toWorld(placement: Placement, p: Vec3): Vec3 {
  return add3(placement.origin, rotateToWorld(placement, p))
}

export function toLocal(placement: Placement, p: Vec3): Vec3 {
  return rotateToLocal(placement, sub3(p, placement.origin))
}

// The world camera, re-expressed in a placement's frame. `direction`,
// `right` and `up` are the world vectors' components along (u, axis, w),
// which keeps them orthonormal and right-handed (a rotation preserves both);
// `project(p)` is the world projection of the placed point, and
// `projectVector` its linear part, for radius vectors. `scale` and `name`
// are the world camera's.
//
// An identity placement gets the world camera ITSELF, not a wrapped copy: a
// wrapper would compute `0 + 1 x + 0 y + 0 z` where the camera computed `x`,
// and every pre-phase-7 byte of every cylinder, cone and sphere rests on
// those being the same arithmetic.
export function localCamera(camera: Camera, placement: Placement): Camera {
  if (isIdentityPlacement(placement)) return camera
  return {
    name: camera.name,
    direction: rotateToLocal(placement, camera.direction),
    right: rotateToLocal(placement, camera.right),
    up: rotateToLocal(placement, camera.up),
    scale: camera.scale,
    project: (p) => camera.project(toWorld(placement, p)),
    projectVector: (v) => projectVector(camera, rotateToWorld(placement, v)),
  }
}

// A direction's image on the page: `project` for a world camera, which is
// linear, and the linear part of a local camera's affine `project`.
export function projectVector(camera: Camera, v: Vec3): Vec2 {
  return camera.projectVector ? camera.projectVector(v) : camera.project(v)
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
  // way it maps points — no subtraction of the centre needed. A local camera
  // (P1) is affine, and hands over its linear part for exactly this.
  const a = projectVector(camera, u)
  const b = projectVector(camera, v)
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
//
// Exported for segment occlusion (occlusion.ts), whose candidate planes are
// the planes through exactly these silhouette lines and the view direction.
export function cylinderSilhouetteAngles(camera: Camera): [number, number] | null {
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
  const base = projectCircle(camera, center, radiusX(radius), radiusZ(radius))
  const apex = camera.project({ x: 0, y, z: 0 })

  const angles = coneSilhouetteAngles(radius, height, camera)
  // No tangent line exists when the apex projects inside the base ellipse —
  // the camera is looking along the axis, and the cone IS its own base
  // circle. Drawing lines from the apex there would draw radii, not an
  // outline.
  if (!angles) return fullEllipse(base, 'base')
  const [first, second] = angles

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

// The two base angles at which a line from the apex touches the drawn base
// ellipse — the circle angles of the cone's two silhouette generators — or
// null when the apex projects inside the base and there is no such line.
//
// Exported for segment occlusion (occlusion.ts): the plane through each of
// these generators and the view direction bounds a cone's shadow near its
// apex. Solved on the projected ellipse, as the outline is, so the two can
// never disagree about where the silhouette is.
export function coneSilhouetteAngles(radius: number, height: number, camera: Camera): [number, number] | null {
  const y = height / 2
  const u = radiusX(radius)
  const v = radiusZ(radius)
  const base = projectCircle(camera, { x: 0, y: -y, z: 0 }, u, v)
  const apex = camera.project({ x: 0, y, z: 0 })

  const a = projectVector(camera, u)
  const b = projectVector(camera, v)
  const d = { x: base.center.x - apex.x, y: base.center.y - apex.y }
  const p = cross2(d, b)
  const q = -cross2(d, a)
  const k = -cross2(a, b)
  const magnitude = Math.hypot(p, q)
  if (magnitude <= GEOM_EPS || Math.abs(k) > magnitude) return null

  const phase = Math.atan2(q, p)
  const spread = Math.acos(Math.max(-1, Math.min(1, k / magnitude)))
  return [phase - spread, phase + spread]
}

// ---------------------------------------------------------------------------
// P2 — the conical frustum
// ---------------------------------------------------------------------------

// The height of a frustum's EXTENDED cone — the cone it is cut from — above
// its base: the virtual apex sits where the two rims' generators meet,
// h R / (R - r) above the base. Callers pass R > r (solids.ts normalises a
// frustum wider at the top by reversing its axis, P2).
export function frustumApexHeight(radius: number, top: number, height: number): number {
  return (height * radius) / (radius - top)
}

// A frustum: base rim (radius R) at y = -h/2, top rim (radius r < R) at
// y = +h/2, axis +y.
//
// Its silhouette is its extended cone's, clipped to its own height. The
// generators that graze the extended cone are the ones through the base
// angles `coneSilhouetteAngles` solves for — the cone's angles depend only on
// the base and the apex, not on where the cone sits along its axis — and a
// generator at base angle t crosses the top rim at the same angle t, so each
// silhouette line runs from the base rim to the top rim at one angle, and is
// tangent to both (the top rim is the base rim scaled about the apex).
//
// Both rims split at those angles. A rim's half is hidden when it lies behind
// the body: the base rim's back half unless the camera is below the base,
// which then faces it; the top rim's back half unless the camera is above
// the top cap. Which half is the back is the cone's lateral-facing test, with
// the extended cone's height.
export function frustumOutline(radius: number, top: number, height: number, camera: Camera): ProjectedEdge[] {
  const y = height / 2
  const apexHeight = frustumApexHeight(radius, top, height)
  const base = projectCircle(camera, { x: 0, y: -y, z: 0 }, radiusX(radius), radiusZ(radius))
  const rim = projectCircle(camera, { x: 0, y, z: 0 }, radiusX(top), radiusZ(top))
  const axisTowardCamera = dot3(AXIS, camera.direction)
  const wholeBaseVisible = -axisTowardCamera > 0
  const wholeTopVisible = axisTowardCamera > 0

  const angles = coneSilhouetteAngles(radius, apexHeight, camera)
  // Looking along the axis: the lateral surface is all in front or all
  // behind, so there is no silhouette line. The rim on the cap facing the
  // viewer is whole, and so is the base rim from above (it is the outline);
  // from below, the top rim is behind the base disc.
  if (!angles) {
    return [...wholeEllipse(base, 'base', false), ...wholeEllipse(rim, 'top', !wholeTopVisible)]
  }
  const [first, second] = angles
  const lateralTowardCamera = (t: number): number =>
    apexHeight * (Math.cos(t) * camera.direction.x + Math.sin(t) * camera.direction.z) + radius * axisTowardCamera
  const firstArcVisible = lateralTowardCamera((first + second) / 2) > 0

  const generator = (t: number, object: string): ProjectedSegment => ({
    kind: 'segment',
    a: camera.project({ x: radius * Math.cos(t), y: -y, z: radius * Math.sin(t) }),
    b: camera.project({ x: top * Math.cos(t), y, z: top * Math.sin(t) }),
    hidden: false,
    vertices: [0, 0],
    object,
  })

  return [
    arcOfCircle(base, first, second, wholeBaseVisible ? false : !firstArcVisible, 'base-0'),
    arcOfCircle(base, second, first + 2 * Math.PI, wholeBaseVisible ? false : firstArcVisible, 'base-1'),
    arcOfCircle(rim, first, second, wholeTopVisible ? false : !firstArcVisible, 'top-0'),
    arcOfCircle(rim, second, first + 2 * Math.PI, wholeTopVisible ? false : firstArcVisible, 'top-1'),
    generator(first, 'silhouette-0'),
    generator(second, 'silhouette-1'),
  ]
}

// A whole ellipse as two halves, both hidden or both not.
function wholeEllipse(circle: ProjectedCircle, object: string, hidden: boolean): ProjectedArc[] {
  return [
    arcOfCircle(circle, 0, Math.PI, hidden, `${object}-0`),
    arcOfCircle(circle, Math.PI, 2 * Math.PI, hidden, `${object}-1`),
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
