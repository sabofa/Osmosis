// Controlled CodeMirror 6 Markdown editor. The EditorView is created once;
// `value` is synced in with an annotated replace so it never echoes back.
import { useEffect, useRef } from 'react'
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { DocumentHighlight } from '../types'
import { editorExtensions, readOnlyExtension } from './extensions'
import { editorKeymap } from './editorCommands'
import {
  decideValueSync, decideQueuedApply, diffRange, remapHighlightsThroughChanges,
  detectEol, normalizeEol, toHostEol, rememberEmitted, type Eol,
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

// Retry cadence for a value that arrived mid-composition (about a second in all).
const RETRY_MS = 25
const MAX_RETRIES = 40

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
  const queuedRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Texts we emitted via onChange: a parent that mirrors them hands them back later.
  const emittedRef = useRef<string[]>([])
  // The host's line ending; the editor itself works on LF-only text.
  const eolRef = useRef<Eol>(detectEol(props.value))
  const readOnlyRef = useRef(new Compartment())
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
    // Apply the queued value once the composition has fully settled.
    const flushQueued = (tries: number) => {
      timerRef.current = null
      const q = queuedRef.current
      const v = viewRef.current
      if (q === null || !v) return
      const composing = composingRef.current || v.composing
      const d = decideQueuedApply(normalizeEol(q), v.state.doc.toString(), composing, emittedRef.current.includes(q))
      if (d === 'retry') {
        // A new composition began: its own compositionend re-arms the flush.
        if (!composingRef.current && tries < MAX_RETRIES) timerRef.current = setTimeout(() => flushQueued(tries + 1), RETRY_MS)
        return
      }
      queuedRef.current = null
      if (d === 'apply') {
        eolRef.current = detectEol(q, eolRef.current)
        applyValue(v, normalizeEol(q))
      }
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: normalizeEol(propsRef.current.value),
        extensions: [
          editorExtensions({
            readOnly: propsRef.current.readOnly,
            readOnlyCompartment: readOnlyRef.current,
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
              clearTimer()
              timerRef.current = setTimeout(() => flushQueued(0), 0)
              return false
            },
          }),
          EditorView.updateListener.of((u) => {
            const p = propsRef.current
            if (u.docChanged || u.selectionSet) p.onViewUpdate?.(u.view)
            if (!u.docChanged) return
            let newText: string | null = null
            const current = () => (newText ??= u.state.doc.toString())
            const hs = highlightsRef.current
            if (hs.length && p.onHighlightsChange) {
              const next = remapHighlightsThroughChanges(u.startState.doc.toString(), current(), hs, u.changes, eolRef.current)
              if (next) {
                highlightsRef.current = next
                p.onHighlightsChange(next)
              }
            }
            if (!u.transactions.some((tr) => tr.annotation(externalSync))) {
              const out = toHostEol(current(), eolRef.current)
              rememberEmitted(emittedRef.current, out)
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
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const internal = normalizeEol(props.value)
    const d = decideValueSync(internal, view.state.doc.toString(), composingRef.current || view.composing)
    if (d === 'queue') {
      // Our own typing coming back around is not an external change.
      queuedRef.current = emittedRef.current.includes(props.value) ? null : props.value
      return
    }
    queuedRef.current = null
    eolRef.current = detectEol(props.value, eolRef.current)
    if (d === 'apply') applyValue(view, internal)
  }, [props.value])

  useEffect(() => {
    const view = viewRef.current
    const ro = !!props.readOnly
    if (!view || ro === appliedReadOnlyRef.current) return
    appliedReadOnlyRef.current = ro
    view.dispatch({ effects: readOnlyRef.current.reconfigure(readOnlyExtension(ro)) })
  }, [props.readOnly])

  return <div ref={hostRef} data-component="markdown-editor" />
}
