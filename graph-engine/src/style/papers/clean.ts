import { sheet } from './common'
import type { PaperType } from './types'

// CLEAN — flat paper colour and nothing else.

export const clean: PaperType = {
  draw: ({ view, tint }) => ({ defs: [], background: [sheet(view, tint)] }),
}
