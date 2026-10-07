// Which paint settings only the renderer's shader reads. The sweep measures the per-frame MODEL (strokes: colour,
// geometry, count, edges), so these rate "none" there although they are plainly visible in the painting; the sweep
// rates them 'render-only' instead and keeps their measured numbers. Derived from RENDER_ONLY (the parameters only
// the renderer reads) wherever it can be, so the list is not copied by hand.

import { RENDER_ONLY } from '../src/space/paint/model/index'

// Role settings the shader reads (the stroke's paint load, relief and bristle texture, dryness, wetness).
const ROLE_RENDER_KEYS = ['load', 'impasto', 'bristles', 'bristleVar', 'dry', 'wet']
// Read only by the renderer but outside RENDER_ONLY: the shadow map, and the drag-time particle density.
const EXTRA = ['paint.light.shadows', 'paint.particles.dragDensity']

export function isRenderOnly(path: string): boolean {
  if (EXTRA.includes(path)) return true
  if (RENDER_ONLY.some((r) => path === `paint.${r}` || path.startsWith(`paint.${r}.`))) return true
  const role = /^paint\.roles\.[^.]+\.([^.]+)$/.exec(path)
  return role !== null && ROLE_RENDER_KEYS.includes(role[1])
}
