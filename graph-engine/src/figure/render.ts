import type { GraphConfig } from '../parser/config'
import { evalExpr, type FunctionTable } from '../parser/evalExpr'
import type {
  Expr,
  GeometryArcDirection,
  GivenEntry,
  GivensSection,
  MeasureContent,
  MeasureSubject,
  PlaneForm,
  Statement,
} from '../parser/types'
import { angleSweep, rightAngleSquarePoints, tickMarkSegments } from '../render/geometryMarks'
import { clipLineToBounds } from '../render/clipLine'
import { type Palette, themedColor } from '../render/palette'
import { buildConstructions } from '../scene/geometry/buildConstructions'
import { isPlotted, isSolidFigureStatement } from '../scene/mode'
import { type Arc, arcBetween, arcMidpoint, arcPointAt, requireOnCircle } from '../scene/geometry/circles'
import type { GeometryCircle, GeometryObject, LineExtent } from '../scene/geometry/objects'
import type { SceneError, Vec2 } from '../scene/types'
import { GEOM_EPS } from '../scene/geometry/types'
import {
  boundsOf,
  cssColor,
  emptyFigureLayers,
  FIGURE_PADDING,
  figureDocument,
  figureTheme,
  fitProjection,
  growRect,
  layoutGivensTable,
  unionRects,
  type FigureTheme,
  type Projection,
  type Rect,
  type WorldBounds,
} from './document'
import { LABEL_FONT_SIZE, layoutLabels, noObstacles, type LabelAnchor, type LabelObstacles } from './labels'
import { angleMeasure, arcMeasure, checkMeasure, formatAngleMeasure, formatMeasure, segmentLength } from './measure'
import { layoutNotation, type NotationLayout, notationElements, notationOrigin, type NotationRun } from './notation'
import {
  angle3,
  dihedral3,
  distance3,
  midpoint3,
  lineAngle3,
  lineLineDistance,
  linePlaneAngle3,
  pointLineDistance,
  pointPlaneDistance,
  type Plane3,
} from './construct3d'
import { segmentSpans, type Span } from './occlusion'
import {
  cameraFor,
  drawClosedEdges,
  drawEdge,
  edgeExtremes,
  edgeObject,
  type Camera,
  type ProjectedArc,
  type ProjectedEdge,
  type Vec3,
} from './project3d'
import { buildSolidFigure, isSpaceName, type SolidFigureScope } from './solidScope'
import { drawnDimensionSegment, solidDimensions, solidOutline, type SolidBody, type SolidSpec } from './solids'
import { authorToWorld, describeAuthorPlane } from './authorFrame'
import { liftOffset, NET_LABEL_CLEARANCE, planeRadii, regionCorners, sectionOf, trueShape, type SectionPiece, type TrueShapePiece } from './crossSection'
import { ellipseFromConjugates, projectCircle, projectVector, type ProjectedCircle } from './silhouette'
import { angleArc, angleFrame, arcBisector, arcMiddle, dihedralMark, markHidden, projectArc, rightAngleCorners, type SpaceArc } from './spaceMarks'
import { sectionOutline, type OutlinePiece } from './sectionVisibility'
import { netOf, netSolidWord, type Net, type NetPiece } from './nets'
import { shortestPath, type SurfacePath } from './shortestPath'
import {
  fmt,
  svgArc,
  svgCircle,
  svgCircularSegment,
  svgEllipse,
  svgLine,
  svgPolygon,
  svgPolyline,
  svgSector,
  svgText,
  type SvgAttrs,
} from './svg'

// The figure renderer: statements in, one SVG document out.
//
// It consumes the construction layer Phase 1 built and emits through svg.ts,
// document.ts and labels.ts. It does *not* consume `buildScene`'s SceneObjects
// — two reasons, both load-bearing. A circle there has already become a
// 96-point sampled curve, which is right for three.js and wrong for SVG; and
// SceneObjects carry no statement index, which E4's element identity needs.
// So the figure walks the statements itself and reads the construction pass's
// geometry values directly.

// ---------------------------------------------------------------------------
// Style constants, in view units (see document.ts's FIGURE_SIZE)
// ---------------------------------------------------------------------------

const STROKE_PRIMARY = 2.4
const STROKE_AUXILIARY = 1.8
const STROKE_MARK = 1.8
const AUXILIARY_DASH = '9 7'
const AUXILIARY_OPACITY = 0.6
const POINT_RADIUS = 4.5

// A filled region is a backdrop, not a block of colour: at full strength it
// hides the construction lines crossing it, which at competition density is
// most of the figure.
const REGION_OPACITY = 0.22

// A central angle's mark is drawn inside the circle it belongs to, so it is
// capped as a fraction of that circle's own radius as well as by the shared
// maximum — on a small circle a 34-unit mark would reach past the arc it
// annotates.
const CENTRAL_ANGLE_MAX_FRACTION = 0.4

const ANGLE_ARC_RADIUS = 34
const ANGLE_ARC_MAX_FRACTION = 0.35
const RIGHT_ANGLE_SIZE = 20
const RIGHT_ANGLE_MAX_FRACTION = 0.3
const TICK_LENGTH = 8
const TICK_GAP = 8
const TICK_MAX_FRACTION = 0.2

const FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif'

// ---------------------------------------------------------------------------
// The item model
// ---------------------------------------------------------------------------

interface Identity {
  statement: number
  object: string | null
}

type FigureItem =
  | { kind: 'point'; id: Identity; at: Vec2; label: string | null; prefer: Vec2 | null; color: string | null }
  | { kind: 'line'; id: Identity; a: Vec2; b: Vec2; extent: LineExtent; auxiliary: boolean; color: string | null }
  // The reference line a dimension label hangs off when nothing else draws
  // it (fix wave 1): a ROUND solid's radius (rim centre to rim) or height
  // (the axis), and a pyramid's or pyramidal frustum's height (the axis).
  // Every other polyhedral dimension hangs off an edge already drawn; these
  // would otherwise be a bare number that says nothing about what it
  // measures. One item per span of the glass rule
  // against the solid itself: solid where a face shows it, dashed where the
  // solid hides it. Always in the auxiliary layer, carrying the LABEL's
  // identity.
  | { kind: 'dimensionReference'; id: Identity; a: Vec2; b: Vec2; hidden: boolean; color: string | null }
  | { kind: 'circle'; id: Identity; center: Vec2; radius: number; color: string | null }
  // A piece of a circle: the arc itself, or one of the two regions built on
  // it. All three carry the same Arc, which is the object that resolved the
  // direction, so the drawn sweep and the measure printed for it cannot come
  // apart (G1, G2).
  | { kind: 'arc'; id: Identity; arc: Arc; fill: 'none' | 'sector' | 'segment'; color: string | null }
  // The mark at the centre of a circle. Distinct from `angleMark`, which
  // measures the non-reflex angle between two rays: a major arc's central
  // angle IS reflex, and drawing it as the non-reflex one would mark 216
  // degrees as 144.
  | { kind: 'centralAngle'; id: Identity; arc: Arc; label: string; color: string | null }
  | { kind: 'polygon'; id: Identity; vertices: Vec2[]; color: string | null }
  // A solid, already projected: the 3D layer is a PRODUCER feeding this
  // renderer, not a second renderer, so by the time a solid is an item it is
  // 2D geometry plus a visible/hidden classification per edge.
  | { kind: 'solid'; id: Identity; edges: ProjectedEdge[]; color: string | null }
  // A letter at a projected vertex. Deliberately not a `point`: a solid's
  // vertices are lettered, not dotted. Since phase 6 they ARE points — points
  // in space, bound by the solid-figure walk (S4) — and never points of the
  // plane: "label: AB" measures the TRUE 3D length, not the projected edge,
  // which is a fact about the camera and not about the solid.
  | { kind: 'solidVertex'; id: Identity; at: Vec2; label: string; prefer: Vec2 | null; color: string | null }
  // A cross-section shaded ON the projected solid. The lifted form is not
  // here at all: it comes back as an ordinary polygon or circle, which is the
  // whole of H5.
  | {
      kind: 'sectionFace'
      id: Identity
      outline:
        | { kind: 'polygon'; vertices: Vec2[] }
        | { kind: 'ellipse'; circle: ProjectedCircle }
        // Q5 (phase 8) — a region bounded by chords and elliptical arcs, as
        // the drawn-edge union a solid's outline uses.
        | { kind: 'region'; edges: ProjectedEdge[] }
      // Q6 (phase 8) — the outline, stroked apart from the fill: each piece
      // visible or hidden by where it lies on the solid, and drawn as a
      // solid's edge is (hidden pieces dashed, in the auxiliary layer).
      edges: ProjectedEdge[]
      color: string | null
    }
  // Q5 (phase 8) — a LIFTED section that is a region: chords and elliptical
  // arcs at true shape, in the plane, drawn by the one drawn-edge path a
  // solid's outline uses (drawEdge, edgeExtremes). It is the 2D figure's own
  // item, stroked like a polygon, so it takes part in the bounds and in label
  // avoidance.
  | { kind: 'region'; id: Identity; edges: ProjectedEdge[]; color: string | null }
  | { kind: 'angleMark'; id: Identity; vertex: Vec2; from: Vec2; to: Vec2; label: string | null; color: string | null }
  // `hidden` only for a tick on a segment in space (phase 10, M4): the
  // endpoints are then the segment's projected ends, and the tick is drawn
  // in the picture plane by the 2D convention.
  | { kind: 'tickMark'; id: Identity; from: Vec2; to: Vec2; count: number; hidden?: boolean; color: string | null }
  | { kind: 'rightAngleMark'; id: Identity; vertex: Vec2; from: Vec2; to: Vec2; color: string | null }
  // Phase 10 (M1) — an angle's arc on points in space: a circle arc in the
  // angle's own plane, already projected to an elliptical arc. `hidden` is
  // M4's whole-mark decision. `text` is an "angle: … label:" caption, hung
  // on the arc's middle (projected) and pushed along the projected bisector.
  | {
      kind: 'spaceArc'
      id: Identity
      edge: ProjectedArc
      hidden: boolean
      text: { at: Vec2; push: Vec2 | null; label: string } | null
      color: string | null
    }
  // Phase 10 (M1) — a right angle's square in space, projected: its three
  // outer corners, the "L" the plane draws.
  | { kind: 'spaceRightAngle'; id: Identity; points: [Vec2, Vec2, Vec2]; hidden: boolean; color: string | null }
  // A measure label draws no geometry of its own: it is text (possibly
  // carrying notation) hung off a piece of geometry that is already drawn.
  // `at` is where it belongs in world space and `push` is the direction it
  // would rather sit in — outward from the figure for a side, into the
  // opening for an angle.
  | {
      kind: 'measureLabel'
      id: Identity
      at: Vec2
      push: Vec2 | null
      // Whether this label belongs inside the shape it annotates. True for an
      // angle measure and false for everything else — see labels.ts.
      inside: boolean
      // See the `leader` local in buildItems: only a solid's dimension label
      // grows a line back to what it names.
      leader: boolean
      runs: NotationRun[]
      color: string | null
    }
  // A row of the givens table. It has no position of its own: where the box
  // goes is decided against the finished drawing, after the labels have been
  // placed and the content rect is known.
  //
  // Three cells — subject, relation, value — because that is what a statement
  // of givens IS, and columns that share an edge are what makes a long list
  // scannable (G4).
  | { kind: 'given'; id: Identity; section: GivensSection; cells: NotationRun[][]; color: string | null }
  // Phase 11 (N1) — a lifted net, or a lifted unfolding of a shortest path:
  // plane geometry at true size, already moved beside the drawing. Each line
  // is a fold (dashed) or a cut (solid); `faces` are the flat faces, kept so
  // labels stay out of them as they stay out of a lifted polygon.
  | { kind: 'net'; id: Identity; lines: { edge: ProjectedEdge; fold: boolean }[]; faces: Vec2[][]; color: string | null }
  // A net's vertex letter (N1): a DISPLAY label, repeated at every copy of
  // the vertex, never a named point — the same letter can sit at three places
  // in one net. `copy` keeps each one's layout identity unique.
  | { kind: 'netLabel'; id: Identity; copy: number; at: Vec2; label: string; prefer: Vec2 | null; color: string | null }

export interface FigureResult {
  svg: string
  errors: SceneError[]
}

// ---------------------------------------------------------------------------
// Building the items
// ---------------------------------------------------------------------------

function collectFunctions(statements: Statement[]): FunctionTable {
  const functions: FunctionTable = {}
  for (const statement of statements) {
    if (statement.kind === 'functionDef') functions[statement.name] = { param: statement.param, body: statement.body }
    else if (statement.kind === 'constantDef') functions[statement.name] = { param: null, body: statement.value }
  }
  return functions
}

// `skip` holds the statements the solid-figure walk owns — which, for a
// 2-coordinate point, means one it refused because an earlier line had
// already bound its name (source order decides; see solidScope.ts).
function collectNamedPoints(
  statements: Statement[],
  config: GraphConfig,
  functions: FunctionTable,
  skip: ReadonlySet<number>
): Map<string, Vec2> {
  const points = new Map<string, Vec2>()
  const value = (e: Expr) => evalExpr(e, {}, config.angle, functions)
  for (const [index, statement] of statements.entries()) {
    if (skip.has(index)) continue
    try {
      // A 3-coordinate point is a point in SPACE in a figure (S2): the
      // solid-figure walk binds it, and it is not a point of the plane.
      if (statement.kind === 'point' && statement.label && statement.z === null) {
        points.set(statement.label, { x: value(statement.x), y: value(statement.y) })
      } else if (statement.kind === 'polygon') {
        for (const vertex of statement.vertices) points.set(vertex.label, { x: value(vertex.x), y: value(vertex.y) })
      }
    } catch {
      // Reported when the statement itself is walked below.
    }
  }
  return points
}

function centroidOf(points: readonly Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x / points.length
    y += p.y / points.length
  }
  return { x, y }
}

function awayFrom(p: Vec2, from: Vec2): Vec2 | null {
  const dx = p.x - from.x
  const dy = p.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null
  // View space flips y, so the hint does too — it is consumed by the label
  // layout, which works entirely in view coordinates.
  return { x: dx / len, y: -dy / len }
}

function geometryItems(object: GeometryObject, name: string | null, id: Identity, color: string | null): FigureItem[] {
  switch (object.kind) {
    case 'point':
      return [{ kind: 'point', id, at: object.at, label: name, prefer: null, color }]
    case 'circle':
      return [{ kind: 'circle', id, center: object.center, radius: object.radius, color }]
    case 'line':
      // A constructed line is scaffolding when it is a *locus* — a parallel, a
      // perpendicular, a bisector, a tangent line, a secant: things the author
      // reasoned with rather than edges of the figure, and at competition
      // density they routinely outnumber the figure itself.
      //
      // The test is the extent, and it is the honest one. An infinite line or
      // a ray has no endpoints, so it is a locus and nothing else; a segment
      // has two, which means someone chose them, which makes it an edge. That
      // is what tells a chord, a radius, a diameter and a drawn tangent
      // length — all segments, all part of the picture — from the loci that
      // helped produce them. Phase 1's constructions all produce loci, so this
      // draws every one of them exactly as it did before.
      return [{ kind: 'line', id, a: object.a, b: object.b, extent: object.extent, auxiliary: object.extent !== 'segment', color }]
  }
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

// A solid's dimensions are evaluated by the solid-figure walk (solidScope.ts),
// which builds every solid before this renderer's main loop runs (S3).

// A plot in a solid figure, refused in words the author will recognise. The
// statement's own text is gone by now, so it is named by its form.
function plotRefusal(statement: Statement): string {
  const named: Partial<Record<Statement['kind'], string>> = {
    implicit: 'An implicit curve',
    polar: 'A polar curve "r = …"',
    parametric: 'A parametric curve',
    parametricSurface: 'A parametric surface',
    surface: 'A surface "z = …"',
    region: 'An inequality region',
    regionChain: 'An inequality region',
    field: 'A slope field',
    scatter: 'A scatter plot',
    tangent: 'A tangent to a function',
    animatedPoint: 'An animated point',
  }
  const what =
    statement.kind === 'explicit' ? `"${statement.independent === 'x' ? 'y' : 'x'} = …"` : (named[statement.kind] ?? 'This statement')
  return `${what} is a plot, and a solid figure does not draw plots — put it on its own graph page`
}

// ---------------------------------------------------------------------------
// Measure labels
// ---------------------------------------------------------------------------

// The name the author would recognise, used in the assertion's message.
function subjectName(subject: MeasureSubject): string {
  switch (subject.kind) {
    case 'length':
      return `${subject.from}${subject.to}`
    case 'angle':
      return `angle ${subject.from}${subject.vertex}${subject.to}`
    case 'triangle':
      return `triangle ${subject.names.join('')}`
    case 'arc':
      return `arc ${subject.from}${subject.to}`
    case 'solidDimension':
      return `${subject.solid} ${subject.dimension}`
    // Phase 10 — the author's own words, so an assertion's message quotes
    // the row they wrote.
    case 'dihedral':
      return `dihedral ${subject.from}-${subject.edge.join('-')}-${subject.to}`
    case 'lineAngle':
      return `angle between ${subject.first.join('-')} and ${subject.second.join('-')}`
    case 'linePlaneAngle':
      return `angle between ${subject.line.join('-')} and plane ${subject.plane.source}`
    case 'lineDistance':
      return `distance between ${subject.first.join('-')} and ${subject.second.join('-')}`
    case 'pointPlaneDistance':
      return `distance from ${subject.point} to plane ${subject.plane.source}`
    case 'pointLineDistance':
      return `distance from ${subject.point} to line ${subject.line.join('-')}`
    case 'shortestPath':
      return `shortest ${subject.from} to ${subject.to} over ${subject.solid}`
  }
}

// Whether a subject measures an ANGLE: it prints with the degree sign and
// honours "@angle".
function isAngleSubject(subject: MeasureSubject): boolean {
  return subject.kind === 'angle' || subject.kind === 'arc' || subject.kind === 'dihedral' || subject.kind === 'lineAngle' || subject.kind === 'linePlaneAngle'
}

// A plane as the givens table writes it (M5): three points run together as
// a face is ("ABC"), a named plane by its name, any other form as written.
function planeNotation(plane: PlaneForm): string {
  if (plane.kind === 'points') return plane.points.join('')
  if (plane.kind === 'named') return plane.name
  return plane.source
}

// A unit vector in *view* space (y flipped) bisecting the angle at `vertex`.
// Degenerate — a straight angle, where the two arms cancel — falls back to the
// perpendicular of one arm, which is where a hand-drawn figure puts the label
// too.
function bisectorDirection(vertex: Vec2, from: Vec2, to: Vec2): Vec2 | null {
  const unit = (p: Vec2): Vec2 | null => {
    const dx = p.x - vertex.x
    const dy = p.y - vertex.y
    const len = Math.hypot(dx, dy)
    return len === 0 ? null : { x: dx / len, y: dy / len }
  }
  const u = unit(from)
  const v = unit(to)
  if (!u || !v) return null
  const sum = { x: u.x + v.x, y: u.y + v.y }
  const len = Math.hypot(sum.x, sum.y)
  if (len < 1e-9) return { x: -u.y, y: u.x }
  // View space flips y, exactly as awayFrom does.
  return { x: sum.x / len, y: -sum.y / len }
}

// The side of a segment a label should sit on: perpendicular to it, pointing
// away from the rest of the figure, so a triangle's three side labels land
// outside it rather than piled in the middle.
function outwardPerpendicular(a: Vec2, b: Vec2, centre: Vec2): Vec2 | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null
  const normal = { x: -dy / len, y: dx / len }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const away = { x: mid.x - centre.x, y: mid.y - centre.y }
  const sign = normal.x * away.x + normal.y * away.y < 0 ? -1 : 1
  return { x: sign * normal.x, y: -sign * normal.y }
}

// A subject written out as a name: an overbar on a segment, the angle sign,
// the triangle sign. This is the givens box's spelling of a subject, and the
// half of notation-composes-with-measures that the box exercises — the name
// carries a mark and the "= 8" after it does not.
function subjectRuns(subject: MeasureSubject): NotationRun[] {
  switch (subject.kind) {
    case 'length':
      return [{ text: `${subject.from}${subject.to}`, mark: 'segment' }]
    case 'angle':
      return [{ text: `\u2220${subject.from}${subject.vertex}${subject.to}`, mark: 'none' }]
    case 'triangle':
      return [{ text: `\u25b3${subject.names.join('')}`, mark: 'none' }]
    case 'arc':
      // The arc mark over the two endpoint names — the notation the subject
      // is actually written in, and the one overmark phase 3 built and had
      // nothing to draw yet.
      return [{ text: `${subject.from}${subject.to}`, mark: 'arc' }]
    case 'solidDimension':
      // No overmark: "S height" is a phrase naming a measurement, not a
      // piece of geometry with a notation of its own.
      return [{ text: `${subject.solid} ${subject.dimension}`, mark: 'none' }]
    // Phase 10 — the table's notation (M3, M5): the dihedral as its edge
    // between its two ends, "∠C-AB-D"; the angle between two lines or a line
    // and a plane as "∠(AB, CD)" and "∠(AB, PQR)"; a distance as
    // "d(AB, CD)", "d(P, PQR)", "d(P, AB)".
    case 'dihedral':
      return [{ text: `\u2220${subject.from}-${subject.edge.join('')}-${subject.to}`, mark: 'none' }]
    case 'lineAngle':
      return [{ text: `\u2220(${subject.first.join('')}, ${subject.second.join('')})`, mark: 'none' }]
    case 'linePlaneAngle':
      return [{ text: `\u2220(${subject.line.join('')}, ${planeNotation(subject.plane)})`, mark: 'none' }]
    case 'lineDistance':
      return [{ text: `d(${subject.first.join('')}, ${subject.second.join('')})`, mark: 'none' }]
    case 'pointPlaneDistance':
      return [{ text: `d(${subject.point}, ${planeNotation(subject.plane)})`, mark: 'none' }]
    case 'pointLineDistance':
      return [{ text: `d(${subject.point}, ${subject.line.join('')})`, mark: 'none' }]
    // Phase 11 (N5) — the path's length, in words: there is no notation for it.
    case 'shortestPath':
      return [{ text: `shortest ${subject.from}${subject.to} over ${subject.solid}`, mark: 'none' }]
  }
}

// What the label prints, and — for the asserting form — whether the figure
// agrees with it.
//
// F1 lives here: `label: AB = 8` prints 8 *and* is checked, because the only
// thing worse than an unlabelled figure is a labelled wrong one. The check is
// suppressed under `@scale: false` (see measure.ts), which is the flag that
// makes a deliberately-not-to-scale figure authorable.
function measureRuns(
  subject: MeasureSubject,
  content: MeasureContent,
  computed: number | null,
  config: GraphConfig
): { runs: NotationRun[]; error: string | null } {
  // An arc's measure is an angle, so it carries the degree sign and honours
  // @angle exactly as an angle does.
  const asText = (value: number) => (isAngleSubject(subject) ? formatAngleMeasure(value, config.angle) : formatMeasure(value))

  switch (content.kind) {
    case 'computed':
      if (computed === null) throw new Error(`"label: ${subjectName(subject)}" has no measure to print`)
      return { runs: [{ text: asText(computed), mark: 'none' }], error: null }
    case 'stated': {
      const error =
        computed === null ? null : checkMeasure(subjectName(subject), content.value, computed, { toScale: config.toScale })
      return { runs: [{ text: asText(content.value), mark: 'none' }], error }
    }
    case 'symbol':
      return { runs: [{ text: content.text, mark: 'none' }], error: null }
    case 'name': {
      const names =
        subject.kind === 'length' || subject.kind === 'arc'
          ? `${subject.from}${subject.to}`
          : subject.kind === 'angle'
            ? `${subject.from}${subject.vertex}${subject.to}`
            : subject.kind === 'solidDimension'
              ? `${subject.solid} ${subject.dimension}`
              : subject.kind === 'triangle'
                ? subject.names.join('')
                : subjectName(subject)
      // The prefix is a character (△), not a mark: it is set beside the name
      // rather than drawn over it, so it belongs in the same run.
      return { runs: [{ text: content.prefix + names, mark: content.mark }], error: null }
    }
  }
}

// One ROW of the table, as its three cells: the subject, the relation between
// it and something else, and the value.
//
// A measure is checked exactly as an inline label is — the box is a different
// place to write a given, not a different standard of truth — and a relation
// states a fact about the figure that the construction layer has no single
// number to compare against, so it is written and not checked.
// How a measure finds what it names. `space` answers for names that are
// points in space (S2): the points themselves, in the internal frame, when
// every name is one; null when none is; and an error naming one of each when
// the names mix the two kinds.
interface Resolvers {
  point(name: string): Vec2
  circle(name: string): GeometryCircle
  solid(name: string): SolidBody
  space(names: readonly string[], what: string): Vec3[] | null
  // M5 — a measure's plane, as the solid-figure walk resolved it.
  plane(form: PlaneForm): Plane3
  // Phase 11 (N3, N4) — the shortest path over a solid between two points.
  path(subject: Extract<MeasureSubject, { kind: 'shortestPath' }>): SurfacePath
}

// M5 — names that must all be points in space: a measure between lines and
// planes means nothing in the plane. An unknown name is refused as unknown.
function spaceOnly(resolvers: Resolvers, names: readonly string[], what: string): Vec3[] {
  const space = resolvers.space(names, what)
  if (space) return space
  for (const name of names) resolvers.point(name)
  throw new Error(`"${what}" is measured in space, and ${names[0]} is a point in the plane`)
}

function inAngleUnit(radians: number, config: GraphConfig): number {
  return config.angle === 'degrees' ? (radians * 180) / Math.PI : radians
}

function givenCells(entry: GivenEntry, resolvers: Resolvers, config: GraphConfig): { cells: NotationRun[][]; error: string | null } {
  if (entry.kind === 'relation') {
    for (const side of [entry.left, entry.right]) measureOf(side, resolvers, config)
    return { cells: [subjectRuns(entry.left), [{ text: entry.symbol, mark: 'none' }], subjectRuns(entry.right)], error: null }
  }

  const computed = measureOf(entry.subject, resolvers, config)
  const value = measureRuns(entry.subject, entry.content, computed, config)
  // The equals sign is a column of its own, not the head of the value: it is
  // the relation, and relations share an edge down the table the same way
  // subjects and values do.
  return { cells: [subjectRuns(entry.subject), [{ text: '=', mark: 'none' }], value.runs], error: value.error }
}

// The number a subject measures to, or null when the subject is a shape
// rather than a measurement. Resolving the names is the point even for a
// shape: a given naming a point that does not exist is a broken spec, and
// finding that out here is what turns it into a legible error.
function measureOf(subject: MeasureSubject, resolvers: Resolvers, config: GraphConfig): number | null {
  switch (subject.kind) {
    case 'length': {
      // S4 — between points in space the measure is the TRUE 3D length,
      // never the projected one: the same commitment solidDimensions makes.
      const space = resolvers.space([subject.from, subject.to], `${subject.from}${subject.to}`)
      if (space) return distance3(space[0], space[1])
      return segmentLength(resolvers.point(subject.from), resolvers.point(subject.to))
    }
    case 'angle': {
      // The true angle in space, in the unit "@angle" selects. Only the
      // givens table reaches this for space points: an inline angle label in
      // space is refused (it would float with no arc to label).
      const space = resolvers.space([subject.from, subject.vertex, subject.to], `angle ${subject.from}${subject.vertex}${subject.to}`)
      if (space) {
        const radians = angle3(space[1], space[0], space[2], `angle ${subject.from}${subject.vertex}${subject.to}`)
        return config.angle === 'degrees' ? (radians * 180) / Math.PI : radians
      }
      return angleMeasure(resolvers.point(subject.vertex), resolvers.point(subject.from), resolvers.point(subject.to), config.angle)
    }
    case 'triangle':
      for (const name of subject.names) resolvers.point(name)
      return null
    case 'arc':
      // Through the arc, never around it: the same call the central angle
      // mark makes, which is what makes the two agree by construction (G2).
      return arcMeasure(arcOf(subject, resolvers.point, resolvers.circle), config.angle)
    case 'solidDimension':
      return solidDimensionValue(resolvers.solid(subject.solid), subject.dimension, subject.solid)
    // Phase 10 — true values in space, closed form (construct3d.ts).
    case 'dihedral': {
      const [from, a, b, to] = spaceOnly(resolvers, [subject.from, ...subject.edge, subject.to], subjectName(subject))
      const names = { from: subject.from, a: subject.edge[0], b: subject.edge[1], to: subject.to }
      return inAngleUnit(dihedral3(from, a, b, to, names).angle, config)
    }
    case 'lineAngle': {
      const [a, b, c, d] = spaceOnly(resolvers, [...subject.first, ...subject.second], subjectName(subject))
      return inAngleUnit(lineAngle3(a, b, c, d, `line ${subject.first.join('-')}`, `line ${subject.second.join('-')}`), config)
    }
    case 'linePlaneAngle': {
      const [a, b] = spaceOnly(resolvers, subject.line, subjectName(subject))
      return inAngleUnit(linePlaneAngle3(a, b, resolvers.plane(subject.plane), `line ${subject.line.join('-')}`), config)
    }
    case 'lineDistance': {
      const [a, b, c, d] = spaceOnly(resolvers, [...subject.first, ...subject.second], subjectName(subject))
      return lineLineDistance(a, b, c, d, `line ${subject.first.join('-')}`, `line ${subject.second.join('-')}`)
    }
    case 'pointPlaneDistance': {
      const [p] = spaceOnly(resolvers, [subject.point], subjectName(subject))
      return pointPlaneDistance(p, resolvers.plane(subject.plane))
    }
    case 'pointLineDistance': {
      const [p, a, b] = spaceOnly(resolvers, [subject.point, ...subject.line], subjectName(subject))
      return pointLineDistance(p, a, b, `line ${subject.line.join('-')}`)
    }
    case 'shortestPath':
      return resolvers.path(subject).length
  }
}

// Whether a polyhedron's named dimension hangs off its AXIS rather than an
// edge: a pyramid's (square, regular or rectangle) or a pyramidal frustum's
// height, from the base centre to the apex or the top face's centre. That
// line is drawn nowhere else, so, like a round solid's radius or height, it
// is drawn as the label's reference (fix wave 1).
function hangsOffAxis(spec: SolidSpec, dimension: string): boolean {
  if (dimension !== 'height') return false
  return spec.kind === 'pyramid' || spec.kind === 'regularPyramid' || spec.kind === 'rectanglePyramid' || spec.kind === 'regularFrustum'
}

// The value a named dimension measures to, read off the SOLID and never off
// the drawing. A projected edge's length is a fact about the camera, so
// measuring one would print a number that contradicts the solid the author
// asked for — the opposite of what an asserting label is for.
function solidDimensionValue(body: SolidBody, dimension: string, name: string): number {
  // P6 — a solid on named points has no named dimensions; its points name
  // every length worth measuring. Except a sphere's radius (phase 9, R2):
  // however a sphere was placed — by its centre, by tangency, inscribed or
  // circumscribed — its radius is a named dimension, and no two of its
  // points name it.
  if (body.byPoints && body.spec.kind !== 'sphere') {
    throw new Error(
      `"${name}" is built on named points, so it has no "${dimension}" to label — measure between its points instead (e.g. "label: AB")`
    )
  }
  const available = solidDimensions(body.spec)
  const value = available[dimension]
  if (value === undefined) {
    throw new Error(
      `A ${body.spec.kind} has no "${dimension}" — "${name}" can be labelled with ${Object.keys(available).join(', ')}`
    )
  }
  return value
}

// The arc a subject or a statement names, built once from the circle, the two
// endpoints and the stated direction.
function arcOf(
  named: { circle: string; from: string; to: string; direction: GeometryArcDirection },
  resolve: (name: string) => Vec2,
  resolveCircle: (name: string) => GeometryCircle
): Arc {
  return arcBetween(resolveCircle(named.circle), resolve(named.from), resolve(named.to), named.direction, {
    circle: named.circle,
    from: named.from,
    to: named.to,
  })
}

function buildItems(statements: Statement[], config: GraphConfig): { items: FigureItem[]; errors: SceneError[] } {
  const functions = collectFunctions(statements)
  const value = (e: Expr) => evalExpr(e, {}, config.angle, functions)
  // S3 — solids and constructions in space first, in one source-order walk,
  // so the 2D pass can be told which statements are not its business.
  const scope: SolidFigureScope = buildSolidFigure(statements, value, (e, vars) => evalExpr(e, vars, config.angle, functions))
  const namedPoints = collectNamedPoints(statements, config, functions, scope.ownedStatements)
  const constructions = buildConstructions(statements, config, functions, namedPoints, scope.ownedStatements)
  for (const [name, position] of constructions.points) namedPoints.set(name, position)
  const camera = cameraFor(config.view)

  const items: FigureItem[] = []
  const errors: SceneError[] = [...scope.errors, ...constructions.errors]
  const hasSolid = statements.some((s) => isSolidFigureStatement(s.kind))
  // Measure labels are built in a second pass: where one sits depends on
  // where the rest of the figure is (a side's label goes on the outside),
  // and that is only known once every other item exists.
  const measureStatements: { statement: Statement; index: number }[] = []
  const givenStatements: { statement: Statement; index: number }[] = []
  // Bound solids, by name. Definition-before-use, exactly as constructions
  // are: a solid is built when its own statement is walked, so anything
  // naming it must come later in the spec.
  // The walk has already built every solid; this map is filled as the loop
  // passes each one, which keeps "cut: S" before "S = solid ..." an error.
  const solids = new Map<string, SolidBody>()
  // N1 — the right edge of everything lifted so far (sections, nets, path
  // unfoldings), so each lift sits clear of the one before, in statement
  // order. Null until the first lift, which then sits exactly where phase 5
  // put a section.
  let liftRight: number | null = null

  // A circle has to be *named* to be talked about: "circle: (0,0), 3" draws
  // one and binds nothing, so an arc or a central angle needs the
  // construction form ("O = circle C, 5", "O = circumcircle ABC").
  function resolveCircle(name: string): GeometryCircle {
    const found = constructions.circles.get(name)
    if (!found) {
      throw new Error(
        `Unknown circle "${name}" — name a circle before drawing on it (e.g. "${name} = circle C, 5" or "${name} = circumcircle ABC")`
      )
    }
    return found
  }

  function resolveSolid(name: string): SolidBody {
    const found = solids.get(name)
    if (!found) {
      throw new Error(`Unknown solid "${name}" — name a solid before labelling it (e.g. "${name} = solid prism 8 by 5 by 6")`)
    }
    return found
  }

  function resolve(name: string): Vec2 {
    const point = namedPoints.get(name)
    if (!point && scope.planes.has(name)) throw new Error(`"${name}" is a plane, not a point`)
    if (!point && isSpaceName(scope, name)) {
      // S7 — the refusal is legible, not "unknown": the point exists, in
      // space, and this statement only draws in the plane.
      throw new Error(
        `"${name}" is a point in space, and this draws only in the plane — polygons, triangles, circles and arcs in space are not drawn`
      )
    }
    if (!point) throw new Error(`Unknown point "${name}" — define it with a point statement (e.g. "${name} = (x, y)") or as a polygon vertex first`)
    return point
  }

  // The names as points in space, or null when none of them is one (S2).
  function resolveSpace(names: readonly string[], what: string): Vec3[] | null {
    const space = names.filter((name) => isSpaceName(scope, name))
    if (space.length === 0) return null
    const plane = names.find((name) => !isSpaceName(scope, name))
    if (plane !== undefined) {
      if (!namedPoints.has(plane)) resolve(plane)
      throw new Error(`"${what}" mixes a point in space (${space[0]}) with a point in the plane (${plane})`)
    }
    return names.map((name) => scope.points.get(name) as Vec3)
  }

  // M5 — the walk resolved every measure's plane in source order (a named
  // plane must come first); this reads the answer, or its refusal.
  function resolveMeasurePlane(form: PlaneForm): Plane3 {
    const resolved = scope.measurePlanes.get(form)
    if (!resolved) throw new Error(`The plane ${form.source} was never resolved`)
    if ('error' in resolved) throw new Error(resolved.error)
    return resolved.plane
  }

  // N3 / N4 — a shortest path, found once per (P, Q, S) and shared by the
  // statement that draws it and a label or row that measures it.
  const paths = new Map<string, SurfacePath>()
  function resolvePath(subject: { from: string; to: string; solid: string }): SurfacePath {
    const key = `${subject.from}|${subject.to}|${subject.solid}`
    const known = paths.get(key)
    if (known) return known
    const body = resolveSolid(subject.solid)
    const what = `shortest ${subject.from} to ${subject.to} over ${subject.solid}`
    const ends = resolveSpace([subject.from, subject.to], what)
    if (!ends) {
      resolve(subject.from)
      resolve(subject.to)
      throw new Error(`"${what}": ${subject.from} and ${subject.to} are points in the plane — a shortest path runs over a solid, between points in space on it`)
    }
    const found = shortestPath(body, subject.solid, netSolidWord(body), [ends[0], ends[1]], [subject.from, subject.to], scope.vertexNames.get(body) ?? [])
    paths.set(key, found)
    return found
  }

  const resolvers: Resolvers = {
    point: resolve,
    circle: resolveCircle,
    solid: resolveSolid,
    space: resolveSpace,
    plane: resolveMeasurePlane,
    path: resolvePath,
  }

  // S6 — every solid the figure draws occludes a construction segment, in
  // source order (the order does not change the answer, only the order the
  // candidates are gathered in). A hidden solid is not drawn, so it hides
  // nothing.
  const occluders: SolidBody[] = []
  for (const [index, built] of [...scope.byStatement.entries()].sort((x, y) => x[0] - y[0])) {
    const statement = statements[index]
    if (!built.solid || (statement.statementName && config.hidden.has(statement.statementName))) continue
    occluders.push(built.solid)
  }

  // A segment in space, drawn as line items: split into visible and hidden
  // pieces by the glass rule, or all one style when the author forced it.
  // Hidden pieces are auxiliary lines, which is exactly how a hidden solid
  // edge is stroked — dashed, thinner, fainter, in the layer beneath.
  function spaceSegmentItems(
    index: number,
    a: Vec3,
    b: Vec3,
    style: 'auto' | 'dashed' | 'plain',
    object: string | null,
    color: string | null
  ): FigureItem[] {
    const spans: Span[] = style === 'auto' ? segmentSpans(a, b, occluders, camera) : [{ from: 0, to: 1, hidden: style === 'dashed' }]
    const at = (u: number): Vec2 => camera.project({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), z: a.z + u * (b.z - a.z) })
    return spans.map((span) => ({
      kind: 'line' as const,
      id: { statement: index, object },
      a: at(span.from),
      b: at(span.to),
      extent: 'segment' as const,
      auxiliary: span.hidden,
      color,
    }))
  }

  // A lifted section's named vertices (or a region's corners), registered as
  // ORDINARY named points in the plane. A lifted section is at true size, so
  // "label: PQ" measures the real edge, through the ordinary 2D path (H5).
  function nameLiftedVertices(index: number, names: readonly string[], at: readonly Vec2[], color: string | null): void {
    const clash = names.find((name) => isSpaceName(scope, name))
    if (clash) throw new Error(`"${clash}" is already bound to a point in space — name the section's vertices differently`)
    const centre = centroidOf(at)
    for (let v = 0; v < at.length; v++) {
      namedPoints.set(names[v], at[v])
      items.push({
        kind: 'point',
        id: { statement: index, object: names[v] },
        at: at[v],
        label: names[v],
        prefer: awayFrom(at[v], centre),
        color,
      })
    }
  }

  // Phase 10 (M1, M4) — the arc of angle from-vertex-to on points in space,
  // as an item: built in the angle's plane, projected, and hidden or not as
  // a whole by its middle. `names` are the author's, for the refusals.
  function spaceArcItem(
    index: number,
    [from, vertex, to]: Vec3[],
    names: { from: string; vertex: string; to: string },
    label: string | null,
    color: string | null
  ): Extract<FigureItem, { kind: 'spaceArc' }> {
    const arc = angleArc(angleFrame(vertex, from, to, names))
    const hidden = markHidden(arcMiddle(arc), occluders, camera)
    return {
      kind: 'spaceArc',
      id: { statement: index, object: names.vertex },
      edge: projectArc(arc, camera, names.vertex, hidden),
      hidden,
      text: label === null ? null : { at: camera.project(arcMiddle(arc)), push: viewDirection(arcBisector(arc)), label },
      color,
    }
  }

  // A direction in space as the label layout wants it: projected, unit, in
  // VIEW space (y flipped, as awayFrom does). Null when the camera looks
  // along it.
  function viewDirection(direction: Vec3): Vec2 | null {
    const p = projectVector(camera, direction)
    const length = Math.hypot(p.x, p.y)
    if (length <= GEOM_EPS) return null
    return { x: p.x / length, y: -p.y / length }
  }

  // M7 / the dedupe below: an angle mark in space, keyed by its vertex and
  // its unordered arms, so "label: angle GBA" beside "angle: A-B-G" does not
  // draw the arc twice.
  const spaceAngleMarks = new Set<string>()
  const angleKey = (from: string, vertex: string, to: string) => `${vertex}:${[from, to].sort().join(',')}`

  // M3 — a dihedral's mark as items: its two construction segments, each
  // split exactly by the glass rule (segmentSpans, never M4's midpoint
  // rule), and M1's arc between them, hidden or not whole by its middle.
  // Returns the arc so a label can hang on it. `names` are the author's.
  const spaceDihedralMarks = new Set<string>()
  const dihedralKey = (from: string, [a, b]: [string, string], to: string) => `${[a, b].sort().join(',')}|${[from, to].sort().join(',')}`

  function dihedralItems(
    index: number,
    [from, a, b, to]: Vec3[],
    names: { from: string; edge: [string, string]; to: string },
    color: string | null
  ): { items: FigureItem[]; arc: SpaceArc } {
    const title = `dihedral ${names.from}-${names.edge.join('-')}-${names.to}`
    const found = dihedral3(from, a, b, to, { from: names.from, a: names.edge[0], b: names.edge[1], to: names.to })
    const mark = dihedralMark(found, distance3(a, b), title)
    const object = `${names.from}-${names.edge.join('')}-${names.to}`
    const hidden = markHidden(arcMiddle(mark.arc), occluders, camera)
    return {
      arc: mark.arc,
      items: [
        ...spaceSegmentItems(index, mark.mid, mark.ends[0], 'auto', `${object}:${names.from}`, color),
        ...spaceSegmentItems(index, mark.mid, mark.ends[1], 'auto', `${object}:${names.to}`, color),
        { kind: 'spaceArc', id: { statement: index, object }, edge: projectArc(mark.arc, camera, object, hidden), hidden, text: null, color },
      ],
    }
  }

  // N1 — a flat net (or a path's unfolding) lifted beside its solid, stacked
  // after every earlier lift, with its letters as display labels. Returns the
  // move that placed it, for anything drawn on it.
  function liftNet(index: number, object: string, body: SolidBody, net: Net, names: readonly (string | undefined)[], color: string | null): (p: Vec2) => Vec2 {
    const flat = net.lines.flatMap((line) => netEdges(line.piece, line.object))
    const solidBounds = boundsOf(solidOutline(body, camera).flatMap(edgeExtremes))
    const shapeBounds = boundsOf(flat.flatMap(edgeExtremes))
    // A net's letters face the drawing it is lifted beside, so it reserves
    // label clearance in the gap (fix round 1); a section keeps phase 5's.
    const offset: Vec2 = solidBounds && shapeBounds ? liftOffset(solidBounds, shapeBounds, liftRight, NET_LABEL_CLEARANCE) : { x: 0, y: 0 }
    if (shapeBounds) liftRight = shapeBounds.maxX + offset.x
    const move = (p: Vec2): Vec2 => ({ x: p.x + offset.x, y: p.y + offset.y })
    const lines = net.lines.flatMap((line) => netEdges(movePiece(line.piece, move), line.object).map((edge) => ({ edge, fold: line.fold })))
    items.push({ kind: 'net', id: { statement: index, object }, lines, faces: net.faces.map((f) => f.corners.map(move)), color })
    net.letters.forEach((letter, copy) => {
      const label = names[letter.vertex]
      if (!label) return
      const at = move(letter.at)
      items.push({ kind: 'netLabel', id: { statement: index, object: label }, copy, at, label, prefer: awayFrom(at, move(letter.toward)), color })
    })
    return move
  }

  // N3 / N4 — a shortest path, drawn: on a polyhedron as its per-face
  // segments on the solid, split by the glass rule, and — only when some
  // statement asks for "unfold" — straight across the lifted strip; on a
  // round solid, always and only on the lifted unrolling (the net's, cut
  // behind), in one or two straight pieces. Its ends are dotted and
  // lettered on the lift (unless a vertex copy already letters the spot).
  // Each part is drawn once per (P, Q, S): a later "unfold" of a path
  // already drawn lifts its strip then (fix round 1), and a label reuses
  // what was drawn. Returns where the path's middle is, for a label.
  type PathAnchor = { at: Vec2; along: [Vec2, Vec2]; onSolid: boolean }
  const pathsOnSolid = new Map<string, PathAnchor>()
  const pathsLifted = new Map<string, PathAnchor>()
  function drawPath(index: number, subject: { from: string; to: string; solid: string }, unfold: boolean, color: string | null): PathAnchor {
    const key = `${subject.from}|${subject.to}|${subject.solid}`
    const path = resolvePath(subject)
    const body = resolveSolid(subject.solid)
    const object = `path-${subject.from}${subject.to}`
    if (!body.polyhedron) {
      if (!pathsLifted.has(key)) pathsLifted.set(key, liftPath(index, subject, path, body, object, color))
      return pathsLifted.get(key)!
    }
    let anchor = pathsOnSolid.get(key)
    if (!anchor) {
      for (let i = 0; i + 1 < path.onSolid.length; i++) items.push(...spaceSegmentItems(index, path.onSolid[i], path.onSolid[i + 1], 'auto', object, color))
      anchor = { ...middleOf(path.onSolid), onSolid: true }
      pathsOnSolid.set(key, anchor)
    }
    if (unfold && !pathsLifted.has(key)) pathsLifted.set(key, liftPath(index, subject, path, body, object, color))
    return anchor
  }

  // The flat picture of a path, lifted: the strip or unrolling in the
  // figure's ink, the path's pieces in its colour, its ends dotted.
  function liftPath(index: number, subject: { from: string; to: string }, path: SurfacePath, body: SolidBody, object: string, color: string | null): PathAnchor {
    const names = scope.vertexNames.get(body) ?? []
    const move = liftNet(index, `unfold-${subject.from}${subject.to}`, body, path.flat.net, names, null)
    const pieces = path.flat.pieces.map(([a, b]): [Vec2, Vec2] => [move(a), move(b)])
    for (const [a, b] of pieces) items.push({ kind: 'line', id: { statement: index, object }, a, b, extent: 'segment', auxiliary: false, color })
    for (const [name, at] of [
      [subject.from, move(path.flat.from)],
      [subject.to, move(path.flat.to)],
    ] as const) {
      const lettered = path.flat.net.letters.some((letter) => names[letter.vertex] === name && Math.hypot(move(letter.at).x - at.x, move(letter.at).y - at.y) <= GEOM_EPS * Math.max(1, Math.hypot(at.x, at.y)))
      items.push({ kind: 'point', id: { statement: index, object: name }, at, label: lettered ? null : name, prefer: null, color })
    }
    // Halfway along the drawn pieces.
    const lengths = pieces.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y))
    let half = lengths.reduce((sum, l) => sum + l, 0) / 2
    for (let i = 0; i < pieces.length; i++) {
      if (half <= lengths[i] || i === pieces.length - 1) {
        const [a, b] = pieces[i]
        const u = lengths[i] === 0 ? 0 : Math.min(1, half / lengths[i])
        return { at: { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) }, along: [a, b], onSolid: false }
      }
      half -= lengths[i]
    }
    const at = move(path.flat.from)
    return { at, along: [at, at], onSolid: false }
  }

  // The point halfway along a path on the solid, projected, and the drawn
  // piece it lies on (for the side a label goes).
  function middleOf(points: readonly Vec3[]): { at: Vec2; along: [Vec2, Vec2] } {
    const lengths = points.slice(1).map((p, i) => distance3(points[i], p))
    let half = lengths.reduce((sum, l) => sum + l, 0) / 2
    for (let i = 0; i < lengths.length; i++) {
      if (half <= lengths[i] || i === lengths.length - 1) {
        const u = lengths[i] === 0 ? 0 : Math.min(1, half / lengths[i])
        const [a, b] = [points[i], points[i + 1]]
        return {
          at: camera.project({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), z: a.z + u * (b.z - a.z) }),
          along: [camera.project(a), camera.project(b)],
        }
      }
      half -= lengths[i]
    }
    return { at: camera.project(points[0]), along: [camera.project(points[0]), camera.project(points[0])] }
  }

  // A point in space, drawn: a dot at its projection, lettered with its name.
  function spacePointItem(index: number, name: string, at: Vec3, color: string | null): FigureItem {
    return { kind: 'point', id: { statement: index, object: name || null }, at: camera.project(at), label: name || null, prefer: null, color }
  }

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    const id = { statement: index, object: null as string | null }
    try {
      switch (statement.kind) {
        case 'point':
          // A point the walk owns is a point in space, or a plane point it
          // refused; either way it is drawn from the walk's record or not at all.
          if (statement.z !== null || scope.ownedStatements.has(index)) {
            for (const p of scope.byStatement.get(index)?.points ?? []) items.push(spacePointItem(index, p.name, p.at, statement.color))
            break
          }
          items.push({
            kind: 'point',
            id: { statement: index, object: statement.label },
            at: { x: value(statement.x), y: value(statement.y) },
            label: statement.label,
            prefer: null,
            color: statement.color,
          })
          break
        case 'segment':
        case 'ray':
        case 'vector': {
          if (statement.z1 !== null || statement.z2 !== null) {
            if (statement.kind !== 'segment' || statement.z1 === null || statement.z2 === null) {
              throw new Error(
                statement.kind === 'segment'
                  ? 'A segment in space needs three coordinates at both ends, "(x1, y1, z1) -- (x2, y2, z2)"'
                  : `A ${statement.kind} in space is not drawn in a solid figure yet — draw a segment, "(x1, y1, z1) -- (x2, y2, z2)"`
              )
            }
            // S1 — the author's z-up coordinates, converted at the boundary.
            const a = authorToWorld({ x: value(statement.x1), y: value(statement.y1), z: value(statement.z1) })
            const b = authorToWorld({ x: value(statement.x2), y: value(statement.y2), z: value(statement.z2) })
            items.push(...spaceSegmentItems(index, a, b, 'auto', null, statement.color))
            break
          }
          const a = { x: value(statement.x1), y: value(statement.y1) }
          const b = { x: value(statement.x2), y: value(statement.y2) }
          items.push({ kind: 'line', id, a, b, extent: statement.kind === 'ray' ? 'ray' : 'segment', auxiliary: false, color: statement.color })
          break
        }
        case 'namedSegment': {
          const space = resolveSpace([statement.from, statement.to], `segment: ${statement.from}-${statement.to}`)
          if (space) {
            items.push(...spaceSegmentItems(index, space[0], space[1], statement.style, `${statement.from}${statement.to}`, statement.color))
            break
          }
          const a = resolve(statement.from)
          const b = resolve(statement.to)
          items.push({ kind: 'line', id, a, b, extent: 'segment', auxiliary: statement.style === 'dashed', color: statement.color })
          break
        }
        case 'circle':
          items.push({ kind: 'circle', id, center: { x: value(statement.cx), y: value(statement.cy) }, radius: value(statement.radius), color: statement.color })
          break
        case 'polygon': {
          const vertices = statement.vertices.map((v) => ({ label: v.label, at: { x: value(v.x), y: value(v.y) } }))
          items.push({ kind: 'polygon', id, vertices: vertices.map((v) => v.at), color: statement.color })
          const centre = centroidOf(vertices.map((v) => v.at))
          for (const vertex of vertices) {
            items.push({
              kind: 'point',
              id: { statement: index, object: vertex.label },
              at: vertex.at,
              label: vertex.label,
              // A vertex label points away from the shape's own centroid,
              // because an angle: or right-angle: mark always sits inside.
              prefer: awayFrom(vertex.at, centre),
              color: statement.color,
            })
          }
          break
        }
        case 'triangle': {
          const vertices = statement.names.map((name) => ({ label: name, at: resolve(name) }))
          items.push({ kind: 'polygon', id, vertices: vertices.map((v) => v.at), color: statement.color })
          const centre = centroidOf(vertices.map((v) => v.at))
          for (const vertex of vertices) {
            items.push({
              kind: 'point',
              id: { statement: index, object: vertex.label },
              at: vertex.at,
              label: vertex.label,
              prefer: awayFrom(vertex.at, centre),
              color: statement.color,
            })
          }
          break
        }
        case 'solid': {
          // Built by the walk (S3); a solid that failed there has already
          // reported why, and there is nothing to draw.
          const built = scope.byStatement.get(index)
          const body = built?.solid
          if (!built || !body) break
          if (statement.name) solids.set(statement.name, body)
          const edges = solidOutline(body, camera)
          items.push({ kind: 'solid', id: { statement: index, object: statement.name }, edges, color: statement.color })
          // A solid's vertices are lettered, not dotted — they are real points
          // now (S4), but a dot would claim a construction point that the
          // author did not construct.
          const projected = built.points.map((p) => camera.project(p.at))
          const centre = centroidOf(projected)
          for (let v = 0; v < built.points.length; v++) {
            items.push({
              kind: 'solidVertex',
              id: { statement: index, object: built.points[v].name },
              at: projected[v],
              label: built.points[v].name,
              prefer: awayFrom(projected[v], centre),
              color: statement.color,
            })
          }
          break
        }
        case 'crossSection': {
          const body = resolveSolid(statement.solid)
          // S1 — the author wrote the plane z-up; the walk resolved and
          // canonicalised it (Q1), and everything past this line works in the
          // internal frame.
          const resolved = scope.sectionPlanes.get(index)
          if (!resolved) throw new Error(`The plane of this ${statement.lift ? 'section' : 'cut'} was never resolved`)
          if ('error' in resolved) throw new Error(resolved.error)
          const plane = resolved.plane
          const section = sectionOf(body, plane, statement.solid)

          if (!statement.lift) {
            // Shaded in place: the section drawn where it sits, through the
            // same camera as the solid it cuts.
            items.push({
              kind: 'sectionFace',
              id: { statement: index, object: statement.solid },
              outline:
                section.kind === 'polygon'
                  ? { kind: 'polygon', vertices: section.points.map((point) => camera.project(point)) }
                  : section.kind === 'region'
                    ? { kind: 'region', edges: projectedRegion(section.boundary, camera) }
                    : {
                        kind: 'ellipse',
                        circle: projectCircle(camera, section.center, ...planeRadii(plane, section.radius)),
                      },
              edges: projectedOutline(sectionOutline(body, section, plane, camera), camera),
              color: statement.color,
            })
            break
          }

          // **H5.** Lifted, the section is a plane figure and nothing more, so
          // it becomes the same polygon and circle items a 2D statement
          // produces — and gets measures, notation and label layout for free.
          const shape = trueShape(section, plane)
          const solidBounds = boundsOf(solidOutline(body, camera).flatMap(edgeExtremes))
          const shapeBounds = boundsOf(
            shape.kind === 'polygon'
              ? shape.vertices
              : shape.kind === 'region'
                ? liftedRegion(shape.boundary, (p) => p).flatMap(edgeExtremes)
                : [
                    { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius },
                    { x: shape.center.x + shape.radius, y: shape.center.y + shape.radius },
                  ]
          )
          const offset: Vec2 = solidBounds && shapeBounds ? liftOffset(solidBounds, shapeBounds, liftRight) : { x: 0, y: 0 }
          const move = (p: Vec2): Vec2 => ({ x: p.x + offset.x, y: p.y + offset.y })
          // The running edge moves only once the section is drawn (fix round
          // 1): one refused before it is drawn leaves no gap behind it.
          const lifted = () => {
            if (shapeBounds) liftRight = shapeBounds.maxX + offset.x
          }

          if (shape.kind === 'region') {
            items.push({ kind: 'region', id: { statement: index, object: statement.solid }, edges: liftedRegion(shape.boundary, move), color: statement.color })
            lifted()
            if (statement.vertices.length === 0) break
            // Q5 — a region's CORNERS, where an arc meets a chord, in boundary
            // order from the first chord's start. A whole ellipse has none.
            const corners = regionCorners(shape.boundary).map(move)
            if (corners.length === 0) {
              throw new Error(`The section of "${statement.solid}" by ${describeAuthorPlane(plane)} is an ellipse, which has no vertices to name`)
            }
            if (statement.vertices.length !== corners.length) {
              throw new Error(
                `The section of "${statement.solid}" by ${describeAuthorPlane(plane)} has ${corners.length} corners, ` +
                  `but ${statement.vertices.length} names were given ("${statement.vertices.join('')}")`
              )
            }
            nameLiftedVertices(index, statement.vertices, corners, statement.color)
            break
          }

          if (shape.kind === 'circle') {
            if (statement.vertices.length > 0) {
              throw new Error(`The section of "${statement.solid}" by ${describeAuthorPlane(plane)} is a circle, which has no vertices to name`)
            }
            items.push({ kind: 'circle', id: { statement: index, object: statement.solid }, center: move(shape.center), radius: shape.radius, color: statement.color })
            lifted()
            break
          }

          const vertices = shape.vertices.map(move)
          items.push({ kind: 'polygon', id: { statement: index, object: statement.solid }, vertices, color: statement.color })
          lifted()
          if (statement.vertices.length > 0) {
            if (statement.vertices.length !== vertices.length) {
              throw new Error(
                `The section of "${statement.solid}" by ${describeAuthorPlane(plane)} has ${vertices.length} vertices, ` +
                  `but ${statement.vertices.length} names were given ("${statement.vertices.join('')}")`
              )
            }
            nameLiftedVertices(index, statement.vertices, vertices, statement.color)
          }
          break
        }
        case 'net': {
          // N1 — the solid unfolded by its template, lifted beside it like a
          // section, at true size. Refusals (a sphere, a hull, an overlap)
          // come back in the author's names.
          const body = resolveSolid(statement.solid)
          const names = scope.vertexNames.get(body) ?? []
          liftNet(index, statement.solid, body, netOf(body, statement.solid, names), names, statement.color)
          break
        }
        case 'shortestPath':
          drawPath(index, statement, statement.unfold, statement.color)
          break
        case 'construction': {
          if (scope.ownedStatements.has(index)) {
            for (const p of scope.byStatement.get(index)?.points ?? []) items.push(spacePointItem(index, p.name, p.at, statement.color))
            break
          }
          for (const built of constructions.geometryByStatement.get(index) ?? []) {
            items.push(...geometryItems(built.object, built.name, { statement: index, object: built.name }, statement.color))
          }
          break
        }
        case 'angle': {
          // Phase 10 (M1) — on points in space, the arc in the angle's plane.
          const names = { from: statement.from, vertex: statement.vertex, to: statement.to }
          const space = resolveSpace([statement.from, statement.vertex, statement.to], `angle: ${statement.from}-${statement.vertex}-${statement.to}`)
          if (space) {
            items.push(spaceArcItem(index, space, names, statement.label, statement.color))
            spaceAngleMarks.add(angleKey(statement.from, statement.vertex, statement.to))
            break
          }
          items.push({
            kind: 'angleMark',
            id: { statement: index, object: statement.vertex },
            vertex: resolve(statement.vertex),
            from: resolve(statement.from),
            to: resolve(statement.to),
            label: statement.label,
            color: statement.color,
          })
          break
        }
        case 'circleShape': {
          const arc = arcOf(statement, resolve, resolveCircle)
          items.push({
            kind: 'arc',
            id: { statement: index, object: statement.circle },
            arc,
            fill: statement.shape === 'arc' ? 'none' : statement.shape,
            color: statement.color,
          })
          break
        }
        case 'centralAngle': {
          const arc = arcOf(statement, resolve, resolveCircle)
          items.push({
            kind: 'centralAngle',
            id: { statement: index, object: statement.circle },
            arc,
            // Read from the arc, so this mark and "label: arc PQ on O <dir>"
            // print the same number in both angle modes (G2).
            label: formatAngleMeasure(arcMeasure(arc, config.angle), config.angle),
            color: statement.color,
          })
          break
        }
        case 'inscribedAngle': {
          const circle = resolveCircle(statement.circle)
          const vertex = resolve(statement.vertex)
          const from = resolve(statement.from)
          const to = resolve(statement.to)
          // An angle whose vertex is not on the circle is not an inscribed
          // angle, and the half-the-arc relation it is drawn to show is
          // simply false for it.
          requireOnCircle(circle, vertex, statement.vertex, "an inscribed angle's vertex", { circle: statement.circle })
          requireOnCircle(circle, from, statement.from, "an inscribed angle's arms", { circle: statement.circle })
          requireOnCircle(circle, to, statement.to, "an inscribed angle's arms", { circle: statement.circle })
          items.push({
            kind: 'angleMark',
            id: { statement: index, object: statement.vertex },
            vertex,
            from,
            to,
            label: formatAngleMeasure(angleMeasure(vertex, from, to, config.angle), config.angle),
            color: statement.color,
          })
          break
        }
        case 'tick': {
          // Phase 10 (M1, M4) — on a segment in space, drawn in the picture
          // plane at the projected segment, hidden or not by its midpoint.
          const space = resolveSpace([statement.from, statement.to], `tick: ${statement.from}-${statement.to}`)
          if (space) {
            const hidden = markHidden(midpoint3(space[0], space[1]), occluders, camera)
            items.push({ kind: 'tickMark', id, from: camera.project(space[0]), to: camera.project(space[1]), count: statement.count, hidden, color: statement.color })
            break
          }
          items.push({ kind: 'tickMark', id, from: resolve(statement.from), to: resolve(statement.to), count: statement.count, color: statement.color })
          break
        }
        case 'rightAngle': {
          // Phase 10 (M1, M2) — on points in space, a square in the angle's
          // plane, and only on an angle that IS right: a projected square
          // cannot be checked by eye, so it would state something false.
          // "@scale: false" lifts the check, as it lifts every assertion.
          const space = resolveSpace([statement.from, statement.vertex, statement.to], `right-angle: ${statement.from}-${statement.vertex}-${statement.to}`)
          if (space) {
            const frame = angleFrame(space[1], space[0], space[2], { from: statement.from, vertex: statement.vertex, to: statement.to })
            const degrees = (frame.angle * 180) / Math.PI
            if (config.toScale && Math.abs(degrees - 90) > GEOM_EPS * 90) {
              throw new Error(`${statement.from}-${statement.vertex}-${statement.to} is not a right angle — its true angle is ${nearRightAngle(degrees)}°`)
            }
            const [vertex, onFrom, corner, onTo] = rightAngleCorners(frame)
            // M4 — judged at the square's centre.
            const hidden = markHidden(midpoint3(vertex, corner), occluders, camera)
            items.push({
              kind: 'spaceRightAngle',
              id: { statement: index, object: statement.vertex },
              points: [camera.project(onFrom), camera.project(corner), camera.project(onTo)],
              hidden,
              color: statement.color,
            })
            break
          }
          items.push({
            kind: 'rightAngleMark',
            id: { statement: index, object: statement.vertex },
            vertex: resolve(statement.vertex),
            from: resolve(statement.from),
            to: resolve(statement.to),
            color: statement.color,
          })
          break
        }
        case 'dihedral': {
          // M3 — only among points in space.
          const names = [statement.from, ...statement.edge, statement.to]
          const what = `dihedral: ${names.join('-')}`
          const space = resolveSpace(names, what)
          if (!space) {
            for (const name of names) resolve(name)
            throw new Error(`"${what}" is a dihedral angle, which exists only among points in space — ${statement.from} is a point in the plane`)
          }
          items.push(...dihedralItems(index, space, statement, statement.color).items)
          spaceDihedralMarks.add(dihedralKey(statement.from, statement.edge, statement.to))
          break
        }
        case 'measureLabel':
          measureStatements.push({ statement, index })
          break
        case 'given':
          givenStatements.push({ statement, index })
          break
        default:
          // S5 sends a solid beside a plot to this renderer, which draws no
          // plots. Say so, rather than drop the plot without a word. Only
          // when the spec holds a solid: a plain 2D figure keeps exactly the
          // behaviour it had.
          if (hasSolid && isPlotted(statement.kind)) throw new Error(plotRefusal(statement))
          break
      }
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  for (const { statement, index } of givenStatements) {
    if (statement.kind !== 'given') continue
    try {
      const { cells, error } = givenCells(statement.entry, resolvers, config)
      if (error) errors.push({ line: 0, message: error })
      items.push({ kind: 'given', id: { statement: index, object: null }, section: statement.section, cells, color: statement.color })
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  const centre = centroidOf(anchorPoints(items).length > 0 ? anchorPoints(items) : [{ x: 0, y: 0 }])
  for (const { statement, index } of measureStatements) {
    if (statement.kind !== 'measureLabel') continue
    try {
      const { subject, content } = statement
      let at: Vec2
      let push: Vec2 | null
      let computed: number | null = null
      // Whether this label may grow a leader line when the layout pushes it
      // away. A 2D measure never needs one — it sits on the midpoint of
      // geometry that is drawn, so a reader can see what it names — but a
      // dimension on a projected solid sits beside an edge among eleven
      // others, and a displaced one names nothing without a line back.
      let leader = false
      const inside = subject.kind === 'angle' || subject.kind === 'dihedral'
      const space =
        subject.kind === 'length'
          ? resolveSpace([subject.from, subject.to], subjectName(subject))
          : subject.kind === 'angle'
            ? resolveSpace([subject.from, subject.vertex, subject.to], subjectName(subject))
            : null
      if (space && subject.kind === 'angle') {
        // M7 — the label draws M1's arc (once: not again beside an "angle:"
        // statement for the same angle) and hangs on the arc's middle,
        // pushed outward along the bisector in space, then projected.
        const arc = spaceArcItem(index, space, { from: subject.from, vertex: subject.vertex, to: subject.to }, null, statement.color)
        const key = angleKey(subject.from, subject.vertex, subject.to)
        if (!spaceAngleMarks.has(key)) {
          items.push(arc)
          spaceAngleMarks.add(key)
        }
        const frame = angleArc(angleFrame(space[1], space[0], space[2], { from: subject.from, vertex: subject.vertex, to: subject.to }))
        at = camera.project(arcMiddle(frame))
        push = viewDirection(arcBisector(frame))
        computed = inAngleUnit(angle3(space[1], space[0], space[2], subjectName(subject)), config)
      } else if (space) {
        // S4 — a segment between points in space prints its TRUE length, and
        // its label is placed by the solid-dimension path (leader-capable),
        // fed the projected endpoints: it sits among a solid's edges exactly
        // as a dimension does. No third placement.
        const a = camera.project(space[0])
        const b = camera.project(space[1])
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        push = outwardPerpendicular(a, b, centre)
        computed = distance3(space[0], space[1])
        leader = true
      } else if (subject.kind === 'length') {
        const a = resolve(subject.from)
        const b = resolve(subject.to)
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        push = outwardPerpendicular(a, b, centre)
        computed = segmentLength(a, b)
      } else if (subject.kind === 'angle') {
        const vertex = resolve(subject.vertex)
        const from = resolve(subject.from)
        const to = resolve(subject.to)
        at = vertex
        push = bisectorDirection(vertex, from, to)
        computed = angleMeasure(vertex, from, to, config.angle)
      } else if (subject.kind === 'arc') {
        const arc = arcOf(subject, resolve, resolveCircle)
        // On the arc, pushed outward from the centre: an arc's measure
        // belongs beside the arc itself, and outward is the only side that is
        // never inside the circle the arc bounds.
        at = arcMidpoint(arc)
        push = awayFrom(at, arc.center)
        computed = arcMeasure(arc, config.angle)
      } else if (subject.kind === 'solidDimension') {
        const body = resolveSolid(subject.solid)
        computed = solidDimensionValue(body, subject.dimension, subject.solid)
        const segment = drawnDimensionSegment(body, subject.dimension, camera)
        if (!segment) throw new Error(`A ${body.spec.kind} has no "${subject.dimension}" to attach a label to`)
        const a = camera.project(segment[0])
        const b = camera.project(segment[1])
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        // Outward from the solid's own drawing, the same rule a triangle's
        // side label follows — a dimension belongs beside the edge it
        // measures, not across it.
        push = outwardPerpendicular(a, b, centre)
        leader = true
        if (!body.polyhedron || hangsOffAxis(body.spec, subject.dimension)) {
          const [from, to] = segment
          const along = (u: number): Vec2 =>
            camera.project({ x: from.x + u * (to.x - from.x), y: from.y + u * (to.y - from.y), z: from.z + u * (to.z - from.z) })
          for (const span of segmentSpans(from, to, [body], camera)) {
            const [p, q] = [along(span.from), along(span.to)]
            // Seen end-on (a height from straight above), the line is a
            // point: nothing to draw, and nothing for a label to avoid.
            if (Math.hypot(q.x - p.x, q.y - p.y) <= GEOM_EPS * Math.max(1, Math.hypot(p.x, p.y))) continue
            items.push({
              kind: 'dimensionReference',
              id: { statement: index, object: subjectName(subject) },
              a: p,
              b: q,
              hidden: span.hidden,
              color: statement.color,
            })
          }
        }
      } else if (subject.kind === 'triangle') {
        const vertices = subject.names.map((name) => resolve(name))
        at = centroidOf(vertices)
        push = null
      } else if (subject.kind === 'shortestPath') {
        // N5 — the length, on the path: drawn here when no "shortest:" drew
        // it (as a label draws its angle's arc, M7), at the path's middle.
        const drawn = drawPath(index, subject, false, statement.color)
        at = drawn.at
        push = outwardPerpendicular(drawn.along[0], drawn.along[1], centre)
        computed = resolvePath(subject).length
        // Among a solid's edges a displaced label needs its line back, as a
        // dimension does; on a lifted unrolling the path stands alone.
        leader = drawn.onSolid
      } else if (subject.kind === 'dihedral') {
        // M3 — the value, on the mark: drawn here (once — not again beside a
        // "dihedral:" for the same angle), the label on the arc's middle,
        // pushed along its bisector in space, then projected (M7's rule).
        const space = spaceOnly(resolvers, [subject.from, ...subject.edge, subject.to], subjectName(subject))
        const mark = dihedralItems(index, space, subject, statement.color)
        const key = dihedralKey(subject.from, subject.edge, subject.to)
        if (!spaceDihedralMarks.has(key)) {
          items.push(...mark.items)
          spaceDihedralMarks.add(key)
        }
        at = camera.project(arcMiddle(mark.arc))
        push = viewDirection(arcBisector(mark.arc))
        computed = measureOf(subject, resolvers, config)
      } else {
        // Refused at parse time (M5); the table is where these belong.
        throw new Error(`"label: ${subjectName(subject)}" has no single point to hang a label on — write "given: ${subjectName(subject)}"`)
      }
      const { runs, error } = measureRuns(subject, content, computed, config)
      if (error) errors.push({ line: 0, message: error })
      items.push({
        kind: 'measureLabel',
        id: { statement: index, object: subjectName(subject) },
        at,
        push,
        inside,
        leader,
        runs,
        color: statement.color,
      })
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { items, errors }
}

// ---------------------------------------------------------------------------
// Q5 — a region's boundary, as drawn edges
// ---------------------------------------------------------------------------

// A whole turn is two arcs: one `A` command cannot sweep a full turn (its two
// ends coincide and the curve is undefined), exactly as a rim is two halves.
function splitTurn(from: number, to: number): [number, number][] {
  if (Math.abs(to - from) < 2 * Math.PI - GEOM_EPS) return [[from, to]]
  const half = (from + to) / 2
  return [
    [from, half],
    [half, to],
  ]
}

function arcEdge(circle: ProjectedCircle, from: number, to: number, object: string): ProjectedEdge {
  return {
    kind: 'arc',
    center: circle.center,
    rx: circle.rx,
    ry: circle.ry,
    rotation: circle.rotation,
    startAngle: circle.parameter(from),
    endAngle: circle.parameter(to),
    hidden: false,
    object,
  }
}

// A lifted region, in the plane: each arc `center + u cos t + v sin t` is
// already 2D, so its ellipse comes straight from its conjugate semi-diameters
// by the one closed form (silhouette.ts's ellipseFromConjugates).
function liftedRegion(boundary: readonly TrueShapePiece[], move: (p: Vec2) => Vec2): ProjectedEdge[] {
  return boundary.flatMap((piece, i): ProjectedEdge[] => {
    if (piece.kind === 'segment') return [{ kind: 'segment', a: move(piece.a), b: move(piece.b), hidden: false, vertices: [0, 0], object: `piece-${i}` }]
    const circle = ellipseFromConjugates(move(piece.center), piece.u, piece.v)
    return splitTurn(piece.from, piece.to).map(([from, to]) => arcEdge(circle, from, to, `piece-${i}`))
  })
}

// N1 — a net's flat piece as drawn edges: a segment as it is, an arc of a
// circle through the one ellipse closed form (a circle is the ellipse with
// equal conjugate semi-diameters), a whole turn as two halves.
function netEdges(piece: NetPiece, object: string): ProjectedEdge[] {
  if (piece.kind === 'segment') return [{ kind: 'segment', a: piece.a, b: piece.b, hidden: false, vertices: [0, 0], object }]
  const circle = ellipseFromConjugates(piece.center, { x: piece.radius, y: 0 }, { x: 0, y: piece.radius })
  return splitTurn(piece.from, piece.to).map(([from, to]) => arcEdge(circle, from, to, object))
}

function movePiece(piece: NetPiece, move: (p: Vec2) => Vec2): NetPiece {
  return piece.kind === 'segment' ? { kind: 'segment', a: move(piece.a), b: move(piece.b) } : { ...piece, center: move(piece.center) }
}

// Q6 — a cut's outline through the camera, each piece keeping whether the
// solid hides it.
//
// A side seen END-ON — along the view, as a box's side on a face edge-on to
// the front, side or top view is — projects to a point: nothing to draw, as a
// dimension reference seen end-on draws nothing (fix round 1). Without this
// it was a round-capped dot.
function projectedOutline(pieces: readonly OutlinePiece[], camera: Camera): ProjectedEdge[] {
  return pieces.flatMap(({ piece, hidden }, i) =>
    projectedRegion([piece], camera)
      .filter((edge) => edge.kind !== 'segment' || Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) > GEOM_EPS * Math.max(1, Math.hypot(edge.a.x, edge.a.y)))
      .map((edge) => ({ ...edge, hidden, object: `outline-${i}` }))
  )
}

// A region in space, through the camera: an arc is a circle's image under an
// orthographic camera, which projectCircle already draws from any two
// conjugate semi-diameters.
function projectedRegion(boundary: readonly SectionPiece[], camera: Camera): ProjectedEdge[] {
  return boundary.flatMap((piece, i): ProjectedEdge[] => {
    if (piece.kind === 'segment') {
      return [{ kind: 'segment', a: camera.project(piece.a), b: camera.project(piece.b), hidden: false, vertices: [0, 0], object: `piece-${i}` }]
    }
    const circle = projectCircle(camera, piece.center, piece.u, piece.v)
    return splitTurn(piece.from, piece.to).map(([from, to]) => arcEdge(circle, from, to, `piece-${i}`))
  })
}

// A convex region's interior, for the label layout: every exact extreme of
// its edges (chord ends, arc ends, and where an arc turns back in x or y) —
// all on its boundary — wound by angle about their centroid. The region is
// convex, so that winding is its boundary order and the polygon lies inside
// it: a bound on where the region is, never a sampling of its arcs.
function regionInterior(edges: readonly ProjectedEdge[]): Vec2[] {
  const points: Vec2[] = []
  for (const p of edges.flatMap(edgeExtremes)) {
    if (!points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= GEOM_EPS * Math.max(1, Math.hypot(p.x, p.y)))) points.push(p)
  }
  const centre = centroidOf(points)
  return points
    .map((p) => ({ p, angle: Math.atan2(p.y - centre.y, p.x - centre.x) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.p)
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

// Every point the figure is *anchored* to. An infinite line contributes
// nothing: it has no extent of its own, and letting it vote would mean a
// figure's size depended on the two arbitrary points that happened to define
// a locus.
function anchorPoints(items: readonly FigureItem[]): Vec2[] {
  const points: Vec2[] = []
  for (const item of items) {
    switch (item.kind) {
      case 'point':
        points.push(item.at)
        break
      case 'line':
        if (item.extent === 'segment') points.push(item.a, item.b)
        else points.push(item.a)
        break
      case 'dimensionReference':
        points.push(item.a, item.b)
        break
      case 'circle':
        points.push(
          { x: item.center.x - item.radius, y: item.center.y - item.radius },
          { x: item.center.x + item.radius, y: item.center.y + item.radius }
        )
        break
      case 'polygon':
        points.push(...item.vertices)
        break
      case 'solid':
        for (const edge of item.edges) points.push(...edgeExtremes(edge))
        break
      case 'solidVertex':
        points.push(item.at)
        break
      case 'region':
        for (const edge of item.edges) points.push(...edgeExtremes(edge))
        break
      case 'sectionFace':
        if (item.outline.kind === 'polygon') points.push(...item.outline.vertices)
        else if (item.outline.kind === 'region') for (const edge of item.outline.edges) points.push(...edgeExtremes(edge))
        else {
          const { center, rx, ry } = item.outline.circle
          // The ellipse's own bounding box, which is never smaller than the
          // section and never bigger than its axes allow.
          const half = Math.max(rx, ry)
          points.push({ x: center.x - half, y: center.y - half }, { x: center.x + half, y: center.y + half })
        }
        break
      case 'arc':
        points.push(...arcExtremes(item.arc))
        // A sector reaches the centre as well as the arc; a bare arc and a
        // circular segment do not.
        if (item.fill === 'sector') points.push(item.arc.center)
        break
      case 'centralAngle':
        // The mark is drawn inside the circle, which is already voting
        // through whatever drew it, so only the vertex is anchored here.
        points.push(item.arc.center)
        break
      case 'angleMark':
      case 'rightAngleMark':
        points.push(item.vertex)
        break
      case 'spaceArc':
        points.push(...edgeExtremes(item.edge))
        break
      case 'spaceRightAngle':
        points.push(...item.points)
        break
      case 'tickMark':
        points.push(item.from, item.to)
        break
      case 'net':
        for (const line of item.lines) points.push(...edgeExtremes(line.edge))
        break
      case 'netLabel':
        points.push(item.at)
        break
      case 'given':
        // The box is placed against the finished drawing, so it must not be
        // part of what decides how big the drawing is.
        break
      case 'measureLabel':
        // Anchored to geometry that already votes on the bounds — a midpoint,
        // a vertex, a centroid — so it adds nothing of its own. Its *box*
        // still grows the viewBox, through the placed-label rects in
        // renderFigure, exactly as a point's name does.
        break
    }
  }
  return points
}

// The exact bounding points of an arc: its two ends, plus whichever of the
// four cardinal points of its circle the sweep actually passes through.
//
// Exact rather than sampled, and it matters in both directions: a quarter arc
// bounded by its whole circle would leave most of the figure empty, and a
// three-quarter arc bounded by its endpoints alone would be cropped.
function arcExtremes(arc: Arc): Vec2[] {
  const points = [arcPointAt(arc, 0), arcPointAt(arc, 1)]
  for (let quarter = 0; quarter < 4; quarter++) {
    const angle = (quarter * Math.PI) / 2
    // How far round the arc's own direction of travel this cardinal angle is.
    const along = arc.sweep >= 0 ? angle - arc.start : arc.start - angle
    const wrapped = ((along % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (wrapped <= Math.abs(arc.sweep)) {
      points.push({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) })
    }
  }
  return points
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

// The point of a box closest to `p` — where a leader line meets the label it
// is drawn from. Clamping rather than intersecting the centre-to-anchor
// segment: it lands on the boundary for any anchor outside the box, and a
// leader from a box the anchor is inside has nowhere sensible to start.
function nearestOnRect(rect: Rect, p: Vec2): Vec2 {
  return {
    x: Math.max(rect.x, Math.min(p.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(p.y, rect.y + rect.height)),
  }
}

// M2 — the true angle of a refused right-angle mark, written to as many
// places as it takes to differ from 90: an angle 6e-6 degrees short of a
// right angle would otherwise print "90" in a message saying it is not 90
// (fix round 1). Three places when those already show the difference.
function nearRightAngle(degrees: number): string {
  for (let places = 3; places <= 15; places++) {
    const text = degrees.toFixed(places).replace(/\.?0+$/, '')
    if (Number(text) !== 90) return text
  }
  return String(degrees)
}

// M4 — a hidden mark is dashed and faded like a hidden edge.
function hiddenMark(): SvgAttrs {
  return { 'stroke-dasharray': AUXILIARY_DASH, opacity: AUXILIARY_OPACITY }
}

function identity(id: Identity): SvgAttrs {
  // E4 — every element says which statement and which named object produced
  // it, so the tutor layer can address it directly rather than inventing a
  // second lookup mechanism.
  return { 'data-statement': id.statement, 'data-object': id.object }
}

function strokeColor(color: string | null, fallback: number, palette: Palette): string {
  return cssColor(themedColor(color, fallback, palette))
}

function clipToBox(through: Vec2, direction: Vec2, extent: 'infinite' | 'ray', box: Rect): [Vec2, Vec2] | null {
  return clipLineToBounds(through, direction, extent, { xMin: box.x, xMax: box.x + box.width, yMin: box.y, yMax: box.y + box.height })
}

// The label obstacles of a figure, in view coordinates, exactly as
// renderFigure lays its labels out against them. Exported for the tests: what
// a label may not sit on is not visible in the markup until a label lands
// somewhere it should not.
export function figureLabelObstacles(statements: Statement[], config: GraphConfig): LabelObstacles {
  const { items } = buildItems(statements, config)
  const world: WorldBounds = boundsOf(anchorPoints(items)) ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  const projection = fitProjection(world)
  return labelObstacles(items, projection, geometryBounds(items, projection))
}

export function renderFigure(statements: Statement[], config: GraphConfig, palette: Palette): FigureResult {
  const { items, errors } = buildItems(statements, config)
  const theme = figureTheme(palette)

  const world: WorldBounds = boundsOf(anchorPoints(items)) ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  const projection = fitProjection(world)

  // Pass 1 — the geometry, in view coordinates. Labels are laid out against
  // this, then the viewBox is grown to contain both (E3).
  const geometryRect = geometryBounds(items, projection)
  const obstacles = labelObstacles(items, projection, geometryRect)
  const { anchors, sources } = labelAnchors(items, projection)
  const placed = layoutLabels(anchors, obstacles)

  const contentRect = unionRects([geometryRect, ...placed.map((label) => label.rect)])

  // The givens table is laid out against the finished drawing — geometry plus
  // its placed labels — and placed outside it, so the viewBox has to hold
  // both (E3).
  const givens = items.filter((item): item is Extract<FigureItem, { kind: 'given' }> => item.kind === 'given')
  const sections = givensSections(givens)
  const title = config.givensTitle ? layoutNotation([{ text: config.givensTitle, mark: 'none' }], LABEL_FONT_SIZE) : null
  const table =
    sections.length > 0
      ? layoutGivensTable(
          sections.map((section) => ({ heading: section.heading, rows: section.rows.map((row) => ({ cells: row.cells })) })),
          title,
          config.givens,
          contentRect
        )
      : null
  const viewBox = growRect(table ? unionRects([contentRect, table.box]) : contentRect, FIGURE_PADDING)

  // Pass 2 — emit. Infinite lines and rays are clipped here, against the
  // *final* viewBox, because how much of a locus to draw is a fact about the
  // view and not about the figure.
  const layers = emptyFigureLayers()
  for (const item of items) emit(item, projection, viewBox, theme, palette, layers)
  for (const label of placed) {
    // The anchor id is "<name>#<statement index>" (see labelAnchors), and the
    // source map carries E4's identity through the layout and back out.
    const source = sources.get(label.id)
    const statement = Number(label.id.slice(label.id.lastIndexOf('#') + 1))
    const id = source?.id ?? { statement, object: label.text }
    // **A leader is drawn exactly when the layout displaced the label** —
    // when it could not sit beside the edge it measures, in the direction it
    // asked for. A dimension that got its spot reads as belonging to that
    // edge and needs no line; one that was pushed elsewhere sits among eleven
    // other edges naming none of them. The layout decides, because only it
    // can tell a label that chose its place from one that was moved.
    if (source?.leader && label.displaced) {
      layers.marks.push(
        svgLine(nearestOnRect(label.rect, label.anchor), label.anchor, {
          stroke: strokeColor(source.color, palette.axis, palette),
          'stroke-width': STROKE_MARK,
          'stroke-linecap': 'round',
          ...identity({ statement: id.statement, object: `leader-${id.object ?? ''}` }),
        })
      )
    }
    if (source?.notation) {
      const layout = layoutNotation(source.notation, label.fontSize)
      const origin = notationOrigin(layout, label.at)
      layers.labels.push(
        ...notationElements(layout, origin, {
          fill: strokeColor(source.color, palette.axis, palette),
          fontFamily: FONT_FAMILY,
          identity: identity(id),
        })
      )
      continue
    }
    layers.labels.push(
      svgText(label.at, label.text, {
        'font-size': label.fontSize,
        'font-family': FONT_FAMILY,
        fill: theme.label,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        ...identity(id),
      })
    )
  }

  if (table) {
    layers.labels.push(
      `<rect${[
        ` x="${fmt(table.box.x)}"`,
        ` y="${fmt(table.box.y)}"`,
        ` width="${fmt(table.box.width)}"`,
        ` height="${fmt(table.box.height)}"`,
        ` fill="${theme.background}"`,
        ` stroke="${theme.ink}"`,
        ` stroke-width="${fmt(STROKE_MARK)}"`,
        ' data-object="givens"',
      ].join('')}/>`
    )
    // The title and the section headings carry no data-object: they belong to
    // the table rather than to any statement or any drawn object, and E4's
    // identity is for things the tutor layer can point at.
    if (title && table.title) {
      layers.labels.push(...notationElements(title, table.title, { fill: theme.label, fontFamily: FONT_FAMILY }))
    }
    for (const [s, section] of sections.entries()) {
      const placed = table.sections[s]
      layers.labels.push(...notationElements(section.heading, placed.heading, { fill: theme.label, fontFamily: FONT_FAMILY }))
      for (const [r, row] of section.rows.entries()) {
        for (const [c, cell] of row.cells.entries()) {
          layers.labels.push(
            ...notationElements(cell, placed.rows[r][c], {
              fill: strokeColor(row.color, palette.axis, palette),
              fontFamily: FONT_FAMILY,
              identity: identity(row.id),
            })
          )
        }
      }
    }
  }

  return { svg: figureDocument(layers, viewBox, theme), errors }
}

// The table's sections, in a fixed order and with their rows laid out.
//
// Fixed rather than first-seen: "Given" then "Find" is the order a problem is
// written in, and an author who interleaves the two statements should still
// get the table a reader expects rather than a record of their typing order.
const GIVENS_SECTIONS: { name: GivensSection; heading: string }[] = [
  { name: 'given', heading: 'GIVEN' },
  { name: 'find', heading: 'FIND' },
]

interface GivensSectionModel {
  heading: NotationLayout
  rows: { id: Identity; color: string | null; cells: NotationLayout[] }[]
}

function givensSections(givens: readonly Extract<FigureItem, { kind: 'given' }>[]): GivensSectionModel[] {
  const models: GivensSectionModel[] = []
  for (const section of GIVENS_SECTIONS) {
    const rows = givens.filter((item) => item.section === section.name)
    if (rows.length === 0) continue
    models.push({
      // Set in capitals rather than in bold: a heading has to be
      // distinguishable from the rows under it, and the one thing the layout
      // cannot do is measure a weight it does not have metrics for.
      heading: layoutNotation([{ text: section.heading, mark: 'none' }], LABEL_FONT_SIZE),
      rows: rows.map((item) => {
        return { id: item.id, color: item.color, cells: item.cells.map((cell) => layoutNotation(cell, LABEL_FONT_SIZE)) }
      }),
    })
  }
  return models
}

function geometryBounds(items: readonly FigureItem[], projection: Projection): Rect {
  const view = anchorPoints(items).map((p) => projection.toView(p))
  const bounds = boundsOf(view)
  if (!bounds) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
}

// The radius the angle mark at `item` is drawn with, in view units. Shared by
// the emitter and the label layout so that the arc a reader sees and the arc a
// label avoids are the same circle.
function angleArcRadius(item: Extract<FigureItem, { kind: 'angleMark' }>, projection: Projection): number {
  const vertex = projection.toView(item.vertex)
  const from = projection.toView(item.from)
  const to = projection.toView(item.to)
  const legLength = Math.min(Math.hypot(from.x - vertex.x, from.y - vertex.y), Math.hypot(to.x - vertex.x, to.y - vertex.y))
  return Math.min(ANGLE_ARC_RADIUS, legLength * ANGLE_ARC_MAX_FRACTION)
}

function labelObstacles(items: readonly FigureItem[], projection: Projection, geometryRect: Rect): LabelObstacles {
  const obstacles = noObstacles()
  // A locus has to be clipped to *something* before it can be an obstacle.
  // The geometry rect is the honest choice: it is what the figure occupies
  // before labels push the box out, so a label is kept off the part of the
  // line that crosses the drawing.
  const probe = growRect(geometryRect, FIGURE_PADDING)
  for (const item of items) {
    if (item.kind === 'dimensionReference') {
      obstacles.segments.push([projection.toView(item.a), projection.toView(item.b)])
    } else if (item.kind === 'line') {
      const a = projection.toView(item.a)
      const b = projection.toView(item.b)
      if (item.extent === 'segment') obstacles.segments.push([a, b])
      else {
        const clipped = clipToBox(a, { x: b.x - a.x, y: b.y - a.y }, item.extent, probe)
        if (clipped) obstacles.segments.push(clipped)
      }
    } else if (item.kind === 'circle') {
      obstacles.circles.push({ center: projection.toView(item.center), radius: item.radius * projection.scale })
    } else if (item.kind === 'angleMark') {
      // The arc is an obstacle like any other stroke. It is not enough to
      // push a measure label's anchor out past it: the layout is free to
      // choose a candidate pointing back at the vertex, and a number written
      // across its own angle arc is unreadable. Pushing sets where the label
      // starts looking; this is what stops it landing on the ink.
      obstacles.circles.push({ center: projection.toView(item.vertex), radius: angleArcRadius(item, projection) })
    } else if (item.kind === 'spaceArc') {
      // Bounded by the chords between its exact extremes, as a solid's arc.
      const points = edgeExtremes(item.edge).map((point) => projection.toView(point))
      for (let i = 0; i + 1 < points.length; i++) obstacles.segments.push([points[i], points[i + 1]])
    } else if (item.kind === 'spaceRightAngle') {
      const [a, b, c] = item.points.map((point) => projection.toView(point))
      obstacles.segments.push([a, b], [b, c])
    } else if (item.kind === 'solid' || item.kind === 'region' || (item.kind === 'sectionFace' && item.outline.kind === 'region')) {
      // An arc is an obstacle too, approximated for the label layout by the
      // chords between its exact extremes — a bound on where the ink is, not
      // a sampling of the curve, which is why it never reaches the emitter.
      const edges = item.kind === 'sectionFace' ? (item.outline.kind === 'region' ? item.outline.edges : []) : item.edges
      for (const edge of edges) {
        const points = edgeExtremes(edge).map((point) => projection.toView(point))
        for (let i = 0; i + 1 < points.length; i++) obstacles.segments.push([points[i], points[i + 1]])
      }
      // A LIFTED region keeps labels out of its interior, as a lifted
      // polygon does (fix round 1): the convex polygon of its exact extremes.
      if (item.kind === 'region') obstacles.polygons.push(regionInterior(edges).map((point) => projection.toView(point)))
    } else if (item.kind === 'net') {
      // Its lines are strokes a label keeps off. Its faces are NOT shapes a
      // label is kept out of, unlike a lifted polygon's: a path's ends sit
      // inside faces, and their letters belong beside them. A vertex letter
      // is pointed outward by its own preference instead.
      for (const { edge } of item.lines) {
        const points = edgeExtremes(edge).map((point) => projection.toView(point))
        for (let i = 0; i + 1 < points.length; i++) obstacles.segments.push([points[i], points[i + 1]])
      }
    } else if (item.kind === 'sectionFace' && item.outline.kind === 'polygon') {
      const vertices = item.outline.vertices.map((v) => projection.toView(v))
      for (let i = 0; i < vertices.length; i++) obstacles.segments.push([vertices[i], vertices[(i + 1) % vertices.length]])
    } else if (item.kind === 'polygon') {
      const vertices = item.vertices.map((v) => projection.toView(v))
      obstacles.polygons.push(vertices)
      for (let i = 0; i < vertices.length; i++) obstacles.segments.push([vertices[i], vertices[(i + 1) % vertices.length]])
    }
  }
  return obstacles
}

// What a placed label needs at emission time that the layout does not carry:
// which statement produced it, and — for a measure label — the notation runs
// to draw instead of a plain string.
interface LabelSource {
  id: Identity
  notation: NotationRun[] | null
  color: string | null
  // Whether a leader line is drawn when the layout displaces this label.
  leader?: boolean
}

function labelAnchors(
  items: readonly FigureItem[],
  projection: Projection
): { anchors: LabelAnchor[]; sources: Map<string, LabelSource> } {
  const anchors: LabelAnchor[] = []
  const sources = new Map<string, LabelSource>()
  for (const item of items) {
    // The id is unique per emitted label even when two points share a name,
    // which keeps the layout's tie-break total.
    if (item.kind === 'point' && item.label) {
      const id = `${item.label}#${item.id.statement}`
      anchors.push({
        id,
        text: item.label,
        at: projection.toView(item.at),
        fontSize: LABEL_FONT_SIZE,
        prefer: item.prefer,
      })
      sources.set(id, { id: item.id, notation: null, color: item.color })
    } else if (item.kind === 'netLabel') {
      // One letter at several copies in one statement: the copy keeps the id
      // unique, and the statement stays after the last "#".
      const id = `${item.label}.${item.copy}#${item.id.statement}`
      anchors.push({ id, text: item.label, at: projection.toView(item.at), fontSize: LABEL_FONT_SIZE, prefer: item.prefer })
      sources.set(id, { id: item.id, notation: null, color: item.color })
    } else if (item.kind === 'solidVertex') {
      const id = `${item.label}#${item.id.statement}`
      anchors.push({ id, text: item.label, at: projection.toView(item.at), fontSize: LABEL_FONT_SIZE, prefer: item.prefer })
      sources.set(id, { id: item.id, notation: null, color: item.color })
    } else if (item.kind === 'measureLabel') {
      const layout = layoutNotation(item.runs, LABEL_FONT_SIZE)
      const at = projection.toView(item.at)
      const id = `${item.id.object ?? ''}#${item.id.statement}`
      anchors.push({
        id,
        text: item.runs.map((run) => run.text).join(''),
        at,
        fontSize: LABEL_FONT_SIZE,
        prefer: item.push,
        // Notation is taller than its own glyphs, and the layout must keep
        // other labels off the overbar, not just off the letters.
        size: { width: layout.width, height: layout.height },
        mayEnterShapes: item.inside,
      })
      sources.set(id, { id: item.id, notation: item.runs, color: item.color, leader: item.leader })
    }
  }
  return { anchors, sources }
}

function emit(item: FigureItem, projection: Projection, viewBox: Rect, theme: FigureTheme, palette: Palette, layers: ReturnType<typeof emptyFigureLayers>): void {
  const to = (p: Vec2) => projection.toView(p)
  switch (item.kind) {
    case 'point': {
      layers.points.push(
        svgCircle(to(item.at), POINT_RADIUS, { fill: strokeColor(item.color, palette.point, palette), stroke: 'none', ...identity(item.id) })
      )
      break
    }
    case 'dimensionReference':
      // Thin, in the auxiliary layer, dashed only where the solid hides it.
      layers.auxiliary.push(
        svgLine(to(item.a), to(item.b), {
          stroke: strokeColor(item.color, palette.axis, palette),
          'stroke-width': STROKE_AUXILIARY,
          'stroke-linecap': 'round',
          'stroke-dasharray': item.hidden ? AUXILIARY_DASH : null,
          opacity: item.hidden ? AUXILIARY_OPACITY : null,
          ...identity(item.id),
        })
      )
      break
    case 'line': {
      const a = to(item.a)
      const b = to(item.b)
      const style: SvgAttrs = {
        stroke: strokeColor(item.color, palette.axis, palette),
        'stroke-width': item.auxiliary ? STROKE_AUXILIARY : STROKE_PRIMARY,
        'stroke-linecap': 'round',
        'stroke-dasharray': item.auxiliary ? AUXILIARY_DASH : null,
        opacity: item.auxiliary ? AUXILIARY_OPACITY : null,
        ...identity(item.id),
      }
      if (item.extent === 'segment') {
        layers[item.auxiliary ? 'auxiliary' : 'primary'].push(svgLine(a, b, style))
        break
      }
      const clipped = clipToBox(a, { x: b.x - a.x, y: b.y - a.y }, item.extent, viewBox)
      if (clipped) layers[item.auxiliary ? 'auxiliary' : 'primary'].push(svgLine(clipped[0], clipped[1], style))
      break
    }
    case 'circle': {
      layers.primary.push(
        svgCircle(to(item.center), item.radius * projection.scale, {
          fill: 'none',
          stroke: strokeColor(item.color, palette.axis, palette),
          'stroke-width': STROKE_PRIMARY,
          ...identity(item.id),
        })
      )
      break
    }
    case 'arc': {
      const center = to(item.arc.center)
      const radius = item.arc.radius * projection.scale
      // View space flips y, so a counter-clockwise sweep in the plane is a
      // clockwise one on the page. Negating both angles converts the whole
      // arc at once, and keeps the large-arc and sweep flags svg.ts derives
      // from them correct for a reflex arc.
      const start = -item.arc.start
      const end = -(item.arc.start + item.arc.sweep)
      const stroke = strokeColor(item.color, palette.axis, palette)
      if (item.fill === 'none') {
        layers.primary.push(
          svgArc(center, radius, start, end, { fill: 'none', stroke, 'stroke-width': STROKE_PRIMARY, 'stroke-linecap': 'round', ...identity(item.id) })
        )
        break
      }
      const fill: SvgAttrs = {
        fill: theme.region,
        'fill-opacity': REGION_OPACITY,
        stroke,
        'stroke-width': STROKE_PRIMARY,
        ...identity(item.id),
      }
      // E1 — a fill is a backdrop, so both regions go in the regions layer,
      // behind every line and mark the figure draws over them.
      layers.regions.push(
        item.fill === 'sector' ? svgSector(center, radius, start, end, fill) : svgCircularSegment(center, radius, start, end, fill)
      )
      break
    }
    case 'centralAngle': {
      const vertex = to(item.arc.center)
      const radius = Math.min(ANGLE_ARC_RADIUS, item.arc.radius * projection.scale * CENTRAL_ANGLE_MAX_FRACTION)
      const start = -item.arc.start
      const end = -(item.arc.start + item.arc.sweep)
      const stroke = strokeColor(item.color, palette.axis, palette)
      layers.marks.push(svgArc(vertex, radius, start, end, { fill: 'none', stroke, 'stroke-width': STROKE_MARK, ...identity(item.id) }))
      const mid = (start + end) / 2
      const at = { x: vertex.x + (radius + LABEL_FONT_SIZE) * Math.cos(mid), y: vertex.y + (radius + LABEL_FONT_SIZE) * Math.sin(mid) }
      layers.labels.push(
        svgText(at, item.label, {
          'font-size': LABEL_FONT_SIZE,
          'font-family': FONT_FAMILY,
          fill: theme.label,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          ...identity(item.id),
        })
      )
      break
    }
    case 'solid': {
      const stroke = strokeColor(item.color, palette.axis, palette)
      for (const edge of item.edges) {
        const style: SvgAttrs = {
          stroke,
          'stroke-width': edge.hidden ? STROKE_AUXILIARY : STROKE_PRIMARY,
          'stroke-linecap': 'round',
          'stroke-dasharray': edge.hidden ? AUXILIARY_DASH : null,
          opacity: edge.hidden ? AUXILIARY_OPACITY : null,
          'data-statement': item.id.statement,
          'data-object': edgeObject(edge),
        }
        // E1 — a hidden edge goes BEHIND every visible one, so the solid
        // stroke covers the dashes where they cross rather than the other
        // way round. Both members of the drawn-edge union go through
        // drawEdge, which is the one place either becomes markup.
        layers[edge.hidden ? 'auxiliary' : 'primary'].push(drawEdge(edge, projection.toView, projection.scale, style))
      }
      break
    }
    case 'solidVertex':
    case 'netLabel':
      // Emitted with the other labels, after the layout has placed them.
      break
    case 'net': {
      // N1 — a fold is dashed and drawn beneath; a cut edge is solid.
      const stroke = strokeColor(item.color, palette.axis, palette)
      for (const { edge, fold } of item.lines) {
        layers[fold ? 'auxiliary' : 'primary'].push(
          drawEdge(edge, projection.toView, projection.scale, {
            stroke,
            'stroke-width': fold ? STROKE_AUXILIARY : STROKE_PRIMARY,
            'stroke-linecap': 'round',
            'stroke-dasharray': fold ? AUXILIARY_DASH : null,
            'data-statement': item.id.statement,
            'data-object': edgeObject(edge),
          })
        )
      }
      break
    }
    case 'sectionFace': {
      const stroke = strokeColor(item.color, palette.axis, palette)
      // The fill is unstroked: its outline is drawn below, piece by piece,
      // visible or hidden (Q6).
      const fill: SvgAttrs = {
        fill: theme.region,
        'fill-opacity': REGION_OPACITY,
        ...identity(item.id),
      }
      for (const edge of item.edges) {
        layers[edge.hidden ? 'auxiliary' : 'primary'].push(
          drawEdge(edge, projection.toView, projection.scale, {
            stroke,
            'stroke-width': edge.hidden ? STROKE_AUXILIARY : STROKE_PRIMARY,
            'stroke-linecap': 'round',
            'stroke-dasharray': edge.hidden ? AUXILIARY_DASH : null,
            opacity: edge.hidden ? AUXILIARY_OPACITY : null,
            ...identity(item.id),
          })
        )
      }
      // E1 — a fill is a backdrop, so the shaded face goes in the regions
      // layer, behind every edge of the solid it cuts. A cut drawn over the
      // solid's own lines would hide the thing it is a section OF.
      if (item.outline.kind === 'polygon') {
        layers.regions.push(svgPolygon(item.outline.vertices.map(to), fill))
        break
      }
      if (item.outline.kind === 'region') {
        layers.regions.push(drawClosedEdges(item.outline.edges, projection.toView, projection.scale, fill))
        break
      }
      const circle = item.outline.circle
      layers.regions.push(
        svgEllipse(to(circle.center), circle.rx * projection.scale, circle.ry * projection.scale, -circle.rotation, fill)
      )
      break
    }
    case 'region': {
      const stroke = strokeColor(item.color, palette.axis, palette)
      for (const edge of item.edges) {
        layers.primary.push(
          drawEdge(edge, projection.toView, projection.scale, { stroke, 'stroke-width': STROKE_PRIMARY, 'stroke-linecap': 'round', ...identity(item.id) })
        )
      }
      break
    }
    case 'polygon': {
      const vertices = item.vertices.map(to)
      const stroke = strokeColor(item.color, palette.axis, palette)
      for (let i = 0; i < vertices.length; i++) {
        layers.primary.push(
          svgLine(vertices[i], vertices[(i + 1) % vertices.length], {
            stroke,
            'stroke-width': STROKE_PRIMARY,
            'stroke-linecap': 'round',
            ...identity(item.id),
          })
        )
      }
      break
    }
    case 'angleMark': {
      const vertex = to(item.vertex)
      const from = to(item.from)
      const to2 = to(item.to)
      const radius = angleArcRadius(item, projection)
      const { start, delta } = angleSweep(vertex, from, to2)
      const stroke = strokeColor(item.color, palette.axis, palette)
      layers.marks.push(svgArc(vertex, radius, start, start + delta, { fill: 'none', stroke, 'stroke-width': STROKE_MARK, ...identity(item.id) }))
      if (item.label) {
        const mid = start + delta / 2
        const at = { x: vertex.x + (radius + LABEL_FONT_SIZE) * Math.cos(mid), y: vertex.y + (radius + LABEL_FONT_SIZE) * Math.sin(mid) }
        layers.labels.push(
          svgText(at, item.label, {
            'font-size': LABEL_FONT_SIZE,
            'font-family': FONT_FAMILY,
            fill: theme.label,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            ...identity(item.id),
          })
        )
      }
      break
    }
    case 'tickMark': {
      const from = to(item.from)
      const target = to(item.to)
      const segLength = Math.hypot(target.x - from.x, target.y - from.y)
      const length = Math.min(TICK_LENGTH, segLength * TICK_MAX_FRACTION)
      const gap = Math.min(TICK_GAP, segLength * TICK_MAX_FRACTION)
      const stroke = strokeColor(item.color, palette.axis, palette)
      for (const [a, b] of tickMarkSegments(from, target, item.count, length, gap)) {
        // M4 — a tick on a hidden stretch of a segment in space is dashed
        // like a hidden edge, beneath the visible lines. Plane ticks carry no
        // `hidden` and keep their bytes.
        if (item.hidden) {
          layers.auxiliary.push(svgLine(a, b, { stroke, 'stroke-width': STROKE_MARK, 'stroke-linecap': 'round', ...hiddenMark(), ...identity(item.id) }))
          continue
        }
        layers.marks.push(svgLine(a, b, { stroke, 'stroke-width': STROKE_MARK, 'stroke-linecap': 'round', ...identity(item.id) }))
      }
      break
    }
    case 'spaceArc': {
      const stroke = strokeColor(item.color, palette.axis, palette)
      const style: SvgAttrs = { stroke, 'stroke-width': STROKE_MARK, ...(item.hidden ? hiddenMark() : {}), ...identity(item.id) }
      layers[item.hidden ? 'auxiliary' : 'marks'].push(drawEdge(item.edge, projection.toView, projection.scale, style))
      if (item.text) {
        // As the plane writes an "angle: … label:" caption: a font size out
        // from the arc, along the bisector.
        const anchor = to(item.text.at)
        const push = item.text.push ?? { x: 0, y: 0 }
        const at = { x: anchor.x + LABEL_FONT_SIZE * push.x, y: anchor.y + LABEL_FONT_SIZE * push.y }
        layers.labels.push(
          svgText(at, item.text.label, {
            'font-size': LABEL_FONT_SIZE,
            'font-family': FONT_FAMILY,
            fill: theme.label,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            ...identity(item.id),
          })
        )
      }
      break
    }
    case 'spaceRightAngle': {
      const stroke = strokeColor(item.color, palette.axis, palette)
      layers[item.hidden ? 'auxiliary' : 'marks'].push(
        svgPolyline(item.points.map(to), { fill: 'none', stroke, 'stroke-width': STROKE_MARK, ...(item.hidden ? hiddenMark() : {}), ...identity(item.id) })
      )
      break
    }
    case 'measureLabel':
      // Emitted with the other labels, after the layout has placed them.
      break
    case 'given':
      // Emitted with the box, after the content rect is known.
      break
    case 'rightAngleMark': {
      const vertex = to(item.vertex)
      const from = to(item.from)
      const target = to(item.to)
      const legLength = Math.min(Math.hypot(from.x - vertex.x, from.y - vertex.y), Math.hypot(target.x - vertex.x, target.y - vertex.y))
      const size = Math.min(RIGHT_ANGLE_SIZE, legLength * RIGHT_ANGLE_MAX_FRACTION)
      const stroke = strokeColor(item.color, palette.axis, palette)
      layers.marks.push(
        svgPolyline(rightAngleSquarePoints(vertex, from, target, size), {
          fill: 'none',
          stroke,
          'stroke-width': STROKE_MARK,
          ...identity(item.id),
        })
      )
      break
    }
  }
}

