// ----------------------------------------------------------------------------
// What the Review screen says happened to each response (spec §7.3).
//
// The server decides this — `outcome` on a revealed response is authoritative,
// and it is the only place that knows an idk with a right best guess is still
// a don't know. The score-derived fallback below exists for a node that
// predates the field, and for that reason alone; it keeps the same rule that
// an idk never lands in "incorrect".
// ----------------------------------------------------------------------------

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'dont_know' | 'ungraded'

export const OUTCOME_LABELS: Record<Outcome, string> = {
  correct: 'correct',
  partial: 'partial',
  incorrect: 'incorrect',
  dont_know: "don't know",
  ungraded: 'ungraded',
}

// Structural, so the counts can be tested without building a whole AttemptDetail.
export interface OutcomeInput {
  outcome?: Outcome | null
  idk?: boolean
  grade?: { score: number } | null
}

export interface OutcomeCounts {
  correct: number
  partial: number
  incorrect: number
  dont_know: number
  ungraded: number
  // How many responses exist at all — the only number a held attempt can show.
  recorded: number
  mean_score: number | null
}

export function outcomeFor(response: OutcomeInput, revealed: boolean): Outcome | null {
  if (!revealed) return null
  if (response.outcome) return response.outcome
  if (response.idk) return 'dont_know'
  const score = response.grade?.score
  if (score === undefined || score === null) return 'ungraded'
  if (score >= 1) return 'correct'
  if (score <= 0) return 'incorrect'
  return 'partial'
}

export function countOutcomes(responses: OutcomeInput[], revealed: boolean): OutcomeCounts {
  const counts: OutcomeCounts = {
    correct: 0,
    partial: 0,
    incorrect: 0,
    dont_know: 0,
    ungraded: 0,
    recorded: responses.length,
    mean_score: null,
  }
  if (!revealed) return counts

  let sum = 0
  let graded = 0
  for (const r of responses) {
    const outcome = outcomeFor(r, true)
    if (outcome) counts[outcome] += 1
    const score = r.grade?.score
    if (score !== undefined && score !== null) {
      sum += score
      graded += 1
    }
  }
  counts.mean_score = graded > 0 ? sum / graded : null
  return counts
}
