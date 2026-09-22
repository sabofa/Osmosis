import { useEffect, useState } from 'react'
import { getAdminStatus, reindex, clearData, restartNode, checkUpdate, startUpdate, waitForNode, type AdminStatus, type ClearScope, type UpdateCheck } from '../../lib/api'
import ConfirmDialog from '../ConfirmDialog'

// Administration: what is on this node, the search index, wiping what the
// learner did (never the bank), restarting, and updating from the checkout.
const SCOPES: { scope: ClearScope; title: string; sub: string }[] = [
  { scope: 'attempts', title: 'Attempts', sub: 'every attempt, response and grade, including daily and live' },
  { scope: 'daily', title: 'Daily history', sub: 'daily draws and their attempts' },
  { scope: 'sessions', title: 'Live sessions', sub: 'tutor sessions, their items and shows' },
  { scope: 'all', title: 'Everything the learner did', sub: 'all of the above plus retention and the outbox' },
]

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function DataSection() {
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ scope: ClearScope } | 'restart' | 'update' | null>(null)
  const [update, setUpdate] = useState<UpdateCheck | null>(null)

  function refresh() {
    getAdminStatus().then(setStatus).catch((err) => setError(String(err)))
  }
  useEffect(refresh, [])

  async function doReindex() {
    setBusy('reindex')
    try {
      const r = await reindex()
      setNote(`Search index rebuilt over ${r.fts_rows} questions.`)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  async function doClear(scope: ClearScope) {
    setConfirm(null)
    setBusy('clear')
    try {
      const r = await clearData(scope)
      const total = Object.values(r.deleted).reduce((a, b) => a + b, 0)
      setNote(`Cleared ${scope}: ${total} rows.`)
      refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  async function doRestart() {
    setConfirm(null)
    setBusy('restart')
    setNote('Restarting…')
    try {
      await restartNode()
    } catch {
      /* the connection drops as it restarts */
    }
    if (await waitForNode(60)) window.location.reload()
    else setNote('The node has not come back yet — give it a moment and refresh.')
    setBusy(null)
  }

  async function doCheck() {
    setBusy('check')
    try {
      setUpdate(await checkUpdate())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  async function doUpdate() {
    setConfirm(null)
    setBusy('update')
    try {
      const r = await startUpdate()
      setNote(r.message)
      if (r.started) {
        setNote(`${r.message} Waiting for it to come back — this can take a minute or two.`)
        if (await waitForNode(240)) window.location.reload()
        else setNote('Still building. Refresh in a little while.')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Data and administration</div>

      {error && <div className="settings-note warn">{error}</div>}
      {note && <div className="settings-note">{note}</div>}

      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">This node</div>
          <div className="settings-row-sub">
            {status ? `${status.node} · ${status.role} · ${bytes(status.db_bytes)} · ${status.db_path}` : 'loading…'}
          </div>
        </div>
        <button className="settings-btn" onClick={refresh}>
          Refresh
        </button>
      </div>
      {status && (
        <div className="admin-counts">
          {Object.entries(status.counts).map(([table, n]) => (
            <div className="admin-count" key={table}>
              <div className="admin-count-n">{n}</div>
              <div className="admin-count-label">{table.replace(/_/g, ' ')}</div>
            </div>
          ))}
        </div>
      )}

      <div className="settings-row">
        <div className="settings-row-main">
          <div>
            <div className="settings-row-title">Search index</div>
            <div className="settings-row-sub">rebuild the full-text index and refresh query statistics</div>
          </div>
        </div>
        <button className="settings-btn" disabled={busy !== null} onClick={doReindex}>
          {busy === 'reindex' ? 'Rebuilding…' : 'Reindex'}
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-main">
          <div>
            <div className="settings-row-title">Restart Osmosis</div>
            <div className="settings-row-sub">off and on again; back in a few seconds</div>
          </div>
        </div>
        <button className="settings-btn" disabled={busy !== null} onClick={() => setConfirm('restart')}>
          {busy === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-main">
          <div>
            <div className="settings-row-title">Update Osmosis</div>
            <div className="settings-row-sub">
              {update
                ? update.error
                  ? update.error
                  : update.behind === 0
                    ? `up to date · ${update.local?.commit.slice(0, 7)} on ${update.branch}${update.dirty ? ' · uncommitted changes' : ''}`
                    : `${update.behind} commit${update.behind === 1 ? '' : 's'} behind origin/${update.branch}`
                : 'pull the latest from the checkout, rebuild, restart — your data stays'}
            </div>
          </div>
        </div>
        <div className="settings-btn-row">
          <button className="settings-btn" disabled={busy !== null} onClick={doCheck}>
            {busy === 'check' ? 'Checking…' : 'Check'}
          </button>
          {update && !update.error && update.behind > 0 && (
            <button className="settings-btn primary" disabled={busy !== null || update.dirty} onClick={() => setConfirm('update')}>
              {busy === 'update' ? 'Updating…' : 'Update'}
            </button>
          )}
        </div>
      </div>
      {update && update.changes.length > 0 && (
        <div className="admin-changes">
          {update.changes.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
      )}

      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">Clear data</div>
          <div className="settings-row-sub">deletes what the learner did on this node — never questions, tags, tests, documents or themes</div>
        </div>
      </div>
      {SCOPES.map((s) => (
        <div className="settings-row" key={s.scope}>
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">{s.title}</div>
              <div className="settings-row-sub">{s.sub}</div>
            </div>
          </div>
          <button className="settings-btn danger" disabled={busy !== null} onClick={() => setConfirm({ scope: s.scope })}>
            Clear
          </button>
        </div>
      ))}

      {confirm && confirm !== 'restart' && confirm !== 'update' && (
        <ConfirmDialog
          title={`Clear ${SCOPES.find((s) => s.scope === confirm.scope)?.title.toLowerCase()}?`}
          body="This cannot be undone. The bank itself is untouched."
          confirmLabel="Clear"
          danger
          typeToConfirm="CLEAR"
          onConfirm={() => doClear(confirm.scope)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'restart' && (
        <ConfirmDialog title="Restart this Osmosis node?" body="It is back in a few seconds; this page reloads." confirmLabel="Restart" onConfirm={doRestart} onCancel={() => setConfirm(null)} />
      )}
      {confirm === 'update' && update && (
        <ConfirmDialog
          title={`Update by ${update.behind} commit${update.behind === 1 ? '' : 's'}?`}
          body={`${update.changes.slice(0, 8).join('\n')}\n\nThe node pulls, rebuilds and restarts. Your data is untouched.`}
          confirmLabel="Update"
          onConfirm={doUpdate}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
