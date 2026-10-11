import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { buildLiveDecos, planUpdate, viewportSpans, specsToSet, type DecoSpec } from './livePreview'

function mk(doc: string, anchor = 0, head = anchor): EditorState {
  const s = EditorState.create({
    doc, selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
const build = (s: EditorState, composing = false, previous?: DecoSpec[]) =>
  buildLiveDecos(s, {
    selection: s.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing, previous, viewport: [{ from: 0, to: s.doc.length }],
  })
const hiddenText = (s: EditorState, specs: DecoSpec[]) =>
  specs.filter((d) => d.hidden && d.to > d.from).map((d) => s.sliceDoc(d.from, d.to))
const lineClasses = (specs: DecoSpec[], from: number): string =>
  specs.filter((d) => d.from === d.to && d.from === from).map((d) => String(d.deco.spec.attributes?.class)).join(' ')

describe('inline reveal rules', () => {
  const doc = 'a **bold** b'
  it('hides ** when the caret is outside, reveals inside and at the boundaries', () => {
    expect(hiddenText(mk(doc, 0), build(mk(doc, 0)))).toEqual(['**', '**'])
    for (const pos of [2, 3, 6, 8, 10]) {
      expect(hiddenText(mk(doc, pos), build(mk(doc, pos)))).toEqual([])
    }
    expect(hiddenText(mk(doc, 11), build(mk(doc, 11)))).toEqual(['**', '**'])
  })
  it('a selection that overlaps the construct reveals it', () => {
    const s = mk(doc, 0, 4)
    expect(hiddenText(s, build(s))).toEqual([])
  })
  it('moving the caret by one char across ** reveals it', () => {
    const before = mk(doc, 1)
    expect(hiddenText(before, build(before))).toEqual(['**', '**'])
    const after = mk(doc, 2)
    expect(hiddenText(after, build(after))).toEqual([])
  })
  it('emphasis, strike and inline code hide their marks', () => {
    const d = '*i* ~~s~~ `c` end'
    const s = mk(d, d.length)
    expect(hiddenText(s, build(s)).sort()).toEqual(['*', '*', '`', '`', '~~', '~~'].sort())
  })
  it('links hide [ and ](url) outside, show them inside', () => {
    const d = 'see [home](http://x.io) now'
    const out = mk(d, d.length)
    expect(hiddenText(out, build(out))).toEqual(['[', '](http://x.io)'])
    const inside = mk(d, 8)
    expect(hiddenText(inside, build(inside))).toEqual([])
  })
})

describe('block constructs', () => {
  it('heading: hides "# " off the line, reveals when the caret is on it, scales via line class', () => {
    const d = '# Title\n\nbody'
    const off = mk(d, d.length)
    expect(hiddenText(off, build(off))).toEqual(['# '])
    expect(lineClasses(build(off), 0)).toContain('cm-lp-h1')
    const on = mk(d, 3)
    expect(hiddenText(on, build(on))).toEqual([])
    expect(lineClasses(build(on), 0)).toContain('cm-lp-h1')
    expect(lineClasses(build(mk('### x', 5)), 0)).toContain('cm-lp-h3')
  })
  it('blockquote: rule line class, hides "> " off-line only', () => {
    const d = '> q one\n> q two\n\nz'
    const s = mk(d, d.length)
    const specs = build(s)
    expect(lineClasses(specs, 0)).toContain('cm-lp-quote')
    expect(lineClasses(specs, 8)).toContain('cm-lp-quote')
    expect(hiddenText(s, specs)).toEqual(['> ', '> '])
    const on = mk(d, 3)
    expect(hiddenText(on, build(on))).toEqual(['> '])
  })
  it('bullets become glyph widgets off-line and raw on the caret line', () => {
    const d = '- a\n- b'
    const off = mk(d, 5)
    const specs = build(off)
    expect(hiddenText(off, specs)).toEqual(['- '])
    const lis = specs.filter((x) => x.from === x.to && String(x.deco.spec.attributes?.class).startsWith('cm-lp-li'))
    expect(lis.length).toBe(2)
    expect(String(lis[0].deco.spec.attributes.style)).toContain('text-indent:-1.5em')
  })
  it('nested bullets hang deeper', () => {
    const d = '- a\n  - b'
    const s = mk(d, 0)
    const lis = build(s).filter((x) => x.from === x.to && String(x.deco.spec.attributes?.class).startsWith('cm-lp-li'))
    expect(lis.map((x) => String(x.deco.spec.attributes.style))).toEqual([
      'padding-inline-start:1.5em;text-indent:-1.5em', 'padding-inline-start:3em;text-indent:-3em',
    ])
  })
  it('ordered lists keep the number and style it', () => {
    const d = '1. one\n2. two'
    const s = mk(d, 0)
    const specs = build(s)
    expect(hiddenText(s, specs)).toEqual([])
    expect(specs.some((x) => x.deco.spec.class === 'cm-lp-olmark')).toBe(true)
  })
  it('task items: checkbox widget replaces [ ] / [x]; caret on the marker reveals', () => {
    const d = '- [ ] open\n- [x] done\n\nz'
    const s = mk(d, d.length)
    expect(hiddenText(s, build(s))).toEqual(['- ', '[ ] ', '- ', '[x] '])
    const on = mk(d, 3)
    expect(hiddenText(on, build(on))).not.toContain('[ ] ')
  })
  it('horizontal rule: rule line off-line, source when touched', () => {
    const d = 'a\n\n---\n\nb'
    const off = mk(d, 0)
    expect(hiddenText(off, build(off))).toEqual(['---'])
    expect(lineClasses(build(off), 3)).toContain('cm-lp-hr')
    const on = mk(d, 4)
    expect(hiddenText(on, build(on))).toEqual([])
  })
  it('fenced code: monospace lines; fences dimmed off-block, nothing hidden; math/graph untouched', () => {
    const d = '```js\nconst a = 1\n```\n\nz'
    const off = mk(d, d.length)
    const specs = build(off)
    expect(hiddenText(off, specs)).toEqual([])
    expect(lineClasses(specs, 0)).toContain('cm-lp-fence')
    expect(lineClasses(specs, 6)).toContain('cm-lp-code')
    expect(lineClasses(specs, 6)).not.toContain('cm-lp-fence')
    expect(lineClasses(specs, 18)).toContain('cm-lp-fence')
    const on = mk(d, 8)
    expect(lineClasses(build(on), 0)).not.toContain('cm-lp-fence')
    // graph fences are code when no renderer is given (or when revealed): see liveWidgets.test.
    for (const lang of ['math']) {
      const m = mk('```' + lang + '\nx\n```', 0)
      expect(build(m).filter((x) => String(x.deco.spec.attributes?.class ?? '').includes('cm-lp-code'))).toEqual([])
    }
  })
})

describe('IME and performance contracts', () => {
  it('composing=true returns the previous set unchanged and never rebuilds', () => {
    const s = mk('a **bold** b', 0)
    const prev = build(s)
    const typed = s.update({ changes: { from: 0, insert: 'zz' } }).state
    expect(build(typed, true, prev)).toEqual(prev)
    expect(build(typed, true)).toEqual([])
  })
  it('planUpdate: composing maps on doc change, keeps otherwise; rebuild on relevant changes', () => {
    const base = { docChanged: false, selectionSet: false, viewportChanged: false, treeChanged: false, composing: false, forced: false }
    expect(planUpdate({ ...base, composing: true, docChanged: true, selectionSet: true })).toBe('map')
    expect(planUpdate({ ...base, composing: true, selectionSet: true })).toBe('keep')
    expect(planUpdate(base)).toBe('keep')
    for (const k of ['docChanged', 'selectionSet', 'viewportChanged', 'treeChanged', 'forced'] as const) {
      expect(planUpdate({ ...base, [k]: true })).toBe('rebuild')
    }
  })
  it('mapped decorations survive a composing edit', () => {
    const s = mk('a **bold** b', 0)
    const set = specsToSet(build(s))
    const tr = s.update({ changes: { from: 0, insert: 'xyz' } })
    const mapped = set.map(tr.changes)
    const seen: string[] = []
    mapped.between(0, tr.state.doc.length, (from, to, d) => {
      if (to > from && !d.spec.class && !d.spec.attributes) seen.push(tr.state.sliceDoc(from, to))
    })
    expect(seen).toEqual(['**', '**'])
  })
  it('decorates only the viewport span (plus margin)', () => {
    const doc = Array.from({ length: 4000 }, (_, i) => `line ${i} **b**`).join('\n')
    const s = mk(doc, 0)
    const t0 = performance.now()
    const specs = buildLiveDecos(s, {
      selection: [{ from: 0, to: 0 }], composing: false,
      viewport: viewportSpans([{ from: 30000, to: 32000 }], s.doc.length),
    })
    const ms = performance.now() - t0
    expect(specs.length).toBeGreaterThan(0)
    expect(specs.length).toBeLessThan(1500)
    expect(Math.min(...specs.map((x) => x.from))).toBeGreaterThanOrEqual(30000 - 2100)
    expect(ms).toBeLessThan(200)
  })
  it('viewportSpans merges overlapping margins and clamps', () => {
    expect(viewportSpans([{ from: 0, to: 10 }, { from: 500, to: 600 }], 700)).toEqual([{ from: 0, to: 700 }])
  })
})

describe('copy yields markdown source', () => {
  it('the document text is untouched by decorations, so a selection slice is source', () => {
    const d = '# T\n\na **b** [l](u)'
    const s = mk(d, 0, d.length)
    build(s)
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe(d)
  })
})

describe('guard', () => {
  it('livePreview.ts has no colour or font literals', () => {
    const src = readFileSync(fileURLToPath(new URL('./livePreview.ts', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
    expect(src).not.toMatch(/(?:color|backgroundColor)\s*:\s*['"](?!var\(|transparent|inherit)/)
    expect(src).not.toMatch(/fontFamily\s*:\s*['"](?!var\(|inherit)/)
    expect(src).not.toMatch(/var\(\s*--[\w-]+\s*,\s*[-+]?(?:\d+\.?\d*|\.\d+)[a-z%]*\s*\)/i)
  })
})
