import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { editorExtensions } from './extensions'
import { revertAutocorrect, planAutocorrect, setAutocorrect, autocorrectExtension } from './autocorrect'

// A stand-in view over a real EditorState with the real extension set: the
// registered inputHandlers decide, exactly as CodeMirror would call them.
type Fake = EditorView & { composing: boolean }
function mk(docWithCaret: string, opts: { autocorrect?: boolean } = {}): Fake {
  const caret = docWithCaret.indexOf('|')
  const doc = docWithCaret.replace('|', '')
  const state = EditorState.create({
    doc, selection: { anchor: caret < 0 ? doc.length : caret }, extensions: editorExtensions(opts),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const v = {
    state,
    composing: false,
    compositionStarted: false,
    dispatch(...args: unknown[]) {
      const a = args[0]
      if (Array.isArray(a)) v.state = (a as { state: EditorState }[])[a.length - 1].state
      else if (a && typeof a === 'object' && 'startState' in a) v.state = (a as unknown as { state: EditorState }).state
      else v.state = v.state.update(a as never).state
    },
    focus() {},
    dom: undefined,
  }
  return v as unknown as Fake
}
function type(v: Fake, text: string): void {
  for (const ch of text) {
    const { from, to } = v.state.selection.main
    const handled = v.state.facet(EditorView.inputHandler).some((h) =>
      h(v, from, to, ch, () => v.state.update({ changes: { from, to, insert: ch } })))
    if (!handled) {
      v.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length }, userEvent: 'input.type' })
    }
    ensureSyntaxTree(v.state, v.state.doc.length, 5000)
  }
}
const text = (v: Fake) => v.state.doc.toString()
const head = (v: Fake) => v.state.selection.main.head
const key = (v: Fake, _name: 'Backspace') => revertAutocorrect(v)

describe('smart quotes', () => {
  it('opens after start / space / bracket and closes otherwise', () => {
    const v = mk('')
    type(v, '"Hello," she said ("yes")')
    expect(text(v)).toBe('“Hello,” she said (“yes”)')
  })
  it('single quotes: opening after space, apostrophe inside a word', () => {
    const v = mk('')
    type(v, "it's 'quoted' and don't")
    expect(text(v)).toBe('it’s ‘quoted’ and don’t')
  })
  it('leaves an escaped or backticked quote alone', () => {
    const v = mk('')
    type(v, '\\"')
    expect(text(v)).not.toMatch(/[“”]/) // closeBrackets may still pair it
  })
  it('opens after an em dash', () => {
    const v = mk('a—')
    type(v, '"')
    expect(text(v)).toBe('a—“')
  })
})

describe('dashes, ellipsis, symbols', () => {
  it('word--word becomes an em dash once the second word ends', () => {
    const v = mk('')
    type(v, 'wait--what')
    expect(text(v)).toBe('wait--what')
    type(v, ' ')
    expect(text(v)).toBe('wait—what ')
    expect(head(v)).toBe(10)
  })
  it('a -- b (spaced) becomes an en dash', () => {
    const v = mk('')
    type(v, 'she said -- it')
    type(v, ' ')
    expect(text(v)).toBe('she said – it ')
  })
  it('a spaced single hyphen stays', () => {
    const v = mk('')
    type(v, 'a - b ')
    expect(text(v)).toBe('a - b ')
  })
  it('--- and --> are not dashes', () => {
    const v = mk('')
    type(v, 'a---b ')
    expect(text(v)).toBe('a---b ')
    const w = mk('')
    type(w, 'x-->y ')
    expect(text(w)).toBe('x-->y ')
  })
  it('... becomes an ellipsis, .... does not re-fire', () => {
    const v = mk('')
    type(v, 'ok...')
    expect(text(v)).toBe('ok…')
    const w = mk('')
    type(w, 'ok....')
    expect(text(w)).toBe('ok….')
  })
  it('(c) (r) (tm) become symbols; 1/2 stays', () => {
    const v = mk('')
    type(v, '(c) (R) (tm) 1/2')
    expect(text(v)).toBe('© ® ™ 1/2')
  })
  it('(c) steps over an auto-closed bracket', () => {
    const v = mk('x (c|)')
    type(v, ')')
    expect(text(v)).toBe('x ©')
    expect(head(v)).toBe(3)
  })
  it('f(c) after a letter is a function call, not a symbol', () => {
    const v = mk('')
    type(v, 'f(c)')
    expect(text(v)).toBe('f(c)')
  })
})

describe('where autocorrect stays out', () => {
  it('inline code, fenced code, math, URLs, HTML', () => {
    const cases: [string, string][] = [
      ['`a|`', '"'],
      ['`a|', '"'],
      ['```\nx|\n```', '"'],
      ['```\nx..|\n```', '.'],
      ['$x|$', "'"],
      ['$x', "'"],
      ['$$\nx|\n$$', '"'],
      ['see https://a.example/x|', '.'],
      ['see www.a.example/x..|', '.'],
      ['<a href=x|>', '"'],
    ]
    for (const [doc, ch] of cases) {
      const v = mk(doc)
      type(v, ch)
      const straight = text(v).includes(ch) && !/[“”‘’…]/.test(text(v))
      expect(straight, doc).toBe(true)
    }
  })
  it('a price is not math', () => {
    const v = mk('costs $5 and ')
    type(v, '"')
    expect(text(v)).toBe('costs $5 and “')
  })
  it('works after a closed code span', () => {
    const v = mk('`a` ')
    type(v, '"')
    expect(text(v)).toBe('`a` “')
  })
  it('never during composition, with several carets, or when switched off', () => {
    const v = mk('')
    v.composing = true
    type(v, '"')
    expect(text(v)).not.toMatch(/[“”]/)
    const off = mk('', { autocorrect: false })
    type(off, '"x... (c)')
    expect(text(off)).not.toMatch(/[“”…©]/)
    expect(planAutocorrect(off.state, 0, 0, '"')).not.toBeNull() // the plan is pure; only the handler is gated
  })
  it('only single typed characters (a paste is not autocorrected)', () => {
    const v = mk('')
    expect(planAutocorrect(v.state, 0, 0, '"abc"')).toBeNull()
  })
})

describe('undo like Word', () => {
  it('Backspace right after a correction restores what was typed', () => {
    const v = mk('')
    type(v, 'ok...')
    expect(text(v)).toBe('ok…')
    expect(key(v, 'Backspace')).toBe(true)
    expect(text(v)).toBe('ok...')
    expect(head(v)).toBe(5)
  })
  it('Backspace after a quote gives the straight quote', () => {
    const v = mk('')
    type(v, 'say "')
    expect(text(v)).toBe('say “')
    key(v, 'Backspace')
    expect(text(v)).toBe('say "')
  })
  it('any other edit or caret move clears the revert', () => {
    const v = mk('')
    type(v, 'ok...')
    type(v, 'x')
    expect(key(v, 'Backspace')).toBe(false)
    const w = mk('')
    type(w, 'ok...')
    w.dispatch({ selection: { anchor: 1 } })
    expect(key(w, 'Backspace')).toBe(false)
  })
  it('Mod-z undoes the correction alone, then the typed character', () => {
    const v = mk('')
    type(v, 'ab...')
    expect(text(v)).toBe('ab…')
    undo(v)
    expect(text(v)).toBe('ab...')
    undo(v)
    expect(text(v)).toBe('')
    redo(v)
    expect(text(v)).toBe('ab...')
  })
  it('a delayed dash is undone on its own', () => {
    const v = mk('')
    type(v, 'a--b ')
    expect(text(v)).toBe('a—b ')
    undo(v)
    expect(text(v)).toBe('a--b ')
    expect(key(v, 'Backspace')).toBe(false)
  })
})

describe('toggle', () => {
  it('setAutocorrect(false) removes the handler and (true) restores it', () => {
    // the compartment reconfigure needs only dispatch + state
    const v = mk('')
    setAutocorrect(v, false)
    type(v, '"')
    expect(text(v)).not.toMatch(/[“”]/)
    setAutocorrect(v, true)
    type(v, ' "')
    expect(text(v)).toMatch(/ “/)
  })
  it('autocorrectExtension() is usable on its own', () => {
    expect(autocorrectExtension()).toBeTruthy()
  })
})
