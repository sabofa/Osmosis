import type { Rect } from '../view2d/types'
import type { FigureTarget } from './hitItems'

// Which elements of a rendered figure light up for a hovered or a selected
// item. The markup is never changed to say so: the view adds a class to the
// elements that already carry the identity (`data-statement`, `data-object`),
// which is why it works under every style.

function matchesAny(statement: string | null, object: string | null, targets: readonly FigureTarget[]): boolean {
  if (statement === null) return false
  for (const target of targets) {
    if (String(target.statement) !== statement) continue
    // A target without an object means the whole statement; one with an
    // object means that object only.
    if (target.object === null || target.object === object) return true
  }
  return false
}

// The id of the givens item (hitItems.ts), and the `data-object` its panel
// carries. The panel has no `data-statement`, so it is matched by id.
const GIVENS = 'givens'

// `statement` and `object` are the element's attribute text, null when absent.
// `ids` are the hovered and selected item ids, for the one element that has no
// statement to match by: the givens panel.
export function highlightOf(
  statement: string | null,
  object: string | null,
  hovered: readonly FigureTarget[],
  selected: readonly FigureTarget[],
  ids?: { hovered: string | null; selected: string | null },
): { hovered: boolean; selected: boolean } {
  const panel = object === GIVENS
  return {
    hovered: matchesAny(statement, object, hovered) || (panel && ids?.hovered === GIVENS),
    selected: matchesAny(statement, object, selected) || (panel && ids?.selected === GIVENS),
  }
}

// ---------------------------------------------------------------------------
// The look, as SVG filters
// ---------------------------------------------------------------------------
//
// Hover thickens the item a little in its own colour; selection lays a soft
// accent halo behind it. Both are SVG filters the view injects into the live
// <svg> at run time (never the renderer's markup), because a CSS
// `drop-shadow(...)` on an SVG child is measured in drawing units and so grows
// with the zoom: about 30 px at 12x. A filter's own lengths are in drawing
// units too, so they are rewritten every frame as (target px) / (px per unit),
// which holds them at the same size on screen at any zoom.

const HOVER_RADIUS_PX = 0.75 // how far hover grows the stroke or ring
const HALO_DEVIATION_PX = 1.5 // the halo's blur: a halo about 3 px wide
const HALO_OPACITY = 0.55
// A hairline's blurred alpha peaks well under what a halo needs, so it is
// lifted before the flood tints it.
const HALO_GAIN = 3
const DEFAULT_ACCENT = '#3b6fd8'

export interface HighlightFilterSizes {
  hoverRadius: number
  haloDeviation: number
}

// The filters' lengths in drawing units. A degenerate scale (an unmeasured
// view) counts as one pixel per unit.
export function highlightFilterSizes(pxPerUnit: number): HighlightFilterSizes {
  const ppu = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 1
  return { hoverRadius: HOVER_RADIUS_PX / ppu, haloDeviation: HALO_DEVIATION_PX / ppu }
}

// The region the filters work in: the window grown by its own size on every
// side. Given in drawing units (userSpaceOnUse), not as a fraction of each
// element's box: a horizontal line has a zero-height box, and a filter
// region of zero height draws nothing at all.
export function highlightFilterRegion(visible: Rect): Rect {
  return { x: visible.x - visible.width, y: visible.y - visible.height, width: visible.width * 3, height: visible.height * 3 }
}

const num = (n: number): string => String(Number(n.toPrecision(10)))

export interface HighlightDefsInput {
  hoverId: string
  selectId: string
  accent: string
  region: Rect
  sizes: HighlightFilterSizes
}

// The two filters, as markup for an SVG `<defs>`. The two lengths are marked
// (`data-size`) so the view can find and rewrite them every frame.
export function highlightDefs({ hoverId, selectId, accent, region, sizes }: HighlightDefsInput): string {
  const frame = `filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}" color-interpolation-filters="sRGB"`
  return (
    '<defs>' +
    `<filter id="${hoverId}" ${frame}>` +
    `<feMorphology in="SourceGraphic" operator="dilate" radius="${num(sizes.hoverRadius)}" data-size="hover" result="thick"/>` +
    '<feMerge><feMergeNode in="thick"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
    `<filter id="${selectId}" ${frame}>` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(sizes.haloDeviation)}" data-size="halo" result="blur"/>` +
    `<feComponentTransfer in="blur" result="strong"><feFuncA type="linear" slope="${HALO_GAIN}"/></feComponentTransfer>` +
    `<feFlood flood-color="${accent}" flood-opacity="${HALO_OPACITY}" result="tint"/>` +
    '<feComposite in="tint" in2="strong" operator="in" result="halo"/>' +
    '<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
    '</defs>'
  )
}

// The inline `filter` an element gets. An item that is both hovered and
// selected is thickened first and then haloed, so the halo follows the
// thickened shape.
export function highlightFilterValue(lit: { hovered: boolean; selected: boolean }, ids: { hoverId: string; selectId: string }): string {
  const parts: string[] = []
  if (lit.hovered) parts.push(`url(#${ids.hoverId})`)
  if (lit.selected) parts.push(`url(#${ids.selectId})`)
  return parts.join(' ')
}

// The host's accent colour (the `--accent` custom property, read from the
// computed style), or the default blue when it defines none.
export function highlightAccent(value: string | null | undefined): string {
  const accent = value?.trim()
  return accent ? accent : DEFAULT_ACCENT
}
