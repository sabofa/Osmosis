import { describe, it, expect } from 'vitest'
import {
  SCROLLBAR_ALLOWANCE,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitReference,
  fitScale,
  settleContainer,
  settleFitScale,
  stableFitScale,
  stepZoom,
  wheelZoomFactor,
  zoomAround,
  zoomTweenStart,
  type Size,
  type ZoomMode,
} from './zoomModel'

const letter = { w: 612, h: 792 }

describe('clampZoom', () => {
  it('clamps to 0.25 and 5', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(1.3)).toBe(1.3)
  })
  it('honours a custom range and survives NaN', () => {
    expect(clampZoom(0.1, 0.5, 3)).toBe(0.5)
    expect(clampZoom(9, 0.5, 3)).toBe(3)
    expect(clampZoom(NaN)).toBe(1)
  })
})

describe('fitScale', () => {
  it('numeric modes pass through, clamped', () => {
    expect(fitScale(2, { w: 100, h: 100 }, letter, 0)).toBe(2)
    expect(fitScale(50, { w: 100, h: 100 }, letter, 0)).toBe(5)
  })
  it('fit-width divides the padded width by the page width', () => {
    expect(fitScale('fit-width', { w: 1000, h: 500 }, letter, 20)).toBeCloseTo(960 / 612)
  })
  it('fit-height divides the padded height by the page height', () => {
    expect(fitScale('fit-height', { w: 1000, h: 800 }, letter, 16)).toBeCloseTo(768 / 792)
  })
  it('fit-page is the smaller of the two', () => {
    // wide container: height limits
    expect(fitScale('fit-page', { w: 2000, h: 800 }, letter, 0)).toBeCloseTo(800 / 792)
    // narrow container: width limits
    expect(fitScale('fit-page', { w: 300, h: 2000 }, letter, 0)).toBeCloseTo(300 / 612)
  })
  it('landscape page', () => {
    const land = { w: 842, h: 595 }
    expect(fitScale('fit-width', { w: 842, h: 600 }, land, 0)).toBeCloseTo(1)
    expect(fitScale('fit-page', { w: 1684, h: 595 }, land, 0)).toBeCloseTo(1)
  })
  it('very tall page: fit-width is large, fit-page tiny but clamped to the minimum', () => {
    const tall = { w: 200, h: 14400 }
    expect(fitScale('fit-width', { w: 800, h: 600 }, tall, 0)).toBeCloseTo(4)
    expect(fitScale('fit-page', { w: 800, h: 600 }, tall, 0)).toBe(ZOOM_MIN)
  })
  it('container smaller than the page scales down', () => {
    expect(fitScale('fit-width', { w: 306, h: 396 }, letter, 0)).toBeCloseTo(0.5)
  })
  it('clamps a huge fit to 5 and a tiny one to 0.25', () => {
    expect(fitScale('fit-width', { w: 5000, h: 5000 }, { w: 100, h: 100 }, 0)).toBe(5)
    expect(fitScale('fit-width', { w: 50, h: 50 }, { w: 5000, h: 5000 }, 0)).toBe(0.25)
  })
  it('degenerate sizes fall back to 1', () => {
    expect(fitScale('fit-width', { w: 0, h: 0 }, letter, 0)).toBe(1)
    expect(fitScale('fit-width', { w: 30, h: 30 }, letter, 20)).toBe(1)
    expect(fitScale('fit-page', { w: 800, h: 600 }, { w: 0, h: 0 }, 0)).toBe(1)
  })
})

describe('stepZoom', () => {
  it('snaps to nice values going in', () => {
    expect(stepZoom(1, 'in')).toBe(1.25)
    expect(stepZoom(1.25, 'in')).toBe(1.5)
    expect(stepZoom(1.5, 'in')).toBe(2)
    expect(stepZoom(0.25, 'in')).toBe(0.33)
  })
  it('snaps to nice values going out', () => {
    expect(stepZoom(1, 'out')).toBe(0.75)
    expect(stepZoom(0.75, 'out')).toBe(0.67)
    expect(stepZoom(0.5, 'out')).toBe(0.33)
  })
  it('steps from an arbitrary fit scale to the next stop', () => {
    expect(stepZoom(1.62, 'in')).toBe(2)
    expect(stepZoom(1.62, 'out')).toBe(1.5)
    expect(stepZoom(0.9, 'in')).toBe(1)
    expect(stepZoom(0.9, 'out')).toBe(0.75)
  })
  it('clamps at 25% and 500%', () => {
    expect(stepZoom(0.25, 'out')).toBe(0.25)
    expect(stepZoom(5, 'in')).toBe(5)
    expect(stepZoom(4, 'in')).toBe(5)
    expect(stepZoom(0.3, 'out')).toBe(0.25)
  })
  it('respects a custom text range (0.5 to 3)', () => {
    expect(stepZoom(0.5, 'out', 0.5, 3)).toBe(0.5)
    expect(stepZoom(3, 'in', 0.5, 3)).toBe(3)
    expect(stepZoom(2, 'in', 0.5, 3)).toBe(3)
    expect(stepZoom(0.67, 'out', 0.5, 3)).toBe(0.5)
  })
  it('always makes progress (no stuck steps)', () => {
    let z = ZOOM_MIN
    for (let i = 0; i < 30 && z < ZOOM_MAX; i++) {
      const n = stepZoom(z, 'in')
      expect(n).toBeGreaterThan(z)
      z = n
    }
    expect(z).toBe(ZOOM_MAX)
  })
})

describe('zoomAround', () => {
  it('keeps the point under the cursor fixed', () => {
    const scroll = { left: 100, top: 300 }
    const cursor = { x: 200, y: 150 }
    const out = zoomAround(1, 2, cursor, scroll)
    // content point (300, 450) -> (600, 900); minus the cursor offset
    expect(out).toEqual({ left: 400, top: 750 })
    expect((out.left + cursor.x) / 2).toBeCloseTo((scroll.left + cursor.x) / 1)
  })
  it('zooming out near the origin clamps scroll at 0', () => {
    expect(zoomAround(2, 0.5, { x: 400, y: 400 }, { left: 0, top: 0 })).toEqual({ left: 0, top: 0 })
  })
  it('identity when the scale is unchanged', () => {
    expect(zoomAround(1.5, 1.5, { x: 10, y: 20 }, { left: 33, top: 44 })).toEqual({ left: 33, top: 44 })
  })
  it('bad scales leave scroll alone', () => {
    expect(zoomAround(0, 2, { x: 1, y: 1 }, { left: 5, top: 6 })).toEqual({ left: 5, top: 6 })
  })
})

describe('wheelZoomFactor', () => {
  it('scrolling up zooms in, down zooms out, none is neutral', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1)
    expect(wheelZoomFactor(10)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })
  it('caps a huge delta', () => {
    expect(wheelZoomFactor(100000)).toBeCloseTo(Math.exp(-0.25))
  })
})

// The scroller loses `sb` px of client size per axis when a scrollbar shows.
// A vertical bar is always there (stable gutter, multi-page); a horizontal
// one appears exactly when the page overflows sideways.
const SB = 12
const PAD = 16
function clientOf(outer: Size, scale: number, page: Size): Size {
  const overflowX = page.w * scale + 2 * PAD > outer.w - SB
  return { w: outer.w - SB, h: outer.h - (overflowX ? SB : 0) }
}

describe('scrollbar feedback loop (regression)', () => {
  const wide = { w: 842, h: 595 }
  const outer = { w: 700, h: 500 }
  const modes: ZoomMode[] = ['fit-height', 'fit-page', 'fit-width']

  it('the old client-size measurement oscillates at fit-height with a wide page', () => {
    let scale = fitScale('fit-height', clientOf(outer, 1, wide), wide, PAD)
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      scale = fitScale('fit-height', clientOf(outer, scale, wide), wide, PAD)
      seen.push(scale)
    }
    expect(new Set(seen.map((s) => s.toFixed(4))).size).toBe(2)
  })

  for (const mode of modes) {
    it(`${mode}: the stable fit reaches a fixed point after at most one recompute`, () => {
      // Measurement is the outer box minus a constant, so it cannot depend on scale.
      const s1 = stableFitScale(mode, outer, wide, PAD, SB)
      const s2 = stableFitScale(mode, outer, wide, PAD, SB)
      expect(s2).toBe(s1)
      // Whatever scrollbar state the settled scale produces, the input is unchanged.
      const again = stableFitScale(mode, { w: outer.w, h: outer.h }, wide, PAD, SB)
      expect(again).toBe(s1)
    })
    it(`${mode}: the fitted page plus a scrollbar still fits the outer box`, () => {
      const s = stableFitScale(mode, outer, wide, PAD, SB)
      if (s > ZOOM_MIN && s < ZOOM_MAX) {
        if (mode !== 'fit-width') expect(wide.h * s + 2 * PAD + SB).toBeLessThanOrEqual(outer.h + 1e-6)
        if (mode !== 'fit-height') expect(wide.w * s + 2 * PAD + SB).toBeLessThanOrEqual(outer.w + 1e-6)
      }
    })
  }

  it('defaults the allowance to SCROLLBAR_ALLOWANCE', () => {
    expect(stableFitScale('fit-width', { w: 1000, h: 800 }, letter, 16)).toBeCloseTo(fitScale('fit-width', { w: 1000 - SCROLLBAR_ALLOWANCE, h: 800 - SCROLLBAR_ALLOWANCE }, letter, 16))
  })
  it('numeric modes ignore the allowance', () => {
    expect(stableFitScale(1.5, outer, wide, PAD, SB)).toBe(1.5)
  })
})

describe('zoomTweenStart', () => {
  it('starts at the old look: zooming in 1 -> 2 starts at half size', () => {
    expect(zoomTweenStart(1, 2)).toBe(0.5)
    expect(zoomTweenStart(2, 1)).toBe(2)
  })
  it('continues from a running animation', () => {
    // layout is at 2 but still drawn at factor 0.4 (visual 0.8); now go to 4
    expect(zoomTweenStart(2, 4, 0.4)).toBeCloseTo(0.2)
  })
  it('bad input is neutral', () => {
    expect(zoomTweenStart(0, 2)).toBe(1)
    expect(zoomTweenStart(1, NaN)).toBe(1)
  })
})

describe('hysteresis', () => {
  it('ignores container changes under 2px', () => {
    const prev = { w: 700, h: 500 }
    expect(settleContainer(prev, { w: 701, h: 499 })).toBe(prev)
    expect(settleContainer(prev, { w: 702, h: 500 })).toEqual({ w: 702, h: 500 })
    expect(settleContainer(prev, { w: 700, h: 497 })).toEqual({ w: 700, h: 497 })
  })
  it('ignores fit scale changes under 0.5%', () => {
    expect(settleFitScale(1, 1.004)).toBe(1)
    expect(settleFitScale(1, 0.996)).toBe(1)
    expect(settleFitScale(1, 1.006)).toBe(1.006)
    expect(settleFitScale(null, 0.8)).toBe(0.8)
  })
})

describe('fitReference', () => {
  it('unknown without pages', () => {
    expect(fitReference('fit-width', [])).toEqual({ w: 0, h: 0 })
  })
  it('fit-width uses the widest page, others the first', () => {
    const pages = [{ w: 300, h: 400 }, { w: 900, h: 200 }]
    expect(fitReference('fit-width', pages)).toEqual({ w: 900, h: 400 })
    expect(fitReference('fit-page', pages)).toEqual({ w: 300, h: 400 })
    expect(fitReference('fit-height', pages)).toEqual({ w: 300, h: 400 })
  })
})
