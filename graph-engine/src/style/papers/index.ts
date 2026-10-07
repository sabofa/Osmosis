import type { PaperType as PaperTypeName } from '../tokens'
import { canvas } from './canvas'
import { clean } from './clean'
import { dotted } from './dotted'
import { graph } from './graph'
import { none } from './none'
import { paper } from './paper'
import { roughGraph } from './roughGraph'
import { roughPaper } from './roughPaper'
import { ruled } from './ruled'
import type { PaperType } from './types'

// The papers, by name. A new paper is a new file beside these, and one entry
// here (plus its name in tokens.ts's PAPER_TYPES).
//
// The three boards are a flat sheet of the board's colour for now: the pen hands
// the paper that colour as its tint (the theme's board, figure/medium.ts), so a
// board paper is clean's sheet. The generated board backgrounds (slate grain,
// erased haze, tray dust) replace these entries.
export const PAPERS: Record<PaperTypeName, PaperType> = {
  none,
  clean,
  paper,
  'rough-paper': roughPaper,
  canvas,
  graph,
  'rough-graph': roughGraph,
  dotted,
  ruled,
  blackboard: clean,
  greenboard: clean,
  whiteboard: clean,
}

export type { PaperInput, PaperOutput, PaperType } from './types'
