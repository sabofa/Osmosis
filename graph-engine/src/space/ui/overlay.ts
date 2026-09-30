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

// S6 plan V9: a state message is a one-line reason and, where useful, a
// next step (a separate, quieter line) — no WebGL2, a lost context, a
// shader compile failure, an empty scene.
export interface StateMessage {
  reason: string
  next?: string
}

export class Overlay {
  readonly element: HTMLDivElement
  private readonly pool: LabelPool
  private message: HTMLDivElement | null = null
  private card: HTMLDivElement | null = null
  private reasonEl: HTMLDivElement | null = null
  private nextEl: HTMLDivElement | null = null

  constructor(canvas: HTMLCanvasElement) {
    const doc = canvas.ownerDocument
    this.element = doc.createElement('div')
    this.element.className = 'space-overlay'
    const parent = canvas.parentElement
    if (parent) parent.appendChild(this.element)
    this.pool = new LabelPool(this.element)
  }

  // S6 plan V10: the whole chrome's one visual language — the message card
  // (V9), the parameter panel, the colorbar and the readout boxes (probe.ts)
  // all read these four custom properties, so a theme change moves every
  // one of them together. --space-line is `grid` (S6 fix round 1, M6: not
  // gridStrong) — render/palette.ts's TOKEN_FOR maps `grid` to the host's
  // own --line token and `gridStrong` to --line-strong, so a hairline
  // chrome border reads as the host's ordinary line weight, not its
  // emphasised one (gridStrong is for the graph's own axis-adjacent grid,
  // a different, stronger role).
  setColors(colors: SpaceColors): void {
    this.element.style.color = cssRgb(colors.axis)
    this.element.style.setProperty('--space-ink', cssRgb(colors.axis))
    this.element.style.setProperty('--space-surface', cssRgb(colors.background))
    this.element.style.setProperty('--space-line', cssRgb(colors.grid))
    this.element.style.setProperty('--space-muted', cssRgb(colors.muted))
  }

  update(items: readonly LabelItem[]): void {
    this.pool.sync(items)
  }

  // S6 fix round 1, M2: passed to layoutLabels() so the placer can size a
  // currently expanded readout from its full text.
  isExpanded(key: string): boolean {
    return this.pool.isExpanded(key)
  }

  // A message in place of the view (no WebGL2, a lost context, a shader
  // failure, an empty scene — S6 plan V9), or null to clear it. A plain
  // string is the reason alone; { reason, next } adds a quieter next-step
  // line.
  showMessage(text: string | StateMessage | null): void {
    if (text === null) {
      this.message?.remove()
      this.message = null
      this.card = null
      this.reasonEl = null
      this.nextEl = null
      return
    }
    const doc = this.element.ownerDocument
    if (!this.message) {
      this.message = doc.createElement('div')
      this.message.className = 'space-message'
      this.message.setAttribute('role', 'alert')
      this.card = doc.createElement('div')
      this.card.className = 'space-message-card'
      this.reasonEl = doc.createElement('div')
      this.reasonEl.className = 'space-message-reason'
      this.card.appendChild(this.reasonEl)
      this.message.appendChild(this.card)
      this.element.appendChild(this.message)
    }
    const { reason, next } = typeof text === 'string' ? { reason: text, next: undefined } : text
    this.reasonEl!.textContent = reason
    if (next) {
      if (!this.nextEl) {
        this.nextEl = doc.createElement('div')
        this.nextEl.className = 'space-message-next'
        this.card!.appendChild(this.nextEl)
      }
      this.nextEl.textContent = next
    } else {
      this.nextEl?.remove()
      this.nextEl = null
    }
  }

  dispose(): void {
    this.pool.clear()
    this.message = null
    this.card = null
    this.reasonEl = null
    this.nextEl = null
    this.element.remove()
  }
}
