import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { smoothCaret, isLongJump, DEFAULT_GLIDE_MS, DEFAULT_BLINK_MS } from './smoothCaret'
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
