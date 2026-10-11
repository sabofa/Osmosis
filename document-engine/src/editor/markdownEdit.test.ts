import { describe, expect, it } from 'vitest'
import { cycleHeading, makeLink, toggleLinePrefix, toggleWrap, type EditResult, type MarkdownEdit } from './markdownEdit'

// Apply a result to a doc the way an editor would (simultaneous changes).
function apply(doc: string, r: EditResult | null): { doc: string; sel: string } {
  if (!r) throw new Error('null result')
  let out = ''
  let at = 0
  for (const c of r.changes) {
    expect(c.from).toBeGreaterThanOrEqual(at)
    out += doc.slice(at, c.from) + c.insert
    at = c.to
  }
  out += doc.slice(at)
  const { anchor, head } = r.selection
  const lo = Math.min(anchor, head)
  const hi = Math.max(anchor, head)
  return { doc: out, sel: out.slice(0, lo) + '|' + (hi > lo ? out.slice(lo, hi) + '|' : '') + out.slice(hi) }
}

/** `a[b]c` marks the selection with brackets; `a|c` marks a caret. */
function run(cmd: MarkdownEdit, marked: string) {
  let doc: string
  let sel: { from: number; to: number }
  const o = marked.indexOf('[')
  const c = marked.lastIndexOf(']')
  if (!marked.includes('|') && o >= 0 && c > o) {
    doc = marked.slice(0, o) + marked.slice(o + 1, c) + marked.slice(c + 1)
    sel = { from: o, to: c - 1 }
  } else {
    const p = marked.indexOf('|')
    doc = marked.replace('|', '')
    sel = { from: p, to: p }
  }
  return apply(doc, cmd(doc, sel))
}

describe('toggleWrap', () => {
  const bold = toggleWrap('**')
  const italic = toggleWrap('*')
  const strike = toggleWrap('~~')
  const code = toggleWrap('`')

  it('wraps a selection and keeps it selected', () => {
    expect(run(bold, 'a [word] b')).toEqual({ doc: 'a **word** b', sel: 'a **|word|** b' })
    expect(run(strike, '[x]').doc).toBe('~~x~~')
    expect(run(code, '[x]').doc).toBe('`x`')
    expect(run(italic, '[x]').doc).toBe('*x*')
  })
  it('unwraps when markers are just outside the selection', () => {
    expect(run(bold, 'a **[word]** b')).toEqual({ doc: 'a word b', sel: 'a |word| b' })
  })
  it('unwraps when the selection includes the markers', () => {
    expect(run(bold, 'a [**word**] b')).toEqual({ doc: 'a word b', sel: 'a |word| b' })
  })
  it('is reversible', () => {
    const a = run(bold, 'a [word] b')
    expect(a.doc).toBe('a **word** b')
    expect(run(bold, 'a **[word]** b').doc).toBe('a word b')
  })
  it('italic does not mistake bold markers for its own', () => {
    expect(run(italic, '**[x]**').doc).toBe('***x***')
    expect(run(italic, '[**x**]').doc).toBe('***x***')
    expect(run(bold, '*[x]*').doc).toBe('***x***')
  })
  it('trims whitespace inside the selection before wrapping', () => {
    expect(run(bold, 'a[ word ]b').doc).toBe('a **word** b')
  })
  it('empty selection inserts a pair with the caret inside', () => {
    expect(run(bold, 'a | b')).toEqual({ doc: 'a **** b', sel: 'a **|** b' })
    expect(run(code, '|').doc).toBe('``')
    expect(run(code, '|').sel).toBe('`|`')
  })
  it('empty doc works', () => {
    expect(run(italic, '|').doc).toBe('**')
  })
  it('caret inside a wrapped word unwraps it', () => {
    expect(run(bold, 'a **wo|rd** b')).toEqual({ doc: 'a word b', sel: 'a wo|rd b' })
    expect(run(bold, 'a **|word** b').doc).toBe('a word b')
    expect(run(bold, 'a **word|** b').doc).toBe('a word b')
  })
  it('caret outside the wrapped word inserts a new pair', () => {
    expect(run(bold, 'a **word** |b').doc).toBe('a **word** ****b')
  })
  it('caret works on the second pair of a line', () => {
    expect(run(bold, '**a** and **b|**').doc).toBe('**a** and b')
  })
  it('only considers the caret line', () => {
    expect(run(bold, '**a\nb|**').doc).toBe('**a\nb******')
  })
  it('multi-line selection wraps once', () => {
    expect(run(bold, '[a\nb]').doc).toBe('**a\nb**')
  })
  it('all-whitespace selection acts like an empty one', () => {
    expect(run(bold, 'a[ ]b').doc).toBe('a**** b')
  })
})

describe('toggleLinePrefix', () => {
  const bullet = toggleLinePrefix('- ')
  const num = toggleLinePrefix('1. ')
  const quote = toggleLinePrefix('> ')
  const task = toggleLinePrefix('- [ ] ')

  it('adds a prefix to a single line, caret stays in the text', () => {
    expect(run(bullet, 'ab|c')).toEqual({ doc: '- abc', sel: '- ab|c' })
  })
  it('caret at line start lands after the new prefix', () => {
    expect(run(bullet, '|abc').sel).toBe('- |abc')
  })
  it('removes the prefix when present', () => {
    expect(run(bullet, '- ab|c').doc).toBe('abc')
  })
  it('works on an empty doc', () => {
    expect(run(bullet, '|')).toEqual({ doc: '- ', sel: '- |' })
    expect(run(num, '|').doc).toBe('1. ')
  })
  it('covers all selected lines', () => {
    expect(run(bullet, '[a\nb\nc]').doc).toBe('- a\n- b\n- c')
    expect(run(bullet, 'x\n[a\nb]\ny').doc).toBe('x\n- a\n- b\ny')
  })
  it('removes from all when every line already has it', () => {
    expect(run(bullet, '[- a\n- b]').doc).toBe('a\nb')
  })
  it('adds to the rest when only some lines have it', () => {
    expect(run(bullet, '[- a\nb]').doc).toBe('- a\n- b')
  })
  it('replaces a different list prefix', () => {
    expect(run(num, '[- a\n- b]').doc).toBe('1. a\n2. b')
    expect(run(bullet, '[1. a\n2. b]').doc).toBe('- a\n- b')
    expect(run(task, '[- a\n- [x] b]').doc).toBe('- [ ] a\n- [ ] b')
    expect(run(bullet, '[- [ ] a]').doc).toBe('- a')
    expect(run(quote, '[- a]').doc).toBe('> a')
  })
  it('numbers lines 1..n, skipping blank lines', () => {
    expect(run(num, '[a\n\nb\nc]').doc).toBe('1. a\n\n2. b\n3. c')
  })
  it('renumbers existing numbering from 1', () => {
    expect(run(num, '[3. a\nb]').doc).toBe('1. a\n2. b')
  })
  it('removes a numbered list', () => {
    expect(run(num, '[1. a\n2. b]').doc).toBe('a\nb')
  })
  it('preserves indentation', () => {
    expect(run(bullet, '[  a\n  b]').doc).toBe('  - a\n  - b')
    expect(run(bullet, '  - a|').doc).toBe('  a')
  })
  it('does not include a trailing line the selection only touches', () => {
    expect(run(bullet, '[a\n]b').doc).toBe('- a\nb')
  })
  it('toggles tasks and quotes', () => {
    expect(run(task, 'a|').doc).toBe('- [ ] a')
    expect(run(task, '- [ ] a|').doc).toBe('a')
    expect(run(task, '- [x] a|').doc).toBe('a')
    expect(run(quote, '> a|').doc).toBe('a')
  })
  it('selection grows to include added prefixes', () => {
    expect(run(bullet, '[a\nb]').sel).toBe('|- a\n- b|')
  })
  it('all-blank selection gets prefixes', () => {
    expect(run(bullet, '[\n]').doc).toBe('- \n')
  })
})

describe('cycleHeading', () => {
  const up = cycleHeading(1)
  const down = cycleHeading(-1)

  it('none -> # -> ## ...', () => {
    expect(run(up, 'ti|tle').doc).toBe('# title')
    expect(run(up, '# ti|tle').doc).toBe('## title')
    expect(run(up, '##### t|').doc).toBe('###### t')
  })
  it('keeps the caret in the text', () => {
    expect(run(up, 'ti|tle').sel).toBe('# ti|tle')
  })
  it('wraps ###### back to none', () => {
    expect(run(up, '###### t|').doc).toBe('t')
  })
  it('down: none -> ###### and ## -> #', () => {
    expect(run(down, 't|').doc).toBe('###### t')
    expect(run(down, '## t|').doc).toBe('# t')
    expect(run(down, '# t|').doc).toBe('t')
  })
  it('affects only the cursor line', () => {
    expect(run(up, 'a\nb|\nc').doc).toBe('a\n# b\nc')
  })
  it('empty doc and empty heading', () => {
    expect(run(up, '|').doc).toBe('# ')
    expect(run(up, '#|').doc).toBe('## ')
  })
  it('does not treat hashtags without a space as headings', () => {
    expect(run(up, '#tag|').doc).toBe('# #tag')
  })
  it('seven or more hashes are not a heading', () => {
    expect(run(up, '####### x|').doc).toBe('# ####### x')
  })
})

describe('makeLink', () => {
  it('turns selected text into a link with url selected', () => {
    expect(run(makeLink(), 'see [docs] now')).toEqual({
      doc: 'see [docs](url) now',
      sel: 'see [docs](|url|) now',
    })
  })
  it('selected URL becomes the target with caret in the brackets', () => {
    expect(run(makeLink(), 'x [https://a.com/b] y')).toEqual({
      doc: 'x [](https://a.com/b) y',
      sel: 'x [|](https://a.com/b) y',
    })
    expect(run(makeLink(), '[www.a.com]').doc).toBe('[](www.a.com)')
  })
  it('empty selection inserts an empty link', () => {
    expect(run(makeLink(), 'a|b')).toEqual({ doc: 'a[]()b', sel: 'a[|]()b' })
    expect(run(makeLink(), '|').doc).toBe('[]()')
  })
  it('explicit url is used and the caret goes after the link', () => {
    expect(run(makeLink('https://x.y'), 'a [b] c')).toEqual({
      doc: 'a [b](https://x.y) c',
      sel: 'a [b](https://x.y)| c',
    })
    expect(run(makeLink('https://x.y'), '[https://a.b]').doc).toBe('[https://a.b](https://x.y)')
  })
  it('spans multiple lines', () => {
    expect(run(makeLink(), '[a\nb]').doc).toBe('[a\nb](url)')
  })
})
