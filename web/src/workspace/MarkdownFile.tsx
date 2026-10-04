import { useState } from 'react'
import RichText from '../components/RichText'
import ConflictBanner from './ConflictBanner'
import type { FileViewProps } from './fileTypes'
import { useFileDraft } from './useFileDraft'

// The interim editor for a markdown file: read it rendered, or edit it as text
// in a textarea. It is a placeholder: the document engine's views and edit mode
// take its place when they register the "markdown" format. The saving (the
// version an edit started from, the conflict choice, the draft that survives a
// tab switch) is useFileDraft's, the same for every format that Ben and the
// tutor can both write; this is only the markdown view over it.
export default function MarkdownFile({ nodeId, body, version, onSaved }: FileViewProps) {
  const f = useFileDraft({ nodeId, body, version, onSaved })
  // A file left half-edited comes back in the editor.
  const [editing, setEditing] = useState(f.restored)

  function startEditing() {
    f.startDraft()
    setEditing(true)
  }

  function discard() {
    f.discard()
    setEditing(false)
  }

  async function reload() {
    if (await f.reload()) setEditing(false)
  }

  return (
    <div className="ws-markdown">
      <div className="ws-md-bar">
        {editing ? (
          <>
            <button className="ws-btn primary" disabled={f.busy || f.conflict || !f.dirty} onClick={() => void f.save()}>
              {f.busy ? 'Saving…' : 'Save'}
            </button>
            {f.dirty && (
              <button className="ws-btn" disabled={f.busy} onClick={discard}>
                Discard changes
              </button>
            )}
            <button className="ws-btn" onClick={() => setEditing(false)}>
              View
            </button>
          </>
        ) : (
          <button className="ws-btn" onClick={startEditing}>
            Edit
          </button>
        )}
        {f.dirty && <span className="ws-md-flag">Unsaved changes</span>}
        <span className="ws-md-rev">version {f.saved.version}</span>
      </div>

      {f.conflict && (
        <ConflictBanner
          busy={f.busy}
          addition={f.addition}
          onMerge={() => void f.merge()}
          onReload={() => void reload()}
          onOverwrite={() => void f.overwrite()}
        />
      )}
      {f.error && (
        <div className="ws-error" role="alert">
          {f.error}
        </div>
      )}

      {editing ? (
        <textarea
          className="ws-md-text"
          value={f.draft ?? ''}
          spellCheck={false}
          onChange={(e) => f.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              if (f.dirty && !f.busy && !f.conflict) void f.save()
            }
          }}
        />
      ) : (
        <div className="ws-md-view">
          {(f.draft ?? f.saved.body).trim() === '' ? <div className="ws-note">This file is empty.</div> : <RichText text={f.draft ?? f.saved.body} />}
        </div>
      )}
    </div>
  )
}
