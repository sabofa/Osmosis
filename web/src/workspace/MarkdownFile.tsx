import { useState } from 'react'
import DocumentTextView from '../components/DocumentTextView'
import ConflictBanner from './ConflictBanner'
import type { FileViewProps } from './fileTypes'
import { useFileDraft } from './useFileDraft'
import { isSaveKey, canSave } from './saveKey'

// The interim editor for a markdown file: read it rendered, or edit it as text
// in the document engine's Markdown editor (host-less for now, so the engine draws
// its own command row). The saving (the
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
        <div
          className="ws-md-edit"
          // Capture, so a save works wherever focus is inside the editor.
          onKeyDownCapture={(e) => {
            if (isSaveKey(e)) {
              e.preventDefault()
              if (canSave(f)) void f.save()
            }
          }}
        >
          <DocumentTextView text={f.draft ?? ''} interaction="edit" onTextChange={f.setDraft} />
        </div>
      ) : (
        <div className="ws-md-view">
          {(f.draft ?? f.saved.body).trim() === '' ? <div className="ws-note">This file is empty.</div> : <DocumentTextView text={f.draft ?? f.saved.body} interaction="annotate" />}
        </div>
      )}
    </div>
  )
}
