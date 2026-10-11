import { pxPerUnit } from '../camera'
import type { Camera, Rect, Size } from '../types'

// Appliers — how a camera becomes pixels on one kind of surface. The view
// decides where it is looking (see useView2d); an engine picks the applier
// that suits what it draws. The string each one writes is built by a pure
// function, so a node test reaches it; the apply functions only set it.

// Ten significant digits: enough that the window does not creep at the
// highest zoom, few enough to keep the attribute short. (figure/svg.ts's
// `fmt` rounds to three decimals, which is right for a drawing's coordinates
// and too coarse for a window onto it that may be a sixty-fourth of the
// drawing wide.)
const writeNumber = (n: number): string => String(Number(n.toPrecision(10)))

// The viewBox that shows an SVG through the window `visible`; null for a
// window that is not a finite, positive box.
export function viewBoxValue(visible: Rect): string | null {
  const { x, y, width, height } = visible
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return [x, y, width, height].map(writeNumber).join(' ')
}

// A figure: show the SVG through the window `visible`. The markup is not
// touched, only the viewBox, so the drawing stays crisp at any magnification.
// `visible` has the screen's own aspect, so the svg's "meet" fitting fills the
// element exactly.
export function applySvgViewBox(svg: SVGSVGElement, visible: Rect): void {
  const value = viewBoxValue(visible)
  if (value !== null) svg.setAttribute('viewBox', value)
}

// The transform that lands an element laid out at the content frame's own
// size (one CSS pixel per content unit, top-left at the frame's top-left) on
// the screen as the camera sees it; null if the arithmetic is not finite.
export function cssTransformValue(frame: Rect, camera: Camera, screen: Size): string | null {
  const ppu = pxPerUnit(frame, camera, screen)
  const tx = screen.width / 2 + (frame.x - camera.cx) * ppu
  const ty = screen.height / 2 + (frame.y - camera.cy) * ppu
  if (![ppu, tx, ty].every(Number.isFinite)) return null
  return `translate(${writeNumber(tx)}px, ${writeNumber(ty)}px) scale(${writeNumber(ppu)})`
}

// An HTML element, for tables later. `transform-origin: 0 0` is written here,
// so the caller need not.
export function applyCssTransform(element: HTMLElement, frame: Rect, camera: Camera, screen: Size): void {
  const value = cssTransformValue(frame, camera, screen)
  if (value === null) return
  element.style.transformOrigin = '0 0'
  element.style.transform = value
}

// How an element that is drawn `overscan` (a fraction of the screen) larger
// than the screen on every side sits on the screen: its size and its offset
// (both as CSS percentages of the screen), and the transform origin that puts
// a transform at the screen's own top-left corner, as liveTransform assumes.
export function overscanLayout(overscan: number): { size: string; offset: string; origin: string } {
  const o = Number.isFinite(overscan) && overscan > 0 ? overscan : 0
  const pct = (n: number): string => `${Number(n.toPrecision(10))}%`
  return { size: pct(100 * (1 + 2 * o)), offset: pct(-100 * o), origin: pct((100 * o) / (1 + 2 * o)) }
}

// An svg drawn `overscan` larger than its surface on every side: laid out over
// the surface (which must be positioned), grown, with its transform origin on
// the surface's corner.
export function applyOverscan(svg: SVGSVGElement, overscan: number): void {
  const { size, offset, origin } = overscanLayout(overscan)
  const style = svg.style
  style.position = 'absolute'
  style.left = offset
  style.top = offset
  style.width = size
  style.height = size
  style.maxWidth = 'none'
  style.maxHeight = 'none'
  style.transformOrigin = `${origin} ${origin}`
}
