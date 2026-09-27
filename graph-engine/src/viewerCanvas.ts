// GraphViewer's rule for its <canvas>. A canvas is bound to the first
// context it hands out, and both renderers release that context when they
// are disposed (the 2D renderer through three.js's forceContextLoss, space
// through WEBGL_lose_context), so the browser's cap on live contexts (about
// 16 in Chrome) is never reached. A released canvas can never be drawn on
// again, so every release moves the canvas to a new generation: a new React
// key, so a fresh <canvas> element for the next renderer.

export interface Disposable {
  dispose(): void
}

// Dispose the held renderer, if there is one. True when there was: its
// canvas is now spent, and the caller must mount a fresh one.
export function releaseRenderer<R extends Disposable>(holder: { current: R | null }): boolean {
  const renderer = holder.current
  if (!renderer) return false
  holder.current = null
  renderer.dispose()
  return true
}

// The canvas element's key: the context type it serves and its generation.
export function canvasKey(mode: '2d' | '3d', generation: number): string {
  return `${mode}-${generation}`
}
