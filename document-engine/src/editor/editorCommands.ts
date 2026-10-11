// The Markdown editor's toolbar commands. editorCommandSpecs() is the pure
// catalogue (ids, labels, groups, icons, shortcuts); buildEditorCommands()
// binds it to a live EditorView; editorKeymap() registers the same shortcuts
// inside the editor so the keyboard works without any toolbar.
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { undo, redo, undoDepth, redoDepth, selectAll, indentMore, indentLess } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import type { ToolbarCommand } from 'engine-host'
import {
  toggleWrap, toggleLinePrefix, cycleHeading, makeLink, setBlockStyle, clearFormatting, insertHr, insertMathBlock,
  insertGraphFence, indentLines, selectionIsAllList, type MarkdownEdit, type BlockStyle, type SettableBlockStyle,
} from './markdownEdit'

export type { BlockStyle, SettableBlockStyle }

export type EditorCommandId =
  | 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'heading-cycle'
  | 'bullet-list' | 'numbered-list' | 'task-list' | 'quote'
  | 'undo' | 'redo' | 'find'
  // ribbon commands (not in editorCommandSpecs(): the ribbon owns their labels)
  | 'paste' | 'cut' | 'copy' | 'select-all' | 'replace' | 'indent' | 'outdent' | 'clear-format'
  | 'hr' | 'code-block' | 'math-block' | 'graph-block'

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

const INLINE_NODES: Record<string, keyof ActiveMarks> = {
  StrongEmphasis: 'bold',
  Emphasis: 'italic',
  Strikethrough: 'strike',
  InlineCode: 'code',
}

/** True when `pos` sits inside a fenced or indented code block (fence lines count). */
function inCodeBlock(state: EditorState, pos: number): boolean {
  let hit = false
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (n) => {
      if (n.name === 'FencedCode' || n.name === 'CodeBlock') hit = true
      return !hit
    },
  })
  return hit
}

/**
 * Which inline marks and block prefixes surround offset `pos`. Inline marks
 * come from the Markdown syntax tree (so a bullet star or snake_case is not
 * emphasis); block prefixes are read off the line. Nothing is active in code.
 */
export function activeMarks(state: EditorState, pos: number = state.selection.main.head): ActiveMarks {
  const p = Math.max(0, Math.min(pos, state.doc.length))
  // Make sure the tree reaches the caret (it may be parsed lazily on long documents).
  ensureSyntaxTree(state, Math.min(state.doc.length, p + 1), 25)
  if (inCodeBlock(state, p)) return NONE
  const out = { ...NONE }
  syntaxTree(state).iterate({
    from: p,
    to: p,
    enter: (n) => {
      const key = INLINE_NODES[n.name]
      // strictly inside: a caret just outside the closing marker is not in the span
      if (key && n.from < p && p < n.to) out[key] = true
    },
  })
  const line = state.doc.lineAt(p).text
  const task = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(line)
  return {
    ...out,
    heading: /^ {0,3}#{1,6}(\s|$)/.test(line),
    task,
    bullet: !task && /^\s*[-*+]\s/.test(line),
    numbered: /^\s*\d+[.)]\s/.test(line),
    quote: /^\s*>/.test(line),
  }
}

/** The block style of the line at `pos`: code, heading level, quote, list or normal. */
export function currentBlockStyle(state: EditorState, pos: number = state.selection.main.head): BlockStyle {
  const p = Math.max(0, Math.min(pos, state.doc.length))
  ensureSyntaxTree(state, Math.min(state.doc.length, p + 1), 25)
  if (inCodeBlock(state, p)) return 'code'
  const line = state.doc.lineAt(p).text
  const h = /^ {0,3}(#{1,6})(?:\s|$)/.exec(line)
  if (h) return `h${h[1].length}` as BlockStyle
  if (/^\s*>/.test(line)) return 'quote'
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return 'list'
  return 'normal'
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
  'clear-format': () => clearFormatting(),
  hr: () => insertHr(),
  'code-block': () => setBlockStyle('code'),
  'math-block': () => insertMathBlock(),
  'graph-block': () => insertGraphFence(),
}

export interface EditorCommandContext {
  readOnly?: boolean
  /** Told when a command cannot finish (e.g. the browser denied clipboard access). */
  notify?: (message: string) => void
}

function applyEdit(view: EditorView, make: () => MarkdownEdit): boolean {
  const sel = view.state.selection.main
  const res = make()(view.state.doc.toString(), { from: sel.from, to: sel.to, reversed: sel.anchor > sel.head })
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

/** Apply a block style (Normal, Heading n, Quote, Code block) to the cursor line / selected lines. */
export function runBlockStyle(view: EditorView, style: SettableBlockStyle, ctx: EditorCommandContext = {}): boolean {
  if (ctx.readOnly || view.state.readOnly || view.composing) return false
  return applyEdit(view, () => setBlockStyle(style))
}

type ClipboardLike = { readText?: () => Promise<string>; writeText?: (t: string) => Promise<void> }
const clipboard = (): ClipboardLike | undefined =>
  typeof navigator !== 'undefined' ? (navigator as { clipboard?: ClipboardLike }).clipboard : undefined

function legacyCommand(name: 'cut' | 'copy'): boolean {
  try {
    return typeof document !== 'undefined' && typeof document.execCommand === 'function' && document.execCommand(name)
  } catch {
    return false
  }
}

/**
 * Paste the clipboard text at the selection as an input transaction. Async:
 * resolves to what happened. A denied or missing clipboard is a no-op that
 * tells `ctx.notify` to use the keyboard paste instead.
 */
export async function pasteFromClipboard(view: EditorView, ctx: EditorCommandContext = {}): Promise<'pasted' | 'empty' | 'denied' | 'blocked'> {
  if (ctx.readOnly || view.state.readOnly || view.composing) return 'blocked'
  let text = ''
  try {
    const cb = clipboard()
    if (!cb?.readText) throw new Error('no clipboard')
    text = await cb.readText()
  } catch {
    ctx.notify?.('Paste was blocked by the browser. Press Ctrl+V instead.')
    return 'denied'
  }
  if (!text) return 'empty'
  // the world may have changed while a permission prompt was open
  if (ctx.readOnly || view.state.readOnly || view.composing) return 'blocked'
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true })
  view.focus()
  return 'pasted'
}

function copySelection(view: EditorView, cut: boolean): boolean {
  const sel = view.state.selection.main
  if (sel.empty) return false
  const text = view.state.sliceDoc(sel.from, sel.to)
  const cb = clipboard()
  const removeIfSame = () => {
    // only delete what we copied, and only if the user has not moved on
    if (view.state.readOnly || view.state.sliceDoc(sel.from, sel.to) !== text) return
    view.dispatch({ changes: { from: sel.from, to: sel.to }, selection: { anchor: sel.from }, userEvent: 'delete.cut' })
    view.focus()
  }
  if (cb?.writeText) {
    cb.writeText(text).then(
      () => { if (cut) removeIfSame() },
      () => { legacyCommand(cut ? 'cut' : 'copy') },
    )
    return true
  }
  return legacyCommand(cut ? 'cut' : 'copy')
}

function runReplace(view: EditorView): boolean {
  openSearchPanel(view)
  const dom = (view as { dom?: HTMLElement }).dom
  const field = dom?.querySelector?.('input[name=replace]') as HTMLInputElement | null | undefined
  field?.focus()
  return true
}

function runIndent(view: EditorView, dir: 1 | -1): boolean {
  const sel = view.state.selection.main
  if (selectionIsAllList(view.state.doc.toString(), { from: sel.from, to: sel.to })) {
    return dir === 1 ? indentMore(view) : indentLess(view)
  }
  return applyEdit(view, () => indentLines(dir))
}

/** Run one command against the view. Returns whether it did anything. */
export function runEditorCommand(view: EditorView, id: EditorCommandId, ctx: EditorCommandContext = {}): boolean {
  if (id === 'find') {
    openSearchPanel(view)
    return true
  }
  // reading commands work on a read-only document too
  if (id === 'copy') return copySelection(view, false)
  if (id === 'select-all') return selectAll(view)
  if (ctx.readOnly || view.state.readOnly) return false
  // An IME composition owns the text right now; a toolbar edit would corrupt it.
  if (view.composing) return false
  if (id === 'paste') {
    void pasteFromClipboard(view, ctx)
    return true
  }
  if (id === 'cut') return copySelection(view, true)
  if (id === 'replace') return runReplace(view)
  if (id === 'indent') return runIndent(view, 1)
  if (id === 'outdent') return runIndent(view, -1)
  const make = EDITS[id]
  if (make) return applyEdit(view, make)
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
    marks = activeMarks(view.state, head)
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
