// Pure pieces of the ribbon's motion: where the sliding indicators go, where a
// popover grows from, and the mount/unmount state machine that keeps a closing
// popover in the DOM until its exit animation has played (usePresence.ts wraps
// it in a hook). No DOM here, so all of it is unit-tested.

/** Where a 1px-wide indicator bar must be so it covers [offsetLeft, offsetLeft + offsetWidth]. */
export function inkGeometry(target: { offsetLeft: number; offsetWidth: number }): { x: number; w: number } {
  const r = (n: number) => Math.round(n * 100) / 100
  return { x: r(target.offsetLeft), w: Math.max(0, r(target.offsetWidth)) }
}

/** The transform of a 1px, left-origin indicator bar for a geometry (translate then stretch). */
export function inkTransform(g: { x: number; w: number }): string {
  return `translateX(${g.x}px) scaleX(${g.w})`
}

/** transform-origin x (px, popover coordinates) so a popover grows from the middle of its trigger. */
export function popoverOriginX(anchorLeft: number, anchorWidth: number, popLeft: number, popWidth: number): number {
  const x = anchorLeft + anchorWidth / 2 - popLeft
  return Math.round(Math.max(0, Math.min(popWidth, x)) * 100) / 100
}

// ---------------------------------------------------------------- presence

export interface PresenceState {
  /** the caller's wish */
  open: boolean
  /** the element is in the DOM (open, or still playing its exit) */
  mounted: boolean
  /** bumps on every fresh open so a reopen mid-exit remounts cleanly */
  gen: number
}

export type PresenceEvent = 'open' | 'close' | 'done'

export const presenceInit = (open: boolean): PresenceState => ({ open, mounted: open, gen: 0 })

export function presenceReduce(s: PresenceState, e: PresenceEvent): PresenceState {
  switch (e) {
    case 'open':
      return s.open ? s : { open: true, mounted: true, gen: s.gen + 1 }
    case 'close':
      return s.open ? { ...s, open: false } : s
    case 'done':
      // an exit that finishes after a reopen must not unmount the new popover
      return s.open || !s.mounted ? s : { ...s, mounted: false }
  }
}

/** "0.12s, 80ms" -> [120, 80]; unparseable parts count as 0. */
export function parseTimeList(list: string): number[] {
  return list.split(',').map((part) => {
    const m = /^\s*(-?[\d.]+)(ms|s)\s*$/.exec(part)
    if (!m) return 0
    const n = parseFloat(m[1])
    return m[2] === 's' ? n * 1000 : n
  })
}

/**
 * How long an exit takes: the longest duration + delay among the element's
 * animations and transitions (computed-style lists, paired by index). 0 means
 * there is nothing to wait for (reduced motion, scale 0, no exit style).
 */
export function exitDurationMs(
  animationDuration: string, animationDelay: string, transitionDuration: string, transitionDelay: string,
  /** Optional computed `animation-name` / `transition-property` lists: entries that are not really running are not counted. */
  animationName?: string, transitionProperty?: string,
): number {
  const list = (v: string) => v.split(',').map((x) => x.trim())
  const total = (dur: string, del: string, keep?: (i: number) => boolean) => {
    const d = parseTimeList(dur)
    const l = parseTimeList(del)
    return d.reduce((mx, v, i) => (keep && !keep(i) ? mx : Math.max(mx, v > 0 ? v + Math.max(0, l[i % Math.max(1, l.length)] ?? 0) : 0)), 0)
  }
  const names = animationName === undefined ? null : list(animationName)
  const props = transitionProperty === undefined ? null : list(transitionProperty)
  return Math.max(
    // an `animation-name: none` slot runs nothing, whatever its duration says (lists cycle)
    total(animationDuration, animationDelay, names ? (i) => names[i % names.length] !== 'none' : undefined),
    total(transitionDuration, transitionDelay, props ? (i) => ['all', 'opacity', 'transform'].includes(props[i % props.length]) : undefined),
  )
}

/**
 * Whether an animationend / transitionend event marks the END of the exit: it
 * must come from the element itself (not a bubbling child), and be the exit
 * animation (one of the element's running animation names) or an opacity /
 * transform transition.
 */
export function isExitEnd(
  e: { type: string; target: unknown; animationName?: string; propertyName?: string },
  el: unknown,
  runningAnimationNames: string,
): boolean {
  if (e.target !== el) return false
  if (e.type === 'animationend') {
    return !!e.animationName && runningAnimationNames.split(',').some((n) => n.trim() === e.animationName)
  }
  if (e.type === 'transitionend') return e.propertyName === 'opacity' || e.propertyName === 'transform'
  return false
}
