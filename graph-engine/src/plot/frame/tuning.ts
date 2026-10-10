// Every tuned number of the plot frame lives here.
export const FRAME = {
  /** Largest label magnitude at which tick labels switch to scientific notation. */
  sciMagnitude: 1e5,
  /** Tick step below which tick labels switch to scientific notation. */
  sciStep: 1e-4,
} as const
