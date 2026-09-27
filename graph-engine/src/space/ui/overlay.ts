// The DOM overlay for all of space's text (plan G10): one absolutely
// positioned layer over the canvas, holding a keyed pool of label spans and,
// when the view cannot be drawn, a legible message.
//
// Contract with the host: the overlay is created as a sibling of the canvas
// inside the canvas's parent, which must be `position: relative` (GraphViewer
// sets it; the review page too); dispose() removes it. Pointer events are off
// on the whole layer, so the canvas receives all input.

import { cssRgb, type SpaceColors } from '../theme'
import type { LabelItem } from './layout'
import { LabelPool } from './labelPool'
import './SpaceView.css'

export class Overlay {
  readonly element: HTMLDivElement
  private readonly pool: LabelPool
  private message: HTMLDivElement | null = null

  constructor(canvas: HTMLCanvasElement) {
    const doc = canvas.ownerDocument
    this.element = doc.createElement('div')
    this.element.className = 'space-overlay'
    const parent = canvas.parentElement
    if (parent) parent.appendChild(this.element)
    this.pool = new LabelPool(this.element)
  }

  setColors(colors: SpaceColors): void {
    this.element.style.color = cssRgb(colors.axis)
  }

  update(items: readonly LabelItem[]): void {
    this.pool.sync(items)
  }

  // A message in place of the view (no WebGL2, a shader failure), or null to clear it.
  showMessage(text: string | null): void {
    if (text === null) {
      this.message?.remove()
      this.message = null
      return
    }
    if (!this.message) {
      this.message = this.element.ownerDocument.createElement('div')
      this.message.className = 'space-message'
      this.message.setAttribute('role', 'alert')
      this.element.appendChild(this.message)
    }
    this.message.textContent = text
  }

  dispose(): void {
    this.pool.clear()
    this.message = null
    this.element.remove()
  }
}
