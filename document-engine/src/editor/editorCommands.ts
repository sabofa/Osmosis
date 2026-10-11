// The Markdown editor's toolbar commands. editorCommandSpecs() is the pure
// catalogue (ids, labels, groups, icons, shortcuts); buildEditorCommands()
// binds it to a live EditorView; editorKeymap() registers the same shortcuts
// inside the editor so the keyboard works without any toolbar.
import { EditorSelection } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import type { ToolbarCommand } from 'engine-host'
import { toggleWrap, toggleLinePrefix, cycleHeading, makeLink, type MarkdownEdit } from './markdownEdit'

export type EditorCommandId =
  | 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'heading-cycle'
  | 'bullet-list' | 'numbered-list' | 'task-list' | 'quote'
  | 'undo' | 'redo' | 'find'

export type EditorCommandGroup = 'text' | 'block' | 'history' | 'find'

export interface EditorCommandSpec {
  id: EditorCommandId
  label: string
  group: EditorCommandGroup
  icon: string
  // CodeMirror key spelling ('Mod' is Ctrl or Cmd); redo lists its alternate.
  shortcut?: string
  altShortcut?: string
}

export function editorCommandSpecs(): EditorCommandSpec[] {
  return [
    { id: 'bold', label: 'Bold', group: 'text', icon: 'doc-bold', shortcut: 'Mod-b' },
    { id: 'italic', label: 'Italic', group: 'text', icon: 'doc-italic', shortcut: 'Mod-i' },
    { id: 'strike', label: 'Strikethrough', group: 'text', icon: 'doc-strike' },
    { id: 'code', label: 'Code', group: 'text', icon: 'doc-code', shortcut: 'Mod-e' },
    { id: 'link', label: 'Link', group: 'text', icon: 'doc-link', shortcut: 'Mod-k' },
    { id: 'heading-cycle', label: 'Heading level', group: 'block', icon: 'doc-heading' },
    { id: 'bullet-list', label: 'Bulleted list', group: 'block', icon: 'doc-list-bullet' },
    { id: 'numbered-list', label: 'Numbered list', group: 'block', icon: 'doc-list-number' },
    { id: 'task-list', label: 'Task list', group: 'block', icon: 'doc-list-task' },
    { id: 'quote', label: 'Quote', group: 'block', icon: 'doc-quote' },
    { id: 'undo', label: 'Undo', group: 'history', icon: 'doc-undo', shortcut: 'Mod-z' },
    { id: 'redo', label: 'Redo', group: 'history', icon: 'doc-redo', shortcut: 'Mod-Shift-z', altShortcut: 'Mod-y' },
    { id: 'find', label: 'Find', group: 'find', icon: 'doc-search', shortcut: 'Mod-f' },
  ]
}

// ------------------------------------------------------------ active marks

export interface ActiveMarks {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  heading: boolean
  bullet: boolean
  numbered: boolean
  task: boolean
  quote: boolean
}

const NONE: ActiveMarks = { bold: false, italic: false, strike: false, code: false, heading: false, bullet: false, numbered: false, task: false, quote: false }

// Start offsets of runs of `c` that are exactly `len` long.
function exactRuns(line: string, c: string, len: number): number[] {
  const out: number[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== c) { i++; continue }
    let j = i
    while (j < line.length && line[j] === c) j++
    if (j - i === len) out.push(i)
    i = j
  }
  return out
}

// True when column `col` of `line` sits between a pair of `marker` runs (the
// markers themselves count as inside). Runs pair up left to right.
function insidePair(line: string, marker: string, col: number, runLen = marker.length): boolean {
  const runs = exactRuns(line, marker[0], runLen)
  for (let k = 0; k + 1 < runs.length; k += 2) {
    if (col >= runs[k] && col <= runs[k + 1] + runLen) return true
  }
  return false
}

/** Which inline marks and block prefixes surround offset `pos` of `doc`. */
export function activeMarks(doc: string, pos: number): ActiveMarks {
  const p = Math.max(0, Math.min(pos, doc.length))
  const start = p === 0 ? 0 : doc.lastIndexOf('\n', p - 1) + 1
  const nl = doc.indexOf('\n', p)
  const line = doc.slice(start, nl < 0 ? doc.length : nl)
  const col = p - start
  const task = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(line)
  return {
    ...NONE,
    bold: insidePair(line, '**', col) || insidePair(line, '__', col),
    italic: insidePair(line, '*', col) || insidePair(line, '_', col),
    strike: insidePair(line, '~~', col),
    code: insidePair(line, '`', col),
    heading: /^ {0,3}#{1,6}(\s|$)/.test(line),
    task,
    bullet: !task && /^\s*[-*+]\s/.test(line),
    numbered: /^\s*\d+[.)]\s/.test(line),
    quote: /^\s*>/.test(line),
  }
}

function inCodeBlock(view: EditorView, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true
  }
  return false
}

// -------------------------------------------------------------- running

const EDITS: Partial<Record<EditorCommandId, () => MarkdownEdit>> = {
  bold: () => toggleWrap('**'),
  italic: () => toggleWrap('*'),
  strike: () => toggleWrap('~~'),
  code: () => toggleWrap('`'),
  link: () => makeLink(),
  'heading-cycle': () => cycleHeading(1),
  'bullet-list': () => toggleLinePrefix('- '),
  'numbered-list': () => toggleLinePrefix('1. '),
  'task-list': () => toggleLinePrefix('- [ ] '),
  quote: () => toggleLinePrefix('> '),
}

export interface EditorCommandContext {
  readOnly?: boolean
}

/** Run one command against the view. Returns whether it did anything. */
export function runEditorCommand(view: EditorView, id: EditorCommandId, ctx: EditorCommandContext = {}): boolean {
  if (id === 'find') {
    openSearchPanel(view)
    return true
  }
  if (ctx.readOnly || view.state.readOnly) return false
  const make = EDITS[id]
  if (make) {
    const sel = view.state.selection.main
    const res = make()(view.state.doc.toString(), { from: sel.from, to: sel.to })
    if (!res) return false
    view.dispatch({
      changes: res.changes,
      selection: EditorSelection.single(res.selection.anchor, res.selection.head),
      userEvent: 'input',
      scrollIntoView: true,
    })
    view.focus()
    return true
  }
  if (id === 'undo') return undo(view)
  if (id === 'redo') return redo(view)
  return false
}

function isActive(marks: ActiveMarks, id: EditorCommandId): boolean {
  switch (id) {
    case 'bold': return marks.bold
    case 'italic': return marks.italic
    case 'strike': return marks.strike
    case 'code': return marks.code
    case 'heading-cycle': return marks.heading
    case 'bullet-list': return marks.bullet
    case 'numbered-list': return marks.numbered
    case 'task-list': return marks.task
    case 'quote': return marks.quote
    default: return false
  }
}

/** Pure flags for one command from the editor's facts; no view needed. */
export function commandFlags(
  id: EditorCommandId,
  facts: { hasView: boolean; readOnly: boolean; undoDepth: number; redoDepth: number; marks: ActiveMarks }
): { enabled: boolean; active: boolean } {
  if (!facts.hasView) return { enabled: false, active: false }
  if (id === 'find') return { enabled: true, active: false }
  if (facts.readOnly) return { enabled: false, active: false }
  if (id === 'undo') return { enabled: facts.undoDepth > 0, active: false }
  if (id === 'redo') return { enabled: facts.redoDepth > 0, active: false }
  return { enabled: true, active: isActive(facts.marks, id) }
}

export function buildEditorCommands(view: EditorView | null, ctx: EditorCommandContext = {}): ToolbarCommand[] {
  let marks = NONE
  let readOnly = !!ctx.readOnly
  let undoN = 0
  let redoN = 0
  if (view) {
    readOnly = readOnly || view.state.readOnly
    undoN = undoDepth(view.state)
    redoN = redoDepth(view.state)
    const head = view.state.selection.main.head
    marks = inCodeBlock(view, head) ? NONE : activeMarks(view.state.doc.toString(), head)
  }
  return editorCommandSpecs().map((s) => {
    const flags = commandFlags(s.id, { hasView: !!view, readOnly, undoDepth: undoN, redoDepth: redoN, marks })
    const cmd: ToolbarCommand = {
      id: s.id,
      label: s.label,
      icon: s.icon,
      group: s.group,
      enabled: flags.enabled,
      active: flags.active,
      run: () => {
        if (view) runEditorCommand(view, s.id, ctx)
      },
    }
    if (s.shortcut) cmd.shortcut = s.shortcut
    return cmd
  })
}

/** Key bindings for every spec shortcut; first in the keymap so they win. */
export function editorKeymap(): KeyBinding[] {
  const out: KeyBinding[] = []
  for (const s of editorCommandSpecs()) {
    for (const key of [s.shortcut, s.altShortcut]) {
      if (key) out.push({ key, preventDefault: true, run: (v) => runEditorCommand(v, s.id) })
    }
  }
  return out
}
