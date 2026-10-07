// A notebook page: a quiet tooth, to draw the ruled lines over (papers/rulings.ts, which draws them by
// hand in SVG over this tile).

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 300, octaves: 2, amount: 0.007 },
  cloud: { cells: 4, octaves: 3, amount: 0.003 },
  heightSd: 0.09,
}

export const buildNotebook = (size: number, seed: string): Structure => buildGrain('notebook', size, seed, SPEC)
