import { describe, expect, it } from 'vitest'
import { FACES, MAX_TILT_DEGREES, tiltFor } from './lettering'
import { randomFor } from './random'

describe('lettering', () => {
  it('names a stack with fallbacks for every face, ending in a generic family', () => {
    expect(FACES.math).toMatch(/serif$/)
    expect(FACES.textbook).toBe('ui-sans-serif, system-ui, sans-serif')
    expect(FACES.hand).toMatch(/^Caveat, /)
    expect(FACES.hand).toMatch(/cursive$/)
  })

  it('tilts by at most four degrees, seeded', () => {
    expect(MAX_TILT_DEGREES).toBe(4)
    for (let i = 0; i < 300; i++) {
      const tilt = tiltFor(1, randomFor(`label-${i}`, 0))
      expect(Math.abs(tilt)).toBeLessThanOrEqual(4)
      expect(tilt).toBe(tiltFor(1, randomFor(`label-${i}`, 0)))
    }
    expect(tiltFor(0, randomFor('label', 0))).toBe(0)
    const spread = Array.from({ length: 50 }, (_, i) => Math.abs(tiltFor(1, randomFor(`s${i}`, 0))))
    expect(Math.max(...spread)).toBeGreaterThan(2)
    for (let i = 0; i < 50; i++) expect(Math.abs(tiltFor(0.5, randomFor(`s${i}`, 0)))).toBeLessThanOrEqual(2)
  })
})
