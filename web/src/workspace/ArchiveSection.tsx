import { useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  chosenByDefault,
  matesNotice,
  matesOffer,
  purgeBody,
  purgeProblem,
  restoreChoices,
  restoreNotice,
  restoreSummary,
  type RestoreChoice,
} from './archive'
import { Glyph } from './Tree'
import { getArchive, getArchivedPlacements, purgeNode, restoreNode, type NodeSummary } from './wsApi'

// The Archive, in the picker: every node that was deleted, newest first, each
// with Restore and Purge. Restore asks which of the node's former places come
// back, as a checklist: a place whose container is still archived is shown as
// "comes back when <container> is restored" (it stays marked and revives with
// that container), and a place left unticked is forgotten. After a restore, what
// was deleted together with the node (its orphans) is offered back in one go.
// Purge deletes for good, so it asks first; the server refuses to purge the file
// of an upload that still exists, and that refusal says where the upload is
// deleted.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// The restore being decided: the node, its checklist, and what is ticked.
interface Choosing {
  node: NodeSummary
  choices: RestoreChoice[]
  chosen: string[]
}

export default function ArchiveSection({
  // Something came back, so the picker's own lists (trajectories, tracks,
  // courses, unplaced) may have changed.
  onRestored,
}: {
  onRestored(): void
}) {
  const [items, setItems] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState<NodeSummary | null>(null)
  const [choosing, setChoosing] = useState<Choosing | null>(null)
  // What was deleted with the node just restored, still archived.
  const [mates, setMates] = useState<NodeSummary[] | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    getArchive()
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

  // Runs one action with the buttons held and the old messages cleared.
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const refresh = () => {
    setVersion((v) => v + 1)
    onRestored()
  }

  // Restore, step one: look up the former places and ask which come back.
  const startRestore = (node: NodeSummary) =>
    run(async () => {
      setMates(null)
      const choices = restoreChoices(await getArchivedPlacements(node.id))
      setChoosing({ node, choices, chosen: chosenByDefault(choices) })
    })

  // Step two: restore with exactly the ticked places.
  const restore = () =>
    run(async () => {
      const c = choosing
      if (!c) return
      setChoosing(null)
      const out = await restoreNode(c.node.id, c.chosen)
      setNotice(restoreNotice(c.node, out))
      setMates(out.batch_mates.length > 0 ? out.batch_mates : null)
      refresh()
    })

  // "Also restore N deleted with it": each comes back with every place it had,
  // none left behind. The order does not matter: a place inside one that is
  // still archived waits and revives when that one is restored.
  const restoreMates = () =>
    run(async () => {
      const list = mates ?? []
      setMates(null)
      const done: { title: string; out: Awaited<ReturnType<typeof restoreNode>> }[] = []
      const failed: { title: string; message: string }[] = []
      for (const m of list) {
        try {
          const places = await getArchivedPlacements(m.id)
          done.push({ title: m.title, out: await restoreNode(m.id, places.map((p) => p.placement_id)) })
        } catch (err) {
          failed.push({ title: m.title, message: messageOf(err) })
        }
      }
      setNotice(matesNotice(done, failed))
      refresh()
    })

  const purge = (node: NodeSummary) =>
    run(async () => {
      setPurging(null)
      try {
        await purgeNode(node.id)
      } catch (err) {
        throw new Error(purgeProblem(err, node.title))
      }
      setNotice(`Deleted "${node.title}" permanently.`)
      setVersion((v) => v + 1)
    })

  const toggle = (id: string) =>
    setChoosing((c) => (c ? { ...c, chosen: c.chosen.includes(id) ? c.chosen.filter((x) => x !== id) : [...c.chosen, id] } : c))

  return (
    <section className="ws-pick-section">
      <h2>Archive</h2>
      {notice && (
        <div className="ws-notice info" role="status">
          <span>{notice}</span>
          <button className="ws-link" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {mates && (
        <div className="ws-notice info" role="status">
          <span>{matesOffer(mates)}</span>
          <span className="ws-notice-actions">
            <button className="ws-link" disabled={busy} onClick={() => void restoreMates()}>
              Restore them too
            </button>
            <button className="ws-link" onClick={() => setMates(null)} aria-label="No thanks">
              ×
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="ws-error ws-archive-error" role="alert">
          {error}
        </div>
      )}
      {!items && !error && <div className="ws-note">Loading…</div>}
      {items && items.length === 0 && <div className="ws-note">The Archive is empty.</div>}
      {items && items.length > 0 && (
        <ul className="ws-pick-list">
          {items.map((n) => (
            <li key={n.id}>
              <div className="ws-pick-row">
                <span className="ws-glyph">
                  <Glyph node={n} />
                </span>
                <span className="ws-pick-title">{n.title}</span>
                <span className="ws-pick-type">{n.format ?? n.kind}</span>
                {n.archived_at && <span className="ws-pick-type">{n.archived_at.slice(0, 10)}</span>}
                <button className="ws-btn" disabled={busy} aria-expanded={choosing?.node.id === n.id} onClick={() => void startRestore(n)}>
                  Restore…
                </button>
                <button className="ws-btn" disabled={busy} onClick={() => setPurging(n)}>
                  Purge…
                </button>
              </div>
              {choosing?.node.id === n.id && (
                <div className="ws-existing" role="group" aria-label={`Restore "${n.title}"`}>
                  <div className="ws-existing-head">Restore "{n.title}" to…</div>
                  {choosing.choices.length > 0 && (
                    <ul>
                      {choosing.choices.map((c) => (
                        <li key={c.placementId}>
                          <label className="ws-check">
                            <input type="checkbox" checked={choosing.chosen.includes(c.placementId)} onChange={() => toggle(c.placementId)} />
                            <span>
                              "{c.name}" in "{c.container.title}"{c.note ? `, ${c.note}` : ''}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="ws-note">{restoreSummary(choosing.choices, choosing.chosen, n.kind)}</div>
                  <button className="ws-btn primary" disabled={busy} onClick={() => void restore()}>
                    Restore
                  </button>{' '}
                  <button className="ws-link" onClick={() => setChoosing(null)}>
                    Cancel
                  </button>
                </div>
              )}
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
