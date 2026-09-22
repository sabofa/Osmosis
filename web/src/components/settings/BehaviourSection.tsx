import { DEFAULT_PREFS, PREF_LABELS, usePrefs, type Prefs } from '../../lib/prefs'

// How the app behaves, per browser. The node's own numbers (daily quiz size,
// abandon window, retention) live in the shell, which owns the config state.
export default function BehaviourSection({ children }: { children?: React.ReactNode }) {
  const [prefs, update] = usePrefs()
  return (
    <div className="settings-section">
      <div className="settings-section-title">Behaviour</div>
      {(Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]).map((k) => (
        <div className="settings-row" key={k}>
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">{PREF_LABELS[k].title}</div>
              <div className="settings-row-sub">{PREF_LABELS[k].sub}</div>
            </div>
          </div>
          <div className="theme-toggle">
            <button
              className={`theme-toggle-btn${prefs[k] ? ' active' : ''}`}
              onClick={() => update({ [k]: !prefs[k] } as Partial<Prefs>)}
              aria-pressed={prefs[k]}
            >
              {prefs[k] ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      ))}
      {children}
    </div>
  )
}
