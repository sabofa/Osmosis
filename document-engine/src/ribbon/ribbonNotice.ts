// A tiny channel for short status messages from ribbon commands (a denied
// clipboard, say) to the Ribbon that shows them. The command layer only knows
// `notify(message)`; the Ribbon subscribes and renders a live status line.
type Listener = (message: string) => void

const listeners = new Set<Listener>()

/** A private notice channel: give one to a viewer so its ribbon hears only its own messages. */
export interface RibbonNotices {
  notify(message: string): void
  subscribe(fn: Listener): () => void
}

export function createRibbonNotices(): RibbonNotices {
  const own = new Set<Listener>()
  return {
    notify: (m) => {
      for (const l of [...own]) l(m)
    },
    subscribe: (fn) => {
      own.add(fn)
      return () => {
        own.delete(fn)
      }
    },
  }
}

export function notifyRibbon(message: string): void {
  for (const l of [...listeners]) l(message)
}

export function subscribeRibbonNotices(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
