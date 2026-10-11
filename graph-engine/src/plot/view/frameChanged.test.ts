import { describe, expect, it } from 'vitest'
import { frameChanged } from './frameChanged'

const base = () => ({ bounds: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, scales: { x: 'linear' as const, y: 'linear' as const }, space: { aspect: null as unknown } })

describe('frameChanged', () => {
  it('is false for an edit elsewhere (same frame, even with keys reordered)', () => {
    const b = base()
    const c = { space: { aspect: null }, scales: { y: 'linear' as const, x: 'linear' as const }, bounds: { yMax: 5, yMin: -5, xMax: 5, xMin: -5 } }
    expect(frameChanged(b, c)).toBe(false)
  })
  it('is true when @bounds changes', () => {
    expect(frameChanged(base(), { ...base(), bounds: { xMin: -9, xMax: 5, yMin: -5, yMax: 5 } })).toBe(true)
  })
  it('is true when @aspect changes', () => {
    const a = { ...base(), space: { aspect: { kind: 'ratioXY', x: 1, y: 1 } } }
    const b = { ...base(), space: { aspect: { kind: 'ratioXY', x: 2, y: 1 } } }
    expect(frameChanged(a, b)).toBe(true)
    expect(frameChanged(a, { ...a, space: { aspect: { y: 1, x: 1, kind: 'ratioXY' } } })).toBe(false)
  })
  it('is true when a scale changes', () => {
    expect(frameChanged(base(), { ...base(), scales: { x: 'log', y: 'linear' } })).toBe(true)
  })
  it('treats undefined and null as their defaults', () => {
    expect(frameChanged({ bounds: null, scales: { x: 'linear', y: 'linear' } }, { bounds: undefined as never, scales: undefined as never })).toBe(false)
    expect(frameChanged(undefined, null)).toBe(false)
  })
})
