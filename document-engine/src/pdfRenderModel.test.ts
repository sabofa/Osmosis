import { describe, it, expect } from 'vitest'
import { EMBED_MAX_CANVAS_PIXELS, MAX_CANVAS_PIXELS, canvasPlan, cssStretch, expandWindow, planRender, sameScale } from './pdfRenderModel'

describe('expandWindow', () => {
  it('expands by the radius and clips to the document', () => {
    expect(expandWindow([5], 10, 1)).toEqual([4, 5, 6])
    expect(expandWindow([1], 10, 1)).toEqual([1, 2])
    expect(expandWindow([10], 10, 1)).toEqual([9, 10])
  })
  it('merges overlapping windows, sorted, no duplicates', () => {
    expect(expandWindow([6, 4], 20, 1)).toEqual([3, 4, 5, 6, 7])
  })
  it('nothing visible, nothing wanted', () => {
    expect(expandWindow([], 10, 1)).toEqual([])
  })
})

describe('canvasPlan', () => {
  it('uses dpr up to the cap of 2', () => {
    expect(canvasPlan(600, 800, 1).outputScale).toBe(1)
    expect(canvasPlan(600, 800, 1.5).outputScale).toBe(1.5)
    expect(canvasPlan(600, 800, 3).outputScale).toBe(2)
  })
  it('never goes below dpr 1 for bad input', () => {
    expect(canvasPlan(600, 800, 0).outputScale).toBe(1)
    expect(canvasPlan(600, 800, NaN).outputScale).toBe(1)
  })
  it('floors the buffer size', () => {
    expect(canvasPlan(100.9, 50.5, 2)).toMatchObject({ width: 201, height: 101 })
  })
  it('caps the pixel count by lowering resolution, not failing', () => {
    // 5x of a letter page at dpr 2 would be 3060 x 3960 x 4 = 48M px
    const p = canvasPlan(3060, 3960, 2)
    expect(p.width * p.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(p.outputScale).toBeLessThan(2)
    expect(p.width).toBeGreaterThan(0)
  })
  it('an enormous page drops below 1 and stays within the cap', () => {
    const p = canvasPlan(20000, 20000, 1)
    expect(p.outputScale).toBeLessThan(1)
    expect(p.width * p.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  })
  it('non-finite sizes fall back to a safe 1x1 plan', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const p = canvasPlan(bad, 800, 2)
      expect(Number.isFinite(p.width) && Number.isFinite(p.height) && Number.isFinite(p.outputScale)).toBe(true)
      expect(p).toEqual({ width: 1, height: 1, outputScale: 1 })
    }
    expect(canvasPlan(600, NaN, 1)).toEqual({ width: 1, height: 1, outputScale: 1 })
  })
  it('the embedded cap keeps every page of a 20-page 5x embed under 4M px', () => {
    const p = canvasPlan(612 * 5, 792 * 5, 2, EMBED_MAX_CANVAS_PIXELS)
    expect(p.width * p.height).toBeLessThanOrEqual(EMBED_MAX_CANVAS_PIXELS)
    expect(20 * p.width * p.height * 4).toBeLessThan(400_000_000)
  })
  it('leaves a page under the cap untouched', () => {
    expect(canvasPlan(612, 792, 2).outputScale).toBe(2)
  })
})

describe('sameScale / cssStretch', () => {
  it('treats float noise as equal', () => {
    expect(sameScale(1.25, 1.25 + 1e-6)).toBe(true)
    expect(sameScale(1, 1.01)).toBe(false)
  })
  it('stretch is 1 at the same scale, otherwise the ratio', () => {
    expect(cssStretch(1, 1)).toBe(1)
    expect(cssStretch(1, 2)).toBe(2)
    expect(cssStretch(2, 0.5)).toBe(0.25)
  })
})

describe('planRender', () => {
  const base = { numPages: 20, scale: 1, debouncing: false }
  it('renders the visible window, nearest first', () => {
    const plan = planRender({ ...base, visible: [10], rendered: new Map() })
    expect(plan.render).toEqual([10, 9, 11])
    expect(plan.free).toEqual([])
  })
  it('skips pages already rendered (or in flight) at this scale', () => {
    const plan = planRender({ ...base, visible: [10], rendered: new Map([[10, 1], [9, 1]]) })
    expect(plan.render).toEqual([11])
  })
  it('re-renders a page whose rendered scale differs', () => {
    const plan = planRender({ ...base, scale: 2, visible: [3], rendered: new Map([[3, 1], [2, 2], [4, 1]]) })
    expect(plan.render).toEqual([3, 4])
  })
  it('frees pages beyond the keep window but keeps near ones', () => {
    const rendered = new Map([[1, 1], [6, 1], [7, 1], [10, 1], [13, 1]])
    const plan = planRender({ ...base, visible: [10], rendered })
    expect(plan.free).toEqual([1, 6])
  })
  it('while debouncing does not re-render drawn pages but still frees', () => {
    const stale = new Map([[1, 1], [9, 0.5], [10, 0.5], [11, 0.5]])
    const plan = planRender({ ...base, debouncing: true, visible: [10], rendered: stale })
    expect(plan.render).toEqual([])
    expect(plan.free).toEqual([1])
  })
  it('while debouncing, on-screen pages with no canvas still render at once', () => {
    const plan = planRender({ ...base, debouncing: true, visible: [10], rendered: new Map([[10, 0.5]]) })
    expect(plan.render).toEqual([9, 11])
  })
  it('at 25% many pages are visible and all (plus a margin) render', () => {
    const plan = planRender({ ...base, scale: 0.25, visible: [1, 2, 3, 4, 5, 6], rendered: new Map() })
    expect(plan.render.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('no visible pages frees everything and renders nothing', () => {
    const plan = planRender({ ...base, visible: [], rendered: new Map([[2, 1]]) })
    expect(plan).toEqual({ render: [], free: [2] })
  })
})
