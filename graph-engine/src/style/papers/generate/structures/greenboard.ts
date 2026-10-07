// The greenboard: the same slate and the same hand as the blackboard (board.ts), on its own seed stream.

import type { Structure } from '../structure'
import { buildBoard } from './board'

export const buildGreenboard = (size: number, seed: string): Structure => buildBoard('greenboard', size, seed)
