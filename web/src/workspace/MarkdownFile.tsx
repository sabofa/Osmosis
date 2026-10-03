import { useEffect, useState } from 'react'
import RichText from '../components/RichText'
import type { FileViewProps } from './fileTypes'
import { getContent, isStale, saveContent } from './wsApi'

// The interim editor for a markdown file: read it rendered, or edit it as text
// in a textarea. Saving names the revision the edit started from; the server
// refuses (409) if the file has moved on since, because the tutor or the
// planner may have written to it, and Ben then chooses between taking their
// version (Reload) and putting his over it (Overwrite).

// Unsaved edits outlive this component: the centre pane unmounts a file's view
// when Ben switches tab, and losing a half-written note to a tab click would
// be worse than anything the frame can do. A draft is dropped when it is saved
// or discarded; otherwise it is waiting here when the file is opened again.
const drafts = new Map<string, { text: string; base: number }>()

export default function MarkdownFile({ nodeId, body, revision, onSaved }: FileViewProps) {
  // What the server holds, as far as this view knows, and the unsaved text.
  const [saved, setSaved] = useState({ body: body ?? '', revision })
  const [draft, setDraft] = useState<string | null>(() => drafts.get(nodeId)?.text ?? null)
  // The revision the draft started from: what a save names as its base.
  const [base, setBase] = useState(() => drafts.get(nodeId)?.base ?? revision)
  const [editing, setEditing] = useState(() => drafts.has(nodeId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const dirty = draft !== null && draft !== saved.body

  useEffect(() => {
    if (dirty && draft !== null) drafts.set(nodeId, { text: draft, base })
    else drafts.delete(nodeId)
  }, [nodeId, dirty, draft, base])

  function startEditing() {
    if (draft === null) {
      setDraft(saved.body)
      setBase(saved.revision)
    }
    setEditing(true)
  }

  function discard() {
    setDraft(null)
    setEditing(false)
    setConflict(false)
    setError(null)
  }

  // Writes the draft as the revision after `from`. A 409 puts up the conflict
  // choice; anything else is shown as it came.
  async function write(from: number) {
    if (draft === null) return
    setBusy(true)
    setError(null)
    try {
      const out = await saveContent(nodeId, draft, from)
      setSaved({ body: draft, revision: out.revision })
      setBase(out.revision)
      setConflict(false)
      onSaved(out.revision)
    } catch (err) {
      if (isStale(err)) setConflict(true)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Overwrite: read where the file is now and save on top of it.
  async function overwrite() {
    setBusy(true)
    setError(null)
    let now
    try {
      now = await getContent(nodeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      return
    }
    await write(now.revision)
  }

  // Reload: take the file as it is now and let the unsaved edit go.
  async function reload() {
    setBusy(true)
    setError(null)
    try {
      const now = await getContent(nodeId)
      setSaved({ body: now.body ?? '', revision: now.revision })
      setBase(now.revision)
      setDraft(null)
      setEditing(false)
      setConflict(false)
      onSaved(now.revision)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ws-markdown">
      <div className="ws-md-bar">
        {editing ? (
          <>
            <button className="ws-btn primary" disabled={busy || conflict || !dirty} onClick={() => void write(base)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button className="ws-btn" disabled={busy} onClick={discard}>
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
        {dirty && <span className="ws-md-flag">Unsaved changes</span>}
        <span className="ws-md-rev">revision {saved.revision}</span>
      </div>

      {conflict && (
        <div className="ws-conflict" role="alert">
          <span>Changed elsewhere — the file moved on since you opened it.</span>
          <button className="ws-btn" disabled={busy} onClick={() => void reload()}>
            Reload
          </button>
          <button className="ws-btn danger" disabled={busy} onClick={() => void overwrite()}>
            Overwrite
          </button>
        </div>
      )}
      {error && (
        <div className="ws-error" role="alert">
          {error}
        </div>
      )}

      {editing ? (
        <textarea
          className="ws-md-text"
          value={draft ?? ''}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              if (dirty && !busy && !conflict) void write(base)
            }
          }}
        />
      ) : (
        <div className="ws-md-view">
          {(draft ?? saved.body).trim() === '' ? <div className="ws-note">This file is empty.</div> : <RichText text={draft ?? saved.body} />}
        </div>
      )}
    </div>
  )
}
