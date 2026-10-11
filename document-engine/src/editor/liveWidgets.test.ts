import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { scanLiveBlocks, inlineMathInLine, decideBlockWidgets } from './liveScan'
import { buildLiveDecos } from './livePreview'
import { blockField, blockDecorations, liveOptions, mathView, MathWidget, GraphWidget } from './liveWidgets'
import { highlightSpans, highlightKey, highlightField, setHighlightSpans } from './highlightDecos'

const doc = [
  'Intro $a^2$ and $5 and $x$ end.', // 0
  '',
  '$$',
  '\\int_0^1 x\\,dx',
  '$$',
  '',
  '$$E=mc^2$$',
  '',
  '```graph size=m',
  'y = x^2',
  '```',
  '',
  '```js',
  'const s = "$$ not math $$"',
  '```',
].join('\n')

describe('scanLiveBlocks', () => {
  const blocks = scanLiveBlocks(doc)
  it('finds multi-line and one-line $$ blocks and fences with whole-line ranges', () => {
    expect(blocks.map((b) => b.kind)).toEqual(['math', 'math', 'graph', 'fence'])
    expect(doc.slice(blocks[0].from, blocks[0].to)).toBe('$$\n\\int_0^1 x\\,dx\n$$')
    expect(blocks[0].body).toBe('\\int_0^1 x\\,dx')
    expect(doc.slice(blocks[1].from, blocks[1].to)).toBe('$$E=mc^2$$')
    expect(blocks[1].body).toBe('E=mc^2')
    expect(blocks[2].info).toBe('graph size=m')
    expect(blocks[2].body).toBe('y = x^2')
    expect(doc.slice(blocks[2].from, blocks[2].to)).toBe('```graph size=m\ny = x^2\n```')
  })
  it('does not read $$ inside a code fence as math, and ignores an unclosed $$', () => {
    expect(blocks.filter((b) => b.kind === 'math')).toHaveLength(2)
    expect(scanLiveBlocks('$$ oops\nmore')).toEqual([])
  })
  it('marks an unclosed fence as not closed', () => {
    const [b] = scanLiveBlocks('```graph\ny=x')
    expect(b).toMatchObject({ kind: 'graph', closed: false })
  })
})

describe('inlineMathInLine', () => {
  it('finds $x$ and mid-line $$x$$ with delimiter-inclusive ranges, not prices', () => {
    const line = 'a $x_1$ b $$y$$ c $5 and $z$'
    const m = inlineMathInLine(line, 100)
    expect(m.map((x) => line.slice(x.from - 100, x.to - 100))).toEqual(['$x_1$', '$$y$$', '$z$'])
    expect(m.map((x) => x.tex)).toEqual(['x_1', 'y', 'z'])
  })
  it('ignores math inside inline code', () => {
    expect(inlineMathInLine('use `$x$` here', 0)).toEqual([])
  })
})

describe('decideBlockWidgets', () => {
  const blocks = scanLiveBlocks(doc)
  it('math always widgets; graph only with a renderer; fences never', () => {
    expect(decideBlockWidgets(blocks, [{ from: 0, to: 0 }], { graph: true }).map((d) => d.block.kind)).toEqual(['math', 'math', 'graph'])
    expect(decideBlockWidgets(blocks, [{ from: 0, to: 0 }], { graph: false }).map((d) => d.block.kind)).toEqual(['math', 'math'])
  })
  it('reveals exactly the blocks the caret or selection touches', () => {
    const at = (pos: number) => decideBlockWidgets(blocks, [{ from: pos, to: pos }], { graph: true }).map((d) => d.revealed)
    expect(at(0)).toEqual([false, false, false])
    expect(at(doc.indexOf('\\int'))).toEqual([true, false, false])
    expect(at(doc.indexOf('E=mc'))).toEqual([false, true, false])
    expect(at(doc.indexOf('y = x'))).toEqual([false, false, true])
    expect(decideBlockWidgets(blocks, [{ from: 0, to: doc.length }], { graph: true }).every((d) => d.revealed)).toBe(true)
  })
})

function mk(text: string, anchor = 0, head = anchor, graph = true): EditorState {
  const s = EditorState.create({
    doc: text, selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage }), blockField, liveOptions.of(graph ? { renderGraph: () => () => null } : {})],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
const count = (set: { size: number }) => set.size

describe('block field', () => {
  it('replaces off-caret blocks (math + graph) and none when the caret is inside', () => {
    const s = mk(doc, 0)
    expect(count(s.field(blockField).atomic)).toBe(3)
    const inside = mk(doc, doc.indexOf('\\int'))
    expect(count(inside.field(blockField).atomic)).toBe(2)
  })
  it('without a renderer the graph fence stays source', () => {
    expect(count(mk(doc, 0, 0, false).field(blockField).atomic)).toBe(2)
  })
  it('recomputes on edits above and on selection moves', () => {
    let s = mk(doc, 0)
    s = s.update({ changes: { from: 0, insert: 'new line\n\n' }, selection: { anchor: 0 } }).state
    expect(s.field(blockField).blocks[0].from).toBe(doc.indexOf('$$\n') + 'new line\n\n'.length)
    s = s.update({ selection: { anchor: s.doc.toString().indexOf('y = x') } }).state
    expect(count(s.field(blockField).atomic)).toBe(2)
  })
  it('blockDecorations is pure over blocks and selection', () => {
    const s = mk(doc, 0)
    const { atomic } = blockDecorations(s, scanLiveBlocks(doc), true)
    const kinds: string[] = []
    atomic.between(0, doc.length, (_f, _t, d) => { kinds.push(d.spec.widget.constructor.name) })
    expect(kinds).toEqual(['MathWidget', 'MathWidget', 'GraphWidget'])
  })
})

describe('widgets', () => {
  it('equal source gives equal widgets (DOM is reused); different does not', () => {
    expect(new MathWidget('x', true).eq(new MathWidget('x', true))).toBe(true)
    expect(new MathWidget('x', true).eq(new MathWidget('x', false))).toBe(false)
    expect(new GraphWidget('y=x', 'graph').eq(new GraphWidget('y=x', 'graph'))).toBe(true)
    expect(new GraphWidget('y=x', 'graph').eq(new GraphWidget('y=x', 'graph size=s'))).toBe(false)
  })
  it('mathView renders valid TeX and reports errors instead of throwing', () => {
    expect(mathView('x^2', false).kind).toBe('html')
    expect(mathView('\\frac{', false).kind).toBe('error')
    expect(mathView('   ', true).kind).toBe('error')
  })
})

describe('live preview with math', () => {
  const build = (s: EditorState) =>
    buildLiveDecos(s, { selection: s.selection.ranges.map((r) => ({ from: r.from, to: r.to })), composing: false, viewport: [{ from: 0, to: s.doc.length }] })
  const mathSpecs = (specs: ReturnType<typeof build>) => specs.filter((d) => d.deco.spec.widget instanceof MathWidget)
  it('inline math is a hidden (atomic) widget off-caret and raw source on the caret', () => {
    const d = 'a $x$ b'
    const off = build(mk(d, 0))
    expect(mathSpecs(off).map((x) => [x.from, x.to, x.hidden])).toEqual([[2, 5, true]])
    expect(mathSpecs(build(mk(d, 3)))).toEqual([])
    expect(mathSpecs(build(mk(d, 2)))).toEqual([])
    expect(mathSpecs(build(mk(d, 5)))).toEqual([])
    expect(mathSpecs(build(mk(d, 6)))).toHaveLength(1)
  })
  it('emphasis marks inside math are not hidden or styled', () => {
    const specs = build(mk('x $a*b*c$ y', 0))
    expect(specs.filter((s) => s.hidden && !(s.deco.spec.widget instanceof MathWidget))).toEqual([])
  })
  it('lines inside a $$ block get no markdown decorations', () => {
    const d = '$$\n# not a heading\n$$\n\n# real'
    const specs = build(mk(d, d.length))
    expect(specs.filter((s) => String(s.deco.spec.attributes?.class ?? '').includes('cm-lp-h1')).map((s) => s.from)).toEqual([d.indexOf('# real')])
  })
})

describe('highlight painting', () => {
  it('converts codepoints to UTF-16 around astral characters in one pass', () => {
    const t = 'a 😀 b 😀 end'
    const spans = highlightSpans(t, [
      { id: '1', start: 2, end: 3, color: 'green' },
      { id: '2', start: 6, end: 9, color: 'pink' },
      { id: '3', start: 99, end: 100 },
    ])
    expect(spans.map((s) => t.slice(s.from, s.to))).toEqual(['😀', '😀 e'])
    expect(spans.map((s) => s.slot)).toEqual([1, 2])
  })
  it('keys are stable and field marks map through an insertion above', () => {
    const t = 'one two three'
    expect(highlightKey([{ id: 'a', start: 4, end: 7, color: 'blue' }])).toBe('4:7:blue')
    let s = EditorState.create({ doc: t, extensions: [highlightField] })
    s = s.update({ effects: setHighlightSpans.of(highlightSpans(t, [{ id: 'a', start: 4, end: 7 }])) }).state
    s = s.update({ changes: { from: 0, insert: 'XXXX ' } }).state
    const got: string[] = []
    s.field(highlightField).between(0, s.doc.length, (f, to) => { got.push(s.sliceDoc(f, to)) })
    expect(got).toEqual(['two'])
  })
})

describe('colour literals in the editor sources', () => {
  for (const f of ['livePreview.ts', 'liveWidgets.tsx', 'highlightDecos.ts', 'extensions.ts', 'liveScan.ts']) {
    it(`${f} has no colour literals`, () => {
      const src = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '')
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/)
      expect(src).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\(/)
      expect(src).not.toMatch(/:\s*['"](?:white|black|red|green|blue|gray|grey)['"]/)
    })
  }
})
