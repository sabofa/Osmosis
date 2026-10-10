import { describe, expect, it } from 'vitest'
import { authoredBounds, axisZoomAllowedFor } from './authored'
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
