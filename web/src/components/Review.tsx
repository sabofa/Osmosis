import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { SubjectIcon, CheckIcon, HalfIcon, XIcon } from './icons'
import { gradeResponse, type AttemptDetail, type AttemptResponse } from '../lib/api'
import { iconForTags } from '../lib/templateView'
import QuestionPanel from './QuestionPanel'
import QuestionDetail from './QuestionDetail'
import { usePanelWidth } from '../hooks/usePanelWidth'
import './Review.css'

type Verdict = 'correct' | 'partial' | 'incorrect'

// mc responses are always auto-graded at submit time (attempts.ts submitAttempt),
// so `grade` is only ever missing here for a written response nobody has
// self-graded yet — that's the `null` (ungraded, not "wrong") case.
function verdictFor(response: AttemptResponse): Verdict | null {
  if (!response.grade) return null
  if (response.grade.score >= 1) return 'correct'
  if (response.grade.score <= 0) return 'incorrect'
  return 'partial'
}

const VERDICT_SCORE: Record<Verdict, number> = { correct: 1, partial: 0.5, incorrect: 0 }

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
  const verdict = verdictFor(response)
  const icon = useMemo(() => iconForTags(question.tags), [question.tags])
  const hasPanel = !!question.graph_spec || !!question.desmos_allowed || !!question.document_id
  const { width: panelWidth, onPointerDown: onPanelResizeStart } = usePanelWidth(
    'osmosis:panel-width:review',
    300,
    220,
    Math.round(window.innerWidth * 0.75)
  )

  const graded = questions.map((r) => verdictFor(r)).filter((v): v is Verdict => v !== null)
  const scoreSum = graded.reduce((sum, v) => sum + VERDICT_SCORE[v], 0)
  const meanScore = questions.length > 0 ? scoreSum / questions.length : 0
  const correctCount = graded.filter((v) => v === 'correct').length
  const incorrectCount = graded.filter((v) => v === 'incorrect').length
  const partialCount = graded.filter((v) => v === 'partial').length

  const tagCounts = new Map<string, number>()
  questions.forEach((r) => {
    const tag = r.question.tags[0] ?? 'general'
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  })

  async function setVerdict(v: Verdict) {
    setGrading(true)
    try {
      const graded = await gradeResponse(response.id, { grader: 'self', score: VERDICT_SCORE[v], override: true })
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              responses: prev.responses.map((r) =>
                r.id === response.id
                  ? { ...r, grade: { grader: 'self', score: graded.score, feedback: null, graded_at: graded.graded_at } }
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

  const correctChoiceId = question.choices.find((c) => c.is_correct)?.id

  function handleJumpToQuestion(questionId: string) {
    const targetIndex = questions.findIndex((r) => r.question.id === questionId)
    if (targetIndex !== -1) setIndex(targetIndex)
    else setJumpQuestionId(questionId)
  }

  return (
    <div className="review">
      <div className="review-index">
        {questions.map((r, i) => {
          const v = verdictFor(r)
          let cls = 'review-index-item'
          if (v) cls += ` ${v}`
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
        <div className="panel review-detail">
          <div className="review-slide" key={index}>
          <div className="review-detail-header">
            <span className="review-detail-icon">
              <SubjectIcon icon={icon} size={18} />
            </span>
            <div>
              <div className="review-detail-kicker">
                Question {index + 1} of {questions.length} &middot; {question.tags[0] ?? 'general'}
              </div>
              <div className="review-detail-prompt">{question.prompt}</div>
            </div>
            {verdict && (
              <span className={`review-verdict-badge ${verdict}`}>
                {verdict === 'correct' && <CheckIcon size={13} />}
                {verdict === 'incorrect' && <XIcon size={13} />}
                {verdict === 'partial' && <HalfIcon size={13} />}
                {verdict}
              </span>
            )}
          </div>

          {question.type === 'mc' ? (
            <div className="review-choices">
              {question.choices.map((c) => {
                let cls = 'review-choice'
                if (c.id === correctChoiceId) cls += ' correct'
                if (c.id === response.selected_choice_id && c.id !== correctChoiceId) cls += ' incorrect'
                return (
                  <div className={cls} key={c.id}>
                    <span>{c.body}</span>
                    {c.id === response.selected_choice_id && <span className="review-choice-tag">your answer</span>}
                    {c.id === correctChoiceId && <span className="review-choice-tag">correct</span>}
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
              <div className="review-written-col">
                <div className="review-written-kicker">Model answer</div>
                <div className="review-written-text">{question.model_answer}</div>
                {question.rubric != null && (
                  <div className="review-written-rubric">
                    Rubric: {typeof question.rubric === 'string' ? question.rubric : JSON.stringify(question.rubric)}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="review-explanation">{question.explanation}</div>

          {question.type === 'written' && (
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
            <div className="review-score">{meanScore.toFixed(2)}</div>
            <div className="review-score-sub">
              {correctCount} correct &middot; {incorrectCount} incorrect{partialCount > 0 ? ` · ${partialCount} partial` : ''}
            </div>
            <div className="review-tags">
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
          <div className="review-panel">
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
