// ----------------------------------------------------------------------------
// What a written answer sends, kept pure because the `skipped` flag is easy to
// get wrong and impossible to see going wrong.
//
// The response PATCH has PATCH semantics: a key the body leaves out is left
// alone on the row. `skipped` is therefore sticky — pressing `b` on a written
// item sends `skipped: true`, and every later save that does not mention
// `skipped` leaves the response marked as a deliberate blank no matter what
// the learner went on to type. A skipped row is invisible to model grading
// (`server/src/domain/modelGrading.ts` selects on `skipped = 0`) and reads back
// from `get_attempt` as "skipped" beside the text it is carrying.
//
// So every write of the text says what the text means: something in the box is
// an answer, an empty box is a blank. Choice items already do this — see
// `selectChoice`, which sends `skipped: false` with the choice.
// ----------------------------------------------------------------------------

import type { AnswerResponseChanges } from './api'

// The debounced save behind the textarea, and the `b` key's deliberate blank —
// the same payload, because they are the same thing said with different text.
export function writtenTextPatch(text: string, elapsedMs: number): AnswerResponseChanges {
  return {
    response_text: text,
    skipped: text.trim() === '',
    elapsed_ms: elapsedMs,
  }
}
