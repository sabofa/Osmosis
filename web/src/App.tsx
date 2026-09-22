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
import CommandPalette from './components/CommandPalette'
import ConfirmDialog from './components/ConfirmDialog'
import QuestionDetail from './components/QuestionDetail'
import QuestionPanel from './components/QuestionPanel'
import RichText from './components/RichText'
import type { Ui, NavigateParams } from 'cli-core'
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
  // What the command line asked a page to show (a tag, a test, a subject).
  const [navParams, setNavParams] = useState<NavigateParams>({})
  const [pageHistory, setPageHistory] = useState<Page[]>([])
  // The command line's overlays: a graph or document to look at, a question,
  // a confirm, a prompt.
  const [overlay, setOverlay] = useState<
    | { kind: 'graph'; spec: string; caption?: string }
    | { kind: 'doc'; assetId: string }
    | { kind: 'text'; title: string; text: string }
    | { kind: 'question'; id: string }
    | null
  >(null)
  const [confirmReq, setConfirmReq] = useState<{ message: string; typeToConfirm?: string; resolve: (ok: boolean) => void } | null>(null)
  const [promptReq, setPromptReq] = useState<{ label: string; resolve: (v: string | null) => void } | null>(null)
  const [promptValue, setPromptValue] = useState('')

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
  function navigate(next: Page, params: NavigateParams = {}) {
    navigated.current = true
    setBootLiveSessionId(params.session ?? null)
    setNavParams(params)
    setPageHistory((h) => (page === next ? h : [...h, page].slice(-20)))
    setPage(next)
  }

  // The command line's window onto the app (cli-core's Ui).
  const ui: Ui = {
    surface: 'app',
    navigate: async (p, params) => {
      navigate(p, params ?? {})
      return true
    },
    back: async () => {
      const prev = pageHistory.at(-1)
      if (!prev) return false
      setPageHistory((h) => h.slice(0, -1))
      navigated.current = true
      setPage(prev)
      return true
    },
    showGraph: async (spec, caption) => {
      setOverlay({ kind: 'graph', spec, caption })
      return true
    },
    showDocument: async (doc) => {
      setOverlay('assetId' in doc ? { kind: 'doc', assetId: doc.assetId } : { kind: 'text', ...doc })
      return true
    },
    showQuestion: async (id) => {
      setOverlay({ kind: 'question', id })
      return true
    },
    startAttempt: async (attemptId) => {
      const detail = await getAttempt(attemptId)
      setAttempt(detail)
      navigated.current = true
      setPage('take')
      return true
    },
    openThemeEditor: async () => {
      navigate('settings')
      return true
    },
    setThemeMode: async (mode) => {
      theme.setTheme(mode)
      return true
    },
    // clear / restart are the palette's own; reload is the page's.
    shell: async (action) => {
      if (action !== 'reload') return false
      window.location.reload()
      return true
    },
    confirm: (message, typeToConfirm) => new Promise((resolve) => setConfirmReq({ message, typeToConfirm, resolve })),
    prompt: (label) =>
      new Promise((resolve) => {
        setPromptValue('')
        setPromptReq({ label, resolve })
      }),
  }

  function closePrompt(value: string | null) {
    promptReq?.resolve(value)
    setPromptReq(null)
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
  else if (page === 'bank') content = <Bank initialTag={navParams.tag ?? null} />
  else if (page === 'library') content = <Library onStart={startQuiz} initialTemplateId={navParams.template ?? null} />
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
  else if (page === 'results') content = <Results initialView={navParams.results ?? null} />
  else if (page === 'take' || page === 'review') {
    // Reached take/review with no attempt in state (e.g. a hard refresh) —
    // there's nothing to resume, so bounce back to Home rather than crash.
    content = <Home onStart={startQuiz} onStartDaily={startDaily} startError={startError} starting={starting} />
  } else content = <Settings theme={theme} themePresets={themePresets} />

  const showRail = page !== 'take' && page !== 'review' && !(page === 'live' && liveActive)

  return (
    <>
      {showRail && <Rail active={page} onNavigate={(p) => navigate(p)} />}
      <div key={page} className="page-transition">
        {content}
      </div>

      <CommandPalette ui={ui} onAfterRun={() => void themePresets.refresh()} />

      {overlay && overlay.kind === 'question' && (
        <QuestionDetail id={overlay.id} onClose={() => setOverlay(null)} onJumpToQuestion={(id) => setOverlay({ kind: 'question', id })} />
      )}
      {overlay && overlay.kind !== 'question' && (
        <div className="cli-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
          <div className="cli-overlay-card">
            <div className="cli-overlay-head">
              <span className="cli-overlay-title">
                {overlay.kind === 'graph' ? (overlay.caption ?? 'Graph') : overlay.kind === 'text' ? overlay.title : 'Document'}
              </span>
              <button className="cli-overlay-close" onClick={() => setOverlay(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="cli-overlay-body no-scrollbar">
              {overlay.kind === 'graph' && <QuestionPanel graphSpec={overlay.spec} />}
              {overlay.kind === 'doc' && <QuestionPanel documentId={overlay.assetId} />}
              {overlay.kind === 'text' && <RichText className="cli-overlay-text" text={overlay.text} />}
            </div>
          </div>
        </div>
      )}
      {confirmReq && (
        <ConfirmDialog
          title={confirmReq.message}
          typeToConfirm={confirmReq.typeToConfirm}
          danger={!!confirmReq.typeToConfirm}
          onConfirm={() => {
            confirmReq.resolve(true)
            setConfirmReq(null)
          }}
          onCancel={() => {
            confirmReq.resolve(false)
            setConfirmReq(null)
          }}
        />
      )}
      {promptReq && (
        <div className="confirm-veil" onMouseDown={(e) => e.target === e.currentTarget && closePrompt(null)}>
          <form
            className="confirm-card"
            onSubmit={(e) => {
              e.preventDefault()
              closePrompt(promptValue)
            }}
          >
            <div className="confirm-title">{promptReq.label}</div>
            <textarea
              className="confirm-input cli-prompt-input"
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              autoFocus
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closePrompt(null)
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  closePrompt(promptValue)
                }
              }}
            />
            <div className="confirm-actions">
              <button type="button" className="confirm-btn" onClick={() => closePrompt(null)}>
                Cancel
              </button>
              <button type="submit" className="confirm-btn primary">
                OK
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

export default App
