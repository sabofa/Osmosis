// Kraft: unbleached paper made of long fibres, the light and the dark of them showing, a mottled tone,
// and the sparse dark flecks of bark and bits of the pulp that did not break down. (The brown is the
// base tone's, which pulls the theme's paper toward kraft: generated.ts, `paperBaseColour`.)

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 200, octaves: 2, amount: 0.012 },
  cloud: { cells: 3, octaves: 3, amount: 0.02 },
  fibres: {
    count: 3200,
    len: [30, 190],
    curl: 0.16,
    wid: [0.7, 1.7],
    alpha: [0.22, 0.45],
    colours: [
      { delta: [0.09, 0.003, 0.02], weight: 2 },
      { delta: [-0.15, 0.008, 0.028], weight: 2 },
    ],
  },
  flecks: {
    count: 150,
    radius: [0.8, 2.6],
    stretch: [0.35, 1],
    alpha: [0.55, 1],
    delta: [
      [-0.26, 0.01, 0.025],
      [-0.38, 0.015, 0.035],
    ],
  },
  heightSd: 0.06,
}

export const buildKraft = (size: number, seed: string): Structure => buildGrain('kraft', size, seed, SPEC)
