import { describe, it, expect } from 'vitest'
import { confirmKeyAction, keyTargetOf } from './confirmKey'

const button = { tag: 'button' }
const checkbox = { tag: 'input', type: 'checkbox' }
const card = { tag: 'div' }

describe('confirmKeyAction: what a key does in a confirm dialog', () => {
  it('Escape always cancels, wherever focus is', () => {
    for (const target of [button, checkbox, card, null]) expect(confirmKeyAction('Escape', target, false)).toBe('cancel')
    expect(confirmKeyAction('Escape', null, true)).toBe('cancel')
  })

  it('Enter on a focused button is that button: never the confirm, so Cancel stays Cancel', () => {
    expect(confirmKeyAction('Enter', button, false)).toBe('native')
    expect(confirmKeyAction('Enter', button, true)).toBe('native')
  })

  it('Enter on a focused checkbox (or any other control) is not a confirm either', () => {
    expect(confirmKeyAction('Enter', checkbox, false)).toBe('native')
    for (const target of [{ tag: 'a' }, { tag: 'select' }, { tag: 'textarea' }, { tag: 'input', type: 'text' }, { tag: 'summary' }, { tag: 'div', editable: true }]) {
      expect(confirmKeyAction('Enter', target, false), JSON.stringify(target)).toBe('native')
    }
  })

  it('Enter with focus on nothing in particular (the page, the dialog body) confirms, as it always has', () => {
    expect(confirmKeyAction('Enter', card, false)).toBe('confirm')
    expect(confirmKeyAction('Enter', { tag: 'body' }, false)).toBe('confirm')
    expect(confirmKeyAction('Enter', null, false)).toBe('confirm')
  })

  it('a type-to-confirm dialog is never confirmed by Enter from nowhere', () => {
    expect(confirmKeyAction('Enter', card, true)).toBe('native')
    expect(confirmKeyAction('Enter', null, true)).toBe('native')
  })

  it('other keys are not the dialog\'s', () => {
    expect(confirmKeyAction('a', card, false)).toBe('native')
    expect(confirmKeyAction(' ', button, false)).toBe('native')
  })
})

describe('keyTargetOf: only what the decision needs from an event target', () => {
  it('is null for no target and for something that is not an element', () => {
    expect(keyTargetOf(null)).toBeNull()
    expect(keyTargetOf({} as EventTarget)).toBeNull()
  })
})
