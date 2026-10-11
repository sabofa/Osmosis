import { basePxPerUnit, contentToScreen, DEFAULT_LIMITS, fittedCamera, screenToContent, visibleRect } from '../../view2d'
import type { Camera, LimitsPolicy, Rect, Size, Vec } from '../../view2d'
import type { Aspect } from '../../space/config'
import { PLOT_ZOOM } from '../frame/tuning'

// The plot's view, in plot terms. view2d moves a camera over a content frame;
// the plot hands it "frame space": X = a*u, Y = -b*v (content y points down,
// plot v points up). a:b is the screen ratio of the x and y units, so one-axis
// zoom changes the ratio rather than the camera. Log axes cost nothing: the
// window and the view already live in (u,v) = log10 coordinates.

export type PlotAspect = Aspect

/** The @bounds window in (u,v), after the scale's forward map per axis. */
export interface PlotWindow {
  uMin: number
  uMax: number
  vMin: number
  vMax: number
}

/** cu,cv: the centre in (u,v); zoom: view2d zoom; a,b: relative px-per-unit at zoom 1. */
export interface PlotView {
  cu: number
  cv: number
  zoom: number
  a: number
  b: number
}

export const PLOT_LIMITS: LimitsPolicy = { ...DEFAULT_LIMITS, zoomMin: PLOT_ZOOM.min, zoomMax: PLOT_ZOOM.max }

const span = (lo: number, hi: number): number => (hi - lo > 0 && Number.isFinite(hi - lo) ? hi - lo : 1)

/** The unit ratio a:b. `null` is equal (the 2D default); 3D-only ratios fall back to equal. */
export function frameAxes(win: PlotWindow, aspect: PlotAspect | null, screen: Size): { a: number; b: number } {
  if (aspect?.kind === 'auto') {
    // The frame is the screen's own shape, so the fit has no bars and base = 1.
    const w = screen.width > 0 && screen.height > 0 ? screen : { width: 1, height: 1 }
    return { a: w.width / span(win.uMin, win.uMax), b: w.height / span(win.vMin, win.vMax) }
  }
  if (aspect?.kind === 'ratioXY' && aspect.x > 0 && aspect.y > 0) return { a: aspect.x, b: aspect.y }
  return { a: 1, b: 1 }
}

export function frameRect(win: PlotWindow, a: number, b: number): Rect {
  return {
    x: a * win.uMin,
    y: -b * win.vMax,
    width: a * span(win.uMin, win.uMax),
    height: b * span(win.vMin, win.vMax),
  }
}

export function plotCameraOf(view: PlotView): Camera {
  return { cx: view.a * view.cu, cy: -view.b * view.cv, zoom: view.zoom }
}

export function plotViewOf(camera: Camera, a: number, b: number): PlotView {
  return { cu: camera.cx / a, cv: -camera.cy / b, zoom: camera.zoom, a, b }
}

export function startView(win: PlotWindow, aspect: PlotAspect | null, screen: Size): PlotView {
  const { a, b } = frameAxes(win, aspect, screen)
  return plotViewOf(fittedCamera(frameRect(win, a, b)), a, b)
}

/** What the screen shows, as a (u,v) window. */
export function boundsOf(view: PlotView, win: PlotWindow, screen: Size): PlotWindow {
  const r = visibleRect(frameRect(win, view.a, view.b), plotCameraOf(view), screen)
  return {
    uMin: r.x / view.a,
    uMax: (r.x + r.width) / view.a,
    vMin: -(r.y + r.height) / view.b,
    vMax: -r.y / view.b,
  }
}

export function plotToScreen(view: PlotView, win: PlotWindow, screen: Size, p: Vec): Vec {
  const frame = frameRect(win, view.a, view.b)
  return contentToScreen({ x: view.a * p.x, y: -view.b * p.y }, frame, plotCameraOf(view), screen)
}

export function screenToPlot(view: PlotView, win: PlotWindow, screen: Size, p: Vec): Vec {
  const frame = frameRect(win, view.a, view.b)
  const c = screenToContent(p, frame, plotCameraOf(view), screen)
  return { x: c.x / view.a, y: -c.y / view.b }
}

/** Screen pixels per (u,v) unit on each axis. */
export function pxPerUnitXY(view: PlotView, win: PlotWindow, screen: Size): { x: number; y: number } {
  const base = basePxPerUnit(frameRect(win, view.a, view.b), screen) * view.zoom
  return { x: base * view.a, y: base * view.b }
}
