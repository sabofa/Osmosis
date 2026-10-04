import { clipLineToBounds } from '../render/clipLine'
import type { Arc } from '../scene/geometry/circles'
import type { Region } from '../scene/geometry/regions'
import type { Vec2 } from '../scene/types'
import type { HitItem } from '../view2d/pointing'
import type { Rect, Vec } from '../view2d/types'
import { edgeObject, type ProjectedEdge } from './project3d'
import type { FigureItem } from './render'
import { ellipsePoint } from './svg'

// What a figure can be pointed at by: its geometry as a flat list of
// `HitItem`s in VIEW units (the SVG viewBox's, after the figure's projection),
// ready for view2d's `hitTest`. The renderer builds the items; this file only
// translates them, so the shapes pointed at are the shapes drawn.
//
// Not every item is pointable. The marks (angle arcs, right-angle squares,
// ticks, an angle's arc in space) annotate something that is, and a pointer
// that landed on a small arc beside an angle would be answering the wrong
// question. They give no items.

// The identity the markup carries: `data-statement` and `data-object`.
export interface FigureTarget {
  statement: number
  object: string | null
}

export interface FigureHitItem extends HitItem {
  // The identities that light up together when this item is hovered or picked.
  targets: FigureTarget[]
  // Where the thing is in the author's own coordinates: (x, y) for a point of
  // the plane, (X, Y, Z) for a point in space.
  author?: { x: number; y: number; z?: number }
}

export interface FigureHitInput {
  items: readonly FigureItem[]
  // Each placed label, with the identity of what it names.
  labels: readonly { id: FigureTarget; rect: Rect }[]
  // The givens table: the statements it lists, and its box.
  givens: { statements: number[]; box: Rect } | null
  toView: (p: Vec2) => Vec2
  scale: number
  viewBox: Rect
  // A solid figure: a point without space coordinates is a lifted copy, not
  // something whose plane coordinates the author wrote.
  space?: boolean
}

// A curved edge is sampled at this many segments, a whole ellipse at twice.
const CURVE_SEGMENTS = 24
const ELLIPSE_SEGMENTS = 48

const idOf = (target: FigureTarget): string => `${target.statement}/${target.object ?? ''}`

function ellipseOutline(circle: { center: Vec2; rx: number; ry: number; rotation: number }): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    points.push(ellipsePoint(circle.center, circle.rx, circle.ry, circle.rotation, (2 * Math.PI * i) / ELLIPSE_SEGMENTS))
  }
  return points
}

// A drawn edge as points in world space, ends included.
function sampleEdge(edge: ProjectedEdge): Vec2[] {
  if (edge.kind === 'segment') return [edge.a, edge.b]
  const points: Vec2[] = []
  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const t = edge.startAngle + ((edge.endAngle - edge.startAngle) * i) / CURVE_SEGMENTS
    points.push(ellipsePoint(edge.center, edge.rx, edge.ry, edge.rotation, t))
  }
  return points
}

// A closed chain of drawn edges as one outline: each edge's points, the last
// of one being the first of the next.
function chainOutline(edges: readonly ProjectedEdge[]): Vec2[] {
  const points: Vec2[] = []
  for (const edge of edges) points.push(...sampleEdge(edge).slice(0, -1))
  return points
}

function arcSamples(arc: Arc): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const angle = arc.start + (arc.sweep * i) / CURVE_SEGMENTS
    points.push({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) })
  }
  return points
}

// A region's boundary as ONE even-odd polygon. A region with holes has several
// loops; they are joined through their first points, each bridge walked there
// and straight back, so that the two crossings of a bridge cancel under the
// even-odd rule and the holes stay holes.
function regionOutline(region: Region): Vec2[] {
  const loops = region.loops.map((loop) => {
    const points: Vec2[] = []
    for (const piece of loop) {
      if (piece.kind === 'segment') {
        points.push(piece.a)
        continue
      }
      for (let i = 0; i < CURVE_SEGMENTS; i++) {
        const angle = piece.from + ((piece.to - piece.from) * i) / CURVE_SEGMENTS
        points.push({ x: piece.center.x + piece.radius * Math.cos(angle), y: piece.center.y + piece.radius * Math.sin(angle) })
      }
    }
    return points
  })
  if (loops.length <= 1) return loops[0] ?? []
  const first = loops[0][0]
  const joined: Vec2[] = [...loops[0], first]
  for (const loop of loops.slice(1)) joined.push(...loop, loop[0], first)
  return joined
}

export function figureHitItems(input: FigureHitInput): FigureHitItem[] {
  const { toView, scale, viewBox } = input
  const out: FigureHitItem[] = []
  const view = (points: readonly Vec2[]): Vec[] => points.map(toView)

  const add = (id: FigureTarget, shape: HitItem['shape'], extra?: Partial<FigureHitItem>) =>
    out.push({ id: idOf(id), shape, targets: [{ statement: id.statement, object: id.object }], ...extra })

  for (const item of input.items) {
    switch (item.kind) {
      case 'point':
      case 'solidVertex': {
        const author = item.author3
          ? { x: item.author3.x, y: item.author3.y, z: item.author3.z }
          : item.kind === 'point' && !input.space
            ? { x: item.at.x, y: item.at.y }
            : undefined
        add(item.id, { kind: 'point', at: toView(item.at) }, author ? { author } : undefined)
        break
      }
      case 'line': {
        const a = toView(item.a)
        const b = toView(item.b)
        if (item.extent === 'segment') {
          add(item.id, { kind: 'segment', a, b })
          break
        }
        // As emit clips it: against the final viewBox.
        const clipped = clipLineToBounds(a, { x: b.x - a.x, y: b.y - a.y }, item.extent, {
          xMin: viewBox.x,
          xMax: viewBox.x + viewBox.width,
          yMin: viewBox.y,
          yMax: viewBox.y + viewBox.height,
        })
        if (clipped) add(item.id, { kind: 'segment', a: clipped[0], b: clipped[1] })
        break
      }
      case 'dimensionReference':
        add(item.id, { kind: 'segment', a: toView(item.a), b: toView(item.b) })
        break
      case 'circle':
        add(item.id, { kind: 'circle', center: toView(item.center), radius: item.radius * scale })
        break
      case 'arc': {
        // A world angle t is the view angle -t: toView flips y.
        add(item.id, {
          kind: 'arc',
          center: toView(item.arc.center),
          radius: item.arc.radius * scale,
          start: -item.arc.start,
          end: -(item.arc.start + item.arc.sweep),
        })
        if (item.fill !== 'none') {
          const rim = arcSamples(item.arc)
          add(item.id, { kind: 'polygon', points: view(item.fill === 'sector' ? [item.arc.center, ...rim] : rim) })
        }
        break
      }
      case 'polygon':
        add(item.id, { kind: 'polyline', points: view(item.vertices), closed: true })
        break
      case 'solid':
        for (const edge of item.edges) {
          add({ statement: item.id.statement, object: edgeObject(edge) }, { kind: 'polyline', points: view(sampleEdge(edge)), closed: false })
        }
        break
      case 'net':
        for (const { edge } of item.lines) {
          add({ statement: item.id.statement, object: edgeObject(edge) }, { kind: 'polyline', points: view(sampleEdge(edge)), closed: false })
        }
        break
      case 'sectionFace': {
        const outline = item.outline
        const points =
          outline.kind === 'polygon' ? outline.vertices : outline.kind === 'region' ? chainOutline(outline.edges) : ellipseOutline(outline.circle)
        add(item.id, { kind: 'polygon', points: view(points) })
        break
      }
      case 'region':
        add(item.id, { kind: 'polygon', points: view(chainOutline(item.edges)) })
        break
      case 'fill':
        add(item.id, { kind: 'polygon', points: view(regionOutline(item.region)) })
        break
      case 'angleMark':
      case 'rightAngleMark':
      case 'tickMark':
      case 'spaceArc':
      case 'spaceRightAngle':
      case 'centralAngle':
        // Marks annotate; they are not things to point at.
        break
      case 'measureLabel':
      case 'netLabel':
      case 'given':
        // Labels arrive through `labels` once placed; the table through `givens`.
        break
    }
  }

  // A label counts as the point-like object it names, so it outranks a line it
  // overlaps (rank 0), and shares that object's id: hovering the label lights
  // up the object.
  for (const label of input.labels) add(label.id, { kind: 'rect', rect: label.rect }, { rank: 0 })

  if (input.givens) {
    out.push({
      id: 'givens',
      shape: { kind: 'rect', rect: input.givens.box },
      targets: input.givens.statements.map((statement) => ({ statement, object: null })),
    })
  }
  return out
}
