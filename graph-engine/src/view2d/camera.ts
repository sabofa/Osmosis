import type { Camera, Rect, Size, Vec } from './types'

// The camera — the one place content and screen coordinates are converted.
//
// Everything here is pure arithmetic on plain numbers, with no DOM and no
// clock, so that a node test can reach every decision a view makes about
// where things are. Components only plumb events; they never do this maths.
//
// The fit is SVG's `xMidYMid meet`: at zoom 1 the content frame is drawn as
// large as it can be while still fitting whole, centred, with bars along
// whichever axis has room spare. The bars matter: mapping a pixel by the
// element's own width would be off by half a bar, and the content would slide
// away from the cursor as it zoomed. Using the same rule for every engine
// means a figure, a table and a flowchart all agree on what "fitted" means.

// The fitted view: the frame's own centre, zoom 1.
export function fittedCamera(frame: Rect): Camera {
  return { cx: frame.x + frame.width / 2, cy: frame.y + frame.height / 2, zoom: 1 }
}

// Pixels per content unit at zoom 1.
//
// A degenerate frame or an unmeasured (zero-sized) screen answers 1 rather
// than infinity or zero: a view is briefly zero-sized while it mounts, and a
// NaN camera would poison every move after it.
export function basePxPerUnit(frame: Rect, screen: Size): number {
  if (frame.width <= 0 || frame.height <= 0 || screen.width <= 0 || screen.height <= 0) return 1
  return Math.min(screen.width / frame.width, screen.height / frame.height)
}

export function pxPerUnit(frame: Rect, camera: Camera, screen: Size): number {
  return basePxPerUnit(frame, screen) * camera.zoom
}

// The part of the content plane the screen shows: the screen's own aspect,
// centred on the camera. It can be larger than the frame (letterbox bars) or
// smaller (zoomed in); either way it is what the screen literally covers.
export function visibleRect(frame: Rect, camera: Camera, screen: Size): Rect {
  const ppu = pxPerUnit(frame, camera, screen)
  const width = screen.width / ppu
  const height = screen.height / ppu
  return { x: camera.cx - width / 2, y: camera.cy - height / 2, width, height }
}

export function contentToScreen(p: Vec, frame: Rect, camera: Camera, screen: Size): Vec {
  const ppu = pxPerUnit(frame, camera, screen)
  return {
    x: screen.width / 2 + (p.x - camera.cx) * ppu,
    y: screen.height / 2 + (p.y - camera.cy) * ppu,
  }
}

export function screenToContent(p: Vec, frame: Rect, camera: Camera, screen: Size): Vec {
  const ppu = pxPerUnit(frame, camera, screen)
  return {
    x: camera.cx + (p.x - screen.width / 2) / ppu,
    y: camera.cy + (p.y - screen.height / 2) / ppu,
  }
}

// Magnify by `factor` about a screen point, **holding the content under it
// still**.
//
// The centre is re-derived from the content point and the new zoom rather than
// nudged by an offset, so the point holds exactly, not approximately, however
// far the zoom runs. Zoom is not clamped here: clamping belongs to the limits,
// and a caller that clamps the zoom afterwards must re-derive the centre from
// the zoom it actually got (the usual bug: the content lurches away from the
// cursor exactly when a reader is pushing hardest at a limit).
export function zoomAbout(camera: Camera, screenPoint: Vec, factor: number, frame: Rect, screen: Size): Camera {
  const anchor = screenToContent(screenPoint, frame, camera, screen)
  return anchoredCamera(anchor, screenPoint, camera.zoom * factor, frame, screen)
}

// The camera at `zoom` that puts content point `anchor` at `screenPoint`.
// Exposed because smoothed zooms re-derive the centre every frame from the
// interpolated zoom, which is what keeps the anchor still at every step.
export function anchoredCamera(anchor: Vec, screenPoint: Vec, zoom: number, frame: Rect, screen: Size): Camera {
  const ppu = basePxPerUnit(frame, screen) * zoom
  return {
    cx: anchor.x - (screenPoint.x - screen.width / 2) / ppu,
    cy: anchor.y - (screenPoint.y - screen.height / 2) / ppu,
    zoom,
  }
}

// Move the view so content follows the cursor by exactly (dx, dy) screen
// pixels: drag right and the content goes right, so the centre goes left.
// The zoom is returned untouched; a pan that rounded the scale would drift the
// size of the content over a long drag.
export function panByScreen(camera: Camera, dxPx: number, dyPx: number, frame: Rect, screen: Size): Camera {
  const ppu = pxPerUnit(frame, camera, screen)
  return { cx: camera.cx - dxPx / ppu, cy: camera.cy - dyPx / ppu, zoom: camera.zoom }
}
