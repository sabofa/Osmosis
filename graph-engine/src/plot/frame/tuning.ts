// Every tuned number of the plot frame lives here.
export const FRAME = {
  /** Largest label magnitude at which tick labels switch to scientific notation. */
  sciMagnitude: 1e5,
  /** Tick step below which tick labels switch to scientific notation. */
  sciStep: 1e-4,
  /** Pixels per decade from which a log axis shows its 2-9 minor ticks. */
  minorMinPxPerDecade: 120,
  /** A log axis spanning more decades than this shows only every k-th decade. */
  maxDecades: 12,
} as const

/** The rational-multiple-of-pi steps a pi axis may use, ascending in value. */
export const PI_LADDER: readonly { readonly num: number; readonly den: number }[] = [
  { num: 1, den: 12 },
  { num: 1, den: 6 },
  { num: 1, den: 4 },
  { num: 1, den: 2 },
  { num: 1, den: 1 },
  { num: 2, den: 1 },
  { num: 4, den: 1 },
  { num: 5, den: 1 },
  { num: 10, den: 1 },
  { num: 20, den: 1 },
  { num: 50, den: 1 },
  { num: 100, den: 1 },
]

/** Relative slack when comparing a ladder step with a rough step. */
export const PI_STEP_EPS = 1e-9

/** Axis titles: the estimated text box and the inset from the view edge / axis line. */
export const TITLE = {
  charPx: 7,
  heightPx: 16,
  marginPx: 8,
} as const

/** Inset (px) of pinned tick labels from the view edge. */
export const LABEL_MARGIN_PX = { x: 20, y: 14 } as const
/** How far (px) an on-axis tick label sits below / left of its axis line. */
export const LABEL_OFFSET_PX = { x: 14, y: 14 } as const

/** Tick count a linear or pi axis aims for. */
export const TARGET_DIVISIONS = 6
/** Fewest divisions a configured step may give before the axis picks its own. */
export const MIN_DIVISIONS = 3
/** Most divisions a configured step may give before the axis picks its own. */
export const MAX_DIVISIONS = 14
/** Hard cap on ticks per axis. */
export const MAX_TICKS = 10000

/**
 * How far a plot view may zoom, relative to the fitted @bounds window (zoom 1). The spec wants the view height to
 * span 1e-9 .. 1e12 world units; the default window is 12 units tall, so max = 12 / 1e-9 (rounded up) and
 * min = 12 / 1e12 (rounded down) reach heights of 6e-10 .. 1.2e12.
 */
export const PLOT_ZOOM = { min: 1e-11, max: 2e10 } as const

/** The window a log axis shows when @bounds gives it no range (world values, before log10). */
export const DEFAULT_LOG_WINDOW = { min: 0.1, max: 10 } as const
