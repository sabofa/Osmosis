// Keeps a popover / menu mounted until its exit animation ends. The element
// carries data-state="open" | "closed" (CSS plays the matching motion); when the
// caller closes it, this waits for animationend / transitionend, with a timer as
// the fallback, and unmounts at once if the element has no motion to play
// (reduced motion, --de-motion-scale: 0, a test environment). Focus is not
// touched here.
import { useLayoutEffect, useState, type RefObject } from 'react'
import { exitDurationMs, presenceInit, presenceReduce, type PresenceState } from './ribbonMotion'

const SLACK_MS = 60

export function usePresence(open: boolean, ref: RefObject<HTMLElement | null>): { mounted: boolean; state: 'open' | 'closed'; gen: number } {
  const [s, setS] = useState<PresenceState>(() => presenceInit(open))
  let cur = s
  if (cur.open !== open) {
    // derived during render so the closing frame never loses the element
    cur = presenceReduce(cur, open ? 'open' : 'close')
    setS(cur)
  }
  const exiting = cur.mounted && !cur.open
  useLayoutEffect(() => {
    if (!exiting) return
    const el = ref.current
    let ms = 0
    if (el && typeof getComputedStyle === 'function') {
      const cs = getComputedStyle(el)
      ms = exitDurationMs(cs.animationDuration, cs.animationDelay, cs.transitionDuration, cs.transitionDelay)
    }
    if (!el || ms <= 0) {
      setS((p) => presenceReduce(p, 'done'))
      return
    }
    const finish = () => setS((p) => presenceReduce(p, 'done'))
    const onEnd = (e: Event) => {
      if (e.target === el) finish()
    }
    el.addEventListener('animationend', onEnd)
    el.addEventListener('transitionend', onEnd)
    const timer = setTimeout(finish, ms + SLACK_MS)
    return () => {
      el.removeEventListener('animationend', onEnd)
      el.removeEventListener('transitionend', onEnd)
      clearTimeout(timer)
    }
  }, [exiting, cur.gen, ref])
  return { mounted: cur.mounted, state: cur.open ? 'open' : 'closed', gen: cur.gen }
}
