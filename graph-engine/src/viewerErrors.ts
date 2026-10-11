// GraphViewer's rule for telling its host about errors. A text or theme rebuild
// always delivers the list. A pan or zoom rebuild builds the 2D scene again, and
// that scene's errors depend on the view ("this curve is undefined everywhere in
// view" for y = ln(x) once the view is left of 0), so it delivers the list too —
// but only when it differs from the last one delivered, so a drag does not
// re-render the host on every frame.

import type { ParseError } from './parser/types'

// Two error lists are the same when they hold the same errors, line and message,
// in the same order.
export function sameErrors(a: readonly ParseError[], b: readonly ParseError[]): boolean {
  return a.length === b.length && a.every((error, i) => error.line === b[i].line && error.message === b[i].message)
}

export interface ErrorReporter {
  // The text and theme path: always delivers.
  report(errors: ParseError[]): void
  // The pan and zoom path: delivers only a list that differs from the last
  // delivered (or the first list, if none has been).
  reportIfChanged(errors: ParseError[]): void
}

export function createErrorReporter(deliver: (errors: ParseError[]) => void): ErrorReporter {
  let last: ParseError[] | null = null
  return {
    report(errors) {
      last = errors
      deliver(errors)
    },
    reportIfChanged(errors) {
      if (last && sameErrors(last, errors)) return
      last = errors
      deliver(errors)
    },
  }
}
