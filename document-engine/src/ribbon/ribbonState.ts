// Binds the ribbon model to a live CodeMirror editor: reads the facts the
// ribbon needs (marks, block style, selection, history depth, read-only) and
// turns the ribbon's handler calls into editor commands.
import type { EditorView } from '@codemirror/view'
import { undoDepth, redoDepth } from '@codemirror/commands'
import { activeMarks, currentBlockStyle, runEditorCommand, runBlockStyle, type EditorCommandId, type ActiveMarks } from '../editor/editorCommands'
import { notifyRibbon } from './ribbonNotice'
import { buildRibbon, type Ribbon, type RibbonHandlers, type RibbonState } from './ribbonModel'

const NO_MARKS: ActiveMarks = {
  bold: false, italic: false, strike: false, code: false, heading: false, bullet: false, numbered: false, task: false, quote: false,
}

/** Whether the browser exposes clipboard reading at all (informational: Paste stays enabled either way). */
export function clipboardReadable(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as { clipboard?: { readText?: unknown } }).clipboard?.readText === 'function'
}

/** The editor's facts; with no view yet everything reads as an empty read-only editor. */
export function ribbonStateFromView(view: EditorView | null, opts: { readOnly?: boolean; clipboard?: boolean } = {}): RibbonState {
  if (!view) {
    return { marks: NO_MARKS, blockStyle: 'normal', selectionEmpty: true, undoDepth: 0, redoDepth: 0, readOnly: true, clipboard: false }
  }
  const sel = view.state.selection.main
  return {
    marks: activeMarks(view.state, sel.head),
    blockStyle: currentBlockStyle(view.state, sel.head),
    selectionEmpty: sel.empty,
    undoDepth: undoDepth(view.state),
    redoDepth: redoDepth(view.state),
    readOnly: !!opts.readOnly || view.state.readOnly,
    // Paste stays clickable even where reading is unavailable or denied: it then says to use Ctrl+V.
    clipboard: opts.clipboard ?? true,
  }
}

/** Handlers that run against the live view; rich-only ids and values are no-ops here. */
export function ribbonHandlers(view: EditorView | null, ctx: { readOnly?: boolean; notify?: (m: string) => void } = {}): RibbonHandlers {
  return {
    command: (id) => {
      if (view) runEditorCommand(view, id as EditorCommandId, ctx)
    },
    blockStyle: (style) => {
      if (view) runBlockStyle(view, style, ctx)
    },
    setValue: () => {
      /* markdown mode has no font, colour or page values */
    },
  }
}

/** Messages go to `ctx.notify`, by default the shared ribbon notice line (<Ribbon> shows it). */
export function buildEditorRibbon(view: EditorView | null, ctx: { readOnly?: boolean; notify?: (m: string) => void } = {}): Ribbon {
  const withNotify = { ...ctx, notify: ctx.notify ?? notifyRibbon }
  return buildRibbon({ mode: 'markdown', state: ribbonStateFromView(view, withNotify), handlers: ribbonHandlers(view, withNotify) })
}
