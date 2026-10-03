import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA } from '../params'
import { breathe, emptyGrid, GRID_VIEWS, gridMargin, LOCALS, mergeGrid } from './valueFinalFixture'

// Whole frames of the model are heavy and the test machine is shared: give every test room, one seed and colour (six frames) to a test, and let the worker's event loop turn
// between them.
vi.setConfig({ testTimeout: 600_000 })
afterEach(breathe)

// The same, with the brush-load mix's value step and strength at their slider maxima: the clamp that holds the order (strokes.ts
// packStrokes, and the underpainting's samples and ring) is exact, so the extremes are the defaults' order.

describe('the final picture of a sphere on a table, with the mix at its maxima', () => {
  const maxima = ['mix.valueStep', 'mix.strength'].map((path) => PARAM_SCHEMA.find((s) => s.path === path)!.max)
  const overrides = { mix: { ...DEFAULT_PAINT_PARAMS.mix, valueStep: maxima[0], strength: maxima[1], valueStepFraction: 1 } }
  const total = emptyGrid()
  const frames = [1, 2, 3, 4].flatMap((seed) => LOCALS.map((pair) => ({ seed, name: pair[0], pair })))

  it('has the mix value step and its strength at 0.15 and 2 (the slider maxima)', () => {
    expect(maxima).toEqual([0.15, 2])
  })

  it.each(frames)('still has the order in the strokes and the underpainting with the mix value step and its strength at their slider maxima: seed $seed, $name', ({ seed, pair }) => {
    const r = gridMargin(overrides, [seed], GRID_VIEWS, [pair])
    mergeGrid(total, r)
    expect(r.strokeMargin, r.strokeAt).toBeGreaterThanOrEqual(0.05)
    expect(r.underMargin, r.underAt).toBeGreaterThanOrEqual(0.05)
  })

  it('had both families to compare, in strokes and in pixels: the totals of the grid above', () => {
    // (the totals are over the tests above: with none of them run, or every frame filtered out, they would be Infinity, which passes every bound)
    expect(total.frames, 'frames made').toBe(frames.length * GRID_VIEWS.length)
    for (const n of [total.fewestShadow, total.fewestLight, total.fewestUnderShadow, total.fewestUnderLight]) expect(Number.isFinite(n)).toBe(true)
    expect(total.fewestShadow).toBeGreaterThanOrEqual(5)
    expect(total.fewestLight).toBeGreaterThanOrEqual(5)
    expect(total.fewestUnderShadow).toBeGreaterThanOrEqual(50)
    expect(total.fewestUnderLight).toBeGreaterThanOrEqual(50)
  })
})
