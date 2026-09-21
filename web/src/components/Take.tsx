import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { SubjectIcon, CalcOffIcon, CalcIcon, XIcon, ClockIcon } from './icons'
import {
  answerResponse,
  submitAttempt,
  pauseAttempt,
  resumeAttempt,
  getTemplate,
  type AttemptDetail,
  type AttemptResponse,
} from '../lib/api'
import { iconForTags } from '../lib/templateView'
import QuestionPanel from './QuestionPanel'
import QuestionDetail from './QuestionDetail'
import RichText from './RichText'
import { usePanelWidth } from '../hooks/usePanelWidth'
import { useKeyboard } from '../hooks/useKeyboard'
import { KEY_HINTS, WRITTEN_KEY_HINTS, type KeyAction } from '../lib/keymap'
import { writtenTextPatch } from '../lib/writtenPatch'
import { createItemClock, type ItemClock } from '../lib/itemClock'
import { formatClock, timerClass, nextTimeUpPhase, type TimeUpPhase } from '../lib/timeFormat'
import './Take.css'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const WRITTEN_SAVE_DEBOUNCE_MS = 700
// How long "Time." stands on its own before the screen offers the way out.
const TIME_UP_MESSAGE_MS = 2000
const TICK_MS = 500

// Local, in-progress overlay of a response's editable fields. Seeded from the
// real attempt on mount and pushed to the server via PATCH as the user
// interacts — the source of truth remains `attempt`, but keeping a local
// mirror lets the UI update instantly instead of waiting on each PATCH.
interface DraftResponse {
  selectedChoiceId: string | null
  writtenText: string
  confidence: 'unsure' | 'somewhat' | 'confident' | null
  idk: boolean
  // The guess offered alongside an idk (§2.3). Never a selection: a best
  // guess is not scored, and conflating the two would quietly turn "I don't
  // know, but maybe B" into an answer of B.
  bestGuessChoiceId: string | null
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
  const [exiting, setExiting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [pausing, setPausing] = useState(false)
  // The template's limit, when this attempt came from one. A live item handed
  // over by the tutor has no template and therefore no set timer — only the
  // per-item clock, which is the honest thing to show for a single item.
  const [setLimitSec, setSetLimitSec] = useState<number | null>(null)
  // 'message' is the two seconds where "Time." stands alone; 'finish' is
  // after, when the way out appears alongside it (lib/timeFormat).
  const [timeUpPhase, setTimeUpPhase] = useState<TimeUpPhase>('none')
  const [drafts, setDrafts] = useState<DraftResponse[]>(() =>
    questions.map((r) => ({
      selectedChoiceId: r.selected_choice_id,
      writtenText: r.response_text ?? '',
      confidence: r.confidence ?? null,
      idk: r.idk ?? false,
      bestGuessChoiceId: r.best_guess_choice_id ?? null,
    }))
  )
  // Re-render so the two timers move; the clocks themselves are refs and
  // advance on their own whether or not anything re-renders.
  const [, setTick] = useState(0)
  // Keyed by response id (not a single shared timer) — switching questions
  // mid-debounce must not cancel an earlier question's still-pending save.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Every fire-and-forget PATCH still in flight. Finish must wait for these:
  // a choice picked a beat before clicking Finish would otherwise race the
  // submit, and the server grades whatever it has when submit lands.
  const inFlightSaves = useRef<Set<Promise<unknown>>>(new Set())
  // The item container, focused whenever a new item lands so the keyboard map
  // has somewhere to act from without the learner reaching for the mouse.
  const itemRef = useRef<HTMLDivElement>(null)

  const paused = attempt.paused_at != null

  function trackSave<T>(p: Promise<T>): Promise<T> {
    inFlightSaves.current.add(p)
    p.finally(() => inFlightSaves.current.delete(p)).catch(() => {})
    return p
  }

  // Time-on-question, one held clock per response id (lib/itemClock). Only the
  // visible question's clock runs, and every clock stops while the tab is
  // hidden or the attempt is paused — so elapsed_ms is time spent looking at
  // the item, not wall time since it appeared. Seeded from the server's stored
  // elapsed_ms so a resumed attempt doesn't restart at zero.
  const clocks = useRef<Record<string, ItemClock>>({})
  // The whole set's clock, subject to the same holds.
  const setClock = useRef<ItemClock>(createItemClock()).current
  const lastSent = useRef<Record<string, number>>(
    Object.fromEntries(questions.map((r) => [r.id, r.elapsed_ms ?? 0]))
  )
  // The currently-visible response id, read live. A debounced written-answer
  // save closes over the `response` from the render when typing happened; if
  // the user has since navigated away, that closure's `response` is stale.
  const currentResponseId = useRef<string>(questions[index]?.id ?? '')

  function clockFor(responseId: string): ItemClock {
    let clock = clocks.current[responseId]
    if (!clock) {
      clock = createItemClock(questions.find((r) => r.id === responseId)?.elapsed_ms ?? 0)
      clocks.current[responseId] = clock
    }
    return clock
  }

  function currentElapsed(responseId: string): number {
    return clockFor(responseId).read(Date.now())
  }

  // Sends elapsed_ms for a response if it moved since the last send.
  function flushElapsed(responseId: string) {
    const ms = Math.round(currentElapsed(responseId))
    if (ms === lastSent.current[responseId]) return
    lastSent.current[responseId] = ms
    trackSave(answerResponse(attempt.id, responseId, { elapsed_ms: ms })).catch((err) =>
      console.error('Failed to save elapsed time:', err)
    )
  }

  const { width: panelWidth, onPointerDown: onPanelResizeStart } = usePanelWidth(
    'osmosis:panel-width:take',
    340,
    240,
    Math.round(window.innerWidth * 0.75)
  )

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // The set clock starts at first paint and, like the item clocks, is held
  // whenever the learner isn't actually looking at the drill.
  useEffect(() => {
    setClock.start(Date.now())
  }, [setClock])

  useEffect(() => {
    let cancelled = false
    if (!attempt.template_id) {
      setSetLimitSec(null)
      return
    }
    getTemplate(attempt.template_id)
      .then((t) => {
        if (!cancelled) setSetLimitSec(t.time_limit_sec ?? null)
      })
      .catch(() => {
        // No limit shown rather than a guessed one: a wrong countdown is
        // worse than none.
      })
    return () => {
      cancelled = true
    }
  }, [attempt.template_id])

  // §2.5: a hidden tab is not time on the question. Holds every clock, and
  // banks what the current item has earned so a tab closed while hidden
  // doesn't lose it.
  useEffect(() => {
    function onVisibility() {
      const at = Date.now()
      const hidden = document.hidden
      for (const clock of [setClock, ...Object.values(clocks.current)]) {
        if (hidden) clock.pause(at, 'hidden')
        else clock.resume(at, 'hidden')
      }
      if (hidden) flushElapsed(currentResponseId.current)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // §7.6: the attempt's own pause stops both clocks for as long as it stands.
  useEffect(() => {
    const at = Date.now()
    for (const clock of [setClock, ...Object.values(clocks.current)]) {
      if (paused) clock.pause(at, 'attempt')
      else clock.resume(at, 'attempt')
    }
  }, [paused, setClock])

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
  // An idk is a recorded answer on either kind of item (§2.2) — a written
  // "I don't know" is a claim, not an empty box.
  const answered =
    question.type === 'mc'
      ? draft.selectedChoiceId !== null || draft.idk
      : draft.writtenText.trim().length > 0 || draft.idk

  // The visible question changed: the one leaving stops counting, the one
  // arriving starts, and focus follows so the keyboard map lands somewhere.
  useEffect(() => {
    const at = Date.now()
    currentResponseId.current = response.id
    const clock = clockFor(response.id)
    clock.start(at)
    clock.resume(at, 'offscreen')
    itemRef.current?.focus()
    return () => {
      clockFor(response.id).pause(Date.now(), 'offscreen')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response.id])

  const setElapsedMs = setClock.read(Date.now())
  const secondsLeft = setLimitSec === null ? null : Math.max(0, setLimitSec - Math.floor(setElapsedMs / 1000))
  const itemElapsedMs = currentElapsed(response.id)

  // §7.2: the set ending is Osmosis's message, not a silent submit. Nothing is
  // sent on the learner's behalf here — today's behaviour when the clock runs
  // out is exactly "the clock stops", and this adds the message and one way
  // out in front of it.
  //
  // The timeout is guarded by a ref rather than by the phase, and the effect
  // that schedules it has no cleanup. Clearing it per render is how 'finish'
  // never arrives: the phase change re-runs the effect, its cleanup cancels
  // the two seconds, and the learner is left with a message and no button.
  // Only unmount clears it — and that path nulls the ref as well, so React's
  // StrictMode double-mount re-schedules rather than stranding the phase.
  const timeUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timeUpTimer.current) clearTimeout(timeUpTimer.current)
      timeUpTimer.current = null
    }
  }, [])

  useEffect(() => {
    setTimeUpPhase((phase) => nextTimeUpPhase(phase, secondsLeft))
    if (secondsLeft !== 0 || timeUpTimer.current) return
    timeUpTimer.current = setTimeout(() => setTimeUpPhase('finish'), TIME_UP_MESSAGE_MS)
  }, [secondsLeft])

  function goTo(i: number) {
    flushElapsed(response.id)
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

  // Submit whatever is on the server now, from wherever the learner is. The
  // set running out (§7.2) finishes from any question, not only the last one.
  async function submitNow() {
    if (finishing) return
    setFinishing(true)
    try {
      flushElapsed(response.id)
      // Flush every question's pending debounced written-answer save (not
      // just the current one) so a fast Finish click can't drop text on a
      // written question the user already navigated away from.
      const pending = Object.entries(saveTimers.current)
      saveTimers.current = {}
      await Promise.all(
        pending.map(([responseId, timer]) => {
          clearTimeout(timer)
          const d = drafts[questions.findIndex((r) => r.id === responseId)]
          // Through the helper like every other write of the text: this flush
          // is the last thing to touch the row before submit, so a bare
          // { response_text } here would be the one that leaves a `b` pressed
          // seconds earlier standing over the answer typed after it.
          return d
            ? answerResponse(
                attempt.id,
                responseId,
                writtenTextPatch(d.writtenText, Math.round(currentElapsed(responseId)))
              )
            : Promise.resolve()
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
  }

  async function next() {
    if (finishing) return
    if (isLast) {
      await submitNow()
      return
    }
    goTo(index + 1)
  }

  // One place for the optimistic "the server took it" merge every PATCH below
  // shares.
  function mergeSaved(saving: Promise<AttemptResponse>, what: string) {
    trackSave(saving)
      .then((updated) => {
        setAttempt((prev) =>
          prev
            ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }
            : prev
        )
      })
      .catch((err) => console.error(`Failed to save ${what}:`, err))
  }

  function patchDraft(changes: Partial<DraftResponse>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...changes } : d)))
  }

  function markSent(): number {
    const ms = Math.round(currentElapsed(response.id))
    lastSent.current[response.id] = ms
    return ms
  }

  // Two steps, never alongside each other (§2.3): while idk stands, a picked
  // choice is a best guess and is not scored; otherwise it is the answer, and
  // picking it clears the idk that would contradict it.
  function selectChoice(choiceId: string) {
    const ms = markSent()
    if (draft.idk) {
      patchDraft({ bestGuessChoiceId: choiceId })
      mergeSaved(
        answerResponse(attempt.id, response.id, { idk: true, best_guess_choice_id: choiceId, elapsed_ms: ms }),
        'best guess'
      )
      return
    }
    patchDraft({ selectedChoiceId: choiceId, idk: false, bestGuessChoiceId: null })
    mergeSaved(
      answerResponse(attempt.id, response.id, {
        selected_choice_id: choiceId,
        idk: false,
        skipped: false,
        elapsed_ms: ms,
      }),
      'answer'
    )
  }

  function setConfidence(level: 'unsure' | 'somewhat' | 'confident') {
    const ms = markSent()
    patchDraft({ confidence: level })
    mergeSaved(answerResponse(attempt.id, response.id, { confidence: level, elapsed_ms: ms }), 'confidence')
  }

  // "I don't know" and a picked choice are mutually exclusive outcomes (idk
  // is a distinct third signal, not a fourth confidence level) — choosing
  // one clears the other on both the local draft and the server row. Clearing
  // idk drops the best guess server-side, so the draft drops it here too.
  function toggleIdk() {
    const ms = markSent()
    if (draft.idk) {
      patchDraft({ idk: false, bestGuessChoiceId: null })
      mergeSaved(answerResponse(attempt.id, response.id, { idk: false, skipped: false, elapsed_ms: ms }), 'idk')
      return
    }
    // A written idk keeps whatever was typed: "I don't know, but here is what
    // I do know" is the most useful thing a learner can hand a tutor, and it
    // is not a skip — there is something in the box to read.
    // `skipped: false` and not merely absent: the PATCH leaves an absent key
    // alone, so an idk arriving after a `b` would otherwise stay marked as a
    // deliberate blank. Saying "I don't know" is an answer, not a blank.
    if (question.type !== 'mc') {
      patchDraft({ idk: true })
      mergeSaved(answerResponse(attempt.id, response.id, { idk: true, skipped: false, elapsed_ms: ms }), 'idk')
      return
    }
    patchDraft({ idk: true, selectedChoiceId: null, bestGuessChoiceId: null })
    mergeSaved(
      answerResponse(attempt.id, response.id, {
        idk: true,
        skipped: true,
        selected_choice_id: null,
        elapsed_ms: ms,
      }),
      'idk'
    )
  }

  // §7.1 'b': leave it blank on purpose. Distinct from an idk — no claim
  // about knowing, just nothing recorded.
  function blankAnswer() {
    const ms = markSent()
    // On a written item there is no choice to clear — the box itself is the
    // answer, so leaving it blank means emptying it. The debounced save of
    // whatever was half-typed is cancelled first, or it would land after this
    // one and un-blank the response.
    if (question.type !== 'mc') {
      const responseId = response.id
      if (saveTimers.current[responseId]) {
        clearTimeout(saveTimers.current[responseId])
        delete saveTimers.current[responseId]
      }
      patchDraft({ writtenText: '', idk: false })
      mergeSaved(
        answerResponse(attempt.id, responseId, { ...writtenTextPatch('', ms), idk: false }),
        'blank'
      )
      return
    }
    patchDraft({ selectedChoiceId: null, idk: false, bestGuessChoiceId: null })
    mergeSaved(
      answerResponse(attempt.id, response.id, {
        selected_choice_id: null,
        idk: false,
        skipped: true,
        elapsed_ms: ms,
      }),
      'blank'
    )
  }

  function setWrittenText(text: string) {
    patchDraft({ writtenText: text })
    const responseId = response.id
    if (saveTimers.current[responseId]) clearTimeout(saveTimers.current[responseId])
    saveTimers.current[responseId] = setTimeout(() => {
      delete saveTimers.current[responseId]
      const ms = Math.round(currentElapsed(responseId))
      lastSent.current[responseId] = ms
      // writtenTextPatch, not a bare { response_text }: every save of the text
      // has to restate `skipped`, or a `b` pressed earlier outlives the answer
      // typed after it. See web/src/lib/writtenPatch.ts.
      answerResponse(attempt.id, responseId, writtenTextPatch(text, ms))
        .then((updated) => {
          setAttempt((prev) =>
            prev
              ? { ...prev, responses: prev.responses.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }
              : prev
          )
        })
        .catch((err) => console.error('Failed to save answer:', err))
    }, WRITTEN_SAVE_DEBOUNCE_MS)
  }

  async function togglePause() {
    setPausing(true)
    try {
      if (paused) {
        const resumed = await resumeAttempt(attempt.id)
        setAttempt((prev) => (prev ? { ...prev, paused_at: null, paused_ms: resumed.paused_ms } : prev))
      } else {
        flushElapsed(response.id)
        const stopped = await pauseAttempt(attempt.id)
        setAttempt((prev) => (prev ? { ...prev, paused_at: stopped.paused_at } : prev))
      }
    } catch (err) {
      window.alert(`Could not ${paused ? 'resume' : 'pause'}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPausing(false)
    }
  }

  function handleExit() {
    flushElapsed(response.id)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onExit()
      return
    }
    setExiting(true)
    setTimeout(onExit, 380)
  }

  // The "recorded" card: the set is over, the answers are with the server, and
  // the only thing left is to move on — which is what Space does there.
  const recorded = timeUpPhase !== 'none'
  // Nothing takes an answer while the drill is paused or the set has ended.
  // The keyboard map already refuses both; the mouse has to agree with it.
  const answeringLocked = paused || recorded

  function handleKeyAction(action: KeyAction) {
    switch (action.type) {
      case 'choice': {
        // The key names an ordinal, so honour the ordinal the server stored
        // (0-based, frozen at creation) rather than trusting the array's
        // order. Position is the fallback for a choice with no ordinal.
        const wanted = action.ordinal - 1
        const choice = question.choices.find((c) => c.ordinal === wanted) ?? question.choices[wanted]
        if (choice) selectChoice(choice.id)
        break
      }
      case 'submit':
        void next()
        break
      // Space on the recorded card: there is nothing left to answer, so it
      // finishes rather than walking through the remaining questions.
      case 'advance':
        void submitNow()
        break
      case 'blank':
        blankAnswer()
        break
      case 'toggle-idk':
        toggleIdk()
        break
      case 'confidence':
        setConfidence(action.level)
        break
    }
  }

  useKeyboard(
    {
      inTextField: false,
      kind: question.type,
      choiceCount: question.choices.length,
      recorded,
    },
    handleKeyAction,
    // A paused drill takes no answers: that is the whole point of stepping away.
    !paused && !exiting
  )

  return (
    <div className={`take-frame${exiting ? ' exiting' : ''}${hasPanel ? ' with-panel' : ''}`}>
      <div className="take-dots">
        {questions.map((r, i) => {
          const d = drafts[i]
          const wasAnswered =
            r.question.type === 'mc'
              ? d.selectedChoiceId !== null || d.idk
              : d.writtenText.trim().length > 0 || d.idk
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
          {!attempt.submitted_at && (
            <button className={`take-pause-btn${paused ? ' paused' : ''}`} onClick={togglePause} disabled={pausing}>
              {paused ? 'Resume' : 'Back in five'}
            </button>
          )}
          {/* The item's own clock is always honest about this item; the set's
              countdown only exists when the template set one. */}
          <span className="timer-badge item" title="Time on this question">
            {formatClock(itemElapsedMs)}
          </span>
          {secondsLeft !== null && (
            <span className={`timer-badge ${timerClass(secondsLeft)}`} title="Time left in this set">
              <ClockIcon size={13} />
              {formatClock(secondsLeft * 1000)}
            </span>
          )}
        </div>

        <div className="question-card no-scrollbar">
          <div className="question-slide" key={index} ref={itemRef} tabIndex={-1}>
            <div className="question-tag-row">
              <span className="question-icon">
                <SubjectIcon icon={icon} />
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Question {index + 1} of {questions.length}
              </span>
            </div>
            <RichText className="question-prompt" text={question.prompt} />

            {question.type === 'mc' ? (
              <>
                {draft.idk && (
                  <div className="best-guess-caption">
                    You said you don't know. Pick one anyway as a best guess (not scored), or leave it.
                  </div>
                )}
                <div className={`choices${draft.idk ? ' guessing' : ''}`}>
                  {question.choices.map((c, i) => {
                    const isSelected = !draft.idk && draft.selectedChoiceId === c.id
                    const isGuess = draft.idk && draft.bestGuessChoiceId === c.id
                    const cls = `choice-btn${isSelected ? ' selected' : ''}${isGuess ? ' guessed' : ''}`
                    return (
                      <button key={c.id} className={cls} onClick={() => selectChoice(c.id)} disabled={answeringLocked}>
                        <span className="choice-letter">{LETTERS[i]}</span>
                        <RichText inline text={c.body} />
                        {isGuess && <span className="choice-guess-tag">best guess (not scored)</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                {draft.idk && (
                  <div className="best-guess-caption">
                    You said you don't know. Anything you write is still kept — say what you do know, or
                    leave it.
                  </div>
                )}
                <textarea
                  className="written-answer"
                  placeholder="Type your answer…"
                  value={draft.writtenText}
                  onChange={(e) => setWrittenText(e.target.value)}
                  disabled={answeringLocked}
                />
              </>
            )}

            {/* Confidence and "I don't know" are properties of an answer, not
                of a multiple-choice answer (§2.2, §2.4), so they sit below the
                branch rather than inside its mc arm. */}
            <div className="confidence-row">
              <span className="confidence-label">How sure are you?</span>
              <div className="confidence-buttons">
                {(['unsure', 'somewhat', 'confident'] as const).map((level) => (
                  <button
                    key={level}
                    className={`confidence-btn${draft.confidence === level ? ' selected' : ''}`}
                    onClick={() => setConfidence(level)}
                    disabled={answeringLocked}
                  >
                    {level}
                  </button>
                ))}
                <button
                  className={`confidence-btn idk-btn${draft.idk ? ' selected' : ''}`}
                  onClick={toggleIdk}
                  disabled={answeringLocked}
                >
                  I don't know
                </button>
              </div>
            </div>
          </div>

          {paused && (
            <div className="take-paused-veil">
              <div className="take-paused-card">
                <div className="take-paused-title">Paused</div>
                <div className="take-paused-sub">Both clocks are stopped. Resume when you're back.</div>
                <button className="nav-btn primary" onClick={togglePause} disabled={pausing}>
                  Resume
                </button>
              </div>
            </div>
          )}
        </div>

        {recorded ? (
          <div className="take-timeup">
            <span className="take-timeup-text">Time. Your answers are recorded.</span>
            {timeUpPhase === 'finish' && (
              <button className="nav-btn primary" onClick={() => void submitNow()} disabled={finishing}>
                {finishing ? 'Submitting…' : 'Finish'}
              </button>
            )}
          </div>
        ) : (
          <div className="take-nav">
            <div className="take-nav-left">
              <span className="take-nav-hint">{answered ? 'Answered' : 'Not answered yet'}</span>
              <span className="take-key-hints">
                {question.type === 'mc' ? KEY_HINTS : WRITTEN_KEY_HINTS}
              </span>
            </div>
            <button className="nav-btn primary" onClick={() => void next()} disabled={finishing || paused}>
              {finishing ? 'Submitting…' : isLast ? 'Finish' : 'Next'} &rarr;
            </button>
          </div>
        )}
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
          {/* data-panel marks the graph/document column so a host screen (the
              live page) can place it in its own grid without Take having to
              know about that layout. */}
          <div className="take-panel no-scrollbar" data-panel="side" style={{ width: panelWidth }}>
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
