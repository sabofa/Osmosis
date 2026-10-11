import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { parseBlocks, parseInline, parseInlineSegs, isEscapable } from './markdown'
import { buildLiveDecos, type DecoSpec } from './editor/livePreview'
import { escapeMarkdown, htmlToMarkdown } from './editor/pasteHtml'

/** What the reader shows for one paragraph's source: the runs' source slices joined. */
function shown(src: string): string {
  const b = parseBlocks(src)[0]
  const runs = b.segs ? parseInlineSegs(src, b.segs) : parseInline(src.slice(b.start, b.end), b.start)
  return runs.map((r) => src.slice(r.start, r.end)).join('')
}
const BS = String.fromCharCode(92)

describe('reader: backslash escapes', () => {
  it('isEscapable is ASCII punctuation only', () => {
    for (const c of '!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~' + BS) expect(isEscapable(c)).toBe(true)
    for (const c of ['a', '1', ' ', '\n', 'e', undefined]) expect(isEscapable(c)).toBe(false)
  })
  it('an escaped star is a plain star and never pairs', () => {
    expect(shown(`2${BS}*3${BS}*4`)).toBe('2*3*4')
    const runs = parseInline(`2${BS}*3${BS}*4`, 0)
    expect(runs.some((r) => r.italic || r.bold)).toBe(false)
  })
  it('escaped heading, list and link syntax read literally', () => {
    expect(parseBlocks(`${BS}# not a heading`)[0].type).toBe('p')
    expect(shown(`${BS}# not a heading`)).toBe('# not a heading')
    expect(parseBlocks(`1${BS}. x`)[0].type).toBe('p')
    expect(shown(`1${BS}. x`)).toBe('1. x')
    expect(shown(`${BS}[x${BS}](y)`)).toBe('[x](y)')
  })
  it('a doubled backslash is one literal backslash, and the next char is live again', () => {
    expect(shown(`${BS}${BS}`)).toBe(BS)
    const runs = parseInline(`${BS}${BS}*a*`, 0)
    expect(runs.map((r) => [r.italic ?? false, `${BS}${BS}*a*`.slice(r.start, r.end)])).toEqual([[false, BS], [true, 'a']])
  })
  it('a backslash before a letter, or at the end, stays', () => {
    expect(shown(`a${BS}b`)).toBe(`a${BS}b`)
    expect(shown(`end${BS}`)).toBe(`end${BS}`)
  })
  it('escapes inside code spans stay literal', () => {
    const s = `see ${BS}\`x${BS}*y\` ok`
    // the first backtick is escaped, so no code span opens there
    expect(parseInline(s, 0).some((r) => r.code)).toBe(false)
    const t = `a \`b${BS}*c\` d`
    const code = parseInline(t, 0).find((r) => r.code)!
    expect(t.slice(code.start, code.end)).toBe(`b${BS}*c`)
  })
  it('an escaped star inside emphasis does not close it', () => {
    const s = `*a${BS}*b*`
    const it = parseInline(s, 0).filter((r) => r.italic)
    expect(it.map((r) => s.slice(r.start, r.end)).join('')).toBe('a*b')
  })
  it('escaped dollar never opens math (and keeps its dollar)', () => {
    const s = `cost ${BS}$5 and ${BS}$x$`
    expect(parseInline(s, 0).some((r) => r.math)).toBe(false)
    expect(shown(s)).toBe('cost $5 and $x$')
  })
  it('offsets stay absolute: runs point at the original text around an escape', () => {
    const src = `ab ${BS}*cd${BS}* **ef**`
    const runs = parseInline(src, 100)
    for (const r of runs) expect(r.start).toBeGreaterThanOrEqual(100)
    // the characters a highlight would cover map back to the source slice
    expect(runs.map((r) => src.slice(r.start - 100, r.end - 100)).join('')).toBe('ab *cd* ef')
    const bold = runs.find((r) => r.bold)!
    expect(src.slice(bold.start - 100, bold.end - 100)).toBe('ef')
    // no run contains a backslash
    expect(runs.every((r) => !src.slice(r.start - 100, r.end - 100).includes(BS))).toBe(true)
  })
  it('works across quote line joins (parseInlineSegs)', () => {
    const src = `a${BS}*b
c${BS}*d`
    const segs = [{ start: 0, end: 4 }, { start: 5, end: 9 }]
    const runs = parseInlineSegs(src, segs)
    expect(runs.map((r) => src.slice(r.start, r.end)).join('')).toBe('a*bc*d')
  })
})

function mk(doc: string, anchor = 0, head = anchor): EditorState {
  const s = EditorState.create({
    doc, selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
const build = (s: EditorState): DecoSpec[] =>
  buildLiveDecos(s, {
    selection: s.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing: false, viewport: [{ from: 0, to: s.doc.length }],
  })
const hidden = (s: EditorState, specs: DecoSpec[]) =>
  specs.filter((d) => d.hidden && d.to > d.from).map((d) => [d.from, s.sliceDoc(d.from, d.to)])

describe('live preview: Escape node', () => {
  const doc = `2${BS}*3${BS}*4 end`
  it('hides the backslashes with the caret away, reveals them when it touches', () => {
    const away = mk(doc, doc.length)
    expect(hidden(away, build(away))).toEqual([[1, BS], [4, BS]])
    const on = mk(doc, 2) // between the backslash and the star
    expect(hidden(on, build(on))).toEqual([[4, BS]])
    const edge = mk(doc, 1)
    expect(hidden(edge, build(edge))).toEqual([[4, BS]])
    const sel = mk(doc, 0, 6)
    expect(hidden(sel, build(sel))).toEqual([])
  })
  it('an escaped dollar hides its backslash too', () => {
    const d = `cost ${BS}$5`
    const s = mk(d, 0)
    expect(hidden(s, build(s))).toEqual([[5, BS]])
  })
  it('code spans keep their backslashes', () => {
    const d = `\`a${BS}*b\` x`
    const s = mk(d, d.length)
    expect(hidden(s, build(s)).map((h) => h[1])).toEqual(['`', '`'])
  })
})

describe('paste round trip', () => {
  const html = (inner: string) => `<p>${inner}</p>`
  it('pasted 2*3*4 displays as 2*3*4 next to real structure', () => {
    const md = htmlToMarkdown(html('2*3*4 and <strong>bold</strong>'))
    expect(shown(md)).toBe('2*3*4 and bold')
    expect(parseInline(md, 0).filter((r) => r.bold).length).toBe(1)
  })
  it('hash, numbered, brackets, angle brackets, backslashes and dollars read back unchanged', () => {
    const cases = [
      '# not a heading', '1. not a list', '[x](y) text', '<b>hi</b>', `C:${BS}*dir`, '_x_ here', '$a$ and $b$',
    ]
    for (const c of cases) {
      const esc = escapeMarkdown(c)
      expect(shown(esc)).toBe(c)
    }
  })
})
