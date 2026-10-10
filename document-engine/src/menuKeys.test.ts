import { describe, it, expect } from 'vitest'
import { initialMenuIndex, menuKeyAction } from './menuKeys'

describe('menuKeyAction', () => {
  it('Escape and Tab close and refocus the trigger', () => {
    expect(menuKeyAction('Escape', 1, 4)).toEqual({ kind: 'close', refocus: true })
    expect(menuKeyAction('Tab', 1, 4)).toEqual({ kind: 'close', refocus: true })
  })
  it('ArrowDown/ArrowUp move and wrap', () => {
    expect(menuKeyAction('ArrowDown', 0, 4)).toEqual({ kind: 'focus', index: 1 })
    expect(menuKeyAction('ArrowDown', 3, 4)).toEqual({ kind: 'focus', index: 0 })
    expect(menuKeyAction('ArrowUp', 2, 4)).toEqual({ kind: 'focus', index: 1 })
    expect(menuKeyAction('ArrowUp', 0, 4)).toEqual({ kind: 'focus', index: 3 })
  })
  it('with nothing focused, Down starts at the first and Up at the last', () => {
    expect(menuKeyAction('ArrowDown', -1, 4)).toEqual({ kind: 'focus', index: 0 })
    expect(menuKeyAction('ArrowUp', -1, 4)).toEqual({ kind: 'focus', index: 3 })
  })
  it('Home and End jump to the ends', () => {
    expect(menuKeyAction('Home', 2, 4)).toEqual({ kind: 'focus', index: 0 })
    expect(menuKeyAction('End', 1, 4)).toEqual({ kind: 'focus', index: 3 })
  })
  it('ignores other keys and empty menus', () => {
    expect(menuKeyAction('a', 0, 4)).toBeNull()
    expect(menuKeyAction('Enter', 0, 4)).toBeNull()
    expect(menuKeyAction('ArrowDown', -1, 0)).toBeNull()
  })
})

describe('initialMenuIndex', () => {
  it('focuses the checked item, else the first', () => {
    expect(initialMenuIndex([false, true, false])).toBe(1)
    expect(initialMenuIndex([false, false])).toBe(0)
    expect(initialMenuIndex([])).toBe(0)
  })
})
