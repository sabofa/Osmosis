import { describe, it, expect } from 'vitest'
import { rovingIndex, prettyShortcut, controlTitle, galleryWindow, galleryTileCount, overflowSplit, controlSlots, isNarrow, previewLook } from './ribbonNav'
import { STYLE_OPTIONS } from './ribbonModel'

describe('rovingIndex', () => {
  it('moves one step and stops at the ends', () => {
    expect(rovingIndex('ArrowRight', 0, 3)).toBe(1)
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(2)
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(0)
    expect(rovingIndex('ArrowLeft', 2, 3)).toBe(1)
    expect(rovingIndex('ArrowDown', 0, 3)).toBe(1)
    expect(rovingIndex('ArrowUp', 1, 3)).toBe(0)
  })
  it('Home and End jump; other keys and empty groups are ignored', () => {
    expect(rovingIndex('Home', 2, 4)).toBe(0)
    expect(rovingIndex('End', 0, 4)).toBe(3)
    expect(rovingIndex('a', 0, 4)).toBeNull()
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull()
  })
  it('treats an unknown current index (-1) as the first control', () => {
    expect(rovingIndex('ArrowRight', -1, 3)).toBe(1)
  })
})

describe('shortcut text', () => {
  it('spells Mod as Ctrl (or Cmd) and capitalises the key', () => {
    expect(prettyShortcut('Mod-b')).toBe('Ctrl+B')
    expect(prettyShortcut('Mod-Shift-z')).toBe('Ctrl+Shift+Z')
    expect(prettyShortcut('Mod-Shift-.')).toBe('Ctrl+Shift+.')
    expect(prettyShortcut('Mod-b', true)).toBe('Cmd+B')
  })
  it('controlTitle: tooltip wins, else label with shortcut, else label', () => {
    expect(controlTitle({ label: 'Bold', shortcut: 'Mod-b' })).toBe('Bold (Ctrl+B)')
    expect(controlTitle({ label: 'Strikethrough' })).toBe('Strikethrough')
    expect(controlTitle({ label: 'Table', tooltip: 'Soon' })).toBe('Soon')
  })
})

describe('galleryWindow', () => {
  it('shows the first n when the selection is among them', () => {
    expect(galleryWindow(STYLE_OPTIONS, 'h2', 4).map((o) => o.value)).toEqual(['normal', 'h1', 'h2', 'h3'])
  })
  it('slides so the selection is the last visible tile', () => {
    expect(galleryWindow(STYLE_OPTIONS, 'code', 4).map((o) => o.value)).toEqual(['h3', 'h4', 'quote', 'code'])
  })
  it('never asks for more than exist, an unknown value shows the start', () => {
    expect(galleryWindow(STYLE_OPTIONS.slice(0, 2), 'x', 4)).toHaveLength(2)
    expect(galleryWindow(STYLE_OPTIONS, 'zzz', 3).map((o) => o.value)).toEqual(['normal', 'h1', 'h2'])
  })
  it('tile count follows the ribbon width', () => {
    expect(galleryTileCount(1400)).toBe(4)
    expect(galleryTileCount(1000)).toBe(3)
    expect(galleryTileCount(700)).toBe(2)
  })
})

describe('narrow row', () => {
  it('breakpoint is 640 and ignores an unmeasured width', () => {
    expect(isNarrow(639)).toBe(true)
    expect(isNarrow(640)).toBe(false)
    expect(isNarrow(0)).toBe(false)
  })
  it('keeps everything when it fits, else reserves a slot for the overflow button', () => {
    expect(overflowSplit([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], overflow: [] })
    expect(overflowSplit([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], overflow: [3, 4, 5] })
    expect(overflowSplit([1, 2], 0)).toEqual({ shown: [], overflow: [1, 2] })
  })
  it('wide controls count as two slots', () => {
    const items = [{ k: 'button' }, { k: 'select' }, { k: 'button' }, { k: 'color' }]
    const w = (i: { k: string }) => controlSlots(i.k)
    expect(overflowSplit(items, 6, w).overflow).toEqual([])
    // room = 4 slots: button(1) + select(2) fit, the next button would make 4 -> fits, color does not
    expect(overflowSplit(items, 5, w)).toEqual({ shown: items.slice(0, 3), overflow: items.slice(3) })
    expect(overflowSplit(items, 3, w)).toEqual({ shown: items.slice(0, 1), overflow: items.slice(1) })
  })
  it('narrow has hysteresis: enter below 640, leave at 664', () => {
    expect(isNarrow(650, false)).toBe(false)
    expect(isNarrow(650, true)).toBe(true)
    expect(isNarrow(663, true)).toBe(true)
    expect(isNarrow(664, true)).toBe(false)
    expect(isNarrow(639, false)).toBe(true)
  })
})

describe('previewLook', () => {
  it('compresses the scale toward 1 by the given strength', () => {
    expect(previewLook({ fontScale: 2, weight: 700 }, 0.4)).toEqual({ fontSizeEm: 1.4, fontWeight: 700, italic: false, mono: false })
    expect(previewLook({ fontScale: 1 }, 0.4).fontSizeEm).toBe(1)
    expect(previewLook({ italic: true }, 0.4)).toMatchObject({ italic: true, fontWeight: 400 })
    expect(previewLook(undefined, 1).fontSizeEm).toBe(1)
  })
})

import { clampNumber } from './ribbonNav'
describe('clampNumber', () => {
  it('clamps and rejects non-numbers', () => {
    expect(clampNumber(120, 8, 96)).toBe(96)
    expect(clampNumber(2, 8, 96)).toBe(8)
    expect(clampNumber(11, 8, 96)).toBe(11)
    expect(clampNumber(NaN, 8, 96)).toBeNull()
  })
})
