import { describe, it, expect } from 'vitest'
import { niceStep, resolveStep, shouldLabel } from './grid'
import { defaultConfig } from '../parser/config'

describe('resolveStep', () => {
  it('keeps the author’s step while it draws a readable number of lines', () => {
    expect(resolveStep(0.25, 1.1, 6)).toBe(0.25) // ~4 divisions, as written
    expect(resolveStep(7, 63, 6)).toBe(7)
  })

  it('compresses a fixed step when zoomed far out', () => {
    // 0.25 over a span of 200 would be 800 lines; fall back to the nice step.
    expect(resolveStep(0.25, 200, 6)).toBe(niceStep(200, 6))
    expect(niceStep(200, 6)).toBe(10)
    expect(resolveStep(0.25, 2000, 6)).toBe(100)
  })

  it('expands a fixed step when zoomed far in', () => {
    // 0.25 over a span of 0.3 would be one line; fall back to a finer nice step.
    expect(resolveStep(0.25, 0.3, 6)).toBe(niceStep(0.3, 6))
    expect(niceStep(0.3, 6)).toBeLessThanOrEqual(0.05)
  })

  it('uses the nice step when no step is fixed', () => {
    expect(resolveStep(null, 10, 6)).toBe(niceStep(10, 6))
  })
})


describe('shouldLabel', () => {
  it('labels every gridline by default', () => {
    const config = defaultConfig()
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(true)
    expect(shouldLabel(7, config)).toBe(true)
  })

  it('labels nothing when @labels is none', () => {
    const config = { ...defaultConfig(), labels: 'none' as const }
    expect(shouldLabel(0, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(false)
  })

  it('labels only every 5th line under @label-every: 5', () => {
    const config = { ...defaultConfig(), labelEvery: 5 }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
    expect(shouldLabel(10, config)).toBe(true)
  })

  // "coarse" means the major gridlines, which grid.ts already draws every
  // 5th step — so it is exactly @label-every: 5 without having to say so.
  it('coarse labels the major gridlines', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
  })

  it('label-every wins over coarse when both are set', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const, labelEvery: 2 }
    expect(shouldLabel(2, config)).toBe(true)
    expect(shouldLabel(5, config)).toBe(false)
  })
})
