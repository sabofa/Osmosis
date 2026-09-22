import type { GraphConfig } from '../parser/config'
import { evalExpr, type FunctionTable } from '../parser/evalExpr'
import type { Expr, Statement } from '../parser/types'
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
  unionRects,
  type FigureTheme,
  type Projection,
  type Rect,
  type WorldBounds,
} from './document'
import { LABEL_FONT_SIZE, layoutLabels, noObstacles, type LabelAnchor, type LabelObstacles } from './labels'
import { svgArc, svgCircle, svgLine, svgPolyline, svgText, type SvgAttrs } from './svg'

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

function buildItems(statements: Statement[], config: GraphConfig): { items: FigureItem[]; errors: SceneError[] } {
  const functions = collectFunctions(statements)
  const namedPoints = collectNamedPoints(statements, config, functions)
  const constructions = buildConstructions(statements, config, functions, namedPoints)
  for (const [name, position] of constructions.points) namedPoints.set(name, position)

  const items: FigureItem[] = []
  const errors: SceneError[] = [...constructions.errors]
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
        default:
          break
      }
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
  const anchors = labelAnchors(items, projection)
  const placed = layoutLabels(anchors, obstacles)

  const contentRect = unionRects([geometryRect, ...placed.map((label) => label.rect)])
  const viewBox = growRect(contentRect, FIGURE_PADDING)

  // Pass 2 — emit. Infinite lines and rays are clipped here, against the
  // *final* viewBox, because how much of a locus to draw is a fact about the
  // view and not about the figure.
  const layers = emptyFigureLayers()
  for (const item of items) emit(item, projection, viewBox, theme, palette, layers)
  for (const label of placed) {
    // The anchor id is "<name>#<statement index>" (see labelAnchors), which
    // is what carries E4's identity through the layout and back out.
    const statement = Number(label.id.slice(label.id.lastIndexOf('#') + 1))
    layers.labels.push(
      svgText(label.at, label.text, {
        'font-size': label.fontSize,
        'font-family': FONT_FAMILY,
        fill: theme.label,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        ...identity({ statement, object: label.text }),
      })
    )
  }

  return { svg: figureDocument(layers, viewBox, theme), errors }
}

function geometryBounds(items: readonly FigureItem[], projection: Projection): Rect {
  const view = anchorPoints(items).map((p) => projection.toView(p))
  const bounds = boundsOf(view)
  if (!bounds) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
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
    } else if (item.kind === 'polygon') {
      const vertices = item.vertices.map((v) => projection.toView(v))
      obstacles.polygons.push(vertices)
      for (let i = 0; i < vertices.length; i++) obstacles.segments.push([vertices[i], vertices[(i + 1) % vertices.length]])
    }
  }
  return obstacles
}

function labelAnchors(items: readonly FigureItem[], projection: Projection): LabelAnchor[] {
  const anchors: LabelAnchor[] = []
  for (const item of items) {
    if (item.kind !== 'point' || !item.label) continue
    // The id is unique per emitted label even when two points share a name,
    // which keeps the layout's tie-break total.
    anchors.push({
      id: `${item.label}#${item.id.statement}`,
      text: item.label,
      at: projection.toView(item.at),
      fontSize: LABEL_FONT_SIZE,
      prefer: item.prefer,
    })
  }
  return anchors
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
      const legLength = Math.min(Math.hypot(from.x - vertex.x, from.y - vertex.y), Math.hypot(to2.x - vertex.x, to2.y - vertex.y))
      const radius = Math.min(ANGLE_ARC_RADIUS, legLength * ANGLE_ARC_MAX_FRACTION)
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

