import { describe, it, expect } from 'vitest'
import { webFileType, registerWebFileType, listWebFileTypes } from './fileTypes'

describe('web file types', () => {
  it('has markdown, graph and asset built in, and no fallback entry', () => {
    expect(['markdown', 'graph', 'asset'].every((t) => webFileType(t))).toBe(true)
    expect(webFileType('item-set')).toBeNull()
  })
  it('refuses a duplicate registration', () => {
    expect(() => registerWebFileType({ type: 'markdown', label: 'x', View: () => null })).toThrow()
    expect(listWebFileTypes().length).toBeGreaterThanOrEqual(3)
  })
})
