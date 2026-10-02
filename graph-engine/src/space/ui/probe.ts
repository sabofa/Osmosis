// Readout boxes (plan E9, E10): the probe's box beside the cursor and each
// pin's beside its marker. DOM, pointer events off (the overlay's), keyed so
// a moving box only rewrites its transform.
//
// A box sits 14 px from its anchor, on whichever side keeps it in the view:
// left of the anchor in the view's right half, above it in the bottom half.
// That is decided from the anchor alone, so no layout is ever read.

import type { ReadoutRow } from '../pick/types'
import { cssRgb, type SpaceColors } from '../theme'

export const READOUT_OFFSET_PX = 14

export interface ReadoutItem {
  key: string
  title: string
  rows: readonly ReadoutRow[]
  // The anchor, CSS px in the viewport.
  x: number
  y: number
  pinned: boolean
}

interface Box {
  element: HTMLDivElement
  content: string
  transform: string
}

export function readoutTransform(x: number, y: number, width: number, height: number): string {
  const dx = x > width / 2 ? `calc(-100% - ${READOUT_OFFSET_PX}px)` : `${READOUT_OFFSET_PX}px`
  const dy = y > height / 2 ? `calc(-100% - ${READOUT_OFFSET_PX}px)` : `${READOUT_OFFSET_PX}px`
  return `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(${dx}, ${dy})`
}

export class ReadoutBoxes {
  private readonly container: HTMLElement
  private readonly boxes = new Map<string, Box>()
  private colors: SpaceColors | null = null

  constructor(overlay: HTMLElement) {
    this.container = overlay
  }

  get size(): number {
    return this.boxes.size
  }

  // S6 plan V10: the live boxes' elements, so SpaceRenderer.ts can measure
  // their rectangles for the label placer's chrome-avoidance.
  elements(): readonly HTMLElement[] {
    return [...this.boxes.values()].map((b) => b.element)
  }

  setColors(colors: SpaceColors): void {
    this.colors = colors
    for (const box of this.boxes.values()) this.paint(box.element)
  }

  sync(items: readonly ReadoutItem[], width: number, height: number): void {
    const doc = this.container.ownerDocument
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.key)
      let box = this.boxes.get(item.key)
      if (!box) {
        const element = doc.createElement('div')
        element.className = 'space-readout'
        this.paint(element)
        this.container.appendChild(element)
        box = { element, content: '', transform: '' }
        this.boxes.set(item.key, box)
      }
      const content = `${item.pinned}|${item.title}|${item.rows.map((r) => `${r.label}=${r.value}`).join('|')}`
      if (box.content !== content) {
        this.fill(box.element, item)
        box.content = content
      }
      const transform = readoutTransform(item.x, item.y, width, height)
      if (box.transform !== transform) {
        box.element.style.transform = transform
        box.transform = transform
      }
    }
    for (const [key, box] of this.boxes) {
      if (seen.has(key)) continue
      box.element.remove()
      this.boxes.delete(key)
    }
  }

  dispose(): void {
    for (const box of this.boxes.values()) box.element.remove()
    this.boxes.clear()
  }

  private paint(element: HTMLDivElement): void {
    if (!this.colors) return
    element.style.background = cssRgb(this.colors.background)
    element.style.borderColor = cssRgb(this.colors.gridStrong)
    element.style.color = cssRgb(this.colors.axis)
  }

  private fill(element: HTMLDivElement, item: ReadoutItem): void {
    const doc = element.ownerDocument
    for (const child of Array.from((element as unknown as { children: ArrayLike<HTMLElement> }).children)) child.remove()
    if (item.pinned) element.dataset.pinned = 'true'
    else delete element.dataset.pinned
    const title = doc.createElement('div')
    title.className = 'space-readout-title'
    title.textContent = item.title
    element.appendChild(title)
    const rows = doc.createElement('div')
    rows.className = 'space-readout-rows'
    for (const row of item.rows) {
      const label = doc.createElement('span')
      label.className = 'space-readout-label'
      label.textContent = row.label
      const value = doc.createElement('span')
      value.className = 'space-readout-value'
      value.textContent = row.value
      rows.appendChild(label)
      rows.appendChild(value)
    }
    element.appendChild(rows)
  }
}
