import { useEffect, useState } from 'react'
import { BINDING_LABELS, DEFAULT_BINDINGS, FIXED_KEYS, boundTo, readBindings, writeBindings, type KeyBindings } from '../../lib/keybinds'

// The rebindable keys, one row each: click a key to capture the next
// keystroke, Esc cancels, a clash is named rather than silently taken.
export default function KeysSection() {
  const [bindings, setBindings] = useState<KeyBindings>(() => readBindings())
  const [capturing, setCapturing] = useState<keyof KeyBindings | null>(null)
  const [clash, setClash] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      if (e.key.length !== 1 || /[0-9\s]/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
        setClash('One plain letter or symbol — digits, Space, Enter and modifiers are taken.')
        return
      }
      const other = boundTo(bindings, e.key, capturing!)
      if (other) {
        setClash(`${e.key} already means "${BINDING_LABELS[other].title}".`)
        return
      }
      const next = { ...bindings, [capturing!]: e.key }
      setBindings(next)
      writeBindings(next)
      setCapturing(null)
      setClash(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, bindings])

  function reset() {
    setBindings({ ...DEFAULT_BINDINGS })
    writeBindings({ ...DEFAULT_BINDINGS })
    setClash(null)
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Keys</div>
      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">Rebind</div>
          <div className="settings-row-sub">click a key, press the new one · Esc cancels · saved in this browser</div>
        </div>
        <button className="settings-btn" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      {clash && <div className="settings-note warn">{clash}</div>}
      <div className="keys-grid">
        {(Object.keys(DEFAULT_BINDINGS) as (keyof KeyBindings)[]).map((k) => (
          <div className="keys-row" key={k}>
            <div>
              <div className="settings-row-title">{BINDING_LABELS[k].title}</div>
              {BINDING_LABELS[k].sub && <div className="settings-row-sub">{BINDING_LABELS[k].sub}</div>}
            </div>
            <button
              className={`key-cap${capturing === k ? ' capturing' : ''}${bindings[k] !== DEFAULT_BINDINGS[k] ? ' changed' : ''}`}
              onClick={() => {
                setClash(null)
                setCapturing(capturing === k ? null : k)
              }}
              title={capturing === k ? 'Press the new key' : 'Click to rebind'}
            >
              {capturing === k ? '…' : bindings[k] === ' ' ? 'Space' : bindings[k]}
            </button>
          </div>
        ))}
      </div>
      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">Fixed</div>
          <div className="settings-row-sub">{FIXED_KEYS.join(' · ')}</div>
        </div>
      </div>
    </div>
  )
}
