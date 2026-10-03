import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { applySlider, migrateLight, paramsFromData, parseParams, serialiseParams, setCurve } from '../../../../../review/src/paintLabParams'
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
    const result = parseParams('{"light":{"azimuth":-10,"worldFixed":1}}')
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
    // (a light from before it could be fixed in the world, with its own azimuth: it stays against the view, with the old elevation)
    expect(old.old.light.azimuth).toBe(-5)
    expect(old.old.light.elevation).toBe(27)
    expect(old.old.light.worldFixed).toBe(0)
  })
})

// A preset saved before the light could be fixed in the world has no light.worldFixed, and its angles were against the view.
// The new defaults fix the light in the world, so such a preset is read so that it keeps its look.
describe('a preset from before the light could be fixed in the world', () => {
  const light = (text: string) => {
    const result = parseParams(text)
    if (!result.ok) throw new Error(result.error)
    return result.params.light
  }

  it('with the old default light (56 to the left, 27 up) is the new default light: the same lamp, fixed in the world', () => {
    const l = light('{"light":{"azimuth":56,"elevation":27,"intensity":1.3}}')
    expect([l.azimuth, l.elevation, l.worldFixed]).toEqual([-35, 39, 1])
    expect(l.intensity).toBe(1.3) // and what else it set is its own
    // the angles left out are the old default's too
    expect(light('{"light":{"intensity":0.9}}')).toMatchObject({ azimuth: -35, elevation: 39, worldFixed: 1, intensity: 0.9 })
    expect(light('{"light":{"azimuth":56}}')).toMatchObject({ azimuth: -35, elevation: 39, worldFixed: 1 })
    expect(light('{"light":{"elevation":27}}')).toMatchObject({ azimuth: -35, elevation: 39, worldFixed: 1 })
  })

  it('with any other angles keeps them, and keeps the light against the view (worldFixed 0): an angle left out is the old default’s', () => {
    expect(light('{"light":{"azimuth":20,"elevation":40}}')).toMatchObject({ azimuth: 20, elevation: 40, worldFixed: 0 })
    expect(light('{"light":{"azimuth":-5}}')).toMatchObject({ azimuth: -5, elevation: 27, worldFixed: 0 })
    expect(light('{"light":{"elevation":10}}')).toMatchObject({ azimuth: 56, elevation: 10, worldFixed: 0 })
    expect(light('{"light":{"azimuth":56,"elevation":28}}')).toMatchObject({ azimuth: 56, elevation: 28, worldFixed: 0 })
  })

  it('is left alone when it has the key, or no light at all', () => {
    expect(light('{"light":{"azimuth":56,"elevation":27,"worldFixed":1}}')).toMatchObject({ azimuth: 56, elevation: 27, worldFixed: 1 })
    expect(light('{"light":{"azimuth":20,"elevation":40,"worldFixed":0}}')).toMatchObject({ azimuth: 20, elevation: 40, worldFixed: 0 })
    expect(light('{"seed":4}')).toMatchObject({ azimuth: -35, elevation: 39, worldFixed: 1 })
    expect(migrateLight({ seed: 4 })).toEqual({ seed: 4 })
    expect(migrateLight({ light: 3 })).toEqual({ light: 3 })
    expect(migrateLight(null)).toBeNull()
    expect(migrateLight([1])).toEqual([1])
  })

  it('is migrated wherever a preset is read: the saved presets, Import, and the saved defaults', () => {
    // the localStorage store
    const stored = readPresets(fakeStorage({ [PRESETS_KEY]: JSON.stringify({ 'default light': { light: { azimuth: 56, elevation: 27 } }, 'side light': { light: { azimuth: 90, elevation: 20 } } }) }))
    expect(stored['default light'].light).toMatchObject({ azimuth: -35, elevation: 39, worldFixed: 1 })
    expect(stored['side light'].light).toMatchObject({ azimuth: 90, elevation: 20, worldFixed: 0 })
    // Import, and tuning.json (both are paramsFromData)
    const imported = paramsFromData({ light: { azimuth: 90, elevation: 20 } })
    expect(imported.ok && imported.params.light).toMatchObject({ azimuth: 90, elevation: 20, worldFixed: 0 })
    // what is saved now carries the key, so it is read as it was saved
    const saved = readPresets(fakeStorage({ [PRESETS_KEY]: JSON.stringify({ now: DEFAULT_PAINT_PARAMS }) }))
    expect(saved.now.light).toEqual(DEFAULT_PAINT_PARAMS.light)
  })
})
