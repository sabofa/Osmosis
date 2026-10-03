import { describe, it, expect } from 'vitest'
import { draftFor, keepDraft, mergeAppended, tryMerge, tryOverwrite, tryReload, trySave, type SaveApi } from './saveFlow'
import { WsError } from './wsApi'

// An API double that records what it was asked, in order.
function fakeApi(opts: { current?: number; currentBody?: string; onSave?: (base: number) => { revision: number } | Error; readFails?: boolean } = {}) {
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
      return { body: opts.currentBody ?? 'theirs', revision: opts.current ?? 9 }
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
    keepDraft('d1', { text: 'half', base: 2, baseBody: 'one' })
    keepDraft('d2', { text: 'other', base: 7, baseBody: 'two' })
    expect(draftFor('d1')).toEqual({ text: 'half', base: 2, baseBody: 'one' })
    keepDraft('d1', null)
    expect(draftFor('d1')).toBeNull()
    expect(draftFor('d2')).toEqual({ text: 'other', base: 7, baseBody: 'two' })
    keepDraft('d2', null)
  })
  it('keeps the body the draft started from beside its revision, which is what a merge needs', () => {
    keepDraft('d3', { text: 'edited', base: 4, baseBody: 'as opened' })
    expect(draftFor('d3')?.baseBody).toBe('as opened')
    keepDraft('d3', null)
  })
})

describe('mergeAppended: the tutor only added text at the end', () => {
  it('is draft + what was appended since the draft started', () => {
    const base = 'a note\n\nsecond'
    const current = 'a note\n\nsecond\n\n- tutor: confuses moles with mass'
    expect(mergeAppended(base, 'a note, edited\n\nsecond', current)).toEqual({
      suffix: '\n\n- tutor: confuses moles with mass',
      merged: 'a note, edited\n\nsecond\n\n- tutor: confuses moles with mass',
    })
  })
  it('several appends since are one suffix', () => {
    expect(mergeAppended('x', 'x!', 'x\n\none\n\ntwo')?.merged).toBe('x!\n\none\n\ntwo')
  })
  it('is not a pure append when the server text changed anywhere before the end', () => {
    expect(mergeAppended('hello world', 'hello there world', 'hello brave world\n\nmore')).toBeNull()
    expect(mergeAppended('abc', 'abc!', 'ab')).toBeNull() // shorter: something was removed
    expect(mergeAppended('abc', 'abc!', 'xabc')).toBeNull() // prepended
  })
  it('nothing appended is nothing to merge', () => {
    expect(mergeAppended('same', 'same, edited', 'same')).toBeNull()
  })
  it('an empty base takes the whole server text as the addition, set apart from my text by a blank line', () => {
    expect(mergeAppended('', 'mine', '- first tutor note')).toEqual({ suffix: '- first tutor note', merged: 'mine\n\n- first tutor note' })
  })
  it('does not insert anything when the draft is empty or already ends in a newline', () => {
    expect(mergeAppended('', '', '- note')?.merged).toBe('- note')
    expect(mergeAppended('', 'mine\n', '- note')?.merged).toBe('mine\n- note')
  })
  it('compares exactly: a different line ending or trailing space is not a prefix', () => {
    expect(mergeAppended('a\r\nb', 'a\r\nb!', 'a\nb\n\nmore')).toBeNull()
    expect(mergeAppended('a ', 'a !', 'a\n\nmore')).toBeNull()
  })
})

describe('a 409 with the base body known offers the merge only when it is safe', () => {
  it('reads where the file is now and reports what was appended', async () => {
    const { api, calls } = fakeApi({ onSave: () => stale(), currentBody: 'base\n\ntutor line' })
    expect(await trySave(api, 'n1', 'mine', 3, 'base')).toEqual({ kind: 'conflict', addition: '\n\ntutor line' })
    expect(calls).toEqual(['save n1 "mine" base=3', 'read n1'])
  })
  it('a rewrite of the middle is a plain conflict, with Reload and Overwrite and no merge', async () => {
    const { api } = fakeApi({ onSave: () => stale(), currentBody: 'rewritten' })
    expect(await trySave(api, 'n1', 'mine', 3, 'base')).toEqual({ kind: 'conflict' })
  })
  it('if the read after the 409 fails it is still a conflict, just without the offer', async () => {
    const { api } = fakeApi({ onSave: () => stale(), readFails: true })
    expect(await trySave(api, 'n1', 'mine', 3, 'base')).toEqual({ kind: 'conflict' })
  })
  it('a second 409 from an overwrite offers the merge again when the file only grew', async () => {
    const { api } = fakeApi({ onSave: () => stale(), currentBody: 'base more' })
    expect(await tryOverwrite(api, 'n1', 'mine', 'base')).toEqual({ kind: 'conflict', addition: ' more' })
  })
})

describe('tryMerge: draft plus their additions, saved against where the file is now', () => {
  it('saves the merged text on the revision it just read, and says what the new body is', async () => {
    const { api, calls } = fakeApi({ current: 9, currentBody: 'base\n\ntutor line' })
    expect(await tryMerge(api, 'n1', 'base, mine', 'base')).toEqual({ kind: 'saved', revision: 10, body: 'base, mine\n\ntutor line' })
    expect(calls).toEqual(['read n1', 'save n1 "base, mine\\n\\ntutor line" base=9'])
  })
  it('does not save when the file changed some other way since the offer', async () => {
    const { api, calls } = fakeApi({ currentBody: 'rewritten' })
    expect(await tryMerge(api, 'n1', 'mine', 'base')).toEqual({ kind: 'conflict' })
    expect(calls).toEqual(['read n1'])
  })
  it('if the tutor appended again in between, that is a conflict again with the fresh offer, never a blind overwrite', async () => {
    const { api, calls } = fakeApi({ currentBody: 'base\n\none\n\ntwo', onSave: () => stale() })
    expect(await tryMerge(api, 'n1', 'mine', 'base')).toEqual({ kind: 'conflict', addition: '\n\none\n\ntwo' })
    expect(calls.filter((c) => c.startsWith('save'))).toHaveLength(1)
  })
  it('a failed read saves nothing; any other save error is a failure', async () => {
    const down = fakeApi({ readFails: true })
    expect(await tryMerge(down.api, 'n1', 'mine', 'base')).toEqual({ kind: 'failed', message: 'offline' })
    expect(down.calls).toEqual(['read n1'])
    const refused = fakeApi({ currentBody: 'base more', onSave: () => new WsError(400, 'trashed', 'It is in the trash.') })
    expect(await tryMerge(refused.api, 'n1', 'mine', 'base')).toEqual({ kind: 'failed', message: 'It is in the trash.' })
  })
})
