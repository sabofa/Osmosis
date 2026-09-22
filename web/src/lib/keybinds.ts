// ----------------------------------------------------------------------------
// Rebindable keys. The answering map (keymap.ts) reads these; Settings → Keys
// edits them. Stored per browser in localStorage; a missing or broken entry
// falls back to the default so a half-edited map can never lock a key out.
// ----------------------------------------------------------------------------

export interface KeyBindings {
  blank: string
  idk: string
  unsure: string
  somewhat: string
  confident: string
  palette: string
  pause: string
}

export const DEFAULT_BINDINGS: KeyBindings = {
  blank: 'b',
  idk: '?',
  unsure: 'u',
  somewhat: 's',
  confident: 'c',
  palette: '/',
  pause: 'p',
}

export const BINDING_LABELS: Record<keyof KeyBindings, { title: string; sub: string }> = {
  blank: { title: 'Leave blank', sub: 'clears the answer on purpose' },
  idk: { title: "I don't know", sub: 'the third state, then a best guess' },
  unsure: { title: 'Confidence: unsure', sub: '' },
  somewhat: { title: 'Confidence: somewhat', sub: '' },
  confident: { title: 'Confidence: confident', sub: '' },
  palette: { title: 'Command line', sub: 'opens the bar at the bottom' },
  pause: { title: 'Pause the drill', sub: 'stops both clocks' },
}

// Keys that stay fixed: the map's shape depends on them.
export const FIXED_KEYS = ['1–5 pick a choice', 'Enter next / finish', 'Ctrl+Enter next while typing', 'Space acknowledge a show', 'Esc close', 'Tab complete']

const KEY = 'osmosis:keybinds'

export function readBindings(): KeyBindings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<KeyBindings>
    return normalise(raw)
  } catch {
    return { ...DEFAULT_BINDINGS }
  }
}

export function normalise(raw: Partial<KeyBindings>): KeyBindings {
  const out = { ...DEFAULT_BINDINGS }
  for (const k of Object.keys(DEFAULT_BINDINGS) as (keyof KeyBindings)[]) {
    const v = raw[k]
    if (typeof v === 'string' && v.length === 1 && !/[0-9\s]/.test(v) && v !== 'Enter') out[k] = v
  }
  return out
}

export function writeBindings(b: KeyBindings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* storage unavailable: the defaults apply */
  }
  window.dispatchEvent(new Event('osmosis:keybinds'))
}

// Which binding (if any) a key already belongs to — the Settings page shows
// the clash rather than silently double-booking a key.
export function boundTo(b: KeyBindings, key: string, except?: keyof KeyBindings): keyof KeyBindings | null {
  for (const k of Object.keys(b) as (keyof KeyBindings)[]) if (k !== except && b[k].toLowerCase() === key.toLowerCase()) return k
  return null
}
