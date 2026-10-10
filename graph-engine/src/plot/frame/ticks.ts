// Tick lists for the 2D frame: linear (same values the grid draws today), pi, and log axes. Pure.
import type { GraphConfig } from '../../parser/config'
import type { Bounds } from '../../scene/types'
import { shouldLabel } from '../../render/grid'
import { formatTicks } from './labels'
import { piLabel, piStepFor } from './pi'
import { logTicks } from './logTicks'
import { MAX_DIVISIONS, MAX_TICKS, MIN_DIVISIONS, TARGET_DIVISIONS } from './tuning'

export interface Tick {
  value: number
  label: string
  kind: 'major' | 'minor'
}
export interface FrameView {
  bounds: Bounds
  widthPx: number
  heightPx: number
}
export interface FrameTicks {
  x: Tick[]
  y: Tick[]
  /** The resolved step per axis in world units; 0 for a log axis or an empty one. */
  step: { x: number; y: number }
}
interface Axis {
  ticks: Tick[]
  step: number
}

export { shouldLabel }

// The grid's "nice" step (1/2/5 x 10^n, thresholds 5 and 8), restated from first principles.
function niceStepFor(span: number, target: number): number {
  const rough = span / target
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const residual = rough / magnitude
  return (residual >= 8 ? 5 : residual >= 5 ? 2 : 1) * magnitude
}

/** Linear tick values for [min, max] with a resolved step: the exact walk GridRenderer.draw does. */
export function linearTickValues(min: number, max: number, step: number): number[] {
  const out: number[] = []
  if (!(step > 0) || !Number.isFinite(step)) return out
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max && out.length < MAX_TICKS; v += step) out.push(v)
  return out
}

function sizeOk(span: number, px: number): boolean {
  return Number.isFinite(span) && span > 0 && Number.isFinite(px) && px > 0
}

function blankUnlabelled(ticks: Tick[], config: GraphConfig): Tick[] {
  return ticks.map((t, i) => (t.label !== '' && !shouldLabel(i, config) ? { ...t, label: '' } : t))
}

function linearAxis(min: number, max: number, fixed: number | null, config: GraphConfig): Axis {
  const span = max - min
  const step = pickLinearStep(fixed, span, config)
  const values = linearTickValues(min, max, step)
  const labels = formatTicks(values, step)
  const ticks = blankUnlabelled(
    values.map((value, i) => ({ value, label: labels[i], kind: 'major' as const })),
    config,
  )
  return { ticks, step }
}

function pickLinearStep(fixed: number | null, span: number, config: GraphConfig): number {
  if (fixed === null || !(fixed > 0)) return niceStepFor(span, TARGET_DIVISIONS)
  const mode = config.stepMode
  if (mode === 'fixed') return span / fixed <= 1000 ? fixed : niceStepFor(span, TARGET_DIVISIONS)
  if (mode === 'geometric') {
    if (fixed === 1) return niceStepFor(span, TARGET_DIVISIONS)
    const exponent = Math.max(0, Math.round(Math.log2(span / TARGET_DIVISIONS / fixed)))
    return fixed * Math.pow(2, exponent)
  }
  const divisions = span / fixed
  return divisions >= MIN_DIVISIONS && divisions <= MAX_DIVISIONS ? fixed : niceStepFor(span, TARGET_DIVISIONS)
}

function piAxis(min: number, max: number, configured: { num: number; den: number }, config: GraphConfig): Axis {
  const span = max - min
  const configuredValue = (configured.num / configured.den) * Math.PI
  const divisions = span / configuredValue
  const step =
    divisions >= MIN_DIVISIONS && divisions <= MAX_DIVISIONS ? configured : piStepFor(span, TARGET_DIVISIONS)
  const stepValue = (step.num / step.den) * Math.PI
  // even the largest pi step would draw a crowd: use the nice step, labelled as plain numbers
  if (span / stepValue > MAX_DIVISIONS) return linearAxis(min, max, null, config)
  const out: Tick[] = []
  const first = Math.ceil(min / stepValue - 1e-9)
  for (let k = first; k * stepValue <= max * (1 + 1e-12) + 1e-12 * stepValue && out.length < MAX_TICKS; k++) {
    out.push({ value: k * stepValue, label: piLabel(k, step), kind: 'major' })
  }
  return { ticks: blankUnlabelled(out, config), step: stepValue }
}

function logAxis(lo: number, hi: number, px: number, config: GraphConfig): Axis {
  if (!(lo > 0) || !(hi > lo)) return { ticks: [], step: 0 }
  const decades = Math.log10(hi) - Math.log10(lo)
  const ticks = logTicks(lo, hi, px / decades)
  return { ticks: config.labels === 'none' ? ticks.map((t) => ({ ...t, label: '' })) : ticks, step: 0 }
}

function axisTicks(
  axis: 'x' | 'y',
  min: number,
  max: number,
  px: number,
  fixed: number | null,
  config: GraphConfig,
): Axis {
  if (!sizeOk(max - min, px)) return { ticks: [], step: 0 }
  if (config.scales[axis] === 'log') return logAxis(min, max, px, config)
  const pi = config.space.ticks[axis]?.pi ?? null
  return pi ? piAxis(min, max, pi, config) : linearAxis(min, max, fixed, config)
}

export function frameTicks(view: FrameView, config: GraphConfig): FrameTicks {
  const b = view.bounds
  const x = axisTicks('x', b.xMin, b.xMax, view.widthPx, config.xstep, config)
  const y = axisTicks('y', b.yMin, b.yMax, view.heightPx, config.ystep, config)
  return { x: x.ticks, y: y.ticks, step: { x: x.step, y: y.step } }
}

export interface LabelAnchor {
  value: number
  label: string
  kind: 'major' | 'minor'
  at: { x: number; y: number } // world position where the label is drawn
}

function pinned(axisPos: number, lo: number, hi: number, margin: number): number {
  const a = lo + margin
  const b = hi - margin
  if (!(a <= b)) return (lo + hi) / 2
  return Math.min(Math.max(axisPos, a), b)
}

/**
 * Where each tick label is drawn. x labels ride the line y = 0 and y labels the line x = 0; an axis outside the
 * view pins its labels to the nearest edge, inset by `margins` (world units). A log axis has no zero, so labels
 * for ticks along the other axis pin to this axis's lower edge.
 */
export function labelAnchors(
  ticks: FrameTicks,
  view: FrameView,
  margins: { x: number; y: number },
  scales: { x: 'linear' | 'log'; y: 'linear' | 'log' } = { x: 'linear', y: 'linear' },
): { x: LabelAnchor[]; y: LabelAnchor[] } {
  const b = view.bounds
  const rowY = scales.y === 'log' ? b.yMin + margins.y : pinned(0, b.yMin, b.yMax, margins.y)
  const colX = scales.x === 'log' ? b.xMin + margins.x : pinned(0, b.xMin, b.xMax, margins.x)
  return {
    x: ticks.x.map((t) => ({ ...t, at: { x: t.value, y: rowY } })),
    y: ticks.y.map((t) => ({ ...t, at: { x: colX, y: t.value } })),
  }
}
