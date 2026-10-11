import { describe, it, expect } from 'vitest'
import { isSaveKey, canSave } from './saveKey'

describe('isSaveKey', () => {
  it('accepts Ctrl-S and Cmd-S in either case', () => {
    expect(isSaveKey({ key: 's', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isSaveKey({ key: 'S', ctrlKey: false, metaKey: true })).toBe(true)
  })
  it('rejects a bare s, other keys and Alt chords', () => {
    expect(isSaveKey({ key: 's', ctrlKey: false, metaKey: false })).toBe(false)
    expect(isSaveKey({ key: 'b', ctrlKey: true, metaKey: false })).toBe(false)
    expect(isSaveKey({ key: 's', ctrlKey: true, metaKey: false, altKey: true })).toBe(false)
  })
})

describe('canSave', () => {
  it('needs changes, no save in flight and no conflict', () => {
    expect(canSave({ dirty: true, busy: false, conflict: false })).toBe(true)
    expect(canSave({ dirty: false, busy: false, conflict: false })).toBe(false)
    expect(canSave({ dirty: true, busy: true, conflict: false })).toBe(false)
    expect(canSave({ dirty: true, busy: false, conflict: true })).toBe(false)
  })
})
