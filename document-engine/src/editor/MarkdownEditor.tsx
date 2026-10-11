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
  // Exact host texts around an external dispatch, for the highlight remap.
  const pendingHostsRef = useRef<{ oldHost: string; newHost: string } | null>(null)
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
      if (step.apply && v) {
        pendingHostsRef.current = { oldHost: step.apply.oldHost, newHost: step.apply.newHost }
        try { applyValue(v, step.apply.internal) } finally { pendingHostsRef.current = null }
      }
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
            let newText: string | null = null
            const current = () => (newText ??= u.state.doc.toString())
            const external = u.transactions.some((tr) => tr.annotation(externalSync))
            const g = glueRef.current!
            const oldText = u.startState.doc.toString()
            // Exact host texts: the external prop value, or the text we emit.
            const newHost = external ? pendingHostsRef.current?.newHost ?? toHostEol(current(), g.eol) : toHostEol(current(), g.eol)
            let oldHost = external ? pendingHostsRef.current?.oldHost ?? g.lastHost : g.lastHost
            if (normalizeEol(oldHost) !== oldText) oldHost = toHostEol(oldText, g.eol)
            const hs = highlightsRef.current
            if (hs.length && p.onHighlightsChange) {
              const next = remapHighlightsThroughChanges(oldText, current(), hs, u.changes, g.eol, { oldHost, newHost })
              if (next) {
                highlightsRef.current = next
                p.onHighlightsChange(next)
              }
            }
            if (!external) {
              glueRef.current = glueOnEmit(g, newHost)
              p.onChange(newHost)
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
