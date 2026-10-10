// Axis scales (linear or base-10 log) and the world -> screen-pixel mapping of a view through them. Pure.
// Pixels have their origin at the bounds' min corner, x to the right and y up (the samplers' orientation: they scale
// differences by widthPx / spanX and heightPx / spanY and never flip).
import type { Bounds } from '../../scene/types'

export type AxisScale = 'linear' | 'log'

export interface Scale {
  kind: AxisScale
  forward(x: number): number // world -> transformed (identity, or log10; NaN for x <= 0 on log)
  inverse(u: number): number // transformed -> world (identity, or 10 ** u)
  domainLo: number // smallest valid world value: -Infinity for linear, 0 (exclusive) for log
  valid(x: number): boolean // finite and (linear: always; log: x > 0)
}

const LINEAR: Scale = {
  kind: 'linear',
  forward: (x) => x,
  inverse: (u) => u,
  domainLo: Number.NEGATIVE_INFINITY,
  valid: (x) => Number.isFinite(x),
}

const LOG: Scale = {
  kind: 'log',
  forward: (x) => (x > 0 ? Math.log10(x) : Number.NaN),
  inverse: (u) => 10 ** u,
  domainLo: 0,
  valid: (x) => Number.isFinite(x) && x > 0,
}

export function scaleOf(kind: AxisScale | undefined): Scale {
  return kind === 'log' ? LOG : LINEAR
}

export interface PxMapper {
  x(x: number): number
  y(y: number): number
  xInv(px: number): number
  yInv(px: number): number
  // px per world unit (linear) or per decade (log: the average over the axis, not a constant)
  pxPerUnitX: number
  pxPerUnitY: number
}

interface AxisMap {
  to(v: number): number
  from(p: number): number
  perUnit: number
}

function axis(name: string, kind: AxisScale | undefined, lo: number, hi: number, sizePx: number): AxisMap {
  const s = scaleOf(kind)
  if (s.kind === 'linear') {
    // the operation order the samplers use: (v - lo) * (sizePx / span)
    const perUnit = sizePx / (hi - lo)
    return { to: (v) => (v - lo) * perUnit, from: (p) => p / perUnit + lo, perUnit }
  }
  if (!(lo > 0) || !(hi > 0)) throw new RangeError(`log ${name} axis needs positive bounds, got [${lo}, ${hi}]`)
  const uLo = s.forward(lo)
  const perUnit = sizePx / (s.forward(hi) - uLo)
  return { to: (v) => (s.forward(v) - uLo) * perUnit, from: (p) => s.inverse(p / perUnit + uLo), perUnit }
}

export function pxMapper(view: { bounds: Bounds; widthPx: number; heightPx: number; xScale?: AxisScale; yScale?: AxisScale }): PxMapper {
  const { bounds: b } = view
  const ax = axis('x', view.xScale, b.xMin, b.xMax, view.widthPx)
  const ay = axis('y', view.yScale, b.yMin, b.yMax, view.heightPx)
  return { x: ax.to, y: ay.to, xInv: ax.from, yInv: ay.from, pxPerUnitX: ax.perUnit, pxPerUnitY: ay.perUnit }
}
