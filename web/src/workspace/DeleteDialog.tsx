import { useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { deleteBody, orphanLabel } from './archive'
import { deleteNode, getDeletePreview, type DeletePreview, type NodeSummary } from './wsApi'

// Delete…, from wherever a node has a row: the sidebar's tree and the picker's
// lists. It asks the server what deleting would take (where the node appears,
// and how many items are placed only inside it), shows that in a confirm with
// the choice to take those items too, and deletes: the node goes to the Archive,
// everywhere. The caller says what to do afterwards (the sidebar closes tabs and
// reloads its lists, the picker reloads its own), and hears of a refusal, in the
// server's words, through onError. Nothing is shown until the preview is back,
// and nothing again once Delete is pressed, so it cannot be pressed twice.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export default function DeleteDialog({
  node,
  name,
  onDone,
  onError,
  onCancel,
}: {
  node: NodeSummary
  // What the row calls it (a placement's name, or the title).
  name: string
  // The ids that went to the Archive: the node, and the orphans if they were taken too.
  onDone(archived: string[]): void
  onError(message: string): void
  onCancel(): void
}) {
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [alsoOrphans, setAlsoOrphans] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let live = true
    getDeletePreview(node.id)
      .then((p) => live && setPreview(p))
      .catch((err) => live && onError(messageOf(err)))
    return () => {
      live = false
    }
    // The preview is of this node; the callbacks are only for its outcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  async function confirm() {
    if (!preview) return
    setDeleting(true)
    try {
      const out = await deleteNode(node.id, alsoOrphans)
      onDone(out.archived)
    } catch (err) {
      onError(messageOf(err))
    }
  }

  if (!preview || deleting) return null
  const orphans = preview.orphans.length
  return (
    <ConfirmDialog
      title={`Delete "${name}"?`}
      body={deleteBody(node.kind, preview.appears_in, orphans)}
      confirmLabel="Delete"
      danger
      onCancel={onCancel}
      onConfirm={() => void confirm()}
    >
      {orphans > 0 && (
        <label className="ws-check">
          <input type="checkbox" checked={alsoOrphans} onChange={(e) => setAlsoOrphans(e.target.checked)} />
          <span>{orphanLabel(orphans)}</span>
        </label>
      )}
    </ConfirmDialog>
  )
}
