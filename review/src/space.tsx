import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
// Straight from graph-engine's source, like the other review pages: an edit
// to space shows up here on save.
import { EXAMPLES, type Example } from '../../graph-engine/src/examples'
import GraphViewer from '../../graph-engine/src/GraphViewer'
import { parseSpec } from '../../graph-engine/src/parser/parseSpec'
import type { ParseError } from '../../graph-engine/src/parser/types'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../graph-engine/src/render/palette'
import type { SpaceView } from '../../graph-engine/src/space/config'
import type { SpaceEvent } from '../../graph-engine/src/space/events'
import { SPACE_EXAMPLES } from '../../graph-engine/src/space/examples'
import { formatNumber, formatPoint } from '../../graph-engine/src/space/pick/format'
import { SpaceRenderer } from '../../graph-engine/src/space/SpaceRenderer'
import { SPACE_FIXTURES, type SpaceFixture } from './spaceFixtures'
import './space.css'

type Theme = 'light' | 'dark'
// Which component draws: SpaceRenderer mounted directly, or the real
// GraphViewer (its panel, its stats layer, its error channel).
type Host = 'space' | 'graphviewer'
// What is showing: the spec in the textarea, or a hand-built fixture scene
// (for mark kinds the kernel does not emit yet).
type Source = { kind: 'spec' } | { kind: 'fixture'; fixture: SpaceFixture }

// Space's examples, plus the old 3D example, which now draws through space.
const SPEC_EXAMPLES: Example[] = [...SPACE_EXAMPLES, ...EXAMPLES.filter((e) => e.label === '3D')]
const REBUILD_DEBOUNCE_MS = 80
// How many events the log keeps.
const EVENT_LOG = 10

const palette = (theme: Theme) => (theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)

// "Space · Paraboloid over a disk" -> "paraboloid-over-a-disk"; "3D" -> "3d".
function slug(label: string): string {
  return label
    .replace(/^Space\s*·\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

// One line of the event log.
function eventText(e: SpaceEvent): string {
  switch (e.type) {
    case 'hover':
      return e.hit ? `hover ${e.hit.source.object} (${e.hit.kind}) ${formatPoint(e.hit.position)}` : 'hover —'
    case 'pin':
      return e.hit ? `pin ${e.action} ${e.hit.source.object} ${formatPoint(e.hit.position)}` : `pin ${e.action}`
    case 'param':
      return `param ${e.name} = ${formatNumber(e.value)} (${e.source})`
  }
}

function viewText(v: SpaceView | null): string {
  if (!v) return '—'
  return `azimuth ${fmt(v.azimuth)}, elevation ${fmt(v.elevation)}, zoom ${fmt(v.zoom)}, target (${v.target.map(fmt).join(', ')})`
}

// The page's state lives in the URL too (?example=, ?spec=, ?fixture=,
// &theme=, &host=), so a link or a headless screenshot lands on exactly what
// was being looked at.
function fromUrl(): { spec: string; source: Source; theme: Theme; host: Host } {
  const q = new URLSearchParams(location.search)
  const fixture = SPACE_FIXTURES.find((f) => f.id === q.get('fixture'))
  const example = SPEC_EXAMPLES.find((e) => slug(e.label) === q.get('example')) ?? SPEC_EXAMPLES[0]
  return {
    // A spec in the link wins over a named example.
    spec: q.get('spec') ?? example.spec,
    source: fixture ? { kind: 'fixture', fixture } : { kind: 'spec' },
    theme: q.get('theme') === 'dark' ? 'dark' : 'light',
    host: q.get('host') === 'graphviewer' ? 'graphviewer' : 'space',
  }
}

function setUrl(params: Record<string, string | null>): void {
  const url = new URL(location.href)
  for (const [k, v] of Object.entries(params)) {
    if (v === null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  history.replaceState(null, '', url)
}

interface StageProps {
  source: Source
  spec: string
  theme: Theme
  // Bumped when an example or fixture is picked (not while typing): the view
  // returns to that scene's authored camera.
  pick: number
  onErrors: (errors: ParseError[]) => void
  onView: (view: SpaceView | null) => void
  onEvent: (event: SpaceEvent) => void
}

// SpaceRenderer on a bare canvas. Specs go through setSpec (the kernel);
// fixtures through setScene.
function SpaceStage({ source, spec, theme, pick, onErrors, onView, onEvent }: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<SpaceRenderer | null>(null)
  const lastPick = useRef(-1)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  // The canvas is made here, not rendered by React: dispose() releases the
  // WebGL context, and a released canvas cannot be drawn on again, so each
  // renderer (StrictMode mounts twice in development) gets its own element.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', 'Space view')
    host.appendChild(canvas)
    const renderer = new SpaceRenderer(canvas, {
      palette: palette(themeRef.current),
      theme: themeRef.current,
      onError: (message) => onErrors([{ line: 0, message }]),
      onViewChange: onView,
      onEvent: (event) => onEventRef.current(event),
    })
    rendererRef.current = renderer
    return () => {
      renderer.dispose()
      canvas.remove()
      rendererRef.current = null
    }
  }, [onErrors, onView])

  useEffect(() => {
    const build = () => {
      const renderer = rendererRef.current
      if (!renderer) return
      if (source.kind === 'fixture') {
        renderer.setScene(source.fixture.scene, { space: source.fixture.space })
        onErrors([])
      } else {
        const parsed = parseSpec(spec)
        const errors = renderer.setSpec(parsed.statements, parsed.config, parsed.statementLines, spec)
        onErrors([...parsed.errors, ...errors].sort((a, b) => a.line - b.line))
      }
      if (lastPick.current !== pick) {
        lastPick.current = pick
        renderer.resetView()
      }
      onView(renderer.getView())
    }
    // Typing is debounced; a pick draws at once.
    if (lastPick.current !== pick) {
      build()
      return
    }
    const timer = setTimeout(build, REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [source, spec, pick, onErrors, onView])

  useEffect(() => {
    rendererRef.current?.setPalette(palette(theme), theme)
  }, [theme])

  return <div ref={hostRef} className="space-review-canvas-host" />
}

// The real GraphViewer, which decides space vs 2D from the spec itself.
function GraphViewerStage({ source, spec, theme, onErrors }: StageProps) {
  if (source.kind === 'fixture') {
    return <p className="space-review-stage-note">Fixtures are hand-built scenes, not specs, so they draw with the SpaceRenderer host only.</p>
  }
  return (
    <div className="space-review-graphviewer">
      <GraphViewer spec={spec} theme={theme} onErrors={onErrors} />
    </div>
  )
}

export default function SpaceReview() {
  const initial = useRef(fromUrl()).current
  const [spec, setSpec] = useState(initial.spec)
  const [source, setSource] = useState<Source>(initial.source)
  const [theme, setTheme] = useState<Theme>(initial.theme)
  const [host, setHost] = useState<Host>(initial.host)
  const [pick, setPick] = useState(0)
  const [view, setView] = useState<SpaceView | null>(null)
  const [errors, setErrors] = useState<ParseError[]>([])
  const [events, setEvents] = useState<string[]>([])
  const onEvent = useCallback((e: SpaceEvent) => setEvents((list) => [...list, eventText(e)].slice(-EVENT_LOG)), [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    setUrl({ theme })
  }, [theme])

  const pickExample = (e: Example) => {
    setSpec(e.spec)
    setSource({ kind: 'spec' })
    setPick((p) => p + 1)
    // The example replaces any spec carried in the link, so a reload shows it.
    setUrl({ example: slug(e.label), fixture: null, spec: null })
  }
  const pickFixture = (f: SpaceFixture) => {
    setSource({ kind: 'fixture', fixture: f })
    setPick((p) => p + 1)
    setUrl({ fixture: f.id, example: null })
  }
  const selectedExample = source.kind === 'spec' ? SPEC_EXAMPLES.find((e) => e.spec === spec) : undefined
  const stage: StageProps = { source, spec, theme, pick, onErrors: setErrors, onView: setView, onEvent }

  return (
    <div className="space-review">
      <aside className="space-review-side">
        <header>
          <h1>
            Space <span>· review</span>
          </h1>
          <p className="space-review-hint">
            Drag to orbit, right- or shift-drag to pan, wheel to zoom about the cursor, double-click to reset. With the view focused:
            arrows orbit, + and − zoom, 0 resets. Hover to read a point; click to pin it (click a pin to unpin, Esc clears); drag a
            point made of @params; ▶ plays a parameter.
          </p>
        </header>

        <section>
          <h2>Examples</h2>
          <ul className="space-review-list">
            {SPEC_EXAMPLES.map((e) => (
              <li key={e.label}>
                <button type="button" aria-pressed={e === selectedExample} onClick={() => pickExample(e)}>
                  {e.label.replace(/^Space\s*·\s*/, '')}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <label className="space-review-spec">
            <h2>Spec</h2>
            <textarea
              rows={8}
              spellCheck={false}
              value={spec}
              onChange={(e) => {
                setSpec(e.target.value)
                if (source.kind !== 'spec') setSource({ kind: 'spec' })
              }}
            />
          </label>
          {errors.length > 0 && (
            <ul className="space-review-errors" aria-label="Errors">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? <strong>line {e.line}: </strong> : null}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Fixtures</h2>
          <p className="space-review-hint">Hand-built scenes for mark kinds the kernel does not emit yet (shapes, arrows, dashes).</p>
          <ul className="space-review-list">
            {SPACE_FIXTURES.map((f) => (
              <li key={f.id}>
                <button type="button" aria-pressed={source.kind === 'fixture' && source.fixture.id === f.id} onClick={() => pickFixture(f)}>
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
          {source.kind === 'fixture' && <p className="space-review-look">{source.fixture.look}</p>}
        </section>

        <section>
          <h2>Theme</h2>
          <div className="space-review-toggle" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Drawn by</h2>
          <div className="space-review-toggle" role="group" aria-label="Drawn by">
            {(
              [
                ['space', 'SpaceRenderer'],
                ['graphviewer', 'GraphViewer'],
              ] as const
            ).map(([h, name]) => (
              <button
                key={h}
                type="button"
                aria-pressed={host === h}
                onClick={() => {
                  setHost(h)
                  setUrl({ host: h === 'space' ? null : h })
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>View</h2>
          <code className="space-review-view">{host === 'space' ? viewText(view) : 'inside GraphViewer'}</code>
        </section>

        <section>
          <h2>Events</h2>
          {host !== 'space' ? (
            <p className="space-review-hint">GraphViewer reports no events yet.</p>
          ) : events.length === 0 ? (
            <p className="space-review-hint">Hover, pin, play or drag: the last {EVENT_LOG} events appear here.</p>
          ) : (
            <ol className="space-review-events" aria-label="Events">
              {events.map((e, i) => (
                <li key={`${i}:${e}`}>{e}</li>
              ))}
            </ol>
          )}
        </section>
      </aside>

      <main className="space-review-stage">{host === 'space' ? <SpaceStage {...stage} /> : <GraphViewerStage {...stage} />}</main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpaceReview />
  </StrictMode>,
)
