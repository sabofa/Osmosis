import { hatchFamily } from './hatch'
import { MARK_BUDGET } from './region'
import type { FillType } from './types'

// CROSSHATCH — two hatch families a quarter turn apart: `angle`, then
// `angle` + 90 degrees. Denser and darker than hatching at the same spacing.

export const crosshatch: FillType = {
  draw: (input) => ({
    // Two families, each with half the region's mark budget.
    marks: [
      {
        kind: 'lines',
        chains: [...hatchFamily(input, input.settings.angle, MARK_BUDGET.length / 2), ...hatchFamily(input, input.settings.angle + 90, MARK_BUDGET.length / 2)],
      },
    ],
  }),
}
