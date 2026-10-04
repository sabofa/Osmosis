import { describe, it, expect } from 'vitest'
import {
  chosenByDefault,
  deleteBody,
  deleteNotice,
  matesNotice,
  matesOffer,
  orphanLabel,
  removeNotice,
  purgeBody,
  purgeProblem,
  restoreChoices,
  restoreNotice,
  restoreSummary,
} from './archive'
import { WsError, type ArchivedPlacement, type NodeSummary, type RestoreOutcome } from './wsApi'

const placement = (id: string, name: string, container: { id: string; title: string; archived: boolean; kind?: ArchivedPlacement['container']['kind'] }): ArchivedPlacement => ({
  placement_id: id,
  name,
  container: { id: container.id, kind: container.kind ?? 'course', title: container.title, archived: container.archived },
})

describe('restoreChoices: the checklist of a node\'s archived placements', () => {
  const live = placement('p1', 'Week 1', { id: 'c1', title: 'Calc', archived: false })
  const waiting = placement('p2', 'Week 1 notes', { id: 'c2', title: 'Physics', archived: true })

  it('one choice per placement, in the order the server gave them, with the name and the container', () => {
    const choices = restoreChoices([live, waiting])
    expect(choices.map((c) => c.placementId)).toEqual(['p1', 'p2'])
    expect(choices[0]).toMatchObject({ name: 'Week 1', container: { id: 'c1', kind: 'course', title: 'Calc' } })
  })
  it('a placement whose container is live comes back now, with no note', () => {
    expect(restoreChoices([live])[0]).toMatchObject({ when: 'now', note: null })
  })
  it('a placement whose container is still archived is pending: it comes back when that container is restored', () => {
    expect(restoreChoices([waiting])[0]).toMatchObject({ when: 'later', note: 'comes back when "Physics" is restored' })
  })
  it('a node with no archived placements has an empty checklist', () => {
    expect(restoreChoices([])).toEqual([])
  })
})

describe('chosenByDefault: everything is ticked, because what is not chosen is forgotten for good', () => {
  it('ticks the placements that come back now and the ones that wait', () => {
    const choices = restoreChoices([
      placement('p1', 'a', { id: 'c1', title: 'A', archived: false }),
      placement('p2', 'b', { id: 'c2', title: 'B', archived: true }),
    ])
    expect(chosenByDefault(choices)).toEqual(['p1', 'p2'])
    expect(chosenByDefault([])).toEqual([])
  })
})

describe('restoreSummary: what pressing Restore will do with this choice', () => {
  const choices = restoreChoices([
    placement('now1', 'a', { id: 'c1', title: 'A', archived: false }),
    placement('now2', 'b', { id: 'c2', title: 'B', archived: false }),
    placement('later', 'c', { id: 'c3', title: 'C', archived: true }),
  ])

  it('a file with no former places comes back unplaced; a container comes back at the top level', () => {
    expect(restoreSummary([], [], 'file')).toBe('It has no former places, so it comes back unplaced.')
    expect(restoreSummary([], [], 'folder')).toBe('It has no former places, so it comes back unplaced.')
    expect(restoreSummary([], [], 'track')).toBe('It has no former places, so it comes back at the top level.')
  })
  it('counts the places that come back now', () => {
    expect(restoreSummary(choices, ['now1', 'now2', 'later'], 'file')).toBe(
      'Back in 2 places now. 1 place waits for its container to be restored.'
    )
    expect(restoreSummary(choices, ['now1'], 'file')).toBe('Back in 1 place now. 2 unchosen places are forgotten.')
  })
  it('says what is left behind, in the singular and the plural', () => {
    expect(restoreSummary(choices, ['now1', 'now2'], 'file')).toBe('Back in 2 places now. 1 unchosen place is forgotten.')
    const twoWaiting = restoreChoices([
      placement('l1', 'a', { id: 'c1', title: 'A', archived: true }),
      placement('l2', 'b', { id: 'c2', title: 'B', archived: true }),
    ])
    expect(restoreSummary(twoWaiting, ['l1', 'l2'], 'file')).toBe('Unplaced for now. 2 places wait for their containers to be restored.')
  })
  it('choosing nothing restores it unplaced and forgets the rest', () => {
    expect(restoreSummary(choices, [], 'file')).toBe('Nothing chosen: it comes back unplaced. 3 unchosen places are forgotten.')
    expect(restoreSummary(choices, [], 'course')).toBe('Nothing chosen: it comes back at the top level. 3 unchosen places are forgotten.')
  })
})

describe('restoreNotice: what Restore says happened', () => {
  const outcome = (over: Partial<RestoreOutcome> = {}): RestoreOutcome => ({
    restored: 'n1',
    placements: [{ placement_id: 'p1', name: 'Week 1', renamed: false }],
    skipped: [],
    batch_mates: [],
    ...over,
  })

  it('is plain when nothing had to change', () => {
    expect(restoreNotice({ title: 'Week 1', kind: 'file' }, outcome())).toBe('Restored "Week 1".')
  })
  it('names each name that was taken in the meantime, so Ben knows where it is now', () => {
    expect(
      restoreNotice({ title: 'Week 1', kind: 'file' }, outcome({ placements: [{ placement_id: 'p1', name: 'Week 1 (2)', renamed: true }] }))
    ).toBe('Restored "Week 1". A name was already taken in 1 place, so it is called "Week 1 (2)" there.')
    expect(
      restoreNotice(
        { title: 'Week 1', kind: 'file' },
        outcome({
          placements: [
            { placement_id: 'p1', name: 'Week 1 (2)', renamed: true },
            { placement_id: 'p2', name: 'Notes (3)', renamed: true },
            { placement_id: 'p3', name: 'Fine', renamed: false },
          ],
        })
      )
    ).toBe('Restored "Week 1". A name was already taken in 2 places, so its names there are "Week 1 (2)", "Notes (3)".')
  })
  it('reports the placements that wait for their container', () => {
    expect(restoreNotice({ title: 'Week 1', kind: 'file' }, outcome({ skipped: [{ placement_id: 'p9', reason: 'container_archived' }] }))).toBe(
      'Restored "Week 1". 1 place waits for its container to be restored.'
    )
    expect(
      restoreNotice(
        { title: 'Week 1', kind: 'file' },
        outcome({
          skipped: [
            { placement_id: 'p8', reason: 'container_archived' },
            { placement_id: 'p9', reason: 'container_archived' },
          ],
        })
      )
    ).toBe('Restored "Week 1". 2 places wait for their containers to be restored.')
  })
  it('tells Ben where to find it when it came back with no place at all', () => {
    expect(restoreNotice({ title: 'Week 1', kind: 'file' }, outcome({ placements: [] }))).toBe(
      'Restored "Week 1". It is unplaced: find it in the picker, under Unplaced.'
    )
    expect(restoreNotice({ title: 'quant', kind: 'track' }, outcome({ placements: [] }))).toBe(
      'Restored "quant". It is at the top level: find it in the picker.'
    )
    expect(
      restoreNotice({ title: 'Week 1', kind: 'folder' }, outcome({ placements: [], skipped: [{ placement_id: 'p9', reason: 'container_archived' }] }))
    ).toBe('Restored "Week 1". 1 place waits for its container to be restored. It is unplaced: find it in the picker, under Unplaced.')
  })
})

describe('matesOffer and matesNotice: what was deleted together with it', () => {
  const mate = (id: string): NodeSummary => ({
    id,
    kind: 'file',
    title: id,
    kind_tag: null,
    format: 'markdown',
    placement_count: 0,
    has_children: false,
    archived_at: '2026-10-04 10:00:00',
    top_level: false,
  })
  const outcome = (over: Partial<RestoreOutcome> = {}): RestoreOutcome => ({
    restored: 'x',
    placements: [{ placement_id: 'p', name: 'x', renamed: false }],
    skipped: [],
    batch_mates: [],
    ...over,
  })

  it('offers to restore the others of the same delete, by number', () => {
    expect(matesOffer([mate('a')])).toBe('Also restore 1 deleted with it')
    expect(matesOffer([mate('a'), mate('b'), mate('c')])).toBe('Also restore 3 deleted with it')
  })
  it('says how many came back, and by which names', () => {
    expect(matesNotice([{ title: 'a', out: outcome() }, { title: 'b', out: outcome() }], [])).toBe('Restored 2 more: "a", "b".')
  })
  it('adds the names that changed and the places still waiting, summed over all of them', () => {
    const renamed = outcome({ placements: [{ placement_id: 'p', name: 'x (2)', renamed: true }] })
    const waiting = outcome({ skipped: [{ placement_id: 'q', reason: 'container_archived' }] })
    expect(matesNotice([{ title: 'a', out: renamed }, { title: 'b', out: waiting }], [])).toBe(
      'Restored 2 more: "a", "b". A name was taken in 1 place, so it was renamed. 1 place waits for its container to be restored.'
    )
  })
  it('names the ones that could not be restored, with the server\'s reason', () => {
    expect(matesNotice([{ title: 'a', out: outcome() }], [{ title: 'b', message: 'It is not archived.' }])).toBe(
      'Restored 1 more: "a". Could not restore "b": It is not archived.'
    )
    expect(matesNotice([], [{ title: 'b', message: 'offline' }])).toBe('Could not restore "b": offline')
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
    expect(purgeProblem(new WsError(400, 'not_archived', 'It must be archived first.'), 'x')).toBe('It must be archived first.')
    expect(purgeProblem(new Error('offline'), 'x')).toBe('offline')
  })
})

describe('purgeBody: what the confirm tells Ben is lost', () => {
  it('says permanently, and that it cannot be undone', () => {
    expect(purgeBody('file')).toMatch(/permanently/i)
    expect(purgeBody('file')).toMatch(/cannot be undone/)
  })
  it('a file loses its content and versions; a container leaves what was only in it unplaced', () => {
    expect(purgeBody('file')).toMatch(/every saved version/)
    for (const kind of ['trajectory', 'track', 'course', 'folder'] as const) expect(purgeBody(kind)).toMatch(/placed only in it become unplaced/)
  })
})

describe('removeNotice: Remove from … takes one placement away (trash) and archives nothing', () => {
  it('says where it was removed from', () => {
    expect(removeNotice('Week 1', 'Calc', 'file', false)).toBe('Removed "Week 1" from "Calc".')
  })
  it('a file or folder that lost its last place is still in the picker, under Unplaced', () => {
    expect(removeNotice('Week 1', 'Calc', 'file', true)).toBe(
      'Removed "Week 1" from "Calc". It is not placed anywhere now. It is still in the picker, under Unplaced.'
    )
    expect(removeNotice('Notes', 'Calc', 'folder', true)).toMatch(/under Unplaced/)
  })
  it('a track or course that lost its last place is at the top level, not unplaced', () => {
    expect(removeNotice('Calc', 'Year 1', 'course', true)).toBe('Removed "Calc" from "Year 1". It is at the top level now. It is still in the picker.')
    expect(removeNotice('Year 1', 'quant', 'track', true)).not.toMatch(/Unplaced/)
  })
})

describe('the Delete… dialog: delete archives everywhere, remove-from takes one place away', () => {
  const where = [
    { placement_id: 'p1', name: 'Syllabus', container: { id: 't', kind: 'trajectory' as const, title: 'quant' } },
    { placement_id: 'p2', name: 'Plan', container: { id: 'k', kind: 'track' as const, title: 'Year 1' } },
  ]
  it('lists where it appears, since deleting takes it out of all of them', () => {
    expect(deleteBody('file', where, 0)).toBe('It goes to the Archive, so it disappears from every place it appears:\n  • quant, as "Syllabus"\n  • Year 1, as "Plan"')
  })
  it('says so when it is not placed anywhere', () => {
    expect(deleteBody('file', [], 0)).toBe('It is not placed anywhere.')
  })
  it('a container with items only inside it says what happens to them', () => {
    expect(deleteBody('course', where.slice(1), 2)).toBe(
      'It goes to the Archive, so it disappears from every place it appears:\n  • Year 1, as "Plan"\nItems placed only inside it are left without a place, unless you delete them with it.'
    )
  })
  it('a container with nothing only inside it says nothing about items, and neither does a file', () => {
    expect(deleteBody('track', where.slice(1), 0)).toBe('It goes to the Archive, so it disappears from every place it appears:\n  • Year 1, as "Plan"')
    expect(deleteBody('file', where.slice(1), 3)).not.toMatch(/Items placed/)
  })
  it('offers the orphans by number', () => {
    expect(orphanLabel(1)).toBe('Also delete 1 item placed nowhere else')
    expect(orphanLabel(4)).toBe('Also delete 4 items placed nowhere else')
  })
  it('says it is in the Archive afterwards, and with how many more', () => {
    expect(deleteNotice('Week 1', 1)).toBe('"Week 1" is in the Archive. Restore it from Archive in the picker (Switch).')
    expect(deleteNotice('Calc', 4)).toBe('"Calc" is in the Archive with 3 more. Restore it from Archive in the picker (Switch).')
  })
})
