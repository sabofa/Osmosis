import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { applySlider, parseParams, serialiseParams, setCurve } from '../../../../../review/src/paintLabParams'
import { deletePreset, PRESETS_KEY, readPresets, savePreset } from '../../../../../review/src/paintLabPresets'

// A preset is the params as JSON. It round-trips through resolvePaintParams
// (which is what Import and the saved defaults go through), and the localStorage
// store never throws: a private window or blocked site data is an empty list.

function tuned() {
  let p = applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', -42)
  p = applySlider(p, 'canvas.tone.0', 0.9)
  p = applySlider(p, 'edges.wDepth.2', 0.2)
  p = applySlider(p, 'roles.dab.density', 0.3)
  p = applySlider(p, 'seed', 7)
  p = setCurve(p, 'curves.value', [[0, 0], [0.4, 0.55], [1, 1]])
  p = setCurve(p, 'curves.hAdjust', [[0, 0], [0.5, 12.5], [1, -4]])
  return { ...p, canvas: { ...p.canvas, weave: 'linen' as const } }
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const calls: string[] = []
  return {
    data,
    calls,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      calls.push(k)
      data.set(k, v)
    },
  }
}

describe('serialiseParams / parseParams', () => {
  it('round-trips a tuned set of params through resolvePaintParams, tuples, strings and all', () => {
    const p = tuned()
    const text = serialiseParams(p)
    const result = parseParams(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params).toEqual(p)
      expect(result.params).toEqual(resolvePaintParams(JSON.parse(text)))
    }
    expect(p.canvas.weave).toBe('linen')
    expect(p.edges.wDepth).toEqual([0.1, 0.18, 0.2])
    // The curves are arrays of points: they survive whole, and the preset carries them.
    expect(result.ok && result.params.curves.value).toEqual([[0, 0], [0.4, 0.55], [1, 1]])
    expect(result.ok && result.params.curves.hAdjust).toEqual([[0, 0], [0.5, 12.5], [1, -4]])
  })

  it('reads a partial object over the defaults', () => {
    const result = parseParams('{"light":{"azimuth":-10}}')
    expect(result.ok && result.params.light.azimuth).toBe(-10)
    expect(result.ok && result.params.light.elevation).toBe(DEFAULT_PAINT_PARAMS.light.elevation)
    expect(result.ok && result.params.edges.wFocal).toEqual([0.26, 0.14, 0.06])
  })

  it('refuses anything that is not a JSON object, and says why', () => {
    for (const text of ['[]', 'null', '3', '"loud"', 'true', 'nope{']) {
      const result = parseParams(text)
      expect(result.ok, text).toBe(false)
      if (!result.ok) expect(result.error.length, text).toBeGreaterThan(5)
    }
  })

  it('clamps out-of-range numbers to the slider range and repairs an unknown weave', () => {
    const result = parseParams('{"light":{"azimuth":900,"intensity":-4},"seed":50000,"canvas":{"weave":"silk"}}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params.light.azimuth).toBe(180)
      expect(result.params.light.intensity).toBe(0)
      expect(result.params.seed).toBe(999)
      expect(result.params.canvas.weave).toBe(DEFAULT_PAINT_PARAMS.canvas.weave)
    }
  })

  it('brings curve points into the editor range: y clamped, a point outside x 0..1 dropped, under two points the default', () => {
    const result = parseParams(JSON.stringify({
      curves: { hAdjust: [[0, -90], [0.5, 10], [1, 90]], lAdjust: [[-0.5, 0], [0.5, 0.1], [1, 0]], value: [[0, 0], [5, 1]] },
    }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params.curves.hAdjust).toEqual([[0, -60], [0.5, 10], [1, 60]])
      expect(result.params.curves.lAdjust).toEqual([[0.5, 0.1], [1, 0]])
      expect(result.params.curves.value).toEqual(DEFAULT_PAINT_PARAMS.curves.value)
    }
  })

  it('drops keys the painter does not have', () => {
    const result = parseParams('{"bogus":1,"light":{"bogus":2}}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params).toEqual(DEFAULT_PAINT_PARAMS)
      expect(JSON.stringify(result.params)).not.toContain('bogus')
    }
  })
})

describe('the preset store', () => {
  it('is empty at first, saves under a name and reads it back whole', () => {
    const storage = fakeStorage()
    expect(readPresets(storage)).toEqual({})
    expect(savePreset('warm light', tuned(), storage)).toBe(true)
    expect(Object.keys(readPresets(storage))).toEqual(['warm light'])
    expect(readPresets(storage)['warm light']).toEqual(tuned())
    expect(storage.calls).toEqual([PRESETS_KEY])
    expect(PRESETS_KEY).toBe('osmosis.paintLab.presets')
  })

  it('overwrites a name in place, keeps the others in order, and deletes by name', () => {
    const storage = fakeStorage()
    savePreset('a', DEFAULT_PAINT_PARAMS, storage)
    savePreset('b', DEFAULT_PAINT_PARAMS, storage)
    savePreset('a', tuned(), storage)
    expect(Object.keys(readPresets(storage))).toEqual(['a', 'b'])
    expect(readPresets(storage).a.seed).toBe(7)
    expect(deletePreset('a', storage)).toBe(true)
    expect(Object.keys(readPresets(storage))).toEqual(['b'])
    expect(deletePreset('missing', storage)).toBe(false)
  })

  it('trims names and refuses an empty one', () => {
    const storage = fakeStorage()
    expect(savePreset('   ', DEFAULT_PAINT_PARAMS, storage)).toBe(false)
    expect(savePreset('  dusk  ', DEFAULT_PAINT_PARAMS, storage)).toBe(true)
    expect(Object.keys(readPresets(storage))).toEqual(['dusk'])
  })

  it('never throws: blocked storage reads as empty and a failed write says so', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readPresets(blocked)).toEqual({})
    expect(savePreset('x', DEFAULT_PAINT_PARAMS, blocked)).toBe(false)
    expect(deletePreset('x', blocked)).toBe(false)
  })

  it('treats corrupt stored text as no presets, and reads an older partial preset over the defaults', () => {
    expect(readPresets(fakeStorage({ [PRESETS_KEY]: '{nope' }))).toEqual({})
    expect(readPresets(fakeStorage({ [PRESETS_KEY]: '[1,2]' }))).toEqual({})
    const old = readPresets(fakeStorage({ [PRESETS_KEY]: '{"old":{"light":{"azimuth":-5}},"junk":3}' }))
    expect(Object.keys(old)).toEqual(['old'])
    expect(old.old.light.azimuth).toBe(-5)
    expect(old.old.light.elevation).toBe(DEFAULT_PAINT_PARAMS.light.elevation)
  })
})
