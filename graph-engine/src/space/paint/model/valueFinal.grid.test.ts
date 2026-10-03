import { describe, expect, it, vi } from 'vitest'
import { AZIMUTHS, gridMargin, SEEDS } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 600_000 })

// The value rule in the final picture of a sphere on a table (spec §12), at the defaults: the strokes after the planes, the
// plane steps, the brush-load mix and the gamut fit. (valueFinal.test.ts holds the parts; this holds the whole grid.)

describe('the final picture of a sphere on a table, at the defaults', () => {
  it('has every shadow-family stroke darker than every half-tone stroke, by 0.05 and more, at the defaults (8 seeds x 5 views x 5 local colours)', () => {
    const r = gridMargin({}, SEEDS, AZIMUTHS)
    // both families are there to be compared, in every frame
    expect(r.shadows, 'shadow strokes in the smallest frame').toBeGreaterThan(10)
    expect(r.lights, 'half-tone strokes in the smallest frame').toBeGreaterThan(10)
    expect(r.margin, r.at).toBeGreaterThanOrEqual(0.05)
  })

})
