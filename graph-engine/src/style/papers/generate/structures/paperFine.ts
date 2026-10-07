// Fine writing paper: a quiet, even tooth you notice only up close, and the faint cloudiness paper
// has where its fibres settled thicker or thinner.

import type { Structure } from '../structure'
import { buildGrain } from './grain'
import type { GrainSpec } from './grain'

const SPEC: GrainSpec = {
  tooth: { cells: 300, octaves: 2, amount: 0.009 },
  cloud: { cells: 4, octaves: 3, amount: 0.004 },
  heightSd: 0.12,
}

export const buildPaperFine = (size: number, seed: string): Structure => buildGrain('paperFine', size, seed, SPEC)
