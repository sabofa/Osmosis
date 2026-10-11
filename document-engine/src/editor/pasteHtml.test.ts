import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import * as F from './__fixtures__/clipboard'
import { escapeMarkdown, htmlToMarkdown, insertPasted, selectionInCodeOrMath, shouldConvertPaste } from './pasteHtml'
import { cleanClipboardHtml } from './wordClean'

const conv = (html: string, text = '') => shouldConvertPaste({ html, text })

describe('htmlToMarkdown', () => {
  it('Word: title, heading, runs, nested bullets, numbered list, link, table, dead image', () => {
    expect(htmlToMarkdown(F.WORD_MIXED)).toBe([
      '# Field Notes', '', '## Method', '',
      'It was a **careful**, *slow* run \u2014 the \u201Cbest\u201D so far.', '',
      '- Apples', '  - Granny Smith', '- Pears', '',
      '1. Mix', '2. Bake', '',
      'See [the recipe](https://example.com/recipe) for more.', '',
      '| Item | Qty |', '| --- | --: |', '| Apples | 3 |', '',
      'Chart of results',
    ].join('\n'))
  })

  it('Google Docs: the font-weight:normal bold wrapper does not bold everything', () => {
    expect(htmlToMarkdown(F.GDOCS_BOLD_WRAPPER)).toBe('Plain start, **bold part** *and italic.*\n\n- One\n- Two')
  })

  it('web article: nav, scripts, forms, aside, footer and svg are dropped; structure kept', () => {
    expect(htmlToMarkdown(F.WEB_ARTICLE)).toBe([
      '## Why \\_snake_case\\_ wins', '',
      'Read the [spec](https://example.org/spec) and the *notes*; costs \\$5 or \\$10.', '',
      '> Names matter.', '',
      '- First', '- Second', '  - Nested', '',
      '1. One', '2. Two',
    ].join('\n'))
  })

  it('fenced code with language, inline code, and a bare <pre>', () => {
    expect(htmlToMarkdown(F.CODE_BLOCK)).toBe(
      '### Example\n\n```ts\nconst a = 1;\n\nif (a < 2) {\n  run();\n}\n```\n\nUse `run()` here.')
    expect(htmlToMarkdown(F.PRE_NO_CODE)).toBe('```\ndef f():\n    return 1\n```')
  })

  it('tables keep alignment and escape pipes', () => {
    expect(htmlToMarkdown(F.TABLE_ALIGNED)).toBe(
      '| Name | Score | Pct |\n| :-- | :-: | --: |\n| Ann | 9 | 90% |\n| Bo \\| Jr | 7 | 70% |')
  })

  it('images: http kept, file / cid dropped (alt stays), huge data: dropped, tiny data: kept', () => {
    expect(htmlToMarkdown(F.IMAGES)).toBe(
      '![Remote](https://example.com/a.png) Local pic Huge ![Tiny](data:image/gif;base64,R0lGODlhAQABAAAAACw=)')
  })

  it('keeps unicode and smart quotes, normalises to NFC, collapses blank lines', () => {
    const md = htmlToMarkdown('<p>Cafe\u0301 \u201Cquoted\u201D</p><p>&nbsp;</p><p></p><p>\u2018next\u2019</p><br><br><br><p>end</p>')
    expect(md).toBe('Caf\u00E9 \u201Cquoted\u201D\n\n\u2018next\u2019\n\nend')
  })

  it('returns empty for HTML with no content', () => {
    expect(htmlToMarkdown('<div> </div><script>x()</script>')).toBe('')
  })

  it('task lists and strikethrough', () => {
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul><p><s>old</s></p>'))
      .toBe('- [x] done\n- [ ] todo\n\n~~old~~')
  })
})

describe('escapeMarkdown', () => {
  it('leaves ordinary words alone', () => {
    for (const s of ['snake_case_name', '2 * 3 = 6', 'a - b', 'C:\\Users\\me', 'price $5', 'it`s', 'x [1] y', '1.5 apples'])
      expect(escapeMarkdown(s)).toBe(s)
  })
  it('escapes what would change meaning', () => {
    expect(escapeMarkdown('*not bold*')).toBe('\\*not bold\\*')
    expect(escapeMarkdown('_not italic_')).toBe('\\_not italic\\_')
    expect(escapeMarkdown('# not a heading')).toBe('\\# not a heading')
    expect(escapeMarkdown('- not a list')).toBe('\\- not a list')
    expect(escapeMarkdown('1. not a list')).toBe('1\\. not a list')
    expect(escapeMarkdown('> not a quote')).toBe('\\> not a quote')
    expect(escapeMarkdown('$a$ and $b$')).toBe('\\$a\\$ and \\$b\\$')
    expect(escapeMarkdown('`a` and `b`')).toBe('\\`a\\` and \\`b\\`')
  })
})

describe('wordClean', () => {
  it('takes only the CF_HTML fragment and drops conditional comments / Office tags', () => {
    const out = cleanClipboardHtml(F.WORD_MIXED)
    expect(out).not.toMatch(/StartFragment|<!--|<o:|<w:|<style|<meta|mso-list|supportLists/i)
    expect(out.startsWith('<h1>Field Notes</h1>')).toBe(true)
  })
  it('a Word list level jump and a bullet/number switch build separate nested lists', () => {
    const p = (lvl: number, mark: string, text: string) =>
      `<p class=MsoListParagraph style='mso-list:l0 level${lvl} lfo1'><span style='mso-list:Ignore'>${mark}<span>&nbsp;</span></span>${text}</p>`
    const out = cleanClipboardHtml(p(1, '\u00B7', 'a') + p(2, '1.', 'b') + p(3, 'o', 'c') + p(1, 'i.', 'd'))
    expect(out).toBe('<ul><li>a<ol><li>b<ul><li>c</li></ul></li></ol></li></ul><ol><li>d</li></ol>')
  })
  it('numbered lists keep their start number', () => {
    const out = cleanClipboardHtml("<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>3.<span>&nbsp;</span></span>x</p>")
    expect(htmlToMarkdown(out)).toBe('3. x')
  })
  it('span styles map to strong / em / s once, not nested twice', () => {
    const out = cleanClipboardHtml('<p><b><span style="font-weight:bold">x</span></b> <span style="text-decoration:line-through;font-style:italic">y</span></p>')
    expect(out).toBe('<p><b>x</b> <em><s>y</s></em></p>')
  })
  it('Docs wrapper unwrap leaves a real <b> alone', () => {
    const out = cleanClipboardHtml('<b style="font-weight:normal;" id="docs-internal-guid-9"><p>a <b>b</b></p></b>')
    expect(out).toBe('<p>a <b>b</b></p>')
  })
})

describe('shouldConvertPaste', () => {
  it('converts real structure and Word / Docs markers', () => {
    expect(conv(F.WORD_MIXED)).toBe(true)
    expect(conv(F.GDOCS_BOLD_WRAPPER)).toBe(true)
    expect(conv(F.WEB_ARTICLE)).toBe(true)
    expect(conv(F.CODE_BLOCK)).toBe(true)
    expect(conv(F.TABLE_ALIGNED)).toBe(true)
    expect(conv(F.IMAGES)).toBe(true)
    expect(conv('<p class=MsoNormal>just words</p>')).toBe(true)
  })
  it('keeps plain text when the HTML is the text wrapped in a div / span', () => {
    expect(conv(F.PLAIN_TEXT_IN_DIV, 'just some copied words, nothing fancy')).toBe(false)
    expect(conv(F.PLAIN_TEXT_IN_SPAN, 'hello world')).toBe(false)
    expect(conv('<p>one</p><p>two</p>', 'one\n\ntwo')).toBe(false)
    expect(conv('<br>', '\n')).toBe(false)
  })
  it('keeps plain text that already looks like markdown, with or without a highlighter wrapper', () => {
    expect(conv('', F.MARKDOWN_TEXT)).toBe(false)
    expect(conv(F.MARKDOWN_AS_VSCODE_HTML, '# Title\n- one')).toBe(false)
  })
  it('does not mistake <body>, <br>, <base>, <button> for structure', () => {
    expect(conv('<body><br><base href="x"><button>go</button></body>')).toBe(false)
  })
})

function mdState(doc: string, anchor: number, head = anchor): EditorState {
  const state = EditorState.create({
    doc, selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('selectionInCodeOrMath', () => {
  it('is true inside fenced code (closed or open), inline code and math', () => {
    const fenced = 'a\n\n```ts\nlet x\n```\n\nb'
    expect(selectionInCodeOrMath(mdState(fenced, fenced.indexOf('let') + 2))).toBe(true)
    const open = 'a\n\n```\nlet x'
    expect(selectionInCodeOrMath(mdState(open, open.length))).toBe(true)
    const inline = 'use `foo` now'
    expect(selectionInCodeOrMath(mdState(inline, inline.indexOf('foo') + 1))).toBe(true)
    const block = '$$\nx^2\n$$'
    expect(selectionInCodeOrMath(mdState(block, 4))).toBe(true)
    const im = 'so $a+b$ here'
    expect(selectionInCodeOrMath(mdState(im, im.indexOf('+')))).toBe(true)
  })
  it('is false in ordinary prose, headings and lists', () => {
    const doc = '# Head\n\ntext `x` more\n\n- item'
    for (const at of [3, doc.indexOf('text') + 2, doc.indexOf('more'), doc.length])
      expect(selectionInCodeOrMath(mdState(doc, at))).toBe(false)
  })
})

describe('insertPasted', () => {
  // The two members insertPasted uses; no DOM is needed to run it.
  function harness(doc: string, anchor: number, head = anchor) {
    const view = {
      state: mdState(doc, anchor, head),
      last: null as Transaction | null,
      txCount: 0,
      dispatch(...specs: TransactionSpec[]) {
        const tr = view.state.update(...specs)
        view.last = tr
        view.txCount++
        view.state = tr.state
      },
    }
    return view
  }
  const asView = (h: ReturnType<typeof harness>) => h as unknown as EditorView
  it('replaces the selection in a single input.paste transaction and parks the caret after it', () => {
    const v = harness('hello WORLD end', 6, 11)
    insertPasted(asView(v), '**bold**')
    expect(v.state.doc.toString()).toBe('hello **bold** end')
    expect(v.state.selection.main.head).toBe(14)
    expect(v.txCount).toBe(1)
    expect(v.last?.isUserEvent('input.paste')).toBe(true)
  })
  it('puts block markdown on its own paragraph when pasted mid-line', () => {
    const v = harness('before after', 7)
    insertPasted(asView(v), '- a\n- b')
    expect(v.state.doc.toString()).toBe('before \n\n- a\n- b\n\nafter')
  })
  it('leaves block markdown alone on an empty line', () => {
    const v = harness('intro\n\n', 7)
    insertPasted(asView(v), '## H\n\ntext')
    expect(v.state.doc.toString()).toBe('intro\n\n## H\n\ntext')
  })
})
