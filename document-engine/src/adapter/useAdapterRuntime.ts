// DocumentViewer's side of the adapter: builds the context, runs the
// token / css-var / css / highlight / init / event hooks through safeCall.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { DocumentTokens } from 'theme-core'
import { tokensToCssVars } from '../tokenVars'
import type { Chrome, Interaction } from '../types'
import type { AdapterContext, AdapterEvent, DocumentAdapter } from './types'
import { emitAdapterEvent, safeCall, sanitizeVars, type AdapterState } from './useAdapter'

export function validTokens(t: unknown): t is DocumentTokens {
  const o = t as DocumentTokens | null
  return !!o && typeof o === 'object' && !!o.colors && !!o.fonts && !!o.scale && Array.isArray(o.colors.highlight)
}

export function makeContext(
  rootRef: RefObject<HTMLElement | null>,
  tokens: DocumentTokens,
  p: { interaction: Interaction; chrome: Chrome; kind: AdapterContext['kind']; host: unknown },
): AdapterContext {
  const ctx = {
    mode: tokens.mode,
    interaction: p.interaction,
    chrome: p.chrome,
    kind: p.kind,
    tokens,
    alphas: tokens.alphas,
    host: p.host,
  } as AdapterContext
  // root is read lazily: child layout effects run before the viewer's own ref is attached.
  Object.defineProperty(ctx, 'root', { enumerable: true, get: () => rootRef.current as HTMLElement })
  return ctx
}

export interface AdapterRuntime {
  /** Tokens after the adapter's tokens() hook (the input when there is none). */
  tokens: DocumentTokens
  /** --de-* map after cssVars(). */
  vars: Record<string, string>
  /** css() + chrome.css(), or '' */
  cssText: string
  /** For AdapterProvider (null without an adapter). */
  state: AdapterState | null
  /** highlightCss hook for tokenVars.highlightCss, or undefined. */
  highlightHook: ((id: string, defaultCss: string) => string) | undefined
  emit(e: AdapterEvent): void
}

export function useAdapterRuntime(
  adapter: DocumentAdapter | null | undefined,
  rootRef: RefObject<HTMLElement | null>,
  input: DocumentTokens,
  p: { interaction: Interaction; chrome: Chrome; kind: AdapterContext['kind']; host: unknown },
): AdapterRuntime {
  const { interaction, chrome, kind, host } = p
  const derived = useMemo(() => {
    let tokens = input
    if (adapter && typeof adapter.tokens === 'function') {
      const ctxIn = makeContext(rootRef, input, { interaction, chrome, kind, host })
      const out = safeCall<unknown>(adapter, 'tokens', () => adapter.tokens!(input, ctxIn), input)
      if (validTokens(out)) tokens = out
    }
    const ctx = makeContext(rootRef, tokens, { interaction, chrome, kind, host })
    const base = tokensToCssVars(tokens)
    const vars =
      adapter && typeof adapter.cssVars === 'function'
        ? sanitizeVars(safeCall<unknown>(adapter, 'cssVars', () => adapter.cssVars!({ ...base }, ctx), base), base)
        : base
    let cssText = ''
    if (adapter) {
      const a = typeof adapter.css === 'function' ? safeCall<unknown>(adapter, 'css', () => adapter.css!(ctx), '') : ''
      const c = typeof adapter.chrome?.css === 'function' ? safeCall<unknown>(adapter, 'chrome.css', () => adapter.chrome!.css!(ctx), '') : ''
      cssText = [a, c].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('\n')
    }
    const state: AdapterState | null = adapter ? { adapter, ctx } : null
    const highlightHook =
      adapter && typeof adapter.highlightCss === 'function'
        ? (id: string, defaultCss: string): string => {
            const r = safeCall<unknown>(adapter, 'highlightCss', () => adapter.highlightCss!(id, defaultCss, ctx), defaultCss)
            return typeof r === 'string' ? r : defaultCss
          }
        : undefined
    return { tokens, vars, cssText, state, highlightHook }
  }, [adapter, input, rootRef, interaction, chrome, kind, host])

  // Latest adapter/context for handlers that must not resubscribe.
  const latest = useRef({ adapter, state: derived.state })
  latest.current = { adapter, state: derived.state }

  // init once per adapter identity; its cleanup, then dispose(), on unmount / swap.
  useEffect(() => {
    if (!adapter) return
    const ctx = latest.current.state?.ctx
    let cleanup: void | (() => void)
    if (ctx && typeof adapter.init === 'function') cleanup = safeCall<void | (() => void)>(adapter, 'init', () => adapter.init!(ctx), undefined)
    return () => {
      if (typeof cleanup === 'function') safeCall(adapter, 'init.cleanup', () => { (cleanup as () => void)() }, undefined)
      if (typeof adapter.dispose === 'function') safeCall(adapter, 'dispose', () => { adapter.dispose!() }, undefined)
    }
  }, [adapter])

  const emit = useCallback((e: AdapterEvent) => {
    const { adapter: a, state } = latest.current
    emitAdapterEvent(a, state?.ctx, e)
  }, [])

  return { ...derived, emit }
}

/** Emit an event when `value` changes (never for the initial value, also not on a StrictMode effect replay). */
export function useEmitOnChange<T>(value: T, emit: (e: AdapterEvent) => void, make: (v: T) => AdapterEvent): void {
  const prev = useRef(value)
  const makeRef = useRef(make)
  makeRef.current = make
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    emit(makeRef.current(value))
  }, [value, emit])
}
