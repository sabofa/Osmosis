import type { CommandContext, Page } from './types.js'
import { Registry } from './registry.js'
import { rank } from './fuzzy.js'

// ----------------------------------------------------------------------------
// The commands, and the completers they lean on. Step one of the CLI plan:
// navigation, daily, theme, settings, open, questions and templates by name,
// results, sessions, help. Later steps add authoring, showing and admin.
// ----------------------------------------------------------------------------

const PAGES: Page[] = ['home', 'bank', 'library', 'live', 'results', 'settings']

interface TagRow {
  slug: string
  label: string
  question_count: number
}
interface TemplateRow {
  id: string
  name: string
  question_count: number
  retired_at: string | null
}
interface QuestionRow {
  id: string
  prompt: string
  type: string
  tags: string[]
}
interface ThemeRow {
  id: string
  name: string
}
interface SessionRow {
  id: string
  name: string
  status?: string
  ended_at: string | null
}
interface AssetRow {
  id: string
  title: string
  type: string
}
interface AttemptRow {
  id: string
  template_name: string | null
  source: string
  source_kind?: string
  started_at?: string | null
  submitted_at: string | null
  mean_score: number | null
}

const ID_RE = /^[0-9a-f-]{4,36}$/i

async function tags(ctx: CommandContext): Promise<TagRow[]> {
  return ((await ctx.api.get<{ tags: TagRow[] }>('/api/tags')).tags ?? []) as TagRow[]
}
async function templates(ctx: CommandContext): Promise<TemplateRow[]> {
  return ((await ctx.api.get<{ templates: TemplateRow[] }>('/api/templates')).templates ?? []).filter((t) => !t.retired_at)
}

// Find one thing by fuzzy name, or explain what was close.
async function pickOne<T>(
  ctx: CommandContext,
  what: string,
  query: string,
  items: T[],
  text: (t: T) => string
): Promise<T | null> {
  const exact = items.find((t) => text(t).toLowerCase() === query.toLowerCase())
  if (exact) return exact
  const ranked = rank(query, items, text, 5)
  if (ranked.length === 0) {
    ctx.out.error(`No ${what} matches "${query}".`)
    return null
  }
  // Only take a fuzzy hit when it clearly stands out.
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 50) return ranked[0].item
  ctx.out.error(`Which ${what}? ${ranked.map((r) => text(r.item)).join(' · ')}`)
  return null
}

async function findTag(ctx: CommandContext, query: string): Promise<TagRow | null> {
  const all = await tags(ctx)
  const exact = all.find((t) => t.slug.toLowerCase() === query.toLowerCase() || t.label.toLowerCase() === query.toLowerCase())
  if (exact) return exact
  // Slug and label together, so "economics" finds econ and "alg" finds
  // math:algebra either way.
  return pickOne(ctx, 'tag', query, all, (t) => `${t.slug} ${t.label}`)
}

async function findTemplate(ctx: CommandContext, query: string): Promise<TemplateRow | null> {
  return pickOne(ctx, 'test', query, await templates(ctx), (t) => t.name)
}

// An attempt named by a full id or an unambiguous prefix of one.
async function resolveAttemptId(ctx: CommandContext, query: string): Promise<string | null> {
  const res = await ctx.api.get<{ attempts: AttemptRow[] }>('/api/attempts', { limit: 500 })
  const hits = (res.attempts ?? []).filter((x) => x.id.toLowerCase().startsWith(query.toLowerCase()))
  if (hits.length === 1) return hits[0].id
  if (hits.length === 0) {
    ctx.out.error(`No attempt starts with "${query}".`)
    return null
  }
  ctx.out.error(`${hits.length} attempts start with "${query}" — type a few more characters.`)
  return null
}

function needsApp(ctx: CommandContext, what: string) {
  ctx.out.text(`${what} needs the app — open it in a browser and run the same command with /.`)
}

export function buildRegistry(): Registry {
  const r = new Registry()

  // ---- completers ----------------------------------------------------------
  r.completer('page', async () => PAGES.map((p) => ({ value: p })))
  r.completer('tag', async (ctx) => (await tags(ctx)).map((t) => ({ value: t.slug, hint: `${t.label} · ${t.question_count}` })))
  r.completer('template', async (ctx) => (await templates(ctx)).map((t) => ({ value: t.name, hint: `${t.question_count} questions` })))
  r.completer('question', async (ctx, partial) => {
    // An id prefix completes against recent questions by id; words search.
    const byId = ID_RE.test(partial)
    const res = await ctx.api.get<{ questions: QuestionRow[] }>('/api/questions', { text: byId ? undefined : partial || undefined, limit: byId ? 200 : 12 })
    return (res.questions ?? []).map((q) => ({ value: q.id, hint: q.prompt.slice(0, 70) }))
  })
  r.completer('attempt', async (ctx) => {
    const res = await ctx.api.get<{ attempts: AttemptRow[] }>('/api/attempts', { limit: 100 })
    return (res.attempts ?? []).map((a) => ({
      value: a.id,
      hint: `${a.template_name ?? a.source} · ${(a.started_at ?? a.submitted_at ?? '').slice(0, 16)} · ${a.mean_score === null ? (a.submitted_at ? 'ungraded' : 'open') : a.mean_score.toFixed(2)}`,
    }))
  })
  r.completer('theme', async (ctx) => {
    const res = await ctx.api.get<{ themes: ThemeRow[] }>('/api/themes')
    return [{ value: 'light' }, { value: 'dark' }, { value: 'system' }, ...(res.themes ?? []).map((t) => ({ value: t.name, hint: t.id }))]
  })
  r.completer('session', async (ctx) => {
    const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 50 })
    return (res.sessions ?? []).map((s) => ({ value: s.name, hint: s.ended_at ? 'closed' : 'open' }))
  })
  r.completer('setting', async (ctx) => {
    const cfg = await ctx.api.get<Record<string, unknown>>('/api/config')
    return Object.entries(cfg).map(([k, v]) => ({ value: k, hint: JSON.stringify(v) }))
  })
  r.completer('asset', async (ctx) => {
    const res = await ctx.api.get<{ assets: AssetRow[] }>('/api/assets')
    return (res.assets ?? []).map((a) => ({ value: a.title, hint: `${a.type} · ${a.id.slice(0, 8)}` }))
  })
  r.completer('daily-kind', async () => [{ value: 'q', hint: "today's question" }, { value: 'quiz', hint: "today's set" }])
  r.completer('date', async (ctx) => {
    const res = await ctx.api.get<{ daily: { draw_date: string; kind: string }[] }>('/api/results/daily', { limit: 60 })
    const seen = new Set<string>()
    return (res.daily ?? []).filter((d) => !seen.has(d.draw_date) && seen.add(d.draw_date)).map((d) => ({ value: d.draw_date }))
  })

  // ---- navigation ------------------------------------------------------------
  r.register({
    path: ['open'],
    args: [{ name: 'page', kind: 'page' }],
    describe: 'Go to a page',
    async run(ctx, a) {
      const page = PAGES.find((p) => p === a.page.toLowerCase()) ?? rank(a.page, PAGES, (p) => p, 1)[0]?.item
      if (!page) return ctx.out.error(`No page "${a.page}". Pages: ${PAGES.join(', ')}`)
      if (!(await ctx.ui.navigate(page))) needsApp(ctx, `Opening ${page}`)
    },
  })
  r.register({
    path: ['open', 'bank'],
    args: [{ name: 'tag', kind: 'tag', optional: true, rest: true }],
    describe: 'The bank, filtered to a tag',
    async run(ctx, a) {
      const tag = a.tag ? await findTag(ctx, a.tag) : null
      if (a.tag && !tag) return
      if (!(await ctx.ui.navigate('bank', { tag: tag?.slug }))) needsApp(ctx, 'The bank')
    },
  })
  r.register({
    path: ['open', 'test'],
    args: [{ name: 'test', kind: 'template', rest: true }],
    describe: "A test's detail in the library",
    async run(ctx, a) {
      const t = await findTemplate(ctx, a.test)
      if (!t) return
      if (!(await ctx.ui.navigate('library', { template: t.id }))) {
        ctx.out.json(await ctx.api.get(`/api/templates/${t.id}`))
      }
    },
  })
  r.register({
    path: ['open', 'results'],
    args: [{ name: 'tag', kind: 'tag', optional: true, rest: true }],
    describe: 'Results, or one subject in full',
    async run(ctx, a) {
      const tag = a.tag ? await findTag(ctx, a.tag) : null
      if (a.tag && !tag) return
      if (!(await ctx.ui.navigate('results', { results: { tag: tag?.slug } }))) {
        ctx.out.json(tag ? await ctx.api.get(`/api/results/tags/${encodeURIComponent(tag.slug)}/history`) : await ctx.api.get('/api/results/parents'))
      }
    },
  })
  r.register({
    path: ['open', 'day'],
    args: [{ name: 'date', kind: 'date' }],
    describe: 'One day of daily history',
    async run(ctx, a) {
      if (!(await ctx.ui.navigate('results', { results: { date: a.date } }))) {
        ctx.out.json(await ctx.api.get(`/api/results/daily/${encodeURIComponent(a.date)}`))
      }
    },
  })
  r.register({
    path: ['open', 'session'],
    args: [{ name: 'session', kind: 'session', rest: true }],
    describe: 'A live session',
    async run(ctx, a) {
      const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 100 })
      const s = await pickOne(ctx, 'session', a.session, res.sessions ?? [], (x) => x.name)
      if (!s) return
      if (!(await ctx.ui.navigate('live', { session: s.id }))) ctx.out.json(await ctx.api.get(`/api/sessions/${s.id}`))
    },
  })
  r.register({
    path: ['back'],
    describe: 'The previous page',
    async run(ctx) {
      if (!(await ctx.ui.back())) needsApp(ctx, 'Going back')
    },
  })

  // ---- tests and daily -------------------------------------------------------
  r.register({
    path: ['start'],
    args: [{ name: 'test', kind: 'template', rest: true }],
    describe: 'Start a test',
    async run(ctx, a) {
      const t = await findTemplate(ctx, a.test)
      if (!t) return
      const created = await ctx.api.post<{ attempt_id: string }>('/api/attempts', { source: 'template', template_id: t.id })
      if (!(await ctx.ui.startAttempt(created.attempt_id))) ctx.out.text(`Attempt ${created.attempt_id} started.`)
    },
  })
  r.register({
    path: ['daily'],
    args: [{ name: 'kind', kind: 'daily-kind' }],
    describe: "Today's question (q) or quiz",
    async run(ctx, a) {
      const kind = a.kind.toLowerCase().startsWith('q') && a.kind.toLowerCase() !== 'quiz' ? 'question' : 'quiz'
      const status = await ctx.api.get<{ daily_taken?: { question: string | null; quiz: string | null } }>('/api/status')
      if (status.daily_taken?.[kind]) return ctx.out.text(`Today's daily ${kind} is already done. It comes back tomorrow.`)
      const created = await ctx.api.post<{ attempt_id: string }>('/api/attempts', { daily_kind: kind })
      if (!(await ctx.ui.startAttempt(created.attempt_id))) ctx.out.text(`Attempt ${created.attempt_id} started.`)
    },
  })

  // ---- questions and templates by name --------------------------------------
  r.register({
    path: ['q'],
    args: [{ name: 'question', kind: 'question', rest: true }],
    describe: 'Show a question by id or search (--data adds its outcomes)',
    async run(ctx, a, flags) {
      let id = a.question
      if (!/^[0-9a-f-]{32,36}$/i.test(id)) {
        const res = await ctx.api.get<{ questions: QuestionRow[] }>('/api/questions', { text: id, limit: 5 })
        const hit = await pickOne(ctx, 'question', id, res.questions ?? [], (q) => q.prompt)
        if (!hit) return
        id = hit.id
      }
      if (flags.data) {
        // The question-scope results, narrowed to this one lineage.
        const res = await ctx.api.get<{ questions?: Record<string, unknown>[] }>('/api/results/questions', { limit: 500 })
        const rows = (res.questions ?? []).filter((q) => q.question_id === id || q.lineage_id === id)
        ctx.out.json(rows.length ? rows : { note: 'no outcomes recorded for this question yet' })
      }
      if (!(await ctx.ui.showQuestion(id))) ctx.out.json(await ctx.api.get(`/api/questions/${id}`))
    },
  })
  r.register({
    path: ['q', 'list'],
    args: [{ name: 'tag', kind: 'tag', rest: true }],
    describe: 'List the questions under a tag',
    async run(ctx, a) {
      const tag = await findTag(ctx, a.tag)
      if (!tag) return
      const res = await ctx.api.get<{ total: number; questions: QuestionRow[] }>('/api/questions', { tag: tag.slug, limit: 50 })
      ctx.out.table((res.questions ?? []).map((q) => ({ id: q.id.slice(0, 8), type: q.type, prompt: q.prompt.slice(0, 80) })))
      ctx.out.text(`${res.total} in ${tag.slug}`)
    },
  })
  r.register({
    path: ['template', 'list'],
    describe: 'List the tests',
    async run(ctx) {
      ctx.out.table((await templates(ctx)).map((t) => ({ name: t.name, questions: t.question_count })))
    },
  })
  r.register({
    path: ['template'],
    args: [{ name: 'test', kind: 'template', rest: true }],
    describe: 'A test, as data',
    async run(ctx, a) {
      const t = await findTemplate(ctx, a.test)
      if (!t) return
      ctx.out.json(await ctx.api.get(`/api/templates/${t.id}`))
    },
  })

  // ---- results ------------------------------------------------------------------
  r.register({
    path: ['results'],
    args: [{ name: 'tag', kind: 'tag', optional: true, rest: true }],
    describe: 'Subjects worst first, or one tag',
    async run(ctx, a) {
      if (a.tag) {
        const tag = await findTag(ctx, a.tag)
        if (!tag) return
        const h = await ctx.api.get<{ overall: Record<string, unknown>; children: Record<string, unknown>[] }>(
          `/api/results/tags/${encodeURIComponent(tag.slug)}/history`
        )
        ctx.out.json(h.overall)
        if (h.children.length) ctx.out.table(h.children, ['tag_slug', 'responses', 'mean_score', 'misses'])
        return
      }
      const res = await ctx.api.get<{ parents: Record<string, unknown>[] }>('/api/results/parents')
      ctx.out.table(res.parents, ['tag_slug', 'responses', 'mean_score', 'misses', 'last_seen'])
    },
  })
  r.register({
    path: ['history'],
    args: [{ name: 'date', kind: 'date', optional: true }],
    describe: 'Daily history, or one day',
    async run(ctx, a) {
      if (a.date) return ctx.out.json(await ctx.api.get(`/api/results/daily/${encodeURIComponent(a.date)}`))
      const res = await ctx.api.get<{ daily: Record<string, unknown>[] }>('/api/results/daily', { limit: 30 })
      ctx.out.table(res.daily, ['draw_date', 'kind', 'score', 'completed'])
    },
  })
  r.register({
    path: ['attempts'],
    describe: 'Recent attempts (attempt <id> for one, review <id> to open it)',
    async run(ctx) {
      const res = await ctx.api.get<{ attempts: Record<string, unknown>[] }>('/api/attempts', { limit: 20 })
      ctx.out.table(res.attempts, ['id', 'template_name', 'source_kind', 'started_at', 'submitted_at', 'mean_score'])
    },
  })
  r.register({
    path: ['attempt'],
    args: [{ name: 'attempt', kind: 'attempt' }],
    describe: 'One attempt in full — every response, answer and grade',
    async run(ctx, a) {
      const id = await resolveAttemptId(ctx, a.attempt)
      if (!id) return
      ctx.out.json(await ctx.api.get(`/api/attempts/${id}`))
    },
  })
  r.register({
    path: ['review'],
    args: [{ name: 'attempt', kind: 'attempt' }],
    describe: 'Open the review screen for an attempt',
    async run(ctx, a) {
      const id = await resolveAttemptId(ctx, a.attempt)
      if (!id) return
      if (!(await ctx.ui.openReview(id))) ctx.out.json(await ctx.api.get(`/api/attempts/${id}`))
    },
  })

  // ---- sessions ------------------------------------------------------------------
  r.register({
    path: ['session', 'list'],
    describe: 'Live sessions, newest first',
    async run(ctx) {
      const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 30 })
      ctx.out.table((res.sessions ?? []).map((s) => ({ name: s.name, status: s.ended_at ? 'closed' : 'open', id: s.id.slice(0, 8) })))
    },
  })
  r.register({
    path: ['session', 'end'],
    args: [
      { name: 'session', kind: 'session' },
      { name: 'summary', kind: 'text', optional: true, rest: true },
    ],
    describe: 'Close a session, with an optional summary',
    async run(ctx, a) {
      const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 100 })
      const s = await pickOne(ctx, 'session', a.session, (res.sessions ?? []).filter((x) => !x.ended_at), (x) => x.name)
      if (!s) return
      if (!(await ctx.ui.confirm(`Close "${s.name}"? Pending items are abandoned.`))) return
      ctx.out.json(await ctx.api.post(`/api/sessions/${s.id}/end`, a.summary ? { summary: a.summary } : {}))
    },
  })

  // ---- settings and theme ----------------------------------------------------------
  r.register({
    path: ['get'],
    args: [{ name: 'key', kind: 'setting', optional: true }],
    describe: 'Read a setting, or all of them',
    async run(ctx, a) {
      const cfg = await ctx.api.get<Record<string, unknown>>('/api/config')
      if (!a.key) return ctx.out.json(cfg)
      if (!(a.key in cfg)) return ctx.out.error(`No setting "${a.key}". Keys: ${Object.keys(cfg).join(', ')}`)
      ctx.out.json({ [a.key]: cfg[a.key] })
    },
  })
  r.register({
    path: ['set'],
    args: [
      { name: 'key', kind: 'setting' },
      { name: 'value', kind: 'text', rest: true },
    ],
    describe: 'Change a setting (numbers, true/false and JSON are parsed)',
    async run(ctx, a) {
      let value: unknown = a.value
      try {
        value = JSON.parse(a.value)
      } catch {
        /* a plain string */
      }
      ctx.out.json(await ctx.api.patch('/api/config', { key: a.key, value }))
    },
  })
  r.register({
    path: ['theme'],
    args: [{ name: 'theme', kind: 'theme', rest: true }],
    describe: 'Switch theme: light, dark, system, or a saved theme',
    async run(ctx, a) {
      const name = a.theme.toLowerCase()
      if (name === 'light' || name === 'dark' || name === 'system') {
        if (!(await ctx.ui.setThemeMode(name))) needsApp(ctx, 'Switching light/dark')
        return
      }
      const res = await ctx.api.get<{ themes: ThemeRow[] }>('/api/themes')
      const t = await pickOne(ctx, 'theme', a.theme, res.themes ?? [], (x) => x.name)
      if (!t) return
      await ctx.api.put('/api/themes/active', { id: t.id })
      ctx.out.text(`Theme: ${t.name}`)
    },
  })
  r.register({
    path: ['theme', 'edit'],
    args: [{ name: 'theme', kind: 'theme', optional: true, rest: true }],
    describe: 'Open the theme editor',
    async run(ctx, a) {
      let id: string | undefined
      if (a.theme) {
        const res = await ctx.api.get<{ themes: ThemeRow[] }>('/api/themes')
        const t = await pickOne(ctx, 'theme', a.theme, res.themes ?? [], (x) => x.name)
        if (!t) return
        id = t.id
      }
      if (!(await ctx.ui.openThemeEditor(id))) needsApp(ctx, 'The theme editor')
    },
  })
  r.register({
    path: ['sync'],
    describe: 'Sync this node with the server now',
    async run(ctx) {
      ctx.out.json(await ctx.api.post('/api/sync'))
    },
  })
  r.register({
    path: ['status'],
    describe: 'This node: role, connection, versions',
    async run(ctx) {
      const s = await ctx.api.get<Record<string, unknown>>('/api/status')
      ctx.out.json({
        node: s.node,
        online: s.online,
        remote_url: s.remote_url,
        protocol_version: s.protocol_version,
        tools_version: s.tools_version,
        last_pull_at: s.last_pull_at,
        daily_taken: s.daily_taken,
      })
    },
  })

  // ---- authoring ------------------------------------------------------------------
  // `q new` walks through the fields; `--json` takes a whole QuestionInput.
  r.register({
    path: ['q', 'new'],
    args: [{ name: 'json', kind: 'text', optional: true, rest: true }],
    describe: 'Write a question (guided, or --json with the full object)',
    help:
      'Guided: type (mc/written), prompt, choices (mc: one per line, mark the key with a leading *), ' +
      'explanation, tags, difficulty 1-5. With --json the argument is a QuestionInput as create_questions takes it.',
    async run(ctx, a, flags) {
      let input: Record<string, unknown>
      if (flags.json && a.json) {
        input = JSON.parse(a.json) as Record<string, unknown>
      } else {
        const type = ((await ctx.ui.prompt('Type: mc or written')) ?? '').trim().toLowerCase()
        if (type !== 'mc' && type !== 'written') return ctx.out.error('Type must be mc or written.')
        const prompt = (await ctx.ui.prompt('Prompt (LaTeX in $…$ is fine)', { multiline: true })) ?? ''
        if (!prompt.trim()) return ctx.out.error('A prompt is required.')
        input = { type, prompt: prompt.trim() }
        if (type === 'mc') {
          const raw = (await ctx.ui.prompt('Choices, one per line — start the correct one with *', { multiline: true })) ?? ''
          const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          if (lines.length < 2) return ctx.out.error('At least two choices.')
          input.choices = lines.map((l) => ({ body: l.replace(/^\*\s*/, ''), is_correct: l.startsWith('*') }))
          if (!(input.choices as { is_correct: boolean }[]).some((c) => c.is_correct)) return ctx.out.error('Mark the correct choice with *.')
        } else {
          input.model_answer = ((await ctx.ui.prompt('Model answer', { multiline: true })) ?? '').trim() || null
          const rubric = ((await ctx.ui.prompt('Rubric, one criterion per line (optional)', { multiline: true })) ?? '').trim()
          if (rubric) input.rubric = rubric.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        }
        input.explanation = ((await ctx.ui.prompt('Explanation (optional)', { multiline: true })) ?? '').trim() || null
        const tagLine = ((await ctx.ui.prompt('Tags, space separated (existing slugs)')) ?? '').trim()
        input.tags = tagLine.split(/[\s,]+/).filter(Boolean)
        if (!(input.tags as string[]).length) return ctx.out.error('At least one tag.')
        const diff = Number(((await ctx.ui.prompt('Difficulty 1-5 (default 3)')) ?? '').trim() || 3)
        input.difficulty = Number.isFinite(diff) ? diff : 3
      }
      const res = await ctx.api.post<{ created: { id: string }[]; rejected: unknown[] }>('/api/questions', { questions: [input] })
      ctx.out.json(res)
      const id = res.created?.[0]?.id
      if (id) await ctx.ui.showQuestion(id)
    },
  })
  r.register({
    path: ['q', 'edit'],
    args: [
      { name: 'question', kind: 'question' },
      { name: 'json', kind: 'text', rest: true },
    ],
    describe: 'Edit a question: q edit <id> {"prompt": "…", "tags": […]}',
    async run(ctx, a) {
      const changes = JSON.parse(a.json) as Record<string, unknown>
      ctx.out.json(await ctx.api.patch(`/api/questions/${encodeURIComponent(a.question)}`, changes))
    },
  })
  r.register({
    path: ['q', 'retire'],
    args: [
      { name: 'question', kind: 'question' },
      { name: 'reason', kind: 'text', optional: true, rest: true },
    ],
    describe: 'Retire a question (kept for history, never drawn again)',
    async run(ctx, a) {
      if (!(await ctx.ui.confirm(`Retire question ${a.question.slice(0, 8)}…?`))) return
      ctx.out.json(await ctx.api.post(`/api/questions/${encodeURIComponent(a.question)}/retire`, { reason: a.reason }))
    },
  })
  r.register({
    path: ['template', 'new'],
    args: [{ name: 'json', kind: 'text', optional: true, rest: true }],
    describe: 'Make a test (guided, or --json with the full template)',
    async run(ctx, a, flags) {
      let input: Record<string, unknown>
      if (flags.json && a.json) input = JSON.parse(a.json) as Record<string, unknown>
      else {
        const name = ((await ctx.ui.prompt('Name')) ?? '').trim()
        if (!name) return ctx.out.error('A name is required.')
        const tagsAll = ((await ctx.ui.prompt('Tags every question must carry (space separated)')) ?? '').trim().split(/[\s,]+/).filter(Boolean)
        const tagsAny = ((await ctx.ui.prompt('Tags any question may carry (optional)')) ?? '').trim().split(/[\s,]+/).filter(Boolean)
        if (!tagsAll.length && !tagsAny.length) return ctx.out.error('At least one tag.')
        const count = Number(((await ctx.ui.prompt('How many questions (default 10)')) ?? '').trim() || 10)
        const limit = ((await ctx.ui.prompt('Time limit in minutes (blank for none)')) ?? '').trim()
        const frozen = /^y/i.test(((await ctx.ui.prompt('Freeze the draw so it is the same set every time? y/N')) ?? '').trim())
        input = {
          name,
          tag_query: { ...(tagsAll.length ? { all: tagsAll } : {}), ...(tagsAny.length ? { any: tagsAny } : {}) },
          question_count: Number.isFinite(count) ? count : 10,
          time_limit_sec: limit ? Math.round(Number(limit) * 60) : null,
          frozen,
        }
      }
      const res = await ctx.api.post<{ id: string }>('/api/templates', input)
      ctx.out.json(res)
      if (res.id && !(await ctx.ui.navigate('library', { template: res.id }))) ctx.out.text(`Template ${res.id} created.`)
    },
  })
  r.register({
    path: ['template', 'sql'],
    args: [{ name: 'test', kind: 'template', rest: true }],
    describe: 'A test as JSON plus the SQL its draw runs, in the document viewer',
    async run(ctx, a) {
      const t = await findTemplate(ctx, a.test)
      if (!t) return
      const res = await ctx.api.get<{ template: unknown; eligibility_sql: string; eligibility_args: unknown[]; frozen_question_ids: string[] }>(
        `/api/templates/${t.id}/sql`
      )
      const text = [
        `${res.eligibility_sql}`,
        `-- args: ${JSON.stringify(res.eligibility_args)}`,
        res.frozen_question_ids.length ? `-- frozen to ${res.frozen_question_ids.length} questions` : '-- drawn fresh each attempt',
        '',
        JSON.stringify(res.template, null, 2),
      ].join('\n')
      if (!(await ctx.ui.showDocument({ title: `${t.name} — SQL and JSON`, text }))) ctx.out.text(text)
    },
  })

  // ---- showing --------------------------------------------------------------------
  r.register({
    path: ['graph'],
    args: [{ name: 'spec', kind: 'text', rest: true }],
    describe: 'Render a graph_spec on screen: graph "y = x^2"',
    async run(ctx, a) {
      const spec = a.spec.replace(/\\n/g, '\n').replace(/\s*;\s*/g, '\n')
      if (!(await ctx.ui.showGraph(spec, 'Graph'))) ctx.out.text(spec)
    },
  })
  r.register({
    path: ['doc'],
    args: [{ name: 'asset', kind: 'asset', rest: true }],
    describe: 'Open a document in the viewer',
    async run(ctx, a) {
      const res = await ctx.api.get<{ assets: AssetRow[] }>('/api/assets')
      const hit =
        (res.assets ?? []).find((x) => x.id === a.asset) ?? (await pickOne(ctx, 'document', a.asset, res.assets ?? [], (x) => x.title))
      if (!hit) return
      if (!(await ctx.ui.showDocument({ assetId: hit.id }))) ctx.out.json(await ctx.api.get(`/api/assets/${hit.id}`))
    },
  })
  r.register({
    path: ['show', 'text'],
    args: [{ name: 'text', kind: 'text', rest: true }],
    describe: 'Put a note on screen (LaTeX renders)',
    async run(ctx, a) {
      if (!(await ctx.ui.showDocument({ title: 'Note', text: a.text }))) ctx.out.text(a.text)
    },
  })

  // ---- live ------------------------------------------------------------------------
  r.register({
    path: ['session', 'new'],
    args: [
      { name: 'name', kind: 'text' },
      { name: 'tag', kind: 'tag', optional: true, rest: true },
    ],
    describe: 'Open a live session of your own: session new "Friday drill" [tag]',
    async run(ctx, a) {
      const tag = a.tag ? await findTag(ctx, a.tag) : null
      if (a.tag && !tag) return
      const res = await ctx.api.post<{ id: string; name: string }>('/api/sessions', { name: a.name, tag_slug: tag?.slug ?? null })
      ctx.out.json(res)
      if (!(await ctx.ui.navigate('live', { session: res.id }))) ctx.out.text(`Session ${res.id} open.`)
    },
  })
  r.register({
    path: ['present'],
    args: [
      { name: 'question', kind: 'question' },
      { name: 'session', kind: 'session', optional: true, rest: true },
    ],
    describe: 'Present a question into a session (the newest open one by default)',
    async run(ctx, a, flags) {
      const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 50 })
      const open = (res.sessions ?? []).filter((x) => !x.ended_at)
      const s = a.session ? await pickOne(ctx, 'session', a.session, open, (x) => x.name) : open[0]
      if (!s) return ctx.out.error(a.session ? '' : 'No open session — session new "<name>" first.')
      let qid = a.question
      if (!/^[0-9a-f-]{32,36}$/i.test(qid)) {
        const qs = await ctx.api.get<{ questions: QuestionRow[] }>('/api/questions', { text: qid, limit: 5 })
        const hit = await pickOne(ctx, 'question', qid, qs.questions ?? [], (q) => q.prompt)
        if (!hit) return
        qid = hit.id
      }
      const out = await ctx.api.post<{ attempt_id: string; response_id: string }>(`/api/sessions/${s.id}/present`, {
        question_id: qid,
        reveal: flags.deferred ? 'deferred' : undefined,
      })
      ctx.out.json(out)
      if (!(await ctx.ui.navigate('live', { session: s.id }))) await ctx.ui.startAttempt(out.attempt_id)
    },
  })
  r.register({
    path: ['ungraded'],
    args: [{ name: 'session', kind: 'session', optional: true, rest: true }],
    describe: 'Written answers waiting for a verdict',
    async run(ctx, a) {
      let session_id: string | undefined
      if (a.session) {
        const res = await ctx.api.get<{ sessions: SessionRow[] }>('/api/sessions', { limit: 100 })
        const s = await pickOne(ctx, 'session', a.session, res.sessions ?? [], (x) => x.name)
        if (!s) return
        session_id = s.id
      }
      const res = await ctx.api.get<{ total: number; responses: Record<string, unknown>[] }>('/api/responses/ungraded', { session_id, limit: 30 })
      ctx.out.table(
        (res.responses ?? []).map((x) => ({
          response: String(x.response_id).slice(0, 8),
          prompt: String(x.prompt).slice(0, 50),
          answer: String(x.response_text ?? '').slice(0, 50),
          self: (x.self_grade as { score: number | null } | null)?.score ?? '—',
        }))
      )
      ctx.out.text(`${res.total} waiting · grade <response> <score> ["diagnosis"]`)
    },
  })
  r.register({
    path: ['grade'],
    args: [
      { name: 'response', kind: 'response' },
      { name: 'score', kind: 'score' },
      { name: 'diagnosis', kind: 'text', optional: true, rest: true },
    ],
    describe: 'Grade a written answer 0..1 as the judge, with a one-line diagnosis',
    async run(ctx, a) {
      const score = Number(a.score)
      if (!(score >= 0 && score <= 1)) return ctx.out.error('Score is 0..1.')
      const res = await ctx.api.get<{ responses: { response_id: string }[] }>('/api/responses/ungraded', { limit: 200 })
      const hits = (res.responses ?? []).filter((x) => x.response_id.startsWith(a.response))
      const id = hits.length === 1 ? hits[0].response_id : a.response
      ctx.out.json(await ctx.api.post(`/api/responses/${encodeURIComponent(id)}/tutor-grade`, { grader: 'judge', score, diagnosis: a.diagnosis ?? null }))
    },
  })
  r.completer('response', async (ctx) => {
    const res = await ctx.api.get<{ responses: { response_id: string; prompt: string; response_text: string | null }[] }>('/api/responses/ungraded', { limit: 50 })
    return (res.responses ?? []).map((x) => ({ value: x.response_id, hint: `${x.prompt.slice(0, 40)} → ${(x.response_text ?? '').slice(0, 30)}` }))
  })
  r.completer('score', async () => [{ value: '1' }, { value: '0.5' }, { value: '0' }])

  // ---- administration --------------------------------------------------------------
  r.completer('admin-scope', async () => [
    { value: 'attempts', hint: 'every attempt, response and grade' },
    { value: 'daily', hint: 'daily draws and their attempts' },
    { value: 'sessions', hint: 'live sessions, their items and shows' },
    { value: 'all', hint: 'all of the above, plus retention and outbox' },
  ])
  r.register({
    path: ['admin', 'status'],
    describe: 'Row counts and database size',
    async run(ctx) {
      ctx.out.json(await ctx.api.get('/api/admin/status'))
    },
  })
  r.register({
    path: ['admin', 'reindex'],
    describe: 'Rebuild the search index and refresh query statistics',
    async run(ctx) {
      ctx.out.json(await ctx.api.post('/api/admin/reindex'))
    },
  })
  r.register({
    path: ['admin', 'clear'],
    args: [{ name: 'scope', kind: 'admin-scope' }],
    describe: 'Delete data: attempts | daily | sessions | all (never the bank)',
    async run(ctx, a) {
      const scope = a.scope.toLowerCase()
      if (!['attempts', 'daily', 'sessions', 'all'].includes(scope)) return ctx.out.error('Scope is attempts, daily, sessions or all.')
      if (!(await ctx.ui.confirm(`Delete ${scope === 'all' ? 'every attempt, daily draw, session, retention row and outbox entry' : scope} on this node? This cannot be undone.`, 'CLEAR'))) return
      ctx.out.json(await ctx.api.post('/api/admin/clear', { scope, confirm: 'CLEAR' }))
    },
  })

  // ---- meta ------------------------------------------------------------------------
  r.register({
    path: ['clear'],
    describe: 'Clear the output',
    async run(ctx) {
      await ctx.ui.shell('clear')
    },
  })
  r.register({
    path: ['restart'],
    describe: 'Restart Osmosis (this node): off and on again',
    async run(ctx) {
      if (!(await ctx.ui.confirm('Restart this Osmosis node? It is back in a few seconds.'))) return
      await ctx.api.post('/api/admin/restart')
      ctx.out.text('Restarting…')
      if (!(await ctx.ui.shell('wait-for-node'))) ctx.out.text('Sent. The node comes back on its own; run status to check.')
    },
  })
  r.register({
    path: ['reload'],
    describe: 'Reload the app',
    async run(ctx) {
      if (!(await ctx.ui.shell('reload'))) ctx.out.text('Nothing to reload in a terminal.')
    },
  })
  r.register({
    path: ['help'],
    args: [{ name: 'command', kind: 'word', optional: true, rest: true }],
    describe: 'This list, or one command',
    async run(ctx, a) {
      ctx.out.text(r.helpText(a.command ? a.command.split(/\s+/) : undefined))
    },
  })

  return r
}
