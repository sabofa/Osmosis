import type { GraphConfig } from '../../parser/config'
import { scaleOf } from '../frame/scale'
import { DEFAULT_LOG_WINDOW } from '../frame/tuning'
import type { PlotAspect } from './plotView'

// The authored frame as the camera's initial window: @bounds (world values) moved onto the plotted (u,v)
// plane by each axis's scale. Pure; no three.js.

export interface PlaneBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** The window in (u,v), or undefined when nothing is authored and both axes are linear (the camera's own default). */
export function authoredBounds(
  config: Pick<GraphConfig, 'bounds' | 'scales'>,
  screenAspect: number,
): PlaneBounds | undefined {
  const { bounds, scales } = config
  if (!bounds && scales.x !== 'log' && scales.y !== 'log') return undefined
  const half = 6 * (Number.isFinite(screenAspect) && screenAspect > 0 ? screenAspect : 1)
  // A log axis with no @bounds range shows DEFAULT_LOG_WINDOW (parse only checks a log axis against a @bounds that exists).
  const axis = (kind: 'linear' | 'log', lo: number | undefined, hi: number | undefined, dflt: [number, number]): [number, number] => {
    const s = scaleOf(kind)
    const w = lo !== undefined && hi !== undefined ? [lo, hi] : kind === 'log' ? [DEFAULT_LOG_WINDOW.min, DEFAULT_LOG_WINDOW.max] : dflt
    const u = [s.forward(w[0]), s.forward(w[1])]
    return Number.isFinite(u[0]) && Number.isFinite(u[1]) && u[1] > u[0] ? [u[0], u[1]] : [s.forward(DEFAULT_LOG_WINDOW.min), s.forward(DEFAULT_LOG_WINDOW.max)]
  }
  const [xMin, xMax] = axis(scales.x, bounds?.xMin, bounds?.xMax, [-half, half])
  const [yMin, yMax] = axis(scales.y, bounds?.yMin, bounds?.yMax, [-6, 6])
  return { xMin, xMax, yMin, yMax }
}

/** One-axis zoom changes the unit ratio, so it is for an authored ratio or auto only; equal (null) keeps it. */
export function axisZoomAllowedFor(aspect: PlotAspect | null): boolean {
  return aspect?.kind === 'ratioXY' || aspect?.kind === 'auto'
}

/**
 * The aspect the 2D camera starts with. An authored @aspect wins; with none, a fully authored @bounds window
 * (parse requires all four numbers) is honoured exactly ('auto', the window stretches to the screen); with
 * neither, null = equal.
 */
export function resolvePlotAspect(config: Pick<GraphConfig, 'bounds'> & { space: { aspect: PlotAspect | null } }): PlotAspect | null {
  if (config.space.aspect) return config.space.aspect
  const b = config.bounds
  return b && [b.xMin, b.xMax, b.yMin, b.yMax].every((v) => typeof v === 'number') ? { kind: 'auto' } : null
}
