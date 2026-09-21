import { EventEmitter } from "node:events";

// ----------------------------------------------------------------------------
// The push channel (spec §5.4). One process-wide emitter, keyed by session id,
// that the domain writes publish to and the SSE route subscribes to. It is
// deliberately in-memory and fire-and-forget: an event is a *nudge* to re-read,
// never the state itself, so a client that missed one while reconnecting is
// only ever a poll behind rather than out of sync.
// ----------------------------------------------------------------------------

export type SessionEventType =
  | "item_presented"
  | "item_answered"
  | "attempt_paused"
  | "attempt_resumed"
  | "session_ended"
  // Showing (§5.1/§5.2): the tutor put something non-answerable on the
  // screen, or redrew a graph already on it.
  | "show_presented"
  | "show_updated";

export interface SessionEvent {
  type: SessionEventType;
  // When the write this announces committed, ISO-8601 with a Z.
  at: string;
  [key: string]: unknown;
}

export type SessionEventListener = (event: SessionEvent) => void;

const emitter = new EventEmitter();
// One listener per open stream, and a popular session can have several tabs
// open at once — the default cap of 10 would print a leak warning long before
// anything is actually wrong.
emitter.setMaxListeners(0);

// Emitted *after* the write commits, so a listener that re-reads inside the
// callback sees the state the event announced. A null session id is a no-op:
// present_item and the attempt routes both work outside a session, and there
// is nobody to tell about those.
export function emitSessionEvent(
  sessionId: string | null | undefined,
  event: { type: SessionEventType; at?: string; [key: string]: unknown }
): void {
  if (!sessionId) return;
  const full: SessionEvent = { ...event, at: event.at ?? new Date().toISOString() };
  emitter.emit(sessionId, full);
}

// Returns the unsubscribe function rather than expecting the caller to hold on
// to the listener identity — the SSE route has several exits (client close,
// app.close(), a write error) and each of them must remove exactly one
// listener, exactly once.
export function onSessionEvent(sessionId: string, listener: SessionEventListener): () => void {
  emitter.on(sessionId, listener);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    emitter.off(sessionId, listener);
  };
}

// Exists for the tests: "the stream went away and took its listener with it"
// is the property that keeps a long-lived node from leaking one per reconnect.
export function sessionEventListenerCount(sessionId: string): number {
  return emitter.listenerCount(sessionId);
}
