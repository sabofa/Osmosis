import { useState } from 'react'
import Rail, { type Page } from './components/Rail'
import Home from './components/Home'
import Bank from './components/Bank'
import Library from './components/Library'
import Take from './components/Take'
import Review from './components/Review'
import Results from './components/Results'
import Settings from './components/Settings'
import { useTheme } from './hooks/useTheme'
import { useThemePresets } from './hooks/useThemePresets'
import { createAttempt, createDailyAttempt, getAttempt, type AttemptDetail } from './lib/api'

function App() {
  const [page, setPage] = useState<Page>('home')
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Applied here, not inside Settings, so the theme/preset stay in effect
  // on every screen — not just while Settings itself happens to be mounted.
  const theme = useTheme()
  const themePresets = useThemePresets(theme.resolvedMode)

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

  const showRail = page !== 'take' && page !== 'review'

  return (
    <>
      {showRail && <Rail active={page} onNavigate={setPage} />}
      <div key={page} className="page-transition">
        {content}
      </div>
    </>
  )
}

export default App
