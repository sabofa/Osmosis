// Enter and Backspace on list, task and quote lines, the way Word does it:
// Enter on an empty item leaves the structure (one level at a time when it is
// nested), Backspace right after a marker drops the marker (or outdents a
// nested item first). Anything else falls through to the Markdown defaults.
import type { EditorState, ChangeSpec } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { composingNow } from './compositionGuard'

type CmdView = Pick<EditorView, 'state' | 'dispatch'> & { composing?: boolean; compositionStarted?: boolean }

const LIST_ITEM = /^([ \t]*)((?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?)(?:[ \t]+|$)/
const LIST_MARK = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?/
const LIST_EMPTY = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/
const QUOTE_PREFIX = /^[ \t]{0,3}(?:>[ \t]?)+/
const QUOTE_EMPTY = /^[ \t]{0,3}(?:>[ \t]*)+$/
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'CodeText'])

/** Is the line's first mark really inside a `kind` container (and not inside code)? */
function lineIn(state: EditorState, lineTo: number, markAt: number, kind: 'ListItem' | 'Blockquote'): boolean {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, lineTo + 1), 50)
  if (!tree) return false
  for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(Math.min(markAt, lineTo), 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return false
    if (n.name === kind && n.from <= markAt) return true
  }
  return false
}

/** Width in columns of leading whitespace `ws`: a tab advances to the next tab stop. */
export function indentColumns(ws: string, tabSize: number): number {
  let col = 0
  for (const c of ws) col = c === '\t' ? col + tabSize - (col % tabSize) : col + 1
  return col
}

/** Indent (in columns) of the list item this line is nested under (0 when none is found). */
function parentIndent(state: EditorState, lineNo: number, cols: number): number {
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (text.trim() === '') continue
    const m = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]/.exec(text)
    if (m) {
      const c = indentColumns(m[1], state.tabSize)
      if (c < cols) return c
    }
    if (!/^[ \t]/.test(text)) break
  }
  return 0
}

function prevIsText(state: EditorState, lineNo: number): boolean {
  return lineNo > 1 && state.doc.line(lineNo - 1).text.trim() !== ''
}

function usable(view: CmdView): boolean {
  if (composingNow(view) || view.state.readOnly) return false
  const sel = view.state.selection
  return sel.ranges.length === 1 && sel.main.empty
}

/** Enter on an empty list / task / quote line: outdent a nested item, else leave the structure. */
export function enterExitStructure(view: CmdView): boolean {
  if (!usable(view)) return false
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const text = line.text
  const indent = /^[ \t]*/.exec(text)![0].length
  const col = head - line.from

  // The caret must sit at or after the marker, else Enter splits above it as usual.
  const markEnd = LIST_MARK.exec(text)?.[0].length ?? 0
  if (LIST_EMPTY.test(text) && col >= markEnd && lineIn(state, line.to, line.from + indent, 'ListItem')) {
    if (indent > 0) {
      const to = parentIndent(state, line.number, indentColumns(text.slice(0, indent), state.tabSize))
      view.dispatch({
        changes: { from: line.from, to: line.from + indent, insert: ' '.repeat(to) },
        selection: { anchor: line.from + to + (text.length - indent) },
        userEvent: 'delete.outdent',
        scrollIntoView: true,
      })
      return true
    }
    return leave(view, line.from, line.to, line.number)
  }

  if (QUOTE_EMPTY.test(text) && col > text.indexOf('>') && lineIn(state, line.to, line.from + indent, 'Blockquote')) {
    const levels = (text.match(/>/g) ?? []).length
    if (levels > 1) {
      const kept = text.slice(0, text.lastIndexOf('>')).replace(/[ \t]*$/, ' ')
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: kept },
        selection: { anchor: line.from + kept.length },
        userEvent: 'delete.outdent',
        scrollIntoView: true,
      })
      return true
    }
    return leave(view, line.from, line.to, line.number)
  }
  return false
}

/** Empty the line; keep a blank line above it so the next text is not a lazy continuation. */
function leave(view: CmdView, from: number, to: number, lineNo: number): boolean {
  const sep = prevIsText(view.state, lineNo)
  view.dispatch({
    changes: { from, to, insert: sep ? '\n' : '' },
    selection: { anchor: from + (sep ? 1 : 0) },
    userEvent: 'delete.exit',
    scrollIntoView: true,
  })
  return true
}

/** Backspace right after a marker: outdent a nested item, else remove the marker. */
export function backspaceStructure(view: CmdView): boolean {
  if (!usable(view)) return false
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const text = line.text
  const col = head - line.from

  const lm = LIST_ITEM.exec(text)
  if (lm && (col === lm[0].length || (col === text.length && lm[0].length === text.length))) {
    const indent = lm[1].length
    if (!lineIn(state, line.to, line.from + indent, 'ListItem')) return false
    if (indent > 0) {
      const to = parentIndent(state, line.number, indentColumns(text.slice(0, indent), state.tabSize))
      view.dispatch({
        changes: { from: line.from, to: line.from + indent, insert: ' '.repeat(to) },
        selection: { anchor: head - indent + to },
        userEvent: 'delete.outdent',
        scrollIntoView: true,
      })
      return true
    }
    return dropPrefix(view, line.from, line.from + lm[0].length, line.number)
  }

  const qm = QUOTE_PREFIX.exec(text)
  if (qm && col === qm[0].length) {
    const indent = /^[ \t]*/.exec(text)![0].length
    if (!lineIn(state, line.to, line.from + indent, 'Blockquote')) return false
    const levels = (qm[0].match(/>/g) ?? []).length
    if (levels > 1) {
      const cut = qm[0].lastIndexOf('>')
      view.dispatch({
        changes: { from: line.from + cut, to: head },
        selection: { anchor: line.from + cut },
        userEvent: 'delete.outdent',
        scrollIntoView: true,
      })
      return true
    }
    return dropPrefix(view, line.from, line.from + qm[0].length, line.number)
  }
  return false
}

function dropPrefix(view: CmdView, from: number, to: number, lineNo: number): boolean {
  const sep = prevIsText(view.state, lineNo)
  const changes: ChangeSpec[] = [{ from, to }]
  if (sep) changes.unshift({ from, insert: '\n' })
  view.dispatch({
    changes,
    selection: { anchor: from + (sep ? 1 : 0) },
    userEvent: 'delete.backward',
    scrollIntoView: true,
  })
  return true
}

/** Registered at the highest precedence: the Markdown keymap's own Enter/Backspace sit below it. */
export const structureKeymap: KeyBinding[] = [
  { key: 'Enter', run: (v) => enterExitStructure(v) },
  { key: 'Backspace', run: (v) => backspaceStructure(v) },
]
