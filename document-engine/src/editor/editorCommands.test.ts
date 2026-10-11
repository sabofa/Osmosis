import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import {
  editorCommandSpecs, activeMarks, commandFlags, buildEditorCommands, runEditorCommand, editorKeymap,
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
    expect(activeMarks(doc, doc.indexOf('bold') + 1)).toMatchObject({ bold: true, italic: false })
    expect(activeMarks(doc, doc.indexOf('it') + 1)).toMatchObject({ italic: true, bold: false })
    expect(activeMarks(doc, doc.indexOf('gone') + 1).strike).toBe(true)
    expect(activeMarks(doc, doc.indexOf('code') + 1).code).toBe(true)
    expect(activeMarks(doc, 0)).toMatchObject({ bold: false, italic: false, strike: false, code: false })
    expect(activeMarks(doc, doc.indexOf(' b ') + 1).bold).toBe(false)
  })
  it('detects block prefixes of the caret line only', () => {
    expect(activeMarks('# Title', 3).heading).toBe(true)
    expect(activeMarks('text\n## Sub', 2).heading).toBe(false)
    expect(activeMarks('- a', 3).bullet).toBe(true)
    expect(activeMarks('1. a', 3).numbered).toBe(true)
    expect(activeMarks('- [ ] a', 6)).toMatchObject({ task: true, bullet: false })
    expect(activeMarks('> q', 3).quote).toBe(true)
    expect(activeMarks('plain', 2)).toMatchObject({ heading: false, bullet: false, numbered: false, task: false, quote: false })
  })
  it('clamps out-of-range positions', () => {
    expect(() => activeMarks('x', 99)).not.toThrow()
    expect(() => activeMarks('', -3)).not.toThrow()
  })
})

describe('commandFlags matrix', () => {
  const marks = activeMarks('**x**', 2)
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
  it('every command carries its spec shortcut where it has one', () => {
    const cmds = buildEditorCommands(null)
    expect(byId(cmds, 'bold').shortcut).toBe('Mod-b')
    expect(byId(cmds, 'quote').shortcut).toBeUndefined()
  })
})
