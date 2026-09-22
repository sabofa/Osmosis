import type { Api } from 'cli-core'
import type { Ask } from './ask.js'

// ----------------------------------------------------------------------------
// Answering an attempt in the terminal: the loop `daily q`, `daily quiz` and
// `start` land in when there is no screen. Shows each question, takes a
// letter, text, `?` (I don't know) or `b` (blank), an optional confidence,
// PATCHes it, then submits and prints the outcome.
// ----------------------------------------------------------------------------

export interface AttemptDetail {
  id: string
  responses: {
    id: string
    question: {
      id: string
      type: 'mc' | 'written'
      prompt: string
      tags: string[]
      choices: { id: string; body: string; ordinal: number; is_correct?: boolean }[]
      explanation?: string | null
      model_answer?: string | null
    }
    selected_choice_id: string | null
    response_text: string | null
    outcome?: string
    grade?: { score: number | null; grader: string } | null
    idk?: boolean
  }[]
  revealed?: boolean
}

const LETTERS = 'ABCDEF'

// Strip TeX delimiters for a terminal that will not render them; the maths
// inside stays as written.
export function plain(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n  ${m.trim()}\n`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `\n  ${m.trim()}\n`)
    .replace(/\$([^$\n]+)\$/g, (_, m) => m)
    .replace(/\\ce\{([^}]*)\}/g, '$1')
    .trim()
}

export function formatQuestion(r: AttemptDetail['responses'][number], index: number, total: number): string {
  const q = r.question
  const lines = [`\n[${index + 1}/${total}] ${q.tags.join(' · ')}`, '', plain(q.prompt)]
  if (q.type === 'mc') {
    lines.push('')
    q.choices.forEach((c, i) => lines.push(`  ${LETTERS[i]})  ${plain(c.body)}`))
    lines.push('', 'Answer: a letter, ? for I don\'t know, b to leave blank, q to stop.')
  } else {
    lines.push('', 'Answer: type it (Enter to finish), ? for I don\'t know, b to leave blank, q to stop.')
  }
  return lines.join('\n')
}

export function parseChoice(input: string, count: number): number | null {
  const t = input.trim().toUpperCase()
  if (t.length === 1 && LETTERS.indexOf(t) >= 0 && LETTERS.indexOf(t) < count) return LETTERS.indexOf(t)
  const n = Number(t)
  if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1
  return null
}

export function parseConfidence(input: string): 'unsure' | 'somewhat' | 'confident' | null {
  const t = input.trim().toLowerCase()
  if (!t) return null
  if ('unsure'.startsWith(t)) return 'unsure'
  if ('somewhat'.startsWith(t)) return 'somewhat'
  if ('confident'.startsWith(t)) return 'confident'
  return null
}

export function formatOutcome(detail: AttemptDetail): string {
  const lines: string[] = ['']
  let graded = 0
  let sum = 0
  const counts: Record<string, number> = {}
  detail.responses.forEach((r, i) => {
    const o = r.outcome ?? 'ungraded'
    counts[o] = (counts[o] ?? 0) + 1
    if (r.grade && r.grade.score !== null) {
      graded++
      sum += r.grade.score
    }
    const key = r.question.type === 'mc' ? r.question.choices.find((c) => c.is_correct)?.body : r.question.model_answer
    lines.push(`${i + 1}. ${o.replace('_', ' ')}${o !== 'correct' && key ? `  →  ${plain(key)}` : ''}`)
    if (o !== 'correct' && r.question.explanation) lines.push(`     ${plain(r.question.explanation)}`)
  })
  lines.push('')
  lines.push(
    `Score ${graded ? (sum / graded).toFixed(2) : '—'} · ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
      .join(' · ')}`
  )
  return lines.join('\n')
}

export async function answerAttempt(api: Api, ask: Ask, attemptId: string, out: (s: string) => void): Promise<void> {
  const detail = await api.get<AttemptDetail>(`/api/attempts/${attemptId}`)
  const total = detail.responses.length
  const started = Date.now()
  for (let i = 0; i < total; i++) {
    const r = detail.responses[i]
    out(formatQuestion(r, i, total))
    const t0 = Date.now()
    let answered = false
    while (!answered) {
      const line = (await ask('> ')) ?? 'q'
      const t = line.trim()
      const elapsed_ms = Date.now() - t0
      if (t.toLowerCase() === 'q') {
        out('Stopped. The attempt stays open; finish it in the app or run it again.')
        return
      }
      if (t === '?') {
        await api.patch(`/api/attempts/${attemptId}/responses/${r.id}`, { idk: true, skipped: false, elapsed_ms })
        answered = true
      } else if (t.toLowerCase() === 'b') {
        await api.patch(`/api/attempts/${attemptId}/responses/${r.id}`, { skipped: true, idk: false, elapsed_ms })
        answered = true
      } else if (r.question.type === 'mc') {
        const idx = parseChoice(t, r.question.choices.length)
        if (idx === null) {
          out('A letter, please.')
          continue
        }
        await api.patch(`/api/attempts/${attemptId}/responses/${r.id}`, {
          selected_choice_id: r.question.choices[idx].id,
          idk: false,
          skipped: false,
          elapsed_ms,
        })
        answered = true
      } else {
        if (!t) {
          out('Type an answer, or b to leave it blank.')
          continue
        }
        await api.patch(`/api/attempts/${attemptId}/responses/${r.id}`, {
          response_text: t,
          skipped: false,
          idk: false,
          elapsed_ms,
        })
        answered = true
      }
    }
    const conf = parseConfidence((await ask('How sure? (u)nsure / (s)omewhat / (c)onfident, Enter to skip: ')) ?? '')
    if (conf) await api.patch(`/api/attempts/${attemptId}/responses/${r.id}`, { confidence: conf })
  }
  const submitted = await api.post<AttemptDetail>(`/api/attempts/${attemptId}/submit`)
  out(formatOutcome(submitted))
  out(`${Math.round((Date.now() - started) / 1000)}s in all.`)
}
