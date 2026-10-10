import { formatFocus, type FocusTarget } from '../view2d/focus'
import { formatPoint } from '../view2d/readout'
import { distanceToShape } from '../view2d/pointing'
import type { Camera, Vec } from '../view2d/types'
import type { GivensPosition } from '../parser/config'
import { viewToAuthorPlane, type FigureFrame } from './frame'
import type { FigureHitItem } from './hitItems'

// What the coordinate tool says, as pure decisions: the cursor's line, the
// centre's, and the `@focus:` line Copy writes. The component only displays
// what this returns.
//
// A flat figure can be read both ways (the frame is an invertible map), so its
// lines are in the author's own (x, y). A solid figure's drawing is a
// projection and cannot be inverted: a point of the picture is a whole line in
// space. So there the tool names what it can: a vertex or point under the
// cursor by its (X, Y, Z), anything else by the drawing's own units, written
// `view (u, v)` — which `@focus:` reads back, and which is stable for a fixed
// spec and camera.

const NO_POINTER = '—'

// The (X, Y, Z) an item stands for, when it has a space point of its own.
function spaceAuthor(item: FigureHitItem | null): { x: number; y: number; z: number } | null {
  const author = item?.author
  return author && author.z !== undefined ? { x: author.x, y: author.y, z: author.z } : null
}

// The item an id names. A label shares the id of the object it names and comes
// after it in the list, so the plain first or last match would sometimes be the
// label, which has no coordinates. Prefer the one that knows where it is.
export function itemForId(items: readonly FigureHitItem[], id: string | null): FigureHitItem | null {
  if (id === null) return null
  let first: FigureHitItem | null = null
  for (const item of items) {
    if (item.id !== id) continue
    if (item.author) return item
    first ??= item
  }
  return first
}

// Where the coordinate tool sits in the figure's frame. Bottom-left, its panel
// opening upward, unless the figure's givens table is there: `@givens`
// defaults to the top-left, so the tool must stay out of that corner's way
// too, and the reset button owns the bottom-right. A givens table at the
// bottom-left, or down the left side, sends the tool to the top-right.
export type ToolCorner = 'bottom-left' | 'top-right'

export function toolCorner(givens: GivensPosition): ToolCorner {
  return givens === 'bottom-left' || givens === 'left' ? 'top-right' : 'bottom-left'
}

// Where the cursor is. `pointer` is in drawing units; null: it is off the view.
export function cursorText(frame: FigureFrame, pointer: Vec | null, hovered: FigureHitItem | null): string {
  if (!pointer) return NO_POINTER
  if (frame.kind === 'plane') {
    const at = viewToAuthorPlane(frame, pointer)
    return at ? formatPoint([at.x, at.y]) : NO_POINTER
  }
  const author = spaceAuthor(hovered)
  return author ? formatPoint([author.x, author.y, author.z]) : `view ${formatPoint([pointer.x, pointer.y])}`
}

// What the view is centred on, as a focus target.
function centreTarget(frame: FigureFrame, camera: Camera, items: readonly FigureHitItem[], tolerance: number): FocusTarget {
  const centre = { x: camera.cx, y: camera.cy }
  if (frame.kind === 'plane') {
    const at = viewToAuthorPlane(frame, centre)
    if (at) return { kind: 'plane', x: at.x, y: at.y }
  } else {
    // The nearest space point within the tolerance of the centre (<=, so a
    // vertex exactly a tolerance away still counts).
    let best: { author: { x: number; y: number; z: number }; distance: number } | null = null
    for (const item of items) {
      const author = spaceAuthor(item)
      if (!author || item.shape.kind !== 'point') continue
      const distance = distanceToShape(centre, item.shape)
      if (distance <= tolerance && (!best || distance < best.distance)) best = { author, distance }
    }
    if (best) return { kind: 'space', x: best.author.x, y: best.author.y, z: best.author.z }
  }
  return { kind: 'view', u: centre.x, v: centre.y }
}

// The centre of the view, as `@focus:` would write it: "(3, 2)", or
// "view (u, v)" where a solid figure has no vertex there.
export function centreText(frame: FigureFrame, camera: Camera, items: readonly FigureHitItem[], tolerance: number): string {
  return formatFocus({ target: centreTarget(frame, camera, items, tolerance), zoom: 1 })
}

// The line that puts a view back here: "@focus: (3, 2) zoom 4". `tolerance` is
// in drawing units (the pixel tolerance over the current pixels per unit).
export function focusLineFor(frame: FigureFrame, camera: Camera, items: readonly FigureHitItem[], tolerance: number): string {
  return `@focus: ${formatFocus({ target: centreTarget(frame, camera, items, tolerance), zoom: camera.zoom })}`
}
