import type { Vec2 } from '../scene/types'

// A fixed on-screen size, in world units, per axis. `perPx` is world-per-pixel along x and y (they differ when
// the plot's px-per-unit differ). A circle of r px is then an ellipse of radii (r*perPx.x, r*perPx.y), which is
// what a mesh built at unit radius gets as its (x, y) scale.
export function pixelSizeXY(px: number, perPx: Vec2): Vec2 {
  return { x: px * perPx.x, y: px * perPx.y }
}
