import { hatchFamily } from './hatch'
import { MARK_BUDGET } from './region'
import type { FillType } from './types'

// CROSSHATCH — two hatch families a quarter turn apart: `angle`, then
// `angle` + 90 degrees. Denser and darker than hatching at the same spacing.
//
// At roughness > 0 the second family is not quite a quarter turn from the
// first: one seeded draw nudges it by up to 10 degrees either way, on top of
// whatever roughness does inside each family (hatch.ts).

export const crosshatch: FillType = {
  draw: (input) => {
    const r = input.settings.roughness
    const second = input.settings.angle + 90 + (r > 0 ? input.random.range(-10, 10) * r : 0)
    return {
      // Two families, each with half the region's mark budget.
      marks: [
        {
          kind: 'lines',
          chains: [...hatchFamily(input, input.settings.angle, MARK_BUDGET.length / 2), ...hatchFamily(input, second, MARK_BUDGET.length / 2)],
        },
      ],
    }
  },
}
