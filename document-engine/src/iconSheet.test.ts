import { describe, it, expect } from 'vitest'
import type { IconSheetRef } from 'theme-core'
import { ICON_NAMES, resolveIcon } from './iconSheet'
import { editorCommandSpecs } from './editor/editorCommands'

const refs: IconSheetRef[] = [{ kind: 'default' }, { kind: 'builtin', slug: 'x' }, { kind: 'asset', hash: 'abc' }]

describe('resolveIcon', () => {
  it('resolves every icon name for every sheet kind', () => {
    for (const ref of refs) for (const name of ICON_NAMES) expect(typeof resolveIcon(name, ref)).toBe('function')
  })
  it('non-default sheets fall back to the default glyphs', () => {
    for (const name of ICON_NAMES) expect(resolveIcon(name, refs[1])).toBe(resolveIcon(name, refs[0]))
  })
  it('includes the editor command icons', () => {
    for (const n of ['bold', 'italic', 'strike', 'code', 'link', 'heading', 'list-bullet', 'list-number', 'list-task', 'quote', 'undo', 'redo', 'search']) {
      expect(ICON_NAMES as readonly string[]).toContain(`doc-${n}`)
    }
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
  })
  it('includes the ribbon icons', () => {
    for (const n of ['paste', 'cut', 'copy', 'select-all', 'replace', 'indent', 'outdent', 'clear-format', 'hr', 'code-block', 'math', 'graph', 'image', 'table']) {
      expect(ICON_NAMES as readonly string[]).toContain(`doc-${n}`)
    }
  })
  it('every editor spec icon is a known icon name', () => {
    for (const s of editorCommandSpecs()) expect(ICON_NAMES as readonly string[]).toContain(s.icon)
  })
  it('unknown names give a fallback, never throw', () => {
    expect(() => resolveIcon('nope', refs[0])).not.toThrow()
    expect(typeof resolveIcon('nope', refs[0])).toBe('function')
    expect(typeof resolveIcon('toString', refs[0])).toBe('function')
    expect(resolveIcon('toString', refs[0])).toBe(resolveIcon('nope', refs[0]))
  })
})
