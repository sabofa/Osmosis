import { describe, expect, it } from 'vitest'
import { WHEEL_LINE_PX, WHEEL_PAGE_PX, WHEEL_SENSITIVITY } from '../../view2d'
import { axisZoom, wheelFactor } from './axisZoom'
import { boundsOf, PLOT_LIMITS, pxPerUnitXY, screenToPlot, startView } from './plotView'
import type { PlotWindow } from './plotView'

const screen = { width: 800, height: 400 }
const wins: [string, PlotWindow][] = [
  ['linear', { uMin: -3, uMax: 5, vMin: -2, vMax: 7 }],
  ['log', { uMin: -2, uMax: 4, vMin: 0, vMax: 6 }],
]
const pt = { x: 530, y: 120 }
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)
const spans = (v: Parameters<typeof boundsOf>[0], w: PlotWindow) => {
  const b = boundsOf(v, w, screen)
  return { u: b.uMax - b.uMin, v: b.vMax - b.vMin }
}

describe.each(wins)('axisZoom (%s window)', (_n, win) => {
  const v0 = { ...startView(win, null, screen), zoom: 1.7, cu: (win.uMin + win.uMax) / 2 + 0.2, cv: (win.vMin + win.vMax) / 2 - 0.3 }
  it.each([
    ['x', 1.6],
    ['x', 0.4],
    ['y', 1.6],
    ['y', 0.4],
  ] as const)('%s by %f: span scales, other axis and cursor hold', (axis, f) => {
    const v1 = axisZoom(v0, win, axis, f, pt, screen)
    const s0 = spans(v0, win)
    const s1 = spans(v1, win)
    const p0 = pxPerUnitXY(v0, win, screen)
    const p1 = pxPerUnitXY(v1, win, screen)
    if (axis === 'x') {
      close(s1.u, s0.u / f)
      close(s1.v, s0.v)
      close(p1.x, p0.x * f)
      close(p1.y, p0.y)
    } else {
      close(s1.v, s0.v / f)
      close(s1.u, s0.u)
      close(p1.y, p0.y * f)
      close(p1.x, p0.x)
    }
    const a = screenToPlot(v0, win, screen, pt)
    const b = screenToPlot(v1, win, screen, pt)
    close(b.x, a.x)
    close(b.y, a.y)
  })

  it('factor 1 is identity', () => {
    expect(axisZoom(v0, win, 'x', 1, pt, screen)).toEqual(v0)
  })

  it('clamps zoom at the limits', () => {
    const hi = axisZoom(v0, win, 'x', 1e12, pt, screen)
    expect(hi.zoom).toBeLessThanOrEqual(PLOT_LIMITS.zoomMax)
    const lo = axisZoom(v0, win, 'y', 1e-12, pt, screen)
    expect(lo.zoom).toBeGreaterThanOrEqual(PLOT_LIMITS.zoomMin)
  })
})

describe('wheelFactor', () => {
  it('decodes pixels, lines, pages', () => {
    close(wheelFactor({ deltaY: 100, deltaX: 0, deltaMode: 0 }), Math.exp(-100 * WHEEL_SENSITIVITY))
    close(wheelFactor({ deltaY: 3, deltaX: 0, deltaMode: 1 }), Math.exp(-3 * WHEEL_LINE_PX * WHEEL_SENSITIVITY))
    close(wheelFactor({ deltaY: 1, deltaX: 0, deltaMode: 2 }), Math.exp(-WHEEL_PAGE_PX * WHEEL_SENSITIVITY))
  })
  it('falls back to deltaX', () => {
    close(wheelFactor({ deltaY: 0, deltaX: -50, deltaMode: 0 }), Math.exp(50 * WHEEL_SENSITIVITY))
    expect(wheelFactor({ deltaY: 0, deltaX: 0, deltaMode: 0 })).toBe(1)
  })
})
