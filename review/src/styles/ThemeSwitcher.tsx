import type { ThemeInput } from '../../../graph-engine/src/style/theme/types'
import { BOARD_NAMES, CUSTOM_COLOUR_KEYS, customFromDefault, THEME_CHOICE_IDS, themeInputOf, themeLabel, type CustomTheme, type ThemeChoice, type ThemeChoiceId } from './controls'
import './controls.css'

export type { ThemeChoice }

export interface ThemeSwitcherProps {
  theme: ThemeChoice
  onChange: (choice: ThemeChoice, input: ThemeInput) => void
}

// Light, dark, the four built-ins, or a custom theme of colour pickers. The theme is resolved
// only through the adapter (themeInputOf).
export function ThemeSwitcher({ theme, onChange }: ThemeSwitcherProps) {
  const emit = (choice: ThemeChoice) => onChange(choice, themeInputOf(choice))
  const pick = (id: ThemeChoiceId) => {
    if (id !== 'custom') return emit({ id })
    emit({ id: 'custom', custom: theme.id === 'custom' ? theme.custom : customFromDefault(theme.id === 'dark' ? 'dark' : 'light') })
  }
  const edit = (change: (c: CustomTheme) => CustomTheme) => {
    if (theme.id === 'custom') emit({ id: 'custom', custom: change(theme.custom) })
  }
  return (
    <div className="ts">
      {THEME_CHOICE_IDS.map((id) => (
        <button key={id} type="button" aria-pressed={theme.id === id} onClick={() => pick(id)}>
          {themeLabel(id)}
        </button>
      ))}
      {theme.id === 'custom' && (
        <div className="ts-custom">
          <label>
            mode
            <select value={theme.custom.mode} onChange={(e) => edit((c) => ({ ...c, mode: e.target.value === 'dark' ? 'dark' : 'light' }))}>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <h4>colours</h4>
          {CUSTOM_COLOUR_KEYS.map((k) => (
            <label key={k}>
              {k}
              <input type="color" value={theme.custom.colours[k]} onChange={(e) => edit((c) => ({ ...c, colours: { ...c.colours, [k]: e.target.value } }))} />
            </label>
          ))}
          <h4>boards</h4>
          {BOARD_NAMES.map((b) => (
            <label key={b}>
              {b}
              <input type="color" value={theme.custom.boards[b]} onChange={(e) => edit((c) => ({ ...c, boards: { ...c.boards, [b]: e.target.value } }))} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
