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
    const res = await ctx.api.get<{ questions: QuestionRow[] }>('/api/questions', { text: partial || undefined, limit: 12 })
    return (res.questions ?? []).map((q) => ({ value: q.id, hint: q.prompt.slice(0, 70) }))
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
    describe: 'Recent attempts',
    async run(ctx) {
      const res = await ctx.api.get<{ attempts: Record<string, unknown>[] }>('/api/attempts', { limit: 20 })
      ctx.out.table(res.attempts, ['id', 'template_name', 'source_kind', 'started_at', 'mean_score'])
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

  // ---- meta ------------------------------------------------------------------------
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
