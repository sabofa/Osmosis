import { useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { Glyph } from './Tree'
import { purgeBody, purgeProblem, restoreNotice } from './trash'
import { listTrash, purgeNode, restoreNode, type NodeSummary } from './wsApi'

// The trash, in the picker: every node that was destroyed, newest first, each
// with Restore and Purge. Restore brings it back with its placements (any whose
// name was taken meanwhile are renamed, and the notice says so). Purge deletes
// it for good, so it asks first; the server refuses to purge the file of an
// upload that still exists, and that refusal says where the upload is deleted.
// Restoring a container does not restore what was destroyed together with it
// (destroy "with orphans"): those stay here, to be restored one by one.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export default function TrashSection({
  // Something came back, so the picker's own lists (tracks, courses, unplaced)
  // may have changed.
  onRestored,
}: {
  onRestored(): void
}) {
  const [items, setItems] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState<NodeSummary | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    listTrash()
      .then((rows) => {
        if (!live) return
        setItems(rows)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [version])

  async function restore(node: NodeSummary) {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const out = await restoreNode(node.id)
      setNotice(restoreNotice(node.title, out.renamed))
      setVersion((v) => v + 1)
      onRestored()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function purge(node: NodeSummary) {
    setPurging(null)
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await purgeNode(node.id)
      setNotice(`Deleted "${node.title}" permanently.`)
      setVersion((v) => v + 1)
    } catch (err) {
      setError(purgeProblem(err, node.title))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ws-pick-section">
      <h2>Trash</h2>
      {notice && (
        <div className="ws-notice info" role="status">
          <span>{notice}</span>
          <button className="ws-link" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="ws-error ws-trash-error" role="alert">
          {error}
        </div>
      )}
      {!items && !error && <div className="ws-note">Loading…</div>}
      {items && items.length === 0 && <div className="ws-note">The trash is empty.</div>}
      {items && items.length > 0 && (
        <ul className="ws-pick-list">
          {items.map((n) => (
            <li key={n.id}>
              <div className="ws-pick-row">
                <span className="ws-glyph">
                  <Glyph node={n} />
                </span>
                <span className="ws-pick-title">{n.title}</span>
                <span className="ws-pick-type">{n.type ?? n.kind}</span>
                {n.trashed_at && <span className="ws-pick-type">{n.trashed_at.slice(0, 10)}</span>}
                <button className="ws-btn" disabled={busy} onClick={() => void restore(n)}>
                  Restore
                </button>
                <button className="ws-btn" disabled={busy} onClick={() => setPurging(n)}>
                  Purge…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {purging && (
        <ConfirmDialog
          title={`Permanently delete "${purging.title}"?`}
          body={purgeBody(purging.kind)}
          confirmLabel="Delete permanently"
          danger
          onCancel={() => setPurging(null)}
          onConfirm={() => void purge(purging)}
        />
      )}
    </section>
  )
}
