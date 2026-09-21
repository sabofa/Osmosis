import { describe, it, expect, afterEach } from 'vitest'
import {
  parseSessionEvent,
  sessionEventsUrl,
  subscribeSession,
  canStreamSessionEvents,
  type SessionEvent,
  type StreamState,
} from './liveEvents'
import { attemptSourceLabel } from './api'

describe('parseSessionEvent', () => {
  it('parses a well-formed event', () => {
    const e = parseSessionEvent(
      JSON.stringify({ type: 'item_presented', at: '2026-09-21T10:00:00.000Z', attempt_id: 'a', response_id: 'r' })
    )
    expect(e).toEqual({ type: 'item_presented', at: '2026-09-21T10:00:00.000Z', attempt_id: 'a', response_id: 'r' })
  })

  it('drops anything malformed rather than handing it on', () => {
    expect(parseSessionEvent('')).toBeNull()
    expect(parseSessionEvent('not json')).toBeNull()
    expect(parseSessionEvent('[1,2]')).toBeNull()
    expect(parseSessionEvent('null')).toBeNull()
    expect(parseSessionEvent(JSON.stringify({ at: '2026-09-21T10:00:00.000Z' }))).toBeNull()
    expect(parseSessionEvent(JSON.stringify({ type: 'item_presented' }))).toBeNull()
    // A type this build doesn't know about: ignored, not passed through.
    expect(parseSessionEvent(JSON.stringify({ type: 'show_presented', at: 'now' }))).toBeNull()
    expect(parseSessionEvent(undefined)).toBeNull()
  })
})

describe('sessionEventsUrl', () => {
  it('escapes the session id', () => {
    expect(sessionEventsUrl('a/b?c')).toBe('/api/sessions/a%2Fb%3Fc/events')
  })
})

// A stand-in for the browser's EventSource: enough of the interface for
// subscribeSession, plus a way to drive it from the test.
class FakeEventSource {
  static last: FakeEventSource | null = null
  url: string
  closed = false
  private listeners = new Map<string, EventListener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }
  addEventListener(type: string, fn: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
  }
  dispatch(type: string, data?: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as unknown as Event)
  }
}

describe('subscribeSession', () => {
  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource
    FakeEventSource.last = null
  })

  it('is an inert no-op when the runtime has no EventSource', () => {
    expect(canStreamSessionEvents()).toBe(false)
    const events: SessionEvent[] = []
    const off = subscribeSession('s1', (e) => events.push(e))
    off()
    expect(events).toHaveLength(0)
  })

  it('reports connection state and delivers named events', () => {
    ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
    const events: SessionEvent[] = []
    const states: StreamState[] = []
    const off = subscribeSession('s1', (e) => events.push(e), (s) => states.push(s))

    const source = FakeEventSource.last!
    expect(source.url).toBe('/api/sessions/s1/events')

    source.dispatch('open')
    // The server names its events, so this arrives as item_presented, not message.
    source.dispatch('item_presented', JSON.stringify({ type: 'item_presented', at: 'now', attempt_id: 'a1' }))
    source.dispatch('item_presented', 'garbage')
    source.dispatch('error')

    expect(states).toEqual(['connected', 'reconnecting'])
    expect(events).toHaveLength(1)
    expect(events[0].attempt_id).toBe('a1')

    off()
    expect(source.closed).toBe(true)

    // An error fired after unsubscribing must not report a state change on a
    // stream the caller has already let go of.
    source.dispatch('error')
    expect(states).toEqual(['connected', 'reconnecting'])
  })
})

describe('attemptSourceLabel', () => {
  it('labels only a tutor-driven attempt', () => {
    expect(attemptSourceLabel('tutor')).toBe('tutor')
    expect(attemptSourceLabel('self')).toBeNull()
    expect(attemptSourceLabel(undefined)).toBeNull()
  })
})
