import { describe, expect, it } from 'vitest'
import { renderTokensDoc } from './docs.js'
import { TOKENS } from './registry/index.js'

const GROUPS = ['colour', 'type', 'shape', 'space', 'elevation', 'motion', 'surface', 'graph', 'document', 'component']

describe('renderTokensDoc', () => {
  const doc = renderTokensDoc()
  it('has a row for every token', () => {
    for (const t of TOKENS) expect(doc, t.name).toContain(`| \`${t.name}\` |`)
  })
  it('has the group headings', () => {
    for (const g of GROUPS) expect(doc).toContain(`\n## ${g}\n`)
  })
  it('lists old names', () => {
    expect(doc).toContain('--bg')
    expect(doc).toContain('## Old names (aliases)')
  })
  it('shows osmosis defaults', () => {
    const row = doc.split('\n').find((l) => l.startsWith('| `color-canvas` |'))!
    expect(row).toContain('`#eef1e5`')
    expect(row).toContain('`#17160f`')
  })
  it('is deterministic and ends with a newline', () => {
    expect(renderTokensDoc()).toBe(doc)
    expect(doc.endsWith('\n')).toBe(true)
  })
})
