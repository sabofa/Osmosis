import type { FeaturePointKind } from '../parser/config'
import type { Vec2 } from './types'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Numerically scans a sampled curve's points for intercepts and local
// extrema ("vertices") — works the same way regardless of whether the curve
// came from an explicit function, a polar equation, or a parametric curve,
// since it only ever looks at the point array, never the statement it came from.
export function detectFeaturePoints(points: Vec2[], kinds: Set<FeaturePointKind>): Vec2[] {
  if (kinds.size === 0 || points.length < 2) return []
  const found: Vec2[] = []

  if (kinds.has('intercepts')) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (a.y !== b.y && ((a.y <= 0 && b.y >= 0) || (a.y >= 0 && b.y <= 0))) {
        const t = a.y / (a.y - b.y)
        found.push({ x: lerp(a.x, b.x, t), y: 0 })
      }
      if (a.x !== b.x && ((a.x <= 0 && b.x >= 0) || (a.x >= 0 && b.x <= 0))) {
        const t = a.x / (a.x - b.x)
        found.push({ x: 0, y: lerp(a.y, b.y, t) })
      }
    }
  }

  if (kinds.has('vertices')) {
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const next = points[i + 1]

      const dyPrev = cur.y - prev.y
      const dyNext = next.y - cur.y
      if (dyPrev !== 0 && dyNext !== 0 && dyPrev > 0 !== dyNext > 0) {
        found.push({ x: cur.x, y: cur.y })
        continue
      }

      const dxPrev = cur.x - prev.x
      const dxNext = next.x - cur.x
      if (dxPrev !== 0 && dxNext !== 0 && dxPrev > 0 !== dxNext > 0) {
        found.push({ x: cur.x, y: cur.y })
      }
    }
  }

  return found
}
