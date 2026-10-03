import { afterEach, describe, expect, it, vi } from 'vitest'
import { WsError, createNode, destroyNode, getRoots, isStale, removePlacement, renamePlacement, saveContent, searchByTag } from './wsApi'

// What the server answers, as a fetch Response would.
function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function stubFetch(res: Response | Error) {
  const fn = vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('wsApi', () => {
  it('returns the parsed body of a good call', async () => {
    stubFetch(reply(200, { tracks: [], courses: [], unplaced: [] }))
    expect(await getRoots()).toEqual({ tracks: [], courses: [], unplaced: [] })
  })

  it('a 409 throws a WsError the caller can recognise', async () => {
    stubFetch(reply(409, { error: 'stale_revision', message: 'moved on', detail: { current_revision: 7 } }))
    const err = await saveContent('n1', 'text', 3).catch((e) => e)
    expect(err).toBeInstanceOf(WsError)
    expect(isStale(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.code).toBe('stale_revision')
    expect((err.detail as { current_revision: number }).current_revision).toBe(7)
  })

  it('a name clash reads as a WsError whose message and detail carry the free name', async () => {
    stubFetch(reply(400, { error: 'name_taken', message: '"a" is already taken here; try "a (2)".', detail: { suggestion: 'a (2)' } }))
    const err = await renamePlacement('p1', 'a').catch((e) => e)
    expect(isStale(err)).toBe(false)
    expect(err.status).toBe(400)
    expect(err.code).toBe('name_taken')
    expect(err.message).toContain('a (2)')
    expect((err.detail as { suggestion: string }).suggestion).toBe('a (2)')
  })

  it('the offline answer of a local node reads as an error with its reason as the code', async () => {
    stubFetch(reply(503, { reason: 'requires_connection', message: 'The workspace lives on the server; this device is offline.' }))
    const err = await getRoots().catch((e) => e)
    expect(err.status).toBe(503)
    expect(err.code).toBe('requires_connection')
    expect(err.message).toContain('offline')
  })

  it('an answer that is not JSON and a server that is not reached are both WsErrors', async () => {
    stubFetch({ ok: false, status: 502, json: async () => { throw new SyntaxError('no') } } as unknown as Response)
    const bad = await getRoots().catch((e) => e)
    expect(bad).toBeInstanceOf(WsError)
    expect(bad.status).toBe(502)
    stubFetch(new TypeError('failed to fetch'))
    const down = await getRoots().catch((e) => e)
    expect(down.status).toBe(0)
    expect(down.code).toBe('network')
  })

  it('sends each call to the route the server has, and remove-from-here is a different path from destroy', async () => {
    const fn = stubFetch(reply(200, {}))
    await removePlacement('p/1')
    await destroyNode('n1', false)
    await destroyNode('n1', true)
    await searchByTag('root 1', 'homework')
    await createNode({ kind: 'file', title: 'T', file: { type: 'markdown', body: '' }, placeIn: 'c1' })
    const calls = fn.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'DELETE /api/ws/placements/p%2F1',
      'DELETE /api/ws/nodes/n1',
      'DELETE /api/ws/nodes/n1?with_orphans=true',
      'GET /api/ws/search?scope=root%201&kind_tag=homework',
      'POST /api/ws/nodes',
    ])
    expect(JSON.parse(calls[4][1].body as string)).toEqual({
      kind: 'file',
      title: 'T',
      file: { type: 'markdown', body: '' },
      place_in: { container_id: 'c1' },
    })
  })
})
