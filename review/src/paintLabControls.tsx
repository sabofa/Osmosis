import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { evalCurve, type CurvePoints, type CurveSpec } from '../../graph-engine/src/space/paint/curves'
import { getParam, type PaintParams, type ParamSpec } from '../../graph-engine/src/space/paint/params'
import { curveSeries, type Lch } from './paintLabCurve'
import { addPoint, canRemove, curveX, curveY, MIN_GAP, movePoint, nudgePoint, plotX, plotY, removePoint, type PlotBox, type YRange } from './paintLabCurves'
import { decimalsFor, getCurve, isToggle, type ParamGroup } from './paintLabParams'

// The panel's parts: one slider row, one curve editor, one collapsible group of
// both, and the lighting-curve chart that sits at the top of its groups.

export interface RowProps {
  spec: ParamSpec
  value: number
  def: number
  onChange: (path: string, raw: number | string) => void
  onReset: (path: string) => void
}

// One slider: label, a number that can be typed into (committed on Enter or
// blur, nudged by the arrow keys), a reset that appears once the value differs
// from the default, and the range.
const ParamRow = memo(function ParamRow({ spec, value, def, onChange, onReset }: RowProps) {
  const id = useId()
  const digits = decimalsFor(spec.step)
  const changed = Math.abs(value - def) > 1e-9
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) onChange(spec.path, draft)
    setDraft(null)
  }
  const toggle = isToggle(spec)
  return (
    <div className={`pl-row${changed ? ' is-changed' : ''}${toggle ? ' is-toggle' : ''}`}>
      <label className="pl-row-label" htmlFor={id}>
        {spec.label}
      </label>
      {toggle ? (
        <input id={id} type="checkbox" role="switch" className="pl-switch" checked={value >= 0.5} onChange={(e) => onChange(spec.path, e.target.checked ? 1 : 0)} />
      ) : (
        <input
          id={`${id}-n`}
          type="text"
          inputMode="decimal"
          className="pl-num"
          aria-label={`${spec.label}, value`}
          value={draft ?? value.toFixed(digits)}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const base = draft !== null && Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : value
              onChange(spec.path, base + (e.key === 'ArrowUp' ? 1 : -1) * spec.step * (e.shiftKey ? 10 : 1))
              setDraft(null)
            }
          }}
        />
      )}
      <button type="button" className="pl-reset" aria-label={`Reset ${spec.label} to ${def.toFixed(digits)}`} title={`Reset to ${def.toFixed(digits)}`} tabIndex={changed ? 0 : -1} onClick={() => onReset(spec.path)}>
        ↺
      </button>
      {!toggle && (
        <input
          id={id}
          type="range"
          className="pl-range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          aria-label={spec.label}
          onChange={(e) => onChange(spec.path, e.target.value)}
        />
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// A curve editor (spec §11)
// ---------------------------------------------------------------------------

const CW = 300
const CH = 164
// The plot inside the SVG, in SVG units; the rest is room for the axis labels.
const BOX: PlotBox = { left: 42, top: 8, width: 250, height: 118 }
const SAMPLES = 100

const tick = (v: number) => String(Number(v.toFixed(2)))
// A hue read off the unwrapped line, as degrees in 0..360.
const wrapHue = (v: number) => (((Math.round(v) % 360) + 360) % 360).toString()
const GRID = [0, 0.25, 0.5, 0.75, 1]

// The curve's line: evalCurve at 101 x values, in SVG units.
function trace(pts: CurvePoints, range: YRange): string {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const x = i / SAMPLES
    return `${plotX(BOX, x).toFixed(1)},${plotY(BOX, range, evalCurve(pts, x)).toFixed(1)}`
  }).join(' ')
}

export interface CurveEditorProps {
  spec: CurveSpec
  points: CurvePoints
  def: CurvePoints
  onChange: (path: string, points: CurvePoints) => void
  onReset: (path: string) => void
}

// A curve as a plot: its line (evalCurve, sampled at 100 points), the default
// for reference, and a handle on every point. Drag a point (an endpoint moves in
// y only); double-click empty plot to add one, a point to remove it; a focused
// point takes the arrow keys (Shift for bigger steps) and Delete. Drags reach
// the params at most once per animation frame, and the pointer is captured.
const CurveEditor = memo(function CurveEditor({ spec, points, def, onChange, onReset }: CurveEditorProps) {
  const range = useMemo(() => ({ yMin: spec.yMin, yMax: spec.yMax }), [spec])
  const svgRef = useRef<SVGSVGElement>(null)
  const pointsRef = useRef(points)
  pointsRef.current = points
  const drag = useRef<{ index: number; id: number } | null>(null)
  const pending = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef(0)
  const focusAfter = useRef<number | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const changed = JSON.stringify(points) !== JSON.stringify(def)

  const line = useMemo(() => trace(points, range), [points, range])
  const reference = useMemo(() => trace(def, range), [def, range])

  // After a point is added or removed, focus lands on the point that took its place.
  useEffect(() => {
    if (focusAfter.current === null) return
    svgRef.current?.querySelector<SVGGElement>(`[data-index="${focusAfter.current}"]`)?.focus()
    focusAfter.current = null
  })
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const apply = (next: CurvePoints) => {
    if (next === pointsRef.current) return
    pointsRef.current = next
    onChange(spec.path, next)
  }
  const toCurve = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: curveX(BOX, ((e.clientX - r.left) / r.width) * CW), y: curveY(BOX, range, ((e.clientY - r.top) / r.height) * CH) }
  }
  const flush = () => {
    frame.current = 0
    const target = pending.current
    const d = drag.current
    pending.current = null
    if (target && d) apply(movePoint(pointsRef.current, d.index, target.x, target.y, range))
  }

  const down = (index: number) => (e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    drag.current = { index, id: e.pointerId }
    setActive(index)
  }
  const move = (e: PointerEvent<SVGGElement>) => {
    if (!drag.current || e.pointerId !== drag.current.id) return
    pending.current = toCurve(e)
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  }
  const up = (e: PointerEvent<SVGGElement>) => {
    if (!drag.current || e.pointerId !== drag.current.id) return
    cancelAnimationFrame(frame.current)
    flush()
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const removeAt = (index: number) => {
    if (!canRemove(pointsRef.current, index)) return
    apply(removePoint(pointsRef.current, index))
    focusAfter.current = index - 1
    setActive(null)
  }
  const addAt = (e: MouseEvent<SVGRectElement>) => {
    const at = toCurve(e)
    const added = addPoint(pointsRef.current, at.x, at.y, range)
    if (added.index < 0) return
    apply(added.points)
    focusAfter.current = added.index
    setActive(added.index)
  }
  const key = (index: number) => (e: KeyboardEvent<SVGGElement>) => {
    const dx = (e.shiftKey ? 5 : 1) * MIN_GAP
    const dy = ((range.yMax - range.yMin) / 100) * (e.shiftKey ? 10 : 1)
    switch (e.key) {
      case 'ArrowLeft': apply(nudgePoint(pointsRef.current, index, -dx, 0, range)); break
      case 'ArrowRight': apply(nudgePoint(pointsRef.current, index, dx, 0, range)); break
      case 'ArrowUp': apply(nudgePoint(pointsRef.current, index, 0, dy, range)); break
      case 'ArrowDown': apply(nudgePoint(pointsRef.current, index, 0, -dy, range)); break
      case 'Delete':
      case 'Backspace': removeAt(index); break
      default: return
    }
    e.preventDefault()
  }

  const shown = active !== null ? points[active] : undefined
  const bottom = BOX.top + BOX.height
  return (
    <div className={`pl-curve${changed ? ' is-changed' : ''}`}>
      <div className="pl-curve-head">
        <span className="pl-curve-title">{spec.label}</span>
        <output className="pl-curve-read" aria-live="off">
          {shown ? `${spec.xLabel} ${shown[0].toFixed(2)} · ${spec.yLabel} ${shown[1].toFixed(Math.abs(spec.yMax - spec.yMin) >= 20 ? 1 : 3)}` : ''}
        </output>
        <button type="button" className="pl-mini pl-curve-reset" disabled={!changed} onClick={() => onReset(spec.path)} aria-label={`Reset ${spec.label} to its default`}>
          Reset
        </button>
      </div>
      <svg ref={svgRef} className="pl-curve-svg" viewBox={`0 0 ${CW} ${CH}`} role="group" aria-label={`${spec.label}: a curve of ${spec.yLabel} against ${spec.xLabel}, with ${points.length} points`}>
        {GRID.map((g) => (
          <g key={g} className="pl-curve-grid">
            <line x1={plotX(BOX, g)} y1={BOX.top} x2={plotX(BOX, g)} y2={bottom} />
            <line x1={BOX.left} y1={plotY(BOX, range, range.yMin + g * (range.yMax - range.yMin))} x2={BOX.left + BOX.width} y2={plotY(BOX, range, range.yMin + g * (range.yMax - range.yMin))} />
          </g>
        ))}
        {range.yMin < 0 && range.yMax > 0 && <line className="pl-curve-zero" x1={BOX.left} y1={plotY(BOX, range, 0)} x2={BOX.left + BOX.width} y2={plotY(BOX, range, 0)} />}
        <rect className="pl-curve-plot" x={BOX.left} y={BOX.top} width={BOX.width} height={BOX.height} onDoubleClick={addAt}>
          <title>Double-click to add a point</title>
        </rect>
        <polyline className="pl-curve-ref" points={reference} />
        <polyline className="pl-curve-line" points={line} />
        {points.map((p, i) => {
          const end = i === 0 || i === points.length - 1
          return (
            <g
              key={i}
              data-index={i}
              className={`pl-curve-point${end ? ' is-end' : ''}${active === i ? ' is-active' : ''}`}
              tabIndex={0}
              role="button"
              aria-roledescription="curve point"
              aria-label={`Point ${i + 1} of ${points.length}: ${spec.xLabel} ${p[0].toFixed(2)}, ${spec.yLabel} ${p[1].toFixed(3)}. ${end ? 'An endpoint: arrow up and down move it.' : 'Arrow keys move it, Delete removes it.'}`}
              transform={`translate(${plotX(BOX, p[0])} ${plotY(BOX, range, p[1])})`}
              onPointerDown={down(i)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerEnter={() => !drag.current && setActive(i)}
              onPointerLeave={() => !drag.current && setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => !drag.current && setActive((a) => (a === i ? null : a))}
              onKeyDown={key(i)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                removeAt(i)
              }}
            >
              <circle className="pl-curve-hit" r="11" />
              <circle className="pl-curve-ring" r="8" />
              <circle className="pl-curve-dot" r="4.5" />
            </g>
          )
        })}
        {[0, 0.5, 1].map((g) => (
          <text key={g} className="pl-curve-tick" x={plotX(BOX, g)} y={bottom + 12} textAnchor={g === 0 ? 'start' : g === 1 ? 'end' : 'middle'}>
            {g}
          </text>
        ))}
        {[range.yMax, range.yMin].map((v) => (
          <text key={v} className="pl-curve-tick" x={BOX.left - 5} y={plotY(BOX, range, v) + (v === range.yMax ? 8 : 0)} textAnchor="end">
            {tick(v)}
          </text>
        ))}
        <text className="pl-curve-axis" x={BOX.left + BOX.width / 2} y={CH - 4} textAnchor="middle">
          {spec.xLabel}
        </text>
        <text className="pl-curve-axis" transform={`translate(10 ${BOX.top + BOX.height / 2}) rotate(-90)`} textAnchor="middle">
          {spec.yLabel}
        </text>
      </svg>
    </div>
  )
})

// ---------------------------------------------------------------------------
// A group
// ---------------------------------------------------------------------------

interface GroupProps {
  group: ParamGroup
  params: PaintParams
  defaults: PaintParams
  open: boolean
  forceOpen: boolean
  filter: string
  onToggle: (title: string) => void
  onChange: RowProps['onChange']
  onReset: RowProps['onReset']
  onCurve: CurveEditorProps['onChange']
  onResetCurve: CurveEditorProps['onReset']
  onResetGroup: (title: string) => void
  chart: ReactNode
}

export function GroupView({ group, params, defaults, open, forceOpen, filter, onToggle, onChange, onReset, onCurve, onResetCurve, onResetGroup, chart }: GroupProps) {
  const matches = (label: string, path: string) => `${group.title} ${label} ${path}`.toLowerCase().includes(filter)
  const specs = filter ? group.specs.filter((s) => matches(s.label, s.path)) : group.specs
  const curves = filter ? group.curves.filter((c) => matches(c.label, c.path)) : group.curves
  if (filter && specs.length + curves.length === 0) return null
  const changedSliders = group.specs.filter((s) => Math.abs(getParam(params, s.path) - getParam(defaults, s.path)) > 1e-9).length
  const changedCurves = group.curves.filter((c) => JSON.stringify(getCurve(params, c.path)) !== JSON.stringify(getCurve(defaults, c.path))).length
  const changed = changedSliders + changedCurves
  const expanded = open || forceOpen
  const bodyId = `pl-group-${group.title.replace(/\W+/g, '-')}`
  return (
    <section className="pl-group">
      <h2>
        <button type="button" className="pl-group-head" aria-expanded={expanded} aria-controls={bodyId} onClick={() => onToggle(group.title)}>
          <span className="pl-chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="pl-group-title">{group.title}</span>
          {changed > 0 && <span className="pl-badge" title={`${changed} changed from the defaults`}>{changed}</span>}
        </button>
        {changed > 0 && (
          <button type="button" className="pl-group-reset" onClick={() => onResetGroup(group.title)} title="Reset this group to the defaults">
            reset
          </button>
        )}
      </h2>
      {expanded && (
        <div className="pl-group-body" id={bodyId}>
          {!filter && chart}
          {curves.length > 0 && (
            <p className="pl-hint pl-curve-hint">Drag a point. Double-click empty plot to add one, a point to remove it. Arrow keys nudge a focused point, Delete removes it. The dashed line is the default.</p>
          )}
          {curves.map((spec) => (
            <CurveEditor key={spec.path} spec={spec} points={getCurve(params, spec.path)} def={getCurve(defaults, spec.path)} onChange={onCurve} onReset={onResetCurve} />
          ))}
          {specs.map((spec) => (
            <ParamRow key={spec.path} spec={spec} value={getParam(params, spec.path)} def={getParam(defaults, spec.path)} onChange={onChange} onReset={onReset} />
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The lighting-curve chart
// ---------------------------------------------------------------------------

// L, C and H against value for the figure's local colour: the model's own curve
// (paintLabCurve.ts), as the strokes use it, with the sliders and the adjustment
// curves applied.
export function CurveChart({ params, local }: { params: PaintParams; local: Lch }) {
  const W = 300
  const TRACK = 40
  const GAP = 8
  const { value } = params
  // Everything the curve reads: its numbers, the adjustment curves, the seed of its deviation.
  const series = useMemo(
    () => curveSeries(params, local, 41),
    [params.curve, params.curves, params.environment, params.seed, params.canvas.tone, local],
  )
  const tracks: { name: string; values: number[]; className: string; unit: string; digits: number }[] = [
    { name: 'L', values: series.L, className: 'is-l', unit: '', digits: 2 },
    { name: 'C', values: series.C, className: 'is-c', unit: '', digits: 3 },
    { name: 'H', values: series.H, className: 'is-h', unit: '°', digits: 0 },
  ]
  const height = tracks.length * (TRACK + GAP) + 12
  // The half-tone and light ramps of the value plan, so the curve reads against the zones.
  const bands = [value.halfLo, value.halfHi, value.lightLo, value.lightHi]
  const band = (lo: number, hi: number) => ({ x: Math.min(lo, hi) * W, w: Math.abs(hi - lo) * W })
  return (
    <figure className="pl-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Lighting curve: lightness, chroma and hue against value, for the figure's local colour">
        {tracks.map((t, i) => {
          const top = i * (TRACK + GAP)
          const lo = Math.min(...t.values)
          const hi = Math.max(...t.values)
          const span = hi - lo || 1
          const pts = t.values.map((v, k) => `${((k / (t.values.length - 1)) * W).toFixed(1)},${(top + TRACK - 3 - ((v - lo) / span) * (TRACK - 6)).toFixed(1)}`).join(' ')
          return (
            <g key={t.name} className={t.className}>
              <rect className="pl-chart-track" x="0" y={top} width={W} height={TRACK} rx="3" />
              <rect className="pl-chart-band" x={band(bands[0], bands[1]).x} y={top} width={band(bands[0], bands[1]).w} height={TRACK} />
              <rect className="pl-chart-band" x={band(bands[2], bands[3]).x} y={top} width={band(bands[2], bands[3]).w} height={TRACK} />
              <polyline points={pts} />
              <text x="4" y={top + 11} className="pl-chart-name">
                {t.name}
              </text>
              <text x={W - 4} y={top + 11} textAnchor="end" className="pl-chart-range">
                {t.name === 'H' ? `${wrapHue(lo)}–${wrapHue(hi)}` : `${lo.toFixed(t.digits)}–${hi.toFixed(t.digits)}`}
                {t.unit}
              </text>
            </g>
          )
        })}
        {[0, 0.5, 1].map((u) => (
          <text key={u} x={u * W} y={height - 1} textAnchor={u === 0 ? 'start' : u === 1 ? 'end' : 'middle'} className="pl-chart-axis">
            {u === 0 ? 'u 0' : u}
          </text>
        ))}
      </svg>
      <figcaption>The model’s curve against value u, as the strokes use it, with your adjustments and the half-tone and light ramps shaded. Each stroke adds its own jitter, its plane’s hue step and the sky’s and ground’s colour.</figcaption>
    </figure>
  )
}
