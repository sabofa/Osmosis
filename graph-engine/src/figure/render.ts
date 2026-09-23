import type { GraphConfig } from '../parser/config'
import { evalExpr, type FunctionTable } from '../parser/evalExpr'
import type { Expr, GivenEntry, MeasureContent, MeasureSubject, Statement } from '../parser/types'
import { angleSweep, rightAngleSquarePoints, tickMarkSegments } from '../render/geometryMarks'
import { clipLineToBounds } from '../render/clipLine'
import { type Palette, themedColor } from '../render/palette'
import { buildConstructions } from '../scene/geometry/buildConstructions'
import type { GeometryObject, LineExtent } from '../scene/geometry/objects'
import type { SceneError, Vec2 } from '../scene/types'
import {
  boundsOf,
  cssColor,
  emptyFigureLayers,
  FIGURE_PADDING,
  figureDocument,
  figureTheme,
  fitProjection,
  growRect,
  layoutGivensBox,
  unionRects,
  type FigureTheme,
  type Projection,
  type Rect,
  type WorldBounds,
} from './document'
import { LABEL_FONT_SIZE, layoutLabels, noObstacles, type LabelAnchor, type LabelObstacles } from './labels'
import { angleMeasure, checkMeasure, formatAngleMeasure, formatMeasure, segmentLength } from './measure'
import { layoutNotation, notationElements, notationOrigin, type NotationRun } from './notation'
import { fmt, svgArc, svgCircle, svgLine, svgPolyline, svgText, type SvgAttrs } from './svg'

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
  | { kind: 'circle'; id: Identity; center: Vec2; radius: number; color: string | null }
  | { kind: 'polygon'; id: Identity; vertices: Vec2[]; color: string | null }
  | { kind: 'angleMark'; id: Identity; vertex: Vec2; from: Vec2; to: Vec2; label: string | null; color: string | null }
  | { kind: 'tickMark'; id: Identity; from: Vec2; to: Vec2; count: number; color: string | null }
  | { kind: 'rightAngleMark'; id: Identity; vertex: Vec2; from: Vec2; to: Vec2; color: string | null }
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
      runs: NotationRun[]
      color: string | null
    }
  // A line of the boxed givens panel. It has no position of its own: where
  // the box goes is decided against the finished drawing, after the labels
  // have been placed and the content rect is known.
  | { kind: 'given'; id: Identity; runs: NotationRun[]; color: string | null }

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

function collectNamedPoints(statements: Statement[], config: GraphConfig, functions: FunctionTable): Map<string, Vec2> {
  const points = new Map<string, Vec2>()
  const value = (e: Expr) => evalExpr(e, {}, config.angle, functions)
  for (const statement of statements) {
    try {
      if (statement.kind === 'point' && statement.label) {
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
      // Every line a construction *produces* is scaffolding — a parallel, a
      // perpendicular, a perpendicular bisector, an angle bisector. They are
      // loci the author reasoned with rather than edges of the figure, which
      // is exactly what "auxiliary" means, and at competition density they
      // routinely outnumber the figure itself.
      return [{ kind: 'line', id, a: object.a, b: object.b, extent: object.extent, auxiliary: true, color }]
  }
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
  }
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
  const asText = (value: number) =>
    subject.kind === 'angle' ? formatAngleMeasure(value, config.angle) : formatMeasure(value)

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
        subject.kind === 'length'
          ? `${subject.from}${subject.to}`
          : subject.kind === 'angle'
            ? `${subject.from}${subject.vertex}${subject.to}`
            : subject.names.join('')
      // The prefix is a character (△), not a mark: it is set beside the name
      // rather than drawn over it, so it belongs in the same run.
      return { runs: [{ text: content.prefix + names, mark: content.mark }], error: null }
    }
  }
}

// One line of the box. A measure is checked exactly as an inline label is —
// the box is a different place to write a given, not a different standard of
// truth — and a relation states a fact about the figure that the construction
// layer has no single number to compare against, so it is written and not
// checked.
function givenRuns(
  entry: GivenEntry,
  resolve: (name: string) => Vec2,
  config: GraphConfig
): { runs: NotationRun[]; error: string | null } {
  if (entry.kind === 'relation') {
    for (const side of [entry.left, entry.right]) measureOf(side, resolve, config)
    return {
      runs: [...subjectRuns(entry.left), { text: ` ${entry.symbol} `, mark: 'none' }, ...subjectRuns(entry.right)],
      error: null,
    }
  }

  const computed = measureOf(entry.subject, resolve, config)
  const value = measureRuns(entry.subject, entry.content, computed, config)
  // One run for "= 8", not two: a measure's own runs never carry a mark, so
  // splitting the equals sign from the value would buy nothing and would put
  // a text-element boundary in the middle of a printed equation.
  const stated = { text: ` = ${value.runs.map((run) => run.text).join('')}`, mark: 'none' as const }
  return { runs: [...subjectRuns(entry.subject), stated], error: value.error }
}

// The number a subject measures to, or null when the subject is a shape
// rather than a measurement. Resolving the names is the point even for a
// shape: a given naming a point that does not exist is a broken spec, and
// finding that out here is what turns it into a legible error.
function measureOf(subject: MeasureSubject, resolve: (name: string) => Vec2, config: GraphConfig): number | null {
  switch (subject.kind) {
    case 'length':
      return segmentLength(resolve(subject.from), resolve(subject.to))
    case 'angle':
      return angleMeasure(resolve(subject.vertex), resolve(subject.from), resolve(subject.to), config.angle)
    case 'triangle':
      for (const name of subject.names) resolve(name)
      return null
  }
}

function buildItems(statements: Statement[], config: GraphConfig): { items: FigureItem[]; errors: SceneError[] } {
  const functions = collectFunctions(statements)
  const namedPoints = collectNamedPoints(statements, config, functions)
  const constructions = buildConstructions(statements, config, functions, namedPoints)
  for (const [name, position] of constructions.points) namedPoints.set(name, position)

  const items: FigureItem[] = []
  const errors: SceneError[] = [...constructions.errors]
  // Measure labels are built in a second pass: where one sits depends on
  // where the rest of the figure is (a side's label goes on the outside),
  // and that is only known once every other item exists.
  const measureStatements: { statement: Statement; index: number }[] = []
  const givenStatements: { statement: Statement; index: number }[] = []
  const value = (e: Expr) => evalExpr(e, {}, config.angle, functions)

  function resolve(name: string): Vec2 {
    const point = namedPoints.get(name)
    if (!point) throw new Error(`Unknown point "${name}" — define it with a point statement (e.g. "${name} = (x, y)") or as a polygon vertex first`)
    return point
  }

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.statementName && config.hidden.has(statement.statementName)) continue
    const id = { statement: index, object: null as string | null }
    try {
      switch (statement.kind) {
        case 'point':
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
          const a = { x: value(statement.x1), y: value(statement.y1) }
          const b = { x: value(statement.x2), y: value(statement.y2) }
          items.push({ kind: 'line', id, a, b, extent: statement.kind === 'ray' ? 'ray' : 'segment', auxiliary: false, color: statement.color })
          break
        }
        case 'namedSegment': {
          const a = resolve(statement.from)
          const b = resolve(statement.to)
          items.push({ kind: 'line', id, a, b, extent: 'segment', auxiliary: statement.dashed, color: statement.color })
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
        case 'construction': {
          for (const built of constructions.geometryByStatement.get(index) ?? []) {
            items.push(...geometryItems(built.object, built.name, { statement: index, object: built.name }, statement.color))
          }
          break
        }
        case 'angle':
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
        case 'tick':
          items.push({ kind: 'tickMark', id, from: resolve(statement.from), to: resolve(statement.to), count: statement.count, color: statement.color })
          break
        case 'rightAngle':
          items.push({
            kind: 'rightAngleMark',
            id: { statement: index, object: statement.vertex },
            vertex: resolve(statement.vertex),
            from: resolve(statement.from),
            to: resolve(statement.to),
            color: statement.color,
          })
          break
        case 'measureLabel':
          measureStatements.push({ statement, index })
          break
        case 'given':
          givenStatements.push({ statement, index })
          break
        default:
          break
      }
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  for (const { statement, index } of givenStatements) {
    if (statement.kind !== 'given') continue
    try {
      const { runs, error } = givenRuns(statement.entry, resolve, config)
      if (error) errors.push({ line: 0, message: error })
      items.push({ kind: 'given', id: { statement: index, object: null }, runs, color: statement.color })
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
      const inside = subject.kind === 'angle'
      if (subject.kind === 'length') {
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
      } else {
        const vertices = subject.names.map((name) => resolve(name))
        at = centroidOf(vertices)
        push = null
      }
      const { runs, error } = measureRuns(subject, content, computed, config)
      if (error) errors.push({ line: 0, message: error })
      items.push({
        kind: 'measureLabel',
        id: { statement: index, object: subjectName(subject) },
        at,
        push,
        inside,
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
      case 'circle':
        points.push(
          { x: item.center.x - item.radius, y: item.center.y - item.radius },
          { x: item.center.x + item.radius, y: item.center.y + item.radius }
        )
        break
      case 'polygon':
        points.push(...item.vertices)
        break
      case 'angleMark':
      case 'rightAngleMark':
        points.push(item.vertex)
        break
      case 'tickMark':
        points.push(item.from, item.to)
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

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

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

  // The givens box is laid out against the finished drawing — geometry plus
  // its placed labels — and placed outside it, so the viewBox has to hold
  // both (E3).
  const givens = items.filter((item): item is Extract<FigureItem, { kind: 'given' }> => item.kind === 'given')
  const givenLayouts = givens.map((item) => layoutNotation(item.runs, LABEL_FONT_SIZE))
  const givensBox = givenLayouts.length > 0 ? layoutGivensBox(givenLayouts, config.givens, contentRect) : null
  const viewBox = growRect(givensBox ? unionRects([contentRect, givensBox.box]) : contentRect, FIGURE_PADDING)

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

  if (givensBox) {
    layers.labels.push(
      `<rect${[
        ` x="${fmt(givensBox.box.x)}"`,
        ` y="${fmt(givensBox.box.y)}"`,
        ` width="${fmt(givensBox.box.width)}"`,
        ` height="${fmt(givensBox.box.height)}"`,
        ` fill="${theme.background}"`,
        ` stroke="${theme.ink}"`,
        ` stroke-width="${fmt(STROKE_MARK)}"`,
        ' data-object="givens"',
      ].join('')}/>`
    )
    for (let i = 0; i < givens.length; i++) {
      layers.labels.push(
        ...notationElements(givenLayouts[i], givensBox.rows[i], {
          fill: strokeColor(givens[i].color, palette.axis, palette),
          fontFamily: FONT_FAMILY,
          identity: identity(givens[i].id),
        })
      )
    }
  }

  return { svg: figureDocument(layers, viewBox, theme), errors }
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
    if (item.kind === 'line') {
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
      sources.set(id, { id: item.id, notation: item.runs, color: item.color })
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
        layers.marks.push(svgLine(a, b, { stroke, 'stroke-width': STROKE_MARK, 'stroke-linecap': 'round', ...identity(item.id) }))
      }
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

