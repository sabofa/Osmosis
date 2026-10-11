// Error-safe layer between the engine and a theme adapter (types.ts). Nothing an
// adapter does may blank or break a viewer: every hook call goes through
// safeCall (caught, logged once per hook, default used), every hook RESULT is
// sanitised before it reaches React, and a missing hook is a no-op.
import { Component, createContext, createElement, isValidElement, useContext, useMemo, type ReactNode } from 'react'
import type {
  AdapterContext, AdapterEvent, ChromePart, ChromePartKind, DocumentAdapter, PartDecoration,
} from './types'

// ---------------------------------------------------------------- safeCall

const logged = new Set<string>()

/** Test hook: forget which hooks were already logged. */
export function resetAdapterLog(): void {
  logged.clear()
}

export function reportAdapterError(adapter: Pick<DocumentAdapter, 'id'>, hookName: string, err: unknown): void {
  const key = `${adapter.id}:${hookName}`
  if (logged.has(key)) return
  logged.add(key)
  console.error(`[document-engine adapter "${adapter.id}"] hook "${hookName}" threw; using the default.`, err)
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function'

/**
 * Run an adapter hook body. Any throw is caught, logged once per (adapter, hook)
 * and `fallback` is returned. `fn` is only run when `adapter` is set.
 *
 * A hook that returns a thenable (an async hook) has its rejection reported the
 * same way, so it can never surface as an unhandled rejection. The engine does
 * not await it: its resolved value is ignored, which means cleanup functions
 * (init / mountPart) MUST be returned synchronously to be called.
 */
export function safeCall<T>(adapter: DocumentAdapter | null | undefined, hookName: string, fn: () => T, fallback: T): T {
  if (!adapter) return fallback
  try {
    const r = fn()
    if (isThenable(r)) r.then(undefined, (err: unknown) => reportAdapterError(adapter, hookName, err))
    return r
  } catch (err) {
    reportAdapterError(adapter, hookName, err)
    return fallback
  }
}

/**
 * What to render for a renderPart result: the result when React can render it,
 * else the engine's own node. (Errors thrown while React renders an accepted
 * result are caught by AdapterBoundary.)
 */
export function safeRenderResult(result: unknown, fallback: ReactNode): ReactNode {
  if (result === null || result === undefined) return fallback
  const t = typeof result
  if (t === 'string' || t === 'number' || t === 'boolean') return result as ReactNode
  if (isValidElement(result)) return result
  if (Array.isArray(result)) return result.every((x) => x === null || x === undefined || ['string', 'number', 'boolean'].includes(typeof x) || isValidElement(x)) ? (result as ReactNode) : fallback
  return fallback
}

interface BoundaryProps { adapter?: Pick<DocumentAdapter, 'id'> | null; hook: string; fallback: ReactNode; children?: ReactNode }

/**
 * Isolates an adapter-provided React subtree: if rendering it throws, the error is
 * logged once (per adapter + hook) and `fallback` (the default node, or nothing) is rendered instead.
 */
export class AdapterBoundary extends Component<BoundaryProps, { failed: unknown }> {
  state: { failed: unknown } = { failed: null }
  static getDerivedStateFromError(err: unknown) {
    return { failed: err ?? true }
  }
  componentDidCatch(err: unknown) {
    reportAdapterError(this.props.adapter ?? { id: 'unknown' }, this.props.hook, err)
  }
  componentDidUpdate(prev: BoundaryProps) {
    // A new child (a later render, another adapter) gets another try.
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: null })
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// ---------------------------------------------------------------- sanitising

const ATTR_NAME = /^[A-Za-z_][-A-Za-z0-9_:.]*$/
// Attribute names an adapter may never set through `attrs`. Handlers (`on*`) are
// refused by prefix. URL-bearing and script-bearing attributes are refused: an
// adapter that needs a link or an image uses `before` / `after` nodes, or
// mountPart (the explicit route for raw DOM). Values starting with javascript:
// or data: are refused for every attribute.
// `id` and `disabled` are blocked: ids collide with the host page and `disabled`
// would silently switch off engine controls. `tabindex` may only be -1 or 0.
const BLOCKED_ATTRS = new Set([
  'dangerouslysetinnerhtml', 'ref', 'key', 'children', 'style', 'class', 'classname', 'data-part', 'is',
  'href', 'src', 'srcdoc', 'action', 'formaction', 'xlink:href', 'contenteditable', 'id', 'disabled',
])
const SCRIPT_URL = /^(?:javascript|data):/i

export function cleanAttrs(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lower = k.toLowerCase()
    if (!ATTR_NAME.test(k) || lower.startsWith('on') || BLOCKED_ATTRS.has(lower)) continue
    if (v === null || v === undefined || typeof v === 'function' || typeof v === 'object' || typeof v === 'symbol') continue
    const value = String(v)
    if (SCRIPT_URL.test(normalizeAttrValue(value))) continue
    if (lower === 'tabindex' && value.trim() !== '-1' && value.trim() !== '0') continue
    out[k] = value
  }
  return Object.keys(out).length ? out : undefined
}

/** Trim and drop control / whitespace characters (a browser ignores them inside a scheme). */
function normalizeAttrValue(v: string): string {
  let out = ''
  for (const ch of v) {
    const c = ch.charCodeAt(0)
    if (c > 0x20 && (c < 0x7f || c > 0xa0)) out += ch
  }
  return out
}

/** kebab-case -> camelCase for React style keys; custom properties stay as they are. */
function styleKey(k: string): string {
  return k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function cleanStyle(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[styleKey(k)] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[styleKey(k)] = String(v)
  }
  return Object.keys(out).length ? out : undefined
}

/** A decoration reduced to what React may safely receive; garbage -> null. */
export function sanitizeDecoration(raw: unknown): PartDecoration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: PartDecoration = {}
  if (typeof r.className === 'string' && r.className.trim()) out.className = r.className.trim()
  const style = cleanStyle(r.style)
  if (style) out.style = style
  const attrs = cleanAttrs(r.attrs)
  if (attrs) out.attrs = attrs
  if (r.before !== undefined && r.before !== null && typeof r.before !== 'boolean') out.before = r.before as ReactNode
  if (r.after !== undefined && r.after !== null && typeof r.after !== 'boolean') out.after = r.after as ReactNode
  return Object.keys(out).length ? out : null
}

/** A cssVars() result: string values only (numbers coerced); anything else falls back to `base`. */
export function sanitizeVars(raw: unknown, base: Record<string, string>): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.startsWith('--')) continue
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v)
  }
  return out
}

// ---------------------------------------------------------------- parts

/** Every kind of chrome part, in document order of the UI. */
export const PART_KINDS: readonly ChromePartKind[] = [
  'ribbon', 'ribbon-tab', 'ribbon-panel', 'ribbon-group', 'ribbon-item', 'ribbon-gallery', 'popover', 'notice',
  'viewer-controls', 'zoom', 'zoom-menu', 'settings', 'settings-menu',
]

/** The stable `data-part` value: "<kind>:<id>". */
export function partAttr(part: Pick<ChromePart, 'kind' | 'id'>): string {
  return `${part.kind}:${part.id}`
}

/** Parts whose root carries empty adapter slot containers (only when mountPart exists). */
export const SLOT_PART_KINDS: readonly ChromePartKind[] = ['ribbon', 'ribbon-group', 'ribbon-item']

// ---------------------------------------------------------------- hook layer

export interface AdapterHooks {
  /** An adapter is present. */
  readonly has: boolean
  /** The adapter (for error reporting), or null. */
  readonly adapter: DocumentAdapter | null
  /** The adapter defines mountPart: slot containers are rendered. */
  readonly hasMount: boolean
  decorate(part: ChromePart): PartDecoration | null
  render(part: ChromePart, node: ReactNode): ReactNode
  /** Returns a cleanup that never throws. */
  mount(el: HTMLElement, part: ChromePart): () => void
}

const NOOP = () => {}

export const NO_HOOKS: AdapterHooks = {
  has: false,
  adapter: null,
  hasMount: false,
  decorate: () => null,
  render: (_p, node) => node,
  mount: () => NOOP,
}

/** Wrap an adapter's chrome hooks. Pure: used by the React hook and by tests. */
export function makeAdapterHooks(adapter: DocumentAdapter | null | undefined, ctx: AdapterContext | null | undefined): AdapterHooks {
  if (!adapter || !ctx) return NO_HOOKS
  const chrome = adapter.chrome
  return {
    has: true,
    adapter,
    hasMount: typeof chrome?.mountPart === 'function',
    decorate(part) {
      if (typeof chrome?.decoratePart !== 'function') return null
      return safeCall(adapter, 'chrome.decoratePart', () => sanitizeDecoration(chrome.decoratePart!(part, ctx)), null)
    },
    render(part, node) {
      if (typeof chrome?.renderPart !== 'function') return node
      const r = safeCall<ReactNode | null | undefined>(adapter, 'chrome.renderPart', () => chrome.renderPart!(part, node, ctx), null)
      return safeRenderResult(r, node)
    },
    mount(el, part) {
      if (typeof chrome?.mountPart !== 'function') return NOOP
      const cleanup = safeCall<void | Promise<unknown> | (() => void)>(adapter, 'chrome.mountPart', () => chrome.mountPart!(el, part, ctx), undefined)
      if (typeof cleanup !== 'function') return NOOP
      return () => safeCall(adapter, 'chrome.mountPart.cleanup', () => { cleanup() }, undefined)
    },
  }
}

/** The adapter and its context, as the viewer hands them to the chrome. */
export interface AdapterState {
  adapter: DocumentAdapter
  ctx: AdapterContext
}

const AdapterReactContext = createContext<AdapterState | null>(null)

export function AdapterProvider({ state, children }: { state: AdapterState | null | undefined; children?: ReactNode }) {
  if (!state) return createElement(AdapterReactContext.Provider, { value: null }, children)
  return createElement(AdapterReactContext.Provider, { value: state }, children)
}

/** The wrapped hooks of the nearest adapter (a shared no-op set when there is none). Memoised by adapter + context identity. */
export function useAdapterHooks(): AdapterHooks {
  const state = useContext(AdapterReactContext)
  return useMemo(() => (state ? makeAdapterHooks(state.adapter, state.ctx) : NO_HOOKS), [state])
}

// ---------------------------------------------------------------- events

/** Deliver an event to the adapter (never throws, never awaited). */
export function emitAdapterEvent(adapter: DocumentAdapter | null | undefined, ctx: AdapterContext | null | undefined, e: AdapterEvent): void {
  if (!adapter || !ctx || typeof adapter.onEvent !== 'function') return
  safeCall(adapter, 'onEvent', () => { adapter.onEvent!(e, ctx) }, undefined)
}
