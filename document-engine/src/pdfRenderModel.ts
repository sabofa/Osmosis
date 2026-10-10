// Pure planning for the lazy PDF pipeline (no DOM, no pdfjs): which pages to
// render or free, how big a canvas may be, and when a rescale is "the same".

export const RENDER_RADIUS = 1 // visible page +/- this many pages get a canvas
export const KEEP_RADIUS = 3 // rendered pages farther than this are freed
export const MAX_DPR = 2
export const MAX_CANVAS_PIXELS = 16_000_000
export const RESCALE_DEBOUNCE_MS = 150

// 1-based page numbers within `radius` of any visible page, ascending.
export function expandWindow(visible: Iterable<number>, numPages: number, radius: number): number[] {
  const out = new Set<number>()
  for (const p of visible) {
    for (let q = p - radius; q <= p + radius; q++) if (q >= 1 && q <= numPages) out.add(q)
  }
  return [...out].sort((a, b) => a - b)
}

export interface CanvasPlan {
  // Backing-buffer size in device pixels.
  width: number
  height: number
  // Multiplier from CSS px to buffer px (dpr, capped, reduced for huge pages).
  outputScale: number
}

// Backing store for a page of cssW x cssH CSS px. dpr is capped at MAX_DPR and
// the pixel count at MAX_CANVAS_PIXELS: past that we lower the resolution
// (outputScale may drop below 1) rather than fail to allocate.
export function canvasPlan(cssW: number, cssH: number, dpr: number, maxPixels = MAX_CANVAS_PIXELS, dprCap = MAX_DPR): CanvasPlan {
  const w = Math.max(1, cssW)
  const h = Math.max(1, cssH)
  let outputScale = Math.min(Math.max(Number.isFinite(dpr) ? dpr : 1, 1), dprCap)
  const pixels = w * h * outputScale * outputScale
  if (pixels > maxPixels) outputScale = Math.sqrt(maxPixels / (w * h))
  return {
    width: Math.max(1, Math.floor(w * outputScale)),
    height: Math.max(1, Math.floor(h * outputScale)),
    outputScale,
  }
}

export function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001 * Math.max(a, b, 1e-9)
}

// CSS transform factor that stretches content rendered at `renderedScale` to
// the layout of `scale` (1 when nothing needs doing).
export function cssStretch(renderedScale: number, scale: number): number {
  return sameScale(renderedScale, scale) ? 1 : scale / renderedScale
}

export interface RenderPlanInput {
  visible: Iterable<number>
  numPages: number
  // page -> scale it is rendered at, or being rendered at (in flight).
  rendered: ReadonlyMap<number, number>
  scale: number
  // A rescale debounce is pending: do not start renders yet (existing pages
  // are CSS-stretched meanwhile); freeing still happens.
  debouncing: boolean
}

export interface RenderPlan {
  render: number[]
  free: number[]
}

export function planRender(input: RenderPlanInput): RenderPlan {
  const visible = [...input.visible]
  const want = expandWindow(visible, input.numPages, RENDER_RADIUS)
  const keep = new Set(expandWindow(visible, input.numPages, KEEP_RADIUS))
  const dist = (p: number) => visible.reduce((m, v) => Math.min(m, Math.abs(v - p)), Infinity)
  const render = input.debouncing
    ? []
    : want
        .filter((p) => {
          const at = input.rendered.get(p)
          return at === undefined || !sameScale(at, input.scale)
        })
        .sort((a, b) => dist(a) - dist(b) || a - b)
  const free = [...input.rendered.keys()].filter((p) => !keep.has(p)).sort((a, b) => a - b)
  return { render, free }
}
