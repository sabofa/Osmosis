// A keyed pool of label spans (plan G10; S6 plan V2 adds leader lines).
// Items with the same key reuse the same span across frames, so a camera
// move only rewrites transforms; a key that disappears removes its span. The
// DOM work is this thin loop; what to show and where comes from ui/layout.ts.

import type { LabelItem, Leader } from './layout'

interface PooledSpan {
  span: HTMLSpanElement
  text: string
  role: string
  transform: string
  shown: boolean
}

interface PooledLeader {
  div: HTMLDivElement
  transform: string
  width: string
}

// 'label' anchors at its bottom-left corner; ticks and titles are centred.
// Whole pixels: text at a half-pixel offset renders visibly greyer.
export function labelTransform(item: LabelItem): string {
  const x = Math.round(item.x)
  const y = Math.round(item.y)
  return item.role === 'label' ? `translate(${x}px, ${y}px) translate(0, -100%)` : `translate(${x}px, ${y}px) translate(-50%, -50%)`
}

// A 1 px-tall div, scaled to the leader's length and rotated to its angle —
// the usual line-as-div trick, so the overlay stays text-and-div, no SVG.
export function leaderStyle(leader: Leader): { transform: string; width: string } {
  const dx = leader.x2 - leader.x1
  const dy = leader.y2 - leader.y1
  const length = Math.hypot(dx, dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  return { transform: `translate(${leader.x1}px, ${leader.y1}px) rotate(${angle}deg)`, width: `${length}px` }
}

export class LabelPool {
  private readonly container: HTMLElement
  private readonly spans = new Map<string, PooledSpan>()
  private readonly leaders = new Map<string, PooledLeader>()

  constructor(container: HTMLElement) {
    this.container = container
  }

  get size(): number {
    return this.spans.size
  }

  sync(items: readonly LabelItem[]): void {
    const seen = new Set<string>()
    const leaderKeys = new Set<string>()
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

      if (item.visible && item.leader) {
        leaderKeys.add(item.key)
        let line = this.leaders.get(item.key)
        if (!line) {
          const div = this.container.ownerDocument.createElement('div')
          div.className = 'space-leader'
          this.container.appendChild(div)
          line = { div, transform: '', width: '' }
          this.leaders.set(item.key, line)
        }
        const style = leaderStyle(item.leader)
        if (line.transform !== style.transform) {
          line.div.style.transform = style.transform
          line.transform = style.transform
        }
        if (line.width !== style.width) {
          line.div.style.width = style.width
          line.width = style.width
        }
      }
    }
    for (const [key, entry] of this.spans) {
      if (seen.has(key)) continue
      entry.span.remove()
      this.spans.delete(key)
    }
    for (const [key, line] of this.leaders) {
      if (leaderKeys.has(key)) continue
      line.div.remove()
      this.leaders.delete(key)
    }
  }

  clear(): void {
    for (const entry of this.spans.values()) entry.span.remove()
    this.spans.clear()
    for (const line of this.leaders.values()) line.div.remove()
    this.leaders.clear()
  }
}
