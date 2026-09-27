// A keyed pool of label spans (plan G10). Items with the same key reuse the
// same span across frames, so a camera move only rewrites transforms; a key
// that disappears removes its span. The DOM work is this thin loop; what to
// show and where comes from ui/layout.ts.

import type { LabelItem } from './layout'

interface PooledSpan {
  span: HTMLSpanElement
  text: string
  role: string
  transform: string
  shown: boolean
}

// 'label' anchors at its bottom-left corner; ticks and titles are centred.
// Whole pixels: text at a half-pixel offset renders visibly greyer.
export function labelTransform(item: LabelItem): string {
  const x = Math.round(item.x)
  const y = Math.round(item.y)
  return item.role === 'label' ? `translate(${x}px, ${y}px) translate(0, -100%)` : `translate(${x}px, ${y}px) translate(-50%, -50%)`
}

export class LabelPool {
  private readonly container: HTMLElement
  private readonly spans = new Map<string, PooledSpan>()

  constructor(container: HTMLElement) {
    this.container = container
  }

  get size(): number {
    return this.spans.size
  }

  sync(items: readonly LabelItem[]): void {
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.key)
      let entry = this.spans.get(item.key)
      if (!entry) {
        const span = this.container.ownerDocument.createElement('span')
        span.className = 'space-label'
        entry = { span, text: '', role: '', transform: '', shown: true }
        this.container.appendChild(span)
        this.spans.set(item.key, entry)
      }
      if (entry.text !== item.text) {
        entry.span.textContent = item.text
        entry.text = item.text
      }
      if (entry.role !== item.role) {
        entry.span.dataset.role = item.role
        entry.role = item.role
      }
      if (item.visible) {
        const transform = labelTransform(item)
        if (entry.transform !== transform) {
          entry.span.style.transform = transform
          entry.transform = transform
        }
      }
      if (entry.shown !== item.visible) {
        entry.span.style.display = item.visible ? '' : 'none'
        entry.shown = item.visible
      }
    }
    for (const [key, entry] of this.spans) {
      if (seen.has(key)) continue
      entry.span.remove()
      this.spans.delete(key)
    }
  }

  clear(): void {
    for (const entry of this.spans.values()) entry.span.remove()
    this.spans.clear()
  }
}
