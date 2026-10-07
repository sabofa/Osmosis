import type { PaperType as PaperTypeName } from '../tokens'
import { clean } from './clean'
import type { GeneratedPaperType } from './generate/types'
import { generatedPaper } from './generated'
import { none } from './none'
import type { Waver } from './rulings'
import type { PaperType } from './types'

// The papers, by name. Every one but none and clean is a generated paper (generated.ts): a flat sheet, a pattern
// tile found by its key, hand-drawn rulings and, on the dark boards, tray dust. The old names are kept and map onto
// the generated types; a new paper is a generated type (generate/) and an entry here (plus its name in tokens.ts's
// PAPER_TYPES).
const generated = (type: GeneratedPaperType, waver?: Waver): PaperType => ({ draw: (input) => generatedPaper(type, input, waver) })

export const PAPERS: Record<PaperTypeName, PaperType> = {
  none,
  clean,
  paper: generated('paperFine'),
  'rough-paper': generated('paperRough'),
  canvas: generated('canvas'),
  graph: generated('graphPaper', 'slight'),
  'rough-graph': generated('graphPaper', 'rough'),
  dotted: generated('dotted'),
  ruled: generated('notebook'),
  kraft: generated('kraft'),
  linen: generated('linen'),
  blackboard: generated('blackboard'),
  greenboard: generated('greenboard'),
  whiteboard: generated('whiteboard'),
}

export type { PaperInput, PaperOutput, PaperType } from './types'
