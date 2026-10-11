// CodeMirror 6 extension set for the Markdown source editor. Every colour,
// font and size is a var(--de-*) reference; the host owns the sheet.
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, drawSelection, rectangularSelection, crosshairCursor, type KeyBinding,
} from '@codemirror/view'
import {
  history, defaultKeymap, historyKeymap, indentMore, indentLess,
  moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine,
} from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { indentOnInput, syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { livePreview } from './livePreview'

export interface EditorExtensionOptions {
  readOnly?: boolean
  // When given, the read-only facets live in it so the host can flip them later.
  readOnlyCompartment?: Compartment
  // Extra bindings, listed before every built-in one so they win.
  extraKeymap?: KeyBinding[]
  // Render markdown in place, revealing raw marks at the caret (default true).
  livePreview?: boolean
}

const LIST_NODES = new Set(['ListItem', 'BulletList', 'OrderedList'])

/** True when the main cursor line sits inside a list item. */
export function cursorInListItem(state: EditorState): boolean {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const tree = syntaxTree(state)
  for (const at of [pos, line.from]) {
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(at, -1)
    for (; n; n = n.parent) if (LIST_NODES.has(n.name)) return true
  }
  return false
}

/** Tab / Shift-Tab indent only inside list items; elsewhere they stay navigable. */
export const listIndentKeymap = [
  { key: 'Tab', run: (v: EditorView) => (cursorInListItem(v.state) ? indentMore(v) : false) },
  { key: 'Shift-Tab', run: (v: EditorView) => (cursorInListItem(v.state) ? indentLess(v) : false) },
]

export const lineOpsKeymap = [
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  { key: 'Shift-Alt-ArrowUp', run: copyLineUp },
  { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
  { key: 'Mod-Shift-k', run: deleteLine },
]

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontFamily: 'var(--de-font-display)', fontWeight: '700', fontSize: '1.6em' },
  { tag: t.heading2, fontFamily: 'var(--de-font-display)', fontWeight: '700', fontSize: '1.4em' },
  { tag: t.heading3, fontFamily: 'var(--de-font-display)', fontWeight: '700', fontSize: '1.2em' },
  { tag: [t.heading4, t.heading5, t.heading6], fontFamily: 'var(--de-font-display)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--de-link)' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--de-code-text)', fontFamily: 'var(--de-font-stack-code)' },
  { tag: [t.quote, t.comment, t.lineComment, t.blockComment], color: 'var(--de-text-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--de-text-muted)' },
  { tag: t.keyword, color: 'var(--de-syntax-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--de-syntax-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--de-syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--de-syntax-function)' },
  { tag: [t.typeName, t.className], color: 'var(--de-syntax-type)' },
  { tag: t.operator, color: 'var(--de-syntax-operator)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--de-syntax-punctuation)' },
])

// With live preview, heading sizes come from line decorations (livePreview.ts),
// so the highlight style must not scale the heading text a second time.
export const liveHighlightStyle = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontFamily: 'var(--de-font-display)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.quote, t.comment, t.lineComment, t.blockComment], color: 'var(--de-text-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--de-text-muted)' },
  { tag: t.keyword, color: 'var(--de-syntax-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--de-syntax-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--de-syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--de-syntax-function)' },
  { tag: [t.typeName, t.className], color: 'var(--de-syntax-type)' },
  { tag: t.operator, color: 'var(--de-syntax-operator)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--de-syntax-punctuation)' },
])

const lpCompartment = new Compartment()
/** Highlight style plus (when on) the live-preview plugin: one swappable slot. */
export function livePreviewBundle(on: boolean): Extension {
  return on ? [livePreview(), syntaxHighlighting(liveHighlightStyle)] : syntaxHighlighting(markdownHighlightStyle)
}
/** Turn live preview on or off for a mounted view. */
export function setLivePreview(view: EditorView, on: boolean): void {
  view.dispatch({ effects: lpCompartment.reconfigure(livePreviewBundle(on)) })
}

export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--de-text)',
    fontFamily: 'var(--de-font-stack-body)',
    fontSize: 'var(--de-font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--de-leading)' },
  '.cm-content': {
    maxWidth: 'var(--de-measure)',
    marginInline: 'auto',
    padding: '1em 0.5em',
    caretColor: 'var(--de-text)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--de-text)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--de-selection)',
  },
  '.cm-gutters': { display: 'none' },
  '.cm-panels': {
    backgroundColor: 'var(--de-page)',
    color: 'var(--de-text)',
    fontFamily: 'var(--de-font-stack-body)',
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--de-rule)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--de-rule)' },
  '.cm-panel.cm-search': { padding: '0.4em 0.6em' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    font: 'inherit',
    color: 'var(--de-text)',
    backgroundColor: 'var(--de-code-bg)',
    border: '1px solid var(--de-rule)',
    borderRadius: 'var(--de-radius-sm)',
    padding: '0.15em 0.4em',
    margin: '0.1em',
  },
  '.cm-panel.cm-search label': { color: 'var(--de-text-muted)', fontSize: '0.9em' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--de-text-muted)' },
  '.cm-searchMatch': { backgroundColor: 'var(--de-selection)' },
  '.cm-searchMatch-selected': { outline: '1px solid var(--de-accent)' },
})

/** The facets that make the editor read-only (empty when editable). */
export function readOnlyExtension(readOnly: boolean | undefined): Extension {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
}

export function editorExtensions(opts: EditorExtensionOptions = {}): Extension[] {
  const exts: Extension[] = [
    history(),
    markdown({ base: markdownLanguage, addKeymap: true }),
    closeBrackets(),
    indentOnInput(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey || e.ctrlKey || e.metaKey),
    search({ top: true }),
    EditorView.lineWrapping,
    lpCompartment.of(livePreviewBundle(opts.livePreview !== false)),
    editorTheme,
    // Earlier keymaps win: list Tab, line ops, search, brackets, then defaults.
    keymap.of([
      ...(opts.extraKeymap ?? []),
      ...listIndentKeymap,
      ...lineOpsKeymap,
      ...searchKeymap,
      ...closeBracketsKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ]
  const ro = readOnlyExtension(opts.readOnly)
  exts.push(opts.readOnlyCompartment ? opts.readOnlyCompartment.of(ro) : ro)
  return exts
}
