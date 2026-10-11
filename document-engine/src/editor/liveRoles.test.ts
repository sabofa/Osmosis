import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { buildLiveDecos, type DecoSpec } from './livePreview'

function build(doc: string): { s: EditorState; specs: DecoSpec[] } {
  const s = EditorState.create({ doc, selection: EditorSelection.single(doc.length), extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return { s, specs: buildLiveDecos(s, { selection: [{ from: doc.length, to: doc.length }], composing: false, viewport: [{ from: 0, to: doc.length }] }) }
}
const attrsAt = (specs: DecoSpec[], from: number): Record<string, string> =>
  Object.assign({}, ...specs.filter((d) => d.from === d.to && d.from === from).map((d) => d.deco.spec.attributes))

describe('live preview document roles', () => {
  const doc = '# Title\n\nLead para.\n\nBody.\n\n## One\n\ntext\n\n## Two\n\n### sub'
  it('title, lede, numbered sections, levels', () => {
    const { s, specs } = build(doc)
    const at = (needle: string) => s.doc.lineAt(doc.indexOf(needle)).from
    expect(attrsAt(specs, at('# Title'))).toMatchObject({ 'data-role': 'title', 'data-level': '1' })
    expect(attrsAt(specs, at('Lead'))['data-role']).toBe('lede')
    expect(attrsAt(specs, at('Body'))['data-role']).toBeUndefined()
    const one = attrsAt(specs, at('## One'))
    expect(one).toMatchObject({ 'data-role': 'section', 'data-section-index': '1', 'data-level': '2' })
    expect(one.style).toContain('--de-section-index:1')
    expect(attrsAt(specs, at('## Two'))['data-section-index']).toBe('2')
    expect(attrsAt(specs, at('### sub'))).toMatchObject({ 'data-level': '3' })
    expect(attrsAt(specs, at('### sub'))['data-role']).toBeUndefined()
  })
  it('setext headings count; role on the first line only', () => {
    const d = 'Title\n=====\n\nlead\n\nSec\n---\n'
    const { specs } = build(d)
    expect(attrsAt(specs, 0)['data-role']).toBe('title')
    expect(attrsAt(specs, 6)['data-role']).toBeUndefined()
    expect(attrsAt(specs, 6)['data-level']).toBe('1')
    expect(attrsAt(specs, d.indexOf('lead'))['data-role']).toBe('lede')
    expect(attrsAt(specs, d.indexOf('Sec'))).toMatchObject({ 'data-role': 'section', 'data-section-index': '1' })
  })
  it('no title: no lede; headings in quotes ignored; viewport does not change numbering', () => {
    const { specs } = build('para\n\n> ## q\n\n## real')
    expect(specs.some((d) => d.deco.spec.attributes?.['data-role'] === 'lede')).toBe(false)
    const sec = specs.filter((d) => d.deco.spec.attributes?.['data-role'] === 'section')
    expect(sec.length).toBe(1)
    expect(sec[0].deco.spec.attributes['data-section-index']).toBe('1')
  })
})
