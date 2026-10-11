import { basePxPerUnit, clampCamera, WHEEL_LINE_PX, WHEEL_PAGE_PX, WHEEL_SENSITIVITY } from '../../view2d'
import type { Size, Vec } from '../../view2d'
import { frameRect, plotCameraOf, plotViewOf, PLOT_LIMITS, screenToPlot } from './plotView'
import type { PlotView, PlotWindow } from './plotView'

// One-axis zoom (Alt+wheel x, Alt+Shift+wheel y). It is not a camera op: it
// changes the unit ratio a:b, then re-derives zoom and centre so the plot point
// under the cursor stays put and the other axis keeps its px-per-unit.
// Zoom is clamped to PLOT_LIMITS (the cursor still holds; the other axis then
// gives way), and the centre to the pan margin.
export function axisZoom(
  view: PlotView,
  win: PlotWindow,
  axis: 'x' | 'y',
  factor: number,
  screenPt: Vec,
  screen: Size,
): PlotView {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return view
  if (screen.width <= 0 || screen.height <= 0) return view
  const p0 = screenToPlot(view, win, screen, screenPt)
  const a = axis === 'x' ? view.a * factor : view.a
  const b = axis === 'y' ? view.b * factor : view.b
  const frame = frameRect(win, a, b)
  const base0 = basePxPerUnit(frameRect(win, view.a, view.b), screen)
  const base1 = basePxPerUnit(frame, screen)
  const zoom = Math.min(PLOT_LIMITS.zoomMax, Math.max(PLOT_LIMITS.zoomMin, (view.zoom * base0) / base1))
  const ppu = base1 * zoom
  const next: PlotView = {
    cu: axis === 'x' ? p0.x - (screenPt.x - screen.width / 2) / (ppu * a) : view.cu,
    cv: axis === 'y' ? p0.y + (screenPt.y - screen.height / 2) / (ppu * b) : view.cv,
    zoom,
    a,
    b,
  }
  return plotViewOf(clampCamera(plotCameraOf(next), frame, screen, PLOT_LIMITS), a, b)
}

/** A wheel event's zoom factor: view2d's feel, deltaY with deltaX as the fallback (Shift+wheel). */
export function wheelFactor(w: { deltaY: number; deltaX: number; deltaMode: number }): number {
  const delta = w.deltaY || w.deltaX
  const px = delta * (w.deltaMode === 1 ? WHEEL_LINE_PX : w.deltaMode === 2 ? WHEEL_PAGE_PX : 1)
  return Math.exp(-px * WHEEL_SENSITIVITY)
}
