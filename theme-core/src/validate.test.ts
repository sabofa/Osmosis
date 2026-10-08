import { describe, expect, it } from 'vitest'
import { MAX_CSS_BYTES, validate } from './validate.js'
import { BUILTINS } from './builtins/index.js'
import { RESERVED_THEME_IDS } from './manifest.js'

const base = (extra: Record<string, unknown> = {}) => ({ schema: 1, id: 'a', name: 'A', seeds: {}, dials: {}, fonts: {}, ...extra })

describe('validate: structural errors', () => {
  const cases: [string, unknown, string][] = [
    ['schema', base({ schema: 2 }), 'schema'],
    ['id type', base({ id: 5 }), 'id'],
    ['id shape', base({ id: 'Bad Id' }), 'id'],
    ['builtin id', base({ id: 'builtin:x' }), 'id'],
    ['name empty', base({ name: '' }), 'name'],
    ['name type', base({ name: 3 }), 'name'],
    ['unknown field', base({ zzz: 1 }), 'zzz'],
    ['author', base({ author: 'bot' }), 'author'],
    ['seeds type', base({ seeds: [] }), 'seeds'],
    ['dials type', base({ dials: 'x' }), 'dials'],
    ['fonts type', base({ fonts: 1 }), 'fonts'],
    ['overrides type', base({ overrides: 1 }), 'overrides'],
    ['graph type', base({ graph: 1 }), 'graph'],
    ['seed colour', base({ seeds: { light: { accent: 'nope' } } }), 'seeds.light.accent'],
    ['seed non-string', base({ seeds: { light: { accent: 4 } } }), 'seeds.light.accent'],
    ['series type', base({ seeds: { light: { series: 'x' } } }), 'seeds.light.series'],
    ['series entry', base({ seeds: { dark: { series: ['#fff', 'bad'] } } }), 'seeds.dark.series[1]'],
    ['series max', base({ seeds: { dark: { series: Array(17).fill('#fff') } } }), 'seeds.dark.series'],
    ['seed key', base({ seeds: { light: { glow: '#fff' } } }), 'seeds.light.glow'],
    ['seed mode', base({ seeds: { dim: {} } }), 'seeds.dim'],
    ['dial range', base({ dials: { roundness: 1.5 } }), 'dials.roundness'],
    ['dial typeScale', base({ dials: { typeScale: 1.0 } }), 'dials.typeScale'],
    ['dial baseSize', base({ dials: { baseSize: 20 } }), 'dials.baseSize'],
    ['dial twilight', base({ dials: { twilightBlend: 1 } }), 'dials.twilightBlend'],
    ['dial unknown', base({ dials: { vibes: 1 } }), 'dials.vibes'],
    ['font stack', base({ fonts: { body: { stack: 'comic' } } }), 'fonts.body'],
    ['font asset', base({ fonts: { body: { asset: '' } } }), 'fonts.body'],
    ['font role', base({ fonts: { cursive: { stack: 'inter' } } }), 'fonts.cursive'],
    ['override mode', base({ overrides: { dim: {} } }), 'overrides.dim'],
    ['override unknown token', base({ overrides: { light: { 'color-nope': '#fff' } } }), 'overrides.light.color-nope'],
    ['override bad value', base({ overrides: { dark: { 'color-accent': 'zzz' } } }), 'overrides.dark.color-accent'],
    ['css type', base({ css: 5 }), 'css'],
    ['board colour', base({ graph: { boards: { blackboard: 'x' } } }), 'graph.boards.blackboard'],
    ['board name', base({ graph: { boards: { redboard: '#fff' } } }), 'graph.boards.redboard'],
  ]
  it.each(cases)('%s', (_n, raw, path) => {
    const r = validate(raw)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.path === path || e.path.startsWith(path))).toBe(true)
  })
  it.each([['x'], [null], [[]], [5]])('non-object %j', (raw) => {
    const r = validate(raw)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
  it('builtin message', () => {
    expect(validate(base({ id: 'builtin:x' })).errors[0]!.message).toBe('builtin ids are reserved')
  })
  it('70 KB css', () => {
    const r = validate(base({ css: 'a'.repeat(70 * 1024) }))
    expect(r.ok).toBe(false)
    expect(r.errors[0]!.path).toBe('css')
  })
  it('multibyte css over bytes, under chars', () => {
    const css = String.fromCharCode(0x20ac).repeat(Math.floor(MAX_CSS_BYTES / 3) + 1) // 3 bytes per char
    expect(css.length).toBeLessThan(MAX_CSS_BYTES)
    expect(validate(base({ css })).ok).toBe(false)
  })
  it('enum override lists allowed', () => {
    const r = validate(base({ overrides: { any: { 'elevation-mode': 'neon' } } }))
    expect(r.ok).toBe(false)
    expect(r.errors[0]!.message).toContain('hairline')
  })
  it('corner-shape squircle ok', () => {
    expect(validate(base({ overrides: { any: { 'corner-shape': 'squircle' } } })).ok).toBe(true)
  })
})

describe('validate: ok cases', () => {
  it('minimal', () => {
    const r = validate({ schema: 1, id: 'a', name: 'A', seeds: {}, dials: {}, fonts: {} })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('reserved slots untouched', () => {
    const r = validate(base({ ambience: 5, sounds: [1], assets: { x: 1 }, graph: { papers: 'zzz', styles: 3, media: 'q' } }))
    expect(r.ok).toBe(true)
  })
  it('builtins validate with no text warnings', () => {
    for (const b of BUILTINS) {
      // builtin ids are reserved for saving, so validate a user copy
      const r = validate({ ...b, id: b.id.replace('builtin:', 'copy-') })
      expect(r.errors).toEqual([])
      expect(r.ok).toBe(true)
      expect(r.warnings.filter((w) => w.path.includes('color-text'))).toEqual([])
    }
  })
  it('builtin ids themselves are refused', () => {
    expect(validate(BUILTINS[0]).ok).toBe(false)
  })
})

describe('validate: warnings', () => {
  const weak = () => base({ seeds: { light: { ink: '#ddddcc', canvas: '#eef1e5' } } })
  it('low text contrast warns with suggestion that fixes it', () => {
    const r = validate(weak())
    expect(r.ok).toBe(true)
    const w = r.warnings.find((x) => x.path === 'overrides.light.color-text' && x.message.includes('color-canvas'))!
    expect(w).toBeTruthy()
    expect(w.message).toMatch(/\d\.\d/)
    const m = /set color-text to (#[0-9a-f]{6}) \(contrast/.exec(w.suggestion!)!
    expect(m).toBeTruthy()
    const fixed = base({ seeds: { light: { ink: '#ddddcc', canvas: '#eef1e5' } }, overrides: { light: { 'color-text': m[1] } } })
    const r2 = validate(fixed)
    expect(r2.warnings.find((x) => x.path === 'overrides.light.color-text' && x.message.includes('color-canvas'))).toBeUndefined()
  })
  it('no warnings computed when errors exist', () => {
    const r = validate({ ...weak(), zzz: 1 })
    expect(r.warnings).toEqual([])
  })
})

describe('validate: minimal manifests', () => {
  it.each([
    ['bare', { schema: 1, id: 'x', name: 'X' }],
    ['override only', { schema: 1, id: 'x', name: 'X', overrides: { light: { 'color-accent': '#123456' } } }],
    ['seeds only', { schema: 1, id: 'x', name: 'X', seeds: { light: { accent: '#c65d22' } } }],
  ])('%s is ok', (_n, raw) => {
    const r = validate(raw)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('validate: suggestions clear their warnings', () => {
  type Fx = { mode: 'light' | 'dark'; token: string; seeds: Record<string, unknown>; overrides?: Record<string, string> }
  const fx = (mode: 'light' | 'dark', token: string, seeds: Record<string, unknown>, overrides?: Record<string, string>): Fx => ({ mode, token, seeds, overrides })
  const fixtures: Fx[] = []
  for (const mode of ['light', 'dark'] as const) {
    const lt = mode === 'light'
    fixtures.push(
      fx(mode, 'color-text', lt ? { ink: '#cccccc', canvas: '#ffffff' } : { ink: '#333333', canvas: '#222222' }),
      fx(mode, 'color-text', lt ? { ink: '#eeeecc', canvas: '#eef1e5' } : { ink: '#444444', canvas: '#111111' }),
      fx(mode, 'color-text', lt ? { ink: '#767676', canvas: '#ffffff', surface: '#cccccc' } : { ink: '#aaaaaa', canvas: '#111111', surface: '#999999' }),
      fx(mode, 'color-text', lt ? { ink: '#555555', canvas: '#ffffff', surface: '#888888' } : { ink: '#888888', canvas: '#000000', surface: '#777777' }),
      fx(mode, 'color-text-muted', {}, { 'color-text-muted': lt ? '#dddddd' : '#222222' }),
      fx(mode, 'color-text-muted', {}, { 'color-text-muted': lt ? '#bbbbbb' : '#444444' }),
      fx(mode, 'color-focus', {}, { 'color-focus': lt ? '#eeeeee' : '#222222' }),
      fx(mode, 'color-focus', {}, { 'color-focus': lt ? '#cccc99' : '#334455' }),
      fx(mode, 'color-text-on-accent', { accent: '#eeeeee' }, { 'color-text-on-accent': '#dddddd' }),
      fx(mode, 'color-text-on-accent', { accent: '#223344' }, { 'color-text-on-accent': '#334455' }),
      fx(mode, 'color-series-1', {}, { 'color-series-1': lt ? '#eeeeee' : '#222222' }),
      fx(mode, 'color-series-2', {}, { 'color-series-2': lt ? '#ddddaa' : '#333344' }),
    )
  }
  it.each(fixtures.map((f, i) => [`${f.mode} ${f.token} #${i}`, f] as const))('%s', (_n, f) => {
    const make = (override?: string) => {
      const ov = { ...f.overrides }
      if (override) ov[f.token] = override
      return base({ seeds: { [f.mode]: f.seeds }, overrides: { [f.mode]: ov } })
    }
    const path = `overrides.${f.mode}.${f.token}`
    const r = validate(make())
    expect(r.errors).toEqual([])
    const ws = r.warnings.filter((w) => w.path === path)
    expect(ws.length).toBeGreaterThan(0)
    const hexes = new Set<string>()
    for (const w of ws) {
      if (w.suggestion === undefined) continue
      const m = /^set \S+ to (#[0-9a-f]{6}) \(contrast/.exec(w.suggestion)
      expect(m).toBeTruthy()
      hexes.add(m![1]!)
    }
    expect(hexes.size).toBeLessThanOrEqual(1)
    if (hexes.size === 0) return
    const r2 = validate(make([...hexes][0]))
    expect(r2.errors).toEqual([])
    expect(r2.warnings.filter((w) => w.path === path)).toEqual([])
  })
  it('color-text failing both backgrounds gives both warnings the same suggestion', () => {
    const r = validate(base({ seeds: { light: { ink: '#cccccc', canvas: '#ffffff', surface: '#eeeeee' } } }))
    const ws = r.warnings.filter((w) => w.path === 'overrides.light.color-text')
    expect(ws.length).toBe(2)
    expect(ws[0]!.suggestion).toBeTruthy()
    expect(ws[0]!.suggestion).toBe(ws[1]!.suggestion)
  })
  it('an impossible suggestion is omitted, not wrong', () => {
    const seeds = { light: { canvas: '#777777', surface: '#777777' } }
    const r = validate(base({ seeds, overrides: { light: { 'color-text': '#777777' } } }))
    const ws = r.warnings.filter((w) => w.path === 'overrides.light.color-text')
    expect(ws.length).toBeGreaterThan(0)
    for (const w of ws) {
      if (w.suggestion === undefined) continue
      const hex = /(#[0-9a-f]{6})/.exec(w.suggestion)![1]!
      const r2 = validate(base({ seeds, overrides: { light: { 'color-text': hex } } }))
      expect(r2.warnings.filter((x) => x.path === 'overrides.light.color-text')).toEqual([])
    }
  })
})

describe('validate: series closeness', () => {
  const closeWarns = (raw: unknown) => validate(raw).warnings.filter((w) => w.path.startsWith('color-series-') && w.path.includes('/'))
  it('builtins produce none', () => {
    for (const b of BUILTINS) expect(closeWarns({ ...b, id: b.id.replace('builtin:', 'copy-') })).toEqual([])
  })
  it('close user series warns in each mode', () => {
    const w = closeWarns(base({ seeds: { light: { series: ['#336699', '#336698'] } } }))
    expect(w.some((x) => x.message.startsWith('light:'))).toBe(true)
    expect(w.some((x) => x.message.startsWith('dark:'))).toBe(true)
    expect(w.filter((x) => x.message.startsWith('light:')).length).toBe(1)
  })
  it('separated user series is fine', () => {
    expect(closeWarns(base({ seeds: { light: { series: ['#cc3333', '#33aa33', '#3333cc'] } } }))).toEqual([])
  })
})

describe('validate: utf8 css byte counting', () => {
  const f = String.fromCharCode
  const ok = (unit: string, count: number) => validate(base({ css: unit.repeat(count) })).ok
  it('astral pair counts 4', () => {
    const pair = f(0xd83d, 0xde00)
    expect(ok(pair, MAX_CSS_BYTES / 4)).toBe(true)
    expect(ok(pair, MAX_CSS_BYTES / 4 + 1)).toBe(false)
  })
  it('euro counts 3, e-acute 2', () => {
    expect(ok(f(0x20ac), Math.floor(MAX_CSS_BYTES / 3))).toBe(true)
    expect(ok(f(0x20ac), Math.floor(MAX_CSS_BYTES / 3) + 1)).toBe(false)
    expect(ok(f(0xe9), MAX_CSS_BYTES / 2)).toBe(true)
    expect(ok(f(0xe9), MAX_CSS_BYTES / 2 + 1)).toBe(false)
  })
  it('lone high surrogate then euro = 3 + 3 per unit', () => {
    const unit = f(0xd83d) + f(0x20ac)
    expect(ok(unit, Math.floor(MAX_CSS_BYTES / 6))).toBe(true)
    expect(ok(unit, Math.floor(MAX_CSS_BYTES / 6) + 1)).toBe(false)
  })
  it('lone low surrogate counts 3', () => {
    expect(ok(f(0xdc00), Math.floor(MAX_CSS_BYTES / 3))).toBe(true)
    expect(ok(f(0xdc00), Math.floor(MAX_CSS_BYTES / 3) + 1)).toBe(false)
  })
})

describe('validate: message hygiene', () => {
  it('weird values do not throw and keep messages short', () => {
    const r1 = validate(base({ seeds: { light: { accent: Object.create(null) } } }))
    const r2 = validate(base({ seeds: { light: { accent: 'x'.repeat(100000) } }, overrides: { any: { 'color-accent': 'y'.repeat(100000) } } }))
    const r3 = validate(base({ seeds: { light: { ['k'.repeat(100000)]: '#fff' } } }))
    for (const r of [r1, r2, r3]) {
      expect(r.ok).toBe(false)
      expect(r.errors.length).toBeGreaterThan(0)
      for (const e of r.errors) expect(e.message.length).toBeLessThanOrEqual(200)
    }
  })
  it.each(['__proto__', 'constructor'])('%s keys are rejected as unknown', (k) => {
    const mk = (obj: string) => JSON.parse(obj.split('KEY').join(k))
    const cases = [
      mk('{"schema":1,"id":"a","name":"A","KEY":{"polluted":1}}'),
      mk('{"schema":1,"id":"a","name":"A","overrides":{"any":{"KEY":"#fff"}}}'),
      mk('{"schema":1,"id":"a","name":"A","overrides":{"KEY":{}}}'),
      mk('{"schema":1,"id":"a","name":"A","seeds":{"light":{"KEY":"#fff"}}}'),
      mk('{"schema":1,"id":"a","name":"A","seeds":{"KEY":{}}}'),
    ]
    for (const raw of cases) {
      const r = validate(raw)
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.path.includes(k))).toBe(true)
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })
})

describe('validate: reserved ids', () => {
  it('rejects ids that collide with static theme routes', () => {
    for (const id of RESERVED_THEME_IDS) {
      const r = validate(base({ id }))
      expect(r.errors.some((e) => e.path === 'id' && e.message === 'id is reserved')).toBe(true)
    }
    expect(RESERVED_THEME_IDS).toEqual(['active', 'location', 'validate'])
  })
})
