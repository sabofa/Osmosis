import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import {
  editorCommandSpecs, activeMarks, commandFlags, buildEditorCommands, runEditorCommand, editorKeymap,
  currentBlockStyle, pasteFromClipboard, runBlockStyle,
} from './editorCommands'

function mkView(doc: string, anchor = doc.length, head = anchor, readOnly = false): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [history(), markdown({ base: markdownLanguage }), ...(readOnly ? [EditorState.readOnly.of(true)] : [])],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  // No DOM in this test environment: a stand-in with the three members the
  // commands use (state, dispatch, focus).
  const fake = {
    state,
    dispatch(spec: Parameters<EditorState['update']>[0]) { fake.state = fake.state.update(spec).state },
    focus() {},
    destroy() {},
  }
  return fake as unknown as EditorView
}
const stateOf = (doc: string): EditorState => {
  const st = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(st, st.doc.length, 5000)
  return st
}
// activeMarks over a real EditorState + markdown() parse (no DOM needed).
const am = (doc: string, pos: number) => activeMarks(stateOf(doc), pos)
const byId = (cmds: ReturnType<typeof buildEditorCommands>, id: string) => cmds.find((c) => c.id === id)!

describe('editorCommandSpecs', () => {
  const specs = editorCommandSpecs()
  it('lists every command once with the four groups', () => {
    expect(specs.map((s) => s.id)).toEqual([
      'bold', 'italic', 'strike', 'code', 'link', 'heading-cycle', 'bullet-list', 'numbered-list', 'task-list', 'quote', 'undo', 'redo', 'find',
    ])
    expect(new Set(specs.map((s) => s.group))).toEqual(new Set(['text', 'block', 'history', 'find']))
  })
  it('has the required shortcuts', () => {
    const key = (id: string) => specs.find((s) => s.id === id)!
    expect(key('bold').shortcut).toBe('Mod-b')
    expect(key('italic').shortcut).toBe('Mod-i')
    expect(key('code').shortcut).toBe('Mod-e')
    expect(key('link').shortcut).toBe('Mod-k')
    expect(key('undo').shortcut).toBe('Mod-z')
    expect(key('redo').shortcut).toBe('Mod-Shift-z')
    expect(key('redo').altShortcut).toBe('Mod-y')
    expect(key('find').shortcut).toBe('Mod-f')
  })
  it('keymap covers every shortcut including the redo alternate', () => {
    const keys = editorKeymap().map((k) => k.key)
    expect(keys).toEqual(['Mod-b', 'Mod-i', 'Mod-e', 'Mod-k', 'Mod-z', 'Mod-Shift-z', 'Mod-y', 'Mod-f'])
  })
})

describe('activeMarks', () => {
  it('detects inline marks around the caret', () => {
    const doc = 'a **bold** b *it* ~~gone~~ `code`'
    expect(am(doc, doc.indexOf('bold') + 1)).toMatchObject({ bold: true, italic: false })
    expect(am(doc, doc.indexOf('it') + 1)).toMatchObject({ italic: true, bold: false })
    expect(am(doc, doc.indexOf('gone') + 1).strike).toBe(true)
    expect(am(doc, doc.indexOf('code') + 1).code).toBe(true)
    expect(am(doc, 0)).toMatchObject({ bold: false, italic: false, strike: false, code: false })
    expect(am(doc, doc.indexOf(' b ') + 1).bold).toBe(false)
  })
  it('detects block prefixes of the caret line only', () => {
    expect(am('# Title', 3).heading).toBe(true)
    expect(am('text\n## Sub', 2).heading).toBe(false)
    expect(am('- a', 3).bullet).toBe(true)
    expect(am('1. a', 3).numbered).toBe(true)
    expect(am('- [ ] a', 6)).toMatchObject({ task: true, bullet: false })
    expect(am('> q', 3).quote).toBe(true)
    expect(am('plain', 2)).toMatchObject({ heading: false, bullet: false, numbered: false, task: false, quote: false })
  })
  it('clamps out-of-range positions', () => {
    expect(() => am('x', 99)).not.toThrow()
    expect(() => am('', -3)).not.toThrow()
  })
  it('a bullet star is not italic', () => {
    const doc = '* item with *em* here'
    expect(am(doc, doc.indexOf('item') + 1)).toMatchObject({ italic: false, bullet: true })
    expect(am(doc, doc.indexOf('*em*') + 2).italic).toBe(true)
    expect(am(doc, doc.indexOf('here') + 1).italic).toBe(false)
  })
  it('snake_case, spaced stars and underscored urls are plain', () => {
    expect(am('snake_case_name', 7).italic).toBe(false)
    expect(am('2 * 3 * 4', 5)).toMatchObject({ italic: false, bold: false })
    const url = 'see https://example.com/a_b_c now'
    expect(am(url, url.indexOf('b_c'))).toMatchObject({ italic: false, bold: false })
  })
  it('double-backtick code is code and shields marks', () => {
    const doc = 'x ``a `b` **c**`` y'
    expect(am(doc, doc.indexOf('a ') + 1)).toMatchObject({ code: true, bold: false })
    expect(am(doc, doc.indexOf('c**') )).toMatchObject({ code: true, bold: false })
    expect(am(doc, doc.length - 1).code).toBe(false)
  })
  it('nested marks and the edges of a span', () => {
    const doc = '**b *i* b**'
    expect(am(doc, doc.indexOf('i') )).toMatchObject({ bold: true, italic: true })
    expect(am(doc, doc.length).bold).toBe(false) // just past the closing marker
    expect(am('~~x~~', 3).strike).toBe(true)
  })
  it('nothing is active inside a fence, even block prefixes', () => {
    const doc = '```\n# x **y**\n- z\n```'
    for (const pos of [doc.indexOf('x'), doc.indexOf('y'), doc.indexOf('z')]) {
      expect(Object.values(am(doc, pos)).some(Boolean)).toBe(false)
    }
  })
})

describe('commandFlags matrix', () => {
  const marks = am('**x**', 2)
  const f = (id: Parameters<typeof commandFlags>[0], over = {}) =>
    commandFlags(id, { hasView: true, readOnly: false, undoDepth: 0, redoDepth: 0, marks, ...over })
  it('everything is off without a view', () => {
    for (const s of editorCommandSpecs()) expect(commandFlags(s.id, { hasView: false, readOnly: false, undoDepth: 3, redoDepth: 3, marks })).toEqual({ enabled: false, active: false })
  })
  it('read-only disables edits but keeps find', () => {
    expect(f('bold', { readOnly: true }).enabled).toBe(false)
    expect(f('undo', { readOnly: true, undoDepth: 2 }).enabled).toBe(false)
    expect(f('find', { readOnly: true }).enabled).toBe(true)
  })
  it('undo / redo follow history depth', () => {
    expect(f('undo').enabled).toBe(false)
    expect(f('undo', { undoDepth: 1 }).enabled).toBe(true)
    expect(f('redo', { undoDepth: 1 }).enabled).toBe(false)
    expect(f('redo', { redoDepth: 1 }).enabled).toBe(true)
  })
  it('active follows the marks', () => {
    expect(f('bold')).toEqual({ enabled: true, active: true })
    expect(f('italic').active).toBe(false)
  })
})

describe('buildEditorCommands with a view', () => {
  it('null view: all disabled', () => {
    const cmds = buildEditorCommands(null)
    expect(cmds).toHaveLength(13)
    expect(cmds.every((c) => !c.enabled && !c.active)).toBe(true)
  })
  it('active marks reflect the caret and code fences are inert', () => {
    const v = mkView('# T\n\n**b**', 8)
    const cmds = buildEditorCommands(v)
    expect(byId(cmds, 'bold').active).toBe(true)
    expect(byId(cmds, 'heading-cycle').active).toBe(false)
    const fenced = mkView('```\n**x**\n```', 7)
    expect(byId(buildEditorCommands(fenced), 'bold').active).toBe(false)
    v.destroy()
    fenced.destroy()
  })
  it('bold wraps the selection, with undo and redo enabled around it', () => {
    const v = mkView('hello world', 0, 5)
    expect(byId(buildEditorCommands(v), 'undo').enabled).toBe(false)
    byId(buildEditorCommands(v), 'bold').run()
    expect(v.state.doc.toString()).toBe('**hello** world')
    expect(byId(buildEditorCommands(v), 'undo').enabled).toBe(true)
    byId(buildEditorCommands(v), 'undo').run()
    expect(v.state.doc.toString()).toBe('hello world')
    expect(byId(buildEditorCommands(v), 'redo').enabled).toBe(true)
    byId(buildEditorCommands(v), 'redo').run()
    expect(v.state.doc.toString()).toBe('**hello** world')
    v.destroy()
  })
  it('block commands edit the caret line', () => {
    const v = mkView('one\ntwo', 5)
    runEditorCommand(v, 'quote')
    expect(v.state.doc.toString()).toBe('one\n> two')
    runEditorCommand(v, 'heading-cycle')
    expect(v.state.doc.line(2).text.startsWith('#')).toBe(true)
    v.destroy()
  })
  it('read-only views refuse edits', () => {
    const v = mkView('abc', 0, 3, true)
    const cmds = buildEditorCommands(v)
    expect(byId(cmds, 'bold').enabled).toBe(false)
    expect(runEditorCommand(v, 'bold')).toBe(false)
    expect(v.state.doc.toString()).toBe('abc')
    v.destroy()
  })
  it('ctx.readOnly disables without a read-only state', () => {
    const v = mkView('abc', 0, 3)
    expect(byId(buildEditorCommands(v, { readOnly: true }), 'bold').enabled).toBe(false)
    v.destroy()
  })
  it('commands no-op while an IME composition is live', () => {
    const v = mkView('hello world', 0, 5)
    ;(v as unknown as { composing: boolean }).composing = true
    expect(runEditorCommand(v, 'bold')).toBe(false)
    expect(runEditorCommand(v, 'undo')).toBe(false)
    expect(v.state.doc.toString()).toBe('hello world')
    ;(v as unknown as { composing: boolean }).composing = false
    expect(runEditorCommand(v, 'bold')).toBe(true)
    v.destroy()
  })
  it('a reversed selection stays reversed after a command', () => {
    const v = mkView('hello world', 5, 0)
    runEditorCommand(v, 'bold')
    expect(v.state.doc.toString()).toBe('**hello** world')
    const sel = v.state.selection.main
    expect(sel.anchor).toBeGreaterThan(sel.head)
    v.destroy()
  })
  it('block commands leave a fenced line alone', () => {
    const v = mkView('```\ncode\n```', 6)
    expect(runEditorCommand(v, 'quote')).toBe(false)
    expect(runEditorCommand(v, 'heading-cycle')).toBe(false)
    expect(v.state.doc.toString()).toBe('```\ncode\n```')
    v.destroy()
  })
  it('every command carries its spec shortcut where it has one', () => {
    const cmds = buildEditorCommands(null)
    expect(byId(cmds, 'bold').shortcut).toBe('Mod-b')
    expect(byId(cmds, 'quote').shortcut).toBeUndefined()
  })
})

describe('currentBlockStyle', () => {
  const at = (doc: string, pos: number) => currentBlockStyle(stateOf(doc), pos)
  it('reads headings, quote, list, code and normal', () => {
    for (let n = 1; n <= 6; n++) expect(at('#'.repeat(n) + ' title', 3)).toBe('h' + n)
    expect(at('> quoted', 3)).toBe('quote')
    expect(at('- item', 3)).toBe('list')
    expect(at('2. item', 4)).toBe('list')
    expect(at('- [ ] task', 6)).toBe('list')
    expect(at('plain text', 3)).toBe('normal')
    expect(at('#hashtag', 3)).toBe('normal')
    expect(at('', 0)).toBe('normal')
  })
  it('code covers fence lines and the body; text after the fence is normal', () => {
    const doc = 'a\n```js\nlet x\n```\nb'
    expect(at(doc, doc.indexOf('let') + 2)).toBe('code')
    expect(at(doc, doc.indexOf('```js') + 1)).toBe('code')
    expect(at(doc, doc.length)).toBe('normal')
    expect(at(doc, 0)).toBe('normal')
  })
  it('a heading-looking line inside a fence is code', () => {
    expect(at('```\n# not a heading\n```', 8)).toBe('code')
  })
  it('defaults to the selection head', () => {
    const st = EditorState.create({ doc: 'x\n## y', selection: { anchor: 5 }, extensions: [markdown({ base: markdownLanguage })] })
    expect(currentBlockStyle(st)).toBe('h2')
  })
})

describe('ribbon commands on a view', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const doc = (v: EditorView) => v.state.doc.toString()
  const clip = (over: Record<string, unknown>) => vi.stubGlobal('navigator', { clipboard: over })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('select-all selects the document, even read-only', () => {
    const v = mkView('abc\ndef', 0, 0, true)
    expect(runEditorCommand(v, 'select-all')).toBe(true)
    expect(v.state.selection.main.from).toBe(0)
    expect(v.state.selection.main.to).toBe(7)
  })
  it('block insert commands', () => {
    let v = mkView('one', 3)
    expect(runEditorCommand(v, 'hr')).toBe(true)
    expect(doc(v)).toBe('one\n\n---')
    v = mkView('one', 3)
    runEditorCommand(v, 'graph-block')
    expect(doc(v)).toBe('one\n\n```graph\ny = sin(x)\nx in [-6.28, 6.28]\n```')
    v = mkView('x^2', 0, 3)
    runEditorCommand(v, 'math-block')
    expect(doc(v)).toBe('$$\nx^2\n$$')
    v = mkView('code', 0, 4)
    runEditorCommand(v, 'code-block')
    expect(doc(v)).toBe('```\ncode\n```')
  })
  it('clear-format strips marks and prefixes', () => {
    const v = mkView('## **bold** and *it*', 3)
    expect(runEditorCommand(v, 'clear-format')).toBe(true)
    expect(doc(v)).toBe('bold and it')
  })
  it('runBlockStyle sets and toggles, and is blocked read-only', () => {
    const v = mkView('title', 2)
    expect(runBlockStyle(v, 'h2')).toBe(true)
    expect(doc(v)).toBe('## title')
    expect(runBlockStyle(v, 'h2')).toBe(true)
    expect(doc(v)).toBe('title')
    expect(runBlockStyle(mkView('x', 0, 0, true), 'h1')).toBe(false)
    expect(runBlockStyle(v, 'h1', { readOnly: true })).toBe(false)
  })
  it('indent / outdent: spaces on plain lines, list indent on list items', () => {
    const v = mkView('a\nb', 0, 3)
    runEditorCommand(v, 'indent')
    expect(doc(v)).toBe('  a\n  b')
    runEditorCommand(v, 'outdent')
    expect(doc(v)).toBe('a\nb')
    const l = mkView('- a', 3)
    expect(runEditorCommand(l, 'indent')).toBe(true)
    expect(doc(l)).toBe('  - a')
    runEditorCommand(l, 'outdent')
    expect(doc(l)).toBe('- a')
  })
  it('edit-type ribbon commands do nothing read-only or while composing', () => {
    for (const id of ['paste', 'cut', 'indent', 'hr', 'clear-format', 'replace'] as const) {
      expect(runEditorCommand(mkView('- a', 0, 3, true), id)).toBe(false)
    }
    const v = mkView('abc', 0, 3)
    ;(v as unknown as { composing: boolean }).composing = true
    expect(runEditorCommand(v, 'hr')).toBe(false)
    expect(runEditorCommand(v, 'indent')).toBe(false)
  })
  it('paste inserts clipboard text as an input transaction', async () => {
    clip({ readText: async () => 'PASTED' })
    const v = mkView('ab', 1)
    expect(runEditorCommand(v, 'paste')).toBe(true)
    await flush()
    expect(doc(v)).toBe('aPASTEDb')
    expect(await pasteFromClipboard(mkView('x', 1))).toBe('pasted')
  })
  it('paste replaces the selection', async () => {
    clip({ readText: async () => 'Z' })
    const v = mkView('abc', 0, 3)
    await pasteFromClipboard(v)
    expect(doc(v)).toBe('Z')
  })
  it('paste with a denied or missing clipboard is a no-op and says so', async () => {
    const notify = vi.fn()
    clip({ readText: async () => { throw new Error('denied') } })
    const v = mkView('ab', 1)
    expect(await pasteFromClipboard(v, { notify })).toBe('denied')
    expect(doc(v)).toBe('ab')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatch(/Ctrl\+V/)
    vi.stubGlobal('navigator', {})
    expect(await pasteFromClipboard(v, { notify })).toBe('denied')
    expect(notify).toHaveBeenCalledTimes(2)
  })
  it('paste is dropped if the doc became read-only while waiting', async () => {
    let release: (t: string) => void = () => {}
    clip({ readText: () => new Promise<string>((r) => { release = r }) })
    const v = mkView('ab', 1)
    const ctx = { readOnly: false }
    const p = pasteFromClipboard(v, ctx)
    ctx.readOnly = true
    release('late')
    expect(await p).toBe('blocked')
    expect(doc(v)).toBe('ab')
  })
  it('copy writes the selection and leaves the text; empty selection is a no-op', async () => {
    const writeText = vi.fn(async (_t: string) => {})
    clip({ writeText })
    const v = mkView('hello', 0, 5, true)
    expect(runEditorCommand(v, 'copy')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    await flush()
    expect(doc(v)).toBe('hello')
    expect(runEditorCommand(mkView('hello', 2), 'copy')).toBe(false)
  })
  it('cut copies then deletes, but only what was copied', async () => {
    const writeText = vi.fn(async (_t: string) => {})
    clip({ writeText })
    const v = mkView('hello world', 0, 5)
    expect(runEditorCommand(v, 'cut')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    await flush()
    expect(doc(v)).toBe(' world')
    expect(v.state.selection.main.head).toBe(0)
  })
  it('cut leaves the text if the write failed or the text changed meanwhile', async () => {
    clip({ writeText: async () => { throw new Error('no') } })
    const v = mkView('hello', 0, 5)
    runEditorCommand(v, 'cut')
    await flush()
    expect(doc(v)).toBe('hello')
    let ok: () => void = () => {}
    clip({ writeText: () => new Promise<void>((r) => { ok = r }) })
    const w = mkView('hello', 0, 5)
    runEditorCommand(w, 'cut')
    w.dispatch({ changes: { from: 0, to: 5, insert: 'HELLO' } })
    ok()
    await flush()
    expect(doc(w)).toBe('HELLO')
  })
})
