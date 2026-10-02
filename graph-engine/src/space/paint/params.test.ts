import { describe, expect, it } from 'vitest'
import tuning from './tuning.json'
import { DEFAULT_PAINT_PARAMS, getParam, PARAM_SCHEMA, resolvePaintParams, setParam } from './params'

describe('paint params', () => {
  it('every slider path resolves to a number inside its range at the defaults', () => {
    for (const spec of PARAM_SCHEMA) {
      const v = getParam(DEFAULT_PAINT_PARAMS, spec.path)
      expect(typeof v, spec.path).toBe('number')
      expect(v, spec.path).toBeGreaterThanOrEqual(spec.min)
      expect(v, spec.path).toBeLessThanOrEqual(spec.max)
    }
  })

  it('slider paths are unique', () => {
    const paths = PARAM_SCHEMA.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('resolve merges deep, tuples by index, ignores unknown keys and wrong types', () => {
    const p = resolvePaintParams({
      light: { azimuth: -20 },
      edges: { wContrast: [0.5] },
      bogus: 1,
      mix: { strength: 'loud' },
    } as never)
    expect(p.light.azimuth).toBe(-20)
    expect(p.light.elevation).toBe(DEFAULT_PAINT_PARAMS.light.elevation)
    expect(p.edges.wContrast).toEqual([0.5, 0.52, 0.36])
    expect(p.mix.strength).toBe(1)
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('resolve never mutates the defaults', () => {
    resolvePaintParams({ light: { azimuth: 99 } })
    expect(DEFAULT_PAINT_PARAMS.light.azimuth).toBe(35)
  })

  it('setParam returns a new object and addresses tuple entries', () => {
    const next = setParam(DEFAULT_PAINT_PARAMS, 'edges.wFocal.2', 0.5)
    expect(next.edges.wFocal[2]).toBe(0.5)
    expect(DEFAULT_PAINT_PARAMS.edges.wFocal[2]).toBe(0.06)
  })

  it('the saved tuning layers over the defaults', () => {
    const p = resolvePaintParams(tuning as never)
    expect(p.seed).toBe(typeof (tuning as { seed?: number }).seed === 'number' ? (tuning as { seed: number }).seed : 1)
  })
})
