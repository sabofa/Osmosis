// ----------------------------------------------------------------------------
// The push channel's client half (spec §5.4). The server publishes session
// events on GET /api/sessions/:id/events; this subscribes to them so the live
// screen re-reads the moment the tutor does something, rather than up to a
// poll interval later.
//
// An event is a *nudge*, never state: every consumer re-fetches the real thing
// when one arrives. That is what makes the polling fallback equivalent rather
// than merely similar — a missed event costs a re-read, not correctness.
// ----------------------------------------------------------------------------

export const SESSION_EVENT_TYPES = [
  'item_presented',
  'item_answered',
  'attempt_paused',
  'attempt_resumed',
  'session_ended',
] as const

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]

export interface SessionEvent {
  type: SessionEventType
  at: string
  attempt_id?: string | null
  response_id?: string | null
  session_id?: string | null
}

export type StreamState = 'connected' | 'reconnecting'

export function sessionEventsUrl(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/events`
}

// Anything that isn't a well-formed event of a type we know is dropped rather
// than handed on: this data crosses a network boundary, and a consumer that
// re-fetches on `undefined` is worse than one that re-fetches a beat later.
export function parseSessionEvent(data: unknown): SessionEvent | null {
  if (typeof data !== 'string' || data.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.type !== 'string') return null
  if (!(SESSION_EVENT_TYPES as readonly string[]).includes(obj.type)) return null
  if (typeof obj.at !== 'string') return null
  return obj as unknown as SessionEvent
}

// Whether this browser can stream at all. An old or stripped-down runtime
// without EventSource keeps the pre-push behaviour exactly, so the caller
// never has to special-case it beyond "am I connected".
export function canStreamSessionEvents(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { EventSource?: unknown }).EventSource === 'function'
}

// Returns an unsubscribe function. onStateChange reports 'connected' once the
// stream is open and 'reconnecting' whenever it drops — EventSource retries on
// its own (the server sends `retry: 2000`), so the caller's job on
// 'reconnecting' is to fall back to polling, not to resubscribe.
export function subscribeSession(
  sessionId: string,
  onEvent: (event: SessionEvent) => void,
  onStateChange?: (state: StreamState) => void
): () => void {
  if (!canStreamSessionEvents()) return () => {}

  const source = new EventSource(sessionEventsUrl(sessionId))
  let closed = false

  const handle = (raw: MessageEvent) => {
    const event = parseSessionEvent(raw.data)
    if (event) onEvent(event)
  }

  // The server names every event, so the default `message` handler never sees
  // them; `message` is kept anyway for an unnamed event from an older server.
  for (const type of SESSION_EVENT_TYPES) source.addEventListener(type, handle as EventListener)
  source.addEventListener('message', handle as EventListener)
  source.addEventListener('open', () => onStateChange?.('connected'))
  source.addEventListener('error', () => {
    if (!closed) onStateChange?.('reconnecting')
  })

  return () => {
    if (closed) return
    closed = true
    source.close()
  }
}
