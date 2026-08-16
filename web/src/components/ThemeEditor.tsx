import { useState } from 'react'
import { TOKEN_FIELDS, DEFAULT_LIGHT_TOKENS, DEFAULT_DARK_TOKENS } from '../lib/themeTokens'
import type { ThemePreset } from '../hooks/useThemePresets'
import { XIcon, SunIcon, MoonIcon } from './icons'
import './ThemeEditor.css'

type Mode = 'light' | 'dark'

export default function ThemeEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ThemePreset | null
  onSave: (theme: ThemePreset) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [tokens, setTokens] = useState<{ light: Record<string, string>; dark: Record<string, string> }>(
    initial?.tokens ?? { light: {}, dark: {} }
  )
  const [customCss, setCustomCss] = useState(initial?.customCss ?? '')
  const [mode, setMode] = useState<Mode>('light')

  const defaults = mode === 'light' ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS
  const modeTokens = tokens[mode]

  function setToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, [mode]: { ...prev[mode], [key]: value } }))
  }

  function clearToken(key: string) {
    setTokens((prev) => {
      const next = { ...prev[mode] }
      delete next[key]
      return { ...prev, [mode]: next }
    })
  }

  function save() {
    if (!name.trim()) return
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      tokens,
      customCss,
    })
  }

  return (
    <div className="theme-editor">
      <input
        className="theme-editor-name"
        placeholder="Theme name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="theme-mode-tabs">
        <button
          type="button"
          className={`theme-mode-tab${mode === 'light' ? ' active' : ''}`}
          onClick={() => setMode('light')}
        >
          <SunIcon size={13} />
          Light
        </button>
        <button
          type="button"
          className={`theme-mode-tab${mode === 'dark' ? ' active' : ''}`}
          onClick={() => setMode('dark')}
        >
          <MoonIcon size={13} />
          Dark
        </button>
      </div>

      <div className="theme-editor-tokens">
        {TOKEN_FIELDS.map((field) => {
          const overridden = field.key in modeTokens
          const shown = modeTokens[field.key] ?? defaults[field.key]
          return (
            <div className="theme-token-row" key={field.key}>
              <div className="theme-token-info">
                <div className="theme-token-label">{field.label}</div>
                {field.hint && <div className="theme-token-hint">{field.hint}</div>}
              </div>
              <input
                type="color"
                className="theme-token-swatch"
                value={shown}
                onChange={(e) => setToken(field.key, e.target.value)}
              />
              <input
                type="text"
                className="theme-token-hex"
                value={shown}
                onChange={(e) => setToken(field.key, e.target.value)}
              />
              <button
                type="button"
                className="theme-token-clear"
                disabled={!overridden}
                onClick={() => clearToken(field.key)}
                aria-label={`Reset ${field.label}`}
                title="Use default"
              >
                <XIcon size={11} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="theme-editor-css-label">Extra CSS (optional, applied on top of the tokens above, both modes)</div>
      <textarea
        className="css-editor theme-editor-css"
        spellCheck={false}
        placeholder={'.template-row:hover {\n  transform: scale(1.02);\n}'}
        value={customCss}
        onChange={(e) => setCustomCss(e.target.value)}
      />

      <div className="theme-editor-actions">
        <button className="settings-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="settings-btn primary" onClick={save} disabled={!name.trim()}>
          Save theme
        </button>
      </div>
    </div>
  )
}
