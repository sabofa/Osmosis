import { describe, expect, it, vi } from 'vitest'
import { resolveSettings, toStyle, TYPE_DEFAULTS } from './layers'
import { PRESETS } from './presets'
import { resolveStyle } from './resolve'

// The graph types' built-in defaults (style/typeDefaults.ts) are the second layer of the stack, and resolveStyle,
// which resolves the figure styles for the graph type figure2d, reads them too. They are empty today, so this
// file stands in a table of its own and shows what the stack does with one.
vi.mock('./typeDefaults', () => ({
  TYPE_DEFAULTS: Object.freeze({
    figure2d: { set: { 'style.line.looseness': 0.2, 'style.line.wobble': 0.1 } },
    space: { set: { 'paint.value.terminatorSoftness': 0.4 } },
  }),
}))

const LOOSE = 'style.line.looseness'
const WOBBLE = 'style.line.wobble'
const SOFT = 'paint.value.terminatorSoftness'

describe('the graph types’ built-in defaults', () => {
  it('are the table the stack reads (this file’s stand-in)', () => {
    expect(Object.keys(TYPE_DEFAULTS)).toEqual(['figure2d', 'space'])
  })

  it('apply to their own graph type, and to no other', () => {
    expect(resolveSettings({}, 'figure2d').get(LOOSE)).toBe(0.2)
    expect(resolveSettings({}, 'space').get(SOFT)).toBe(0.4)
    expect(resolveSettings({}, 'space').get(LOOSE)).toBe(0)
    expect(resolveSettings({}, 'figure2d').get(SOFT)).toBe(0.1)
    expect(resolveSettings({}, 'graph2d').get(LOOSE)).toBe(0)
  })

  it('reach resolveStyle, with one layer, two, or none', () => {
    expect(resolveStyle([]).line.looseness).toBe(0.2)
    expect(resolveStyle([{}, {}]).line.looseness).toBe(0.2)
    expect(resolveStyle([undefined, {}]).line.wobble).toBe(0.1)
    expect(resolveStyle([{ line: { passes: 2 } }]).line).toMatchObject({ looseness: 0.2, wobble: 0.1, passes: 2 })
  })

  it('lose to the document and to the figure, as to every layer above them', () => {
    expect(resolveStyle([{ line: { looseness: 0.5 } }, {}]).line.looseness).toBe(0.5)
    expect(resolveStyle([{}, { line: { looseness: 0.7 } }]).line.looseness).toBe(0.7)
    expect(resolveStyle([{ line: { looseness: 0.5 } }, { line: { looseness: 0.7 } }]).line.looseness).toBe(0.7)
    // and the layer that does not say keeps the default of the type
    expect(resolveStyle([{ line: { looseness: 0.5 } }, {}]).line.wobble).toBe(0.1)
  })

  it('lose to a theme’s setting, Ben’s ruling, and a layer’s preset resets them like any style setting', () => {
    expect(resolveSettings({ theme: { all: { set: { [LOOSE]: 0.3 } } } }, 'figure2d').get(LOOSE)).toBe(0.3)
    expect(resolveSettings({ theme: { byType: { figure2d: { set: { [LOOSE]: 0.35 } } } } }, 'figure2d').get(LOOSE)).toBe(0.35)
    expect(resolveStyle([{ preset: 'ink' }]).line).toEqual(PRESETS.ink.line)
    expect(resolveStyle([{ preset: 'clean' }]).line).toEqual(PRESETS.clean.line)
    // a preset leaves paint.* alone, so the space default stays
    expect(resolveSettings({ document: { preset: 'ink' } }, 'space').get(SOFT)).toBe(0.4)
  })

  it('are stood in for by a stack that gives its own, and `{}` is none', () => {
    expect(resolveSettings({ typeDefaults: {} }, 'figure2d').get(LOOSE)).toBe(0)
    expect(resolveSettings({ typeDefaults: { figure2d: { set: { [LOOSE]: 0.9 } } } }, 'figure2d').get(LOOSE)).toBe(0.9)
    expect(resolveSettings({ typeDefaults: { figure2d: { set: { [LOOSE]: 0.9 } } } }, 'figure2d').get(WOBBLE)).toBe(0)
    expect(toStyle(resolveSettings({ typeDefaults: {} }, 'figure2d'))).toEqual({ ...PRESETS.clean, seed: 0 })
  })
});
