import { hatchFamily } from './hatch'
import type { FillType } from './types'

// CROSSHATCH — two hatch families a quarter turn apart: `angle`, then
// `angle` + 90 degrees. Denser and darker than hatching at the same spacing.

export const crosshatch: FillType = {
  draw: (input) => ({
    marks: [{ kind: 'lines', chains: [...hatchFamily(input, input.settings.angle), ...hatchFamily(input, input.settings.angle + 90)] }],
  }),
}
