import type { Vec2 } from '../scene/types'

export interface LabelPlacement {
  position: Vec2
  width: number
  height: number
}

// A label's position AND its own on-screen size are both derived from a
// fixed *pixel* target (see SceneRenderer.ts's pixelToWorld) — "raw" here
// means "that fixed-pixel target already converted to world units at the
// current zoom," which grows without bound as you zoom out. `maxOffset`
// (world units, or null/undefined for "no cap") is the furthest the label
// is allowed to sit from its anchor point.
//
// The first version of this fix only capped the *offset* — the label
// stopped moving further away once the cap engaged, but kept rendering at
// its full fixed pixel width/height regardless, so a label sitting right
// next to a vertex that had shrunk to a few screen pixels was *still* many
// times bigger than the thing it was labeling. That still reads as "not
// attached to its point," just from a different cause. Shrinking width and
// height by the exact same ratio the offset itself gets clamped by is what
// actually keeps a label looking attached: it shrinks down *with* whatever
// it's labeling instead of independently staying oversized.
export function clampedLabelPlacement(
  worldPos: Vec2,
  direction: Vec2,
  rawOffset: number,
  rawWidth: number,
  rawHeight: number,
  maxOffset: number | null | undefined
): LabelPlacement {
  const clampRatio = maxOffset != null && rawOffset > 0 ? Math.min(1, maxOffset / rawOffset) : 1
  const offset = rawOffset * clampRatio
  return {
    position: { x: worldPos.x + direction.x * offset, y: worldPos.y + direction.y * offset },
    width: rawWidth * clampRatio,
    height: rawHeight * clampRatio,
  }
}
