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
}

export type { PaperInput, PaperOutput, PaperType } from './types'
