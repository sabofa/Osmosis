import { tag, type Attributes, type Box } from '../markup'

// What the papers share: the area they cover and a sheet of colour over it.

// Three view boxes beyond the figure on every side: seven across in all.
export function cover(view: Box): Box {
  return { x: view.x - 3 * view.width, y: view.y - 3 * view.height, width: 7 * view.width, height: 7 * view.height }
}

// A rectangle over the whole cover, painted with `fill` (a colour, or a
// pattern's url).
export function sheet(view: Box, fill: string, extra: Attributes = {}): string {
  const box = cover(view)
  return tag('rect', { x: box.x, y: box.y, width: box.width, height: box.height, fill, ...extra })
}
