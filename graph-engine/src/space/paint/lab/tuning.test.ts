import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { handleTuningPost, refuseTuningRequest, TUNING_PATH } from '../../../../../review/src/paintLabTuning'

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

// The dev middleware asks refuseTuningRequest about every request before it reads the body. The endpoint rewrites a file
// in the repo, and the dev server is on localhost, where a page on any site can make the person's browser send a form
// or a no-cors fetch: the method, the browser's own Sec-Fetch-Site, the Origin against the server's own host and port,
// and the exact media type decide.
describe('refuseTuningRequest', () => {
  const HOST = 'localhost:5180'
  const json = { host: HOST, 'content-type': 'application/json' }
  const ask = (headers: Record<string, string | string[] | undefined>, method: string | undefined = 'POST') => refuseTuningRequest(method, headers)
  const status = (headers: Record<string, string | string[] | undefined>, method: string | undefined = 'POST') => ask(headers, method)?.status ?? null

  it('lets the lab’s own save through: a POST of JSON from its own origin, and a script that names no origin', () => {
    expect(ask({ ...json, origin: 'http://localhost:5180', 'sec-fetch-site': 'same-origin' })).toBeNull()
    expect(ask(json)).toBeNull() // curl, a script: no Origin, no Sec-Fetch-Site
    expect(ask({ ...json, 'sec-fetch-site': 'none' })).toBeNull() // typed in the address bar
    // the server's own address is the origin whatever the name the page was reached by
    expect(ask({ host: '127.0.0.1:5189', origin: 'http://127.0.0.1:5189', 'content-type': 'application/json' })).toBeNull()
  })

  it('answers a method other than POST with 405 and Allow: POST', () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'post', undefined]) {
      const refusal = refuseTuningRequest(method, json)
      expect(refusal?.status, String(method)).toBe(405)
      expect(refusal?.headers).toEqual({ Allow: 'POST' })
    }
  })

  it('takes exactly application/json as the media type, with at most a UTF-8 charset, and answers anything else with 415', () => {
    for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON', 'application/json;charset="UTF-8"', ' application/json ']) {
      expect(status({ host: HOST, 'content-type': type }), type).toBeNull()
    }
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=application/json',
      'text/plain; x=application/json', // a substring match let this through, and text/plain is what a cross-site form can send
      'application/jsonp',
      'application/json-patch+json',
      'application/json; charset=latin1',
      'application/json; boundary=x',
      'application/javascript, application/json',
      '',
    ]) {
      expect(status({ host: HOST, 'content-type': type }), JSON.stringify(type)).toBe(415)
    }
    expect(status({ host: HOST })).toBe(415) // no content type at all
    expect(status({ host: HOST, 'content-type': ['application/json', 'text/plain'] })).toBe(415) // sent twice
  })

  it('refuses a request the browser marks cross-site with 403, whatever else it says', () => {
    expect(status({ ...json, 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(status({ ...json, 'sec-fetch-site': 'Cross-Site' })).toBe(403)
    // even with the right origin and type (a header a page cannot change), and before the media type is looked at
    expect(status({ ...json, origin: 'http://localhost:5180', 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(status({ host: HOST, 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' })).toBe(403)
    // same-site is not enough by itself: a page on another port of localhost is another origin (below)
    expect(status({ ...json, 'sec-fetch-site': 'same-site' })).toBeNull()
  })

  it('refuses an Origin that is not the server’s own host and port with 403', () => {
    for (const origin of [
      'http://evil.example',
      'http://evil.example:5180',
      'http://localhost:5173', // another dev server on the same machine
      'http://localhost', // port 80
      'http://127.0.0.1:5180', // the same port under another name
      'http://localhost.evil.example:5180',
      'null', // a sandboxed frame, a data: page, a redirect from another site
      'chrome-extension://abc',
      'not a url',
      '',
    ]) {
      expect(status({ ...json, origin }), JSON.stringify(origin)).toBe(403)
    }
    expect(status({ ...json, origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' })).toBe(403)
    // an Origin with no Host to compare it to, and an Origin sent twice
    expect(status({ 'content-type': 'application/json', origin: 'http://localhost:5180' })).toBe(403)
    expect(status({ ...json, origin: ['http://localhost:5180', 'http://evil.example'] })).toBe(403)
  })

  it('checks in order: the method, cross-site, the origin, the media type', () => {
    expect(status({ host: HOST, 'content-type': 'text/plain', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }, 'GET')).toBe(405)
    expect(status({ host: HOST, 'content-type': 'text/plain', origin: 'http://evil.example' })).toBe(403)
    expect(status({ host: HOST, 'content-type': 'text/plain', origin: 'http://localhost:5180' })).toBe(415)
  })
})
