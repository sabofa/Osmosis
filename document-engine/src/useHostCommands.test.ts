import { describe, it, expect, vi, beforeEach } from 'vitest'

// No DOM/React renderer in this package: a tiny hook runner stands in for
// React's useRef/useEffect so the real hook body runs unchanged.
type Slot = { ref?: { current: unknown }; deps?: unknown[]; cleanup?: (() => void) | void }
let slots: Slot[] = []
let idx = 0
let pending: Array<() => void> = []
vi.mock('react', () => ({
  useRef: (init: unknown) => {
    const s = (slots[idx] ??= { ref: { current: init } })
    idx++
    return s.ref
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const s = (slots[idx] ??= {})
    const i = idx++
    const changed = !s.deps || deps.length !== s.deps.length || deps.some((d, k) => !Object.is(d, s.deps![k]))
    if (changed) {
      pending.push(() => {
        const sl = slots[i]
        if (typeof sl.cleanup === 'function') sl.cleanup()
        sl.cleanup = fn()
        sl.deps = deps
      })
    }
  },
}))

import { useHostCommands } from './useHostCommands'
import type { CommandState } from './commands'
import type { DocumentHost } from './types'
import type { ToolbarCommand } from 'engine-host'

function render(host: DocumentHost | undefined, state: CommandState) {
  idx = 0
  pending = []
  useHostCommands(host, state)
  pending.forEach((f) => f())
}
function unmount() {
  for (const s of slots) if (typeof s.cleanup === 'function') s.cleanup()
}

function makeHost() {
  const toolbar = { publishCommands: vi.fn(), clear: vi.fn() }
  return { host: { toolbar, layers: vi.fn(), icons: { kind: 'default' } } as unknown as DocumentHost, toolbar }
}
function state(over: Partial<CommandState> = {}): CommandState {
  return {
    interaction: 'annotate', chrome: 'full', zoom: 1, allowFit: false, atMin: false, atMax: false,
    showOverlays: true, canRemoveHighlight: false, canDownload: true,
    onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFit: vi.fn(), onToggleOverlays: vi.fn(),
    onRemoveHighlight: vi.fn(), onDownload: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  slots = []
  idx = 0
})

describe('useHostCommands', () => {
  it('publishes once when the same host re-renders', () => {
    const { host, toolbar } = makeHost()
    render(host, state())
    render(host, state())
    render(host, state())
    expect(toolbar.publishCommands).toHaveBeenCalledTimes(1)
  })
  it('does not republish when only the scale changes (no atMin/atMax flip), but does at the edge', () => {
    const { host, toolbar } = makeHost()
    render(host, state({ zoom: 1 }))
    render(host, state({ zoom: 1.5 }))
    expect(toolbar.publishCommands).toHaveBeenCalledTimes(1)
    render(host, state({ zoom: 4, atMax: true }))
    expect(toolbar.publishCommands).toHaveBeenCalledTimes(2)
  })
  it('clears on unmount', () => {
    const { host, toolbar } = makeHost()
    render(host, state())
    expect(toolbar.clear).not.toHaveBeenCalled()
    unmount()
    expect(toolbar.clear).toHaveBeenCalledTimes(1)
  })
  it('run() calls the latest callback after state change', () => {
    const { host, toolbar } = makeHost()
    const first = state()
    const second = state({ zoom: 1.5 })
    render(host, first)
    render(host, second)
    const cmds = toolbar.publishCommands.mock.calls[0][0] as ToolbarCommand[]
    cmds.find((c) => c.id === 'zoom-in')!.run()
    expect(first.onZoomIn).not.toHaveBeenCalled()
    expect(second.onZoomIn).toHaveBeenCalledTimes(1)
  })
  it('swapping the toolbar identity clears the old one, then publishes on the new one', () => {
    const a = makeHost()
    const b = makeHost()
    render(a.host, state())
    render(b.host, state())
    expect(a.toolbar.clear).toHaveBeenCalledTimes(1)
    expect(a.toolbar.publishCommands).toHaveBeenCalledTimes(1)
    expect(b.toolbar.publishCommands).toHaveBeenCalledTimes(1)
    expect(b.toolbar.clear).not.toHaveBeenCalled()
  })
  it('a command-shape change clears the published list before republishing (effect cleanup runs first)', () => {
    const { host, toolbar } = makeHost()
    const order: string[] = []
    toolbar.publishCommands.mockImplementation(() => order.push('publish'))
    toolbar.clear.mockImplementation(() => order.push('clear'))
    render(host, state())
    render(host, state({ atMax: true }))
    expect(order).toEqual(['publish', 'clear', 'publish'])
  })
  it('no host => no calls', () => {
    expect(() => {
      render(undefined, state())
      unmount()
    }).not.toThrow()
  })
})
