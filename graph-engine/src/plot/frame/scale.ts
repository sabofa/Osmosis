// Axis scales (linear or base-10 log). Pure.

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
