// Controlled CodeMirror 6 Markdown editor. The EditorView is created once;
// `value` is synced in with an annotated replace so it never echoes back.
import { useEffect, useRef } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { DocumentHighlight } from '../types'
import { editorExtensions } from './extensions'
import { decideValueSync, remapHighlightsThroughChanges } from './editorSync'

export interface MarkdownEditorProps {
  value: string
  onChange(text: string): void
  onReady?(view: EditorView): void
  highlights?: DocumentHighlight[]
  onHighlightsChange?(h: DocumentHighlight[]): void
  onCompositionChange?(composing: boolean): void
  readOnly?: boolean
  autoFocus?: boolean
}

const externalSync = Annotation.define<boolean>()

function applyValue(view: EditorView, value: string) {
  const sel = view.state.selection.main
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: Math.min(sel.anchor, value.length), head: Math.min(sel.head, value.length) },
    annotations: externalSync.of(true),
  })
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const composingRef = useRef(false)
  const queuedRef = useRef<string | null>(null)
  const highlightsRef = useRef<DocumentHighlight[]>(props.highlights ?? [])
  highlightsRef.current = props.highlights ?? highlightsRef.current

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: propsRef.current.value,
        extensions: [
          editorExtensions({ readOnly: propsRef.current.readOnly }),
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
              setTimeout(() => {
                const q = queuedRef.current
                queuedRef.current = null
                const v = viewRef.current
                if (q !== null && v && decideValueSync(q, v.state.doc.toString(), v.composing) === 'apply') applyValue(v, q)
              }, 0)
              return false
            },
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            const p = propsRef.current
            const oldText = u.startState.doc.toString()
            const newText = u.state.doc.toString()
            const hs = highlightsRef.current
            if (hs.length && p.onHighlightsChange) {
              const next = remapHighlightsThroughChanges(oldText, newText, hs, u.changes)
              if (next) {
                highlightsRef.current = next
                p.onHighlightsChange(next)
              }
            }
            if (!u.transactions.some((tr) => tr.annotation(externalSync))) p.onChange(newText)
          }),
        ],
      }),
    })
    viewRef.current = view
    propsRef.current.onReady?.(view)
    if (propsRef.current.autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const d = decideValueSync(props.value, view.state.doc.toString(), composingRef.current || view.composing)
    if (d === 'queue') queuedRef.current = props.value
    else {
      queuedRef.current = null
      if (d === 'apply') applyValue(view, props.value)
    }
  }, [props.value])

  return <div ref={hostRef} data-component="markdown-editor" />
}
