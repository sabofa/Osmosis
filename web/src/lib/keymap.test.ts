import { describe, it, expect } from 'vitest'
import { resolveKey, type KeyContext } from './keymap'

const mc: KeyContext = { inTextField: false, kind: 'mc', choiceCount: 4, recorded: false }
const written: KeyContext = { inTextField: false, kind: 'written', choiceCount: 0, recorded: false }

describe('resolveKey — choices', () => {
  it('maps 1–5 to a choice ordinal on a multiple-choice item', () => {
    expect(resolveKey({ key: '1' }, mc)).toEqual({ type: 'choice', ordinal: 1 })
    expect(resolveKey({ key: '4' }, mc)).toEqual({ type: 'choice', ordinal: 4 })
  })

  it('ignores an ordinal the item does not have', () => {
    expect(resolveKey({ key: '5' }, mc)).toBeNull()
  })

  it('ignores digits on a written item', () => {
    expect(resolveKey({ key: '1' }, written)).toBeNull()
  })

  it('never maps 6 and up — the map stops at five', () => {
    expect(resolveKey({ key: '6' }, { ...mc, choiceCount: 6 })).toBeNull()
    expect(resolveKey({ key: '0' }, mc)).toBeNull()
  })
})

describe('resolveKey — the rest of the map', () => {
  it('submits on Enter', () => {
    expect(resolveKey({ key: 'Enter' }, mc)).toEqual({ type: 'submit' })
    expect(resolveKey({ key: 'Enter' }, written)).toEqual({ type: 'submit' })
  })

  it('blanks on b, toggles idk on ?, sets confidence on u/s/c', () => {
    expect(resolveKey({ key: 'b' }, mc)).toEqual({ type: 'blank' })
    expect(resolveKey({ key: '?', shiftKey: true }, mc)).toEqual({ type: 'toggle-idk' })
    expect(resolveKey({ key: 'u' }, mc)).toEqual({ type: 'confidence', level: 'unsure' })
    expect(resolveKey({ key: 's' }, mc)).toEqual({ type: 'confidence', level: 'somewhat' })
    expect(resolveKey({ key: 'c' }, mc)).toEqual({ type: 'confidence', level: 'confident' })
  })

  it('is case-insensitive', () => {
    expect(resolveKey({ key: 'B', shiftKey: true }, mc)).toEqual({ type: 'blank' })
    expect(resolveKey({ key: 'U', shiftKey: true }, mc)).toEqual({ type: 'confidence', level: 'unsure' })
  })

  // §2.2, §2.4, §7.1: confidence, idk and blank are properties of *an answer*,
  // not of a multiple-choice answer. Only the ordinals are choice-shaped, and
  // only they stay behind on a written item.
  it('offers confidence, idk and blank on a written item too', () => {
    expect(resolveKey({ key: 'u' }, written)).toEqual({ type: 'confidence', level: 'unsure' })
    expect(resolveKey({ key: 's' }, written)).toEqual({ type: 'confidence', level: 'somewhat' })
    expect(resolveKey({ key: 'c' }, written)).toEqual({ type: 'confidence', level: 'confident' })
    expect(resolveKey({ key: '?', shiftKey: true }, written)).toEqual({ type: 'toggle-idk' })
    expect(resolveKey({ key: 'b' }, written)).toEqual({ type: 'blank' })
    expect(resolveKey({ key: 'B', shiftKey: true }, written)).toEqual({ type: 'blank' })
  })

  it('still refuses the choice ordinals on a written item — there is nothing to pick', () => {
    for (const key of ['1', '2', '3', '4', '5']) expect(resolveKey({ key }, written)).toBeNull()
  })

  it('takes no key from a written item while the caret is in its textarea', () => {
    const typing = { ...written, inTextField: true }
    expect(resolveKey({ key: 'b' }, typing)).toBeNull()
    expect(resolveKey({ key: 'u' }, typing)).toBeNull()
    expect(resolveKey({ key: '?', shiftKey: true }, typing)).toBeNull()
  })

  it('advances on Space only while a recorded card is showing', () => {
    expect(resolveKey({ key: ' ' }, mc)).toBeNull()
    expect(resolveKey({ key: ' ' }, { ...mc, recorded: true })).toEqual({ type: 'advance' })
  })

  it('answers nothing on a recorded card but the advance', () => {
    const rec = { ...mc, recorded: true }
    expect(resolveKey({ key: '1' }, rec)).toBeNull()
    expect(resolveKey({ key: 'u' }, rec)).toBeNull()
    expect(resolveKey({ key: 'b' }, rec)).toBeNull()
  })

  it('makes every way off a recorded card the same way', () => {
    const rec = { ...mc, recorded: true }
    expect(resolveKey({ key: 'Enter' }, rec)).toEqual({ type: 'advance' })
    expect(resolveKey({ key: ' ' }, rec)).toEqual({ type: 'advance' })
    expect(resolveKey({ key: 'Enter', ctrlKey: true }, rec)).toEqual({ type: 'advance' })
    expect(resolveKey({ key: 'Enter', ctrlKey: true }, { ...rec, inTextField: true })).toEqual({ type: 'advance' })
  })
})

describe('resolveKey — typing and browser shortcuts', () => {
  it('stays out of the way while the caret is in a text field', () => {
    const typing = { ...written, inTextField: true }
    expect(resolveKey({ key: 'b' }, typing)).toBeNull()
    expect(resolveKey({ key: 'Enter' }, typing)).toBeNull()
    expect(resolveKey({ key: ' ' }, { ...typing, recorded: true })).toBeNull()
  })

  it('submits on Ctrl+Enter even from a text field', () => {
    expect(resolveKey({ key: 'Enter', ctrlKey: true }, { ...written, inTextField: true })).toEqual({ type: 'submit' })
    expect(resolveKey({ key: 'Enter', ctrlKey: true }, mc)).toEqual({ type: 'submit' })
  })

  it('never claims a modifier combination the browser owns', () => {
    expect(resolveKey({ key: 'b', ctrlKey: true }, mc)).toBeNull()
    expect(resolveKey({ key: '1', metaKey: true }, mc)).toBeNull()
    expect(resolveKey({ key: 'c', ctrlKey: true }, mc)).toBeNull()
    expect(resolveKey({ key: 'u', altKey: true }, mc)).toBeNull()
    expect(resolveKey({ key: 'Enter', metaKey: true }, mc)).toBeNull()
    expect(resolveKey({ key: 'Enter', ctrlKey: true, shiftKey: true }, mc)).toBeNull()
  })

  it('ignores keys with no meaning here', () => {
    expect(resolveKey({ key: 'z' }, mc)).toBeNull()
    expect(resolveKey({ key: 'Tab' }, mc)).toBeNull()
    expect(resolveKey({ key: 'Escape' }, mc)).toBeNull()
  })
})

describe('resolveKey — a show waiting to be acknowledged (§5.1)', () => {
  const showing: KeyContext = {
    inTextField: false,
    kind: 'written',
    choiceCount: 0,
    recorded: false,
    showPending: true,
  }

  it('maps Space to acknowledge', () => {
    expect(resolveKey({ key: ' ' }, showing)).toEqual({ type: 'acknowledge' })
  })

  it('does not claim Space when no show is waiting', () => {
    expect(resolveKey({ key: ' ' }, written)).toBeNull()
  })

  it('still refuses a modifier and a caret in a text field', () => {
    expect(resolveKey({ key: ' ', ctrlKey: true }, showing)).toBeNull()
    expect(resolveKey({ key: ' ' }, { ...showing, inTextField: true })).toBeNull()
  })

  it('leaves the rest of the map alone — Enter still submits', () => {
    expect(resolveKey({ key: 'Enter' }, showing)).toEqual({ type: 'submit' })
  })
})

describe('isTextEntry', () => {
  it('recognises the elements a keystroke belongs to', async () => {
    const { isTextEntry } = await import('./keymap')
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})
