import { useEffect, useState } from 'react'

// ----------------------------------------------------------------------------
// Per-browser preferences that shape how the app behaves (not how it looks —
// that is the theme, and not the node's config, which is /api/config). One
// key, one typed object, defaults for anything missing.
// ----------------------------------------------------------------------------

export interface Prefs {
  // Ask before leaving a test (Exit quiz).
  confirmExit: boolean
  // Ask before finishing with unanswered questions.
  confirmBlankSubmit: boolean
  // The one-line keyboard legend under a question.
  showKeyHints: boolean
  // Land on Home even when a tutor session is open (off: land on the session).
  startOnHome: boolean
  // Hold the set timer while the tab is hidden (off: it keeps running).
  pauseTimerWhenHidden: boolean
  // Fold parent tags in the bank by default when first opened.
  bankFoldedByDefault: boolean
  // Show the command line's output log when it opens.
  cliShowLog: boolean
}

export const DEFAULT_PREFS: Prefs = {
  confirmExit: true,
  confirmBlankSubmit: true,
  showKeyHints: true,
  startOnHome: true,
  pauseTimerWhenHidden: true,
  bankFoldedByDefault: false,
  cliShowLog: true,
}

export const PREF_LABELS: Record<keyof Prefs, { title: string; sub: string }> = {
  confirmExit: { title: 'Confirm before leaving a test', sub: 'Exit quiz asks first; the attempt ends either way' },
  confirmBlankSubmit: { title: 'Confirm finishing with blanks', sub: 'a blank counts as wrong, so Finish asks' },
  showKeyHints: { title: 'Keyboard hints under a question', sub: 'the one-line legend of the answering keys' },
  startOnHome: { title: 'Open on Home', sub: 'off: an open tutor session is the landing page' },
  pauseTimerWhenHidden: { title: 'Hold the set timer while the tab is hidden', sub: 'off: a timed set keeps counting when you switch tabs' },
  bankFoldedByDefault: { title: 'Bank opens with subjects folded', sub: 'unfold what you are working on' },
  cliShowLog: { title: 'Command line shows its output', sub: 'off: only the bar, until you press ▴' },
}

const KEY = 'osmosis:prefs'

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    const out = { ...DEFAULT_PREFS }
    for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean
    return out
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('osmosis:prefs'))
}

export function pref<K extends keyof Prefs>(key: K): Prefs[K] {
  return readPrefs()[key]
}

// Live in a component: re-reads when Settings writes.
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs())
  useEffect(() => {
    const onChange = () => setPrefs(readPrefs())
    window.addEventListener('osmosis:prefs', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('osmosis:prefs', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  return [
    prefs,
    (patch) => {
      const next = { ...readPrefs(), ...patch }
      writePrefs(next)
      setPrefs(next)
    },
  ]
}
