// From the scene contract to the three.js renderer's primitives (calc P2). The
// scene speaks in chains, bands, typed marks and unclipped lines; the renderer
// draws ribbons (one per chain), triangle regions and point-like marks. Pure, so
// it is tested without WebGL.
import * as THREE from 'three'
import { chainPoints } from '../scene/chains'
import type { Bounds, SceneObject, Vec2 } from '../scene/types'
import { clipLineToBounds } from './clipLine'

export type GeometryItem =
  | { kind: 'curve'; points: Vec2[]; color?: string | null }
  | { kind: 'segment'; from: Vec2; to: Vec2; dashed?: boolean; color?: string | null }
  | { kind: 'segments'; pairs: [Vec2, Vec2][]; dashed?: boolean; color?: string | null }
  | { kind: 'region'; triangles: Vec2[]; color?: string | null }

export function toRenderItems(objects: readonly SceneObject[], bounds: Bounds): { geometry: GeometryItem[]; misc: SceneObject[] } {
  const geometry: GeometryItem[] = []
  const misc: SceneObject[] = []
  for (const obj of objects) {
    switch (obj.kind) {
      case 'curve':
        for (const chain of obj.chains) {
          const points = chainPoints(chain)
          if (points.length < 2) continue
          if (chain.closed) points.push(points[0])
          geometry.push({ kind: 'curve', points, color: obj.color })
        }
        break
      case 'band': {
        const triangles: Vec2[] = []
        for (const chain of obj.outline) {
          const contour = chainPoints(chain).map((p) => new THREE.Vector2(p.x, p.y))
          if (contour.length < 3) continue
          for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
            triangles.push(
              { x: contour[a].x, y: contour[a].y },
              { x: contour[b].x, y: contour[b].y },
              { x: contour[c].x, y: contour[c].y }
            )
          }
        }
        if (triangles.length > 0) geometry.push({ kind: 'region', triangles, color: obj.color })
        break
      }
      // A constructed or guide line is stored unclipped (see scene/types.ts); how
      // much of it to draw is a fact about the current view, so it is clipped
      // here, at draw time, against the camera's live bounds. One that misses the
      // view drops out.
      case 'line': {
        const span = clipLineToBounds(obj.through, obj.direction, obj.extent, bounds)
        if (span) geometry.push({ kind: 'segment', from: span[0], to: span[1], dashed: obj.role === 'asymptote', color: obj.color })
        break
      }
      case 'segment':
      case 'segments':
      case 'region':
        geometry.push(obj)
        break
      default:
        misc.push(obj)
    }
  }
  return { geometry, misc }
}
