// Word-like mouse selection: double-click takes the word plus its trailing
// space, triple-click takes the whole paragraph (a block between blank lines).
// Drag after the click keeps growing the selection by that unit; shift-click
// extends from the existing anchor.
import { EditorSelection, findClusterBreak, type EditorState, type SelectionRange } from '@codemirror/state'
import { EditorView, type MouseSelectionStyle } from '@codemirror/view'

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

function docLang(): string | undefined {
  try {
    return (typeof document !== 'undefined' && document.documentElement.lang) || undefined
  } catch {
    return undefined
  }
}

/**
 * CodeMirror treats a whole run of Han / kana as one word; narrow it to the
 * dictionary word around `pos` when the platform can segment. `null` keeps the
 * run unchanged.
 */
function narrowCjk(text: string, offset: number): { from: number; to: number } | null {
  if (!CJK.test(text)) return null
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Seg) return null
  try {
    let hit: { from: number; to: number } | null = null
    for (const seg of new Seg(docLang(), { granularity: 'word' }).segment(text)) {
      const from = seg.index
      const to = from + seg.segment.length
      if (offset >= from && offset < to) return { from, to }
      if (offset === to) hit = { from, to }
    }
    return hit
  } catch {
    return null
  }
}

/** Word at `pos` plus one trailing space or tab (not a newline), as Word selects it. */
export function wordWithTrailingSpace(state: EditorState, pos: number): { from: number; to: number } {
  const w = state.wordAt(pos)
  let from: number
  let to: number
  if (w) {
    from = w.from
    to = w.to
    const n = narrowCjk(state.doc.sliceString(w.from, w.to), pos - w.from)
    if (n) {
      from = w.from + n.from
      to = w.from + n.to
    }
  } else {
    // whitespace or punctuation: the run of the same kind of character
    const len = state.doc.length
    const ch = (i: number) => state.doc.sliceString(i, i + 1)
    const isSpace = (c: string) => c === ' ' || c === '\t'
    // the character at `pos` decides; only at the end of a line does a space before it count
    const here = ch(pos)
    const kind = isSpace(here) ? 'space' : (here === '' || here.length === 1 && here.charCodeAt(0) === 10) && isSpace(ch(pos - 1)) ? 'space' : 'other'
    from = pos
    to = pos
    if (kind === 'space') {
      if (!isSpace(ch(pos)) && pos > 0) from = pos - 1
      while (from > 0 && isSpace(ch(from - 1))) from--
      to = Math.max(to, from)
      while (to < len && isSpace(ch(to))) to++
    } else {
      // one whole grapheme cluster (astral emoji, ZWJ sequences, flags), not half a surrogate pair
      const line = state.doc.lineAt(pos)
      const off = pos - line.from
      if (off >= line.length) {
        to = Math.min(len, pos + 1)
      } else {
        const end = findClusterBreak(line.text, off, true)
        const start = findClusterBreak(line.text, end, false)
        from = line.from + start
        to = line.from + end
      }
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
