import { describe, it, expect } from 'vitest'
import { purgeBody, purgeProblem, restoreNotice } from './trash'
import { WsError } from './wsApi'

describe('restoreNotice: what Restore says happened', () => {
  it('is plain when nothing had to change', () => {
    expect(restoreNotice('Week 1', [])).toBe('Restored "Week 1".')
  })
  it('names each name that was taken in the meantime, so Ben knows where it is now', () => {
    expect(restoreNotice('Week 1', [{ placement_id: 'p1', name: 'Week 1 (2)' }])).toBe(
      'Restored "Week 1". A name was already taken in 1 place, so it is called "Week 1 (2)" there.'
    )
    expect(
      restoreNotice('Week 1', [
        { placement_id: 'p1', name: 'Week 1 (2)' },
        { placement_id: 'p2', name: 'Notes (3)' },
      ])
    ).toBe('Restored "Week 1". A name was already taken in 2 places, so its names there are "Week 1 (2)", "Notes (3)".')
  })
})

describe('purgeProblem: why a purge was refused', () => {
  it('an upload that still exists says where to delete it', () => {
    const err = new WsError(400, 'asset_in_use', 'server words')
    expect(purgeProblem(err, 'Ebbing ch3')).toBe(
      '"Ebbing ch3" is an upload that still exists, so it cannot be purged here. Delete the upload in Settings → Documents, then purge it.'
    )
  })
  it('anything else is the server\'s own message', () => {
    expect(purgeProblem(new WsError(400, 'not_trashed', 'It must be in the trash first.'), 'x')).toBe('It must be in the trash first.')
    expect(purgeProblem(new Error('offline'), 'x')).toBe('offline')
  })
})

describe('purgeBody: what the confirm tells Ben is lost', () => {
  it('says permanently, and that it cannot be undone', () => {
    expect(purgeBody('file')).toMatch(/permanently/i)
    expect(purgeBody('file')).toMatch(/cannot be undone/)
  })
  it('a file loses its content and revisions; a container leaves what was only in it unplaced', () => {
    expect(purgeBody('file')).toMatch(/every saved revision/)
    for (const kind of ['track', 'course', 'folder'] as const) expect(purgeBody(kind)).toMatch(/placed only in it become unplaced/)
  })
})
