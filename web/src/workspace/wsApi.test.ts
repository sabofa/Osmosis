import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WsError,
  createNode,
  destroyNode,
  freeNameOf,
  getRoots,
  isStale,
  listTrash,
  placeNode,
  purgeNode,
  removePlacement,
  renamePlacement,
  restoreNode,
  saveContent,
  searchByTag,
  searchUnder,
  setKindTag,
} from './wsApi'

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
    expect(freeNameOf(err)).toBe('a (2)')
    expect(freeNameOf(new WsError(400, 'cycle_rejected', 'no'))).toBeNull()
    expect(freeNameOf(new Error('x'))).toBeNull()
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
    await placeNode('track1', 'course1')
    await placeNode('track1', 'course2', 'Second')
    const calls = fn.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'DELETE /api/ws/placements/p%2F1',
      'DELETE /api/ws/nodes/n1',
      'DELETE /api/ws/nodes/n1?with_orphans=true',
      'GET /api/ws/search?scope=root%201&kind_tag=homework',
      'POST /api/ws/nodes',
      'POST /api/ws/placements',
      'POST /api/ws/placements',
    ])
    expect(JSON.parse(calls[4][1].body as string)).toEqual({
      kind: 'file',
      title: 'T',
      file: { type: 'markdown', body: '' },
      place_in: { container_id: 'c1' },
    })
    // Placing an existing node: no name means "under its own title".
    expect(JSON.parse(calls[5][1].body as string)).toEqual({ container_id: 'track1', child_id: 'course1' })
    expect(JSON.parse(calls[6][1].body as string)).toEqual({ container_id: 'track1', child_id: 'course2', name: 'Second' })
  })

  it('creates a course or a track with no file, placed where it was asked', async () => {
    const fn = stubFetch(reply(201, {}))
    await createNode({ kind: 'course', title: 'AMC', placeIn: 't1' })
    const init = (fn.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'course', title: 'AMC', place_in: { container_id: 't1' } })
  })
})

describe('wsApi: the trash, the tag and the walk under a container', () => {
  it('lists, restores and purges through the trash routes, with the node id encoded', async () => {
    const fn = stubFetch(reply(200, {}))
    await listTrash()
    await restoreNode('asset:a/1')
    await purgeNode('n 2')
    const calls = fn.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET /api/ws/trash',
      'POST /api/ws/trash/asset%3Aa%2F1/restore',
      'DELETE /api/ws/trash/n%202',
    ])
  })

  it('restore returns the names that had to change, and a refused purge keeps the server code', async () => {
    stubFetch(reply(200, { restored: 'n1', renamed: [{ placement_id: 'p1', name: 'a (2)' }] }))
    expect(await restoreNode('n1')).toEqual({ restored: 'n1', renamed: [{ placement_id: 'p1', name: 'a (2)' }] })
    stubFetch(reply(400, { error: 'asset_in_use', message: 'It is an upload that still exists.' }))
    const err = await purgeNode('asset:a1').catch((e) => e)
    expect(err).toBeInstanceOf(WsError)
    expect(err.code).toBe('asset_in_use')
  })

  it('sets or clears a kind tag with a PATCH to the node, sending null for no tag', async () => {
    const fn = stubFetch(reply(200, {}))
    await setKindTag('f1', 'homework')
    await setKindTag('f1', null)
    const calls = fn.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual(['PATCH /api/ws/nodes/f1', 'PATCH /api/ws/nodes/f1'])
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ kind_tag: 'homework' })
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ kind_tag: null })
  })

  it('reads everything under a container with a scope-only search', async () => {
    const fn = stubFetch(reply(200, []))
    await searchUnder('t 1')
    expect((fn.mock.calls as unknown as [string, RequestInit][])[0][0]).toBe('/api/ws/search?scope=t%201')
  })
})
