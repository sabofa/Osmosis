import { describe, expect, it } from 'vitest'
import { authoredBounds, axisZoomAllowedFor, resolvePlotAspect } from './authored'
import { boundsOf, startView } from './plotView'
import { DEFAULT_LOG_WINDOW } from '../frame/tuning'

const lin = { x: 'linear', y: 'linear' } as const

describe('authoredBounds', () => {
  it('is undefined with nothing authored', () => {
    expect(authoredBounds({ bounds: null, scales: lin }, 2)).toBeUndefined()
  })
  it('passes linear @bounds through and log10s a log axis', () => {
    const b = authoredBounds({ bounds: { xMin: 1, xMax: 1000, yMin: -2, yMax: 3 }, scales: { x: 'log', y: 'linear' } }, 1)
    expect(b).toEqual({ xMin: 0, xMax: 3, yMin: -2, yMax: 3 })
  })
  it('a log axis with no @bounds shows the default log window; the other axis keeps its default', () => {
    const b = authoredBounds({ bounds: null, scales: { x: 'log', y: 'linear' } }, 2)!
    expect(b.xMin).toBeCloseTo(Math.log10(DEFAULT_LOG_WINDOW.min))
    expect(b.xMax).toBeCloseTo(Math.log10(DEFAULT_LOG_WINDOW.max))
    expect([b.yMin, b.yMax]).toEqual([-6, 6])
  })
})

describe('axisZoomAllowedFor', () => {
  it('only for ratioXY and auto', () => {
    expect(axisZoomAllowedFor(null)).toBe(false)
    expect(axisZoomAllowedFor({ kind: 'equal' })).toBe(false)
    expect(axisZoomAllowedFor({ kind: 'auto' })).toBe(true)
    expect(axisZoomAllowedFor({ kind: 'ratioXY', x: 2, y: 1 })).toBe(true)
  })
})

describe('resolvePlotAspect', () => {
  const screen = { width: 1200, height: 800 }
  const win = { uMin: -5, uMax: 5, vMin: -3, vMax: 3 }
  const cfg = (bounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null, aspect: Parameters<typeof resolvePlotAspect>[0]['space']['aspect'] = null) => ({ bounds, space: { aspect } })
  const b = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }

  it('honours a fully authored @bounds window exactly when @aspect is absent', () => {
    const aspect = resolvePlotAspect(cfg(b))
    expect(aspect).toEqual({ kind: 'auto' })
    const seen = boundsOf(startView(win, aspect, screen), win, screen)
    expect(seen.uMin).toBeCloseTo(-5, 9)
    expect(seen.uMax).toBeCloseTo(5, 9)
    expect(seen.vMin).toBeCloseTo(-3, 9)
    expect(seen.vMax).toBeCloseTo(3, 9)
  })
  it('without @bounds the plot stays equal (circles round)', () => {
    expect(resolvePlotAspect(cfg(null))).toBeNull()
  })
  it('an explicit @aspect: equal with @bounds stays equal and fits the window', () => {
    const aspect = resolvePlotAspect(cfg(b, { kind: 'equal' }))
    expect(aspect).toEqual({ kind: 'equal' })
    const seen = boundsOf(startView(win, aspect, screen), win, screen)
    expect((seen.uMax - seen.uMin) / screen.width).toBeCloseTo((seen.vMax - seen.vMin) / screen.height, 9)
  })
})
