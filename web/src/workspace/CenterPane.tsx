import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { webFileType } from './fileTypes'
import type { Tab } from './tabs'
import { getContent, WsError, type FileContent } from './wsApi'

// The centre of the shell: the active tab's file. It reads the file's content,
// looks its type up in the web registry and renders that type's View. A type
// the registry does not have is not an error (the server may know types this
// build has not learned): the body is shown as plain text under a note.

type Loaded = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ok'; content: FileContent }

export default function CenterPane({ tab, onCloseTab }: { tab: Tab | null; onCloseTab(nodeId: string): void }) {
  if (!tab) return <div className="ws-center ws-empty">Open a file from the sidebar.</div>
  // Keyed by the file, so switching tabs starts a fresh read.
  return <FileFrame key={tab.nodeId} tab={tab} onCloseTab={onCloseTab} />
}

function FileFrame({ tab, onCloseTab }: { tab: Tab; onCloseTab(nodeId: string): void }) {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    getContent(tab.nodeId)
      .then((content) => live && setState({ status: 'ok', content }))
      .catch((error) => live && setState({ status: 'error', error }))
    return () => {
      live = false
    }
  }, [tab.nodeId, attempt])

  if (state.status === 'loading') return <div className="ws-center ws-empty">Loading…</div>

  if (state.status === 'error') {
    const gone = state.error instanceof WsError && state.error.status === 404
    return (
      <div className="ws-center ws-empty">
        <p>{gone ? 'This file is gone.' : state.error instanceof Error ? state.error.message : String(state.error)}</p>
        <div className="ws-actions">
          {!gone && (
            <button className="ws-btn" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          )}
          <button className="ws-btn" onClick={() => onCloseTab(tab.nodeId)}>
            Close tab
          </button>
        </div>
      </div>
    )
  }

  const { content } = state
  const fileType = webFileType(content.type)
  if (!fileType) {
    return (
      <div className="ws-center ws-fallback">
        <p>{`Can't show files of type "${content.type}" yet.`}</p>
        <pre className="ws-raw">{content.body ?? ''}</pre>
      </div>
    )
  }
  const View = fileType.View
  return (
    <div className="ws-center">
      <ViewBoundary>
        <View
          nodeId={tab.nodeId}
          type={content.type}
          body={content.body}
          assetId={content.asset_id}
          revision={content.revision}
          onSaved={(revision) => setState((s) => (s.status === 'ok' ? { status: 'ok', content: { ...s.content, revision } } : s))}
        />
      </ViewBoundary>
    </div>
  )
}

// A view that throws while rendering leaves the rest of the shell standing:
// without this React would unmount the whole app.
class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('workspace file view failed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <div className="ws-empty ws-error-text">This file could not be shown: {this.state.error.message}</div>
    return this.props.children
  }
}
