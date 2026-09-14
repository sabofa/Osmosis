import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { SubjectIcon, CalcOffIcon, CalcIcon, XIcon, ClockIcon } from './icons'
import { answerResponse, submitAttempt, type AttemptDetail } from '../lib/api'
import { iconForTags } from '../lib/templateView'
import QuestionPanel from './QuestionPanel'
import QuestionDetail from './QuestionDetail'
import { usePanelWidth } from '../hooks/usePanelWidth'
import './Take.css'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const DEFAULT_TIME_LIMIT_SEC = 20 * 60
const WRITTEN_SAVE_DEBOUNCE_MS = 700

// Local, in-progress overlay of a response's editable fields. Seeded from the
// real attempt on mount and pushed to the server via PATCH as the user
// interacts — the source of truth remains `attempt`, but keeping a local
// mirror lets the UI update instantly instead of waiting on each PATCH.
interface DraftResponse {
  selectedChoiceId: string | null
  writtenText: string
  confidence: 'unsure' | 'somewhat' | 'confident' | null
  idk: boolean
}

export default function Take({
  attempt,
  setAttempt,
  onExit,
  onFinish,
}: {
  attempt: AttemptDetail
  setAttempt: Dispatch<SetStateAction<AttemptDetail | null>>
  onExit: () => void
  onFinish: () => void
}) {
  const questions = attempt.responses
  const [index, setIndex] = useState(0)
  const [jumpQuestionId, setJumpQuestionId] = useState<string | null>(null)
  const [maxReached, setMaxReached] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_TIME_LIMIT_SEC)
  const [exiting, setExiting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [drafts, setDrafts] = useState<DraftResponse[]>(() =>
    questions.map((r) => ({
      selectedChoiceId: r.selected_choice_id,
      writtenText: r.response_text ?? '',
      confidence: r.confidence ?? null,
      idk: r.idk ?? false,
    }))
  )
  // Keyed by response id (not a single shared timer) — switching questions
  // mid-debounce must not cancel an earlier question's still-pending save.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Every fire-and-forget PATCH still in flight. Finish must wait for these:
  // a choice picked a beat before clicking Finish would otherwise race the
  // submit, and the server grades whatever it has when submit lands.
  const inFlightSaves = useRef<Set<Promise<unknown>>>(new Set())

  function trackSave<T>(p: Promise<T>): Promise<T> {
    inFlightSaves.current.add(p)
    p.finally(() => inFlightSaves.current.delete(p)).catch(() => {})
    return p
  }
  const { width: panelWidth, onPointerDown: onPanelResizeStart } = usePanelWidth(
    'osmosis:panel-width:take',
    340,
    240,
    Math.round(window.innerWidth * 0.75)
  )

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  // Cancel any pending debounced saves on unmount (their work is flushed
  // explicitly before Finish/submit below, not silently dropped here).
  useEffect(() => {
    return () => {
      for (const t of Object.values(saveTimers.current)) clearTimeout(t)
    }
  }, [])

  const response = questions[index]
  const draft = drafts[index]
  const isLast = index === questions.length - 1
  const question = response.question
  const icon = useMemo(() => iconForTags(question.tags), [question.tags])
  const hasPanel = !!question.graph_spec || !!question.desmos_allowed || !!question.document_id
  const answered =
    question.type === 'mc' ? draft.selectedChoiceId !== null || draft.idk : draft.writtenText.trim().length > 0

  function goTo(i: number) {
    setIndex(i)
    setMaxReached((m) => Math.max(m, i))
  }

  // A document marker's target question is usually part of this same
  // attempt (that's the whole ACT-English-passage use case) — jump to it
  // in place. Otherwise (a marker pointing outside the current draw) fall
  // back to a read-only detail modal rather than doing nothing.
  function handleJumpToQuestion(questionId: string) {
    const targetIndex = questions.findIndex((r) => r.question.id === questionId)
    if (targetIndex !== -1) goTo(targetIndex)
    else setJumpQuestionId(questionId)
  }

  async function next() {
    if (isLast) {
      setFinishing(true)
      try {
        // Flush every question's pending debounced written-answer save (not
        // just the current one) so a fast Finish click can't drop text on a
        // written question the user already navigated away from.
        const pending = Object.entries(saveTimers.current)
        saveTimers.current = {}
        await Promise.all(
          pending.map(([responseId, timer]) => {
            clearTimeout(timer)
            const d = drafts[questions.findIndex((r) => r.id === responseId)]
            return d ? answerResponse(attempt.id, responseId, { response_text: d.writtenText }) : Promise.resolve()
          })
        )
        // ...and every choice/confidence/idk PATCH that hasn't resolved yet.
        await Promise.allSettled([...inFlightSaves.current])
        const submitted = await submitAttempt(attempt.id)
        setAttempt(submitted)
        onFinish()
      } catch (err) {
        setFinishing(false)
        window.alert(`Could not submit: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    goTo(index + 1)
  }

  // "I don't know" and a picked choice are mutually exclusive outcomes (idk
  // is a distinct third signal, not a fourth confidence level) — choosing
  // one clears the other on both the local draft and the server row, so a
  // response can't be submitted as simultaneously skipped AND answered.
  function selectChoice(choiceId: string) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, selectedChoiceId: choiceId, idk: false } : d)))
    trackSave(answerResponse(attempt.id, response.id, { selected_choice_id: choiceId, idk: false, skipped: false })).then((updated) => {
      setAttempt((prev) =>
        prev ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
      )
    }).catch((err) => console.error('Failed to save answer:', err))
  }

  function setConfidence(level: 'unsure' | 'somewhat' | 'confident') {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, confidence: level } : d)))
    trackSave(answerResponse(attempt.id, response.id, { confidence: level })).then((updated) => {
      setAttempt((prev) =>
        prev ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
      )
    }).catch((err) => console.error('Failed to save confidence:', err))
  }

  function setIdk() {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, idk: true, selectedChoiceId: null } : d)))
    trackSave(answerResponse(attempt.id, response.id, { idk: true, skipped: true, selected_choice_id: null })).then((updated) => {
      setAttempt((prev) =>
        prev ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
      )
    }).catch((err) => console.error('Failed to save idk:', err))
  }

  function setWrittenText(text: string) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, writtenText: text } : d)))
    const responseId = response.id
    if (saveTimers.current[responseId]) clearTimeout(saveTimers.current[responseId])
    saveTimers.current[responseId] = setTimeout(() => {
      delete saveTimers.current[responseId]
      answerResponse(attempt.id, responseId, { response_text: text }).then((updated) => {
        setAttempt((prev) =>
          prev ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
        )
      }).catch((err) => console.error('Failed to save answer:', err))
    }, WRITTEN_SAVE_DEBOUNCE_MS)
  }

  function handleExit() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onExit()
      return
    }
    setExiting(true)
    setTimeout(onExit, 380)
  }

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const secs = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className={`take-frame${exiting ? ' exiting' : ''}`}>
      <div className="take-dots">
        {questions.map((r, i) => {
          const d = drafts[i]
          const wasAnswered =
            r.question.type === 'mc' ? d.selectedChoiceId !== null || d.idk : d.writtenText.trim().length > 0
          let cls = 'take-dot'
          if (i === index) cls += ' current'
          else if (wasAnswered) cls += ' answered'
          return (
            <button
              key={r.id}
              className={cls}
              disabled={i > maxReached}
              onClick={() => goTo(i)}
              aria-label={`Question ${i + 1}`}
            />
          )
        })}
      </div>

      <div className="take-main">
        <div className="take-header">
          <button className="exit-btn" onClick={handleExit}>
            <XIcon size={12} />
            Exit quiz
          </button>
          <span className="take-tag">{question.tags[0] ?? 'general'}</span>
          {question.calculator_policy !== 'n_a' && (
            <span className="calc-badge" title={question.calculator_policy}>
              {question.calculator_policy === 'forbidden' ? <CalcOffIcon size={14} /> : <CalcIcon size={14} />}
            </span>
          )}
          <div className="take-spacer" />
          <span className={`timer-badge${secondsLeft < 30 ? ' low' : ''}`}>
            <ClockIcon size={13} />
            {mins}:{secs}
          </span>
        </div>

        <div className="question-card no-scrollbar">
          <div className="question-slide" key={index}>
            <div className="question-tag-row">
              <span className="question-icon">
                <SubjectIcon icon={icon} />
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Question {index + 1} of {questions.length}
              </span>
            </div>
            <div className="question-prompt">{question.prompt}</div>

            {question.type === 'mc' ? (
              <>
                <div className="choices">
                  {question.choices.map((c, i) => {
                    const cls = `choice-btn${draft.selectedChoiceId === c.id ? ' selected' : ''}`
                    return (
                      <button key={c.id} className={cls} onClick={() => selectChoice(c.id)}>
                        <span className="choice-letter">{LETTERS[i]}</span>
                        {c.body}
                      </button>
                    )
                  })}
                </div>

                <div className="confidence-row">
                  <span className="confidence-label">How sure are you?</span>
                  <div className="confidence-buttons">
                    {(['unsure', 'somewhat', 'confident'] as const).map((level) => (
                      <button
                        key={level}
                        className={`confidence-btn${draft.confidence === level ? ' selected' : ''}`}
                        onClick={() => setConfidence(level)}
                      >
                        {level === 'unsure' ? 'Unsure' : level === 'somewhat' ? 'Somewhat' : 'Confident'}
                      </button>
                    ))}
                    <button className={`confidence-btn idk-btn${draft.idk ? ' selected' : ''}`} onClick={setIdk}>
                      I don't know
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <textarea
                className="written-answer"
                placeholder="Type your answer…"
                value={draft.writtenText}
                onChange={(e) => setWrittenText(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="take-nav">
          <span className="take-nav-hint">{answered ? 'Answered' : 'Not answered yet'}</span>
          <button className="nav-btn primary" onClick={next} disabled={finishing}>
            {finishing ? 'Submitting…' : isLast ? 'Finish' : 'Next'} &rarr;
          </button>
        </div>
      </div>

      {hasPanel && (
        <>
          <div
            className="panel-resize-handle"
            onPointerDown={onPanelResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
          />
          <div className="take-panel no-scrollbar" style={{ width: panelWidth }}>
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
        </>
      )}

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
