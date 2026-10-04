import { describe, it, expect } from 'vitest'
import { webFileType, registerWebFileType, listWebFileTypes } from './fileTypes'

describe('web file formats', () => {
  it('has markdown, graph and upload built in, and no fallback entry', () => {
    expect(['markdown', 'graph', 'upload'].every((f) => webFileType(f))).toBe(true)
    expect(webFileType('item-set')).toBeNull()
  })
  it('knows no "asset" format any more: the server calls it upload', () => {
    expect(webFileType('asset')).toBeNull()
  })
  it('refuses a duplicate registration', () => {
    expect(() => registerWebFileType({ format: 'markdown', label: 'x', View: () => null })).toThrow()
    expect(listWebFileTypes().length).toBeGreaterThanOrEqual(3)
  })
})
