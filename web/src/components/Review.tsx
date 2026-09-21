import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { SubjectIcon, CheckIcon, HalfIcon, XIcon, ClockIcon } from './icons'
import { gradeResponse, attemptRevealed, type AttemptDetail } from '../lib/api'
import { outcomeFor, countOutcomes, OUTCOME_LABELS, type Outcome } from '../lib/reviewOutcome'
import { iconForTags } from '../lib/templateView'
import QuestionPanel from './QuestionPanel'
import QuestionDetail from './QuestionDetail'
import RichText from './RichText'
import { usePanelWidth } from '../hooks/usePanelWidth'
import './Review.css'

type Verdict = 'correct' | 'partial' | 'incorrect'

const VERDICT_SCORE: Record<Verdict, number> = { correct: 1, partial: 0.5, incorrect: 0 }

function verdictFromOutcome(outcome: Outcome | null): Verdict | null {
  return outcome === 'correct' || outcome === 'partial' || outcome === 'incorrect' ? outcome : null
}

export default function Review({
  attempt,
  setAttempt,
  onExit,
}: {
  attempt: AttemptDetail
  setAttempt: Dispatch<SetStateAction<AttemptDetail | null>>
  onExit: () => void
}) {
  const [index, setIndex] = useState(0)
  const [grading, setGrading] = useState(false)
  const [jumpQuestionId, setJumpQuestionId] = useState<string | null>(null)
  const questions = attempt.responses
  const response = questions[index]
  const question = response.question

  // §7.3: a deferred attempt shows what was recorded and nothing more until
  // the session ends. The server already withholds the key — this is the
  // screen agreeing with it rather than rendering a page full of blanks.
  const revealed = attemptRevealed(attempt)
  const held = attempt.reveal === 'deferred' && !revealed

  const outcome = outcomeFor(response, revealed)
  const verdict = verdictFromOutcome(outcome)
  const icon = useMemo(() => iconForTags(question.tags), [question.tags])
  const hasPanel = !!question.graph_spec || !!question.desmos_allowed || !!question.document_id
  const { width: panelWidth, onPointerDown: onPanelResizeStart } = usePanelWidth(
    'osmosis:panel-width:review',
    300,
    220,
    Math.round(window.innerWidth * 0.75)
  )

  const counts = countOutcomes(questions, revealed)

  const tagCounts = new Map<string, number>()
  questions.forEach((r) => {
    const tag = r.question.tags[0] ?? 'general'
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  })

  async function setVerdict(v: Verdict) {
    setGrading(true)
    try {
      const saved = await gradeResponse(response.id, { grader: 'self', score: VERDICT_SCORE[v], override: true })
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              responses: prev.responses.map((r) =>
                r.id === response.id
                  ? {
                      ...r,
                      outcome: v,
                      grade: { grader: 'self', score: saved.score, feedback: null, graded_at: saved.graded_at },
                    }
                  : r
              ),
            }
          : prev
      )
    } catch (err) {
      window.alert(`Could not save grade: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGrading(false)
    }
  }

  // Only ever present on a revealed payload; under a hold the choices come
  // back without is_correct at all.
  const correctChoiceId = question.choices.find((c) => c.is_correct)?.id
  const bestGuessChoiceId = response.best_guess_choice_id ?? null

  function handleJumpToQuestion(questionId: string) {
    const targetIndex = questions.findIndex((r) => r.question.id === questionId)
    if (targetIndex !== -1) setIndex(targetIndex)
    else setJumpQuestionId(questionId)
  }

  return (
    <div className="review">
      <div className="review-index no-scrollbar">
        {questions.map((r, i) => {
          const o = outcomeFor(r, revealed)
          let cls = 'review-index-item'
          cls += o ? ` ${o}` : ' recorded'
          if (i === index) cls += ' current'
          return (
            <button key={r.id} className={cls} onClick={() => setIndex(i)} aria-label={`Question ${i + 1}`} />
          )
        })}
      </div>

      <div
        className={`review-main${hasPanel ? ' with-panel' : ''}`}
        style={hasPanel ? { gridTemplateColumns: `1.3fr 0.9fr 14px ${panelWidth}px` } : undefined}
      >
        <div className="panel review-detail no-scrollbar">
          <div className="review-slide" key={index}>
          <div className="review-detail-header">
            <span className="review-detail-icon">
              <SubjectIcon icon={icon} size={18} />
            </span>
            <div>
              <div className="review-detail-kicker">
                Question {index + 1} of {questions.length} &middot; {question.tags[0] ?? 'general'}
              </div>
              <RichText className="review-detail-prompt" text={question.prompt} />
            </div>
            {held ? (
              <span className="review-verdict-badge recorded">
                <ClockIcon size={13} />
                recorded
              </span>
            ) : (
              outcome && (
                <span className={`review-verdict-badge ${outcome}`}>
                  {outcome === 'correct' && <CheckIcon size={13} />}
                  {outcome === 'incorrect' && <XIcon size={13} />}
                  {outcome === 'partial' && <HalfIcon size={13} />}
                  {OUTCOME_LABELS[outcome]}
                </span>
              )
            )}
          </div>

          {question.type === 'mc' ? (
            <div className="review-choices">
              {question.choices.map((c) => {
                let cls = 'review-choice'
                if (!held) {
                  if (c.id === correctChoiceId) cls += ' correct'
                  if (c.id === response.selected_choice_id && c.id !== correctChoiceId) cls += ' incorrect'
                }
                return (
                  <div className={cls} key={c.id}>
                    <RichText inline text={c.body} />
                    {c.id === response.selected_choice_id && <span className="review-choice-tag">your answer</span>}
                    {c.id === bestGuessChoiceId && (
                      <span className="review-choice-tag">best guess (not scored)</span>
                    )}
                    {!held && c.id === correctChoiceId && <span className="review-choice-tag">correct</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="review-written">
              <div className="review-written-col">
                <div className="review-written-kicker">Your answer</div>
                <div className="review-written-text">{response.response_text || '(no answer given)'}</div>
              </div>
              {!held && (
                <div className="review-written-col">
                  <div className="review-written-kicker">Model answer</div>
                  <RichText className="review-written-text" text={question.model_answer ?? ''} />
                  {question.rubric != null && (
                    <div className="review-written-rubric">
                      Rubric:{' '}
                      <RichText
                        inline
                        text={typeof question.rubric === 'string' ? question.rubric : JSON.stringify(question.rubric)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {held ? (
            <div className="review-held-note">
              Recorded. The tutor reveals the answers when this session ends.
            </div>
          ) : (
            <>
              {response.idk && (
                <div className="review-idk-note">
                  You said you didn't know
                  {response.best_guess_correct === true
                    ? ' — your best guess was right, which is worth knowing.'
                    : response.best_guess_correct === false
                      ? ' — your best guess missed.'
                      : '.'}
                </div>
              )}
              <RichText className="review-explanation" text={question.explanation ?? ''} />
              {response.diagnosis && (
                <div className="review-diagnosis">
                  <div className="review-diagnosis-label">What the tutor saw</div>
                  <RichText className="review-diagnosis-body" text={response.diagnosis} />
                </div>
              )}
              {response.chosen_misconception && (
                <div className="review-misconception">
                  <div className="review-diagnosis-label">The misconception behind that choice</div>
                  <RichText className="review-diagnosis-body" text={response.chosen_misconception} />
                </div>
              )}
            </>
          )}

          {question.type === 'written' && !held && (
            <div className="review-grade-actions">
              <button
                className={`grade-btn correct${verdict === 'correct' ? ' chosen' : ''}`}
                onClick={() => setVerdict('correct')}
                disabled={grading}
              >
                <CheckIcon size={13} />
                Correct
              </button>
              <button
                className={`grade-btn partial${verdict === 'partial' ? ' chosen' : ''}`}
                onClick={() => setVerdict('partial')}
                disabled={grading}
              >
                <HalfIcon size={13} />
                Partial
              </button>
              <button
                className={`grade-btn incorrect${verdict === 'incorrect' ? ' chosen' : ''}`}
                onClick={() => setVerdict('incorrect')}
                disabled={grading}
              >
                <XIcon size={13} />
                Incorrect
              </button>
            </div>
          )}
          </div>
        </div>

        <div className="review-side">
          <div className="panel review-summary">
            <div className="review-kicker">General results</div>
            <div className="review-score">
              {held ? counts.recorded : counts.mean_score === null ? '—' : counts.mean_score.toFixed(2)}
            </div>
            {held ? (
              <div className="review-score-sub">
                {counts.recorded === 1 ? 'answer recorded' : 'answers recorded'} &middot; held until the session ends
              </div>
            ) : (
              <div className="review-score-sub">
                {/* An idk is its own column, never folded into incorrect (§7.3). */}
                {counts.correct} correct &middot; {counts.incorrect} incorrect &middot; {counts.dont_know} don't know
                &middot; {counts.ungraded} ungraded
                {counts.partial > 0 ? ` · ${counts.partial} partial` : ''}
              </div>
            )}
            <div className="review-tags no-scrollbar">
              {[...tagCounts.entries()].map(([tag, count]) => (
                <div className="review-tag-row" key={tag}>
                  <span>{tag}</span>
                  <span className="review-tag-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="review-exit-btn" onClick={onExit}>
            Exit test
          </button>
        </div>

        {hasPanel && (
          <div
            className="panel-resize-handle"
            onPointerDown={onPanelResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
          />
        )}

        {hasPanel && (
          <div className="review-panel no-scrollbar">
            <QuestionPanel
              graphSpec={question.graph_spec}
              desmosAllowed={question.desmos_allowed}
              documentId={question.document_id}
              documentAnchorLabel={question.document_anchor_label}
              documentAnchorStart={question.document_anchor_start}
              documentAnchorEnd={question.document_anchor_end}
              onJumpToQuestion={handleJumpToQuestion}
            />
          </div>
        )}
      </div>

      {jumpQuestionId && (
        <QuestionDetail
          id={jumpQuestionId}
          onClose={() => setJumpQuestionId(null)}
          onJumpToQuestion={handleJumpToQuestion}
        />
      )}
    </div>
  )
}
