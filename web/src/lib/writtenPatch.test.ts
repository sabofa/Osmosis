import { describe, it, expect } from 'vitest'
import { writtenTextPatch } from './writtenPatch'

describe('writtenTextPatch', () => {
  // The bug this exists to prevent: `b` on a written item sends skipped: true,
  // and the next typed answer has to take it back, or the response stays a
  // blank that happens to carry text — invisible to model grading and reported
  // as skipped by get_attempt.
  it('clears skipped whenever there is something in the box', () => {
    expect(writtenTextPatch('2 moles', 1200)).toEqual({
      response_text: '2 moles',
      skipped: false,
      elapsed_ms: 1200,
    })
  })

  it('marks an empty box skipped, whitespace included', () => {
    expect(writtenTextPatch('', 0).skipped).toBe(true)
    expect(writtenTextPatch('   \n\t ', 0).skipped).toBe(true)
  })

  it('always says what skipped is, so a PATCH can never leave a stale one', () => {
    for (const text of ['', ' ', 'x', 'a longer answer']) {
      expect('skipped' in writtenTextPatch(text, 5)).toBe(true)
    }
  })

  it('sends the text verbatim — only the flag is derived', () => {
    expect(writtenTextPatch('  padded  ', 7).response_text).toBe('  padded  ')
  })
})
