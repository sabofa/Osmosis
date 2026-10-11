// Controlled CodeMirror 6 Markdown editor. The EditorView is created once;
// `value` is synced in with an annotated replace so it never echoes back.
import { useEffect, useRef } from 'react'
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { DocumentHighlight } from '../types'
import { editorExtensions, readOnlyExtension } from './extensions'
import { editorKeymap } from './editorCommands'
import {
  diffRange, remapHighlightsThroughChanges, toHostEol, normalizeEol,
  initGlue, glueOnProp, glueOnEmit, glueOnFlush, glueOnCompositionEnd, glueOnUnmount,
  type GlueState, type GlueStep, type TimerCmd,
} from './editorSync'

export interface MarkdownEditorProps {
  value: string
  onChange(text: string): void
  onReady?(view: EditorView): void
  // Highlight offsets (in and out) are codepoints into the LF-NORMALISED text:
  // every "\r\n" and lone "\r" counts as one "\n", whatever EOL `value` has.
  // `onChange` still gets the text back with its original line ending.
  highlights?: DocumentHighlight[]
  onHighlightsChange?(h: DocumentHighlight[]): void
  onCompositionChange?(composing: boolean): void
  // Fired on every document or selection change (the viewer throttles it).
  onViewUpdate?(view: EditorView): void
  readOnly?: boolean
  autoFocus?: boolean
}

const externalSync = Annotation.define<boolean>()

/**
 * Write an external value in as the smallest single change, outside undo
 * history, so the caret, scroll and highlights ride through it.
 */
function applyValue(view: EditorView, internal: string) {
  const diff = diffRange(view.state.doc.toString(), internal)
  if (!diff) return
  view.dispatch({
    changes: diff,
    annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
  })
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const composingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Flush / retry / echo bookkeeping lives in a pure state machine (editorSync).
  const glueRef = useRef<GlueState | null>(null)
  if (glueRef.current === null) glueRef.current = initGlue(props.value)
  const runFlushRef = useRef<((step: GlueStep) => void) | null>(null)
  const readOnlyRef = useRef<Compartment | null>(null)
  if (readOnlyRef.current === null) readOnlyRef.current = new Compartment()
  const appliedReadOnlyRef = useRef(!!props.readOnly)
  const highlightsRef = useRef<DocumentHighlight[]>(props.highlights ?? [])
  highlightsRef.current = props.highlights ?? highlightsRef.current

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const clearTimer = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const runTimer = (t: TimerCmd) => {
      if (!t) return
      clearTimer()
      if (t.kind === 'arm') timerRef.current = setTimeout(() => flushQueued(t.tries), t.ms)
    }
    const run = (step: GlueStep) => {
      glueRef.current = step.state
      const v = viewRef.current
      if (step.apply && v) applyValue(v, step.apply.internal)
      runTimer(step.timer)
    }
    // Apply the queued value once the composition has fully settled.
    function flushQueued(tries: number) {
      timerRef.current = null
      const v = viewRef.current
      if (!v) return
      run(glueOnFlush(glueRef.current!, v.state.doc.toString(), composingRef.current, v.composing, tries))
    }
    runFlushRef.current = run
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: normalizeEol(propsRef.current.value),
        extensions: [
          editorExtensions({
            readOnly: propsRef.current.readOnly,
            readOnlyCompartment: readOnlyRef.current!,
            extraKeymap: editorKeymap(),
          }),
          EditorView.domEventHandlers({
            compositionstart: () => {
              composingRef.current = true
              propsRef.current.onCompositionChange?.(true)
              return false
            },
            compositionend: () => {
              composingRef.current = false
              propsRef.current.onCompositionChange?.(false)
              // After CodeMirror's own compositionend handling has settled.
              runTimer(glueOnCompositionEnd())
              return false
            },
          }),
          EditorView.updateListener.of((u) => {
            const p = propsRef.current
            if (u.docChanged || u.selectionSet) p.onViewUpdate?.(u.view)
            if (!u.docChanged) return
            const external = u.transactions.some((tr) => tr.annotation(externalSync))
            const g = glueRef.current!
            const hs = highlightsRef.current
            if (hs.length && p.onHighlightsChange) {
              const next = remapHighlightsThroughChanges(u.startState.doc.toString(), u.state.doc.toString(), hs, u.changes)
              if (next) {
                highlightsRef.current = next
                p.onHighlightsChange(next)
              }
            }
            if (!external) {
              const out = toHostEol(u.state.doc.toString(), g.eol)
              glueRef.current = glueOnEmit(g, out)
              p.onChange(out)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    propsRef.current.onReady?.(view)
    if (propsRef.current.autoFocus) view.focus()
    return () => {
      clearTimer()
      composingRef.current = false
      glueRef.current = glueOnUnmount(glueRef.current!).state
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    runFlushRef.current?.(glueOnProp(glueRef.current!, props.value, view.state.doc.toString(), composingRef.current, view.composing))
  }, [props.value])

  useEffect(() => {
    const view = viewRef.current
    const ro = !!props.readOnly
    if (!view || ro === appliedReadOnlyRef.current) return
    appliedReadOnlyRef.current = ro
    view.dispatch({ effects: readOnlyRef.current!.reconfigure(readOnlyExtension(ro)) })
  }, [props.readOnly])

  return <div ref={hostRef} data-component="markdown-editor" />
}
