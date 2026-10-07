import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Straight from graph-engine's source, like the rest of the harness: an edit to
// the painter's parameters or the space camera shows up here on save. The saved
// tuning is imported, so the lab starts where "Save as defaults" last left it.
import tuning from '../../graph-engine/src/space/paint/tuning.json'
import { CURVE_SCHEMA, DEFAULT_PAINT_PARAMS, getParam, PARAM_SCHEMA, setParam, type PaintParams } from '../../graph-engine/src/space/paint/params'
import type { CurvePoints } from '../../graph-engine/src/space/paint/curves'
import type { PaintDebugMode } from '../../graph-engine/src/space/paint/types'
import { prepareFigure } from './paintLabCamera'
import { hexToOklab, makeSceneColours, oklabToHex, paramsForSave, subjectColour, switchTheme, themeBaseTone, type Theme, type Tones } from './paintLabColours'
import { CurveChart, GroupView, SwitchRow } from './paintLabControls'
import { labToLch } from './paintLabCurve'
import { figureById, PAINT_FIGURES } from './paintLabFigures'
import { pathLabel } from './paintLabMeter'
import { applySlider, changedCurves, changedPaths, getCurve, paramsFromData, parseParams, sameParams, serialiseParams, setCurve } from './paintLabParams'
import { deletePreset, readPresets, savePreset } from './paintLabPresets'
import { Showcase } from './paintLabShowcaseView'
import { DEBUG_MODES, GROUPS, readPrefs, URL_STATE, writePrefs, writeUrl, type Tab } from './paintLabState'
import type { BakeStatus } from './paintLabEngine'
import { Stage, type Readout } from './paintLabStage'

// The Paint Lab: orbit real space figures painted by the painter, and tune
// every painter parameter with live sliders. The view is full-window with a
// panel of controls beside it; the lab talks to the painter only through
// paintLabEngine.ts, so the real model and renderer can land behind it.

// ---------------------------------------------------------------------------
// Parameters: the starting set, and what "default" means in each theme
// ---------------------------------------------------------------------------

// The canvas tone's default is the theme's: the tuned paper in the light theme
// (the defaults' tone, or tuning.json's), the dark base in the dark theme.
function defaultsFor(theme: Theme): PaintParams {
  if (theme === 'light') return DEFAULT_PAINT_PARAMS
  const tone = themeBaseTone('dark')
  return { ...DEFAULT_PAINT_PARAMS, canvas: { ...DEFAULT_PAINT_PARAMS.canvas, tone: [tone[0], tone[1], tone[2]] } }
}

function startingParams(): { saved: PaintParams; params: PaintParams; tones: Tones } {
  const read = paramsFromData(tuning)
  const saved = read.ok ? read.params : DEFAULT_PAINT_PARAMS
  let params = URL_STATE.seed === null ? saved : applySlider(saved, 'seed', URL_STATE.seed)
  for (const [path, value] of URL_STATE.set) params = applySlider(params, path, value)
  const tones: Tones = { light: null, dark: null }
  if (URL_STATE.theme === 'dark') {
    const moved = switchTheme(params, tones, 'light', 'dark')
    params = moved.params
    tones.light = moved.tones.light
    tones.dark = moved.tones.dark
  }
  return { saved, params, tones }
}

interface Status {
  kind: 'ok' | 'error'
  text: string
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The readout's tooltip: what kind of frame it was and where its time went.
function readoutTitle(readout: Readout | null, bake: BakeStatus | null, bakeOn: boolean): string | undefined {
  if (!readout) return undefined
  const why = !bakeOn
    ? ' The Bake switch (in the panel, under View) is off: every slider repaints the live picture at once.'
    : bake?.why
      ? ` The light is fixed in the world, but the baked painting is off: ${bake.why}.`
      : ''
  if (readout.path === 'baked') {
    return `Baked frame (the painting was made once, in the world; each frame selects, projects and orders its strokes and paints them, with no model run): build ${readout.buildMs.toFixed(1)} ms · paint ${readout.paintMs.toFixed(1)} ms. The first number is the whole frame.`
  }
  const kind = readout.kind === 'colour' ? 'Colour-only frame' : readout.kind === 'repaint' ? 'Repainted frame (the same strokes)' : readout.kind === 'reproject' ? 'Re-projected frame (the model’s newest frame’s strokes through the new view; the model keeps running behind a drag)' : 'Full frame'
  return `${kind}: G-buffer ${readout.gbufferMs.toFixed(0)} ms · model ${readout.modelMs.toFixed(0)} ms (in a worker) · particles ${readout.particlesMs.toFixed(0)} ms · paper ${readout.paperMs.toFixed(0)} ms · paint ${readout.paintMs.toFixed(0)} ms. The first number is the whole frame, request to picture.${why}`
}

export function PaintLab() {
  const [start] = useState(startingParams)
  const [tab, setTab] = useState<Tab>(URL_STATE.tab)
  // The Showcase is built the first time it is opened, then kept (its pictures are a cache).
  const [showcaseOpened, setShowcaseOpened] = useState(URL_STATE.tab === 'showcase')
  const [figureId, setFigureId] = useState(URL_STATE.figure)
  const [debug, setDebug] = useState<PaintDebugMode>(URL_STATE.debug)
  // The Bake switch: a view setting of the lab (like the theme), not a painter parameter, so it is not in the params, a preset or the saved defaults.
  // It starts on, or off with &bake=0, and is kept in the URL as the theme is.
  const [bakeOn, setBakeOn] = useState(URL_STATE.bake)
  const [theme, setThemeState] = useState<Theme>(URL_STATE.theme)
  const [params, setParams] = useState<PaintParams>(start.params)
  const [saved, setSaved] = useState<PaintParams>(start.saved)
  const [compare, setCompare] = useState(false)
  const [local, setLocal] = useState({ on: false, hex: '#b7603a' })
  const [prefs] = useState(readPrefs)
  const [panelOpen, setPanelOpen] = useState(URL_STATE.panel ?? prefs.panel)
  const [openGroups, setOpenGroups] = useState<string[]>(URL_STATE.open ?? prefs.open)
  const [filter, setFilter] = useState('')
  const [presets, setPresets] = useState(() => readPresets())
  const [presetName, setPresetName] = useState('')
  const [chosen, setChosen] = useState('')
  const [importing, setImporting] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [undo, setUndo] = useState<PaintParams | null>(null)
  const [saving, setSaving] = useState(false)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [bake, setBake] = useState<BakeStatus | null>(null)
  const [paintProgress, setPaintProgress] = useState<{ done: number; total: number } | null>(null)
  const tones = useRef(start.tones)

  const defaults = useMemo(() => defaultsFor(theme), [theme])
  const figure = figureById(figureId) ?? PAINT_FIGURES[0]
  const { built, worldScene } = useMemo(() => prepareFigure(figure), [figure])
  const colours = useMemo(
    () => makeSceneColours(built.scene, theme, local.on ? hexToOklab(local.hex) : null),
    [built, theme, local.on, local.hex],
  )
  const subject = useMemo(() => labToLch(subjectColour(built.scene, colours)), [built, colours])
  const unsaved = !sameParams(paramsForSave(params, theme, tones.current), saved)
  // The saved defaults, shown in place of the working params while comparing.
  const shown = useMemo(
    () => (compare ? (theme === 'dark' ? { ...saved, canvas: { ...saved.canvas, tone: params.canvas.tone } } : saved) : params),
    [compare, saved, params, theme],
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => writeUrl(tab, figureId, debug, theme, bakeOn), [tab, figureId, debug, theme, bakeOn])
  useEffect(() => writePrefs({ panel: panelOpen, open: openGroups }), [panelOpen, openGroups])
  useEffect(() => {
    document.title = `${figure.label} · Paint lab`
  }, [figure])

  const onChange = useCallback((path: string, raw: number | string) => setParams((p) => applySlider(p, path, raw)), [])
  useEffect(() => {
    // For measuring from a script (?perf=1): move a slider as the controls do.
    if (URL_STATE.perf) (window as unknown as { __paintLab?: unknown }).__paintLab = { set: onChange }
  }, [onChange])
  const onReset = useCallback((path: string) => setParams((p) => setParam(p, path, getParam(defaults, path))), [defaults])
  const onCurve = useCallback((path: string, points: CurvePoints) => setParams((p) => setCurve(p, path, points)), [])
  const onResetCurve = useCallback((path: string) => setParams((p) => setCurve(p, path, structuredClone(getCurve(defaults, path)))), [defaults])
  const onResetGroup = useCallback(
    (title: string) =>
      setParams((p) => {
        const group = GROUPS.find((g) => g.title === title)!
        const sliders = group.specs.reduce((acc, s) => setParam(acc, s.path, getParam(defaults, s.path)), p)
        return group.curves.reduce((acc, c) => setCurve(acc, c.path, structuredClone(getCurve(defaults, c.path))), sliders)
      }),
    [defaults],
  )
  const onToggleGroup = useCallback((title: string) => setOpenGroups((o) => (o.includes(title) ? o.filter((t) => t !== title) : [...o, title])), [])

  const setTheme = (next: Theme) => {
    if (next === theme) return
    const moved = switchTheme(params, tones.current, theme, next)
    tones.current = moved.tones
    setParams(moved.params)
    setThemeState(next)
  }
  const replace = (next: PaintParams, text: string) => {
    setUndo(params)
    setParams(next)
    setStatus({ kind: 'ok', text })
  }
  const resetAll = () => {
    // The light paper's tone goes back to its default too, whichever theme shows.
    tones.current = { light: theme === 'light' ? null : [...DEFAULT_PAINT_PARAMS.canvas.tone], dark: null }
    replace(defaults, 'Back to the spec defaults.')
  }
  const showTab = (next: Tab) => {
    if (next === 'showcase') setShowcaseOpened(true)
    setTab(next)
  }
  // A tile opens its figure in Tune.
  const openFigure = useCallback((id: string) => {
    setFigureId(id)
    setTab('tune')
  }, [])
  const stepFigure = (by: number) => {
    const i = PAINT_FIGURES.findIndex((f) => f.id === figure.id)
    setFigureId(PAINT_FIGURES[(i + by + PAINT_FIGURES.length) % PAINT_FIGURES.length].id)
  }

  const savePresetNow = () => {
    const name = presetName.trim()
    if (!name) return setStatus({ kind: 'error', text: 'Name the preset first.' })
    if (savePreset(name, params)) {
      setPresets(readPresets())
      setChosen(name)
      setStatus({ kind: 'ok', text: `Saved preset “${name}”.` })
    } else {
      setStatus({ kind: 'error', text: 'The browser would not keep the preset (storage is blocked or full). Export it instead.' })
    }
  }
  const loadPreset = (name: string) => {
    setChosen(name)
    setPresetName(name)
    const preset = presets[name]
    if (preset) replace(preset, `Loaded preset “${name}”.`)
  }
  const deletePresetNow = () => {
    if (!chosen || !deletePreset(chosen)) return
    setPresets(readPresets())
    setStatus({ kind: 'ok', text: `Deleted preset “${chosen}”.` })
    setChosen('')
  }
  const exportParams = async () => {
    const text = serialiseParams(params)
    download('paint-params.json', `${text}\n`)
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind: 'ok', text: 'Copied the JSON to the clipboard and downloaded paint-params.json.' })
    } catch {
      setStatus({ kind: 'ok', text: 'Downloaded paint-params.json. The clipboard would not take the copy.' })
    }
  }
  const importNow = () => {
    const result = parseParams(importing ?? '')
    if (!result.ok) return setStatus({ kind: 'error', text: result.error })
    replace(result.params, 'Imported the parameters.')
    setImporting(null)
  }
  const saveDefaults = async () => {
    const body = paramsForSave(params, theme, tones.current)
    setSaving(true)
    try {
      const response = await fetch('/__paint/tuning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const reply = (await response.json().catch(() => null)) as { ok: boolean; path?: string; error?: string } | null
      if (response.ok && reply?.ok) {
        setSaved(body)
        setStatus({ kind: 'ok', text: `Saved to ${reply.path}.${body !== params ? ' The canvas tone saved is the light theme’s.' : ''}` })
      } else {
        setStatus({ kind: 'error', text: reply?.error ?? `The dev server answered ${response.status}; it has no /__paint/tuning handler here.` })
      }
    } catch (error) {
      setStatus({ kind: 'error', text: `Could not reach the dev server (${error instanceof Error ? error.message : String(error)}).` })
    } finally {
      setSaving(false)
    }
  }

  const filterText = filter.trim().toLowerCase()
  const presetNames = Object.keys(presets)
  const changedCount = changedPaths(params, defaults).length
  const changedCurveCount = changedCurves(params, defaults).length
  const toneHex = oklabToHex(params.canvas.tone)

  return (
    <div className="pl">
      <header className="pl-top">
        <div className="pl-brand">
          <h1>Paint lab</h1>
          <span>painted figures · M1</span>
        </div>
        <nav className="pl-tabs" role="tablist" aria-label="Paint lab views">
          {(['tune', 'showcase'] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`pl-tab-${t}`} aria-selected={tab === t} aria-controls={`pl-view-${t}`} onClick={() => showTab(t)}>
              {t === 'tune' ? 'Tune' : 'Showcase'}
            </button>
          ))}
        </nav>
        {tab === 'tune' && (
          <div className="pl-pick">
            <button type="button" className="pl-mini" onClick={() => stepFigure(-1)} aria-label="Previous figure">
              ‹
            </button>
            <select value={figure.id} onChange={(e) => setFigureId(e.target.value)} aria-label="Figure">
              {PAINT_FIGURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button type="button" className="pl-mini" onClick={() => stepFigure(1)} aria-label="Next figure">
              ›
            </button>
          </div>
        )}
        <label className="pl-field">
          <span>Debug view</span>
          <select value={debug} onChange={(e) => setDebug(e.target.value as PaintDebugMode)} aria-label="Debug view">
            {DEBUG_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="pl-field">
          <span>Seed</span>
          <input
            type="number"
            className="pl-seed"
            min={1}
            max={999}
            step={1}
            value={params.seed}
            aria-label="Seed"
            onChange={(e) => onChange('seed', e.target.value)}
          />
          <button type="button" className="pl-mini" title="A new seed: every seeded choice rerolled, still deterministic" onClick={() => onChange('seed', params.seed >= 999 ? 1 : params.seed + 1)}>
            reroll
          </button>
        </div>
        <button type="button" className="pl-mini" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={`Switch to the ${theme === 'light' ? 'dark' : 'light'} theme`}>
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
        <div className="pl-spacer" />
        {tab === 'tune' ? (
          <output className="pl-readout" aria-label="Frame rate, stroke count and which painter drew the frame" title={readoutTitle(readout, bake, bakeOn)}>
            {bake && bake.painting !== null ? (
              <span className="pl-painting">
                Painting… <b>{bake.painting}%</b> ·{' '}
              </span>
            ) : null}
            {readout ? (
              <>
                <b className={`pl-path is-${readout.path}`}>{pathLabel(readout.path, bakeOn, bake?.why ?? null)}</b> · <b>{Math.round(readout.fps)}</b> fps · {readout.ms.toFixed(1)} ms
                {readout.path === 'baked' ? ` (build ${readout.buildMs.toFixed(1)}, paint ${readout.paintMs.toFixed(1)})` : ''} · <b>{readout.strokes.toLocaleString('en-US')}</b> strokes
              </>
            ) : (
              '— fps'
            )}
          </output>
        ) : (
          <output className="pl-readout" aria-label="Showcase progress">
            {paintProgress && paintProgress.done < paintProgress.total ? `painting ${paintProgress.done + 1}/${paintProgress.total}…` : paintProgress ? `${paintProgress.total} figures painted` : ''}
          </output>
        )}
        {tab === 'tune' && (
          <button type="button" className={`pl-mini${panelOpen ? ' is-on' : ''}`} aria-expanded={panelOpen} aria-controls="pl-panel" onClick={() => setPanelOpen((o) => !o)} title={panelOpen ? 'Fold the controls away' : 'Show the controls'}>
            Controls
          </button>
        )}
      </header>

      <div className={`pl-body${panelOpen ? '' : ' is-folded'}`} id="pl-view-tune" role="tabpanel" aria-labelledby="pl-tab-tune" hidden={tab !== 'tune'}>
        <main className="pl-main">
          <Stage
            built={built}
            worldScene={worldScene}
            colours={colours}
            params={shown}
            debug={debug}
            bake={bakeOn}
            caption={{ label: figure.label, text: figure.caption }}
            banner={compare ? 'Showing the saved defaults (B). Press A/B to go back to your tune.' : null}
            injected={URL_STATE.injected}
            onReadout={setReadout}
            onBake={setBake}
          />
          {readout && (
            <div className="pl-view" aria-hidden="true">
              az {readout.view.azimuth.toFixed(0)}° · el {readout.view.elevation.toFixed(0)}° · ×{readout.view.zoom.toFixed(2)}
            </div>
          )}
        </main>

        <aside id="pl-panel" className={`pl-panel${compare ? ' is-comparing' : ''}`} aria-label="Painter controls" hidden={!panelOpen}>
          <div className="pl-session">
            <div className="pl-presets">
              <select value={chosen} onChange={(e) => (e.target.value ? loadPreset(e.target.value) : setChosen(''))} aria-label="Saved presets" disabled={compare}>
                <option value="">{presetNames.length ? 'Presets…' : 'No presets yet'}</option>
                {presetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button type="button" className="pl-mini" onClick={deletePresetNow} disabled={!chosen || compare} aria-label="Delete the chosen preset" title="Delete the chosen preset">
                Delete
              </button>
            </div>
            <div className="pl-presets">
              <input type="text" value={presetName} placeholder="Name this tune" maxLength={60} aria-label="Preset name" disabled={compare} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePresetNow()} />
              <button type="button" className="pl-mini" onClick={savePresetNow} disabled={compare}>
                Save
              </button>
            </div>
            <div className="pl-buttons">
              <button type="button" className="pl-mini" onClick={exportParams}>
                Export
              </button>
              <button type="button" className="pl-mini" onClick={() => setImporting((t) => (t === null ? '' : null))} aria-expanded={importing !== null} disabled={compare}>
                Import
              </button>
              <button type="button" className="pl-mini" onClick={resetAll} disabled={compare}>
                Reset all
              </button>
            </div>
            {importing !== null && (
              <div className="pl-import">
                <textarea value={importing} rows={5} spellCheck={false} placeholder="Paste painter parameters as JSON, or choose a file." aria-label="Parameters JSON" onChange={(e) => setImporting(e.target.value)} />
                <div className="pl-buttons">
                  <label className="pl-mini pl-file">
                    Choose file…
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (file) setImporting(await file.text())
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <button type="button" className="pl-mini is-primary" onClick={importNow} disabled={!importing.trim()}>
                    Apply
                  </button>
                  <button type="button" className="pl-mini" onClick={() => setImporting(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div className="pl-buttons">
              <button type="button" className={`pl-mini${compare ? ' is-on' : ''}`} aria-pressed={compare} onClick={() => setCompare((c) => !c)} title="Flip between your tune (A) and the saved defaults (B)">
                A/B
              </button>
              <button type="button" className="pl-mini" onClick={() => undo && (setParams(undo), setUndo(null), setStatus({ kind: 'ok', text: 'Undone.' }))} disabled={!undo || compare}>
                Undo
              </button>
              <button type="button" className="pl-mini is-primary" onClick={saveDefaults} disabled={saving || compare} title="Writes graph-engine/src/space/paint/tuning.json, which M2 reads as the shipping defaults">
                {saving ? 'Saving…' : 'Save as defaults'}
              </button>
            </div>
            <p className={`pl-status${status ? ` is-${status.kind}` : ''}`} role="status">
              {status ? status.text : unsaved ? 'Unsaved changes: they are not in the saved defaults yet.' : 'Your tune is the saved defaults.'}
            </p>
          </div>

          <div className="pl-scroll" inert={compare}>
            <section className="pl-group pl-bake">
              <h2 className="pl-colour-title">View</h2>
              <SwitchRow label="Bake (instant orbit)" checked={bakeOn} def={true} onChange={setBakeOn} />
              <p className="pl-hint">
                {bakeOn
                  ? 'Paints the picture once, so orbiting is instant (it needs the light fixed in the world). Changing the light, the seed or a stroke size bakes again, which takes seconds.'
                  : 'Off: every slider repaints the live picture at once. Orbiting is slower, as the model runs for each view.'}
              </p>
            </section>

            <section className="pl-group pl-colour">
              <h2 className="pl-colour-title">Colour</h2>
              <div className="pl-colour-row">
                <label className="pl-check">
                  <input type="checkbox" checked={local.on} onChange={(e) => setLocal((l) => ({ ...l, on: e.target.checked }))} />
                  <span>Paint surfaces in</span>
                </label>
                <input type="color" value={local.hex} aria-label="Local colour" onChange={(e) => setLocal({ on: true, hex: e.target.value })} />
                <span className="pl-hint">{local.on ? 'one local colour' : 'each figure’s own'}</span>
              </div>
              <div className="pl-colour-row">
                <span className="pl-colour-label">Canvas tone</span>
                <span className="pl-swatch" style={{ background: toneHex }} title={toneHex} />
                <code>{toneHex}</code>
                <button type="button" className="pl-mini" onClick={() => setParams((p) => ({ ...p, canvas: { ...p.canvas, tone: [...themeBaseTone(theme)] as [number, number, number] } }))} title="The theme's own background, from the palette">
                  theme base
                </button>
              </div>
              <div className="pl-colour-row">
                <span className="pl-colour-label">Canvas weave</span>
                <div className="pl-seg" role="group" aria-label="Canvas weave">
                  {(['duck', 'linen'] as const).map((w) => (
                    <button key={w} type="button" aria-pressed={params.canvas.weave === w} onClick={() => setParams((p) => ({ ...p, canvas: { ...p.canvas, weave: w } }))}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="pl-search">
              <input type="search" value={filter} placeholder="Find a parameter" aria-label="Find a parameter" onChange={(e) => setFilter(e.target.value)} />
              {!filter && (
                <>
                  <button type="button" className="pl-mini" onClick={() => setOpenGroups(GROUPS.map((g) => g.title))}>
                    Open all
                  </button>
                  <button type="button" className="pl-mini" onClick={() => setOpenGroups([])}>
                    Close all
                  </button>
                </>
              )}
            </div>
            {filter && !GROUPS.some((g) => g.specs.some((s) => `${g.title} ${s.label} ${s.path}`.toLowerCase().includes(filterText))) && (
              <p className="pl-hint pl-none">Nothing matches “{filter}”.</p>
            )}
            {GROUPS.map((group) => (
              <GroupView
                key={group.title}
                group={group}
                params={params}
                defaults={defaults}
                open={openGroups.includes(group.title)}
                forceOpen={filterText !== ''}
                filter={filterText}
                onToggle={onToggleGroup}
                onChange={onChange}
                onReset={onReset}
                onCurve={onCurve}
                onResetCurve={onResetCurve}
                onResetGroup={onResetGroup}
                chart={group.title === 'Lighting curve' || group.title === 'Curves' ? <CurveChart params={params} local={subject} /> : null}
              />
            ))}
            <p className="pl-hint pl-foot">{changedCount} of {PARAM_SCHEMA.length} sliders and {changedCurveCount} of {CURVE_SCHEMA.length} curves differ from the defaults.</p>
          </div>
        </aside>
      </div>

      {showcaseOpened && (
        <Showcase
          active={tab === 'showcase'}
          params={shown}
          debug={debug}
          theme={theme}
          localHex={local.on ? local.hex : null}
          compare={compare}
          onCompare={() => setCompare((c) => !c)}
          onOpen={openFigure}
          onProgress={setPaintProgress}
        />
      )}
    </div>
  )
}
