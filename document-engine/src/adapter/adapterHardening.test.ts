import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanAttrs, makeAdapterHooks, resetAdapterLog, safeCall, safeRenderResult } from './useAdapter'
import { deriveAdapterRuntime, runtimeDeps } from './useAdapterRuntime'
import { DEFAULT_TOKENS } from '../tokenVars'
import type { AdapterContext, ChromePart, DocumentAdapter } from './types'

beforeEach(() => {
  resetAdapterLog()
  vi.restoreAllMocks()
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('safeCall with async hooks', () => {
  it('reports a rejected promise once and never leaves it unhandled', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const a: DocumentAdapter = { id: 'async' }
    const r1 = safeCall(a, 'init', () => Promise.reject(new Error('late')), undefined)
    const r2 = safeCall(a, 'init', () => Promise.reject(new Error('late 2')), undefined)
    expect(r1).toBeInstanceOf(Promise)
    expect(r2).toBeInstanceOf(Promise)
    await flush()
    await flush()
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledTimes(1)
  })
  it('a resolving promise is left alone and a plain thenable is supported', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a: DocumentAdapter = { id: 'async' }
    safeCall(a, 'mount', () => Promise.resolve(() => {}), undefined)
    let rejected: (e: unknown) => void = () => {}
    const thenable = { then: (_ok: unknown, bad: (e: unknown) => void) => { rejected = bad } }
    safeCall(a, 'mount2', () => thenable, undefined)
    rejected(new Error('x'))
    await flush()
    expect(err).toHaveBeenCalledTimes(1)
  })
  it('async mountPart: no cleanup is taken from the promise, rejection reported', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a: DocumentAdapter = { id: 'a', chrome: { mountPart: async () => { throw new Error('nope') } } }
    const hooks = makeAdapterHooks(a, {} as AdapterContext)
    const cleanup = hooks.mount({} as HTMLElement, { id: 'x', kind: 'ribbon' })
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
    await flush()
    expect(err).toHaveBeenCalledTimes(1)
  })
})

describe('safeRenderResult (the fallback decision)', () => {
  const dflt = createElement('i', null, 'default')
  it('keeps renderable results', () => {
    const el = createElement('b')
    expect(safeRenderResult(el, dflt)).toBe(el)
    expect(safeRenderResult('text', dflt)).toBe('text')
    expect(safeRenderResult(0, dflt)).toBe(0)
    const list = [el, 'x', null]
    expect(safeRenderResult(list, dflt)).toBe(list)
  })
  it('falls back for null, undefined, plain objects, functions and bad arrays', () => {
    expect(safeRenderResult(null, dflt)).toBe(dflt)
    expect(safeRenderResult(undefined, dflt)).toBe(dflt)
    expect(safeRenderResult({}, dflt)).toBe(dflt)
    expect(safeRenderResult({ type: 'div' }, dflt)).toBe(dflt)
    expect(safeRenderResult(() => 1, dflt)).toBe(dflt)
    expect(safeRenderResult([{}], dflt)).toBe(dflt)
  })
  it('the wrapped renderPart hook returns the default node for an invalid result', () => {
    const bad = { id: 'bad', chrome: { renderPart: () => ({}) as never } }
    const part: ChromePart = { id: 'zoom', kind: 'zoom' }
    expect(makeAdapterHooks(bad, {} as AdapterContext).render(part, dflt)).toBe(dflt)
  })
})

describe('cleanAttrs hardening', () => {
  it('blocks url-bearing, script-bearing and identity attributes', () => {
    const out = cleanAttrs({
      href: 'https://x', src: 'x.png', srcdoc: '<b>', action: '/a', formaction: '/a', 'xlink:href': '#a', contenteditable: 'true',
      id: 'x', disabled: 'true', onclick: 'x()', 'data-ok': '1', role: 'button', title: 'T', 'aria-label': 'L',
    })
    expect(out).toEqual({ 'data-ok': '1', role: 'button', title: 'T', 'aria-label': 'L' })
  })
  it('blocks javascript: and data: values (spaces, tabs, case) on any attribute', () => {
    const tab = String.fromCharCode(9)
    const out = cleanAttrs({
      title: 'javascript:alert(1)', 'data-a': `  JaVa${tab}Script:x`, 'data-b': 'data:text/html,hi', 'data-c': 'safe javascript: inside', 'data-d': 'DATA:x',
    })
    expect(out).toEqual({ 'data-c': 'safe javascript: inside' })
  })
  it('allows tabindex only as -1 or 0', () => {
    expect(cleanAttrs({ tabindex: '-1' })).toEqual({ tabindex: '-1' })
    expect(cleanAttrs({ tabIndex: 0 })).toEqual({ tabIndex: '0' })
    expect(cleanAttrs({ tabindex: '5' })).toBeUndefined()
    expect(cleanAttrs({ tabindex: 'abc' })).toBeUndefined()
  })
})

describe('runtime does not re-derive for a changing host identity', () => {
  const rootRef = { current: null }
  const adapter = (spy: ReturnType<typeof vi.fn>): DocumentAdapter => ({
    id: 'r',
    css: () => { spy(); return 'a{}' },
    cssVars: (v) => v,
    tokens: (t) => t,
  })
  it('deps are equal for different host objects (host is not a dep)', () => {
    const p = { interaction: 'view', chrome: 'full', kind: 'prose' } as const
    const d1 = runtimeDeps(adapter(vi.fn()), rootRef, DEFAULT_TOKENS, p)
    const same = adapter(vi.fn())
    const e1 = runtimeDeps(same, rootRef, DEFAULT_TOKENS, p)
    const e2 = runtimeDeps(same, rootRef, DEFAULT_TOKENS, { ...p })
    expect(e1.every((x, i) => Object.is(x, e2[i]))).toBe(true)
    expect(d1.length).toBe(e1.length)
    expect(e1.some((x) => typeof x === 'object' && x !== null && 'layers' in (x as object))).toBe(false)
  })
  it('ctx.host reads the latest host lazily; derive is not repeated by that', () => {
    const spy = vi.fn()
    let host: unknown = { n: 1 }
    const rt = deriveAdapterRuntime(adapter(spy), rootRef, DEFAULT_TOKENS, { interaction: 'view', chrome: 'full', kind: 'prose', getHost: () => host })
    expect(spy).toHaveBeenCalledTimes(1)
    expect((rt.state!.ctx.host as { n: number }).n).toBe(1)
    host = { n: 2 }
    expect((rt.state!.ctx.host as { n: number }).n).toBe(2)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
