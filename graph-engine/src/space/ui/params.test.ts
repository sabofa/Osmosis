import { describe, expect, it } from 'vitest'
import type { Binding } from '../config'
import { FakeDocument, type FakeElement } from '../testing/fakeDom'
import { displayValue, ParamsPanel, stepDecimals, type ParamRowState } from './params'

const binding = (patch: Partial<Binding>): Binding => ({ name: 'a', value: 0, min: -5, max: 5, step: null, integer: false, line: 1, ...patch })

function newPanel() {
  const doc = new FakeDocument()
  const overlay = doc.createElement('div')
  const panel = new ParamsPanel(overlay as unknown as HTMLElement, { change: () => {}, togglePlay: () => {}, toggleLoop: () => {} })
  return { panel, element: panel.element as unknown as FakeElement }
}

const idle = (names: readonly string[]): ReadonlyMap<string, ParamRowState> =>
  new Map(names.map((n) => [n, { value: 0, playing: false, loop: false }]))

describe('the number box', () => {
  it('shows a stepped binding to its step\'s decimals', () => {
    expect(stepDecimals(0.1)).toBe(1)
    expect(stepDecimals(0.25)).toBe(2)
    expect(stepDecimals(5)).toBe(0)
    expect(displayValue(binding({ step: 0.1 }), 0.1 + 0.2)).toBe('0.3')
    expect(displayValue(binding({ step: 0.25 }), -1.25)).toBe('-1.25')
    expect(displayValue(binding({ step: 0.1 }), 1)).toBe('1.0')
  })

  it('shows a continuous binding to 4 significant digits, and an integer as one', () => {
    expect(displayValue(binding({}), 0.123456789)).toBe('0.1235')
    expect(displayValue(binding({}), -2.00004)).toBe('-2')
    expect(displayValue(binding({ integer: true, step: null }), 16)).toBe('16')
  })
})

describe('the panel collapses to a chip (S6 plan V10)', () => {
  it('a single binding never collapses: there is nothing a chip would hide', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' })])
    expect(element.dataset.collapsed).toBeUndefined()
    panel.sync(idle(['a']))
    expect(element.dataset.collapsed).toBeUndefined()
  })

  it('two or more bindings collapse once set, unless hovered, focused, or playing', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' })])
    expect(element.dataset.collapsed).toBe('true')
  })

  it('hovering expands it; leaving collapses it again', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' })])
    element.dispatch('mouseenter')
    expect(element.dataset.collapsed).toBeUndefined()
    element.dispatch('mouseleave')
    expect(element.dataset.collapsed).toBe('true')
  })

  it('focusing a control inside it expands it; focus leaving collapses it again', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' })])
    element.dispatch('focusin')
    expect(element.dataset.collapsed).toBeUndefined()
    element.dispatch('focusout')
    expect(element.dataset.collapsed).toBe('true')
  })

  it('a playing parameter keeps it expanded with no hover or focus, and it re-collapses once nothing plays', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' })])
    expect(element.dataset.collapsed).toBe('true')
    panel.sync(new Map([['a', { value: 0, playing: true, loop: false }], ['b', { value: 0, playing: false, loop: false }]]))
    expect(element.dataset.collapsed).toBeUndefined()
    panel.sync(idle(['a', 'b']))
    expect(element.dataset.collapsed).toBe('true')
  })

  it('setting fresh bindings resets hover, focus and playing back to collapsed', () => {
    const { panel, element } = newPanel()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' })])
    element.dispatch('mouseenter')
    expect(element.dataset.collapsed).toBeUndefined()
    panel.setBindings([binding({ name: 'a' }), binding({ name: 'b' }), binding({ name: 'c' })])
    expect(element.dataset.collapsed).toBe('true')
  })
})
