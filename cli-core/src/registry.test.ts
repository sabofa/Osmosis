import { describe, it, expect } from 'vitest'
import { tokenize } from './parse.js'
import { fuzzyScore } from './fuzzy.js'
import { buildRegistry } from './commands.js'
import { BUILTINS, normalise } from 'theme-core'
import type { Api, CommandContext, NavigateParams, Out, Page, Ui } from './types.js'

describe('tokenize', () => {
  it('splits words, honours quotes and flags, keeps a trailing empty token', () => {
    expect(tokenize('open bank econ').tokens).toEqual(['open', 'bank', 'econ'])
    expect(tokenize('open test "Demand Quiz (Ch. 3)"').tokens).toEqual(['open', 'test', 'Demand Quiz (Ch. 3)'])
    expect(tokenize('q abc --data --limit=5')).toEqual({ tokens: ['q', 'abc'], flags: { data: true, limit: '5' } })
    expect(tokenize('open ').tokens).toEqual(['open', ''])
  })
})

describe('fuzzyScore', () => {
  it('prefers exact, then prefix, then word starts, then subsequence', () => {
    expect(fuzzyScore('econ', 'econ')).toBeGreaterThan(fuzzyScore('econ', 'economics'))
    expect(fuzzyScore('econ', 'economics')).toBeGreaterThan(fuzzyScore('quiz', 'demand quiz'))
    expect(fuzzyScore('quiz', 'demand quiz')).toBeGreaterThan(fuzzyScore('dq', 'demand quiz'))
    expect(fuzzyScore('zzz', 'economics')).toBeLessThan(0)
  })
})

// A fake node with a handful of tags, tests and settings.
function fakeCtx() {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const nav: { page: Page; params?: NavigateParams }[] = []
  const lines: string[] = []
  const themeCalls: { fn: string; arg?: unknown }[] = []
  const hooks: {
    here: { lat: number; lon: number } | null
    active: string | null
    activeWs: string | null
    putError: { message: string } | null
  } = { here: { lat: 1, lon: 2 }, active: 'builtin:forest', activeWs: null, putError: null }
  const api: Api = {
    async get(path, query) {
      calls.push({ method: 'GET', path })
      if (path === '/api/tags')
        return {
          tags: [
            { slug: 'econ', label: 'Economics', question_count: 50 },
            { slug: 'econ:demand', label: 'Demand', question_count: 50 },
            { slug: 'math', label: 'Math', question_count: 8 },
          ],
        }
      if (path === '/api/templates')
        return { templates: [{ id: 't1', name: 'Demand Quiz (Ch. 3) — 50 Questions', question_count: 50, retired_at: null }] }
      if (path === '/api/themes')
        return {
          themes: [
            { id: 'mine', name: 'Mine', layer: 'ambience', manifest: normalise({ id: 'mine', name: 'Mine', layer: 'ambience', seeds: { light: { accent: '#c65d22' } } as never }) },
            { id: 'retro', name: 'Retro', layer: 'workspace', manifest: normalise({ id: 'retro', name: 'Retro', layer: 'workspace', dials: { roundness: 0 } }) },
            { id: 'allin', name: 'Allin', layer: null, manifest: normalise({ id: 'allin', name: 'Allin', seeds: { light: { accent: '#224488' } } as never }) },
          ],
          builtins: BUILTINS.filter((b) => ['builtin:osmosis', 'builtin:forest', 'builtin:ws-clean'].includes(b.id)).map((b) => ({
            id: b.id,
            name: b.name,
            layer: b.layer ?? null,
            manifest: b,
          })),
          active_theme_id: hooks.active,
          active_workspace_theme_id: hooks.activeWs,
          location: { lat: 40.1164, lon: -88.2434 },
        }
      if (path === '/api/config') return { abandon_after_hours: 24, daily_quiz_size: 10 }
      if (path === '/api/status') return { daily_taken: { question: 'x', quiz: null } }
      if (path === '/api/questions') return { total: 1, questions: [{ id: 'q1', prompt: `about ${query?.text}`, type: 'mc', tags: [] }] }
      return {}
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body })
      return { attempt_id: 'a1' }
    },
    async patch(path, body) {
      calls.push({ method: 'PATCH', path, body })
      return {}
    },
    async put(path, body) {
      calls.push({ method: 'PUT', path, body })
      if (hooks.putError) throw new Error(hooks.putError.message)
      return { key: 'abandon_after_hours', value: body }
    },
    async del(path) {
      calls.push({ method: 'DELETE', path })
      return {}
    },
  }
  const out: Out = {
    text: (s) => lines.push(s),
    table: (rows) => lines.push(`table:${rows.length}`),
    json: (v) => lines.push(JSON.stringify(v)),
    error: (s) => lines.push(`error:${s}`),
  }
  const ui: Ui = {
    surface: 'app',
    navigate: async (page, params) => (nav.push({ page, params }), true),
    back: async () => true,
    showGraph: async () => true,
    showDocument: async () => true,
    showQuestion: async () => true,
    startAttempt: async () => true,
    openThemeEditor: async () => true,
    setThemeMode: async (m) => (themeCalls.push({ fn: 'mode', arg: m }), true),
    setThemeBlend: async (b) => (themeCalls.push({ fn: 'blend', arg: b }), true),
    requestLocation: async () => hooks.here,
    themeState: async () => ({ source: 'sun', effectiveSource: 'sun', mode: 'dark', blend: 0.5, twilightBlend: true }),
    openReview: async () => true,
    shell: async () => true,
    confirm: async () => true,
    prompt: async () => null,
  }
  const ctx: CommandContext = { api, out, ui }
  return { ctx, calls, nav, lines, themeCalls, hooks }
}

describe('registry', () => {
  it('completes command words, then arguments of the right kind', async () => {
    const r = buildRegistry()
    const { ctx } = fakeCtx()
    const words = await r.complete(ctx, 'op')
    expect(words.suggestions[0].insert).toBe('open')
    const sub = await r.complete(ctx, 'open ')
    expect(sub.suggestions.map((s) => s.insert)).toEqual(expect.arrayContaining(['bank', 'test', 'results']))
    const tag = await r.complete(ctx, 'open bank econ')
    expect(tag.suggestions[0].insert).toBe('econ')
    expect(tag.suggestions.map((s) => s.label)).toContain('econ:demand')
    const test = await r.complete(ctx, 'open test dem')
    expect(test.suggestions[0].label).toMatch(/Demand Quiz/)
    expect(test.suggestions[0].insert.startsWith('"')).toBe(true)
  })

  it('runs a navigation command with a fuzzy tag', async () => {
    const r = buildRegistry()
    const { ctx, nav } = fakeCtx()
    await r.run(ctx, 'open bank economics')
    expect(nav).toEqual([{ page: 'bank', params: { tag: 'econ' } }])
  })

  it('opens a bare tag or test name with no verb', async () => {
    const r = buildRegistry()
    const { ctx, nav } = fakeCtx()
    await r.run(ctx, 'math')
    expect(nav.at(-1)).toEqual({ page: 'bank', params: { tag: 'math' } })
    await r.run(ctx, 'demand quiz')
    expect(nav.at(-1)).toEqual({ page: 'library', params: { template: 't1' } })
  })

  it('reports a missing argument and an unknown command', async () => {
    const r = buildRegistry()
    const { ctx, lines } = fakeCtx()
    await r.run(ctx, 'set')
    expect(lines.at(-1)).toMatch(/missing <key>/)
    await r.run(ctx, 'frobnicate the thing')
    expect(lines.at(-1)).toMatch(/Unknown command/)
  })

  it('daily refuses a second go and starts the other kind', async () => {
    const r = buildRegistry()
    const { ctx, lines, calls } = fakeCtx()
    await r.run(ctx, 'daily q')
    expect(lines.at(-1)).toMatch(/already done/)
    await r.run(ctx, 'daily quiz')
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/api/attempts', body: { daily_kind: 'quiz' } })
  })

  it('set parses numbers and JSON', async () => {
    const r = buildRegistry()
    const { ctx, calls } = fakeCtx()
    await r.run(ctx, 'set abandon_after_hours 12')
    expect(calls.at(-1)).toEqual({ method: 'PATCH', path: '/api/config', body: { key: 'abandon_after_hours', value: 12 } })
  })
})

describe('theme commands', () => {
  const put = (calls: { method: string; path: string; body?: unknown }[]) => calls.filter((c) => c.method === 'PUT')

  it('theme light/mode/blend go through the Ui', async () => {
    const r = buildRegistry()
    const { ctx, themeCalls } = fakeCtx()
    await r.run(ctx, 'theme light')
    await r.run(ctx, 'theme mode sun')
    await r.run(ctx, 'theme blend on')
    await r.run(ctx, 'theme blend off')
    expect(themeCalls).toEqual([
      { fn: 'mode', arg: 'light' },
      { fn: 'mode', arg: 'sun' },
      { fn: 'blend', arg: true },
      { fn: 'blend', arg: false },
    ])
  })

  it('theme <name> activates a builtin', async () => {
    const r = buildRegistry()
    const { ctx, calls, lines } = fakeCtx()
    await r.run(ctx, 'theme forest')
    expect(put(calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'builtin:forest' } }])
    expect(lines.at(-1)).toMatch(/^Theme: /)
  })

  it('theme set switches by exact id or name', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme set builtin:forest')
    expect(put(a.calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'builtin:forest' } }])
    const b = fakeCtx()
    await r.run(b.ctx, 'theme set Mine')
    expect(put(b.calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'mine' } }])
  })

  it('theme tokens says when nothing matches', async () => {
    const r = buildRegistry()
    const { ctx, lines } = fakeCtx()
    await r.run(ctx, 'theme tokens zzzqqq')
    expect(lines.at(-1)).toBe('no tokens match "zzzqqq"')
  })

  it('theme location validates and stores', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme location 40.11,-88.24')
    expect(put(a.calls)).toEqual([{ method: 'PUT', path: '/api/themes/location', body: { lat: 40.11, lon: -88.24 } }])
    const b = fakeCtx()
    await r.run(b.ctx, 'theme location 999,0')
    expect(put(b.calls)).toEqual([])
    expect(b.lines.at(-1)).toMatch(/^error:/)
    const c = fakeCtx()
    await r.run(c.ctx, 'theme location here')
    expect(put(c.calls)).toEqual([{ method: 'PUT', path: '/api/themes/location', body: { lat: 1, lon: 2 } }])
    const d = fakeCtx()
    d.hooks.here = null
    await r.run(d.ctx, 'theme location here')
    expect(put(d.calls)).toEqual([])
    expect(d.lines.at(-1)).toMatch(/app/)
    const e = fakeCtx()
    await r.run(e.ctx, 'theme location clear')
    expect(put(e.calls)).toEqual([{ method: 'PUT', path: '/api/themes/location', body: null }])
  })

  it('theme list marks the active theme', async () => {
    const r = buildRegistry()
    const { ctx, lines } = fakeCtx()
    await r.run(ctx, 'theme list')
    const text = lines.join(' / ')
    expect(text).toMatch(/\* .*builtin:forest/)
    expect(text).toMatch(/Mine/)
  })

  it('theme show reports mode and sun times', async () => {
    const r = buildRegistry()
    const { ctx, lines } = fakeCtx()
    await r.run(ctx, 'theme show')
    const text = lines.join(' / ')
    expect(text).toMatch(/builtin:forest/)
    expect(text).toMatch(/sunrise \d\d:\d\d/)
    expect(text).toMatch(/blend/)
  })

  it('theme tokens filters by name and names the mode', async () => {
    const r = buildRegistry()
    const { ctx, lines } = fakeCtx()
    await r.run(ctx, 'theme tokens accent')
    expect(lines[0]).toMatch(/dark/)
    const rows = lines.slice(1).filter((l) => l.includes('|'))
    expect(rows.length).toBeGreaterThan(0)
    for (const l of rows) expect(l.split('|')[0].toLowerCase()).toContain('accent')
  })

  it('completes theme with sun', async () => {
    const r = buildRegistry()
    const { ctx } = fakeCtx()
    const res = await r.complete(ctx, 'theme su')
    expect(res.suggestions.map((s) => s.insert)).toContain('sun')
  })
})

describe('theme workspace commands', () => {
  const put = (calls: { method: string; path: string; body?: unknown }[]) => calls.filter((c) => c.method === 'PUT')

  it('theme workspace <name> sets the workspace slot', async () => {
    const r = buildRegistry()
    const { ctx, calls, lines } = fakeCtx()
    await r.run(ctx, 'theme workspace Retro')
    expect(put(calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'retro', layer: 'workspace' } }])
    expect(lines.at(-1)).toBe('Workspace theme: Retro')
  })

  it('theme workspace picks a builtin by id and refuses an ambience theme', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme workspace builtin:ws-clean')
    expect(put(a.calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'builtin:ws-clean', layer: 'workspace' } }])
    const b = fakeCtx()
    await r.run(b.ctx, 'theme workspace Mine')
    expect(put(b.calls)).toEqual([])
    expect(b.lines.at(-1)).toBe('error:Mine is an ambience theme — use: theme Mine')
  })

  it('theme workspace clear sends null', async () => {
    const r = buildRegistry()
    const { ctx, calls, lines } = fakeCtx()
    await r.run(ctx, 'theme workspace clear')
    expect(put(calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: null, layer: 'workspace' } }])
    expect(lines.at(-1)).toBe('Workspace theme: none (the ambience theme controls everything)')
  })

  it('theme workspace list shows workspace and full themes, never ambience-only', async () => {
    const r = buildRegistry()
    const { ctx, lines, hooks } = fakeCtx()
    hooks.activeWs = 'retro'
    await r.run(ctx, 'theme workspace list')
    const text = lines.join('\n')
    expect(text).toMatch(/builtin:ws-clean.*workspace.*\(builtin\)/)
    expect(text).toMatch(/\* retro.*Retro.*workspace/)
    expect(text).toMatch(/allin.*Allin.*full/)
    expect(text).not.toMatch(/Mine/)
    expect(lines.filter((l) => l.startsWith('*'))).toHaveLength(1)
  })

  it('theme <workspace theme> does not PUT and points at theme workspace', async () => {
    const r = buildRegistry()
    const { ctx, calls, lines } = fakeCtx()
    await r.run(ctx, 'theme Retro')
    expect(put(calls)).toEqual([])
    expect(lines.at(-1)).toBe('Retro is a workspace theme — use: theme workspace Retro')
    const b = fakeCtx()
    await r.run(b.ctx, 'theme set builtin:ws-clean')
    expect(put(b.calls)).toEqual([])
    expect(b.lines.at(-1)).toMatch(/is a workspace theme — use: theme workspace /)
  })

  it('theme forest and a full theme still switch the ambience slot', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme forest')
    expect(put(a.calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'builtin:forest' } }])
    const b = fakeCtx()
    await r.run(b.ctx, 'theme Allin')
    expect(put(b.calls)).toEqual([{ method: 'PUT', path: '/api/themes/active', body: { id: 'allin' } }])
  })

  it('surfaces a server wrong_layer message from either PUT', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    a.hooks.putError = { message: 'Theme cannot be the workspace theme (layer: ambience)' }
    await r.run(a.ctx, 'theme workspace Allin')
    expect(a.lines.at(-1)).toBe('error:Theme cannot be the workspace theme (layer: ambience)')
    const b = fakeCtx()
    b.hooks.putError = { message: 'wrong layer from server' }
    await r.run(b.ctx, 'theme forest')
    expect(b.lines.at(-1)).toBe('error:wrong layer from server')
  })

  it('theme list shows layers and marks both active themes', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    a.hooks.activeWs = 'retro'
    await r.run(a.ctx, 'theme list')
    const text = a.lines.join('\n')
    expect(text).toMatch(/^\* {2}builtin:forest.*full/m)
    expect(text).toMatch(/^ w retro.*workspace/m)
    expect(text).toMatch(/allin.*full/)
    expect(text).toMatch(/Mine.*ambience/)
    const b = fakeCtx()
    b.hooks.active = 'allin'
    b.hooks.activeWs = 'allin'
    await r.run(b.ctx, 'theme list')
    expect(b.lines.join('\n')).toMatch(/^\*w allin/m)
  })

  it('theme show prints both slots and the layer note', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme show')
    expect(a.lines).toContain('ambience: Forest (builtin:forest)')
    expect(a.lines).toContain('workspace: none')
    expect(a.lines).toContain(
      'layers: shape/type/space/material tokens come from the workspace theme when one is set; colours, graphs, ambience come from the ambience theme'
    )
    expect(a.lines.join('\n')).toMatch(/sunrise/)
    const b = fakeCtx()
    b.hooks.activeWs = 'retro'
    await r.run(b.ctx, 'theme show')
    expect(b.lines).toContain('workspace: Retro (retro)')
  })

  it('theme tokens carries an owner column and composes the workspace theme', async () => {
    const r = buildRegistry()
    const a = fakeCtx()
    await r.run(a.ctx, 'theme tokens radius')
    const row = a.lines.find((l) => l.startsWith('radius-md |'))!
    expect(row.split(' | ').at(-1)).toBe('workspace')
    const plain = row.split(' | ')[1]
    expect(plain).not.toBe('0px')
    const b = fakeCtx()
    b.hooks.activeWs = 'retro'
    await r.run(b.ctx, 'theme tokens radius')
    expect(b.lines[0]).toMatch(/Retro/)
    const composed = b.lines.find((l) => l.startsWith('radius-md |'))!
    expect(composed.split(' | ')[1]).toBe('0px')
    const c = fakeCtx()
    await r.run(c.ctx, 'theme tokens color-accent')
    expect(c.lines.find((l) => l.startsWith('color-accent |'))!.split(' | ').at(-1)).toBe('ambience')
  })

  it('completes theme workspace subcommands and themes', async () => {
    const r = buildRegistry()
    const { ctx } = fakeCtx()
    const top = await r.complete(ctx, 'theme work')
    expect(top.suggestions.map((s) => s.insert)).toContain('workspace')
    const sub = await r.complete(ctx, 'theme workspace ')
    const ins = sub.suggestions.map((s) => s.insert)
    expect(ins).toEqual(expect.arrayContaining(['list', 'clear']))
    const named = await r.complete(ctx, 'theme workspace re')
    expect(named.suggestions.map((s) => s.label)).toContain('Retro')
    const all = await r.complete(ctx, 'theme workspace m')
    expect(all.suggestions.map((s) => s.label)).not.toContain('Mine')
  })
})
