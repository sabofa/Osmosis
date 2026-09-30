// The colorbars (plan E5, spec SP5 "Colorbar"): the DOM for colorbarModel.ts.
// A column on the right edge of the overlay, inset 16 px, of at most two
// blocks, each a title above a 12 x 160 px gradient strip with its tick
// labels to the strip's left. Pointer events are off, like the rest of the
// overlay. Rebuilt only when the scene or the theme changes.

import type { ColorbarModel } from './colorbarModel'

export class Colorbars {
  readonly element: HTMLDivElement
  private blocks: HTMLElement[] = []
  // S6 fix round 1, I6: every tick label span, so SpaceRenderer.ts's
  // chromeRects() can measure them too — a tick's `right: 18px` (SpaceView
  // .css) places it outside .space-colorbar-body's own box (an absolutely
  // positioned child never grows its parent's measured rect), so the
  // container alone under-reports how far left the chrome actually reaches.
  private ticks: HTMLElement[] = []
  // What is shown, so an identical update touches no DOM.
  private shown = ''

  constructor(overlay: HTMLElement) {
    this.element = overlay.ownerDocument.createElement('div')
    this.element.className = 'space-colorbars'
    overlay.appendChild(this.element)
  }

  // Returns whether it actually rebuilt anything (S6 fix round 1, I6: the
  // caller uses this to know whether the chrome really moved, rather than
  // invalidating its cached rectangle on every call, most of which — every
  // frame of an unrelated play or drag — touch no colorbar DOM at all).
  update(models: readonly ColorbarModel[]): boolean {
    const key = JSON.stringify(models.map((m) => [m.title, m.gradient, m.ticks.map((t) => [t.text, t.position, t.zero])]))
    if (key === this.shown) return false
    this.shown = key
    const doc = this.element.ownerDocument
    for (const b of this.blocks) b.remove()
    this.blocks = []
    this.ticks = []
    for (const model of models) {
      const block = doc.createElement('div')
      block.className = 'space-colorbar'
      const title = doc.createElement('div')
      title.className = 'space-colorbar-title'
      title.textContent = model.title
      const body = doc.createElement('div')
      body.className = 'space-colorbar-body'
      const strip = doc.createElement('div')
      strip.className = 'space-colorbar-strip'
      strip.style.background = model.gradient
      body.appendChild(strip)
      for (const tick of model.ticks) {
        const label = doc.createElement('span')
        label.className = 'space-colorbar-tick'
        if (tick.zero) label.dataset.zero = 'true'
        label.style.bottom = `${(tick.position * 100).toFixed(2)}%`
        label.textContent = tick.text
        body.appendChild(label)
        this.ticks.push(label)
      }
      block.appendChild(title)
      block.appendChild(body)
      this.element.appendChild(block)
      this.blocks.push(block)
    }
    return true
  }

  // The blocks shown, for tests.
  get count(): number {
    return this.blocks.length
  }

  // S6 fix round 1, I6: every tick label's element, for chromeRects().
  tickElements(): readonly HTMLElement[] {
    return this.ticks
  }

  dispose(): void {
    this.blocks = []
    this.ticks = []
    this.element.remove()
  }
}
