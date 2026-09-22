import type { Api, Out, Ui } from 'cli-core'
import type { Ask } from './ask.js'
import { answerAttempt, plain, type AttemptDetail } from './answer.js'

// ----------------------------------------------------------------------------
// The terminal's three hosts for cli-core: an HTTP client to one node, plain
// printing, and a Ui that does in text what it can (answer an attempt, print
// a question, a graph spec, a document) and points at the app for the rest.
// ----------------------------------------------------------------------------

export function makeApi(baseUrl: string): Api {
  const base = baseUrl.replace(/\/$/, '')
  async function call<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v))
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`Cannot reach ${base} — is the node running? (${(err as Error).message})`)
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { message: text.slice(0, 200) }
    }
    if (!res.ok) {
      const d = data as { message?: string; error?: string; reason?: string } | null
      throw new Error(d?.message ?? d?.error ?? d?.reason ?? `${method} ${path} → HTTP ${res.status}`)
    }
    return data as T
  }
  return {
    get: (path, query) => call('GET', path, undefined, query),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    put: (path, body) => call('PUT', path, body),
    del: (path) => call('DELETE', path),
  }
}

export function formatTable(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '(nothing)'
  const cols = columns ?? Object.keys(rows[0])
  const cell = (v: unknown) =>
    v === null || v === undefined
      ? '—'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? String(v)
          : v.toFixed(2)
        : typeof v === 'boolean'
          ? v
            ? 'yes'
            : 'no'
          : String(v).replace(/\s+/g, ' ').slice(0, 60)
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)))
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd()
  return [line(cols.map((c) => c.replace(/_/g, ' '))), line(widths.map((w) => '─'.repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join('\n')
}

export function makeOut(write: (s: string) => void = (s) => console.log(s)): Out {
  return {
    text: (s) => write(s),
    error: (s) => write(`! ${s}`),
    json: (v) => write(JSON.stringify(v, null, 2)),
    table: (rows, columns) => write(formatTable(rows, columns)),
  }
}

export function makeUi(api: Api, ask: Ask, baseUrl: string, write: (s: string) => void): Ui {
  const appUrl = baseUrl.replace(/\/$/, '') + '/'
  return {
    surface: 'terminal',
    navigate: async () => false,
    back: async () => false,
    showGraph: async (spec, caption) => {
      write(`${caption ?? 'Graph spec'} (renders in the app at ${appUrl}):\n${spec}`)
      return true
    },
    showDocument: async (doc) => {
      if ('assetId' in doc) {
        const a = await api.get<{ title: string; extracted_text: string | null; content: string | null }>(`/api/assets/${doc.assetId}`)
        write(`# ${a.title}\n\n${a.extracted_text ?? a.content ?? '(no text)'}`)
      } else write(`# ${doc.title}\n\n${plain(doc.text)}`)
      return true
    },
    showQuestion: async (id) => {
      const q = await api.get<AttemptDetail['responses'][number]['question'] & { difficulty: number; rubric?: unknown }>(`/api/questions/${id}`)
      const lines = [`${q.type.toUpperCase()} · difficulty ${q.difficulty} · ${q.tags.join(' · ')}`, '', plain(q.prompt)]
      if (q.type === 'mc') {
        lines.push('')
        q.choices.forEach((c, i) => lines.push(`  ${'ABCDEF'[i]})  ${plain(c.body)}${c.is_correct ? '   ✓' : ''}`))
      } else if (q.model_answer) lines.push('', `Model answer: ${plain(q.model_answer)}`)
      if (q.explanation) lines.push('', `Explanation: ${plain(q.explanation)}`)
      write(lines.join('\n'))
      return true
    },
    startAttempt: async (attemptId) => {
      await answerAttempt(api, ask, attemptId, write)
      return true
    },
    openReview: async (attemptId) => {
      const detail = await api.get<AttemptDetail>(`/api/attempts/${attemptId}`)
      const { formatOutcome } = await import('./answer.js')
      write(formatOutcome(detail))
      return true
    },
    openThemeEditor: async () => false,
    setThemeMode: async () => false,
    confirm: async (message, typeToConfirm) => {
      if (typeToConfirm) {
        const v = await ask(`${message}\nType ${typeToConfirm} to continue: `)
        return v?.trim() === typeToConfirm
      }
      const v = await ask(`${message} [y/N] `)
      return /^y(es)?$/i.test((v ?? '').trim())
    },
    prompt: async (label) => ask(`${label}: `),
    shell: async (action) => {
      if (action === 'clear') {
        console.clear()
        return true
      }
      if (action === 'wait-for-node') {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          try {
            await api.get('/api/status')
            if (i > 0) {
              write('Back.')
              return true
            }
          } catch {
            /* still down */
          }
        }
        return false
      }
      return false
    },
  }
}
