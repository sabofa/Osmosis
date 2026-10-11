import { describe, it, expect } from 'vitest'
import { extractHeadings, headingBlockIndex, lineRangeAt, sameHeadings, slugify, stripInline } from './outline'

const h = (t: string) => extractHeadings(t).map((x) => [x.level, x.text, x.offset])

describe('extractHeadings', () => {
  it('reads ATX levels 1-6 with offsets of the line start', () => {
    expect(h('# A\n\ntext\n## B\n###### F\n####### no')).toEqual([[1, 'A', 0], [2, 'B', 10], [6, 'F', 15]])
  })
  it('needs a space after the hashes; allows closing hashes and up to 3 spaces of indent', () => {
    expect(h('#nope\n   ## Yes ##\n    ## code')).toEqual([[2, 'Yes', 6]])
  })
  it('empty headings are kept with empty text', () => {
    const r = extractHeadings('#\n## \n# x')
    expect(r.map((x) => [x.level, x.text])).toEqual([[1, ''], [2, ''], [1, 'x']])
    expect(r.map((x) => x.id)).toEqual(['heading', 'heading-2', 'x'])
  })
  it('strips inline markup', () => {
    expect(extractHeadings('# **Bold** and *it* `code` [link](http://x) ![img](y.png) ~~s~~ $x^2$ <b>t</b>')[0].text).toBe('Bold and it code link img s x^2 t')
    expect(extractHeadings('# snake_case_name and _em_')[0].text).toBe('snake_case_name and em')
  })
  it('skips fenced code and math blocks', () => {
    const t = '# Real\n```md\n# not\n```\n~~~\n## nor\n~~~\n$$\n# math\n$$\n## After'
    expect(h(t).map((x) => x[1])).toEqual(['Real', 'After'])
    expect(h('```\n# unterminated fence swallows\n')).toEqual([])
    expect(h('$$ # one line $$\n# yes')).toEqual([[1, 'yes', 17]])
  })
  it('setext headings: = is 1, - is 2, offset at the first paragraph line', () => {
    expect(h('Title\n=====\n\nSub *x*\n---\n\ntext')).toEqual([[1, 'Title', 0], [2, 'Sub x', 13]])
    expect(h('para line\nsecond\n===')).toEqual([[1, 'para line second', 0]])
  })
  it('a rule or list is not setext', () => {
    expect(h('text\n\n---\n\n- item\n---\n')).toEqual([])
  })
  it('CRLF: offsets are in the LF text', () => {
    const lf = '# A\n\nbody\n## B'
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(extractHeadings(crlf)).toEqual(extractHeadings(lf))
    expect(extractHeadings(crlf)[1].offset).toBe(10)
  })
  it('emoji count as one codepoint in offsets', () => {
    const r = extractHeadings('😀😀 hi\n# After 🎉')
    expect(r).toEqual([{ id: 'after', level: 1, text: 'After 🎉', offset: 6 }])
    expect(extractHeadings('# 🎉')[0].id).toBe('heading')
  })
  it('ids are slugs; duplicates get -2, -3 and never collide with literal slugs', () => {
    const ids = extractHeadings('# Intro\n# Intro\n# Intro\n# Intro 2\n# Intro-2\n# Über Café!').map((x) => x.id)
    expect(ids).toEqual(['intro', 'intro-2', 'intro-3', 'intro-2-2', 'intro-2-3', 'über-café'])
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('ids are stable across edits elsewhere', () => {
    const a = extractHeadings('# One\n\n## Two')
    const b = extractHeadings('intro text\n\n# One\n\nmore\n\n## Two')
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
  })
  it('no headings', () => {
    expect(extractHeadings('')).toEqual([])
    expect(extractHeadings('just text\nmore')).toEqual([])
  })
})

describe('helpers', () => {
  it('stripInline and slugify', () => {
    expect(stripInline('  a   **b**  ')).toBe('a b')
    expect(slugify('Hello, World -- 2!')).toBe('hello-world-2')
    expect(slugify('')).toBe('heading')
  })
  it('sameHeadings', () => {
    const a = extractHeadings('# a\n## b')
    expect(sameHeadings(a, extractHeadings('# a\n## b'))).toBe(true)
    expect(sameHeadings(a, extractHeadings('# a\n## c'))).toBe(false)
    expect(sameHeadings(a, extractHeadings('# a'))).toBe(false)
  })
})

describe('lineRangeAt (LF codepoint offset -> raw UTF-16 line)', () => {
  it('plain LF', () => {
    expect(lineRangeAt('# A\n\n## B\nx', 5)).toEqual({ start: 5, end: 9 })
  })
  it('CRLF maps back to the raw text and excludes the break', () => {
    const raw = '# A\r\n\r\n## B\r\nx'
    const hs = extractHeadings(raw)
    const r = lineRangeAt(raw, hs[1].offset)
    expect(raw.slice(r.start, r.end)).toBe('## B')
  })
  it('emoji before the line', () => {
    const raw = '😀 x\n# H'
    const r = lineRangeAt(raw, extractHeadings(raw)[0].offset)
    expect(raw.slice(r.start, r.end)).toBe('# H')
  })
  it('last line without a break', () => {
    expect(lineRangeAt('a\nb', 2)).toEqual({ start: 2, end: 3 })
  })
})

describe('headingBlockIndex', () => {
  it('picks the last block starting at or before the heading line end', () => {
    // blocks: p@0, h@12 (after "# "), p@30
    expect(headingBlockIndex([0, 12, 30], 20)).toBe(1)
    expect(headingBlockIndex([0, 12, 30], 5)).toBe(0)
    expect(headingBlockIndex([0, 12, 30], 30)).toBe(2)
  })
  it('skips blocks without mapped text and handles none', () => {
    expect(headingBlockIndex([0, null, 30], 20)).toBe(0)
    expect(headingBlockIndex([40], 20)).toBe(-1)
    expect(headingBlockIndex([], 20)).toBe(-1)
  })
})
