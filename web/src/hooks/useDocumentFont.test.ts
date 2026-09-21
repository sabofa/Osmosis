import { describe, expect, it } from 'vitest'
import { documentFontStyle, DOCUMENT_FONT_STACKS } from './useDocumentFont'

describe('documentFontStyle', () => {
  it('leaves the engine defaults alone for the system choice', () => {
    expect(documentFontStyle('system')).toBeUndefined()
  })

  // document-engine's .document-viewer hard-sets font-family from
  // --de-font-mono, so a plain fontFamily on our wrapper would be overridden —
  // the variable has to carry the choice too, or nothing changes on screen.
  it('overrides the variable document-engine reads, not just font-family', () => {
    const style = documentFontStyle('serif') as Record<string, string>
    expect(style.fontFamily).toBe(DOCUMENT_FONT_STACKS.serif)
    expect(style['--de-font-mono']).toBe(DOCUMENT_FONT_STACKS.serif)
  })

  it('carries the mono stack for the mono choice', () => {
    const style = documentFontStyle('mono') as Record<string, string>
    expect(style['--de-font-mono']).toBe(DOCUMENT_FONT_STACKS.mono)
  })
})
