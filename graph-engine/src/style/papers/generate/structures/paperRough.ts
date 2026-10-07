// Rough paper (cartridge, sketchbook): a coarse, blotchy tooth with a finer grain riding on it, and long
// fibres lying through the sheet, mostly pale and some darker.

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 110, octaves: 4, amount: 0.016 },
  fine: { cells: 300, octaves: 2, amount: 0.006 },
  cloud: { cells: 5, octaves: 3, amount: 0.008 },
  fibres: {
    count: 280,
    len: [40, 170],
    curl: 0.07,
    wid: [0.6, 1.1],
    alpha: [0.05, 0.1],
    colours: [
      { delta: [0.05, 0, 0.004], weight: 3 },
      { delta: [-0.07, 0.002, 0.01], weight: 1 },
    ],
  },
  heightSd: 0.22,
}

export const buildPaperRough = (size: number, seed: string): Structure => buildGrain('paperRough', size, seed, SPEC)
