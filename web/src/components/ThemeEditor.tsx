import { useEffect, useRef, useState } from 'react'
import { DEFAULT_DIALS, DEFAULT_SEEDS, FONT_STACKS, resolve } from 'theme-core'
import type { FontRole, LayerKind, Mode, StackName, ThemeManifest } from 'theme-core'
import type { ThemePreset } from '../hooks/useThemePresets'
import { useThemePresets } from '../hooks/useThemePresets'
import { XIcon, SunIcon, MoonIcon } from './icons'
import {
  startManifest,
  setSeed,
  setDial,
  setFont,
  setCss,
  setName,
  setLayer,
  dialVisible,
  seedsVisible,
  fontVisible,
  layerNote,
  countOverrides,
  clearOverrides,
  reportFor,
  type SeedKey,
  type DialKey,
} from './themeEditorModel'
import './ThemeEditor.css'

const SEED_FIELDS: { key: SeedKey; label: string }[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'surface', label: 'Surface' },
  { key: 'ink', label: 'Ink' },
  { key: 'accent', label: 'Accent' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'good', label: 'Good' },
  { key: 'bad', label: 'Bad' },
]

const UNIT_DIALS: DialKey[] = [
  'contrast', 'saturation', 'roundness', 'density', 'elevation', 'borders', 'translucency', 'motion',
]

const FONT_ROLES: FontRole[] = ['display', 'body', 'mono', 'math']

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// Expand #abc so <input type=color> accepts it.
const toSix = (h: string) => (/^#[0-9a-f]{3}$/i.test(h) ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h)

function SeedRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value: string | undefined
  fallback: string
  onChange: (v: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value ?? ''
  return (
    <div className="theme-token-row">
      <div className="theme-token-info">
        <div className="theme-token-label">{label}</div>
        {value === undefined && <div className="theme-token-hint">derived</div>}
      </div>
      <input
        type="color"
        className="theme-token-swatch"
        value={toSix(HEX_RE.test(value ?? '') ? (value as string) : fallback)}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="theme-token-hex"
        placeholder="derived"
        value={shown}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          if (HEX_RE.test(v.trim())) onChange(v.trim())
        }}
        onBlur={() => setDraft(null)}
      />
      <button
        type="button"
        className="theme-token-clear"
        disabled={value === undefined}
        onClick={() => {
          setDraft(null)
          onChange('')
        }}
        aria-label={`Reset ${label}`}
        title="Derive this colour"
      >
        <XIcon size={11} />
      </button>
    </div>
  )
}

export default function ThemeEditor({
  initial,
  builtinSource,
  onSave,
  onCancel,
}: {
  initial: ThemePreset | null
  builtinSource?: ThemePreset
  onSave: (manifest: ThemeManifest) => void
  onCancel: () => void
}) {
  const { previewManifest } = useThemePresets()
  const [manifest, setManifest] = useState<ThemeManifest>(() => startManifest(initial, builtinSource))
  const [mode, setMode] = useState<Mode>('light')
  const [derive, setDerive] = useState<boolean>(() => {
    if (!initial) return true
    const m = initial.manifest
    if (!m) return false
    return Object.keys(m.seeds.dark ?? {}).length === 0 || Object.keys(m.seeds.light ?? {}).length === 0
  })

  // Live preview; always released on unmount.
  const previewRef = useRef(previewManifest)
  previewRef.current = previewManifest
  useEffect(() => {
    try {
      resolve(manifest)
      previewRef.current(manifest)
    } catch {
      // keep the last good preview
    }
  }, [manifest])
  useEffect(() => () => previewRef.current(null), [])

  const report = reportFor(manifest)
  const overrides = countOverrides(manifest)
  const seeds = manifest.seeds[mode] ?? {}
  const dials = { ...DEFAULT_DIALS, ...manifest.dials }
  const showSeeds = seedsVisible(manifest.layer)
  const canSave = manifest.name.trim().length > 0 && report.errors.length === 0

  function cancel() {
    previewManifest(null)
    onCancel()
  }

  return (
    <div className="theme-editor">
      <input
        className="theme-editor-name"
        placeholder="Theme name…"
        value={manifest.name}
        onChange={(e) => setManifest((m) => setName(m, e.target.value))}
      />

      <label className="theme-dial-row">
        <span className="theme-token-label">Layer</span>
        <select
          className="theme-font-select"
          value={manifest.layer ?? 'full'}
          onChange={(e) => setManifest((m) => setLayer(m, e.target.value === 'full' ? null : (e.target.value as LayerKind)))}
        >
          <option value="full">Full</option>
          <option value="workspace">Workspace</option>
          <option value="ambience">Ambience</option>
        </select>
      </label>
      {layerNote(manifest.layer) && <div className="theme-token-hint">{layerNote(manifest.layer)}</div>}

      <div className="theme-mode-tabs">
        <button type="button" className={`theme-mode-tab${mode === 'light' ? ' active' : ''}`} onClick={() => setMode('light')}>
          <SunIcon size={13} />
          Light
        </button>
        <button type="button" className={`theme-mode-tab${mode === 'dark' ? ' active' : ''}`} onClick={() => setMode('dark')}>
          <MoonIcon size={13} />
          Dark
        </button>
      </div>

      {showSeeds && (
      <label className="theme-editor-check">
        <input type="checkbox" checked={derive} onChange={(e) => setDerive(e.target.checked)} />
        Derive the other mode from this one
      </label>
      )}

      {showSeeds && (
      <div className="theme-editor-tokens">
        {SEED_FIELDS.map((f) => (
          <SeedRow
            key={`${mode}-${f.key}`}
            label={f.label}
            value={seeds[f.key]}
            fallback={(DEFAULT_SEEDS[mode] as Record<string, string>)[f.key] ?? '#808080'}
            onChange={(v) => setManifest((m) => setSeed(m, mode, f.key, v, derive))}
          />
        ))}
      </div>
      )}

      <div className="theme-editor-css-label">Dials</div>
      <div className="theme-editor-dials">
        {UNIT_DIALS.filter((k) => dialVisible(manifest.layer, k)).map((k) => (
          <label className="theme-dial-row" key={k}>
            <span className="theme-token-label">{k}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={dials[k] as number}
              onChange={(e) => setManifest((m) => setDial(m, k, Number(e.target.value)))}
            />
            <span className="theme-dial-value">{(dials[k] as number).toFixed(2)}</span>
          </label>
        ))}
        {dialVisible(manifest.layer, 'typeScale') && (
        <label className="theme-dial-row">
          <span className="theme-token-label">typeScale</span>
          <input
            type="number"
            className="theme-dial-num"
            min={1.125}
            max={1.333}
            step={0.01}
            value={dials.typeScale}
            onChange={(e) => setManifest((m) => setDial(m, 'typeScale', Number(e.target.value)))}
          />
        </label>
        )}
        {dialVisible(manifest.layer, 'baseSize') && (
        <label className="theme-dial-row">
          <span className="theme-token-label">baseSize</span>
          <input
            type="number"
            className="theme-dial-num"
            min={13}
            max={18}
            step={1}
            value={dials.baseSize}
            onChange={(e) => setManifest((m) => setDial(m, 'baseSize', Number(e.target.value)))}
          />
        </label>
        )}
        {dialVisible(manifest.layer, 'twilightBlend') && (
        <label className="theme-editor-check">
          <input
            type="checkbox"
            checked={dials.twilightBlend}
            onChange={(e) => setManifest((m) => setDial(m, 'twilightBlend', e.target.checked))}
          />
          twilightBlend
        </label>
        )}
      </div>

      <div className="theme-editor-css-label">Fonts</div>
      <div className="theme-editor-dials">
        {FONT_ROLES.filter((role) => fontVisible(manifest.layer, role)).map((role) => {
          const ref = manifest.fonts[role]
          const cur = ref && 'stack' in ref ? ref.stack : 'default'
          return (
            <label className="theme-dial-row" key={role}>
              <span className="theme-token-label">{role}</span>
              <select
                className="theme-font-select"
                value={cur}
                onChange={(e) =>
                  setManifest((m) => setFont(m, role, e.target.value === 'default' ? null : (e.target.value as StackName)))
                }
              >
                <option value="default">default</option>
                {(Object.keys(FONT_STACKS) as StackName[]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>

      <div className="theme-editor-css-label">Extra CSS (optional, applied on top of everything above, both modes)</div>
      <textarea
        className="css-editor theme-editor-css"
        spellCheck={false}
        placeholder={'.template-row:hover {\n  transform: scale(1.02);\n}'}
        value={manifest.css ?? ''}
        onChange={(e) => setManifest((m) => setCss(m, e.target.value))}
      />

      {overrides > 0 && (
        <div className="theme-editor-overrides">
          <span>Overrides: {overrides} kept</span>
          <button type="button" className="settings-btn" onClick={() => setManifest((m) => clearOverrides(m))}>
            Clear overrides
          </button>
        </div>
      )}

      {(report.errors.length > 0 || report.warnings.length > 0) && (
        <div className="theme-editor-report">
          {report.errors.map((i, n) => (
            <div className="theme-report-error" key={`e${n}`}>
              {i.path}: {i.message}
              {i.suggestion ? ` (${i.suggestion})` : ''}
            </div>
          ))}
          {report.warnings.map((i, n) => (
            <div className="theme-report-warn" key={`w${n}`}>
              {i.path}: {i.message}
              {i.suggestion ? ` ${i.suggestion}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="theme-editor-actions">
        <button className="settings-btn" onClick={cancel}>
          Cancel
        </button>
        <button className="settings-btn primary" onClick={() => onSave(manifest)} disabled={!canSave}>
          Save theme
        </button>
      </div>
    </div>
  )
}
