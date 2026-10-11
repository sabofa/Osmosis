import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PART_KINDS, SLOT_PART_KINDS, cleanAttrs, cleanStyle, emitAdapterEvent, makeAdapterHooks, partAttr, resetAdapterLog,
  safeCall, sanitizeDecoration, sanitizeVars,
} from './useAdapter'
import { rovingOwner, type RovingNode } from '../ribbon/ribbonNav'
import { DEFAULT_TOKENS, highlightCss } from '../tokenVars'
import type { AdapterContext, ChromePart, DocumentAdapter } from './types'

const ctx = { root: null, mode: 'light' } as unknown as AdapterContext
const part: ChromePart = { id: 'bold', kind: 'ribbon-item', label: 'Bold' }

beforeEach(() => {
  resetAdapterLog()
  vi.restoreAllMocks()
})

describe('safeCall', () => {
  it('returns the fallback and logs once per hook when the hook throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a: DocumentAdapter = { id: 'bad' }
    const boom = () => { throw new Error('x') }
    expect(safeCall(a, 'css', boom, 'fallback')).toBe('fallback')
    expect(safeCall(a, 'css', boom, 'fallback')).toBe('fallback')
    expect(safeCall(a, 'init', boom, 1)).toBe(1)
    expect(err).toHaveBeenCalledTimes(2)
    expect(String(err.mock.calls[0][0])).toContain('"bad"')
  })
  it('does not run fn without an adapter', () => {
    const fn = vi.fn(() => 5)
    expect(safeCall(null, 'css', fn, 0)).toBe(0)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('hook wrappers', () => {
  it('missing hooks are no-ops', () => {
    const h = makeAdapterHooks({ id: 'empty' }, ctx)
    expect(h.has).toBe(true)
    expect(h.hasMount).toBe(false)
    expect(h.decorate(part)).toBeNull()
    expect(h.render(part, 'node')).toBe('node')
    expect(() => h.mount({} as HTMLElement, part)()).not.toThrow()
  })
  it('no adapter: shared inert hooks', () => {
    expect(makeAdapterHooks(null, ctx).has).toBe(false)
  })
  it('throwing hooks fall back and log once', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = makeAdapterHooks(
      { id: 't', chrome: { decoratePart: () => { throw new Error('d') }, renderPart: () => { throw new Error('r') }, mountPart: () => { throw new Error('m') } } },
      ctx,
    )
    for (let i = 0; i < 3; i++) {
      expect(h.decorate(part)).toBeNull()
      expect(h.render(part, 'def')).toBe('def')
      expect(() => h.mount({} as HTMLElement, part)()).not.toThrow()
    }
    expect(err).toHaveBeenCalledTimes(3)
  })
  it('renderPart null/undefined keeps the default node; a value replaces it', () => {
    expect(makeAdapterHooks({ id: 'a', chrome: { renderPart: () => null } }, ctx).render(part, 'def')).toBe('def')
    expect(makeAdapterHooks({ id: 'a', chrome: { renderPart: (_p, d) => ['w', d] } }, ctx).render(part, 'def')).toEqual(['w', 'def'])
  })
  it('mountPart cleanup runs and a throwing cleanup is contained', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cleanup = vi.fn(() => { throw new Error('c') })
    const h = makeAdapterHooks({ id: 'a', chrome: { mountPart: () => cleanup } }, ctx)
    expect(h.hasMount).toBe(true)
    const off = h.mount({} as HTMLElement, part)
    expect(() => off()).not.toThrow()
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('onEvent throwing does not escape', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a: DocumentAdapter = { id: 'e', onEvent: () => { throw new Error('e') } }
    expect(() => emitAdapterEvent(a, ctx, { type: 'zoom', scale: 1 })).not.toThrow()
  })
})

describe('sanitising', () => {
  it('className must be a string', () => {
    expect(sanitizeDecoration({ className: 5 })).toBeNull()
    expect(sanitizeDecoration({ className: ' x y ' })).toEqual({ className: 'x y' })
  })
  it('attrs: values coerced, objects/functions dropped, on* and React internals dropped', () => {
    expect(
      cleanAttrs({
        'data-a': 3, title: 'ok', onClick: () => {}, onclick: 'alert(1)', dangerouslySetInnerHTML: { __html: 'x' }, ref: 1, key: 'k',
        style: 'color:red', 'data-part': 'evil', 'bad name': 'x', obj: { a: 1 }, fn: () => {}, flag: true,
      }),
    ).toEqual({ 'data-a': '3', title: 'ok', flag: 'true' })
    expect(cleanAttrs('nope')).toBeUndefined()
    expect(cleanAttrs([1, 2])).toBeUndefined()
  })
  it('style: strings kept, numbers coerced, kebab to camel, custom props untouched, junk dropped', () => {
    expect(cleanStyle({ 'background-color': 'red', '--x': '1', width: 4, bad: { a: 1 }, n: null })).toEqual({ backgroundColor: 'red', '--x': '1', width: '4' })
  })
  it('decoration garbage is null; before/after pass through', () => {
    expect(sanitizeDecoration(7)).toBeNull()
    expect(sanitizeDecoration({ before: 'b', after: null })).toEqual({ before: 'b' })
  })
  it('sanitizeVars keeps only string --vars, falls back on non-objects', () => {
    const base = { '--a': '1' }
    expect(sanitizeVars(null, base)).toBe(base)
    expect(sanitizeVars({ '--b': '2', '--c': 3, d: 'x', '--e': {} }, base)).toEqual({ '--b': '2', '--c': '3' })
  })
})

describe('data-part', () => {
  it('format is kind:id', () => {
    expect(partAttr({ kind: 'zoom', id: 'zoom' })).toBe('zoom:zoom')
    expect(partAttr({ kind: 'ribbon-item', id: 'font-family' })).toBe('ribbon-item:font-family')
  })
  it('PART_KINDS has every kind exactly once, and slot kinds are a subset', () => {
    expect(new Set(PART_KINDS).size).toBe(PART_KINDS.length)
    expect([...PART_KINDS].sort()).toEqual(
      ['popover', 'notice', 'ribbon', 'ribbon-gallery', 'ribbon-group', 'ribbon-item', 'ribbon-panel', 'ribbon-tab', 'settings', 'settings-menu', 'viewer-controls', 'zoom', 'zoom-menu'].sort(),
    )
    for (const k of SLOT_PART_KINDS) expect(PART_KINDS).toContain(k)
  })
  it('every kind the chrome uses is listed, and every listed kind is used', () => {
    const src = ['ribbon/Ribbon.tsx', 'Toolbar.tsx'].map((f) => readFileSync(join(__dirname, '..', f), 'utf8')).join('\n')
    const used = new Set([...src.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]))
    for (const k of PART_KINDS) expect(used.has(k), `kind ${k} is never used`).toBe(true)
    for (const k of used) if (/^(ribbon|popover|notice|viewer|zoom|settings)/.test(k)) expect(PART_KINDS as readonly string[], `kind ${k} not in PART_KINDS`).toContain(k)
  })
})

function node(attrs: string[], parent: RovingNode | null = null): RovingNode {
  return { hasAttribute: (n) => attrs.includes(n), parentElement: parent }
}

describe('rovingOwner', () => {
  it('finds the nearest data-rv', () => {
    const rv = node(['data-rv'])
    expect(rovingOwner(node([], rv))).toBe(rv)
  })
  it('stops at adapter slots and adapter nodes that did not opt in', () => {
    const rv = node(['data-rv'])
    const slot = node(['data-adapter-slot', 'data-adapter'], rv)
    expect(rovingOwner(node([], slot))).toBeNull()
    expect(rovingOwner(node(['data-adapter'], rv))).toBeNull()
  })
  it('adapter-injected buttons opt in with data-rv', () => {
    const slot = node(['data-adapter-slot'], node(['data-rv']))
    const btn = node(['data-rv'], slot)
    expect(rovingOwner(btn)).toBe(btn)
  })
  it('data-pop works the same way', () => {
    const pop = node(['data-pop'])
    expect(rovingOwner(node([], pop), ['data-pop', 'data-rv'])).toBe(pop)
    expect(rovingOwner(node([], pop))).toBeNull()
  })
})

describe('highlightCss hook', () => {
  it('default output is unchanged without a hook', () => {
    const a = highlightCss('de1', DEFAULT_TOKENS)
    expect(highlightCss('de1', DEFAULT_TOKENS, undefined)).toBe(a)
    expect(a).toContain('::highlight(de1-anchor)')
  })
  it('hook can replace each rule by palette id', () => {
    const seen: string[] = []
    const out = highlightCss('de1', DEFAULT_TOKENS, (id, css) => {
      seen.push(id)
      return id === 'yellow' ? '/* y */' : css
    })
    expect(out).toContain('/* y */')
    expect(seen).toContain('anchor')
  })
})
