import type { PaperType } from './types'

// NONE — no paper: the figure is transparent, for embedding on a page that
// has its own background.

export const none: PaperType = {
  draw: () => ({ defs: [], background: [] }),
}
