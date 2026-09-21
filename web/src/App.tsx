import { useEffect, useRef, useState } from 'react'
import Rail, { type Page } from './components/Rail'
import Home from './components/Home'
import Bank from './components/Bank'
import Library from './components/Library'
import SessionList from './components/SessionList'
import Take from './components/Take'
import Review from './components/Review'
import Results from './components/Results'
import Settings from './components/Settings'
import { useTheme } from './hooks/useTheme'
import { useThemePresets } from './hooks/useThemePresets'
import { createAttempt, createDailyAttempt, getAttempt, getSessions, sessionIsOpen, type AttemptDetail } from './lib/api'
import './narrow.css'

function App() {
  const [page, setPage] = useState<Page>('home')
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Set by SessionList while a live item is actually on screen (not just
  // while browsing the session list) — used below to hide the rail, same as
  // the Take/Review pages do.
  const [liveActive, setLiveActive] = useState(false)
  // §7.7, one tab: while a tutoring session is open, the live page *is* the
  // home view. Set once on load and cleared the moment Ben navigates away, so
  // coming back to Live later lands on the session list like any other visit.
  const [bootLiveSessionId, setBootLiveSessionId] = useState<string | null>(null)
  // Applied here, not inside Settings, so the theme/preset stay in effect
  // on every screen — not just while Settings itself happens to be mounted.
  const theme = useTheme()
  const themePresets = useThemePresets(theme.resolvedMode)

  // Whether Ben has already chosen a page himself. The session read below is a
  // network round trip, and yanking him onto the live page after he has
  // clicked somewhere would be worse than not landing there at all.
  const navigated = useRef(false)

  useEffect(() => {
    let cancelled = false
    // Wide enough that a run of recently-closed sessions can't hide the open
    // one behind them.
    getSessions({ limit: 20 })
      .then(({ sessions }) => {
        if (cancelled || navigated.current) return
        // The list comes back newest first, so the first open row is the
        // newest open session.
        const open = sessions.find(sessionIsOpen)
        if (!open) return
        setBootLiveSessionId(open.id)
        setPage('live')
      })
      .catch(() => {
        // No node, no sessions to land on — Home is the right fallback.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Every navigation but the initial landing forgets the boot session, so the
  // rail always reaches the session list itself.
  function navigate(next: Page) {
    navigated.current = true
    setBootLiveSessionId(null)
    setPage(next)
  }

  async function startQuiz(templateId: string) {
    setStarting(true)
    setStartError(null)
    try {
      const created = await createAttempt(templateId)
      const detail = await getAttempt(created.attempt_id)
      setAttempt(detail)
      setPage('take')
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  async function startDaily(kind: 'question' | 'quiz') {
    setStarting(true)
    setStartError(null)
    try {
      const created = await createDailyAttempt(kind)
      const detail = await getAttempt(created.attempt_id)
      setAttempt(detail)
      setPage('take')
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  let content
  if (page === 'home') content = <Home onStart={startQuiz} onStartDaily={startDaily} startError={startError} starting={starting} />
  else if (page === 'bank') content = <Bank />
  else if (page === 'library') content = <Library onStart={startQuiz} />
  else if (page === 'live')
    content = (
      <SessionList
        onStart={startQuiz}
        onLiveActiveChange={setLiveActive}
        initialLiveSessionId={bootLiveSessionId}
      />
    )
  else if (page === 'take' && attempt)
    content = (
      <Take
        attempt={attempt}
        setAttempt={setAttempt}
        onExit={() => setPage('home')}
        onFinish={() => setPage('review')}
      />
    )
  else if (page === 'review' && attempt)
    content = <Review attempt={attempt} setAttempt={setAttempt} onExit={() => setPage('home')} />
  else if (page === 'results') content = <Results />
  else if (page === 'take' || page === 'review') {
    // Reached take/review with no attempt in state (e.g. a hard refresh) —
    // there's nothing to resume, so bounce back to Home rather than crash.
    content = <Home onStart={startQuiz} onStartDaily={startDaily} startError={startError} starting={starting} />
  } else content = <Settings theme={theme} themePresets={themePresets} />

  const showRail = page !== 'take' && page !== 'review' && !(page === 'live' && liveActive)

  return (
    <>
      {showRail && <Rail active={page} onNavigate={navigate} />}
      <div key={page} className="page-transition">
        {content}
      </div>
    </>
  )
}

export default App
