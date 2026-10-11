import { describe, expect, it } from 'vitest'
import {
  cycleHeading, fencedLineStarts, makeLink, toggleLinePrefix, toggleWrap, setBlockStyle, clearFormatting, insertHr,
  insertMathBlock, insertGraphFence, indentLines, selectionIsAllList, GRAPH_STARTER, type EditResult, type MarkdownEdit,
} from './markdownEdit'

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
  it('multi-line selection wraps each non-blank line, never across a break', () => {
    expect(run(bold, '[a\nb]').doc).toBe('**a**\n**b**')
    expect(run(bold, '[one\n\ntwo]').doc).toBe('**one**\n\n**two**')
    expect(run(bold, '[  a  \n  b  ]').doc).toBe('  **a**  \n  **b**  ')
  })
  it('multi-line: unwraps when every line is wrapped, skips already-wrapped lines otherwise', () => {
    expect(run(bold, '[**a**\n**b**]').doc).toBe('a\nb')
    expect(run(bold, '[**a**\nb]').doc).toBe('**a**\n**b**')
  })
  it('pairs only real openers and closers on the line', () => {
    expect(run(italic, 'a * b *c|*').doc).toBe('a * b c')
    expect(run(italic, 'a * b *c* d|').doc).toBe('a * b *c* d**')
    expect(run(italic, '2 * 3 * |4').doc).toBe('2 * 3 * **4')
  })
  it('a reversed selection stays reversed', () => {
    const r = bold('a word b', { from: 2, to: 6, reversed: true })!
    expect(r.selection.anchor).toBeGreaterThan(r.selection.head)
    const l = toggleLinePrefix('- ')('one\ntwo', { from: 0, to: 7, reversed: true })!
    expect(l.selection.anchor).toBeGreaterThan(l.selection.head)
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
  it('escapes brackets in the link text', () => {
    expect(run(makeLink('u'), '[a [x] b]').doc).toBe('[a \\[x\\] b](u)')
    // already-escaped brackets are not escaped twice
    expect(run(makeLink('u'), '[a \\[x\\]]').doc).toBe('[a \\[x\\]](u)')
  })
  it('does not re-wrap a selection that is already a link', () => {
    const doc = 'see [a](b) now'
    const r = makeLink()(doc, { from: 4, to: 10 })!
    expect(r.changes).toEqual([])
    expect(doc.slice(r.selection.anchor, r.selection.head)).toBe('b')
  })
})

describe('fenced code is left alone', () => {
  const doc = 'para\n```\ncode line\n- not a list\n```\nafter'
  const at = (needle: string) => doc.indexOf(needle) + 1
  it('fencedLineStarts covers delimiters and content only', () => {
    expect([...fencedLineStarts(doc)].sort((a, b) => a - b)).toEqual([5, 9, 19, 32])
  })
  it('tilde fences, longer closers, unterminated fences', () => {
    expect(fencedLineStarts('~~~\na\n~~~\nb').size).toBe(3)
    expect(fencedLineStarts('````\n```\nx\n````\ny').size).toBe(4)
    expect(fencedLineStarts('```\nx\ny').size).toBe(3)
    // a backtick fence whose info string has a backtick is not a fence
    expect(fencedLineStarts('``` a`b\nx').size).toBe(0)
  })
  it('cycleHeading does nothing in a fence, works outside', () => {
    expect(cycleHeading(1)(doc, { from: at('code line'), to: at('code line') })).toBeNull()
    expect(cycleHeading(1)(doc, { from: at('```'), to: at('```') })).toBeNull()
    expect(run(cycleHeading(1), 'pa|ra').doc).toBe('# para')
  })
  it('toggleLinePrefix does nothing inside a fence and skips fenced lines in a range', () => {
    expect(toggleLinePrefix('- ')(doc, { from: at('code line'), to: at('code line') })).toBeNull()
    const r = toggleLinePrefix('> ')(doc, { from: 0, to: doc.length })!
    const out = apply(doc, r).doc
    expect(out).toBe('> para\n```\ncode line\n- not a list\n```\n> after')
  })
})

describe('setBlockStyle', () => {
  it('sets headings, replacing an existing level, quote or heading', () => {
    expect(run(setBlockStyle('h1'), 'hel|lo').doc).toBe('# hello')
    expect(run(setBlockStyle('h3'), '# hel|lo').doc).toBe('### hello')
    expect(run(setBlockStyle('h2'), '> hel|lo').doc).toBe('## hello')
    expect(run(setBlockStyle('h4'), '###### x|').doc).toBe('#### x')
  })
  it('toggles a heading level off to normal', () => {
    expect(run(setBlockStyle('h2'), '## hel|lo').doc).toBe('hello')
    expect(run(setBlockStyle('h1'), '# hello|').doc).toBe('hello')
  })
  it('normal strips heading and quote prefixes but keeps list markers', () => {
    expect(run(setBlockStyle('normal'), '### he|llo').doc).toBe('hello')
    expect(run(setBlockStyle('normal'), '> he|llo').doc).toBe('hello')
    expect(run(setBlockStyle('normal'), '- it|em').doc).toBe('- item')
    expect(run(setBlockStyle('normal'), 'pla|in').doc).toBe('plain')
  })
  it('a heading replaces a list marker', () => {
    expect(run(setBlockStyle('h2'), '- it|em').doc).toBe('## item')
  })
  it('quote toggles and replaces a heading', () => {
    expect(run(setBlockStyle('quote'), 'he|llo').doc).toBe('> hello')
    expect(run(setBlockStyle('quote'), '> he|llo').doc).toBe('hello')
    expect(run(setBlockStyle('quote'), '## he|llo').doc).toBe('> hello')
  })
  it('applies to every selected line, skipping blank lines', () => {
    expect(run(setBlockStyle('h2'), '[one\n\ntwo]').doc).toBe('## one\n\n## two')
    expect(run(setBlockStyle('quote'), '[a\nb\nc]').doc).toBe('> a\n> b\n> c')
    // mixed selection: not all the same, so the style is applied to all, not toggled off
    expect(run(setBlockStyle('h1'), '[# a\nb]').doc).toBe('# a\n# b')
    // all the same: toggled off
    expect(run(setBlockStyle('h1'), '[# a\n# b]').doc).toBe('a\nb')
  })
  it('a selection ending after a newline does not take the next line', () => {
    const r = setBlockStyle('h1')('a\nb', { from: 0, to: 2 })
    expect(apply('a\nb', r).doc).toBe('# a\nb')
  })
  it('an empty line gets the prefix so the user can type after it', () => {
    expect(run(setBlockStyle('h2'), '|').doc).toBe('## ')
  })
  it('keeps the caret on its text', () => {
    expect(run(setBlockStyle('h1'), 'hel|lo').sel).toBe('# hel|lo')
    expect(run(setBlockStyle('h1'), '## hel|lo').sel).toBe('# hel|lo')
  })
  it('code wraps the selected lines in a fence and keeps the selection', () => {
    expect(run(setBlockStyle('code'), '[a\nb]').doc).toBe('```\na\nb\n```')
    expect(run(setBlockStyle('code'), '[a\nb]').sel).toBe('```\n|a\nb|\n```')
    expect(run(setBlockStyle('code'), 'x\nhe|llo\ny').doc).toBe('x\n```\nhello\n```\ny')
  })
  it('code on an empty line puts the caret inside the fence', () => {
    const r = run(setBlockStyle('code'), '|')
    expect(r.doc).toBe('```\n\n```')
    expect(r.sel).toBe('```\n|\n```')
  })
  it('any style un-fences a fenced block; Code toggles it off', () => {
    for (const st of ['normal', 'h1', 'quote', 'code'] as const) {
      expect(run(setBlockStyle(st), '```\nco|de\n```').doc).toBe('code')
    }
    expect(run(setBlockStyle('normal'), 'a\n```\nl1\nl|2\n```\nb').doc).toBe('a\nl1\nl2\nb')
    expect(run(setBlockStyle('normal'), '```ts\nco|de\n```').doc).toBe('code')
    expect(run(setBlockStyle('normal'), '```\n|\n```').doc).toBe('')
    expect(run(setBlockStyle('normal'), '```\nco|de').doc).toBe('code')
    expect(run(setBlockStyle('normal'), '[```\nx\n```]').doc).toBe('x')
  })
  it('keeps the selection on its text when un-fencing', () => {
    expect(run(setBlockStyle('normal'), '```js\n[a\nb]\n```').sel).toBe('|a\nb|')
  })
  it('a mixed selection of fence and text with Code stays null', () => {
    expect(setBlockStyle('code')('x\n```\nc\n```', { from: 0, to: 6 })).toBeNull()
  })
  it('skips fenced lines inside a mixed selection', () => {
    expect(run(setBlockStyle('h1'), '[a\n```\ncode\n```\nb]').doc).toBe('# a\n```\ncode\n```\n# b')
  })
})

describe('clearFormatting keeps what is not formatting', () => {
  it('leaves $math$, link targets and bare URLs alone', () => {
    expect(run(clearFormatting(), '[$a*b*c$ and **x**]').doc).toBe('$a*b*c$ and x')
    expect(run(clearFormatting(), '[**see** [a_b_c](http://x.com/a_b_c_d) *now*]').doc).toBe('see [a_b_c](http://x.com/a_b_c_d) now')
    expect(run(clearFormatting(), '[go to https://x.com/a_b_c_d please **ok**]').doc).toBe('go to https://x.com/a_b_c_d please ok')
  })
  it('does not touch a horizontal rule line', () => {
    for (const hr of ['* * *', '---', '___', '***']) expect(clearFormatting()(hr, { from: 0, to: hr.length })).toBeNull()
  })
})

describe('clearFormatting', () => {
  it('strips inline markers around the selection', () => {
    expect(run(clearFormatting(), '[a **bold** and *it* ~~gone~~ `code`]').doc).toBe('a bold and it gone code')
    expect(run(clearFormatting(), '**ni|ce**').doc).toBe('nice')
    expect(run(clearFormatting(), 'x __b__ y _i_ z|').doc).toBe('x b y i z')
  })
  it('strips heading, quote and list prefixes', () => {
    expect(run(clearFormatting(), '## ti|tle').doc).toBe('title')
    expect(run(clearFormatting(), '> qu|ote').doc).toBe('quote')
    expect(run(clearFormatting(), '- [ ] ta|sk').doc).toBe('task')
    expect(run(clearFormatting(), '1. nu|m').doc).toBe('num')
    expect(run(clearFormatting(), '> ## **hi|**').doc).toBe('hi')
  })
  it('handles every selected line', () => {
    expect(run(clearFormatting(), '[# **a**\n- b\n> *c*]').doc).toBe('a\nb\nc')
  })
  it('leaves stray stars, snake_case and math alone; code spans keep their content', () => {
    expect(clearFormatting()('a * b * c', { from: 9, to: 9 })).toBeNull()
    expect(clearFormatting()('snake_case_name 2*3*4', { from: 0, to: 0 })).toBeNull()
    expect(run(clearFormatting(), 'a `x*y*` b|').doc).toBe('a x*y* b')
  })
  it('returns null when nothing would change, and skips fenced lines', () => {
    expect(clearFormatting()('plain', { from: 0, to: 0 })).toBeNull()
    expect(clearFormatting()('```\n**x**\n```', { from: 5, to: 5 })).toBeNull()
  })
})

describe('block inserts', () => {
  it('hr sits on its own with blank lines around it', () => {
    expect(run(insertHr(), 'one|').doc).toBe('one\n\n---')
    expect(run(insertHr(), 'one|\ntwo').doc).toBe('one\n\n---\n\ntwo')
    expect(run(insertHr(), 'one\n\n|\ntwo').doc).toBe('one\n\n---\n\ntwo')
    expect(run(insertHr(), '|').doc).toBe('---')
    expect(run(insertHr(), 'a|\n\nb').doc).toBe('a\n\n---\n\nb')
  })
  it('hr lands the caret after the rule', () => {
    expect(run(insertHr(), 'one|').sel).toBe('one\n\n---|')
  })
  it('math wraps the selected lines or opens an empty pair', () => {
    expect(run(insertMathBlock(), '[x^2 + 1]').doc).toBe('$$\nx^2 + 1\n$$')
    expect(run(insertMathBlock(), '[x^2 + 1]').sel).toBe('$$\n|x^2 + 1|\n$$')
    expect(run(insertMathBlock(), 'te|xt').doc).toBe('$$\ntext\n$$')
    const e = run(insertMathBlock(), 'text\n\n|')
    expect(e.doc).toBe('text\n\n$$\n\n$$')
    expect(e.sel).toBe('text\n\n$$\n|\n$$')
    expect(run(insertMathBlock(), '|').sel).toBe('$$\n|\n$$')
  })
  it('graph inserts a ```graph fence with the starter plot', () => {
    const r = run(insertGraphFence(), 'intro|\nafter')
    expect(r.doc).toBe('intro\n\n```graph\n' + GRAPH_STARTER + '\n```\n\nafter')
    expect(GRAPH_STARTER.split('\n')[0]).toBe('y = sin(x)')
    expect(r.sel.indexOf('|')).toBe(('intro\n\n```graph\n' + GRAPH_STARTER).length)
  })
  it('refuses to insert inside a fenced block', () => {
    const doc = '```\ncode\n```'
    for (const mk of [insertHr, insertGraphFence, insertMathBlock]) expect(mk()(doc, { from: 6, to: 6 })).toBeNull()
  })
})

describe('indentLines', () => {
  it('indent adds two spaces to non-blank lines', () => {
    expect(run(indentLines(1), '[a\n\nb]').doc).toBe('  a\n\n  b')
    expect(run(indentLines(1), '- it|em').doc).toBe('  - item')
  })
  it('outdent removes up to two spaces or a tab', () => {
    expect(run(outdentOf(), '[    a\n b\n\tc\nd]').doc).toBe('  a\nb\nc\nd')
  })
  it('outdent with nothing to remove is null; fenced lines are skipped', () => {
    expect(indentLines(-1)('a', { from: 0, to: 0 })).toBeNull()
    expect(indentLines(1)('```\nx\n```', { from: 5, to: 5 })).toBeNull()
  })
  it('selectionIsAllList', () => {
    expect(selectionIsAllList('- a\n  1. b', { from: 0, to: 10 })).toBe(true)
    expect(selectionIsAllList('- a\nplain', { from: 0, to: 9 })).toBe(false)
    expect(selectionIsAllList('', { from: 0, to: 0 })).toBe(false)
  })
})
function outdentOf(): MarkdownEdit { return indentLines(-1) }
