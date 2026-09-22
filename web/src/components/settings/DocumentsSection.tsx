import { useEffect, useMemo, useState } from 'react'
import { FolderIcon, GlobeIcon, ClipboardIcon, TrashIcon } from '../icons'
import { listAssets, deleteAsset, getDocumentMarkers, timeAgo, type AssetSummary } from '../../lib/api'
import AssetViewer from '../AssetViewer'
import ConfirmDialog from '../ConfirmDialog'

// The document organiser: everything uploaded or written into the node,
// searchable, grouped by kind, sortable, with how many questions point at
// each. Double-click opens the viewer; delete asks first.
type Sort = 'newest' | 'oldest' | 'title' | 'most-used'
type Kind = 'all' | AssetSummary['type']

export default function DocumentsSection({
  uploadForm,
  onUploadClick,
  uploading,
  refreshKey,
}: {
  uploadForm: React.ReactNode
  onUploadClick: () => void
  uploading: boolean
  refreshKey: number
}) {
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [uses, setUses] = useState<Record<string, number>>({})
  const [deleting, setDeleting] = useState<AssetSummary | null>(null)

  function refresh() {
    listAssets()
      .then((list) => {
        setAssets(list)
        // How many questions anchor to each document — the "in use" count
        // that tells you what a delete would orphan.
        Promise.all(
          list
            .filter((a) => a.type !== 'url')
            .map((a) =>
              getDocumentMarkers(a.id)
                .then((m) => [a.id, m.markers.length] as const)
                .catch(() => [a.id, 0] as const)
            )
        ).then((pairs) => setUses(Object.fromEntries(pairs)))
      })
      .catch((err) => setError(String(err)))
  }

  useEffect(refresh, [refreshKey])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = (assets ?? []).filter((a) => (kind === 'all' || a.type === kind) && (!q || a.title.toLowerCase().includes(q)))
    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'most-used') return (uses[b.id] ?? 0) - (uses[a.id] ?? 0) || b.created_at.localeCompare(a.created_at)
      if (sort === 'oldest') return a.created_at.localeCompare(b.created_at)
      return b.created_at.localeCompare(a.created_at)
    })
    return list
  }, [assets, search, kind, sort, uses])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assets?.length ?? 0, file: 0, text: 0, url: 0 }
    for (const a of assets ?? []) c[a.type] = (c[a.type] ?? 0) + 1
    return c
  }, [assets])

  async function confirmDelete() {
    if (!deleting) return
    try {
      await deleteAsset(deleting.id)
      setAssets((prev) => prev?.filter((a) => a.id !== deleting.id) ?? prev)
    } catch (err) {
      setError(String(err))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Documents</div>
      <div className="settings-row">
        <div className="settings-row-main">
          <FolderIcon size={16} />
          <div>
            <div className="settings-row-title">Library of sources</div>
            <div className="settings-row-sub">files, pasted text and links that questions anchor to</div>
          </div>
        </div>
        {!uploading && (
          <button className="settings-btn" onClick={onUploadClick}>
            + Upload
          </button>
        )}
      </div>
      {uploadForm}

      <div className="docs-toolbar">
        <input className="docs-search" placeholder="Search titles…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="theme-toggle">
          {(['all', 'file', 'text', 'url'] as Kind[]).map((k) => (
            <button key={k} className={`theme-toggle-btn${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {k === 'all' ? 'All' : k === 'file' ? 'Files' : k === 'text' ? 'Text' : 'Links'} {counts[k] ? <span className="docs-count">{counts[k]}</span> : null}
            </button>
          ))}
        </div>
        <select className="docs-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
          <option value="most-used">Most used</option>
        </select>
      </div>

      {error && <div className="bank-empty">Could not reach the local node: {error}</div>}
      {assets === null && !error && <div className="bank-empty">Loading…</div>}
      {assets && assets.length === 0 && <div className="bank-empty">No documents yet — upload one, or write over MCP.</div>}
      {assets && assets.length > 0 && shown.length === 0 && <div className="bank-empty">Nothing matches.</div>}

      {shown.length > 0 && (
        <div className="docs-list">
          {shown.map((a) => (
            <div className="docs-row" key={a.id} onDoubleClick={() => setViewing(a.id)} title="Double-click to open">
              <span className="docs-icon">
                {a.type === 'url' ? <GlobeIcon size={13} /> : a.type === 'text' ? <ClipboardIcon size={13} /> : <FolderIcon size={13} />}
              </span>
              <div className="docs-main">
                <div className="docs-title">{a.title}</div>
                <div className="docs-meta">
                  {a.type} · {timeAgo(a.created_at)} · by {a.created_by}
                  {uses[a.id] ? ` · ${uses[a.id]} question${uses[a.id] === 1 ? '' : 's'} point here` : ''}
                </div>
              </div>
              <button className="settings-btn" onClick={() => setViewing(a.id)}>
                Open
              </button>
              <button className="theme-card-icon-btn" onClick={() => setDeleting(a)} aria-label={`Delete ${a.title}`}>
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {viewing && <AssetViewer id={viewing} onClose={() => setViewing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          body={
            uses[deleting.id]
              ? `${uses[deleting.id]} question${uses[deleting.id] === 1 ? '' : 's'} anchor to this document; they keep their text but lose the source.`
              : 'The file and its extracted text are removed from this node.'
          }
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
