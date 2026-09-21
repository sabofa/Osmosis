import { describe, it, expect } from 'vitest'
import { niceStep, resolveStep } from './grid'

describe('resolveStep', () => {
  it('keeps the author’s step while it draws a readable number of lines', () => {
    expect(resolveStep(0.25, 1.1, 6)).toBe(0.25) // ~4 divisions, as written
    expect(resolveStep(7, 63, 6)).toBe(7)
  })

  it('compresses a fixed step when zoomed far out', () => {
    // 0.25 over a span of 200 would be 800 lines; fall back to the nice step.
    expect(resolveStep(0.25, 200, 6)).toBe(niceStep(200, 6))
    expect(niceStep(200, 6)).toBe(50)
    expect(resolveStep(0.25, 2000, 6)).toBe(500)
  })

  it('expands a fixed step when zoomed far in', () => {
    // 0.25 over a span of 0.3 would be one line; fall back to a finer nice step.
    expect(resolveStep(0.25, 0.3, 6)).toBe(niceStep(0.3, 6))
    expect(niceStep(0.3, 6)).toBe(0.05)
  })

  it('uses the nice step when no step is fixed', () => {
    expect(resolveStep(null, 10, 6)).toBe(niceStep(10, 6))
  })
})
