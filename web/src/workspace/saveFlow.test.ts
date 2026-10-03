import { describe, it, expect } from 'vitest'
import { draftFor, keepDraft, tryOverwrite, tryReload, trySave, type SaveApi } from './saveFlow'
import { WsError } from './wsApi'

// An API double that records what it was asked, in order.
function fakeApi(opts: { current?: number; onSave?: (base: number) => { revision: number } | Error; readFails?: boolean } = {}) {
  const calls: string[] = []
  const api: SaveApi = {
    async save(nodeId, body, base) {
      calls.push(`save ${nodeId} ${JSON.stringify(body)} base=${base}`)
      const out = opts.onSave ? opts.onSave(base) : { revision: base + 1 }
      if (out instanceof Error) throw out
      return out
    },
    async read(nodeId) {
      calls.push(`read ${nodeId}`)
      if (opts.readFails) throw new Error('offline')
      return { body: 'theirs', revision: opts.current ?? 9 }
    },
  }
  return { api, calls }
}
const stale = () => new WsError(409, 'stale_revision', 'moved on', { current_revision: 9 })

describe('trySave: a save always names the revision it started from', () => {
  it('saves against the given base and reports the new revision', async () => {
    const { api, calls } = fakeApi()
    expect(await trySave(api, 'n1', 'mine', 3)).toEqual({ kind: 'saved', revision: 4 })
    expect(calls).toEqual(['save n1 "mine" base=3'])
  })
  it('a 409 is a conflict, not a failure, and nothing is retried', async () => {
    const { api, calls } = fakeApi({ onSave: () => stale() })
    expect(await trySave(api, 'n1', 'mine', 3)).toEqual({ kind: 'conflict' })
    expect(calls).toHaveLength(1)
  })
  it('any other error is a failure carrying its message', async () => {
    const { api } = fakeApi({ onSave: () => new WsError(400, 'trashed', 'It is in the trash.') })
    expect(await trySave(api, 'n1', 'mine', 3)).toEqual({ kind: 'failed', message: 'It is in the trash.' })
  })
})

describe('tryOverwrite: read where the file is now, then save on top of that', () => {
  it('saves with the revision it just read, never the stale one, and in that order', async () => {
    const { api, calls } = fakeApi({ current: 9 })
    expect(await tryOverwrite(api, 'n1', 'mine')).toEqual({ kind: 'saved', revision: 10 })
    expect(calls).toEqual(['read n1', 'save n1 "mine" base=9'])
  })
  it('a second 409 (someone wrote in between) is a conflict again, not a blind retry', async () => {
    const { api, calls } = fakeApi({ onSave: () => stale() })
    expect(await tryOverwrite(api, 'n1', 'mine')).toEqual({ kind: 'conflict' })
    expect(calls.filter((c) => c.startsWith('save'))).toHaveLength(1)
  })
  it('if the read fails nothing is saved', async () => {
    const { api, calls } = fakeApi({ readFails: true })
    expect(await tryOverwrite(api, 'n1', 'mine')).toEqual({ kind: 'failed', message: 'offline' })
    expect(calls).toEqual(['read n1'])
  })
})

describe('tryReload: take the file as it is now', () => {
  it('returns its body and revision, an empty body as text', async () => {
    const { api } = fakeApi({ current: 5 })
    expect(await tryReload(api, 'n1')).toEqual({ kind: 'loaded', body: 'theirs', revision: 5 })
    const nullBody: SaveApi = { ...api, read: async () => ({ body: null, revision: 2 }) }
    expect(await tryReload(nullBody, 'n1')).toEqual({ kind: 'loaded', body: '', revision: 2 })
  })
  it('a failed read is a failure and changes nothing', async () => {
    const { api } = fakeApi({ readFails: true })
    expect(await tryReload(api, 'n1')).toEqual({ kind: 'failed', message: 'offline' })
  })
})

describe('the drafts that wait for a file to be opened again', () => {
  it('keeps a draft per file until it is cleared', () => {
    expect(draftFor('d1')).toBeNull()
    keepDraft('d1', { text: 'half', base: 2 })
    keepDraft('d2', { text: 'other', base: 7 })
    expect(draftFor('d1')).toEqual({ text: 'half', base: 2 })
    keepDraft('d1', null)
    expect(draftFor('d1')).toBeNull()
    expect(draftFor('d2')).toEqual({ text: 'other', base: 7 })
    keepDraft('d2', null)
  })
})
