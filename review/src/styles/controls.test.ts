import { describe, expect, it } from 'vitest'
import { defaultTheme } from '../../../graph-engine/src/style/theme/adapter'
import type { SettingSpec, SettingValue } from '../../../graph-engine/src/style/settings/types'
import {
  clampNumber, curvePath, customFromDefault, decimalsOfStep, formatNumber, groupSpecs, isOwn, layerFromKey, layerKey, shownValue, themeInputOf, THEME_CHOICE_IDS,
} from './controls'

const spec = (over: Partial<SettingSpec>): SettingSpec => ({
  path: 'a.b', label: 'B', group: 'A', type: 'number', default: 0, appliesTo: { graphTypes: ['space'], media: 'all' }, ...over,
})

describe('groupSpecs', () => {
  it('groups by spec.group in first-seen order', () => {
    const g = groupSpecs([spec({ path: '1', group: 'X' }), spec({ path: '2', group: 'Y' }), spec({ path: '3', group: 'X' })])
    expect(g.map((x) => x.group)).toEqual(['X', 'Y'])
    expect(g[0].specs.map((s) => s.path)).toEqual(['1', '3'])
  })
  it('is empty for no specs', () => expect(groupSpecs([])).toEqual([]))
})

describe('shownValue / isOwn', () => {
  const own = new Map<string, SettingValue>([['a', 0]])
  const inh = new Map<string, SettingValue>([['a', 5], ['b', 'x']])
  it('own wins, even a zero; else inherited; else undefined', () => {
    expect(shownValue('a', own, inh)).toBe(0)
    expect(shownValue('b', own, inh)).toBe('x')
    expect(shownValue('c', own, inh)).toBeUndefined()
    expect(isOwn('a', own)).toBe(true)
    expect(isOwn('b', own)).toBe(false)
  })
})

describe('clampNumber', () => {
  it('clamps to min and max', () => {
    const s = spec({ min: 0, max: 1, step: 0.1 })
    expect(clampNumber(s, -3)).toBe(0)
    expect(clampNumber(s, 9)).toBe(1)
  })
  it('snaps to the step from min without float noise', () => {
    expect(clampNumber(spec({ min: 0, max: 1, step: 0.1 }), 0.30000000004)).toBe(0.3)
    expect(clampNumber(spec({ min: 1, max: 10, step: 2 }), 4.2)).toBe(5)
  })
  it('keeps an integer whole, inside the range', () => {
    expect(clampNumber(spec({ integer: true, min: 0, max: 10 }), 3.6)).toBe(4)
    expect(clampNumber(spec({ integer: true, min: 0.5, max: 10 }), 0)).toBe(1)
    expect(clampNumber(spec({ integer: true, min: 0, max: 9.5 }), 20)).toBe(9)
  })
  it('refuses what is not a number', () => {
    expect(clampNumber(spec({}), NaN)).toBeUndefined()
    expect(clampNumber(spec({}), Infinity)).toBeUndefined()
  })
})

describe('number display', () => {
  it('reads decimals from the step', () => {
    expect(decimalsOfStep(1)).toBe(0)
    expect(decimalsOfStep(0.05)).toBe(2)
    expect(decimalsOfStep(1e-4)).toBe(4)
    expect(decimalsOfStep(undefined)).toBe(3)
  })
  it('formats', () => {
    expect(formatNumber(spec({ step: 0.05 }), 0.3)).toBe('0.30')
    expect(formatNumber(spec({ integer: true, step: 0.5 }), 3)).toBe('3')
  })
})

describe('curvePath', () => {
  it('maps points into the box, y up', () => {
    expect(curvePath([[0, 0], [1, 1]], { min: 0, max: 1 }, 100, 50)).toBe('M0.0 50.0 L100.0 0.0')
  })
  it('honours a y range', () => {
    expect(curvePath([[0.5, 0]], { min: -1, max: 1 }, 10, 10)).toBe('M5.0 5.0')
  })
})

describe('layers', () => {
  it('round-trips a layer through its key', () => {
    for (const l of [{ kind: 'theme' }, { kind: 'document' }, { kind: 'themeType', graphType: 'space' }] as const) expect(layerFromKey(layerKey(l))).toEqual(l)
  })
})

describe('themeInputOf', () => {
  it('light and dark are the default themes', () => {
    expect(themeInputOf({ id: 'light' })).toBe(defaultTheme('light'))
    expect(themeInputOf({ id: 'dark' })).toBe(defaultTheme('dark'))
  })
  it('a built-in brings its light colours', () => {
    const t = themeInputOf({ id: 'builtin:forest' })
    expect(t.mode).toBe('light')
    expect(t.colours.accent).toBe('#2f7a4f')
    expect(t.colours.surface).toBe('#fbfcf8')
  })
  it('the built-ins differ from each other', () => {
    const keys = new Set(THEME_CHOICE_IDS.filter((i) => i.startsWith('builtin:')).map((i) => themeInputOf({ id: i as 'builtin:slate' }).key))
    expect(keys.size).toBe(4)
  })
  it('a custom theme with the default colours is the default theme', () => {
    expect(themeInputOf({ id: 'custom', custom: customFromDefault('light') }).colours).toEqual(defaultTheme('light').colours)
  })
  it('a custom colour and board come through', () => {
    const custom = customFromDefault('dark')
    custom.colours.accent = '#ff0000'
    custom.boards.blackboard = '#112233'
    const t = themeInputOf({ id: 'custom', custom })
    expect(t.mode).toBe('dark')
    expect(t.colours.accent).toBe('#ff0000')
    expect(t.boards.blackboard).toBe('#112233')
  })
})
