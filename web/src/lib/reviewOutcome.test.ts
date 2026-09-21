import { describe, it, expect } from 'vitest'
import { outcomeFor, countOutcomes, OUTCOME_LABELS } from './reviewOutcome'

describe('outcomeFor', () => {
  it('holds everything back until the attempt is revealed', () => {
    expect(outcomeFor({ outcome: 'correct', grade: { score: 1 } }, false)).toBeNull()
  })

  it('takes the server outcome when it has one', () => {
    expect(outcomeFor({ outcome: 'partial', grade: { score: 0.5 } }, true)).toBe('partial')
    expect(outcomeFor({ outcome: 'dont_know', idk: true, grade: null }, true)).toBe('dont_know')
    expect(outcomeFor({ outcome: 'ungraded', grade: null }, true)).toBe('ungraded')
  })

  it('falls back to the score only when the server sent no outcome', () => {
    expect(outcomeFor({ grade: { score: 1 } }, true)).toBe('correct')
    expect(outcomeFor({ grade: { score: 0 } }, true)).toBe('incorrect')
    expect(outcomeFor({ grade: { score: 0.5 } }, true)).toBe('partial')
    expect(outcomeFor({ grade: null }, true)).toBe('ungraded')
  })

  it("keeps a don't know out of incorrect in the fallback too", () => {
    expect(outcomeFor({ idk: true, grade: { score: 0 } }, true)).toBe('dont_know')
  })
})

describe('countOutcomes', () => {
  const responses = [
    { outcome: 'correct' as const, grade: { score: 1 } },
    { outcome: 'correct' as const, grade: { score: 1 } },
    { outcome: 'incorrect' as const, grade: { score: 0 } },
    { outcome: 'dont_know' as const, idk: true, grade: null },
    { outcome: 'partial' as const, grade: { score: 0.5 } },
    { outcome: 'ungraded' as const, grade: null },
  ]

  it('counts each outcome separately', () => {
    expect(countOutcomes(responses, true)).toEqual({
      correct: 2,
      incorrect: 1,
      dont_know: 1,
      partial: 1,
      ungraded: 1,
      recorded: 6,
      // 1 + 1 + 0 + 0.5 over the four graded rows; the idk and the ungraded
      // one are absent from the average, not zeroes in it.
      mean_score: 0.625,
    })
  })

  it('counts nothing but the recorded total under a hold', () => {
    expect(countOutcomes(responses, false)).toEqual({
      correct: 0,
      incorrect: 0,
      dont_know: 0,
      partial: 0,
      ungraded: 0,
      recorded: 6,
      mean_score: null,
    })
  })

  it('has no mean when nothing was graded', () => {
    expect(countOutcomes([{ grade: null }], true).mean_score).toBeNull()
  })

  it('averages the graded rows only', () => {
    expect(countOutcomes([{ grade: { score: 1 } }, { grade: { score: 0 } }, { grade: null }], true).mean_score).toBe(0.5)
  })
})

describe('OUTCOME_LABELS', () => {
  it("spells a don't know out in words", () => {
    expect(OUTCOME_LABELS.dont_know).toBe("don't know")
    expect(OUTCOME_LABELS.correct).toBe('correct')
  })
})
