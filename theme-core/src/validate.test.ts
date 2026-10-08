import { describe, expect, it } from 'vitest'
import { MAX_CSS_BYTES, validate } from './validate.js'
import { BUILTINS } from './builtins/index.js'

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
