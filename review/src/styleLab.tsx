import { StrictMode, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
// Straight from graph-engine's source, like the rest of the harness: an edit
// to a line type, fill or paper shows up here on save.
import FigureView from '../../graph-engine/src/FigureView'
import { EXAMPLE_GROUPS, EXAMPLES } from '../../graph-engine/src/examples'
import { contactSheet, LINE_DEMO, SHEET_CSS, sheetSectionsHtml } from '../../graph-engine/src/figure/contactSheet'
import { cssColor } from '../../graph-engine/src/figure/document'
import type { FigurePen } from '../../graph-engine/src/figure/pen'
import { renderFigure } from '../../graph-engine/src/figure/render'
import { styledPen } from '../../graph-engine/src/figure/styledPen'
import { parseSpec } from '../../graph-engine/src/parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../../graph-engine/src/render/palette'
import { resolvePanels } from '../../graph-engine/src/scene/mode'
import { FACES } from '../../graph-engine/src/style/lettering'
import { PRESET_NAMES, type PresetName } from '../../graph-engine/src/style/presets'
import { applyStyleDirective, directivesFor, resolveStyle, type StyleLayer } from '../../graph-engine/src/style/resolve'
import { readToken, TOKENS, type FillType, type LetteringFace, type LineType, type PaperType, type Style, type Token } from '../../graph-engine/src/style/tokens'
import './styleLab.css'

// The style lab: pick a figure, pick a look, and tune every setting of the
// look by eye. What you settle on is shown as the "@style…" directives that
// reproduce it (to paste into a spec), and kept in the URL (to send as a
// link). The Sheet tab draws the contact sheet — the same one the headless
// script writes (graph-engine/scripts/contact-sheet.ts).

type Tab = 'lab' | 'sheet'
type Theme = 'light' | 'dark'

// Only examples the figure renderer draws: a style is a figure's look.
const FIGURES = EXAMPLES.filter((example) => {
  const parsed = parseSpec(example.spec)
  return resolvePanels(parsed.statements, parsed.config).drawable === 'figure'
})

const GROUP_TITLES: Record<string, string> = { line: 'Line', fill: 'Fill', paper: 'Paper', lettering: 'Lettering', colour: 'Colour', seed: 'Seed' }

// ---------------------------------------------------------------------------
// The URL: the example, the tab, the theme and the style's directives
// ---------------------------------------------------------------------------

interface LabState {
  example: string
  tab: Tab
  theme: Theme
  layer: StyleLayer
}

function layerFromDirectives(lines: readonly string[]): StyleLayer {
  const layer: StyleLayer = {}
  for (const line of lines) {
    const text = line.trim().replace(/^@/, '')
    const colon = text.indexOf(':')
    if (colon < 0) continue
    try {
      applyStyleDirective(layer, text.slice(0, colon).trim(), text.slice(colon + 1).trim())
    } catch {
      // A hand-edited link with a bad setting: keep the rest.
    }
  }
  return layer
}

function readHash(): LabState {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const example = params.get('ex')
  const style = params.get('style')
  return {
    example: example && FIGURES.some((e) => e.label === example) ? example : 'Circle vocabulary',
    tab: params.get('tab') === 'sheet' ? 'sheet' : 'lab',
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    layer: style ? layerFromDirectives(style.split(';')) : { preset: 'ink' },
  }
}

function writeHash(state: LabState, style: Style): void {
  const params = new URLSearchParams()
  params.set('ex', state.example)
  params.set('tab', state.tab)
  if (state.theme === 'dark') params.set('theme', 'dark')
  params.set('style', directivesFor(style).join(';'))
  window.history.replaceState(null, '', `#${params.toString()}`)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw(spec: string, layer: StyleLayer, palette: Palette): { svg: string; errors: string[] } {
  const parsed = parseSpec(spec)
  const result = renderFigure(parsed.statements, { ...parsed.config, style: layer }, palette)
  return { svg: result.svg, errors: [...parsed.errors, ...result.errors].map((e) => e.message) }
}

// Small swatches for the pickers, drawn by the engine's own styled pen: a
// curved stroke in each line type, a disk in each fill, a patch of each
// paper, and a small figure in each preset. Drawn in a small coordinate box
// (not a whole fitted figure) so a stroke is thick enough to show its
// character at 48 pixels. They show the kind, not the current tuning.
function swatch(layer: StyleLayer, palette: Palette, drawInto: (pen: FigurePen) => void): string {
  const box = { x: 0, y: 0, width: 120, height: 96 }
  const pen = styledPen(resolveStyle([layer]), palette)
  drawInto(pen)
  pen.paper(box)
  return pen.svg(box)
}

function useSwatches(palette: Palette) {
  return useMemo(() => {
    const ink = cssColor(palette.axis)
    const region = cssColor(palette.region)
    const choices = (key: string) => (TOKENS.find((t) => t.directive === key) as Extract<Token, { kind: 'choice' }>).choices
    return {
      preset: Object.fromEntries(PRESET_NAMES.map((name) => [name, draw(LINE_DEMO, { preset: name }, palette).svg])),
      line: Object.fromEntries(
        choices('line').map((type) => [
          type,
          swatch({ preset: 'ink', line: { type: type as LineType, looseness: 0.15 }, paper: { type: 'none' } }, palette, (pen) => {
            pen.stroke({ kind: 'arc', center: { x: 60, y: 150 }, radius: 125, start: -2.05, end: -1.09 }, { stroke: ink, 'stroke-width': 4.5 }, 'swatch/1', 'primary')
            pen.stroke({ kind: 'line', a: { x: 16, y: 80 }, b: { x: 104, y: 62 } }, { stroke: ink, 'stroke-width': 3 }, 'swatch/2', 'primary')
          }),
        ])
      ),
      fill: Object.fromEntries(
        choices('fill').map((type) => [
          type,
          swatch({ preset: 'ink', line: { type: 'technical' }, fill: { type: type as FillType, spacing: 7 }, paper: { type: 'none' } }, palette, (pen) => {
            pen.fill({ kind: 'ellipse', center: { x: 60, y: 48 }, rx: 44, ry: 38, rotation: 0 }, { fill: region, stroke: ink, 'stroke-width': 1.6 }, 'swatch/fill', 'regions')
          }),
        ])
      ),
      paper: Object.fromEntries(
        choices('paper').map((type) => [type, swatch({ preset: 'ink', paper: { type: type as PaperType, grid: 16 } }, palette, () => {})])
      ),
    } as Record<string, Record<string, string>>
  }, [palette])
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setToken(layer: StyleLayer, token: Token, value: string | number | undefined): StyleLayer {
  const next: StyleLayer = JSON.parse(JSON.stringify(layer))
  if (token.group === 'seed') {
    if (value === undefined) delete next.seed
    else next.seed = value as number
    return next
  }
  const group = { ...next[token.group] } as Record<string, string | number>
  if (value === undefined) delete group[token.key]
  else group[token.key] = value
  if (Object.keys(group).length === 0) delete next[token.group]
  else (next as Record<string, unknown>)[token.group] = group
  return next
}

function isSet(layer: StyleLayer, token: Token): boolean {
  if (token.group === 'seed') return layer.seed !== undefined
  return (layer[token.group] as Record<string, unknown> | undefined)?.[token.key] !== undefined
}

function Svg({ markup, className }: { markup: string; className?: string }) {
  const html = useMemo(() => ({ __html: markup }), [markup])
  return <span className={className} dangerouslySetInnerHTML={html} />
}

function TokenControl({
  token,
  style,
  layer,
  swatches,
  onChange,
}: {
  token: Token
  style: Style
  layer: StyleLayer
  swatches: Record<string, Record<string, string>>
  onChange: (value: string | number | undefined) => void
}) {
  const value = readToken(style, token)
  const changed = isSet(layer, token)
  const label = (
    <div className="lab-token-label">
      <span>{token.label}</span>
      <code>@style-{token.directive}</code>
      {changed && (
        <button type="button" className="lab-token-reset" title="Back to the preset's value" onClick={() => onChange(undefined)}>
          reset
        </button>
      )}
    </div>
  )

  if (token.kind === 'choice') {
    const previews = swatches[token.group]
    return (
      <div className={`lab-token lab-token-choice lab-choice-${token.group}`}>
        {label}
        <div className="lab-chips">
          {token.choices.map((choice) => (
            <button key={choice} type="button" className={`lab-chip${choice === value ? ' is-on' : ''}`} onClick={() => onChange(choice)} title={choice}>
              {previews?.[choice] && <Svg className="lab-chip-swatch" markup={previews[choice]} />}
              {token.group === 'lettering' && (
                <span className="lab-chip-face" style={{ fontFamily: FACES[choice as LetteringFace] }}>
                  Aa ∠B
                </span>
              )}
              <span className="lab-chip-name">{choice}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (token.kind === 'colour') {
    const text = String(value)
    const themed = text === 'theme'
    return (
      <div className="lab-token lab-token-colour">
        {label}
        <div className="lab-colour">
          <input type="color" value={themed ? '#888888' : text} onChange={(e) => onChange(e.target.value)} aria-label={token.label} />
          <span className="lab-colour-value">{themed ? 'the theme’s' : text}</span>
          <button type="button" className={`lab-mini${themed ? ' is-on' : ''}`} onClick={() => onChange('theme')}>
            theme
          </button>
        </div>
      </div>
    )
  }

  const n = Number(value)
  return (
    <div className="lab-token lab-token-number">
      {label}
      <div className="lab-slider">
        <input type="range" min={token.min} max={token.max} step={token.step} value={n} onChange={(e) => onChange(Number(e.target.value))} aria-label={token.label} />
        <output>{token.integer ? n : n.toFixed(token.step < 0.1 ? 2 : 1)}</output>
        {token.group === 'seed' && (
          <button type="button" className="lab-mini" onClick={() => onChange((n + 1) % 10000)} title="A new seed: every random choice rerolled, still deterministic">
            reroll
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function StyleLab() {
  const [state, setState] = useState<LabState>(readHash)
  const style = useMemo(() => resolveStyle([state.layer]), [state.layer])
  const palette = state.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
  const swatches = useSwatches(palette)

  useEffect(() => writeHash(state, style), [state, style])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
  }, [state.theme])

  const example = FIGURES.find((e) => e.label === state.example) ?? FIGURES[0]
  // Sliders move faster than a hand-drawn figure redraws: the figure follows
  // the controls a beat behind rather than holding them up.
  const deferredLayer = useDeferredValue(state.layer)
  const figure = useMemo(() => draw(example.spec, deferredLayer, palette), [example, deferredLayer, palette])
  const directives = useMemo(() => directivesFor(style), [style])
  const [copied, setCopied] = useState(false)

  const pickExample = (label: string) => {
    const chosen = FIGURES.find((e) => e.label === label)
    if (!chosen) return
    // An example pinned to a look (the Styles group) brings its look with it;
    // any other keeps the look being tuned.
    const own = parseSpec(chosen.spec).config.style
    setState((s) => ({ ...s, example: label, layer: Object.keys(own).length > 0 ? own : s.layer }))
  }
  const step = (by: number) => {
    const index = FIGURES.findIndex((e) => e.label === example.label)
    pickExample(FIGURES[(index + by + FIGURES.length) % FIGURES.length].label)
  }
  const setLayer = (layer: StyleLayer) => setState((s) => ({ ...s, layer }))
  const choosePreset = (preset: PresetName) => setLayer({ preset, ...(state.layer.seed !== undefined ? { seed: state.layer.seed } : {}) })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(directives.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  const groups = ['line', 'fill', 'paper', 'lettering', 'colour', 'seed'] as const
  const preset = state.layer.preset ?? 'clean'

  return (
    <div className="lab">
      <header className="lab-header">
        <div className="lab-brand">
          <h1>Style lab</h1>
          <span>figure styles · part 1</span>
        </div>
        <nav className="lab-tabs" role="tablist">
          {(['lab', 'sheet'] as const).map((tab) => (
            <button key={tab} role="tab" aria-selected={state.tab === tab} onClick={() => setState((s) => ({ ...s, tab }))}>
              {tab === 'lab' ? 'Lab' : 'Contact sheet'}
            </button>
          ))}
        </nav>
        {state.tab === 'lab' && (
          <div className="lab-picker">
            <button type="button" className="lab-mini" onClick={() => step(-1)} aria-label="Previous example">
              ‹
            </button>
            <select value={example.label} onChange={(e) => pickExample(e.target.value)} aria-label="Example">
              {EXAMPLE_GROUPS.map((group) => {
                const members = FIGURES.filter((e) => e.group === group)
                if (members.length === 0) return null
                return (
                  <optgroup key={group} label={group}>
                    {members.map((e) => (
                      <option key={e.label} value={e.label}>
                        {e.label}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            <button type="button" className="lab-mini" onClick={() => step(1)} aria-label="Next example">
              ›
            </button>
          </div>
        )}
        <div className="lab-spacer" />
        <button type="button" className="lab-mini" onClick={() => setState((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))}>
          {state.theme === 'light' ? 'Dark theme' : 'Light theme'}
        </button>
      </header>

      {state.tab === 'lab' ? (
        <div className="lab-body">
          <aside className="lab-controls">
            <section className="lab-group">
              <h2>Preset</h2>
              <div className="lab-presets">
                {PRESET_NAMES.map((name) => (
                  <button key={name} type="button" className={`lab-preset${preset === name ? ' is-on' : ''}`} onClick={() => choosePreset(name)}>
                    <Svg className="lab-preset-swatch" markup={swatches.preset[name]} />
                    <span>{name}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="lab-reset" onClick={() => setLayer({ preset })}>
                Reset {preset} to its own settings
              </button>
            </section>
            {groups.map((group) => (
              <section key={group} className="lab-group">
                <h2>{GROUP_TITLES[group]}</h2>
                {TOKENS.filter((t) => t.group === group).map((token) => (
                  <TokenControl
                    key={token.directive}
                    token={token}
                    style={style}
                    layer={state.layer}
                    swatches={swatches}
                    onChange={(value) => setLayer(setToken(state.layer, token, value))}
                  />
                ))}
              </section>
            ))}
          </aside>

          <main className="lab-stage">
            <div className="lab-figure">
              <FigureView svg={figure.svg} theme={state.theme} />
              <div className="lab-figure-caption">
                <strong>{example.label}</strong>
                <span>
                  {example.group} · {preset} · drag to pan, scroll to zoom
                </span>
              </div>
            </div>
            {figure.errors.length > 0 && (
              <ul className="lab-errors">
                {figure.errors.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            )}
            <div className="lab-directives">
              <div className="lab-directives-head">
                <h2>Directives</h2>
                <span>paste into a spec to pin this look</span>
                <div className="lab-spacer" />
                <button type="button" className="lab-copy" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>{directives.join('\n')}</pre>
            </div>
          </main>
        </div>
      ) : (
        <Sheet palette={palette} />
      )}
    </div>
  )
}

function Sheet({ palette }: { palette: Palette }) {
  const html = useMemo(() => ({ __html: `<style>${SHEET_CSS}</style><div class="sheet">${sheetSectionsHtml(contactSheet(palette))}</div>` }), [palette])
  return <div className="lab-sheet" dangerouslySetInnerHTML={html} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StyleLab />
  </StrictMode>
)
