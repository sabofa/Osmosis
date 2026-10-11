import type { GraphConfig } from '../../parser/config'

// Whether an edit moved the authored frame (@bounds, @aspect, @xscale/@yscale). Pure. The renderer re-applies
// the authored view only when this is true, so a pan/zoom survives edits to any other line.

type FrameInputs = Pick<GraphConfig, 'bounds' | 'scales'> & { space?: { aspect?: unknown } | null }

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const frameOf = (c: FrameInputs | null | undefined) => ({
  bounds: c?.bounds ?? null,
  aspect: c?.space?.aspect ?? null,
  x: c?.scales?.x ?? 'linear',
  y: c?.scales?.y ?? 'linear',
})

export function frameChanged(prev: FrameInputs | null | undefined, next: FrameInputs | null | undefined): boolean {
  return !same(frameOf(prev), frameOf(next))
}
