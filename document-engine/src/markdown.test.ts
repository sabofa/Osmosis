import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInline } from './markdown'

describe('parseBlocks', () => {
  it('strips heading markers but keeps offsets pointing at the raw source', () => {
    const text = '# Title\nBody text.'
    const blocks = parseBlocks(text)
    expect(blocks).toEqual([
      { type: 'h1', start: 2, end: 7 },
      { type: 'p', start: 8, end: 18 },
    ])
    expect(text.slice(2, 7)).toBe('Title')
    expect(text.slice(8, 18)).toBe('Body text.')
  })

  it('merges consecutive plain lines into one paragraph', () => {
    const text = 'line one\nline two\n\nline three'
    const blocks = parseBlocks(text)
    expect(blocks).toEqual([
      { type: 'p', start: 0, end: 17 },
      { type: 'p', start: 19, end: 29 },
    ])
    expect(text.slice(0, 17)).toBe('line one\nline two')
    expect(text.slice(19, 29)).toBe('line three')
  })

  it('keeps list markers visible as part of the block content', () => {
    const text = '- first\n- second\n1. numbered'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['li', 'li', 'oli'])
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('- first')
    expect(text.slice(blocks[2].start, blocks[2].end)).toBe('1. numbered')
  })

  it('does not treat a heading-like line inside a paragraph run as a break unless it starts a new line boundary', () => {
    const text = 'para\n# heading\nmore para'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['p', 'h1', 'p'])
  })
})

describe('parseInline', () => {
  it('extracts bold, italic, and code runs with offsets into the original block text', () => {
    const block = 'plain **bold** and *italic* and `code` end'
    const runs = parseInline(block, 100)
    const bold = runs.find((r) => r.bold)
    const italic = runs.find((r) => r.italic)
    const code = runs.find((r) => r.code)
    expect(block.slice(bold!.start - 100, bold!.end - 100)).toBe('bold')
    expect(block.slice(italic!.start - 100, italic!.end - 100)).toBe('italic')
    expect(block.slice(code!.start - 100, code!.end - 100)).toBe('code')
  })

  it('leaves plain text with no markdown syntax as a single run', () => {
    const block = 'nothing special here'
    const runs = parseInline(block, 0)
    expect(runs).toEqual([{ start: 0, end: block.length }])
  })

  it('ignores an unclosed marker and treats it as plain text', () => {
    const block = 'some **unclosed bold'
    const runs = parseInline(block, 0)
    expect(runs.every((r) => !r.bold)).toBe(true)
  })
})
