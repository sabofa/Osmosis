// Tick lists for the 2D frame: linear (same values the grid draws today), pi, and log axes. Pure.
import type { GraphConfig } from '../../parser/config'
import type { Bounds } from '../../scene/types'
import { shouldLabel } from '../../render/grid'
import { formatTicks } from './labels'
import { piLabel, piStepFor } from './pi'
import { logTicks } from './logTicks'

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
}

export { shouldLabel }

const TARGET_DIVISIONS = 6
const MIN_DIVISIONS = 3
const MAX_DIVISIONS = 14
const MAX_TICKS = 10000

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

function linearAxis(min: number, max: number, fixed: number | null, config: GraphConfig): Tick[] {
  const span = max - min
  const step = pickLinearStep(fixed, span, config)
  const values = linearTickValues(min, max, step)
  const labels = formatTicks(values, step)
  return blankUnlabelled(
    values.map((value, i) => ({ value, label: labels[i], kind: 'major' as const })),
    config,
  )
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

function piAxis(min: number, max: number, configured: { num: number; den: number }, config: GraphConfig): Tick[] {
  const span = max - min
  const configuredValue = (configured.num / configured.den) * Math.PI
  const divisions = span / configuredValue
  const step =
    divisions >= MIN_DIVISIONS && divisions <= MAX_DIVISIONS ? configured : piStepFor(span, TARGET_DIVISIONS)
  const stepValue = (step.num / step.den) * Math.PI
  const out: Tick[] = []
  const first = Math.ceil(min / stepValue - 1e-9)
  for (let k = first; k * stepValue <= max * (1 + 1e-12) + 1e-12 * stepValue && out.length < MAX_TICKS; k++) {
    out.push({ value: k * stepValue, label: piLabel(k, step), kind: 'major' })
  }
  return blankUnlabelled(out, config)
}

function logAxis(lo: number, hi: number, px: number, config: GraphConfig): Tick[] {
  if (!(lo > 0) || !(hi > lo)) return []
  const decades = Math.log10(hi) - Math.log10(lo)
  const ticks = logTicks(lo, hi, px / decades)
  return config.labels === 'none' ? ticks.map((t) => ({ ...t, label: '' })) : ticks
}

function axisTicks(
  axis: 'x' | 'y',
  min: number,
  max: number,
  px: number,
  fixed: number | null,
  config: GraphConfig,
): Tick[] {
  if (!sizeOk(max - min, px)) return []
  if (config.scales[axis] === 'log') return logAxis(min, max, px, config)
  const pi = config.space.ticks[axis]?.pi ?? null
  return pi ? piAxis(min, max, pi, config) : linearAxis(min, max, fixed, config)
}

export function frameTicks(view: FrameView, config: GraphConfig): FrameTicks {
  const b = view.bounds
  return {
    x: axisTicks('x', b.xMin, b.xMax, view.widthPx, config.xstep, config),
    y: axisTicks('y', b.yMin, b.yMax, view.heightPx, config.ystep, config),
  }
}
