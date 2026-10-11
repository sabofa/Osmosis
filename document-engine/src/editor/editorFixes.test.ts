// Review fixes for the editor: read-only widgets, grapheme / CJK double-click,
// multi-line links, AltGr chords, composition grace, lazy block rescans.
import { describe, it, expect, vi } from 'vitest'
import { EditorState, EditorSelection, ChangeSet, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { wordWithTrailingSpace } from './selectionFeel'
import { toggleTaskAt, buildLiveDecos, type DecoSpec } from './livePreview'
import { rewriteGraphInfo, editLocked, liveOptions, blocksAfterChange } from './liveWidgets'
import { scanLiveBlocks } from './liveScan'
import { editorKeymap, noteAltGraph } from './editorCommands'
import { composingNow, markCompositionEnd, COMPOSITION_GRACE_MS } from './compositionGuard'
import { comfortPadPx } from './extensions'
import { indentColumns } from './structureKeys'

const md = markdown({ base: markdownLanguage })
function stateOf(doc: string, ...extra: import('@codemirror/state').Extension[]): EditorState {
  const s = EditorState.create({ doc, extensions: [md, ...extra] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
function fakeView(state: EditorState) {
  const dispatch = vi.fn()
  return { view: { state, dispatch } as unknown as EditorView, dispatch }
}

describe('read-only documents', () => {
  const ro = [EditorState.readOnly.of(true)]
  const noEdit = [EditorView.editable.of(false)]
  it('toggleTaskAt refuses when read-only or not editable, and works otherwise', () => {
    for (const ext of [ro, noEdit]) {
      const { view, dispatch } = fakeView(stateOf('- [ ] a', ...ext))
      expect(editLocked(view)).toBe(true)
      expect(toggleTaskAt(view, 2)).toBe(false)
      expect(dispatch).not.toHaveBeenCalled()
    }
    const open = fakeView(stateOf('- [ ] a'))
    expect(toggleTaskAt(open.view, 2)).toBe(true)
    expect(open.dispatch).toHaveBeenCalledOnce()
  })
  it('rewriteGraphInfo (S/M/L/Full buttons, resize grip) refuses when locked', () => {
    const doc = '```graph size=m\ny = x\n```'
    for (const ext of [ro, noEdit]) {
      const { view, dispatch } = fakeView(stateOf(doc, ...ext))
      expect(rewriteGraphInfo(view, 0, { size: 'l' })).toBe(false)
      expect(rewriteGraphInfo(view, 0, { height: 200 })).toBe(false)
      expect(dispatch).not.toHaveBeenCalled()
    }
    const open = fakeView(stateOf(doc))
    expect(rewriteGraphInfo(open.view, 0, { size: 'l' })).toBe(true)
    expect(open.dispatch).toHaveBeenCalledOnce()
  })
})

describe('double-click units', () => {
  const sel = (doc: string, pos: number) => {
    const r = wordWithTrailingSpace(stateOf(doc), pos)
    return doc.slice(r.from, r.to)
  }
  it('an astral emoji is selected whole from either side of the pair', () => {
    const doc = 'a 😀 b'
    expect(sel(doc, 2)).toBe('😀')
    expect(sel(doc, 3)).toBe('😀') // between the surrogates
  })
  it('ZWJ sequences, flags and skin tones are one cluster', () => {
    const family = '👨‍👩‍👧'
    const flag = '🇯🇵'
    const wave = '👋🏽'
    for (const g of [family, flag, wave]) {
      const doc = `x ${g} y`
      for (let pos = 2; pos < 2 + g.length; pos++) expect(sel(doc, pos), `${g}@${pos}`).toBe(g)
    }
  })
  it('plain punctuation still selects one character, a word keeps its space', () => {
    expect(sel('a ,b', 2)).toBe(',')
    expect(sel('a  b', 2)).toBe('  ')
    expect(sel('hello world', 2)).toBe('hello ')
  })
  it('Japanese: the dictionary word around the click, not the whole run', () => {
    if (typeof Intl.Segmenter !== 'function') return
    expect(sel('今日は天気です', 0)).toBe('今日')
    expect(sel('今日は天気です', 4)).toBe('天気')
    expect(sel('私はテキストを選択する', 3)).toBe('テキスト')
  })
  it('without Intl.Segmenter the whole run is kept', () => {
    const real = Intl.Segmenter
    ;(Intl as { Segmenter?: unknown }).Segmenter = undefined
    try {
      expect(sel('今日は天気です', 1)).toBe('今日は天気です')
    } finally {
      ;(Intl as { Segmenter?: unknown }).Segmenter = real
    }
  })
  it('Latin words are untouched by the CJK path', () => {
    expect(sel('foo-bar baz', 1)).toBe('foo')
  })
})

describe('links that wrap lines', () => {
  const build = (s: EditorState): DecoSpec[] =>
    buildLiveDecos(s, { selection: [], composing: false, viewport: [{ from: 0, to: s.doc.length }] })
  const crossesLine = (s: EditorState, specs: DecoSpec[]) =>
    specs.some((d) => d.hidden && s.doc.lineAt(d.from).to < d.to)
  it('never emits a hidden range across a line break', () => {
    for (const doc of ['[a](\nurl) tail', '[a](url "ti\ntle") tail', 'x [a](\nhttps://x.example/p) y **b**']) {
      const s = stateOf(doc)
      expect(crossesLine(s, build(s)), doc).toBe(false)
    }
  })
  it('a plain link still hides its marks', () => {
    const s = stateOf('[a](url) and **b**')
    const hidden = build(s).filter((d) => d.hidden).map((d) => s.sliceDoc(d.from, d.to))
    expect(hidden).toEqual(['[', '](url)', '**', '**'])
  })
  it('a wrapped link shows as source styling instead', () => {
    const s = stateOf('[a](\nurl) tail')
    const classes = build(s).map((d) => String(d.deco.spec.class ?? ''))
    expect(classes.some((c) => c.includes('cm-lp-link-src'))).toBe(true)
  })
})

describe('graph widgets swallow code chrome', () => {
  const doc = 'intro\n\n```graph size=m\ny = x^2\n```\n\n```js\nlet a\n```\n'
  const lines = (s: EditorState, sel: { from: number; to: number }[]) =>
    buildLiveDecos(s, { selection: sel, composing: false, viewport: [{ from: 0, to: s.doc.length }] })
      .filter((d) => d.from === d.to).map((d) => `${s.doc.lineAt(d.from).number}:${d.deco.spec.attributes?.class}`)
  const renderer = liveOptions.of({ renderGraph: () => (() => null) as never })
  it('no cm-lp-code lines inside a graph replaced by a widget; ordinary fences keep theirs', () => {
    const l = lines(stateOf(doc, renderer), [{ from: 0, to: 0 }])
    expect(l.filter((x) => /^[345]:/.test(x))).toEqual([])
    expect(l.some((x) => x.startsWith('7:') && x.includes('cm-lp-code'))).toBe(true)
  })
  it('a revealed graph (caret inside) or a host without a renderer keeps the chrome', () => {
    expect(lines(stateOf(doc, renderer), [{ from: 20, to: 20 }]).some((x) => x.startsWith('4:') && x.includes('cm-lp-code'))).toBe(true)
    expect(lines(stateOf(doc), [{ from: 0, to: 0 }]).some((x) => x.startsWith('4:') && x.includes('cm-lp-code'))).toBe(true)
  })
})

describe('AltGr', () => {
  const keymap = editorKeymap()
  const bind = (k: string) => keymap.find((b) => b.key === k)!
  const view = (doc: string) => {
    const v = {
      state: stateOf(doc),
      focus() {},
      dispatch(spec: object) { v.state = v.state.update(spec as never).state },
    }
    return v as unknown as EditorView
  }
  it('the heading chords step aside while AltGraph is held and never preventDefault', () => {
    for (const k of ['Mod-Alt-0', 'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4']) {
      expect(bind(k).preventDefault, k).toBeFalsy()
      const v = view('word')
      noteAltGraph({ getModifierState: (m) => m === 'AltGraph' })
      expect(bind(k).run!(v), k).toBe(false)
      expect(v.state.doc.toString()).toBe('word')
    }
    noteAltGraph({ getModifierState: () => false })
    const v = view('word')
    expect(bind('Mod-Alt-1').run!(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('# word')
  })
  it('a key event without getModifierState counts as plain Ctrl+Alt', () => {
    noteAltGraph({})
    const v = view('word')
    expect(bind('Mod-Alt-2').run!(v)).toBe(true)
  })
})

describe('composition grace', () => {
  it('composing, compositionStarted and the 50 ms after compositionend all block', () => {
    const v = {}
    expect(composingNow(v)).toBe(false)
    expect(composingNow({ composing: true })).toBe(true)
    expect(composingNow({ compositionStarted: true })).toBe(true)
    markCompositionEnd(v, Date.now() - 10)
    expect(composingNow(v)).toBe(true)
    markCompositionEnd(v, Date.now() - COMPOSITION_GRACE_MS - 5)
    expect(composingNow(v)).toBe(false)
  })
})

describe('block rescans are gated', () => {
  const rescan = (before: string, edit: { from: number; to?: number; insert?: string }) => {
    const prev = scanLiveBlocks(before)
    const changes = ChangeSet.of(edit, before.length)
    const oldDoc = Text.of(before.split('\n'))
    const newDoc = changes.apply(oldDoc)
    const spy = vi.spyOn(newDoc, 'toString')
    const out = blocksAfterChange(prev, oldDoc, newDoc, changes)
    const scanned = spy.mock.calls.length > 0
    expect(out).toEqual(scanLiveBlocks(newDoc.toString()))
    return scanned
  }
  const doc = 'para one\n\n$$\nx^2\n$$\n\nmiddle text\n\n```graph\ny=x\n```\n\ntail'
  it('typing in plain prose does not stringify the document and shifts the blocks', () => {
    expect(rescan(doc, { from: 4, insert: 'zz' })).toBe(false)
    expect(rescan(doc, { from: doc.length, insert: ' more' })).toBe(false)
    expect(rescan(doc, { from: 0, to: 4, insert: '' })).toBe(false)
  })
  it('an edit inside, against, or creating a block rescans', () => {
    expect(rescan(doc, { from: doc.indexOf('x^2') + 1, insert: '3' })).toBe(true)
    expect(rescan(doc, { from: doc.indexOf('```graph') + 3, insert: '`' })).toBe(true)
    expect(rescan(doc, { from: doc.indexOf('middle'), insert: '$$\nq\n$$\n' })).toBe(true)
    expect(rescan(doc, { from: doc.indexOf('tail'), insert: '```' })).toBe(true)
  })
  it('deleting a fence line elsewhere rescans (old lines held the opener)', () => {
    expect(rescan('a\n```js\nb\n```\nc', { from: 2, to: 10, insert: '' })).toBe(true)
  })
  it('equals a full rescan for every single-character edit position', () => {
    for (let i = 0; i <= doc.length; i += 3) {
      rescan(doc, { from: i, insert: 'q' })
      if (i < doc.length) rescan(doc, { from: i, to: i + 1, insert: '' })
    }
  })
})

describe('editor chrome sizing and indent math', () => {
  it('bottom room is 35vh, capped at 40% of a smaller scroll container', () => {
    expect(comfortPadPx(1000, null)).toBe(350)
    expect(comfortPadPx(1000, 900)).toBe(350)
    expect(comfortPadPx(1000, 300)).toBe(120)
    expect(comfortPadPx(800, 0)).toBe(0)
  })
  it('a tab counts to the next tab stop', () => {
    expect(indentColumns('\t', 4)).toBe(4)
    expect(indentColumns('  \t', 4)).toBe(4)
    expect(indentColumns('\t\t', 2)).toBe(4)
    expect(indentColumns('   ', 4)).toBe(3)
  })
  it('selection ranges stay valid', () => {
    expect(EditorSelection.single(1, 2).main.from).toBe(1)
  })
})
