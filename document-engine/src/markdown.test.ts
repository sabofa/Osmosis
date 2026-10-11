import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInline, parseInlineSegs, type MdBlock } from './markdown'

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

describe('BLOCK_CLASS escapes', () => {
  it('plain blocks have an empty class and none contain a backslash', async () => {
    const { BLOCK_CLASS } = await import('./markdown')
    for (const k of ['h1', 'h2', 'h3', 'p'] as const) expect(BLOCK_CLASS[k]).toBe('')
    for (const v of Object.values(BLOCK_CLASS)) expect(v).not.toContain('\\')
  })
})

describe('parseInline performance', () => {
  it('200k-char paragraph of many spans parses fast', async () => {
    const { parseInline } = await import('./markdown')
    const t = '`a` *b* $c$ _d_ '.repeat(12500)
    const s = performance.now()
    const runs = parseInline(t, 0)
    expect(performance.now() - s).toBeLessThan(500)
    expect(runs.length).toBeGreaterThan(40000)
  })
  it('5000 lone asterisks parse fast', async () => {
    const { parseInline } = await import('./markdown')
    const s = performance.now()
    parseInline('a '.repeat(10) + '* '.repeat(5000), 0)
    expect(performance.now() - s).toBeLessThan(500)
  })
})

// What the viewer paints for a block tree: leaf pieces (data-start = start,
// textContent = text.slice(start, end)) joined with a space at soft breaks.
function paint(blocks: MdBlock[], text: string): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (b.type === 'quote') {
      if (b.callout) out.push(`[${b.callout.kind}]` + text.slice(b.callout.titleStart, b.callout.titleEnd))
      out.push(...paint(b.children ?? [], text).map((l) => '> ' + l))
    } else if (b.type === 'fence') {
      out.push('fence:' + (b.segs ? b.segs.map((g) => text.slice(g.start, g.end)).join('|') : text.slice(b.start, b.end)))
    } else {
      const runs = b.segs ? parseInlineSegs(text, b.segs) : parseInline(text.slice(b.start, b.end), b.start)
      out.push(runs.map((r) => (r.br ? ' ' : '') + text.slice(r.start, r.end)).join(''))
    }
  }
  return out
}

describe('blockquotes', () => {
  it('parses a single quote line and omits the marker', () => {
    const text = '> hello'
    const [q] = parseBlocks(text)
    expect(q.type).toBe('quote')
    expect(q.children).toEqual([{ type: 'p', start: 2, end: 7, segs: [{ start: 2, end: 7 }] }])
    expect(paint([q], text)).toEqual(['> hello'])
  })

  it('joins consecutive quote lines into one paragraph', () => {
    const text = '> one\n> two\n>three'
    const blocks = parseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].children).toHaveLength(1)
    expect(paint(blocks, text)).toEqual(['> one two three'])
  })

  it('splits paragraphs on a blank > line', () => {
    const text = '> one\n>\n> two'
    const blocks = parseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(paint(blocks, text)).toEqual(['> one', '> two'])
  })

  it('nests deeper levels', () => {
    const text = '> outer\n> > inner\n> > > deepest'
    const [q] = parseBlocks(text)
    expect(paint([q], text)).toEqual(['> outer', '> > inner', '> > > deepest'])
    expect(q.children!.map((c) => c.type)).toEqual(['p', 'quote'])
  })

  it('continues the paragraph on a lazy line, and stops at a blank line', () => {
    const text = '> start\nlazy more\n\nafter'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['quote', 'p'])
    expect(paint(blocks, text)).toEqual(['> start lazy more', 'after'])
  })

  it('does not lazily continue into a block start', () => {
    const text = '> start\n# head\n- item'
    expect(parseBlocks(text).map((b) => b.type)).toEqual(['quote', 'h1', 'li'])
  })

  it('lets a quote interrupt a paragraph', () => {
    expect(parseBlocks('para\n> quoted').map((b) => b.type)).toEqual(['p', 'quote'])
  })

  it('renders lists and inline markdown inside a quote', () => {
    const text = '> intro **bold**\n>\n> - a\n> - b `c`'
    const [q] = parseBlocks(text)
    expect(q.children!.map((c) => c.type)).toEqual(['p', 'li', 'li'])
    const runs = parseInlineSegs(text, q.children![0].segs!)
    const bold = runs.find((r) => r.bold)!
    expect(text.slice(bold.start, bold.end)).toBe('bold')
    expect(paint([q], text)).toEqual(['> intro bold', '> - a', '> - b c'])
  })

  it('keeps > literal inside a fenced block and inside inline code', () => {
    const fenced = parseBlocks('```\n> not a quote\n```')
    expect(fenced.map((b) => b.type)).toEqual(['fence'])
    const text = 'say `> x` now'
    const [p] = parseBlocks(text)
    expect(p.type).toBe('p')
    const code = parseInline(text, 0).find((r) => r.code)!
    expect(text.slice(code.start, code.end)).toBe('> x')
  })

  it('keeps a fence inside a quote and maps its lines', () => {
    const text = '> ```js\n> a > b\n> c\n> ```'
    const [q] = parseBlocks(text)
    const f = q.children![0]
    expect(f.type).toBe('fence')
    expect(f.info).toBe('js')
    expect(f.segs!.map((g) => text.slice(g.start, g.end))).toEqual(['a > b', 'c'])
  })

  it('handles an empty > line', () => {
    const [q] = parseBlocks('>')
    expect(q.type).toBe('quote')
    expect(q.children).toEqual([])
    expect(parseBlocks('> \n> x').length).toBe(1)
  })

  it('handles CRLF without leaking CR into quote content', () => {
    const text = '> a\r\n> b\r\n\r\nafter'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['quote', 'p'])
    expect(paint([blocks[0]], text)).toEqual(['> a b'])
  })

  it('keeps offsets exact after an emoji before the quote', () => {
    const text = '😀 hi\n\n> quoted 😀 text'
    const blocks = parseBlocks(text)
    const seg = blocks[1].children![0].segs![0]
    expect(text.slice(seg.start, seg.end)).toBe('quoted 😀 text')
  })

  it('parses a callout: marker omitted, kind lowercased, title is a source range', () => {
    const text = '> [!NOTE] Heads up\n> body here'
    const [q] = parseBlocks(text)
    expect(q.callout!.kind).toBe('note')
    expect(text.slice(q.callout!.titleStart, q.callout!.titleEnd)).toBe('Heads up')
    expect(paint([q], text)).toEqual(['[note]Heads up', '> body here'])
    const bare = parseBlocks('> [!tip]')[0]
    expect(bare.callout!.titleEnd).toBe(bare.callout!.titleStart)
    expect(bare.children).toEqual([])
  })

  it('maps a selection inside a quote back to the exact original range', () => {
    const text = '😀 intro\n\n> first line **bold** here\n> second line\n\nend'
    const q = parseBlocks(text)[1]
    const runs = parseInlineSegs(text, q.children![0].segs!)
    const piece = runs.find((r) => text.slice(r.start, r.end).includes('second'))!
    const at = piece.start + text.slice(piece.start, piece.end).indexOf('second')
    expect(text.slice(at, at + 6)).toBe('second')
    const bold = runs.find((r) => r.bold)!
    expect(text.slice(bold.start + 1, bold.start + 3)).toBe('ol')
    for (const r of runs) expect(text.slice(r.start, r.end)).not.toContain('>')
    expect(runs.find((r) => r.br)).toBeTruthy()
  })
})
