import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import sweep from '../../../docs/styles/sweep.json'
import { resolveSettings, type SettingsLayer, type StyleStack, type ThemeStyles } from '../../../graph-engine/src/style/layers'
import { BUILTIN_THEME_STYLES } from '../../../graph-engine/src/style/layers'
import { PRESET_NAMES, type PresetName } from '../../../graph-engine/src/style/presets'
import { REGISTRY } from '../../../graph-engine/src/style/settings/registry'
import { guideAt } from '../../../graph-engine/src/style/settings/guide'
import type { SettingValue } from '../../../graph-engine/src/style/settings/types'
import { GRAPH_TYPES, type GraphType, type ThemeInput } from '../../../graph-engine/src/style/theme/types'
import { customFromDefault, CUSTOM_COLOUR_KEYS, BOARD_NAMES, isBuiltinId, themeInputOf, THEME_CHOICE_IDS, type EditedLayer, type ThemeChoice } from './controls'
import { LayerSelector } from './LayerSelector'
import { SettingsPanel } from './SettingsPanel'
import { Showcase } from './Showcase'
import { serialiseStyleSet } from './styleSets'
import { ThemeSwitcher } from './ThemeSwitcher'
import './StylesPage.css'

// The Style Lab page. It holds all the state (the theme, the edited layer, the layers of the stack);
// the controls it uses are props-in, events-out. Themes come only through the adapter (themeInputOf).

const SWEEP = new Map<string, string>(
  (sweep as { entries: { path: string; rating: string; activeRange?: number[] }[] }).entries.map((e) => [
    e.path,
    e.activeRange ? `Sweep: ${e.rating} (active over ${e.activeRange[0]} to ${e.activeRange[1]}).` : `Sweep: ${e.rating}.`,
  ])
)

const isEmpty = (layer: SettingsLayer | undefined): boolean => layer === undefined || (layer.preset === undefined && Object.keys(layer.set ?? {}).length === 0)

// A set of layers with the empty ones dropped (the shape a file or a theme keeps).
function pruned(styles: ThemeStyles): ThemeStyles {
  const out: ThemeStyles = {}
  if (!isEmpty(styles.all)) out.all = styles.all
  const byType = Object.fromEntries(Object.entries(styles.byType ?? {}).filter(([, layer]) => !isEmpty(layer)))
  if (Object.keys(byType).length > 0) out.byType = byType
  return out
}

const isNone = (styles: ThemeStyles): boolean => styles.all === undefined && styles.byType === undefined

// The layers a built-in theme brings (a copy to edit); empty for any other theme.
const loadedFor = (choice: ThemeChoice): ThemeStyles => (isBuiltinId(choice.id) ? structuredClone(BUILTIN_THEME_STYLES[choice.id] ?? {}) : {})

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

// ?theme=light|dark|builtin:slate|custom (custom colours: ?accent=#c04080 and so on, ?mode=dark), ?solo=<preset>.
function fromUrl(): { choice: ThemeChoice; solo?: PresetName } {
  const q = new URLSearchParams(location.search)
  const id = q.get('theme') ?? 'light'
  const solo = PRESET_NAMES.find((p) => p === q.get('solo'))
  if (id === 'custom') {
    const custom = customFromDefault(q.get('mode') === 'dark' ? 'dark' : 'light')
    for (const k of CUSTOM_COLOUR_KEYS) {
      const v = q.get(k)
      if (v && /^#[0-9a-f]{6}$/i.test(v)) custom.colours[k] = v.toLowerCase()
    }
    for (const b of BOARD_NAMES) {
      const v = q.get(b)
      if (v && /^#[0-9a-f]{6}$/i.test(v)) custom.boards[b] = v.toLowerCase()
    }
    return { choice: { id: 'custom', custom }, solo }
  }
  const known = (THEME_CHOICE_IDS as readonly string[]).includes(id) && id !== 'custom'
  return { choice: { id: known ? (id as Exclude<ThemeChoice['id'], 'custom'>) : 'light' } as ThemeChoice, solo }
}

function StylesPage() {
  const start = useMemo(fromUrl, [])
  const [choice, setChoice] = useState<ThemeChoice>(start.choice)
  const [themeStyles, setThemeStyles] = useState<ThemeStyles>(() => loadedFor(start.choice))
  const [documentLayer, setDocumentLayer] = useState<SettingsLayer>({})
  const [edited, setEdited] = useState<EditedLayer>({ kind: 'theme' })
  const [message, setMessage] = useState('')

  // The theme as the engines read it: the adapter's, carrying the theme layers.
  const kept = useMemo(() => pruned(themeStyles), [themeStyles])
  const theme: ThemeInput = useMemo(() => themeInputOf(choice, isNone(kept) ? undefined : kept), [choice, kept])

  const pickTheme = (next: ThemeChoice) => {
    // A built-in theme brings its file's layers; leaving one drops them; light, dark and custom keep what is being edited.
    if (next.id !== choice.id && (isBuiltinId(next.id) || isBuiltinId(choice.id))) setThemeStyles(loadedFor(next))
    setChoice(next)
    setMessage('')
  }

  // ---- the edited layer ----
  const layerOf = (l: EditedLayer): SettingsLayer | undefined => (l.kind === 'theme' ? themeStyles.all : l.kind === 'themeType' ? themeStyles.byType?.[l.graphType] : documentLayer)
  const own = layerOf(edited)
  const graphType: GraphType = edited.kind === 'themeType' ? edited.graphType : 'figure2d'

  const writeLayer = (next: SettingsLayer) => {
    if (edited.kind === 'theme') setThemeStyles((s) => ({ ...s, all: next }))
    else if (edited.kind === 'themeType') setThemeStyles((s) => ({ ...s, byType: { ...s.byType, [edited.graphType]: next } }))
    else setDocumentLayer(next)
  }
  const onChange = (path: string, value: SettingValue | undefined) => {
    const set = { ...own?.set }
    if (value === undefined) delete set[path]
    else set[path] = value
    writeLayer({ ...own, set })
  }
  const onPreset = (name: string) => {
    const next: SettingsLayer = { ...own }
    if (name === '') delete next.preset
    else next.preset = name
    writeLayer(next)
  }

  const specs = useMemo(() => (edited.kind === 'themeType' ? REGISTRY.filter((s) => s.appliesTo.graphTypes.includes(edited.graphType)) : REGISTRY), [edited])
  const values = useMemo(() => new Map(Object.entries(own?.set ?? {})), [own])
  // What the layers below this one say.
  const inherited = useMemo(() => {
    const below: StyleStack = edited.kind === 'theme' ? {} : edited.kind === 'themeType' ? { theme: { all: themeStyles.all } } : { theme: kept }
    return resolveSettings(below, graphType)
  }, [edited, graphType, themeStyles, kept])

  // ---- save ----
  const builtinId = isBuiltinId(choice.id) ? choice.id.slice('builtin:'.length) : null
  const save = async () => {
    if (edited.kind === 'document') {
      download('document-style.json', JSON.stringify(documentLayer, null, 2) + '\n')
      setMessage('Downloaded document-style.json.')
      return
    }
    const text = serialiseStyleSet(kept)
    if (builtinId === null) {
      download(`${choice.id}-theme-styles.json`, text)
      setMessage(`Downloaded ${choice.id}-theme-styles.json (a ${choice.id} theme has no file to save to).`)
      return
    }
    try {
      const res = await fetch(`/__styles/save?theme=${builtinId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
      const body = (await res.json()) as { ok: boolean; path?: string; error?: string }
      setMessage(body.ok ? `Saved ${body.path}.` : `Not saved: ${body.error ?? res.status}`)
    } catch (err) {
      setMessage(`Not saved: ${(err as Error).message}`)
    }
  }
  const saveLabel = edited.kind === 'document' ? 'Download document layer' : builtinId !== null ? `Save ${builtinId}.json` : 'Download theme styles'

  return (
    <div className="st">
      <aside className="st-side">
        <h2>Theme</h2>
        <ThemeSwitcher theme={choice} onChange={(next) => pickTheme(next)} />
        <h2>Layer</h2>
        <LayerSelector layer={edited} graphTypes={GRAPH_TYPES} onChange={setEdited} />
        <div className="st-actions">
          <label>
            preset{' '}
            <select value={own?.preset ?? ''} onChange={(e) => onPreset(e.target.value)}>
              <option value="">(none)</option>
              {PRESET_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={save}>
            {saveLabel}
          </button>
        </div>
        {message && <p className="st-msg">{message}</p>}
        <SettingsPanel
          specs={specs}
          values={values}
          inherited={inherited}
          meanings={(path) => guideAt(path)?.meaning}
          ratings={(path) => SWEEP.get(path)}
          onChange={onChange}
        />
      </aside>
      <main className="st-main">
        <Showcase choice={choice} themeStyles={isNone(kept) ? undefined : kept} document={isEmpty(documentLayer) ? undefined : documentLayer} solo={start.solo} />
        <p className="st-msg">Theme key {theme.key}. The columns are the presets, each as the theme layer&apos;s preset; the settings of the layers above it stay on top.</p>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StylesPage />
  </StrictMode>
)
