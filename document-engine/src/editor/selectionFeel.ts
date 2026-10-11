// Word-like mouse selection: double-click takes the word plus its trailing
// space, triple-click takes the whole paragraph (a block between blank lines).
// Drag after the click keeps growing the selection by that unit; shift-click
// extends from the existing anchor.
import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state'
import { EditorView, type MouseSelectionStyle } from '@codemirror/view'

/** Word at `pos` plus one trailing space or tab (not a newline), as Word selects it. */
export function wordWithTrailingSpace(state: EditorState, pos: number): { from: number; to: number } {
  const w = state.wordAt(pos)
  let from: number
  let to: number
  if (w) {
    from = w.from
    to = w.to
  } else {
    // whitespace or punctuation: the run of the same kind of character
    const len = state.doc.length
    const ch = (i: number) => state.doc.sliceString(i, i + 1)
    const isSpace = (c: string) => c === ' ' || c === '\t'
    const kind = isSpace(ch(pos)) ? 'space' : isSpace(ch(pos - 1)) ? 'space' : 'other'
    from = pos
    to = pos
    if (kind === 'space') {
      if (!isSpace(ch(pos)) && pos > 0) from = pos - 1
      while (from > 0 && isSpace(ch(from - 1))) from--
      to = Math.max(to, from)
      while (to < len && isSpace(ch(to))) to++
    } else {
      to = Math.min(len, pos + 1)
    }
    return { from, to }
  }
  const next = state.doc.sliceString(to, to + 1)
  if (next === ' ' || next === '\t') to++
  return { from, to }
}

/** The paragraph at `pos`: consecutive non-blank lines (a blank line selects itself). */
export function paragraphAt(state: EditorState, pos: number): { from: number; to: number } {
  const doc = state.doc
  const line = doc.lineAt(pos)
  if (line.text.trim() === '') return { from: line.from, to: line.to }
  let first = line.number
  let last = line.number
  while (first > 1 && doc.line(first - 1).text.trim() !== '') first--
  while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++
  return { from: doc.line(first).from, to: doc.line(last).to }
}

type Unit = (state: EditorState, pos: number) => { from: number; to: number }

function unitStyle(view: EditorView, event: MouseEvent, unit: Unit): MouseSelectionStyle {
  const at = (e: MouseEvent): number => view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
  const start = unit(view.state, at(event))
  const anchorRange = view.state.selection.main
  return {
    get(cur, extend, multiple): EditorSelection {
      const here = unit(view.state, at(cur))
      let range: SelectionRange
      if (extend) {
        const anchor = anchorRange.anchor
        range = EditorSelection.range(anchor, here.from < anchor ? here.from : here.to)
      } else if (here.from < start.from) {
        range = EditorSelection.range(start.to, here.from)
      } else {
        range = EditorSelection.range(start.from, Math.max(here.to, start.to))
      }
      return multiple ? view.state.selection.addRange(range) : EditorSelection.single(range.anchor, range.head)
    },
    update() {},
  }
}

/** The mouse-selection extension. Single clicks and drags keep CodeMirror's own handling. */
export const wordSelectionStyle = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0) return null
  if (event.detail === 2) return unitStyle(view, event, wordWithTrailingSpace)
  if (event.detail === 3) return unitStyle(view, event, paragraphAt)
  return null
})
