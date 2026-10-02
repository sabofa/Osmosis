import { useEffect, useState } from 'react'
import GraphViewer from './GraphViewer'
import { parseSpec } from './parser/parseSpec'
import { EXAMPLE_GROUPS, EXAMPLES, type ExampleGroup } from './examples'
import type { HoverMode } from './parser/config'
import type { ParseError } from './parser/types'
import './App.css'

const HOVER_MODES: HoverMode[] = ['all', 'points', 'none']
const POINTS_MODES = ['none', 'roots', 'extrema', 'all'] as const
type PointsMode = (typeof POINTS_MODES)[number]

// Rewrites (or inserts) a directive line, so a visible toggle and the spec
// text stay the same single source of truth — no separate UI state to fall
// out of sync with what's actually typed.
function withDirective(spec: string, key: string, value: string): string {
  const lines = spec.split('\n')
  const idx = lines.findIndex((l) => new RegExp(`^\\s*@${key}\\s*:`, 'i').test(l))
  const directive = `@${key}: ${value}`
  if (idx !== -1) lines[idx] = directive
  else lines.unshift(directive)
  return lines.join('\n')
}

function withHoverMode(spec: string, mode: HoverMode): string {
  return withDirective(spec, 'hover', mode)
}

function withPointsMode(spec: string, mode: PointsMode): string {
  return withDirective(spec, 'points', mode)
}

// The parsed config only carries the expanded Set of concrete kinds — this
// maps it back to whichever toggle button should read as active.
function pointsModeFromConfig(points: Set<string>): PointsMode {
  if (points.size === 0) return 'none'
  const hasRoots = points.has('x-intercept')
  const hasExtrema = points.has('local-max')
  if (hasRoots && hasExtrema) return 'all'
  return hasRoots ? 'roots' : 'extrema'
}

// Shared by the Hover and Points rows below — both are "one directive value,
// rendered as a row of buttons, click to rewrite the directive" and were
// duplicating the same markup before this was pulled out.
function ToggleGroup<T extends string>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string
  options: readonly T[]
  active: T
  onSelect: (value: T) => void
}) {
  return (
    <div className="app-toggle-row">
      <span className="app-toggle-label">{label}</span>
      <div className="app-toggle-group">
        {options.map((value) => (
          <button key={value} className={value === active ? 'active' : ''} onClick={() => onSelect(value)}>
            {value}
          </button>
        ))}
      </div>
    </div>
  )
}

// The example picker. Seventy-odd buttons in one wrap had stopped being
// navigable, so the harness shows one group at a time, with a search box that
// cuts across every group. The chosen group is remembered per browser — a
// convenience only, so any storage failure just falls back to the first group.
const GROUP_KEY = 'graph-engine.review.example-group'

function readStoredGroup(): ExampleGroup {
  try {
    const stored = window.localStorage.getItem(GROUP_KEY)
    return (EXAMPLE_GROUPS as readonly string[]).includes(stored ?? '') ? (stored as ExampleGroup) : EXAMPLE_GROUPS[0]
  } catch {
    return EXAMPLE_GROUPS[0]
  }
}

function ExamplePicker({ current, onPick }: { current: string; onPick: (spec: string) => void }) {
  const [group, setGroup] = useState<ExampleGroup>(readStoredGroup)
  const [query, setQuery] = useState('')

  function chooseGroup(next: ExampleGroup) {
    setGroup(next)
    setQuery('')
    try {
      window.localStorage.setItem(GROUP_KEY, next)
    } catch {
      // Remembering the group is a nicety; the picker works without it.
    }
  }

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? EXAMPLES.filter((e) => e.label.toLowerCase().includes(needle) || e.group.toLowerCase().includes(needle))
    : EXAMPLES.filter((e) => e.group === group)

  return (
    <div className="app-picker">
      <div className="app-picker-groups" role="tablist" aria-label="Example groups">
        {EXAMPLE_GROUPS.map((g) => {
          const count = EXAMPLES.filter((e) => e.group === g).length
          const active = !needle && g === group
          return (
            <button key={g} role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={() => chooseGroup(g)}>
              {g}
              <span className="app-picker-count">{count}</span>
            </button>
          )
        })}
      </div>
      <input
        className="app-picker-search"
        type="search"
        placeholder={`Search all ${EXAMPLES.length} examples`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search examples"
      />
      <div className="app-examples">
        {shown.map((ex) => (
          <button key={ex.label} className={ex.spec === current ? 'current' : ''} onClick={() => onPick(ex.spec)}>
            {ex.label}
            {needle && <span className="app-example-group">{ex.group}</span>}
          </button>
        ))}
        {shown.length === 0 && <p className="app-picker-empty">No example matches “{query.trim()}”.</p>}
      </div>
    </div>
  )
}

export default function App() {
  const [spec, setSpec] = useState(EXAMPLES[0].spec)
  const [errors, setErrors] = useState<ParseError[]>([])
  const currentConfig = parseSpec(spec).config
  const hoverMode = currentConfig.hover
  const pointsMode = pointsModeFromConfig(currentConfig.points)

  // Recolors the whole review harness (see App.css's :root[data-theme]
  // blocks) to follow whatever the spec's own "@theme: light/dark" is
  // currently set to, rather than tracking a separate independent toggle —
  // one theme value driving both the plotted content and the chrome around it.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentConfig.theme)
  }, [currentConfig.theme])

  return (
    <div className="app">
      <div className="app-editor">
        <h1>Graph Engine</h1>
        <p className="app-hint">
          One statement per line. Functions, conics, points, segments (<code>--</code>), rays (<code>-&gt;</code>),
          parametric curves, inequalities (<code>y &gt; x^2</code>), piecewise (<code>if x &lt; 0</code>), polar
          (<code>r = f(theta)</code>), slope fields (<code>field: dy/dx = ...</code>), scatter + auto-regression,
          labeled vectors (<code>vector: ...</code>), tangent lines (<code>tangent: ... at x = ...</code>), traced
          animated points (<code>animate: ...</code>), classical geometry (<code>circle: ...</code>,{' '}
          <code>polygon: ...</code>, <code>angle: A-B-C</code>, <code>tick: A-B</code>,{' '}
          <code>right-angle: A-B-C</code>), and 3D (add a <code>z</code>). Config directives
          (<code>@key: value</code>) control theme, grid step, hover mode, and table mode — see the example buttons
          below. Drag to pan/orbit, scroll to zoom.
        </p>
        <ToggleGroup label="Hover" options={HOVER_MODES} active={hoverMode} onSelect={(m) => setSpec((s) => withHoverMode(s, m))} />
        <ToggleGroup label="Points" options={POINTS_MODES} active={pointsMode} onSelect={(m) => setSpec((s) => withPointsMode(s, m))} />
        <ExamplePicker current={spec} onPick={setSpec} />
        <textarea
          className="app-textarea"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          spellCheck={false}
        />
        {errors.length > 0 && (
          <ul className="app-errors">
            {errors.map((err, i) => (
              <li key={i}>
                line {err.line || '?'}: {err.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="app-viewer">
        <GraphViewer spec={spec} onErrors={setErrors} />
      </div>
    </div>
  )
}
