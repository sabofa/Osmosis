// Graph paper: a quiet tooth, a shade livelier than a notebook's, under the squares (papers/rulings.ts
// draws them by hand in SVG over this tile).

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 300, octaves: 2, amount: 0.008 },
  cloud: { cells: 4, octaves: 3, amount: 0.0035 },
  heightSd: 0.1,
}

export const buildGraphPaper = (size: number, seed: string): Structure => buildGrain('graphPaper', size, seed, SPEC)
