import { describe, expect, it } from 'vitest'
import { render, segment } from './richText'

describe('segment', () => {
  it('returns a single text segment for plain prose', () => {
    expect(segment('Just words.')).toEqual([{ kind: 'text', value: 'Just words.' }])
  })

  it('splits inline math out of surrounding text', () => {
    expect(segment('Let $x$ be odd.')).toEqual([
      { kind: 'text', value: 'Let ' },
      { kind: 'inline', value: 'x' },
      { kind: 'text', value: ' be odd.' },
    ])
  })

  it('recognises \\[ … \\] as display math', () => {
    expect(segment('\\[x^2\\]')).toEqual([{ kind: 'display', value: 'x^2' }])
  })

  it('recognises $$ … $$ as display math', () => {
    expect(segment('a $$x^2$$ b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'display', value: 'x^2' },
      { kind: 'text', value: ' b' },
    ])
  })

  it('turns \\$ into a literal dollar in text', () => {
    expect(segment('costs \\$5')).toEqual([{ kind: 'text', value: 'costs $5' }])
  })

  it('leaves an unmatched $ as literal text', () => {
    expect(segment('costs $5 total')).toEqual([{ kind: 'text', value: 'costs $5 total' }])
  })

  it('does not let inline math span a blank line', () => {
    expect(segment('$5 apples\n\nand $3 pears')).toEqual([
      { kind: 'text', value: '$5 apples\n\nand $3 pears' },
    ])
  })

  it('leaves an unmatched $$ as literal text', () => {
    expect(segment('a $$x^2')).toEqual([{ kind: 'text', value: 'a $$x^2' }])
  })

  // pandoc's tex_math_dollars rule: an opening `$` must be followed by
  // non-whitespace, and a closing `$` must be preceded by non-whitespace and
  // not followed by a digit. Prose full of prices is the whole reason — the
  // economics prompt below was rendering half a sentence as a formula on the
  // deployed bank.
  it('does not read a run of prices as math', () => {
    const prompt =
      'Points A and B both lie on the same demand curve D. Moving from A (Q=5, P=$50) to B (Q=15, P=$30) illustrates:'
    expect(segment(prompt)).toEqual([{ kind: 'text', value: prompt }])
  })

  it('leaves two prices in one line as text', () => {
    expect(segment('P=$50 and P=$30')).toEqual([{ kind: 'text', value: 'P=$50 and P=$30' }])
  })

  it('leaves $5 or $10 as text', () => {
    expect(segment('$5 or $10')).toEqual([{ kind: 'text', value: '$5 or $10' }])
  })

  it('leaves a $ with whitespace inside as text', () => {
    expect(segment('$ x $')).toEqual([{ kind: 'text', value: '$ x $' }])
  })

  it('still reads two inline runs in one sentence as math', () => {
    expect(segment('$x$, then $y$')).toEqual([
      { kind: 'inline', value: 'x' },
      { kind: 'text', value: ', then ' },
      { kind: 'inline', value: 'y' },
    ])
  })

  it('still reads a fraction as inline math', () => {
    expect(segment('$\\frac{a}{b}$')).toEqual([{ kind: 'inline', value: '\\frac{a}{b}' }])
  })

  it('keeps a chemistry macro intact inside inline math', () => {
    expect(segment('$\\ce{Al2(SO4)3}$')).toEqual([{ kind: 'inline', value: '\\ce{Al2(SO4)3}' }])
  })
})

// katex marks anything it could not parse with the `katex-error` class (we pass
// throwOnError:false so bad input degrades instead of throwing) — asserting its
// absence is how these tests check "this actually rendered".
function rendersCleanly(text: string): boolean {
  return !render(text).includes('katex-error')
}

describe('render', () => {
  it('renders a fraction', () => {
    const html = render('$\\frac{a}{b}$')
    expect(html).toContain('katex')
    expect(html).not.toContain('katex-error')
  })

  it('renders a square root', () => {
    expect(rendersCleanly('$\\sqrt{30}$')).toBe(true)
  })

  it('renders display math in display mode', () => {
    const html = render('\\[x^2\\]')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('katex-error')
  })

  it('renders a chemical formula via mhchem', () => {
    expect(rendersCleanly('$\\ce{Al2(SO4)3}$')).toBe(true)
  })

  it('renders a chemical equation via mhchem', () => {
    expect(rendersCleanly('$\\ce{2H2 + O2 -> 2H2O}$')).toBe(true)
  })

  it('renders vectors and units', () => {
    expect(rendersCleanly('$\\vec{v}$ is $10\\,\\mathrm{m/s}$')).toBe(true)
  })

  it('escapes HTML in text segments', () => {
    const html = render('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in text around math', () => {
    const html = render('a < b & c $x$ <b>')
    expect(html).toContain('a &lt; b &amp; c ')
    expect(html).toContain('&lt;b&gt;')
  })

  it('keeps a literal \\$ as a plain dollar sign', () => {
    expect(render('costs \\$5')).toBe('costs $5')
  })

  it('preserves non-ASCII text', () => {
    expect(render('é 日本')).toBe('é 日本')
  })

  it('turns a newline into a break and a blank line into a paragraph gap', () => {
    expect(render('one\ntwo\n\nthree')).toBe('one<br>two<br><br>three')
  })
})
