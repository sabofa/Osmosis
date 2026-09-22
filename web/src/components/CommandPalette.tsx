import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRegistry, tokenize, quote, type Api, type CommandContext, type Out, type Suggestion, type Ui } from 'cli-core'
import RichText from './RichText'
import { readBindings } from '../lib/keybinds'
import { readPrefs } from '../lib/prefs'
import './CommandPalette.css'

// ----------------------------------------------------------------------------
// The in-app command line. `/` opens a bar at the bottom; the same command
// core the terminal uses runs what is typed. Suggestions complete the token
// under the caret: arrows move, Tab accepts, Enter runs, Escape closes.
// Output lands in a small log above the bar.
// ----------------------------------------------------------------------------

type Entry =
  | { kind: 'cmd'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'table'; rows: Record<string, unknown>[]; columns: string[] }

const MAX_LOG = 40
const HISTORY_KEY = 'osmosis:cli-history'

function readHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export const appApi: Api = {
  async get(path, query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v))
    const res = await fetch(qs.size ? `${path}?${qs}` : path)
    return parse(res, `GET ${path}`)
  },
  post: (path, body) => send('POST', path, body),
  patch: (path, body) => send('PATCH', path, body),
  put: (path, body) => send('PUT', path, body),
  del: (path) => send('DELETE', path),
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return parse(res, `${method} ${path}`)
}

async function parse<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text.slice(0, 200) }
  }
  if (!res.ok) {
    const d = data as { message?: string; error?: string; reason?: string } | null
    throw new Error(d?.message ?? d?.error ?? d?.reason ?? `${what} → HTTP ${res.status}`)
  }
  return data as T
}

export default function CommandPalette({ ui, onAfterRun }: { ui: Ui; onAfterRun?: () => void }) {
  const registry = useMemo(() => buildRegistry(), [])
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [log, setLog] = useState<Entry[]>([])
  const [logOpen, setLogOpen] = useState(() => readPrefs().cliShowLog)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [tokenIndex, setTokenIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const history = useRef<string[]>(readHistory())
  const historyPos = useRef(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const completionSeq = useRef(0)
  // Set when the arrow keys chose a suggestion: Enter then takes that pick
  // rather than running what was typed.
  const pickedByArrow = useRef(false)

  const push = useCallback((e: Entry) => setLog((prev) => [...prev, e].slice(-MAX_LOG)), [])

  const ctx = useMemo<CommandContext>(() => {
    const out: Out = {
      text: (s) => push({ kind: 'text', text: s }),
      error: (s) => push({ kind: 'error', text: s }),
      json: (value) => push({ kind: 'json', value }),
      table: (rows, columns) => push({ kind: 'table', rows, columns: columns ?? Object.keys(rows[0] ?? {}) }),
    }
    // The shell's own actions wrap the host's ui: clear and restart are the
    // palette's to do, reload is the page's.
    const shellUi: Ui = {
      ...ui,
      shell: async (action) => {
        if (action === 'clear') {
          setLog([])
          return true
        }
        if (action === 'wait-for-node') {
          // The node is going down; wait for it to answer again, then reload
          // so every page reads fresh.
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            try {
              const res = await fetch('/api/status', { cache: 'no-store' })
              if (res.ok && i > 0) {
                window.location.reload()
                return true
              }
            } catch {
              /* still down */
            }
          }
          return false
        }
        window.location.reload()
        return true
      },
    }
    return { api: appApi, out, ui: shellUi }
  }, [push, ui])

  // `/` opens the bar from anywhere that is not a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === readBindings().palette && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
        setLogOpen(readPrefs().cliShowLog)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // A click anywhere outside the bar collapses it.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Completion follows the input with a short debounce; a stale answer never
  // overwrites a newer one.
  useEffect(() => {
    if (!open) return
    const seq = ++completionSeq.current
    const t = setTimeout(async () => {
      const c = await registry.complete(ctx, input)
      if (seq !== completionSeq.current) return
      setSuggestions(c.suggestions)
      setTokenIndex(c.tokenIndex)
      setCursor(0)
      pickedByArrow.current = false
    }, 100)
    return () => clearTimeout(t)
  }, [input, open, registry, ctx])

  function accept(s: Suggestion): string {
    const { tokens } = tokenize(input)
    const words = tokens.length ? tokens : ['']
    const before = words.slice(0, tokenIndex)
    const next = [...before.map((w) => quote(w)), s.insert].join(' ') + ' '
    setInput(next)
    return next
  }

  async function run(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    push({ kind: 'cmd', text: trimmed })
    history.current = [trimmed, ...history.current.filter((h) => h !== trimmed)].slice(0, 100)
    historyPos.current = -1
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.current))
    } catch {
      /* fine */
    }
    setInput('')
    setSuggestions([])
    setBusy(true)
    try {
      if (trimmed === 'history') history.current.forEach((h) => push({ kind: 'text', text: h }))
      else await registry.run(ctx, trimmed)
    } finally {
      setBusy(false)
      onAfterRun?.()
      // The page that just opened may have taken focus (a test focuses its
      // item); the bar takes it back so the next command types straight in.
      setTimeout(() => inputRef.current?.focus(), 60)
      setTimeout(() => inputRef.current?.focus(), 400)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (input) setInput('')
      else setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      pickedByArrow.current = true
      setCursor((c) => (c + 1) % suggestions.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length) {
        pickedByArrow.current = true
        setCursor((c) => (c - 1 + suggestions.length) % suggestions.length)
      }
      else if (history.current.length) {
        historyPos.current = Math.min(historyPos.current + 1, history.current.length - 1)
        setInput(history.current[historyPos.current])
      }
      return
    }
    if (e.key === 'Tab' || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === input.length)) {
      if (suggestions[cursor]) {
        e.preventDefault()
        accept(suggestions[cursor])
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter on a highlighted suggestion fills it in (like Tab) when the
      // typed token does not already spell it out; Enter again runs. So the
      // arrow keys pick, Enter takes the pick, and a second Enter goes.
      // Fill when the arrows chose the pick (even on an empty token, e.g.
      // "open " then ↓ to bank), or when a typed token doesn't spell the top
      // match yet. Run when the token already is the match, or the token is
      // empty and nothing was picked.
      const s = suggestions[cursor]
      const { tokens } = tokenize(input)
      const last = tokens[tokens.length - 1] ?? ''
      const spelled = s ? s.label.toLowerCase() === last.toLowerCase() : true
      if (s && !spelled && (pickedByArrow.current || last !== '')) {
        accept(s)
        pickedByArrow.current = false
        return
      }
      void run(input)
    }
  }

  const ghost = suggestions[cursor] && input && !input.endsWith(' ') ? suggestions[cursor].label : null

  if (!open) return null

  return (
    <div className="cli" ref={rootRef}>
      {logOpen && log.length > 0 && (
        <div className="cli-log no-scrollbar">
          <button className="cli-log-clear" onClick={() => setLog([])} title="Clear the output (or type clear)">
            clear
          </button>
          {log.map((e, i) => (
            <div key={i} className={`cli-entry ${e.kind}`}>
              {e.kind === 'cmd' && <span className="cli-prompt">/</span>}
              {e.kind === 'json' ? (
                <pre>{JSON.stringify(e.value, null, 2)}</pre>
              ) : e.kind === 'table' ? (
                <table>
                  <thead>
                    <tr>
                      {e.columns.map((c) => (
                        <th key={c}>{c.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {e.rows.map((row, ri) => (
                      <tr key={ri}>
                        {e.columns.map((c) => (
                          <td key={c}>{cell(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : e.kind === 'text' ? (
                <RichText text={e.text} />
              ) : (
                <span>{e.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="cli-suggestions">
          {suggestions.map((s, i) => (
            <button
              key={`${s.insert}-${i}`}
              className={`cli-suggestion${i === cursor ? ' active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
                inputRef.current?.focus()
              }}
            >
              <span className="cli-suggestion-label">{s.label}</span>
              {s.hint && <span className="cli-suggestion-hint">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="cli-bar">
        <span className="cli-prompt">/</span>
        <div className="cli-input-wrap">
          {ghost && (
            <div className="cli-ghost" aria-hidden>
              <span className="cli-ghost-typed">{input}</span>
              <span className="cli-ghost-rest">{ghostRest(input, ghost)}</span>
            </div>
          )}
          <input
            ref={inputRef}
            className="cli-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="open bank econ · daily q · start demand quiz · help"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <span className="cli-hint">Tab completes · ↑↓ · Esc</span>
        <button className="cli-toggle-log" onClick={() => setLogOpen((v) => !v)} title="Show or hide output">
          {logOpen ? '▾' : '▴'}
        </button>
      </div>
    </div>
  )
}

function ghostRest(input: string, label: string): string {
  const { tokens } = tokenize(input)
  const last = (tokens[tokens.length - 1] ?? '').toLowerCase()
  const l = label.toLowerCase()
  if (last && l.startsWith(last)) return label.slice(last.length)
  return last ? `  → ${label}` : label
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}
