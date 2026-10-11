import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { editorExtensions } from './extensions'
import { enterExitStructure, backspaceStructure } from './structureKeys'
import { editorKeymap, runEditorCommand } from './editorCommands'
import { paragraphAt, wordWithTrailingSpace } from './selectionFeel'

interface Fake { state: EditorState; dispatch(spec: object): void; composing: boolean }
function mk(docWithCaret: string): Fake {
  const caret = docWithCaret.indexOf('|')
  const doc = docWithCaret.replace('|', '')
  const st = EditorState.create({ doc, selection: { anchor: caret < 0 ? doc.length : caret }, extensions: editorExtensions() })
  ensureSyntaxTree(st, st.doc.length, 5000)
  const v: Fake = {
    state: st,
    composing: false,
    dispatch(spec) { v.state = v.state.update(spec as never).state; ensureSyntaxTree(v.state, v.state.doc.length, 5000) },
  }
  return v
}
const shown = (v: Fake) => {
  const h = v.state.selection.main.head
  const d = v.state.doc.toString()
  return d.slice(0, h) + '|' + d.slice(h)
}
const enter = (v: Fake) => enterExitStructure(v) || insertNewlineContinueMarkup(v as unknown as EditorView)
const back = (v: Fake) => backspaceStructure(v)

describe('Enter on an empty structure line exits it', () => {
  it('empty quote line (the case markdown continuation got wrong)', () => {
    const v = mk('> quote\n> |')
    expect(enter(v)).toBe(true)
    expect(shown(v)).toBe('> quote\n\n|')
  })
  it('a lone quote marker with no text before it', () => {
    const v = mk('> |')
    enter(v)
    expect(shown(v)).toBe('|')
  })
  it('empty bullet, numbered and task items', () => {
    for (const [doc, out] of [
      ['- a\n- |', '- a\n\n|'],
      ['1. a\n2. |', '1. a\n\n|'],
      ['- [ ] a\n- [ ] |', '- [ ] a\n\n|'],
      ['- |', '|'],
    ]) {
      const v = mk(doc)
      enter(v)
      expect(shown(v), doc).toBe(out)
    }
  })
  it('typed text after exiting is a new paragraph, not a lazy continuation', () => {
    const v = mk('- a\n- |')
    enter(v)
    v.dispatch({ changes: { from: v.state.selection.main.head, insert: 'next' } })
    expect(v.state.doc.toString()).toBe('- a\n\nnext')
  })
  it('a nested empty item outdents one level first, then exits', () => {
    const v = mk('- a\n  - |')
    enter(v)
    expect(shown(v)).toBe('- a\n- |')
    enter(v)
    expect(shown(v)).toBe('- a\n\n|')
  })
  it('a nested quote loses one level', () => {
    const v = mk('> > |')
    enter(v)
    expect(shown(v)).toBe('> |')
  })
  it('a non-empty item still continues the list', () => {
    const v = mk('- a|')
    expect(enterExitStructure(v)).toBe(false)
    insertNewlineContinueMarkup(v as unknown as EditorView)
    expect(v.state.doc.toString()).toBe('- a\n- ')
  })
  it('leaves code fences, setext underlines and plain text alone', () => {
    expect(enterExitStructure(mk('```\n- |\n```'))).toBe(false)
    expect(enterExitStructure(mk('Title\n-|'))).toBe(false)
    expect(enterExitStructure(mk('plain|'))).toBe(false)
  })
  it('does nothing mid-composition or with a selection', () => {
    const v = mk('- a\n- |')
    v.composing = true
    expect(enterExitStructure(v)).toBe(false)
    const w = mk('- a\n- b|')
    w.dispatch({ selection: { anchor: 4, head: 7 } })
    expect(enterExitStructure(w)).toBe(false)
  })
})

describe('Backspace right after a marker', () => {
  it('removes a bullet marker and keeps the text as a paragraph', () => {
    const v = mk('- |word')
    expect(back(v)).toBe(true)
    expect(shown(v)).toBe('|word')
  })
  it('keeps a blank line so the text does not join the list above', () => {
    const v = mk('- a\n- |b')
    back(v)
    expect(shown(v)).toBe('- a\n\n|b')
  })
  it('removes a numbered or task marker whole', () => {
    const a = mk('1. |x'); back(a); expect(shown(a)).toBe('|x')
    const b = mk('- [ ] |x'); back(b); expect(shown(b)).toBe('|x')
  })
  it('an indented item outdents one level before losing its marker', () => {
    const v = mk('- a\n  - |b')
    back(v)
    expect(shown(v)).toBe('- a\n- |b')
    back(v)
    expect(shown(v)).toBe('- a\n\n|b')
  })
  it('removes a quote marker, one level at a time', () => {
    const v = mk('> > |x')
    back(v)
    expect(shown(v)).toBe('> |x')
    back(v)
    expect(shown(v)).toBe('|x')
  })
  it('does not fire elsewhere in the line or in code', () => {
    expect(back(mk('- wo|rd'))).toBe(false)
    expect(back(mk('- word|'))).toBe(false)
    expect(back(mk('```\n- |x\n```'))).toBe(false)
    expect(back(mk('|- x'))).toBe(false)
  })
})

describe('Word shortcuts', () => {
  const keymap = editorKeymap()
  const run = (v: Fake, key: string) => {
    const b = keymap.find((k) => k.key === key)!
    expect(b, key).toBeTruthy()
    const view = Object.assign(v, { focus() {} }) as unknown as EditorView
    return b.run!(view)
  }
  it('Mod-Alt-1..4 set Heading 1-4 and Mod-Alt-0 resets to Normal', () => {
    const v = mk('plain|')
    run(v, 'Mod-Alt-2')
    expect(v.state.doc.toString()).toBe('## plain')
    run(v, 'Mod-Alt-2')
    expect(v.state.doc.toString()).toBe('## plain') // keeps it, like Word
    run(v, 'Mod-Alt-4')
    expect(v.state.doc.toString()).toBe('#### plain')
    run(v, 'Mod-Alt-0')
    expect(v.state.doc.toString()).toBe('plain')
  })
  it('a list line becomes a heading without keeping the marker', () => {
    const v = mk('- item|')
    run(v, 'Mod-Alt-1')
    expect(v.state.doc.toString()).toBe('# item')
  })
  it('bullets, numbering, strike, clear formatting', () => {
    const a = mk('x|'); run(a, 'Mod-Shift-l'); expect(a.state.doc.toString()).toBe('- x')
    const b = mk('x|'); run(b, 'Mod-Shift-8'); expect(b.state.doc.toString()).toBe('- x')
    const c = mk('x|'); run(c, 'Mod-Shift-7'); expect(c.state.doc.toString()).toBe('1. x')
    const d = mk('x|'); d.dispatch({ selection: { anchor: 0, head: 1 } }); run(d, 'Mod-Shift-x'); expect(d.state.doc.toString()).toBe('~~x~~')
    const e = mk('**x**|'); run(e, 'Mod-\\'); expect(e.state.doc.toString()).toBe('x')
  })
  it('runEditorCommand is still the single place for the commands', () => {
    expect(typeof runEditorCommand).toBe('function')
  })
})

describe('selection units', () => {
  const st = (d: string) => EditorState.create({ doc: d })
  it('a word takes its trailing space', () => {
    expect(wordWithTrailingSpace(st('hello world foo'), 2)).toEqual({ from: 0, to: 6 })
    expect(wordWithTrailingSpace(st('hello world foo'), 13)).toEqual({ from: 12, to: 15 }) // last word: no space after
  })
  it('a word before a newline takes no newline', () => {
    expect(wordWithTrailingSpace(st('ab\ncd'), 1)).toEqual({ from: 0, to: 2 })
  })
  it('clicking spaces selects the run', () => {
    expect(wordWithTrailingSpace(st('a   b'), 2)).toEqual({ from: 1, to: 4 })
  })
  it('a paragraph is the lines between blank lines', () => {
    const d = st('one\ntwo\n\nthree\nfour\nfive\n\nsix')
    expect(paragraphAt(d, 1)).toEqual({ from: 0, to: 7 })
    expect(paragraphAt(d, 14)).toEqual({ from: 9, to: 24 })
    expect(paragraphAt(d, 28)).toEqual({ from: 26, to: 29 })
  })
  it('a blank line selects itself', () => {
    expect(paragraphAt(st('a\n\nb'), 2)).toEqual({ from: 2, to: 2 })
  })
})

describe('structure keys: caret position, tabs and composition', () => {
  it('Enter on an empty item only exits with the caret at or after the marker', () => {
    expect(enterExitStructure(mk('|- '))).toBe(false)
    expect(enterExitStructure(mk('text\n\n|- '))).toBe(false)
    const after = mk('text\n\n- |')
    expect(enterExitStructure(after)).toBe(true)
    const atMarkerEnd = mk('text\n\n-| ')
    expect(enterExitStructure(atMarkerEnd)).toBe(true)
  })
  it('an empty quote line is only exited from after the >', () => {
    expect(enterExitStructure(mk('> a\n|> '))).toBe(false)
    expect(enterExitStructure(mk('> a\n>| '))).toBe(true)
  })
  it('a tab-indented nested item outdents to its tab-indented parent, not to a 1-wide guess', () => {
    const v = mk('- a\n\t- b\n\t\t- |')
    expect(enterExitStructure(v)).toBe(true)
    // parent "\t- b" is 4 columns wide: the child lands there as 4 spaces
    expect(v.state.doc.toString()).toBe('- a\n\t- b\n    - ')
  })
  it('a nested tab item under a top-level item outdents to column 0', () => {
    const v = mk('- a\n\t- |')
    expect(enterExitStructure(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('- a\n- ')
  })
  it('Backspace after a nested marker uses the same column maths', () => {
    const v = mk('- a\n\t- b\n\t\t- |')
    expect(backspaceStructure(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('- a\n\t- b\n    - ')
  })
  it('no key action during composition or just after it', async () => {
    const { markCompositionEnd } = await import('./compositionGuard')
    const v = mk('- a\n- |')
    v.composing = true
    expect(enterExitStructure(v)).toBe(false)
    expect(backspaceStructure(v)).toBe(false)
    v.composing = false
    markCompositionEnd(v, Date.now())
    expect(enterExitStructure(v)).toBe(false)
    markCompositionEnd(v, Date.now() - 500)
    expect(enterExitStructure(v)).toBe(true)
  })
})
