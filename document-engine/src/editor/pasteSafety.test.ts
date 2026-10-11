import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, shouldConvertPaste } from './pasteHtml'
import { cleanClipboardHtml, MAX_PASTE_HTML } from './wordClean'
import { isSafeHref, isSafeImgSrc } from './urlSafe'

const ch = String.fromCharCode

describe('link allow-list', () => {
  it('keeps http(s), mailto, tel, fragments and relative paths', () => {
    for (const h of ['https://a.io/x', 'HTTP://a.io', 'mailto:a@b.c', 'tel:+1', '#top', '/p', './p', '../p', '  https://a.io']) {
      expect(isSafeHref(h), h).toBe(true)
    }
  })
  it('refuses scripts, data and their obfuscations', () => {
    const bad = [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', `java${ch(9)}script:alert(1)`,
      `java${ch(10)}script:alert(1)`, `${ch(1)}javascript:alert(1)`, 'vbscript:x', 'data:text/html,<b>', 'file:///c', 'ftp://x', 'x.com/p', '',
    ]
    for (const h of bad) expect(isSafeHref(h), JSON.stringify(h)).toBe(false)
  })
  it('turns an unsafe link into its plain text', () => {
    expect(htmlToMarkdown('<p>see <a href="javascript:alert(1)"><b>this</b></a> now</p>')).toBe('see **this** now')
    expect(htmlToMarkdown(`<p><a href="java${ch(9)}script:alert(1)">x</a> <a href="data:text/html,hi">y</a></p><ul><li>k</li></ul>`)).toContain('x y')
    expect(htmlToMarkdown('<p><a href="https://ok.io">ok</a> <a href="vbscript:x">v</a></p><ul><li>k</li></ul>')).toContain('[ok](https://ok.io) v')
  })
})

describe('image allow-list', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  it('keeps http(s) and small raster data URLs only', () => {
    expect(isSafeImgSrc('https://a.io/i.png')).toBe(true)
    expect(isSafeImgSrc(png)).toBe(true)
    for (const s of ['javascript:x', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', '/rel.png', 'file:///c.png', '', `data:image/png;base64,${'A'.repeat(3000)}`]) {
      expect(isSafeImgSrc(s), s.slice(0, 30)).toBe(false)
    }
  })
  it('drops unsafe images to their alt text', () => {
    expect(htmlToMarkdown('<p><img src="javascript:alert(1)" alt="boom"> and <img src="https://a.io/i.png" alt="pic"> <b>x</b></p>'))
      .toBe('boom and ![pic](https://a.io/i.png) **x**')
    expect(cleanClipboardHtml('<img src="data:text/html;base64,AAAA" alt="a">')).toBe('a')
  })
})

describe('wordClean robustness', () => {
  it('an unclosed script or style drops to the end of the input', () => {
    expect(htmlToMarkdown('<p>keep <b>me</b></p><script>alert("leak")')).toBe('keep **me**')
    expect(htmlToMarkdown('<p>keep <b>me</b></p><style>p{color:red')).toBe('keep **me**')
    expect(cleanClipboardHtml('<p>a</p><script>var x = "</div>"; leak()')).not.toMatch(/leak|var x/)
  })
  it('closed scripts do not leak and do not eat the text after them', () => {
    const md = htmlToMarkdown('<p>one</p><script>leak()</script><p><b>two</b></p><style>x{}</style><p>three</p>')
    expect(md).toBe('one\n\n**two**\n\nthree')
  })
  it('nested dropped elements and an unclosed non-raw element are handled', () => {
    expect(cleanClipboardHtml('<nav>a<nav>b</nav>c</nav><p>keep</p>')).toBe('<p>keep</p>')
    expect(cleanClipboardHtml('<p>x</p><footer>tail text')).toContain('tail text')
  })
  it('unwraps the Google Docs bold wrapper, nested', () => {
    const md = htmlToMarkdown('<b style="font-weight:normal" id="docs-internal-guid-1"><p>a <b>bold</b> <i>it</i></p></b>')
    expect(md).toBe('a **bold** *it*')
  })
  it('refuses HTML over 1 MB (paste stays plain)', () => {
    const big = '<p><b>x</b></p>' + ' '.repeat(MAX_PASTE_HTML)
    expect(shouldConvertPaste({ html: big, text: 'x' })).toBe(false)
    expect(htmlToMarkdown(big)).toBe('')
  })
  it('converts a 1 MB fragment with 20k spans quickly', () => {
    const span = '<span style="font-weight:700">w </span>'
    const html = '<p>' + span.repeat(20000) + '</p>'
    expect(html.length).toBeLessThan(MAX_PASTE_HTML)
    const t0 = performance.now()
    const md = htmlToMarkdown(html)
    expect(performance.now() - t0).toBeLessThan(1500)
    expect(md.length).toBeGreaterThan(1000)
  })
  it('many dropped elements stay linear', () => {
    const html = '<p>keep</p>' + '<script>a</script><style>b</style><nav>c</nav>'.repeat(6000)
    const t0 = performance.now()
    expect(cleanClipboardHtml(html)).toBe('<p>keep</p>')
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
