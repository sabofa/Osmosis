import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { handleTuningPost, TUNING_PATH } from '../../../../../review/src/paintLabTuning'

// "Save as defaults" POSTs the lab's params to the dev middleware, which hands
// the body to this pure function: parse, validate through resolvePaintParams,
// write pretty-printed. It never writes what it refused.

function recorder() {
  const writes: string[] = []
  return { writes, write: (text: string) => void writes.push(text) }
}

describe('handleTuningPost', () => {
  it('validates, writes the resolved params pretty-printed, and answers 200 with the path', () => {
    const { writes, write } = recorder()
    const body = JSON.stringify({ ...DEFAULT_PAINT_PARAMS, light: { ...DEFAULT_PAINT_PARAMS.light, azimuth: -12 }, seed: 9 })
    const result = handleTuningPost(body, write)
    expect(result).toEqual({ status: 200, body: { ok: true, path: 'graph-engine/src/space/paint/tuning.json' } })
    expect(TUNING_PATH).toBe('graph-engine/src/space/paint/tuning.json')
    expect(writes).toHaveLength(1)
    // Two-space indent and a final newline, so the file diffs cleanly.
    expect(writes[0].startsWith('{\n  "seed": 9,\n  "curves": {')).toBe(true)
    expect(writes[0].endsWith('}\n')).toBe(true)
    const written = JSON.parse(writes[0])
    expect(written.light.azimuth).toBe(-12)
    expect(written).toEqual(resolvePaintParams(JSON.parse(body)))
  })

  it('writes the whole parameter set even from a partial body, and drops unknown keys', () => {
    const { writes, write } = recorder()
    expect(handleTuningPost('{"light":{"azimuth":-12},"bogus":1}', write).status).toBe(200)
    const written = JSON.parse(writes[0])
    expect(written.light.azimuth).toBe(-12)
    expect(written.light.elevation).toBe(DEFAULT_PAINT_PARAMS.light.elevation)
    expect(written.mix).toEqual(DEFAULT_PAINT_PARAMS.mix)
    expect(written.bogus).toBeUndefined()
  })

  it('clamps numbers to the slider ranges before writing', () => {
    const { writes, write } = recorder()
    handleTuningPost('{"seed":5000,"light":{"intensity":-1}}', write)
    const written = JSON.parse(writes[0])
    expect(written.seed).toBe(999)
    expect(written.light.intensity).toBe(0)
  })

  it('keeps a valid curve, repairs an invalid one to the default, and clamps its points into the editor range', () => {
    const { writes, write } = recorder()
    handleTuningPost(JSON.stringify({ curves: { value: [[0, 0], [0.4, 0.7], [1, 1]], lAdjust: [[0.6, 0], [0.2, 0.1]], hAdjust: [[0, -90], [1, 90]] } }), write)
    const written = JSON.parse(writes[0])
    expect(written.curves.value).toEqual([[0, 0], [0.4, 0.7], [1, 1]])
    expect(written.curves.lAdjust).toEqual(DEFAULT_PAINT_PARAMS.curves.lAdjust) // x not ascending: refused whole
    expect(written.curves.hAdjust).toEqual([[0, -60], [1, 60]]) // clamped to +-60
  })

  it('rejects a body that is not a JSON object with a 400 and writes nothing', () => {
    for (const text of ['[]', '[{"seed":2}]', 'null', '3', '"seed"', 'true']) {
      const { writes, write } = recorder()
      const result = handleTuningPost(text, write)
      expect(result.status, text).toBe(400)
      expect(result.body.ok, text).toBe(false)
      expect(writes, text).toHaveLength(0)
    }
  })

  it('rejects text that is not JSON with a 400 that says so, and writes nothing', () => {
    const { writes, write } = recorder()
    const result = handleTuningPost('{"seed":', write)
    expect(result.status).toBe(400)
    expect(result.body.ok === false && result.body.error).toMatch(/JSON/)
    expect(writes).toHaveLength(0)
  })

  it('answers 500 with the reason when the file cannot be written', () => {
    const result = handleTuningPost('{}', () => {
      throw new Error('EACCES: permission denied')
    })
    expect(result.status).toBe(500)
    expect(result.body.ok === false && result.body.error).toContain('EACCES')
  })
})
