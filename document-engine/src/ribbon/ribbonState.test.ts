import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { ribbonStateFromView, buildEditorRibbon } from './ribbonState'
import { subscribeRibbonNotices } from './ribbonNotice'
import { ribbonControls, ribbonToToolbarCommands } from './ribbonModel'

function mkView(doc: string, anchor: number, head = anchor): EditorView {
  const state = EditorState.create({ doc, selection: { anchor, head }, extensions: [history(), markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const fake = {
    state,
    dispatch(spec: Parameters<EditorState['update']>[0]) { fake.state = fake.state.update(spec).state },
    focus() {},
  }
  return fake as unknown as EditorView
}

describe('ribbonStateFromView', () => {
  it('no view reads as an empty read-only editor', () => {
    const s = ribbonStateFromView(null)
    expect(s.readOnly).toBe(true)
    expect(s.selectionEmpty).toBe(true)
    expect(s.blockStyle).toBe('normal')
  })
  it('reads marks, block style and selection off the live state', () => {
    const v = mkView('## Head\n\nsome **bold** text', 16, 18)
    const s = ribbonStateFromView(v, { clipboard: true })
    expect(s.marks.bold).toBe(true)
    expect(s.selectionEmpty).toBe(false)
    expect(s.undoDepth).toBe(0)
    expect(s.clipboard).toBe(true)
    expect(ribbonStateFromView(mkView('## Head', 3), { clipboard: false }).blockStyle).toBe('h2')
  })
  it('read-only turns the edit controls off but keeps Find', () => {
    const r = buildEditorRibbon(mkView('abc', 1), { readOnly: true })
    const by = Object.fromEntries(ribbonControls(r).map((c) => [c.id, c]))
    expect(by.bold.enabled).toBe(false)
    expect(by.find.enabled).toBe(true)
  })
})

describe('buildEditorRibbon', () => {
  it('runs a toggle against the view and the flat commands carry the same handlers', () => {
    const v = mkView('hello world', 0, 5)
    const r = buildEditorRibbon(v)
    const bold = ribbonControls(r).find((c) => c.id === 'bold')
    expect(bold?.kind).toBe('toggle')
    if (bold?.kind === 'toggle') bold.run()
    expect(v.state.doc.toString()).toBe('**hello** world')
    const flat = ribbonToToolbarCommands(buildEditorRibbon(mkView('hello world', 0, 5)))
    expect(flat.find((c) => c.id === 'bold')?.enabled).toBe(true)
  })
  it('picking a gallery style rewrites the line', () => {
    const v = mkView('plain', 2)
    const r = buildEditorRibbon(v)
    const g = ribbonControls(r).find((c) => c.kind === 'gallery')
    if (g?.kind === 'gallery') g.onChange('h1')
    expect(v.state.doc.toString()).toBe('# plain')
  })
  it('Paste stays enabled, and a denied clipboard reaches the ribbon notice line', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => { throw new Error('denied') } } })
    const got: string[] = []
    const off = subscribeRibbonNotices((m) => got.push(m))
    const r = buildEditorRibbon(mkView('ab', 1))
    const paste = ribbonControls(r).find((c) => c.id === 'paste')
    expect(paste?.enabled).toBe(true)
    if (paste?.kind === 'button') paste.run()
    await new Promise((res) => setTimeout(res, 0))
    off()
    expect(got.join()).toMatch(/Ctrl\+V/)
    // no clipboard API at all: still clickable, still explains
    vi.stubGlobal('navigator', {})
    expect(ribbonControls(buildEditorRibbon(mkView('ab', 1))).find((c) => c.id === 'paste')?.enabled).toBe(true)
  })
  it('an explicit notify wins over the shared channel', async () => {
    vi.stubGlobal('navigator', {})
    const notify = vi.fn()
    const r = buildEditorRibbon(mkView('ab', 1), { notify })
    const paste = ribbonControls(r).find((c) => c.id === 'paste')
    if (paste?.kind === 'button') paste.run()
    await new Promise((res) => setTimeout(res, 0))
    expect(notify).toHaveBeenCalled()
  })
})

afterEach(() => vi.unstubAllGlobals())
