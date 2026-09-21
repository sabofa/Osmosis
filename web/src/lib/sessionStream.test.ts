import { describe, it, expect } from 'vitest'
import {
  bannerText,
  contextAt,
  entryKey,
  isCollapsed,
  openItem,
  pendingShow,
  stateLine,
  stubLabel,
  stubReason,
  timerSecondsLeft,
  type ItemEntry,
  type ShowEntry,
  type StreamEntry,
} from './sessionStream'

function item(partial: Partial<ItemEntry> & { attempt_id: string }): ItemEntry {
  return {
    kind: 'item',
    at: '2026-09-21 10:00:00',
    response_id: `r-${partial.attempt_id}`,
    reveal: 'immediate',
    revealed: false,
    status: 'answered',
    context: null,
    ...partial,
  }
}

function show(partial: Partial<ShowEntry> & { show_id: string }): ShowEntry {
  return {
    kind: 'show',
    at: '2026-09-21 10:00:00',
    show_kind: 'text',
    payload: 'something',
    caption: null,
    context: null,
    seen_at: null,
    acknowledged_at: null,
    updated_at: null,
    ...partial,
  }
}

describe('entryKey and openItem', () => {
  it('names an entry by its kind and id', () => {
    expect(entryKey(item({ attempt_id: 'a' }))).toBe('item:a')
    expect(entryKey(show({ show_id: 's' }))).toBe('show:s')
  })

  it('finds the newest item still waiting on an answer, counting a paused one', () => {
    const entries: StreamEntry[] = [
      item({ attempt_id: 'a', status: 'answered' }),
      show({ show_id: 's' }),
      item({ attempt_id: 'b', status: 'pending' }),
    ]
    expect(openItem(entries)?.attempt_id).toBe('b')
    expect(openItem([item({ attempt_id: 'c', status: 'paused' })])?.attempt_id).toBe('c')
    expect(openItem([item({ attempt_id: 'd', status: 'abandoned' })])).toBeNull()
    expect(openItem([])).toBeNull()
  })
})

describe('the reveal gate (§5.5)', () => {
  it('collapses everything before an open item and nothing from the item on', () => {
    const entries: StreamEntry[] = [
      show({ show_id: 's1' }),
      item({ attempt_id: 'a', status: 'answered', revealed: true }),
      item({ attempt_id: 'b', status: 'pending' }),
    ]
    expect(entries.map((_, i) => isCollapsed(entries, i))).toEqual([true, true, false])
    expect(stubReason(entries, 0)).toBe('collapsed while an item is open')
  })

  it('expands everything again once the outcome is recorded', () => {
    const entries: StreamEntry[] = [
      show({ show_id: 's1' }),
      item({ attempt_id: 'a', status: 'answered', revealed: true }),
      item({ attempt_id: 'b', status: 'answered', revealed: true }),
    ]
    expect(entries.map((_, i) => isCollapsed(entries, i))).toEqual([false, false, false])
    expect(stubReason(entries, 0)).toBeNull()
  })

  it('keeps a deferred item collapsed until the server reveals it, open item or not', () => {
    const held = item({ attempt_id: 'a', status: 'answered', reveal: 'deferred', revealed: false })
    expect(isCollapsed([held], 0)).toBe(true)
    expect(stubReason([held], 0)).toBe('held until the session ends')

    const released = { ...held, revealed: true }
    expect(isCollapsed([released], 0)).toBe(false)
    expect(stubReason([released], 0)).toBeNull()
  })

  it('never collapses an open item, even under a deferred reveal', () => {
    // An unanswered deferred item is unrevealed by definition. Collapsing it
    // would hide the question Ben has just been asked.
    const entries: StreamEntry[] = [
      show({ show_id: 's1' }),
      item({ attempt_id: 'a', status: 'pending', reveal: 'deferred', revealed: false }),
    ]
    expect(isCollapsed(entries, 1)).toBe(false)
    expect(stubReason(entries, 1)).toBeNull()
    expect(isCollapsed(entries, 0)).toBe(true)

    const paused = [{ ...entries[1], status: 'paused' } as ItemEntry]
    expect(isCollapsed(paused, 0)).toBe(false)
  })

  it("collapses the open item's own earlier siblings but never the open item itself", () => {
    const entries: StreamEntry[] = [
      item({ attempt_id: 'a', status: 'answered', revealed: true }),
      item({ attempt_id: 'b', status: 'paused' }),
    ]
    expect(isCollapsed(entries, 1)).toBe(false)
    expect(isCollapsed(entries, 0)).toBe(true)
  })

  it('ignores an index that does not exist', () => {
    expect(isCollapsed([], 0)).toBe(false)
    expect(stubReason([], 3)).toBeNull()
  })
})

describe('stubLabel', () => {
  it('prefers a show caption, then names the kind, then quotes the first line', () => {
    expect(stubLabel(show({ show_id: 's', caption: 'the parabola' }))).toBe('the parabola')
    expect(stubLabel(show({ show_id: 's', show_kind: 'graph', payload: 'plot y = x^2' }))).toBe('Graph')
    expect(stubLabel(show({ show_id: 's', payload: '\n\nTwo moles of water.\nand more' }))).toBe(
      'Two moles of water.'
    )
  })

  it('truncates a long first line rather than letting the stub wrap', () => {
    const label = stubLabel(show({ show_id: 's', payload: 'x'.repeat(200) }))
    expect(label).toHaveLength(60)
    expect(label.endsWith('…')).toBe(true)
  })

  it('says what happened to an item and never what it asked', () => {
    expect(stubLabel(item({ attempt_id: 'a', status: 'answered' }))).toBe('Item — answered')
    expect(stubLabel(item({ attempt_id: 'a', status: 'abandoned' }))).toBe('Item — not answered')
    expect(stubLabel(item({ attempt_id: 'a', status: 'paused' }))).toBe('Item — paused')
    expect(stubLabel(item({ attempt_id: 'a', status: 'pending' }))).toBe('Item')
  })
})

describe('the banner and the state line', () => {
  it('joins the parts the tutor named with a middot, skipping the ones it did not', () => {
    expect(bannerText({ course: 'Chemistry', unit: 'Unit 2', node: 'moles', step: 'probe' })).toBe(
      'Chemistry · Unit 2 · moles · probe'
    )
    expect(bannerText({ course: 'Chemistry', step: 'probe' })).toBe('Chemistry · probe')
    expect(bannerText({ course: '   ' })).toBe('')
    expect(bannerText(null)).toBe('')
    expect(bannerText(undefined)).toBe('')
  })

  it('says who is being waited on', () => {
    expect(stateLine([item({ attempt_id: 'a', status: 'pending' })])).toBe('waiting on you')
    expect(stateLine([item({ attempt_id: 'a', status: 'answered' })])).toBe('tutor is thinking')
    expect(stateLine([])).toBe('tutor is thinking')
  })
})

describe('pendingShow', () => {
  it('is the newest unacknowledged show', () => {
    const entries: StreamEntry[] = [
      show({ show_id: 's1' }),
      show({ show_id: 's2', acknowledged_at: '2026-09-21 10:00:01' }),
      show({ show_id: 's3' }),
    ]
    expect(pendingShow(entries)?.show_id).toBe('s3')
  })

  it('is nothing while an item is open — Space belongs to the item then', () => {
    const entries: StreamEntry[] = [show({ show_id: 's1' }), item({ attempt_id: 'a', status: 'pending' })]
    expect(pendingShow(entries)).toBeNull()
  })

  it('is nothing when every show has been acknowledged', () => {
    expect(pendingShow([show({ show_id: 's', acknowledged_at: '2026-09-21 10:00:01' })])).toBeNull()
  })
})

describe('the context timer', () => {
  const started = '2026-09-21 10:00:00'
  const startedMs = Date.parse('2026-09-21T10:00:00Z')

  it('counts down from the moment the context landed', () => {
    expect(timerSecondsLeft({ timer_s: 90 }, started, startedMs)).toBe(90)
    expect(timerSecondsLeft({ timer_s: 90 }, started, startedMs + 30_000)).toBe(60)
  })

  it('stops at zero rather than going negative', () => {
    expect(timerSecondsLeft({ timer_s: 10 }, started, startedMs + 60_000)).toBe(0)
  })

  it('is nothing without a timer, a start, or a parseable start', () => {
    expect(timerSecondsLeft({ course: 'chem' }, started, startedMs)).toBeNull()
    expect(timerSecondsLeft(null, started, startedMs)).toBeNull()
    expect(timerSecondsLeft({ timer_s: 60 }, null, startedMs)).toBeNull()
    expect(timerSecondsLeft({ timer_s: 60 }, 'not a date', startedMs)).toBeNull()
  })

  it('counts from the last entry that carried a context, not the last entry', () => {
    const entries: StreamEntry[] = [
      show({ show_id: 's1', at: '2026-09-21 10:00:00', context: { timer_s: 60 } }),
      item({ attempt_id: 'a', at: '2026-09-21 10:00:30', context: null }),
    ]
    expect(contextAt(entries)).toBe('2026-09-21 10:00:00')
    expect(contextAt([item({ attempt_id: 'a' })])).toBeNull()
  })
})
