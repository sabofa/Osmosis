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
