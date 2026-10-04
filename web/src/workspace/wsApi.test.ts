import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WsError,
  createNode,
  deleteNode,
  freeNameOf,
  getArchive,
  getArchivedPlacements,
  getByKindTag,
  getContent,
  getDeletePreview,
  getRoots,
  getUnplaced,
  isStale,
  placeNode,
  purgeNode,
  renamePlacement,
  restoreNode,
  saveContent,
  searchUnder,
  setKindTag,
  trashPlacement,
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

// "METHOD url" of each call, and the JSON body of one.
type Call = [string, RequestInit]
const lines = (fn: ReturnType<typeof stubFetch>) => (fn.mock.calls as unknown as Call[]).map(([url, init]) => `${init.method} ${url}`)
const bodyOf = (fn: ReturnType<typeof stubFetch>, n: number) => JSON.parse((fn.mock.calls as unknown as Call[])[n][1].body as string)

afterEach(() => vi.unstubAllGlobals())

describe('wsApi', () => {
  it('returns the parsed body of a good call', async () => {
    stubFetch(reply(200, { trajectories: [], tracks: [], courses: [] }))
    expect(await getRoots()).toEqual({ trajectories: [], tracks: [], courses: [] })
  })

  it('a 409 throws a WsError the caller can recognise', async () => {
    stubFetch(reply(409, { error: 'stale_version', message: 'moved on', detail: { current_version: 7 } }))
    const err = await saveContent('n1', 'text', 3).catch((e) => e)
    expect(err).toBeInstanceOf(WsError)
    expect(isStale(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.code).toBe('stale_version')
    expect((err.detail as { current_version: number }).current_version).toBe(7)
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
})

describe('wsApi: the routes the server has', () => {
  it('trash (one placement) and delete (the node, everywhere) are different calls on different paths', async () => {
    const fn = stubFetch(reply(200, {}))
    await trashPlacement('p/1')
    await deleteNode('n1', false)
    await deleteNode('n1', true)
    expect(lines(fn)).toEqual(['DELETE /api/ws/placements/p%2F1', 'DELETE /api/ws/nodes/n1', 'DELETE /api/ws/nodes/n1?with_orphans=true'])
  })

  it('reads the roots, the unplaced and the archive from their own routes', async () => {
    const fn = stubFetch(reply(200, []))
    await getUnplaced()
    await getArchive()
    expect(lines(fn)).toEqual(['GET /api/ws/unplaced', 'GET /api/ws/archive'])
  })

  it('the partition reads by-kind-tag with the scope, and everything under a container is a scope-only search, both encoded', async () => {
    const fn = stubFetch(reply(200, []))
    await getByKindTag('root 1', 'past-paper')
    await searchUnder('t 1')
    expect(lines(fn)).toEqual(['GET /api/ws/by-kind-tag?tag=past-paper&scope=root%201', 'GET /api/ws/search?scope=t%201'])
  })

  it('creates a node with only the fields the server takes: snake_case, nothing it would refuse', async () => {
    const fn = stubFetch(reply(201, {}))
    await createNode({ kind: 'file', title: 'T', format: 'markdown', body: '', container_id: 'c1' })
    await createNode({ kind: 'trajectory', title: 'quant' })
    await createNode({ kind: 'course', title: 'AMC', container_id: 't1', name: 'AMC prep' })
    expect(lines(fn)).toEqual(['POST /api/ws/nodes', 'POST /api/ws/nodes', 'POST /api/ws/nodes'])
    expect(bodyOf(fn, 0)).toEqual({ kind: 'file', title: 'T', format: 'markdown', body: '', container_id: 'c1' })
    expect(bodyOf(fn, 1)).toEqual({ kind: 'trajectory', title: 'quant' })
    expect(bodyOf(fn, 2)).toEqual({ kind: 'course', title: 'AMC', container_id: 't1', name: 'AMC prep' })
  })

  it('places an existing node: no name means "under its own title"', async () => {
    const fn = stubFetch(reply(201, {}))
    await placeNode('track1', 'course1')
    await placeNode('track1', 'course2', 'Second')
    expect(bodyOf(fn, 0)).toEqual({ container_id: 'track1', child_id: 'course1' })
    expect(bodyOf(fn, 1)).toEqual({ container_id: 'track1', child_id: 'course2', name: 'Second' })
  })

  it('renames one placement and sets or clears a kind tag, sending null for no tag and an open tag as typed', async () => {
    const fn = stubFetch(reply(200, {}))
    await renamePlacement('p1', 'Week 1')
    await setKindTag('f1', 'homework')
    await setKindTag('f1', 'past-paper')
    await setKindTag('f1', null)
    expect(lines(fn)).toEqual(['PATCH /api/ws/placements/p1', 'PATCH /api/ws/nodes/f1', 'PATCH /api/ws/nodes/f1', 'PATCH /api/ws/nodes/f1'])
    expect(bodyOf(fn, 0)).toEqual({ name: 'Week 1' })
    expect(bodyOf(fn, 1)).toEqual({ kind_tag: 'homework' })
    expect(bodyOf(fn, 2)).toEqual({ kind_tag: 'past-paper' })
    expect(bodyOf(fn, 3)).toEqual({ kind_tag: null })
  })
})

describe('wsApi: content is saved against a version', () => {
  it('reads a file\'s content and saves with base_version', async () => {
    const fn = stubFetch(reply(200, { node_id: 'n1', version: 4, format: 'markdown', body: 'x', asset_id: null, author: 'tutor', saved_at: 't' }))
    expect((await getContent('n1')).version).toBe(4)
    await saveContent('n1', 'text', 3)
    expect(lines(fn)).toEqual(['GET /api/ws/nodes/n1/content', 'PUT /api/ws/nodes/n1/content'])
    expect(bodyOf(fn, 1)).toEqual({ body: 'text', base_version: 3 })
  })
})

describe('wsApi: delete preview, the archive, restore with a choice, purge', () => {
  it('previews a delete and lists a node\'s archived placements, with the id encoded', async () => {
    const fn = stubFetch(reply(200, {}))
    await getDeletePreview('asset:a/1')
    await getArchivedPlacements('n 2')
    expect(lines(fn)).toEqual(['GET /api/ws/nodes/asset%3Aa%2F1/delete-preview', 'GET /api/ws/nodes/n%202/archived-placements'])
  })

  it('restore posts the chosen placement ids, an empty list when none is chosen', async () => {
    const fn = stubFetch(reply(200, {}))
    await restoreNode('n1', ['p1', 'p2'])
    await restoreNode('n1', [])
    expect(lines(fn)).toEqual(['POST /api/ws/nodes/n1/restore', 'POST /api/ws/nodes/n1/restore'])
    expect(bodyOf(fn, 0)).toEqual({ placements: ['p1', 'p2'] })
    expect(bodyOf(fn, 1)).toEqual({ placements: [] })
  })

  it('restore returns what came back, what waits and who else went with it', async () => {
    const reply1 = {
      restored: 'n1',
      placements: [{ placement_id: 'p1', name: 'a (2)', renamed: true }],
      skipped: [{ placement_id: 'p2', reason: 'container_archived' }],
      batch_mates: [],
    }
    stubFetch(reply(200, reply1))
    expect(await restoreNode('n1', ['p1', 'p2'])).toEqual(reply1)
  })

  it('purge goes through the archive route, and a refused purge keeps the server code', async () => {
    const fn = stubFetch(reply(200, { purged: 'n 2' }))
    await purgeNode('n 2')
    expect(lines(fn)).toEqual(['DELETE /api/ws/archive/n%202'])
    stubFetch(reply(400, { error: 'asset_in_use', message: 'It is an upload that still exists.' }))
    const err = await purgeNode('asset:a1').catch((e) => e)
    expect(err).toBeInstanceOf(WsError)
    expect(err.code).toBe('asset_in_use')
  })
})
