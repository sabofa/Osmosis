import type { GivensPosition } from '../parser/config'
import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import { fmt, svgGroup, type SvgAttrs } from './svg'

// The figure document: layers, the world-to-view projection, the two-pass
// auto-fit, and the `<svg>` wrapper itself.
//
// Everything in here is about *arranging* markup. Producing markup is svg.ts;
// deciding what geometry to produce is render.ts. The split matters because
// the layer order is a semantic decision (E1) that has to be testable on its
// own, without a figure to draw.

// ---------------------------------------------------------------------------
// E1 — layers
// ---------------------------------------------------------------------------

// Painting order, first painted to last. SVG paints in document order and
// offers no z-index, so this array *is* the stacking rule.
//
// The order is semantic, not cosmetic, and it comes from what a dense
// competition figure looks like: fills are backdrop; auxiliary construction
// lines are scaffolding and must not sit on top of the figure they help
// build; the figure itself is the subject; marks annotate the figure so they
// go over it; a point is a landmark and is never hidden by a stroke crossing
// it; and a label is the one thing that is useless if anything covers it, so
// labels are last, always.
export const FIGURE_LAYERS = ['regions', 'auxiliary', 'primary', 'marks', 'points', 'labels'] as const

export type FigureLayer = (typeof FIGURE_LAYERS)[number]

export type FigureLayers = Record<FigureLayer, string[]>

export function emptyFigureLayers(): FigureLayers {
  return { regions: [], auxiliary: [], primary: [], marks: [], points: [], labels: [] }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface FigureTheme {
  background: string
  // The default stroke for drawn geometry. Axis, not curve: a figure is ink
  // on paper, and the plot renderer's accent colour reads as "this is one
  // plotted function among several" rather than "this is the figure".
  ink: string
  auxiliary: string
  point: string
  label: string
  region: string
}

export function cssColor(hex: number): string {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0')
}

// Colours come from the palette the host already resolved (design tokens
// when it defines them, the built-in light/dark palette otherwise), so a
// figure follows the app's theme exactly as a graph does.
export function figureTheme(palette: Palette): FigureTheme {
  return {
    background: cssColor(palette.background),
    ink: cssColor(palette.axis),
    // Auxiliary lines are drawn in the same ink and separated by dashing and
    // opacity rather than by hue — a second colour would read as "a different
    // kind of object", which is the opposite of what scaffolding is.
    auxiliary: cssColor(palette.axis),
    point: cssColor(palette.point),
    label: cssColor(palette.axis),
    region: cssColor(palette.region),
  }
}

// ---------------------------------------------------------------------------
// Rects and bounds
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function boundsOf(points: readonly Vec2[]): WorldBounds | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

// A rect centred on `at`, `width` by `height`. The shape a placed label
// occupies, and the shape a point's dot occupies.
export function rectAround(at: Vec2, width: number, height: number): Rect {
  return { x: at.x - width / 2, y: at.y - height / 2, width, height }
}

export function unionRects(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const r of rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.width > maxX) maxX = r.x + r.width
    if (r.y + r.height > maxY) maxY = r.y + r.height
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function growRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

// The view-unit size the *geometry* is fitted into, before labels push the
// viewBox outward. Not pixels: the `<svg>` scales to whatever box the page
// gives it. It exists so that stroke widths, font sizes and mark radii can be
// written as plain constants that mean the same thing in every figure —
// which is only true if every figure's geometry lands at roughly one size.
export const FIGURE_SIZE = 640

// Padding between the outermost content and the viewBox edge (E3). In the
// same view units as FIGURE_SIZE.
export const FIGURE_PADDING = 18

export interface Projection {
  toView(p: Vec2): Vec2
  scale: number
}

// **1:1 aspect is locked by construction**: one scale for both axes, so a
// right angle in the plane is a right angle on the page. This is the thing a
// figure cannot be allowed to get wrong — an unequal aspect turns a square
// into a rectangle and silently makes the drawing disagree with the maths it
// illustrates.
//
// The content is centred on the view origin. That makes the emitted numbers a
// function of the figure's *shape* only, not of where in the coordinate plane
// the author happened to place it — a triangle drawn at (1000, 1000) emits
// the same bytes as the same triangle drawn at the origin.
export function fitProjection(bounds: WorldBounds): Projection {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const span = Math.max(width, height)
  // A degenerate figure — one point, or a set of coincident ones — has no
  // span to scale by. One world unit is the fallback, which keeps the scale
  // finite and positive instead of producing Infinity coordinates.
  const scale = FIGURE_SIZE / (span > 0 ? span : 1)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    scale,
    toView(p: Vec2): Vec2 {
      // y is negated: SVG's y axis points down, the plane's points up.
      return { x: (p.x - cx) * scale, y: -(p.y - cy) * scale }
    },
  }
}

// ---------------------------------------------------------------------------
// The givens box
// ---------------------------------------------------------------------------

// A dense figure reaches a point where inline labelling makes it worse rather
// than better, and the convention competition figures already use is to lift
// the given values out of the drawing into a box. This is the pressure valve
// for the label-density problem: when placement gets hard, move some of it
// out of the drawing entirely.

// The positions themselves are owned by the parser, because "@givens:" is
// where an author names one and the parser is what has to reject a name that
// is not one. Re-exported here so a caller of the layout does not need to
// reach into the parser for the type of its own argument.
export { GIVENS_POSITIONS, type GivensPosition } from '../parser/config'

// **The box sits outside the drawing, never inset over a corner of it.**
//
// "Corner" here therefore means a corner of the composed figure — the box is
// placed above or below the drawing and aligned to its left or right edge —
// rather than a corner of the drawing with the box floating on top. An inset
// box would have to be placed against the geometry to avoid covering it,
// which is the same search the label layout already does and loses, at the
// density where an author reaches for this feature in the first place. A
// figure that has given up on fitting labels inside the drawing is not a
// figure with room for a box inside the drawing.
const GIVENS_PADDING = 14
const GIVENS_ROW_GAP = 9

// The space between the box and the drawing.
const GIVENS_GAP = FIGURE_PADDING

// One row's extent, relative to its own glyph row. Structurally what
// notation.ts's NotationLayout hands back, so a caller lays a row out once
// and passes it straight here.
export interface GivensRow {
  width: number
  top: number
  bottom: number
}

export interface GivensBoxLayout {
  box: Rect
  // Where to write each row: its left edge and its glyph row, in the order
  // the rows were given. Not the row's box centre — a row carrying an overbar
  // is taller above its glyphs than below them.
  rows: Vec2[]
}

export function layoutGivensBox(rows: readonly GivensRow[], position: GivensPosition, content: Rect): GivensBoxLayout {
  let inner = 0
  let widest = 0
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) inner += GIVENS_ROW_GAP
    inner += rows[i].bottom - rows[i].top
    widest = Math.max(widest, rows[i].width)
  }
  const width = rows.length === 0 ? 0 : widest + 2 * GIVENS_PADDING
  const height = rows.length === 0 ? 0 : inner + 2 * GIVENS_PADDING

  const left = content.x
  const right = content.x + content.width - width
  const above = content.y - GIVENS_GAP - height
  const below = content.y + content.height + GIVENS_GAP
  const middle = content.y + content.height / 2 - height / 2

  let x: number
  let y: number
  switch (position) {
    case 'top-left':
      x = left
      y = above
      break
    case 'top-right':
      x = right
      y = above
      break
    case 'bottom-left':
      x = left
      y = below
      break
    case 'bottom-right':
      x = right
      y = below
      break
    case 'left':
      x = content.x - GIVENS_GAP - width
      y = middle
      break
    case 'right':
      x = content.x + content.width + GIVENS_GAP
      y = middle
      break
  }

  const box = { x, y, width, height }
  const placed: Vec2[] = []
  let cursor = y + GIVENS_PADDING
  for (const row of rows) {
    placed.push({ x: x + GIVENS_PADDING, y: cursor - row.top })
    cursor += row.bottom - row.top + GIVENS_ROW_GAP
  }
  return { box, rows: placed }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function figureDocument(layers: FigureLayers, viewBox: Rect, theme: FigureTheme, extra: SvgAttrs = {}): string {
  const groups = FIGURE_LAYERS.map((layer) => svgGroup(layers[layer], { 'data-layer': layer }))
  const box = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`
  // The paper. A figure embedded in a page needs its own background for the
  // same reason a printed figure sits on a white box: the surrounding page
  // is not guaranteed to be the theme's surface colour.
  const paper =
    `<rect x="${fmt(viewBox.x)}" y="${fmt(viewBox.y)}" width="${fmt(viewBox.width)}" height="${fmt(viewBox.height)}"` +
    ` fill="${theme.background}" data-layer="paper"/>`
  let attributes = ''
  for (const key of Object.keys(extra)) {
    const value = extra[key]
    if (value === null || value === undefined) continue
    attributes += ` ${key}="${typeof value === 'number' ? fmt(value) : value}"`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet"${attributes}>` +
    paper +
    groups.join('') +
    '</svg>'
  )
}
