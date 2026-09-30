// S6 plan V3: a readout with more digits than its display text shows can be
// clicked to expand, in place, back to its capped text on a second click.

import { describe, expect, it } from 'vitest'
import { FakeDocument } from '../testing/fakeDom'
import { LabelPool, leaderStyle } from './labelPool'
import type { LabelItem } from './layout'

const base: Omit<LabelItem, 'text' | 'fullText'> = { key: 'label:0:s1.readout', x: 10, y: 20, role: 'label', visible: true, leader: null }

function newPool() {
  const doc = new FakeDocument()
  const container = doc.createElement('div')
  const pool = new LabelPool(container as unknown as HTMLElement)
  return { pool, container }
}

describe('LabelPool: the V3 click-to-expand readout', () => {
  it('a label with no fullText never opts into pointer events', () => {
    const { pool, container } = newPool()
    pool.sync([{ ...base, text: 'area ≈ 1.571' }])
    const span = container.children[0]
    expect(span.dataset.expandable).toBeUndefined()
    expect(span.textContent).toBe('area ≈ 1.571')
  })

  it('a click on an expandable label shows the full text; a second click restores the capped one', () => {
    const { pool, container } = newPool()
    pool.sync([{ ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5707963267' }])
    const span = container.children[0]
    expect(span.dataset.expandable).toBe('true')
    expect(span.textContent).toBe('area ≈ 1.571')
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.5707963267')
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.571')
  })

  it('stays expanded across a resync with the same fullText (a camera move), and the span is reused', () => {
    const { pool, container } = newPool()
    const item: LabelItem = { ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5707963267' }
    pool.sync([item])
    const span = container.children[0]
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.5707963267')
    pool.sync([{ ...item, x: 11 }])
    expect(container.children[0]).toBe(span)
    expect(span.textContent).toBe('area ≈ 1.5707963267')
  })

  it('a rebuild (a new fullText value) resets the toggle: no stale digits from a value that no longer holds', () => {
    const { pool, container } = newPool()
    pool.sync([{ ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5707963267' }])
    const span = container.children[0]
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.5707963267')
    pool.sync([{ ...base, text: 'area ≈ 2.356', fullText: 'area ≈ 2.3561944902' }])
    expect(span.textContent).toBe('area ≈ 2.356')
    expect(span.dataset.expandable).toBe('true')
  })

  it('C1: a rebuild where only fullText changes still clears stale expanded digits', () => {
    const { pool, container } = newPool()
    pool.sync([{ ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5707963267' }])
    const span = container.children[0]
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.5707963267')
    // The capped text is unchanged; only the full text moved (a value that
    // still rounds the same way). The toggle resets and the span must show
    // the capped text now, not the old expansion.
    pool.sync([{ ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5719999999' }])
    expect(span.textContent).toBe('area ≈ 1.571')
    span.dispatch('click')
    expect(span.textContent).toBe('area ≈ 1.5719999999')
  })

  it('losing its fullText (no longer error-bounded) drops the expandable marker', () => {
    const { pool, container } = newPool()
    pool.sync([{ ...base, text: 'area ≈ 1.571', fullText: 'area ≈ 1.5707963267' }])
    const span = container.children[0]
    pool.sync([{ ...base, text: 'area ≈ 1.571' }])
    expect(span.dataset.expandable).toBeUndefined()
  })
})

describe('leaderStyle', () => {
  it('gives the length and angle of the segment from the label to its anchor', () => {
    const style = leaderStyle({ x1: 0, y1: 0, x2: 30, y2: 40 })
    expect(style.width).toBe('50px')
    expect(style.transform).toBe('translate(0px, 0px) rotate(53.13010235415598deg)')
  })
})
