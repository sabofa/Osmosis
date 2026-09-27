import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
// Straight from graph-engine's source, like the other review pages: an edit
// to space shows up here on save.
import { DARK_PALETTE, LIGHT_PALETTE } from '../../graph-engine/src/render/palette'
import type { SpaceView } from '../../graph-engine/src/space/config'
import { SpaceRenderer } from '../../graph-engine/src/space/SpaceRenderer'
import { SPACE_FIXTURES } from './spaceFixtures'
import './space.css'

type Theme = 'light' | 'dark'

const palette = (theme: Theme) => (theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

function viewText(v: SpaceView | null): string {
  if (!v) return '—'
  return `azimuth ${fmt(v.azimuth)}, elevation ${fmt(v.elevation)}, zoom ${fmt(v.zoom)}, target (${v.target.map(fmt).join(', ')})`
}

function initialTheme(): Theme {
  return new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
}

function initialFixture(): string {
  const wanted = new URLSearchParams(location.search).get('fixture')
  return SPACE_FIXTURES.some((f) => f.id === wanted) ? wanted! : SPACE_FIXTURES[0].id
}

export default function SpaceReview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SpaceRenderer | null>(null)
  const [fixtureId, setFixtureId] = useState(initialFixture)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [view, setView] = useState<SpaceView | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const fixture = SPACE_FIXTURES.find((f) => f.id === fixtureId) ?? SPACE_FIXTURES[0]

  // One renderer for the page's lifetime.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new SpaceRenderer(canvas, {
      palette: palette(initialTheme()),
      theme: initialTheme(),
      onError: (message) => setErrors((list) => [...list, message]),
      onViewChange: setView,
    })
    rendererRef.current = renderer
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  // Each example opens at its own authored camera.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.setScene(fixture.scene, { space: fixture.space })
    renderer.resetView()
    setView(renderer.getView())
    const url = new URL(location.href)
    url.searchParams.set('fixture', fixture.id)
    history.replaceState(null, '', url)
  }, [fixture])

  // The theme and the example both live in the URL, so a link (or a
  // screenshot) lands on exactly what was being looked at.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    rendererRef.current?.setPalette(palette(theme), theme)
    const url = new URL(location.href)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [theme])

  return (
    <div className="space-review">
      <aside className="space-review-side">
        <header>
          <h1>
            Space <span>· review</span>
          </h1>
          <p className="space-review-hint">
            Drag to orbit, right- or shift-drag to pan, wheel to zoom about the cursor, double-click to reset. With the view focused:
            arrows orbit, + and − zoom, 0 resets.
          </p>
        </header>

        <section>
          <h2>Examples</h2>
          <ul className="space-review-list">
            {SPACE_FIXTURES.map((f) => (
              <li key={f.id}>
                <button type="button" aria-pressed={f.id === fixture.id} onClick={() => setFixtureId(f.id)}>
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>What a correct render shows</h2>
          <p className="space-review-look">{fixture.look}</p>
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
          <label className="space-review-spec">
            <h2>Spec</h2>
            <span className="space-review-hint">Not live yet: specs render here once the space kernel lands (S2 Task 7). The examples above are hand-built scenes.</span>
            <textarea disabled rows={6} placeholder={'z = x^2 - y^2\n@camera: azimuth 40, elevation 25'} />
          </label>
        </section>

        <section>
          <h2>View</h2>
          <code className="space-review-view">{viewText(view)}</code>
        </section>

        {errors.length > 0 && (
          <section>
            <h2>Errors</h2>
            <ul className="space-review-errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <main className="space-review-stage">
        <canvas ref={canvasRef} aria-label={`Space view: ${fixture.title}`} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpaceReview />
  </StrictMode>,
)
