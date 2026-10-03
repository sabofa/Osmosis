import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA } from '../params'
import { gridMargin } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 600_000 })

// The same, with the brush-load mix's value step and strength at their slider maxima: the clamp that holds the order (strokes.ts
// packStrokes, and the underpainting's samples and ring) is exact, so the extremes are the defaults' order.

describe('the final picture of a sphere on a table, with the mix at its maxima', () => {
  it('still has the order in the strokes and the underpainting with the mix value step and its strength at their slider maxima (valueStep 0.15 in every load, strength 2)', () => {
    const maxima = ['mix.valueStep', 'mix.strength'].map((path) => PARAM_SCHEMA.find((s) => s.path === path)!.max)
    expect(maxima).toEqual([0.15, 2])
    const r = gridMargin({ mix: { ...DEFAULT_PAINT_PARAMS.mix, valueStep: maxima[0], strength: maxima[1], valueStepFraction: 1 } }, [1, 2, 3, 4])
    expect(r.fewestShadow).toBeGreaterThanOrEqual(5)
    expect(r.fewestLight).toBeGreaterThanOrEqual(5)
    expect(r.fewestUnderShadow).toBeGreaterThanOrEqual(50)
    expect(r.fewestUnderLight).toBeGreaterThanOrEqual(50)
    expect(r.strokeMargin, r.strokeAt).toBeGreaterThanOrEqual(0.05)
    expect(r.underMargin, r.underAt).toBeGreaterThanOrEqual(0.05)
  })
})
