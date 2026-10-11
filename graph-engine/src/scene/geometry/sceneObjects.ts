import { chainOf } from '../chains'
import type { MarkId, SceneObject, Vec2 } from '../types'
import type { GeometryObject } from './objects'

// Turning geometry values into drawable scene objects. Shared by the existing
// polygon: builder and by the v2 construction pass, so a solved triangle and a
// hand-typed polygon render as the same picture rather than as two shapes that
// happen to look similar.

export const CIRCLE_SAMPLES = 96

// Never push a vertex label further from its vertex than this fraction of
// that vertex's own distance to the shape's centroid — see buildScene's
// original comment for the reasoning.
const POLYGON_LABEL_MAX_FRACTION = 0.35

// A circle is one closed chain, parametrised by angle. The chain holds the
// CIRCLE_SAMPLES vertices around the loop without repeating the first at the
// end: `closed` is what joins the last back to it, so the loop closes exactly
// instead of to within the rounding of cos(2*pi).
export function circleCurve(center: Vec2, radius: number, color: string | null, id: MarkId): SceneObject {
  const points: Vec2[] = []
  const angles: number[] = []
  for (let i = 0; i < CIRCLE_SAMPLES; i++) {
    const t = (i / CIRCLE_SAMPLES) * 2 * Math.PI
    angles.push(t)
    points.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) })
  }
  return { kind: 'curve', id, chains: [chainOf(points, angles, true)], breaks: [], color }
}

// A closed shape from labelled vertices: one batched 'segments' object for the
// edges, plus one labelled 'point' per vertex whose label is pushed away from
// the shape's own centroid (so it lands outside the shape rather than on top
// of an angle:/right-angle: mark, which always sits inside at that vertex).
export function polygonObjects(vertices: { label: string; position: Vec2 }[], color: string | null): SceneObject[] {
  const pairs: [Vec2, Vec2][] = vertices.map((v, i) => [v.position, vertices[(i + 1) % vertices.length].position])
  const objects: SceneObject[] = [{ kind: 'segments', pairs, color }]

  const centroid = { x: 0, y: 0 }
  for (const v of vertices) {
    centroid.x += v.position.x / vertices.length
    centroid.y += v.position.y / vertices.length
  }
  for (const v of vertices) {
    const dx = v.position.x - centroid.x
    const dy = v.position.y - centroid.y
    const len = Math.hypot(dx, dy) || 1
    objects.push({
      kind: 'point',
      label: v.label,
      position: v.position,
      color,
      labelDirection: { x: dx / len, y: dy / len },
      maxLabelOffset: len * POLYGON_LABEL_MAX_FRACTION,
    })
  }
  return objects
}

// One geometry value as scene objects. A segment is already finite so it
// draws as a plain segment; an infinite line or a ray is emitted UNCLIPPED for
// the renderer to clip against the live view (see render/clipLine.ts). `circleId`
// is the identity a circle's curve carries, so only a circle needs one: the
// statement it came from, and the name it is bound to or its place among that
// statement's circles.
export function geometryObjectToScene(object: GeometryObject, label: string | null, color: string | null, circleId?: MarkId): SceneObject[] {
  switch (object.kind) {
    case 'point':
      // Analytically resolved, not read off a sampled curve, so hover can
      // report these digit for digit (see `exact` in scene/types.ts).
      return [{ kind: 'point', label, position: object.at, color, exact: true }]
    case 'circle':
      if (!circleId) throw new Error('a circle needs an identity')
      return [circleCurve(object.center, object.radius, color, circleId)]
    case 'line':
      if (object.extent === 'segment') return [{ kind: 'segment', from: object.a, to: object.b, color }]
      return [
        {
          kind: 'line',
          through: object.a,
          direction: { x: object.b.x - object.a.x, y: object.b.y - object.a.y },
          extent: object.extent,
          color,
        },
      ]
  }
}
