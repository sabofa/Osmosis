// The blackboard: slate with an erased haze of chalk (board.ts), from its own seed stream.

import type { Structure } from '../structure'
import { buildBoard } from './board'

export const buildBlackboard = (size: number, seed: string): Structure => buildBoard('blackboard', size, seed)
