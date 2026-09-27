// The colorbars (plan E5, spec SP5 "Colorbar"): the DOM for colorbarModel.ts.
// A column on the right edge of the overlay, inset 16 px, of at most two
// blocks, each a title above a 12 x 160 px gradient strip with its tick
// labels to the strip's left. Pointer events are off, like the rest of the
// overlay. Rebuilt only when the scene or the theme changes.

import type { ColorbarModel } from './colorbarModel'

export class Colorbars {
  readonly element: HTMLDivElement
  private blocks: HTMLElement[] = []

  constructor(overlay: HTMLElement) {
    this.element = overlay.ownerDocument.createElement('div')
    this.element.className = 'space-colorbars'
    overlay.appendChild(this.element)
  }

  update(models: readonly ColorbarModel[]): void {
    const doc = this.element.ownerDocument
    for (const b of this.blocks) b.remove()
    this.blocks = []
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
      }
      block.appendChild(title)
      block.appendChild(body)
      this.element.appendChild(block)
      this.blocks.push(block)
    }
  }

  // The blocks shown, for tests.
  get count(): number {
    return this.blocks.length
  }

  dispose(): void {
    this.blocks = []
    this.element.remove()
  }
}
