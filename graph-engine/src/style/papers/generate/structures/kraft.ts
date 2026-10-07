// Kraft: unbleached paper made of long fibres, the light and the dark of them showing, a mottled tone,
// and the sparse dark flecks of bark and bits of the pulp that did not break down. (The brown is the
// base tone's, which pulls the theme's paper toward kraft: generated.ts, `paperBaseColour`.)

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 200, octaves: 2, amount: 0.008 },
  cloud: { cells: 3, octaves: 3, amount: 0.014 },
  fibres: {
    count: 1500,
    len: [25, 150],
    curl: 0.1,
    wid: [0.6, 1.4],
    alpha: [0.1, 0.22],
    colours: [
      { delta: [0.07, 0.002, 0.016], weight: 2 },
      { delta: [-0.11, 0.006, 0.022], weight: 2 },
    ],
  },
  flecks: {
    count: 90,
    radius: [0.7, 2],
    stretch: [0.35, 1],
    alpha: [0.55, 1],
    delta: [
      [-0.2, 0.008, 0.02],
      [-0.3, 0.012, 0.03],
    ],
  },
  heightSd: 0.06,
}

export const buildKraft = (size: number, seed: string): Structure => buildGrain('kraft', size, seed, SPEC)
