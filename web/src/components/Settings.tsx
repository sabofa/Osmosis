import { useEffect, useState } from 'react'
import {
  TagIcon,
  PlugIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  GearIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PaletteIcon,
  PencilIcon,
  TrashIcon,
  GlobeIcon,
  ClipboardIcon,
  FolderIcon,
} from './icons'
import type { useTheme, ThemeChoice } from '../hooks/useTheme'
import type { useThemePresets, ThemePreset } from '../hooks/useThemePresets'
import ThemeEditor from './ThemeEditor'
import {
  getStatus,
  getConfig,
  setConfig,
  timeAgo,
  listAssets,
  uploadAsset,
  deleteAsset,
  getSlices,
  addSlice,
  removeSlice,
  triggerSync,
  type NodeStatus,
  type AssetSummary,
  type LocalSlice,
} from '../lib/api'
import './Settings.css'

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon size={14} /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon size={14} /> },
  { value: 'system', label: 'System', icon: <MonitorIcon size={14} /> },
]

function NumberSetting({
  configKey,
  label,
  sub,
  suffix,
  min = 0,
  max = 3650,
  value,
  onSaved,
  disabled = false,
}: {
  configKey: string
  label: string
  sub: string
  suffix: string
  min?: number
  max?: number
  value: number | null
  onSaved: (key: string, value: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (value !== null) setDraft(String(value))
  }, [value])

  const numeric = Number(draft)
  const dirty = value !== null && draft !== '' && numeric !== value && !Number.isNaN(numeric)
  const inputsDisabled = disabled || value === null

  async function save() {
    if (!dirty || disabled) return
    setSaving(true)
    try {
      await setConfig(configKey, numeric)
      onSaved(configKey, numeric)
    } finally {
      setSaving(false)
    }
  }

  function step(delta: number) {
    const current = Number.isNaN(numeric) ? (value ?? min) : numeric
    const next = Math.min(max, Math.max(min, current + delta))
    setDraft(String(next))
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{label}</div>
        <div className="settings-row-sub">{sub}</div>
      </div>
      <div className="number-setting">
        <div className="number-stepper">
          <input
            type="number"
            className="number-setting-input"
            min={min}
            max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={inputsDisabled}
          />
          <div className="number-stepper-buttons">
            <button
              type="button"
              className="number-stepper-btn"
              disabled={inputsDisabled}
              onClick={() => step(1)}
              aria-label="Increase"
            >
              <ChevronUpIcon size={10} />
            </button>
            <button
              type="button"
              className="number-stepper-btn"
              disabled={inputsDisabled}
              onClick={() => step(-1)}
              aria-label="Decrease"
            >
              <ChevronDownIcon size={10} />
            </button>
          </div>
        </div>
        <span className="number-setting-suffix">{suffix}</span>
        <button className="settings-btn" disabled={disabled || !dirty || saving} onClick={save}>
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function AssetTypeIcon({ type }: { type: AssetSummary['type'] }) {
  if (type === 'url') return <GlobeIcon size={14} />
  if (type === 'text') return <ClipboardIcon size={14} />
  return <FolderIcon size={14} />
}

// The server's POST /api/assets route only accepts a multipart file part and
// always stores the created asset as type "file" (it never reads a `type`
// field) — see server/src/http/apiRoutes.ts. To still let url/text assets be
// created from here, their typed content is packaged as a small text Blob
// under the `file` field, matching what the route actually expects. This is
// a known mismatch with the documented contract (type/content fields), out
// of scope to fix here since it's server-side.
function AssetUploadForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (asset: AssetSummary) => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<AssetSummary['type']>('url')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = title.trim().length > 0 && (type === 'file' ? !!file : content.trim().length > 0)

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('title', title.trim())
      form.set('type', type)
      if (type === 'file' && file) {
        form.set('file', file)
      } else {
        form.set('content', content)
        form.set('file', new Blob([content], { type: 'text/plain' }), `${title.trim() || 'asset'}.txt`)
      }
      const asset = await uploadAsset(form)
      onSaved(asset)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="theme-editor asset-upload-form">
      <input
        className="theme-editor-name"
        placeholder="Asset title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="theme-mode-tabs">
        <button type="button" className={`theme-mode-tab${type === 'url' ? ' active' : ''}`} onClick={() => setType('url')}>
          <GlobeIcon size={13} />
          URL
        </button>
        <button type="button" className={`theme-mode-tab${type === 'text' ? ' active' : ''}`} onClick={() => setType('text')}>
          <ClipboardIcon size={13} />
          Text
        </button>
        <button type="button" className={`theme-mode-tab${type === 'file' ? ' active' : ''}`} onClick={() => setType('file')}>
          <FolderIcon size={13} />
          File
        </button>
      </div>

      {type === 'url' && (
        <input
          className="theme-editor-name"
          placeholder="https://…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      {type === 'text' && (
        <textarea
          className="css-editor asset-upload-textarea"
          placeholder="Paste text…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      {type === 'file' && (
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      )}

      {error && <div className="bank-empty">{error}</div>}

      <div className="theme-editor-actions">
        <button className="settings-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="settings-btn primary" onClick={save} disabled={!canSave || saving}>
          {saving ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </div>
  )
}

function AssetsSection() {
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  function refresh() {
    listAssets()
      .then(setAssets)
      .catch((err) => setError(String(err)))
  }

  useEffect(refresh, [])

  async function handleDelete(id: string) {
    try {
      await deleteAsset(id)
      setAssets((prev) => prev?.filter((a) => a.id !== id) ?? prev)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Assets</div>
      <div className="settings-row">
        <div className="settings-row-main">
          <FolderIcon size={16} />
          <div>
            <div className="settings-row-title">Documents</div>
            <div className="settings-row-sub">urls, text snippets, and files referenced by questions</div>
          </div>
        </div>
        {!uploading && (
          <button className="settings-btn" onClick={() => setUploading(true)}>
            + Upload
          </button>
        )}
      </div>

      {uploading && (
        <AssetUploadForm
          onCancel={() => setUploading(false)}
          onSaved={(asset) => {
            setAssets((prev) => (prev ? [asset, ...prev] : [asset]))
            setUploading(false)
          }}
        />
      )}

      {error && <div className="bank-empty">Could not reach the local node: {error}</div>}
      {assets === null && !error && <div className="bank-empty">Loading…</div>}
      {assets && assets.length === 0 && <div className="bank-empty">No assets yet.</div>}
      {assets && assets.length > 0 && (
        <div className="theme-list">
          {assets.map((a) => (
            <div className="theme-card" key={a.id}>
              <div className="theme-card-main">
                <AssetTypeIcon type={a.type} />
                <span className="theme-card-name">{a.title}</span>
              </div>
              <span className="settings-row-sub" style={{ flexShrink: 0 }}>
                {a.created_at.slice(0, 10)}
              </span>
              <button className="theme-card-icon-btn" onClick={() => handleDelete(a.id)} aria-label="Delete asset">
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Settings({
  theme: themeApi,
  themePresets,
}: {
  theme: ReturnType<typeof useTheme>
  themePresets: ReturnType<typeof useThemePresets>
}) {
  const { theme, setTheme, resolvedMode } = themeApi
  const { themes, activeId, setActiveId, saveTheme, deleteTheme } = themePresets
  const [editing, setEditing] = useState<ThemePreset | null | 'new'>(null)
  const [status, setStatus] = useState<NodeStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [config, setConfigState] = useState<Record<string, unknown> | null>(null)
  const [showDead, setShowDead] = useState(false)
  const [slices, setSlices] = useState<LocalSlice[] | null>(null)
  const [addingSlice, setAddingSlice] = useState(false)
  const [newSlice, setNewSlice] = useState('')
  const [syncing, setSyncing] = useState(false)

  function refreshSlices() {
    getSlices()
      .then((r) => setSlices(r.slices))
      .catch(() => {})
  }

  useEffect(() => {
    getStatus()
      .then(setStatus)
      .catch((err) => setStatusError(String(err)))
    getConfig()
      .then(setConfigState)
      .catch(() => {})
    refreshSlices()
  }, [])

  async function handleAddSlice() {
    const slug = newSlice.trim()
    if (!slug) return
    try {
      await addSlice(slug)
      setAddingSlice(false)
      setNewSlice('')
      refreshSlices()
    } catch {
      // silently ignore; error UI is future work
    }
  }

  async function handleRemoveSlice(slug: string) {
    try {
      await removeSlice(slug)
      refreshSlices()
    } catch {
      // silently ignore; error UI is future work
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      await triggerSync()
      await getStatus().then(setStatus)
    } catch {
      // silently ignore; error UI is future work
    } finally {
      setSyncing(false)
    }
  }

  // A canonical node *is* the bank — it holds no slices, and the server
  // rejects slice add/remove on it outright. Don't offer the controls.
  const isCanonical = status?.canonical === true

  const protocolCurrent = status ? status.remote_protocol_version === null || status.remote_protocol_version === status.protocol_version : true
  const lastSync = status ? (status.last_push_at ?? status.last_pull_at) : null

  return (
    <div className="settings">
      <h1>Settings</h1>
      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-row-main">
            <GearIcon size={16} />
            <div>
              <div className="settings-row-title">Node</div>
              <div className="settings-row-sub">
                {status
                  ? `${status.node.label} · ${status.node.canonical ? 'canonical' : 'local'} · ${status.node.id.slice(0, 8)}`
                  : 'loading…'}
              </div>
            </div>
          </div>
          <span style={{ fontSize: 11, color: status?.online ? 'var(--good)' : 'var(--bad)' }}>
            {status ? (status.online ? 'online' : 'offline') : '—'}
          </span>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <TagIcon size={16} />
            <div>
              <div className="settings-row-title">Slices</div>
              <div className="settings-row-sub">
                {isCanonical
                  ? 'canonical node — holds the whole bank, not a slice'
                  : slices
                    ? slices.length > 0
                      ? `${slices.length} held locally`
                      : 'none held locally'
                    : 'loading…'}
              </div>
            </div>
          </div>
          {!isCanonical && !addingSlice && (
            <button className="settings-btn" onClick={() => setAddingSlice(true)}>
              + Add
            </button>
          )}
        </div>

        {!isCanonical && addingSlice && (
          <div className="theme-editor">
            <input
              className="theme-editor-name"
              placeholder="tag slug…"
              autoFocus
              value={newSlice}
              onChange={(e) => setNewSlice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSlice()
                if (e.key === 'Escape') {
                  setAddingSlice(false)
                  setNewSlice('')
                }
              }}
            />
            <div className="theme-editor-actions">
              <button
                className="settings-btn"
                onClick={() => {
                  setAddingSlice(false)
                  setNewSlice('')
                }}
              >
                Cancel
              </button>
              <button className="settings-btn primary" disabled={!newSlice.trim()} onClick={handleAddSlice}>
                Add
              </button>
            </div>
          </div>
        )}

        {!isCanonical && slices && slices.length > 0 && (
          <div className="theme-list">
            {slices.map((s) => (
              <div className="theme-card" key={s.tag_slug}>
                <div className="theme-card-main">
                  <TagIcon size={13} />
                  <span className="theme-card-name">{s.tag_slug}</span>
                </div>
                <span className="settings-row-sub" style={{ flexShrink: 0 }}>
                  {s.question_count} questions
                </span>
                <button
                  className="theme-card-icon-btn"
                  onClick={() => handleRemoveSlice(s.tag_slug)}
                  aria-label={`Remove slice ${s.tag_slug}`}
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="settings-row">
          <div className="settings-row-main">
            <PlugIcon size={16} />
            <div>
              <div className="settings-row-title">Outbox</div>
              <div className="settings-row-sub">
                {status ? `${status.outbox_depth} pending · ${status.dead_outbox_depth} dead` : statusError ? 'unreachable' : 'loading…'}
              </div>
            </div>
          </div>
          {status && status.dead_outbox_depth > 0 ? (
            <button className="settings-btn" onClick={() => setShowDead((v) => !v)}>
              {showDead ? 'Hide' : 'Review'}
            </button>
          ) : (
            <button className="settings-btn primary" disabled={syncing} onClick={handleSync}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
        {showDead && status && status.dead_outbox.length > 0 && (
          <div className="dead-outbox-list">
            {status.dead_outbox.map((row) => (
              <div className="dead-outbox-row" key={row.id}>
                <span className="dead-outbox-entity">
                  {row.entity_type} {row.entity_id.slice(0, 8)}
                </span>
                <span className="dead-outbox-error">{row.last_error ?? 'unknown error'}</span>
                <span className="dead-outbox-tries">{row.tries} tries</span>
              </div>
            ))}
          </div>
        )}

        <NumberSetting
          configKey="synced_attempt_retention_days"
          label="Retention"
          sub="keep synced attempts for"
          suffix="days"
          min={0}
          max={3650}
          value={config ? (config.synced_attempt_retention_days as number) : null}
          onSaved={(key, value) => setConfigState((c) => (c ? { ...c, [key]: value } : c))}
        />

        <NumberSetting
          configKey="daily_quiz_size"
          label="Daily quiz size"
          sub="questions in the daily quiz"
          suffix="questions"
          min={1}
          max={100}
          value={config ? (config.daily_quiz_size as number) : null}
          onSaved={(key, value) => setConfigState((c) => (c ? { ...c, [key]: value } : c))}
        />

        <div className="settings-row quiet">
          <div>
            <div className="settings-row-title">Protocol</div>
            <div className="settings-row-sub">
              {status
                ? `local v${status.protocol_version}${status.remote_protocol_version ? ` · remote v${status.remote_protocol_version}` : ' · remote unknown'}`
                : 'loading…'}
            </div>
          </div>
          <span style={{ fontSize: 11, color: protocolCurrent ? 'var(--good)' : 'var(--bad)' }}>
            {status ? (protocolCurrent ? 'up to date' : 'mismatch') : '—'}
          </span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <div className="settings-row">
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">Mode</div>
              <div className="settings-row-sub">system follows your OS setting</div>
            </div>
          </div>
          <div className="theme-toggle">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`theme-toggle-btn${theme === opt.value ? ' active' : ''}`}
                onClick={() => setTheme(opt.value)}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-main">
            <PaletteIcon size={16} />
            <div>
              <div className="settings-row-title">Themes</div>
              <div className="settings-row-sub">named palettes layered on top of the mode above</div>
            </div>
          </div>
          {editing === null && (
            <button className="settings-btn" onClick={() => setEditing('new')}>
              + New theme
            </button>
          )}
        </div>

        {editing !== null ? (
          <ThemeEditor
            initial={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={(t) => {
              saveTheme(t)
              setActiveId(t.id)
              setEditing(null)
            }}
          />
        ) : (
          <div className="theme-list">
            <button className={`theme-card${activeId === null ? ' active' : ''}`} onClick={() => setActiveId(null)}>
              <span className="theme-card-swatches">
                <span className="theme-swatch" style={{ background: 'var(--accent)' }} />
                <span className="theme-swatch" style={{ background: 'var(--surface)' }} />
                <span className="theme-swatch" style={{ background: 'var(--ink)' }} />
              </span>
              <span className="theme-card-name">None (mode only)</span>
            </button>
            {themes.map((t) => (
              <div className={`theme-card${activeId === t.id ? ' active' : ''}`} key={t.id}>
                <button className="theme-card-main" onClick={() => setActiveId(t.id)}>
                  <span className="theme-card-swatches">
                    <span className="theme-swatch" style={{ background: t.tokens[resolvedMode]['--accent'] ?? 'var(--accent)' }} />
                    <span className="theme-swatch" style={{ background: t.tokens[resolvedMode]['--surface'] ?? 'var(--surface)' }} />
                    <span className="theme-swatch" style={{ background: t.tokens[resolvedMode]['--ink'] ?? 'var(--ink)' }} />
                  </span>
                  <span className="theme-card-name">{t.name}</span>
                </button>
                <button className="theme-card-icon-btn" onClick={() => setEditing(t)} aria-label="Edit theme">
                  <PencilIcon size={12} />
                </button>
                <button className="theme-card-icon-btn" onClick={() => deleteTheme(t.id)} aria-label="Delete theme">
                  <TrashIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Grading</div>
        <div className="settings-row">
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">Written grading</div>
              <div className="settings-row-sub">
                {isCanonical
                  ? config
                    ? config.written_grader === 'model_when_online'
                      ? 'model grades written answers when online'
                      : 'self-graded only'
                    : 'loading…'
                  : 'set on the canonical node'}
              </div>
            </div>
          </div>
          <div className="theme-toggle">
            {(['self_only', 'model_when_online'] as const).map((mode) => (
              <button
                key={mode}
                className={`theme-toggle-btn${config?.written_grader === mode ? ' active' : ''}`}
                disabled={!isCanonical}
                onClick={async () => {
                  if (!isCanonical) return
                  await setConfig('written_grader', mode)
                  setConfigState((c) => (c ? { ...c, written_grader: mode } : c))
                }}
              >
                {mode === 'self_only' ? 'Self only' : 'Model when online'}
              </button>
            ))}
          </div>
        </div>

        <NumberSetting
          configKey="model_grader_daily_limit"
          label="Daily grading cap"
          sub={isCanonical ? 'max DeepSeek calls per rolling 24h' : 'set on the canonical node'}
          suffix="grades/day"
          min={0}
          max={1000}
          value={config ? (config.model_grader_daily_limit as number) : null}
          onSaved={(key, value) => setConfigState((c) => (c ? { ...c, [key]: value } : c))}
          disabled={!isCanonical}
        />

        <div className="settings-row">
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">Grading usage</div>
              <div className="settings-row-sub">
                {status
                  ? status.model_grading_configured
                    ? `${status.model_grades_today} of ${config ? (config.model_grader_daily_limit as number) : '—'} used today`
                    : 'not configured (no DEEPSEEK_API_KEY set)'
                  : 'loading…'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AssetsSection />

      <div className="settings-sync">
        <span className="dot" />
        synced {timeAgo(lastSync)}
      </div>
    </div>
  )
}
