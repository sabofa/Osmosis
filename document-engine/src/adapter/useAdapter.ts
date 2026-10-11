// Error-safe layer between the engine and a theme adapter (types.ts). Nothing an
// adapter does may blank or break a viewer: every hook call goes through
// safeCall (caught, logged once per hook, default used), every hook RESULT is
// sanitised before it reaches React, and a missing hook is a no-op.
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
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

/**
 * Run an adapter hook body. Any throw is caught, logged once per (adapter, hook)
 * and `fallback` is returned. `fn` is only run when `adapter` is set.
 */
export function safeCall<T>(adapter: DocumentAdapter | null | undefined, hookName: string, fn: () => T, fallback: T): T {
  if (!adapter) return fallback
  try {
    return fn()
  } catch (err) {
    reportAdapterError(adapter, hookName, err)
    return fallback
  }
}

// ---------------------------------------------------------------- sanitising

const ATTR_NAME = /^[A-Za-z_][-A-Za-z0-9_:.]*$/
// Attribute names an adapter may never set through `attrs` (handlers and
// React internals take their own, intentional routes: slots and mountPart).
const BLOCKED_ATTRS = new Set(['dangerouslysetinnerhtml', 'ref', 'key', 'children', 'style', 'class', 'classname', 'data-part', 'is'])

export function cleanAttrs(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lower = k.toLowerCase()
    if (!ATTR_NAME.test(k) || lower.startsWith('on') || BLOCKED_ATTRS.has(lower)) continue
    if (v === null || v === undefined || typeof v === 'function' || typeof v === 'object' || typeof v === 'symbol') continue
    out[k] = String(v)
  }
  return Object.keys(out).length ? out : undefined
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
    hasMount: typeof chrome?.mountPart === 'function',
    decorate(part) {
      if (typeof chrome?.decoratePart !== 'function') return null
      return safeCall(adapter, 'chrome.decoratePart', () => sanitizeDecoration(chrome.decoratePart!(part, ctx)), null)
    },
    render(part, node) {
      if (typeof chrome?.renderPart !== 'function') return node
      const r = safeCall<ReactNode | null | undefined>(adapter, 'chrome.renderPart', () => chrome.renderPart!(part, node, ctx), null)
      return r === null || r === undefined ? node : r
    },
    mount(el, part) {
      if (typeof chrome?.mountPart !== 'function') return NOOP
      const cleanup = safeCall<void | (() => void)>(adapter, 'chrome.mountPart', () => chrome.mountPart!(el, part, ctx), undefined)
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
