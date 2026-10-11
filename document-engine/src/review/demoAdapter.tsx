import { useSyncExternalStore, type ReactNode } from 'react'
import type { DocumentAdapter } from '../adapter/types'

// ?adapter=demo: a demo theme adapter for the review harness. Every effect is
// recorded on window.__demo so a script can assert it:
//   inits / cleanups / disposes   init() calls, its cleanup, dispose()
//   mounts / unmounts             mountPart calls and their cleanups
//   clicks                        clicks on the button injected into a ribbon group's after-slot
//   events                        every onEvent payload
//   highlightCalls                highlightCss() calls
// Deliberately throws from decoratePart('ribbon-panel') and onEvent('mode')
// to show the engine contains it (console.error once per hook, viewer intact).
export interface DemoState {
  inits: number
  cleanups: number
  disposes: number
  mounts: number
  unmounts: number
  clicks: number
  highlightCalls: number
  events: unknown[]
}

export function demoState(): DemoState {
  const w = window as unknown as { __demo?: DemoState }
  return (w.__demo ??= { inits: 0, cleanups: 0, disposes: 0, mounts: 0, unmounts: 0, clicks: 0, highlightCalls: 0, events: [] })
}

export const demoAdapter: DocumentAdapter = {
  id: 'demo',
  init() {
    const s = demoState()
    s.inits++
    return () => {
      s.cleanups++
    }
  },
  dispose() {
    demoState().disposes++
  },
  cssVars(vars) {
    return { ...vars, '--demo-var': 'on' }
  },
  css() {
    return '.document-viewer { --demo-css: 1; }'
  },
  highlightCss(_color, defaultCss) {
    demoState().highlightCalls++
    return defaultCss
  },
  onEvent(e) {
    demoState().events.push(e)
    if (e.type === 'mode') throw new Error('demo: onEvent throws on purpose')
  },
  chrome: {
    css() {
      return '[data-demo-badge] { font-size: 10px; padding: 0 5px; margin-right: 4px; border-radius: 99em; background: var(--de-accent); color: var(--de-page); }'
    },
    decoratePart(part) {
      if (part.kind === 'ribbon-panel' && part.id !== 'narrow') throw new Error('demo: decoratePart throws on purpose')
      if (part.kind === 'zoom') {
        return {
          className: 'demo-zoom',
          style: { '--demo-zoom': '1' },
          attrs: { 'data-demo': 'zoom', onclick: 'evil()', title: 'zoom (demo)' },
          before: <span data-demo-badge="">demo</span>,
        }
      }
      return null
    },
    renderPart(part, node) {
      if (part.kind === 'settings') {
        return (
          <span data-demo-settings="" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span data-demo-settings-label="">Options</span>
            {node}
          </span>
        )
      }
      return null
    },
    mountPart(el, part) {
      if (part.kind !== 'ribbon-group') return
      const slot = el.querySelector<HTMLElement>('[data-adapter-slot="after"]')
      if (!slot) return
      const s = demoState()
      s.mounts++
      slot.innerHTML =
        '<span data-demo-note>hi</span><button type="button" data-demo-btn>demo</button><button type="button" data-demo-optin data-rv="demo-optin">opt-in</button>'
      const onClick = () => {
        s.clicks++
      }
      slot.addEventListener('click', onClick)
      return () => {
        s.unmounts++
        slot.removeEventListener('click', onClick)
        slot.innerHTML = ''
      }
    },
  },
}

// window.__demoSet(false) removes the adapter from the viewer (init cleanup /
// dispose / part cleanups must run), __demoSet(true) puts it back;
// window.__demoGate(false) unmounts the whole viewer (real unmount).
const store = { on: true, shown: true, subs: new Set<() => void>() }
const notify = () => store.subs.forEach((f) => f())
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  w.__demoSet = (on: boolean) => { store.on = on; notify() }
  w.__demoGate = (shown: boolean) => { store.shown = shown; notify() }
}
const subscribe = (f: () => void) => { store.subs.add(f); return () => { store.subs.delete(f) } }

/** The adapter selected by ?adapter=demo (and not switched off), else undefined. */
export function useDemoAdapter(): DocumentAdapter | undefined {
  const on = useSyncExternalStore(subscribe, () => store.on)
  return on && new URLSearchParams(location.search).get('adapter') === 'demo' ? demoAdapter : undefined
}

/** Renders children unless window.__demoGate(false) unmounted them. */
export function DemoGate({ children }: { children: ReactNode }): ReactNode {
  const shown = useSyncExternalStore(subscribe, () => store.shown)
  return shown ? children : null
}
