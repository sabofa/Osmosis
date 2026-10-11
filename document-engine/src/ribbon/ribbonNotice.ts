// A tiny channel for short status messages from ribbon commands (a denied
// clipboard, say) to the Ribbon that shows them. The command layer only knows
// `notify(message)`; the Ribbon subscribes and renders a live status line.
type Listener = (message: string) => void

const listeners = new Set<Listener>()

export function notifyRibbon(message: string): void {
  for (const l of [...listeners]) l(message)
}

export function subscribeRibbonNotices(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
