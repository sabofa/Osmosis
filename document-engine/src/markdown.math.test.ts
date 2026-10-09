import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInline } from './markdown'

describe('math and fence blocks', () => {
  it('parses a multi-line $$ block with a blank line inside', () => {
    const text = 'before\n\n$$\na = b\n\nc = d\n$$\n\nafter'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['p', 'math', 'p'])
    expect(text.slice(blocks[1].start, blocks[1].end)).toBe('a = b\n\nc = d')
    expect(text.slice(blocks[2].start, blocks[2].end)).toBe('after')
  })

  it('parses a single-line $$x$$ block', () => {
    const text = '$$x^2$$\nnext'
    const blocks = parseBlocks(text)
    expect(blocks[0].type).toBe('math')
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('x^2')
    expect(blocks[1].type).toBe('p')
  })

  it('treats an unclosed $$ as ordinary text', () => {
    expect(parseBlocks('$$ oops\nmore').map((b) => b.type)).toEqual(['p'])
  })

  it('parses a fence with an info string and a blank line inside', () => {
    const text = '```graph\nline1\n\nline3\n```\ntail'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['fence', 'p'])
    expect(blocks[0].info).toBe('graph')
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('line1\n\nline3')
    expect(text.slice(blocks[1].start, blocks[1].end)).toBe('tail')
  })

  it('runs an unterminated fence to the end of the text', () => {
    const text = '```python\nprint(1)\nprint(2)'
    const blocks = parseBlocks(text)
    expect(blocks).toEqual([{ type: 'fence', start: 10, end: text.length, info: 'python' }])
  })

  it('keeps fence content raw: no headings, no math', () => {
    const text = '```\n# not a heading\n$x$ and $$\n```'
    const blocks = parseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].info).toBe('')
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('# not a heading\n$x$ and $$')
  })

  it('a fence line interrupts a paragraph', () => {
    expect(parseBlocks('para\n```\ncode\n```').map((b) => b.type)).toEqual(['p', 'fence'])
  })
})

describe('inline math', () => {
  it('emits a math run covering the TeX between dollars, leaving later offsets unchanged', () => {
    const text = 'a $x+1$ b'
    const runs = parseInline(text, 100)
    expect(runs).toEqual([
      { start: 100, end: 102 },
      { start: 103, end: 106, math: true },
      { start: 107, end: 109 },
    ])
    expect(text.slice(3, 6)).toBe('x+1')
    expect(text.slice(7 - 0, 9)).toBe(' b')
  })

  it('does not treat prices as math', () => {
    expect(parseInline('$5 and $6', 0)).toEqual([{ start: 0, end: 9 }])
    expect(parseInline('costs $5 to $6.', 0).some((r) => r.math)).toBe(false)
  })

  it('reads math after a price', () => {
    const runs = parseInline('$5 and $x$', 0)
    expect(runs.filter((r) => r.math)).toEqual([{ start: 8, end: 9, math: true }])
  })

  it('does not italicise underscores inside math', () => {
    const runs = parseInline('$a_b + c_d$', 0)
    expect(runs).toEqual([{ start: 1, end: 10, math: true }])
  })

  it('keeps $ inside a code span as code', () => {
    expect(parseInline('`$x$`', 0)).toEqual([{ start: 1, end: 4, code: true }])
  })

  it('does not close on a dollar preceded by space or followed by a digit', () => {
    expect(parseInline('$a $', 0).some((r) => r.math)).toBe(false)
    expect(parseInline('$a$5', 0).some((r) => r.math)).toBe(false)
  })

  it('a highlight spanning text before and after math keeps raw offsets', () => {
    const text = 'see $x_1$ now'
    const runs = parseInline(text, 0)
    const spans = runs.map((r) => text.slice(r.start, r.end))
    expect(spans).toEqual(['see ', 'x_1', ' now'])
    expect(runs[2].start).toBe(9)
  })
})

describe('inline math inside emphasis and edge cases', () => {
  const texts = (src: string, kind: 'math' | 'bold' | 'italic' | 'code') =>
    parseInline(src, 0).filter((r) => r[kind]).map((r) => src.slice(r.start, r.end))

  it('renders math inside bold and italic bodies', () => {
    const b = '**the $x^2$ term**'
    expect(texts(b, 'math')).toEqual(['x^2'])
    expect(parseInline(b, 0).every((r) => r.bold || r.math)).toBe(true)
    const i = '_see $y$ here_'
    expect(texts(i, 'math')).toEqual(['y'])
    expect(parseInline(i, 0).every((r) => r.italic || r.math)).toBe(true)
  })

  it('does not let an underscore pair with one inside math', () => {
    const s = 'f_1 is $f_1$'
    expect(texts(s, 'math')).toEqual(['f_1'])
    expect(parseInline(s, 0).some((r) => r.italic)).toBe(false)
  })

  it('does not close math on a $ inside a code span', () => {
    const s = '$a `x$` b'
    expect(texts(s, 'math')).toEqual([])
    expect(texts(s, 'code')).toEqual(['x$'])
  })

  it('respects an escaped dollar opener', () => {
    expect(texts('cost \\$5 and \\$x$', 'math')).toEqual([])
  })

  it('reads a mid-line $$x$$ as one math run, not stray dollars', () => {
    const s = 'so $$x$$ holds'
    expect(texts(s, 'math')).toEqual(['x'])
    expect(parseInline(s, 0).filter((r) => !r.math).map((r) => s.slice(r.start, r.end)).join('|')).toBe('so | holds')
  })

  it('math never spans a newline', () => {
    expect(texts('a $x\ny$ b', 'math')).toEqual([])
  })
})
