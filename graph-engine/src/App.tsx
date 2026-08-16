import { useEffect, useState } from 'react'
import GraphViewer from './GraphViewer'
import { parseSpec } from './parser/parseSpec'
import type { HoverMode } from './parser/config'
import type { ParseError } from './parser/types'
import './App.css'

const HOVER_MODES: HoverMode[] = ['all', 'points', 'none']
const POINTS_MODES = ['none', 'intercepts', 'vertices', 'all'] as const
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

// The parsed config only ever carries the expanded Set — this maps it back
// to whichever toggle button should read as active.
function pointsModeFromConfig(points: Set<string>): PointsMode {
  if (points.size === 0) return 'none'
  if (points.has('intercepts') && points.has('vertices')) return 'all'
  return points.has('intercepts') ? 'intercepts' : 'vertices'
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

const EXAMPLES: { label: string; spec: string }[] = [
  {
    label: '2D',
    spec: `y = x^2 - 2x - 1
x^2/9 + y^2/4 = 1        # ellipse
x^2 + y^2 = 25            # circle
A = (2, 3)
(0,0) -- (4,4)
(1,1) -> (3,5)
(cos(t)*3, sin(t)*2) for t in [0, 6.283]`,
  },
  {
    label: '3D',
    spec: `z = sin(x) * cos(y)
(3*cos(u)*sin(v), 3*sin(u)*sin(v), 3*cos(v)) for u in [0, 6.283], v in [0, 3.1416]   # sphere
A = (2, 2, 3)
(0,0,0) -- (3,3,0)
(0,0,0) -> (0,0,4)
(cos(t)*2, sin(t)*2, t*0.3) for t in [0, 18.85]   # helix`,
  },
  {
    label: 'Inequality',
    spec: `@hover: none
y > x^2 - 4
x^2 + y^2 <= 16`,
  },
  {
    label: 'Vector',
    spec: `vector: (0,0) -> (3,4)
vector: (0,0) -> (-2,3) color: purple`,
  },
  {
    label: 'Tangent',
    spec: `y = x^3 - 3x
tangent: x^3 - 3x at x = 1
tangent: x^3 - 3x at x = -1 color: purple`,
  },
  {
    label: 'Animate',
    spec: `k(t) = cos(t) * 2
animate: (k(t), sin(t)*2) for t in [0, 6.283]   # references k(t), a named function`,
  },
  {
    label: 'Piecewise',
    spec: `@points: vertices
y = -x - 1 if x < 0
y = x^2 - 1 if x >= 0`,
  },
  {
    label: 'Polar',
    spec: `r = 2 + 2*sin(3*theta)`,
  },
  {
    label: 'Slope field',
    spec: `field: dy/dx = x - y
y = x - 1   # one solution curve through the field`,
  },
  {
    label: 'Scatter',
    spec: `scatter: (1,2.1), (2,3.9), (3,6.2), (4,7.8), (5,10.1), (6,11.9)`,
  },
  {
    label: 'Table (data)',
    spec: `@mode: table
header: Score range | Frequency
row: 90-100 | 4
row: 80-89 | 9
row: 70-79 | 13
row: 60-69 | 5`,
  },
  {
    label: 'Table (function)',
    spec: `@mode: table
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (formula)',
    spec: `@mode: table
@formulas: on
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (multiple)',
    spec: `@mode: table
scores.header: Trial | Score
scores.row: 1 | 82
scores.row: 2 | 91
scores.row: 3 | 76
times.table: y = 2x + 1 for x in [0, 4] step 1`,
  },
  {
    label: 'Hide/show',
    spec: `@hide: helper
y = x^2 name: main
y = x + 3 color: teal name: helper`,
  },
  {
    label: 'Vertices/intercepts',
    spec: `@points: intercepts, vertices
y = x^2 - 4`,
  },
  {
    label: 'Circle',
    spec: `circle: (0, 0), 3
O = (0, 0)`,
  },
  {
    label: 'Triangle',
    spec: `polygon: A(0,0), B(4,0), C(2,3)
tick: A-C
tick: B-C
angle: A-B-C label: x°`,
  },
  {
    label: 'Right angle',
    spec: `polygon: A(0,0), B(4,0), C(0,3)
right-angle: B-A-C`,
  },
  {
    label: 'Isosceles angles',
    spec: `polygon: A(0,0), B(6,0), C(3,4)
tick: A-C
tick: B-C
angle: B-A-C label: α
angle: A-B-C label: α`,
  },
  {
    label: 'Hexagon',
    spec: `circle: (0, 0), 3
polygon: A(3*cos(0), 3*sin(0)), B(3*cos(pi/3), 3*sin(pi/3)), C(3*cos(2*pi/3), 3*sin(2*pi/3)), D(3*cos(pi), 3*sin(pi)), E(3*cos(4*pi/3), 3*sin(4*pi/3)), F(3*cos(5*pi/3), 3*sin(5*pi/3))`,
  },
  {
    label: 'Hyperbola',
    spec: `x^2/4 - y^2/9 = 1`,
  },
  {
    label: 'Damped oscillation',
    spec: `y = exp(-x/4) * cos(3x)
y = exp(-x/4) color: gray
y = -exp(-x/4) color: gray`,
  },
  {
    label: 'Functions',
    spec: `k(x) = x^2 - 2x + 1
a = 3
y = a * k(x - 2) color: teal
y = k(k(x)) - 5 color: purple`,
  },
]

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
        <div className="app-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.label} onClick={() => setSpec(ex.spec)}>
              {ex.label}
            </button>
          ))}
        </div>
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
