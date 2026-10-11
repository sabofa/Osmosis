import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { smoothCaret, isLongJump, caretMotion, transitionOnlyChange, DEFAULT_GLIDE_MS, DEFAULT_BLINK_MS } from './smoothCaret'
import { editorExtensions } from './extensions'

describe('smoothCaret', () => {
  it('snaps only past the distance cap', () => {
    expect(isLongJump(0, 0, 10, 20, 400)).toBe(false)
    expect(isLongJump(0, 0, 0, 630, 400)).toBe(true)
    expect(isLongJump(0, 0, 300, 300, 400)).toBe(true)
  })
  it('is empty when disabled', () => {
    expect(smoothCaret({ enabled: false })).toEqual([])
    expect((smoothCaret() as unknown[]).length).toBeGreaterThan(0)
  })
  it('has Word-like defaults', () => {
    expect(DEFAULT_GLIDE_MS).toBeGreaterThanOrEqual(80)
    expect(DEFAULT_GLIDE_MS).toBeLessThanOrEqual(110)
    expect(DEFAULT_BLINK_MS).toBe(1060)
  })
  it('is on by default in the editor set and can be turned off', () => {
    const on = EditorState.create({ doc: 'x', extensions: editorExtensions() })
    const off = EditorState.create({ doc: 'x', extensions: editorExtensions({ smoothCaret: false }) })
    expect(on.facet(EditorView.styleModule).length).toBeGreaterThan(off.facet(EditorView.styleModule).length)
  })
})

describe('caretMotion (the glide / snap decision)', () => {
  const o = { snapPx: 400, lineHeight: 20, verticalArrow: false }
  it('glides along a line: typing, End / Home, left / right', () => {
    expect(caretMotion({ x: 10, y: 100 }, { x: 18, y: 100 }, o)).toBe('glide')
    expect(caretMotion({ x: 10, y: 100 }, { x: 300, y: 100 }, o)).toBe('glide')
    expect(caretMotion({ x: 300, y: 100 }, { x: 10, y: 101 }, o)).toBe('glide')
  })
  it('snaps when typing wraps to the next line (no arrow key)', () => {
    expect(caretMotion({ x: 600, y: 100 }, { x: 8, y: 120 }, o)).toBe('snap')
  })
  it('glides for a one-line ArrowUp / ArrowDown, snaps for a bigger vertical move', () => {
    const v = { ...o, verticalArrow: true }
    expect(caretMotion({ x: 50, y: 100 }, { x: 50, y: 120 }, v)).toBe('glide')
    expect(caretMotion({ x: 50, y: 100 }, { x: 50, y: 70 }, v)).toBe('glide')
    expect(caretMotion({ x: 50, y: 100 }, { x: 50, y: 400 }, v)).toBe('snap')
    expect(caretMotion({ x: 50, y: 100 }, { x: 50, y: 160 }, v)).toBe('snap')
  })
  it('a click or PageDown to another line snaps; a long jump always snaps', () => {
    expect(caretMotion({ x: 50, y: 100 }, { x: 50, y: 180 }, o)).toBe('snap')
    expect(caretMotion({ x: 0, y: 100 }, { x: 500, y: 100 }, { ...o, verticalArrow: true })).toBe('snap')
  })
})

describe('transitionOnlyChange', () => {
  it('ignores transition toggles, not position changes', () => {
    expect(transitionOnlyChange('left: 1px; top: 2px;', 'left: 1px; top: 2px; transition: none;')).toBe(true)
    expect(transitionOnlyChange('left: 1px; top: 2px; transition: none;', 'left: 1px; top: 2px;')).toBe(true)
    expect(transitionOnlyChange('left: 1px; top: 2px;', 'left: 5px; top: 2px; transition: none;')).toBe(false)
    expect(transitionOnlyChange(null, 'left: 1px;')).toBe(false)
  })
})

describe('steady caret (blinkMs 0)', () => {
  const css = (o: Parameters<typeof smoothCaret>[0]) =>
    EditorState.create({ doc: 'x', extensions: [smoothCaret(o)] }).facet(EditorView.styleModule).map((m) => String((m as unknown as { getRules(): string }).getRules())).join(' ')
  it('has no animation rules or !important overrides', () => {
    const steady = css({ blinkMs: 0 })
    expect(steady).not.toMatch(/@keyframes|animation-name|cm-cursorLayer/)
    expect(css({})).toMatch(/@keyframes de-caret-a|animation-name/)
  })
})
