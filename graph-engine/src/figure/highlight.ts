import type { HitShape } from '../view2d/pointing'
import type { Vec } from '../view2d/types'
import { itemForId } from './focusLine'
import type { FigureHitItem, FigureTarget } from './hitItems'

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
// `ids` are the hovered item id and the selected item ids, for the one element
// that has no statement to match by: the givens panel.
export function highlightOf(
  statement: string | null,
  object: string | null,
  hovered: readonly FigureTarget[],
  selected: readonly FigureTarget[],
  ids?: { hovered: string | null; selected: readonly string[] },
): { hovered: boolean; selected: boolean } {
  const panel = object === GIVENS
  return {
    hovered: matchesAny(statement, object, hovered) || (panel && ids?.hovered === GIVENS),
    selected: matchesAny(statement, object, selected) || (panel && ids?.selected.includes(GIVENS) === true),
  }
}

// What a selection reports for the ids selected: each id's item, in the order
// given. An id that names no item is left out. (Not a map by id: a label
// shares its object's id and comes after it, so a map would hold the label,
// which has no author coordinates; itemForId prefers the one that has.)
export function selectedItems(
  items: readonly FigureHitItem[],
  ids: readonly string[],
): { id: string; targets: FigureTarget[]; author?: FigureHitItem['author'] }[] {
  const out: { id: string; targets: FigureTarget[]; author?: FigureHitItem['author'] }[] = []
  for (const id of ids) {
    const item = itemForId(items, id)
    if (item) out.push({ id: item.id, targets: item.targets, author: item.author })
  }
  return out
}

// Of the elements that match, those that must carry the look: the outermost.
//
// A styled figure puts the identity on a group *and* on every path inside it (a
// scribble or a chalk fill has hundreds). A filter on each of them would run
// once per path, nested in the group's own, which is what made a selection
// lag. The group's filter already draws everything inside it, so a match with
// a matched ancestor is skipped. `parent` gives a node's parent (null at the
// top). Order is kept. Cost is the number of matches times the depth.
export function outermostMatches<N>(matches: readonly N[], parent: (node: N) => N | null): N[] {
  const matched = new Set<N>(matches)
  return matches.filter((node) => {
    for (let up = parent(node); up !== null; up = parent(up)) if (matched.has(up)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// The look, as a clean overlay
// ---------------------------------------------------------------------------
//
// Hover and selection are drawn as plain lines laid over the figure, from the
// item's own hit shape (figure/hitItems.ts), not by running a filter over the
// item. Under a textured style an item is hundreds of paths with a texture
// filter of its own, and a second filter over that was what made a selection
// lag; a plain stroked path costs next to nothing and looks the same under every
// style. Strokes use `vector-effect: non-scaling-stroke`, so their widths are
// in screen pixels at any zoom, and the overlay sits inside the <svg> so it
// moves with the live transform.

const HOVER_WIDTH_PX = 3.5
const HOVER_OPACITY = 0.7
const SELECT_CORE_PX = 2.5
const SELECT_HALO_PX = 8
const HALO_OPACITY = 0.35
// A point is a round dot as wide as its stroke, so it is drawn heavier.
const POINT_GAIN = 2.5
const DEFAULT_ACCENT = '#3b6fd8'
// The id of the givens item; its rect is the one rect that is an outline to draw
// (a label's rect is only a place to point at).
const GIVENS_ID = 'givens'

const num = (n: number): string => String(Number(n.toPrecision(10)))
const pt = (p: Vec): string => `${num(p.x)} ${num(p.y)}`

function pathOf(points: readonly Vec[], closed: boolean): string {
  return `M${points.map(pt).join('L')}${closed ? 'Z' : ''}`
}

// The shape as the `d` of one path (or a circle's attributes), null when there
// is nothing to draw. Angles are the hit shape's own (view coordinates).
function shapeElement(shape: HitShape, id: string): { tag: 'path'; d: string; point: boolean } | { tag: 'circle'; at: Vec; r: number } | null {
  switch (shape.kind) {
    case 'point':
      return { tag: 'path', d: `M${pt(shape.at)}L${pt(shape.at)}`, point: true }
    case 'segment':
      return { tag: 'path', d: pathOf([shape.a, shape.b], false), point: false }
    case 'polyline':
      return shape.points.length < 2 ? null : { tag: 'path', d: pathOf(shape.points, shape.closed), point: false }
    case 'polygon':
      return shape.points.length < 3 ? null : { tag: 'path', d: pathOf(shape.points, true), point: false }
    case 'circle':
      return { tag: 'circle', at: shape.center, r: shape.radius }
    case 'arc': {
      const sweep = shape.end - shape.start
      if (Math.abs(sweep) >= Math.PI * 2) return { tag: 'circle', at: shape.center, r: shape.radius }
      const at = (t: number): Vec => ({ x: shape.center.x + shape.radius * Math.cos(t), y: shape.center.y + shape.radius * Math.sin(t) })
      const large = Math.abs(sweep) > Math.PI ? 1 : 0
      // Increasing angle runs clockwise on screen (y points down).
      const flag = sweep > 0 ? 1 : 0
      return { tag: 'path', d: `M${pt(at(shape.start))}A${num(shape.radius)} ${num(shape.radius)} 0 ${large} ${flag} ${pt(at(shape.end))}`, point: false }
    }
    case 'rect': {
      if (id !== GIVENS_ID) return null
      const { x, y, width, height } = shape.rect
      return { tag: 'path', d: pathOf([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], true), point: false }
    }
  }
}

function stroked(items: readonly { id: string; shape: HitShape }[], id: string, color: string, widthPx: number, opacity: number): string {
  let out = ''
  for (const item of items) {
    if (item.id !== id) continue
    const element = shapeElement(item.shape, id)
    if (!element) continue
    const attrs = `fill="none" stroke="${color}" stroke-width="${num(widthPx * (element.tag === 'path' && element.point ? POINT_GAIN : 1))}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`
    out +=
      element.tag === 'path'
        ? `<path d="${element.d}" ${attrs}/>`
        : `<circle cx="${num(element.at.x)}" cy="${num(element.at.y)}" r="${num(element.r)}" ${attrs}/>`
  }
  return out
}

// The overlay's markup for the hovered item and the selected ones, empty when
// nothing is pointed at. Every item of an id is drawn (an arc and its sector,
// the edges of a face). A selection is a soft wide stroke under a thin core,
// both in the accent; hover is a thicker line over the top.
export function highlightOverlay(
  items: readonly { id: string; shape: HitShape }[],
  hovered: string | null,
  selected: readonly string[],
  accent: string,
): string {
  let body = ''
  for (const id of selected) body += stroked(items, id, accent, SELECT_HALO_PX, HALO_OPACITY) + stroked(items, id, accent, SELECT_CORE_PX, 1)
  if (hovered !== null) body += stroked(items, hovered, accent, HOVER_WIDTH_PX, HOVER_OPACITY)
  return body === '' ? '' : `<g data-figure-highlight="" pointer-events="none">${body}</g>`
}

// The host's accent colour (the `--accent` custom property, read from the
// computed style), or the default blue when it defines none.
export function highlightAccent(value: string | null | undefined): string {
  const accent = value?.trim()
  return accent ? accent : DEFAULT_ACCENT
}
