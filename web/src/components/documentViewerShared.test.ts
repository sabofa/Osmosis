import { describe, expect, it } from 'vitest'
import { textAsset } from './documentViewerShared'

describe('textAsset', () => {
  it('passes the text through untouched as markdown', () => {
    const a = textAsset('# Hi\r\ncafé')
    expect(a).toMatchObject({ type: 'text', mime: 'text/markdown', content: '# Hi\r\ncafé', extractedText: '# Hi\r\ncafé' })
  })
})
